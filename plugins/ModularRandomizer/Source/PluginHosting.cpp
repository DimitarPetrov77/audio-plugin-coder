/*
  ==============================================================================

    PluginHosting.cpp
    Plugin hosting: scan, load, remove, param access, proxy pool, glide API

  ==============================================================================
*/

#include "PluginProcessor.h"
#include <unordered_set>
//==============================================================================
// PLUGIN HOSTING API
//==============================================================================
// ── SEH wrappers: must be free functions with NO C++ objects that need unwinding ──
// MSVC C2712: __try is illegal in functions requiring object unwinding.
// These helpers take only raw pointers, so no destructors are in scope.
#ifdef _WIN32
// Returns: 1 = more files to scan, 0 = done, -1 = SEH crash
static int sehScanOneFile (juce::PluginDirectoryScanner* scanner, juce::String* name)
{
    __try {
        bool more = scanner->scanNextFile (true, *name);
        return more ? 1 : 0;
    }
    __except (EXCEPTION_EXECUTE_HANDLER) {
        return -1;
    }
}

// Inner helper: does the actual C++ work (may throw C++ exceptions, has objects with dtors)
static juce::AudioPluginInstance* createInstanceInner (
    juce::AudioPluginFormatManager* mgr,
    const juce::PluginDescription* desc,
    double sampleRate, int blockSize,
    juce::String* errorMsg)
{
    auto result = mgr->createPluginInstance (*desc, sampleRate, blockSize, *errorMsg);
    return result.release();
}

// Outer SEH wrapper: catches hardware faults. No C++ objects here — only a function call.
#pragma warning(push)
#pragma warning(disable: 4611)  // interaction between setjmp and C++ object destruction
static bool sehCreateInstance (
    juce::AudioPluginFormatManager* mgr,
    const juce::PluginDescription* desc,
    double sampleRate, int blockSize,
    juce::String* errorMsg,
    juce::AudioPluginInstance** outRaw)
{
    __try {
        *outRaw = createInstanceInner (mgr, desc, sampleRate, blockSize, errorMsg);
        return true;
    }
    __except (EXCEPTION_EXECUTE_HANDLER) {
        *outRaw = nullptr;
        return false;
    }
}
#pragma warning(pop)

// SEH wrapper for setStateInformation — some plugins crash on malformed state data
static bool sehSetState (juce::AudioPluginInstance* instance, const void* data, int size)
{
    __try {
        instance->setStateInformation (data, size);
        return true;
    }
    __except (EXCEPTION_EXECUTE_HANDLER) {
        return false;
    }
}

// SEH wrapper for releaseResources — some plugins crash during cleanup
bool sehReleaseResources (juce::AudioPluginInstance* instance)
{
    __try {
        instance->releaseResources();
        return true;
    }
    __except (EXCEPTION_EXECUTE_HANDLER) {
        return false;
    }
}

// SEH wrapper for plugin instance destruction — some plugins crash in their
// destructor (e.g. GPU surface cleanup, COM shutdown). C++ try-catch cannot
// catch access violations — only __try/__except can.
// Takes a raw pointer and deletes it inside the SEH guard.
bool sehDestroyInstance (juce::AudioPluginInstance* rawInstance)
{
    __try {
        delete rawInstance;
        return true;
    }
    __except (EXCEPTION_EXECUTE_HANDLER) {
        // The instance leaked, but the host process survives.
        return false;
    }
}
#endif

std::vector<ScannedPlugin> ModularRandomizerAudioProcessor::scanForPlugins (
    const juce::StringArray& paths)
{
    std::vector<ScannedPlugin> results;
    juce::StringArray seen;

    LOG_TO_FILE ("scanForPlugins: filesystem scan + knownPlugins enrichment");

    // Phase 1: Fast filesystem scan for immediate results
    for (const auto& scanDir : paths)
    {
        juce::File dir (scanDir);
        if (! dir.isDirectory())
        {
            LOG_TO_FILE ("  Skipping (not a directory): " << scanDir.toStdString());
            continue;
        }

        LOG_TO_FILE ("  Scanning directory: " << scanDir.toStdString());

        auto vst3Items = dir.findChildFiles (
            juce::File::findFilesAndDirectories, true, "*.vst3");

        for (const auto& item : vst3Items)
        {
            auto fullPath = item.getFullPathName();
            if (fullPath.contains ("Contents")) continue;
            if (seen.contains (fullPath)) continue;
            seen.add (fullPath);

            ScannedPlugin sp;
            sp.name = item.getFileNameWithoutExtension();
            sp.path = fullPath;
            sp.format = "VST3";
            sp.category = "fx";
            sp.vendor = item.getParentDirectory().getFileName();
            if (sp.vendor == dir.getFileName()) sp.vendor = "";

            results.push_back (sp);
        }
    }

    // Phase 1.5: Deep scan via PluginDirectoryScanner to populate knownPlugins
    // with real metadata (isInstrument, category, manufacturerName).
    // Cache results to disk to avoid rescanning on every rebuild/restart.
    auto cacheFile = juce::File::getSpecialLocation (juce::File::userApplicationDataDirectory)
        .getChildFile ("Noizefield/ModularRandomizer/known_plugins.xml");

    bool cacheLoaded = false;
    if (cacheFile.existsAsFile())
    {
        auto xml = juce::parseXML (cacheFile);
        if (xml != nullptr)
        {
            knownPlugins.recreateFromXml (*xml);
            cacheLoaded = knownPlugins.getNumTypes() > 0;
            if (cacheLoaded)
            {
                LOG_TO_FILE ("  Loaded " << knownPlugins.getNumTypes()
                             << " plugins from cache (skipping deep scan)");
                // Brief progress flash so UI sees "Loaded from cache"
                { std::lock_guard<std::mutex> lk (scanProgressMutex);
                  scanProgressName = "Loaded from cache"; }
                scanProgressFraction.store (1.0f);
            }
        }
    }

    if (!cacheLoaded)
    {
        // No valid cache — do the full deep scan with per-file progress
        scanActive.store (true);
#ifdef _WIN32
        CoInitializeEx (nullptr, COINIT_APARTMENTTHREADED);
#endif
        for (int fi = 0; fi < formatManager.getNumFormats(); ++fi)
        {
            auto* format = formatManager.getFormat (fi);
            juce::FileSearchPath searchPath;
            for (const auto& dir : paths)
                searchPath.add (juce::File (dir));

            juce::PluginDirectoryScanner scanner (
                knownPlugins, *format, searchPath,
                true,  // recursive
                juce::File()
            );

            juce::String name;
            int scannedCount = 0;
            bool scanning = true;
            while (scanning)
            {
                try
                {
#ifdef _WIN32
                    int r = sehScanOneFile (&scanner, &name);
                    if (r <= 0)
                    {
                        if (r < 0)
                            LOG_TO_FILE ("  SEH FAULT during deep scan of: "
                                         << name.toStdString());
                        scanning = false;
                    }
#else
                    scanning = scanner.scanNextFile (true, name);
#endif
                }
                catch (...)
                {
                    LOG_TO_FILE ("  EXCEPTION during deep scan of: "
                                 << name.toStdString());
                    scanning = false;
                }

                ++scannedCount;
                // Update progress for UI polling
                float prog = scanner.getProgress();
                { std::lock_guard<std::mutex> lk (scanProgressMutex);
                  scanProgressName = name; }
                scanProgressFraction.store (prog);

                if (scannedCount % 20 == 0)
                    LOG_TO_FILE ("  Deep scan progress: " << scannedCount
                                 << " files (" << (int)(prog * 100) << "%)");
            }
            LOG_TO_FILE ("  Format '" << format->getName().toStdString()
                         << "': scanned " << scannedCount << " files");
        }
#ifdef _WIN32
        CoUninitialize();
#endif

        scanActive.store (false);
        scanProgressFraction.store (1.0f);
        { std::lock_guard<std::mutex> lk (scanProgressMutex);
          scanProgressName = "Done"; }

        // Save cache to disk for next time
        if (knownPlugins.getNumTypes() > 0)
        {
            auto xml = knownPlugins.createXml();
            if (xml != nullptr)
            {
                cacheFile.getParentDirectory().createDirectory();
                xml->writeTo (cacheFile);
                LOG_TO_FILE ("  Saved plugin cache: " << knownPlugins.getNumTypes() << " types");
            }
        }
    }
    LOG_TO_FILE ("  Known plugins: " << knownPlugins.getNumTypes() << " types available");

    // Phase 2: Enrich filesystem results with real metadata from knownPlugins
    // (populated by Phase 1.5 deep scan above)
    for (auto& sp : results)
    {
        auto pluginFileName = juce::File (sp.path).getFileNameWithoutExtension();

        for (const auto& desc : knownPlugins.getTypes())
        {
            if (desc.fileOrIdentifier == sp.path
                || desc.fileOrIdentifier.containsIgnoreCase (pluginFileName))
            {
                // Overwrite with real metadata
                sp.name = desc.name;
                sp.vendor = desc.manufacturerName;
                sp.format = desc.pluginFormatName;

                // Classify using PluginDescription metadata
                if (desc.isInstrument)
                    sp.category = "synth";
                else if (desc.category.containsIgnoreCase ("Instrument")
                      || desc.category.containsIgnoreCase ("Synth")
                      || desc.category.containsIgnoreCase ("Generator"))
                    sp.category = "synth";
                else if (desc.category.containsIgnoreCase ("Sampler"))
                    sp.category = "sampler";
                else if (desc.category.containsIgnoreCase ("Analyzer")
                      || desc.category.containsIgnoreCase ("Tools")
                      || desc.category.containsIgnoreCase ("Mastering")
                      || desc.category.containsIgnoreCase ("Restoration")
                      || desc.category.containsIgnoreCase ("Network"))
                    sp.category = "utility";
                else
                    sp.category = "fx";

                break;
            }
        }
    }

    LOG_TO_FILE ("scanForPlugins complete: " << results.size() << " plugins found ("
                 << knownPlugins.getNumTypes() << " with metadata)");
    return results;
}

void ModularRandomizerAudioProcessor::clearPluginCache()
{
    auto cacheFile = juce::File::getSpecialLocation (juce::File::userApplicationDataDirectory)
        .getChildFile ("Noizefield/ModularRandomizer/known_plugins.xml");
    cacheFile.deleteFile();
    knownPlugins.clear();
    LOG_TO_FILE ("clearPluginCache: cache deleted, next scan will be full");
}

ModularRandomizerAudioProcessor::ScanProgress
ModularRandomizerAudioProcessor::getScanProgress()
{
    ScanProgress sp;
    { std::lock_guard<std::mutex> lk (scanProgressMutex);
      sp.currentPlugin = scanProgressName; }
    sp.progress = scanProgressFraction.load();
    sp.scanning = scanActive.load();
    return sp;
}

// ── Phase 1: Find plugin description (thread-safe, disk I/O only) ──
bool ModularRandomizerAudioProcessor::findPluginDescription (
    const juce::String& pluginPath, juce::PluginDescription& descOut)
{
    auto pluginFileName = juce::File (pluginPath).getFileNameWithoutExtension();

    // Check knownPlugins cache first (fast, no disk I/O)
    for (const auto& d : knownPlugins.getTypes())
    {
        if (d.fileOrIdentifier == pluginPath || d.name == pluginPath
            || d.fileOrIdentifier.containsIgnoreCase (pluginFileName))
        {
            descOut = d;
            return true;
        }
    }

    // Not cached — scan single file (disk I/O)
    LOG_TO_FILE ("  Plugin not in known list, scanning single file...");

    for (int fi = 0; fi < formatManager.getNumFormats(); ++fi)
    {
        auto* format = formatManager.getFormat (fi);
        juce::File pluginFile (pluginPath);
        juce::FileSearchPath singlePath (pluginFile.getParentDirectory().getFullPathName());

        juce::PluginDirectoryScanner scanner (
            knownPlugins, *format, singlePath,
            false, // not recursive
            juce::File()
        );

        juce::String name;
        // SEH + C++ guard: some VST3 factories crash during enumeration
        try
        {
#ifdef _WIN32
            while (true)
            {
                int r = sehScanOneFile (&scanner, &name);
                if (r < 0)
                    LOG_TO_FILE ("  SEH FAULT during plugin scan: " << pluginPath.toStdString());
                if (r <= 0) break;
            }
#else
            while (scanner.scanNextFile (true, name))
            {
                LOG_TO_FILE ("  Single-file scan: " << name.toStdString());
            }
#endif
        }
        catch (...)
        {
            LOG_TO_FILE ("  EXCEPTION during plugin scan: " << pluginPath.toStdString());
        }

        for (const auto& d : knownPlugins.getTypes())
        {
            if (d.fileOrIdentifier == pluginPath
                || d.fileOrIdentifier.containsIgnoreCase (pluginPath)
                || pluginPath.containsIgnoreCase (d.fileOrIdentifier)
                || d.fileOrIdentifier.containsIgnoreCase (pluginFileName))
            {
                descOut = d;
                LOG_TO_FILE ("  Matched: " << d.name.toStdString() << " via " << d.fileOrIdentifier.toStdString());
                return true;
            }
        }
    }

    return false;
}

// ── Phase 2: Instantiate plugin (message thread only — COM requirement) ──
int ModularRandomizerAudioProcessor::instantiatePlugin (const juce::PluginDescription& desc)
{
    juce::String errorMessage;
    std::unique_ptr<juce::AudioPluginInstance> instance;

#ifdef _WIN32
    // SEH guard: some VST3 plugins trigger access violations during
    // factory creation / COM initialization. C++ try-catch doesn't catch
    // hardware faults on Windows — only __try/__except does.
    juce::AudioPluginInstance* rawInstance = nullptr;
    bool sehOk = sehCreateInstance (&formatManager, &desc,
                                    currentSampleRate, currentBlockSize,
                                    &errorMessage, &rawInstance);
    instance.reset (rawInstance);  // Adopt raw pointer into unique_ptr
    if (!sehOk)
    {
        LOG_TO_FILE ("  SEH FAULT during createPluginInstance for: " << desc.name.toStdString());
        return -1;
    }
#else
    try
    {
        instance = formatManager.createPluginInstance (
            desc, currentSampleRate, currentBlockSize, errorMessage);
    }
    catch (...)
    {
        LOG_TO_FILE ("  CRASH during createPluginInstance for: " << desc.name.toStdString());
        return -1;
    }
#endif

    if (instance == nullptr)
    {
        LOG_TO_FILE ("  FAILED to create instance: " << errorMessage.toStdString());
        return -1;
    }

    // Configure bus layout
    bool pluginIsInstrument = desc.isInstrument
        || desc.category.containsIgnoreCase ("Instrument")
        || desc.category.containsIgnoreCase ("Synth")
        || desc.category.containsIgnoreCase ("Generator");

    try
    {
        bool layoutOk = false;

        if (pluginIsInstrument)
        {
            // ── Synth/instrument: try output-only first (no audio input needed) ──
            juce::AudioProcessor::BusesLayout synthLayout;
            synthLayout.outputBuses.add (juce::AudioChannelSet::stereo());

            if (instance->setBusesLayout (synthLayout))
            {
                layoutOk = true;
                LOG_TO_FILE ("  Instrument layout: 0 in, stereo out");
            }
            else
            {
                // Some synths require an input bus even if they don't use it
                juce::AudioProcessor::BusesLayout synthFallback;
                synthFallback.inputBuses.add  (juce::AudioChannelSet::stereo());
                synthFallback.outputBuses.add (juce::AudioChannelSet::stereo());
                if (instance->setBusesLayout (synthFallback))
                {
                    layoutOk = true;
                    LOG_TO_FILE ("  Instrument layout: stereo in (unused), stereo out");
                }
            }
        }

        if (! layoutOk)
        {
            // ── Effect or synth fallback: standard stereo in/out ──
            juce::AudioProcessor::BusesLayout stereoLayout;
            stereoLayout.inputBuses.add  (juce::AudioChannelSet::stereo());
            stereoLayout.outputBuses.add (juce::AudioChannelSet::stereo());

            if (! instance->setBusesLayout (stereoLayout))
            {
                juce::AudioProcessor::BusesLayout monoLayout;
                monoLayout.inputBuses.add  (juce::AudioChannelSet::mono());
                monoLayout.outputBuses.add (juce::AudioChannelSet::mono());

                if (! instance->setBusesLayout (monoLayout))
                {
                    LOG_TO_FILE ("  Plugin rejected stereo and mono layouts, using default");
                }
            }
        }

        int pluginIns  = instance->getTotalNumInputChannels();
        int pluginOuts = instance->getTotalNumOutputChannels();
        instance->setPlayConfigDetails (pluginIns, pluginOuts,
                                         currentSampleRate, currentBlockSize);

        LOG_TO_FILE ("  Configured plugin: " << pluginIns << " in, "
                     << pluginOuts << " out, "
                     << currentSampleRate << " Hz, "
                     << currentBlockSize << " samples"
                     << (pluginIsInstrument ? " [INSTRUMENT]" : ""));
    }
    catch (...)
    {
        LOG_TO_FILE ("  WARNING: exception during bus layout configuration");
    }

    // Prepare the instance
    try
    {
        instance->prepareToPlay (currentSampleRate, currentBlockSize);
    }
    catch (...)
    {
        LOG_TO_FILE ("  CRASH during prepareToPlay for: " << desc.name.toStdString());
        return -1;
    }

    // Create hosted plugin entry
    auto hp = std::make_unique<HostedPlugin>();
    hp->id = ++nextPluginId;
    hp->name = desc.name;
    hp->path = desc.fileOrIdentifier;
    hp->description = desc;
    hp->instance = std::move (instance);
    hp->prepared = true;
    hp->isInstrument = pluginIsInstrument;

    int id = hp->id;
    int paramCount = (int) hp->instance->getParameters().size();

    {
        std::lock_guard<std::mutex> lock (pluginMutex);

        // Safety: if we'd exceed reserved capacity, the push_back would
        // reallocate the vector — which would invalidate any pointers the
        // audio thread holds (it iterates hostedPlugins without the mutex).
        // Reject the load instead of crashing.
        if (hostedPlugins.size() >= hostedPlugins.capacity())
        {
            LOG_TO_FILE ("  REJECTED: plugin vector at capacity (" << hostedPlugins.capacity()
                         << "). Cannot load more plugins safely.");
            // Release the instance gracefully outside the lock
            hp->instance->releaseResources();
            return -1;
        }

        hostedPlugins.push_back (std::move (hp));
        rebuildPluginSlots();
    }

    LOG_TO_FILE ("  Loaded plugin: " << desc.name.toStdString()
                 << " (ID: " << id << ", Params: " << paramCount << ")");

    assignProxySlotsForPlugin (id);

    return id;
}

// ── Convenience wrapper: scan + instantiate (used by setStateInformation) ──
int ModularRandomizerAudioProcessor::loadPlugin (const juce::String& pluginPath)
{
    LOG_TO_FILE ("loadPlugin: " << pluginPath.toStdString());

    juce::PluginDescription desc;
    if (! findPluginDescription (pluginPath, desc))
    {
        LOG_TO_FILE ("  FAILED: Plugin description not found after scan");
        return -1;
    }
    return instantiatePlugin (desc);
}

void ModularRandomizerAudioProcessor::removePlugin (int pluginId)
{
    // This function must ALWAYS succeed — no exceptions, no crashes.
    try
    {
        // 1. Free proxy slots (safe, no mutex needed for proxy array)
        try { freeProxySlotsForPlugin (pluginId); } catch (...) {}

        // 2. Null the instance — audio thread will see nullptr and skip.
        //    Do NOT erase from the vector (audio thread may be iterating it).
        std::unique_ptr<juce::AudioPluginInstance> instanceToDestroy;
        {
            std::lock_guard<std::mutex> lock (pluginMutex);
            for (auto& hp : hostedPlugins)
            {
                if (hp->id == pluginId)
                {
                    // Take ownership — audio thread sees nullptr → skips
                    instanceToDestroy = std::move (hp->instance);
                    hp->prepared = false;
                    hp->crashed = true;
                    hp->id = -1; // tombstone marker
                    break;
                }
            }
            rebuildPluginSlots();

            // 3. Mark any active glides targeting this plugin as expired.
            // The audio thread owns glidePool — we don't erase from here.
            // Setting samplesLeft=0 causes the audio thread to remove them.
            for (int gi = 0; gi < numActiveGlides; ++gi)
            {
                if (glidePool[gi].pluginId == pluginId)
                    glidePool[gi].samplesLeft = 0;
            }
        }

        // 4. Release resources OUTSIDE the mutex (some plugins do blocking I/O)
        //    SEH-guarded: some plugins crash during releaseResources or their destructor.
        //    C++ try-catch cannot catch Access Violations — only SEH can.
        if (instanceToDestroy)
        {
#ifdef _WIN32
            sehReleaseResources (instanceToDestroy.get());
            // Release ownership and destroy under SEH guard
            sehDestroyInstance (instanceToDestroy.release());
#else
            try { instanceToDestroy->releaseResources(); } catch (...) {}
            // instanceToDestroy destroyed here by unique_ptr dtor
#endif
        }

        DBG ("Removed plugin ID: " + juce::String (pluginId));
    }
    catch (...)
    {
        DBG ("removePlugin: exception caught and swallowed for plugin ID " + juce::String (pluginId));
    }
}

// Garbage-collect dead plugin entries (id == -1). Call from message thread only.
void ModularRandomizerAudioProcessor::purgeDeadPlugins()
{
    std::lock_guard<std::mutex> lock (pluginMutex);
    hostedPlugins.erase (
        std::remove_if (hostedPlugins.begin(), hostedPlugins.end(),
            [] (const std::unique_ptr<HostedPlugin>& hp) { return hp->id < 0; }),
        hostedPlugins.end());
    rebuildPluginSlots();
}

void ModularRandomizerAudioProcessor::reorderPlugins (const std::vector<int>& orderedIds)
{
    std::lock_guard<std::mutex> lock (pluginMutex);

    // In-place reorder using swaps — the vector's size and allocation never change,
    // so the audio thread's iteration remains safe (no iterator invalidation).
    for (size_t targetPos = 0; targetPos < orderedIds.size() && targetPos < hostedPlugins.size(); ++targetPos)
    {
        int wantedId = orderedIds[targetPos];

        // Find which position currently holds the wanted ID
        size_t foundPos = targetPos;
        for (size_t j = targetPos; j < hostedPlugins.size(); ++j)
        {
            if (hostedPlugins[j] && hostedPlugins[j]->id == wantedId)
            {
                foundPos = j;
                break;
            }
        }

        // Swap into correct position (std::swap on unique_ptr is just pointer swap)
        if (foundPos != targetPos)
            std::swap (hostedPlugins[targetPos], hostedPlugins[foundPos]);
    }
    rebuildPluginSlots();
}

std::vector<ModularRandomizerAudioProcessor::ParamInfo>
ModularRandomizerAudioProcessor::getHostedParams (int pluginId)
{
    std::vector<ParamInfo> result;
    std::lock_guard<std::mutex> lock (pluginMutex);

    for (auto& hp : hostedPlugins)
    {
        if (hp->id == pluginId && hp->instance != nullptr)
        {
            auto& params = hp->instance->getParameters();
            for (int i = 0; i < params.size(); ++i)
            {
                auto* p = params[i];

                // Skip non-automatable parameters
                if (! p->isAutomatable())
                    continue;

                // Skip VST3 internal MIDI CC / Aftertouch / Pitchbend parameters
                auto name = p->getName (64);
                if (name.startsWith ("MIDI CC")
                    || name.startsWith ("Aftertouch")
                    || name.startsWith ("Pitchbend"))
                    continue;

                ParamInfo info;
                info.index = i;
                info.name = name;
                info.value = p->getValue(); // normalised 0-1
                info.label = p->getLabel();
                info.displayText = p->getText (p->getValue(), 32);
                info.automatable = true;
                result.push_back (info);
            }
            break;
        }
    }
    return result;
}

std::vector<ModularRandomizerAudioProcessor::FactoryPresetInfo>
ModularRandomizerAudioProcessor::getFactoryPresets (int pluginId)
{
    std::vector<FactoryPresetInfo> result;
    juce::String pluginName;
    juce::String vendorName;
    juce::String pluginPath;

    {
        std::lock_guard<std::mutex> lock (pluginMutex);

        for (auto& hp : hostedPlugins)
        {
            if (hp->id == pluginId && hp->instance != nullptr)
            {
                pluginName = hp->name;
                vendorName = hp->description.manufacturerName;
                pluginPath = hp->path;

                // ── Strategy 1: Plugin program list ──
                int numPrograms = hp->instance->getNumPrograms();
                LOG_TO_FILE ("getFactoryPresets: plugin '" << hp->name.toStdString()
                             << "' id=" << pluginId
                             << " numPrograms=" << numPrograms);

                bool hasRealPrograms = false;
                if (numPrograms >= 1)
                {
                    // Sample first few program names to check for generic placeholders
                    int samplesToCheck = juce::jmin (numPrograms, 5);
                    int genericCount = 0;
                    for (int si = 0; si < samplesToCheck; ++si)
                    {
                        auto sname = hp->instance->getProgramName (si).trim();
                        if (sname.isEmpty() || sname == "Default" || sname == "Init"
                            || sname == "default" || sname == "init")
                        {
                            genericCount++;
                            continue;
                        }
                        // Check generic patterns
                        if (sname.startsWith ("ProgramChange ") || sname.startsWith ("Program ")
                            || sname.startsWith ("Preset ") || sname.startsWith ("Prog ")
                            || sname.startsWith ("Bank ") || sname.startsWith ("Patch "))
                        {
                            auto suffix = sname.fromFirstOccurrenceOf (" ", false, false).trim();
                            if (suffix.containsOnly ("0123456789"))
                                genericCount++;
                        }
                    }
                    // If most samples are NOT generic, treat as real programs
                    hasRealPrograms = (genericCount < samplesToCheck);
                }

                if (hasRealPrograms)
                {
                    juce::StringArray seenNames;
                    for (int i = 0; i < numPrograms; ++i)
                    {
                        auto name = hp->instance->getProgramName (i).trim();
                        if (name.isEmpty()) continue;
                        // Skip generic numbered names
                        if (name.startsWith ("Program ") || name.startsWith ("Preset ")
                            || name.startsWith ("ProgramChange ") || name.startsWith ("Prog ")
                            || name.startsWith ("Bank ") || name.startsWith ("Patch "))
                        {
                            auto suffix = name.fromFirstOccurrenceOf (" ", false, false).trim();
                            if (suffix.containsOnly ("0123456789"))
                                continue;
                        }
                        // Skip duplicates (some plugins return same name for all slots)
                        if (seenNames.contains (name, true)) continue;
                        seenNames.add (name);
                        result.push_back ({ i, name });
                    }
                }
                break;
            }
        }
    }

    // ── Strategy 2: Use the pre-built preset index ──
    if (result.empty() && pluginName.isNotEmpty() && presetIndexReady.load())
    {
        result = getIndexedPresets (pluginName, vendorName);
        LOG_TO_FILE ("getFactoryPresets: index lookup for '" << pluginName.toStdString()
                     << "' returned " << result.size() << " presets");
    }

    return result;
}

std::vector<ModularRandomizerAudioProcessor::ParamInfo>
ModularRandomizerAudioProcessor::loadFactoryPreset (int pluginId, int programIndex)
{
    {
        std::lock_guard<std::mutex> lock (pluginMutex);
        for (auto& hp : hostedPlugins)
        {
            if (hp->id == pluginId && hp->instance != nullptr)
            {
                hp->instance->setCurrentProgram (programIndex);
                break;
            }
        }
    }
    // Return updated param values (reuses existing getHostedParams logic)
    return getHostedParams (pluginId);
}

std::vector<ModularRandomizerAudioProcessor::ParamInfo>
ModularRandomizerAudioProcessor::loadFactoryPresetFromFile (int pluginId, const juce::String& filePath)
{
    juce::File presetFile (filePath);
    if (! presetFile.existsAsFile())
    {
        LOG_TO_FILE ("loadFactoryPresetFromFile: file not found: " << filePath.toStdString());
        return getHostedParams (pluginId);
    }

    juce::MemoryBlock fileData;
    if (! presetFile.loadFileAsData (fileData))
    {
        LOG_TO_FILE ("loadFactoryPresetFromFile: failed to read file");
        return getHostedParams (pluginId);
    }

    // ── Parse .vstpreset binary format ──
    // Header: "VST3"(4) + version(4) + classID(32) + chunkListOffset(8) = 48 bytes
    // Chunk list: "List"(4) + count(4) + entries(each: id(4) + offset(8) + size(8) = 20)
    juce::MemoryBlock compState, contState;
    bool parsed = false;

    auto* raw = static_cast<const uint8_t*> (fileData.getData());
    auto fileSize = (int64_t) fileData.getSize();

    if (fileSize >= 48 && raw[0] == 'V' && raw[1] == 'S' && raw[2] == 'T' && raw[3] == '3')
    {
        int64_t chunkListOffset = 0;
        std::memcpy (&chunkListOffset, raw + 40, 8);

        if (chunkListOffset > 0 && chunkListOffset + 8 <= fileSize)
        {
            auto* listPtr = raw + chunkListOffset;
            if (listPtr[0] == 'L' && listPtr[1] == 'i' && listPtr[2] == 's' && listPtr[3] == 't')
            {
                int32_t entryCount = 0;
                std::memcpy (&entryCount, listPtr + 4, 4);

                for (int32_t i = 0; i < entryCount && i < 16; ++i)
                {
                    auto* entry = listPtr + 8 + (i * 20);
                    if (entry + 20 > raw + fileSize) break;

                    char chunkId[5] = {};
                    std::memcpy (chunkId, entry, 4);
                    int64_t chunkOffset = 0, chunkSize = 0;
                    std::memcpy (&chunkOffset, entry + 4, 8);
                    std::memcpy (&chunkSize, entry + 12, 8);

                    if (chunkOffset >= 0 && chunkSize > 0 && chunkOffset + chunkSize <= fileSize)
                    {
                        if (std::strcmp (chunkId, "Comp") == 0)
                        {
                            compState.setSize ((size_t) chunkSize);
                            std::memcpy (compState.getData(), raw + chunkOffset, (size_t) chunkSize);
                        }
                        else if (std::strcmp (chunkId, "Cont") == 0)
                        {
                            contState.setSize ((size_t) chunkSize);
                            std::memcpy (contState.getData(), raw + chunkOffset, (size_t) chunkSize);
                        }
                    }
                }
                parsed = compState.getSize() > 0;
            }
        }
    }

    {
        std::lock_guard<std::mutex> lock (pluginMutex);
        for (auto& hp : hostedPlugins)
        {
            if (hp->id == pluginId && hp->instance != nullptr)
            {
                if (parsed)
                {
                    // JUCE's VST3 setStateInformation expects XML wrapped data:
                    //   <VST3PluginState>
                    //     <IComponent>[base64 comp state]</IComponent>
                    //     <IEditController>[base64 controller state]</IEditController>
                    //   </VST3PluginState>
                    // Then converted to binary via AudioProcessor::copyXmlToBinary()
                    juce::XmlElement state ("VST3PluginState");
                    state.createNewChildElement ("IComponent")->addTextElement (compState.toBase64Encoding());
                    if (contState.getSize() > 0)
                        state.createNewChildElement ("IEditController")->addTextElement (contState.toBase64Encoding());

                    juce::MemoryBlock juceState;
                    juce::AudioProcessor::copyXmlToBinary (state, juceState);

                    LOG_TO_FILE ("loadFactoryPresetFromFile: applying vstpreset '"
                                 << presetFile.getFileName().toStdString()
                                 << "' comp=" << compState.getSize()
                                 << " cont=" << contState.getSize()
                                 << " juceWrapped=" << juceState.getSize() << " bytes");

                    sehSetState (hp->instance.get(), juceState.getData(), (int) juceState.getSize());
                }
                else
                {
                    // Non-VST3 format (.fxp etc.) — try raw data
                    LOG_TO_FILE ("loadFactoryPresetFromFile: trying raw data for '"
                                 << presetFile.getFileName().toStdString()
                                 << "' (" << fileData.getSize() << " bytes)");
                    sehSetState (hp->instance.get(), fileData.getData(), (int) fileData.getSize());
                }
                break;
            }
        }
    }
    return getHostedParams (pluginId);
}

// ============================================================
// PRESET INDEX — Bitwig-style scan-all-directories approach
// ============================================================

juce::File ModularRandomizerAudioProcessor::getPresetIndexFile() const
{
    return juce::File::getSpecialLocation (juce::File::userApplicationDataDirectory)
        .getChildFile ("Noizefield/ModularRandomizer/preset_index.json");
}

void ModularRandomizerAudioProcessor::buildPresetIndex()
{
    LOG_TO_FILE ("buildPresetIndex: starting...");
    auto startTime = juce::Time::getMillisecondCounterHiRes();

    // Try loading from disk cache first
    if (loadPresetIndexFromFile())
    {
        LOG_TO_FILE ("buildPresetIndex: loaded from cache");
        presetIndexReady.store (true);
        return;
    }

    // Scan all standard VST3 preset directories
    juce::Array<juce::File> rootDirs;

    auto appData = juce::File::getSpecialLocation (juce::File::userApplicationDataDirectory);
    rootDirs.add (appData.getChildFile ("VST3 Presets"));

#if JUCE_WINDOWS
    auto commonFiles = juce::File ("C:\\Program Files\\Common Files");
    rootDirs.add (commonFiles.getChildFile ("VST3 Presets"));
#elif JUCE_MAC
    rootDirs.add (juce::File ("/Library/Audio/Presets"));
    rootDirs.add (juce::File::getSpecialLocation (juce::File::userHomeDirectory)
                      .getChildFile ("Library/Audio/Presets"));
#elif JUCE_LINUX
    rootDirs.add (juce::File::getSpecialLocation (juce::File::userHomeDirectory)
                      .getChildFile (".vst3/presets"));
#endif

    auto docsDir = juce::File::getSpecialLocation (juce::File::userDocumentsDirectory);
    rootDirs.add (docsDir.getChildFile ("VST3 Presets"));

    // Also scan vendor-specific directories commonly used
    // Walk %APPDATA% top-level for vendored preset folders
    auto appDataChildren = appData.findChildFiles (juce::File::findDirectories, false);
    for (const auto& vendorDir : appDataChildren)
    {
        // Check if this vendor dir has Presets subdirectories
        auto subDirs = vendorDir.findChildFiles (juce::File::findDirectories, false);
        for (const auto& sub : subDirs)
        {
            if (sub.getFileName().containsIgnoreCase ("Preset"))
            {
                rootDirs.addIfNotAlreadyThere (sub);
            }
            // Check inside plugin-named folders for Presets
            auto presetsSub = sub.getChildFile ("Presets");
            if (presetsSub.isDirectory())
                rootDirs.addIfNotAlreadyThere (presetsSub);
        }
    }

    // Scan inside installed VST3 bundles
    juce::Array<juce::File> vst3Dirs;
    vst3Dirs.add (commonFiles.getChildFile ("VST3"));
    for (const auto& vst3Dir : vst3Dirs)
    {
        if (! vst3Dir.isDirectory()) continue;
        auto bundles = vst3Dir.findChildFiles (juce::File::findDirectories, true, "*.vst3");
        for (const auto& bundle : bundles)
        {
            auto resourcesDir = bundle.getChildFile ("Contents").getChildFile ("Resources");
            if (resourcesDir.isDirectory())
                rootDirs.addIfNotAlreadyThere (resourcesDir);
        }
    }

    // Build the index
    std::map<juce::String, std::vector<FactoryPresetInfo>> newIndex;
    int totalFiles = 0;

    for (const auto& rootDir : rootDirs)
    {
        if (! rootDir.isDirectory()) continue;

        // Find all preset files recursively
        auto vstPresets = rootDir.findChildFiles (juce::File::findFiles, true, "*.vstpreset");
        auto fxpPresets = rootDir.findChildFiles (juce::File::findFiles, true, "*.fxp");

        auto processFiles = [&] (const juce::Array<juce::File>& files)
        {
            for (const auto& f : files)
            {
                // Determine plugin name from directory structure
                // Typical: VST3 Presets/<Vendor>/<PluginName>/[subfolder/]preset.vstpreset
                // Or: <Vendor>/<PluginName>/Presets/preset.vstpreset
                auto relativePath = f.getRelativePathFrom (rootDir);
                auto parts = juce::StringArray::fromTokens (relativePath, "\\/", "");

                juce::String pluginKey;
                if (parts.size() >= 3)
                {
                    // Vendor/Plugin/... → key = "plugin" (lowercase)
                    pluginKey = parts[1].toLowerCase();
                }
                else if (parts.size() >= 2)
                {
                    // Plugin/preset.vstpreset → key = directory name
                    pluginKey = parts[0].toLowerCase();
                }
                else
                {
                    // Just a file at root level — use parent dir name
                    pluginKey = rootDir.getFileName().toLowerCase();
                }

                if (pluginKey.isEmpty()) continue;

                auto presetName = f.getFileNameWithoutExtension();

                // Skip duplicates within the same plugin
                bool dupe = false;
                auto& existing = newIndex[pluginKey];
                for (const auto& e : existing)
                {
                    if (e.name.equalsIgnoreCase (presetName))
                    {
                        dupe = true;
                        break;
                    }
                }
                if (dupe) continue;

                int idx = -((int)existing.size() + 1);
                existing.push_back ({ idx, presetName, f.getFullPathName() });
                totalFiles++;
            }
        };

        processFiles (vstPresets);
        processFiles (fxpPresets);
    }

    LOG_TO_FILE ("buildPresetIndex: scanned " << totalFiles << " preset files across "
                 << newIndex.size() << " plugins in "
                 << (int)(juce::Time::getMillisecondCounterHiRes() - startTime) << "ms");

    {
        std::lock_guard<std::mutex> lock (presetIndexMutex);
        presetIndex = std::move (newIndex);
    }

    savePresetIndexToFile();
    presetIndexReady.store (true);
}

std::vector<ModularRandomizerAudioProcessor::FactoryPresetInfo>
ModularRandomizerAudioProcessor::getIndexedPresets (const juce::String& pluginName, const juce::String& vendorName)
{
    std::lock_guard<std::mutex> lock (presetIndexMutex);

    auto key = pluginName.toLowerCase();

    // Exact match
    auto it = presetIndex.find (key);
    if (it != presetIndex.end() && ! it->second.empty())
        return it->second;

    // Fuzzy match: check if any key contains the plugin name or vice versa
    for (auto& [k, v] : presetIndex)
    {
        if (k.contains (key) || key.contains (k))
        {
            if (! v.empty())
                return v;
        }
    }

    // Try vendor + plugin combination
    if (vendorName.isNotEmpty())
    {
        auto vendorKey = vendorName.toLowerCase();
        for (auto& [k, v] : presetIndex)
        {
            if (k.contains (key) || (k.contains (vendorKey) && ! v.empty()))
                return v;
        }
    }

    return {};
}

void ModularRandomizerAudioProcessor::savePresetIndexToFile()
{
    std::lock_guard<std::mutex> lock (presetIndexMutex);

    auto indexFile = getPresetIndexFile();
    indexFile.getParentDirectory().createDirectory();

    auto* root = new juce::DynamicObject();
    root->setProperty ("version", 1);
    root->setProperty ("timestamp", juce::Time::currentTimeMillis());

    auto* plugins = new juce::DynamicObject();
    for (auto& [pluginKey, presets] : presetIndex)
    {
        juce::Array<juce::var> presetArr;
        for (const auto& p : presets)
        {
            auto* pObj = new juce::DynamicObject();
            pObj->setProperty ("name", p.name);
            pObj->setProperty ("filePath", p.filePath);
            presetArr.add (juce::var (pObj));
        }
        plugins->setProperty (pluginKey, juce::var (presetArr));
    }
    root->setProperty ("plugins", juce::var (plugins));

    auto json = juce::JSON::toString (juce::var (root));
    indexFile.replaceWithText (json);

    LOG_TO_FILE ("savePresetIndexToFile: saved " << presetIndex.size() << " plugins to " << indexFile.getFullPathName().toStdString());
}

bool ModularRandomizerAudioProcessor::loadPresetIndexFromFile()
{
    auto indexFile = getPresetIndexFile();
    if (! indexFile.existsAsFile())
        return false;

    // Check if the file is less than 24 hours old
    auto fileAge = juce::Time::getCurrentTime() - indexFile.getLastModificationTime();
    if (fileAge.inHours() > 24)
    {
        LOG_TO_FILE ("loadPresetIndexFromFile: cache expired (age=" << (int)fileAge.inHours() << "h)");
        return false;
    }

    auto json = juce::JSON::parse (indexFile.loadFileAsString());
    if (! json.isObject())
        return false;

    auto* root = json.getDynamicObject();
    if (! root) return false;

    auto pluginsVar = root->getProperty ("plugins");
    if (! pluginsVar.isObject()) return false;

    auto* plugins = pluginsVar.getDynamicObject();
    if (! plugins) return false;

    std::map<juce::String, std::vector<FactoryPresetInfo>> newIndex;

    for (auto& prop : plugins->getProperties())
    {
        auto pluginKey = prop.name.toString();
        auto presetsArr = prop.value;
        if (! presetsArr.isArray()) continue;

        std::vector<FactoryPresetInfo> presets;
        for (int i = 0; i < presetsArr.size(); ++i)
        {
            auto pVar = presetsArr[i];
            if (! pVar.isObject()) continue;
            auto* pObj = pVar.getDynamicObject();
            if (! pObj) continue;

            auto name = pObj->getProperty ("name").toString();
            auto filePath = pObj->getProperty ("filePath").toString();
            presets.push_back ({ -(i + 1), name, filePath });
        }

        if (! presets.empty())
            newIndex[pluginKey] = std::move (presets);
    }

    {
        std::lock_guard<std::mutex> lock (presetIndexMutex);
        presetIndex = std::move (newIndex);
    }

    LOG_TO_FILE ("loadPresetIndexFromFile: loaded " << presetIndex.size() << " plugins from cache");
    return true;
}

void ModularRandomizerAudioProcessor::setHostedParam (int pluginId, int paramIndex, float normValue)
{
    // O(1) lookup via pluginSlots — no linear scan needed
    int slot = slotForId (pluginId);
    if (slot >= 0)
    {
        auto* hp = pluginSlots[slot];
        if (hp && hp->id == pluginId && hp->instance != nullptr)
        {
            auto& params = hp->instance->getParameters();
            if (paramIndex >= 0 && paramIndex < params.size())
            {
                params[paramIndex]->setValue (normValue);
                recordSelfWrite (pluginId, paramIndex);
                updateParamBase (pluginId, paramIndex, normValue);
            }
        }
    }
}

void ModularRandomizerAudioProcessor::startGlide (int pluginId, int paramIndex,
                                                    float targetValue, float durationMs)
{
    // Write to lock-free FIFO â€” safe to call from message thread
    GlideCommand cmd { pluginId, paramIndex, targetValue, durationMs };
    const auto scope = glideFifo.write (1);
    if (scope.blockSize1 > 0)
        glideRing[scope.startIndex1] = cmd;
    else if (scope.blockSize2 > 0)
        glideRing[scope.startIndex2] = cmd;
    // If FIFO is full, command is silently dropped (very unlikely with 512 slots)
}

//==============================================================================
// Proxy Parameter Pool â€” DAW automation bridge
//==============================================================================

void ModularRandomizerAudioProcessor::assignProxySlotsForPlugin (int pluginId)
{
    std::lock_guard<std::mutex> lock (pluginMutex);

    // Find the hosted plugin and assign proxy slots for each of its params
    HostedPlugin* target = nullptr;
    for (auto& hp : hostedPlugins)
    {
        if (hp->id == pluginId)
        {
            target = hp.get();
            break;
        }
    }
    if (target == nullptr || target->instance == nullptr) return;

    auto& hostedParams = target->instance->getParameters();
    int slot = 0;

    for (int pi = 0; pi < (int) hostedParams.size(); ++pi)
    {
        // Find next free proxy slot (skips block-occupied slots)
        while (slot < proxyParamCount && !proxyMap[slot].isFree())
            ++slot;
        if (slot >= proxyParamCount) break; // pool exhausted

        proxyMap[slot].pluginId   = pluginId;
        proxyMap[slot].paramIndex = pi;

        // Set proxy value to match hosted param (suppress feedback)
        if (proxyParams[slot] != nullptr)
        {
            // Set dynamic name: "PluginName: ParamName"
            auto paramName = hostedParams[pi]->getName (128);
            proxyParams[slot]->setDynamicName (target->name + ": " + paramName);

            proxySyncActive.store (true);
            proxyParams[slot]->setValueNotifyingHost (hostedParams[pi]->getValue());
            proxySyncActive.store (false);
        }
        ++slot;
    }

    // Notify host that parameter info changed (name/value updates)
    updateHostDisplay (juce::AudioProcessor::ChangeDetails{}.withParameterInfoChanged (true));
}

void ModularRandomizerAudioProcessor::freeProxySlotsForPlugin (int pluginId)
{
    for (int i = 0; i < proxyParamCount; ++i)
    {
        if (proxyMap[i].pluginId == pluginId)
        {
            proxyMap[i].clear();

            // Reset proxy value and name
            if (proxyParams[i] != nullptr)
            {
                proxyParams[i]->setDynamicName (juce::String ("Slot ") + juce::String (i + 1));
                proxyParams[i]->clearDisplayInfo();
                proxySyncActive.store (true);
                proxyParams[i]->setValueNotifyingHost (0.0f);
                proxySyncActive.store (false);
            }
        }
    }

    updateHostDisplay (juce::AudioProcessor::ChangeDetails{}.withParameterInfoChanged (true));
}

void ModularRandomizerAudioProcessor::parameterChanged (const juce::String& parameterID, float newValue)
{
    // Ignore sync-back writes (processBlock → proxy)
    if (proxySyncActive.load()) return;

    // Only handle unified proxy params (AP_NNNN)
    if (! parameterID.startsWith ("AP_")) return;

    int slot = parameterID.substring (3).getIntValue();
    if (slot < 0 || slot >= proxyParamCount) return;

    auto& m = proxyMap[slot];

    if (m.isBlock())
    {
        // Block param — store value for editor timer to forward to JS
        proxyValueCache[slot].store (newValue);
        blockProxyDirty.store (true);
        return;
    }

    if (! m.isPlugin()) return;

    // Forward to hosted plugin
    std::lock_guard<std::mutex> lock (pluginMutex);
    for (auto& hp : hostedPlugins)
    {
        if (hp->id == m.pluginId && hp->instance != nullptr)
        {
            auto& params = hp->instance->getParameters();
            if (m.paramIndex >= 0 && m.paramIndex < (int) params.size())
            {
                params[m.paramIndex]->setValue (newValue);
                recordSelfWrite (m.pluginId, m.paramIndex);
            }
            break;
        }
    }
}

//==============================================================================
// Expose State — Selective proxy slot management
//==============================================================================

void ModularRandomizerAudioProcessor::updateExposeState (const juce::String& jsonData)
{
    auto parsed = juce::JSON::parse (jsonData);
    if (! parsed.isObject()) return;

    auto* root = parsed.getDynamicObject();
    if (! root) return;

    // ── Handle plugin expose state ──
    auto pluginsVar = root->getProperty ("plugins");
    if (pluginsVar.isObject())
    {
        auto* pluginsObj = pluginsVar.getDynamicObject();
        if (pluginsObj)
        {
            for (auto& prop : pluginsObj->getProperties())
            {
                int pluginId = prop.name.toString().getIntValue();
                auto* pState = prop.value.getDynamicObject();
                if (! pState) continue;

                bool exposed = pState->getProperty ("exposed");
                auto excludedVar = pState->getProperty ("excluded");

                // Build excluded set
                std::unordered_set<int> excludedParams;
                if (excludedVar.isArray())
                {
                    for (int i = 0; i < excludedVar.size(); ++i)
                        excludedParams.insert ((int) excludedVar[i]);
                }

                if (! exposed)
                {
                    // Unexpose entire plugin — free all its proxy slots
                    freeProxySlotsForPlugin (pluginId);
                }
                else if (! excludedParams.empty())
                {
                    // Selectively free excluded params
                    for (int i = 0; i < proxyParamCount; ++i)
                    {
                        if (proxyMap[i].pluginId == pluginId
                            && excludedParams.count (proxyMap[i].paramIndex) > 0)
                        {
                            // Free this specific slot
                            proxyMap[i].clear();
                            if (proxyParams[i] != nullptr)
                            {
                                proxyParams[i]->setDynamicName (juce::String ("Slot ") + juce::String (i + 1));
                                proxyParams[i]->clearDisplayInfo();
                                proxySyncActive.store (true);
                                proxyParams[i]->setValueNotifyingHost (0.0f);
                                proxySyncActive.store (false);
                            }
                        }
                    }

                    // Check if any params from this plugin need to be re-assigned
                    // (user may have previously excluded then re-included)
                    std::lock_guard<std::mutex> lock (pluginMutex);
                    HostedPlugin* target = nullptr;
                    for (auto& hp : hostedPlugins)
                    {
                        if (hp->id == pluginId && hp->instance != nullptr)
                        {
                            target = hp.get();
                            break;
                        }
                    }
                    if (target)
                    {
                        auto& hostedParams = target->instance->getParameters();
                        for (int pi = 0; pi < (int) hostedParams.size(); ++pi)
                        {
                            // Skip excluded params
                            if (excludedParams.count (pi) > 0) continue;

                            // Check if already assigned
                            bool alreadyAssigned = false;
                            for (int si = 0; si < proxyParamCount; ++si)
                            {
                                if (proxyMap[si].pluginId == pluginId && proxyMap[si].paramIndex == pi)
                                {
                                    alreadyAssigned = true;
                                    break;
                                }
                            }
                            if (alreadyAssigned) continue;

                            // Find free slot and assign
                            for (int si = 0; si < proxyParamCount; ++si)
                            {
                                if (proxyMap[si].isFree())
                                {
                                    proxyMap[si].pluginId   = pluginId;
                                    proxyMap[si].paramIndex = pi;
                                    if (proxyParams[si] != nullptr)
                                    {
                                        auto paramName = hostedParams[pi]->getName (128);
                                        proxyParams[si]->setDynamicName (target->name + ": " + paramName);
                                        proxySyncActive.store (true);
                                        proxyParams[si]->setValueNotifyingHost (hostedParams[pi]->getValue());
                                        proxySyncActive.store (false);
                                    }
                                    break;
                                }
                            }
                        }
                    }

                    updateHostDisplay (juce::AudioProcessor::ChangeDetails{}.withParameterInfoChanged (true));
                }
            }
        }
    }

    // ── Handle block expose state (unified pool) ──
    auto blocksVar = root->getProperty ("blocks");
    if (blocksVar.isObject())
    {
        auto* blocksObj = blocksVar.getDynamicObject();
        if (blocksObj)
        {
            for (auto& prop : blocksObj->getProperties())
            {
                int blockId = prop.name.toString().getIntValue();
                auto* bState = prop.value.getDynamicObject();
                if (! bState) continue;

                bool exposed = bState->getProperty ("exposed");
                auto excludedVar = bState->getProperty ("excluded");

                std::unordered_set<std::string> excludedKeys;
                if (excludedVar.isArray())
                {
                    for (int i = 0; i < excludedVar.size(); ++i)
                        excludedKeys.insert (excludedVar[i].toString().toStdString());
                }

                auto blockNameVar = bState->getProperty ("name");
                juce::String blockName = blockNameVar.isString() ? blockNameVar.toString()
                                                                  : (juce::String ("Block ") + juce::String (blockId));

                auto paramsVar = bState->getProperty ("params");

                if (! exposed)
                {
                    // Free all unified pool slots for this block
                    for (int i = 0; i < proxyParamCount; ++i)
                    {
                        if (proxyMap[i].blockId == blockId)
                        {
                            proxyMap[i].clear();
                            if (proxyParams[i] != nullptr)
                            {
                                proxyParams[i]->setDynamicName (juce::String ("Slot ") + juce::String (i + 1));
                                proxyParams[i]->clearDisplayInfo();
                                proxySyncActive.store (true);
                                proxyParams[i]->setValueNotifyingHost (0.0f);
                                proxySyncActive.store (false);
                            }
                        }
                    }
                }
                else
                {
                    if (paramsVar.isArray())
                    {
                        for (int pi = 0; pi < paramsVar.size(); ++pi)
                        {
                            auto* paramObj = paramsVar[pi].getDynamicObject();
                            if (! paramObj) continue;

                            auto key = paramObj->getProperty ("key").toString();
                            auto label = paramObj->getProperty ("label").toString();
                            auto type = paramObj->getProperty ("type").toString();

                            if (excludedKeys.count (key.toStdString()) > 0) continue;

                            // Check if already assigned in unified pool
                            bool alreadyAssigned = false;
                            for (int si = 0; si < proxyParamCount; ++si)
                            {
                                if (proxyMap[si].blockId == blockId && proxyMap[si].blockParamKey == key)
                                {
                                    alreadyAssigned = true;
                                    break;
                                }
                            }
                            if (alreadyAssigned) continue;

                            // Find free slot in unified pool
                            for (int si = 0; si < proxyParamCount; ++si)
                            {
                                if (proxyMap[si].isFree())
                                {
                                    proxyMap[si].blockId = blockId;
                                    proxyMap[si].blockParamKey = key;
                                    if (proxyParams[si] != nullptr)
                                    {
                                        proxyParams[si]->setDynamicName (blockName + " - " + label);

                                        // Configure display info based on param type
                                        if (type == "discrete")
                                        {
                                            auto optsVar = paramObj->getProperty ("options");
                                            if (optsVar.isArray())
                                            {
                                                juce::StringArray opts;
                                                for (int oi = 0; oi < optsVar.size(); ++oi)
                                                    opts.add (optsVar[oi].toString());
                                                proxyParams[si]->setDiscreteOptions (opts);
                                            }
                                        }
                                        else if (type == "bool")
                                        {
                                            proxyParams[si]->setDiscreteOptions ({ "Off", "On" });
                                        }
                                        else // float
                                        {
                                            float dispMin = paramObj->getProperty ("min");
                                            float dispMax = paramObj->getProperty ("max");
                                            auto suffix = paramObj->getProperty ("suffix").toString();
                                            proxyParams[si]->setDisplayInfo (suffix, dispMin, dispMax);
                                        }
                                    }
                                    break;
                                }
                            }
                        }
                    }

                    // Free excluded params
                    for (int i = 0; i < proxyParamCount; ++i)
                    {
                        if (proxyMap[i].blockId == blockId
                            && excludedKeys.count (proxyMap[i].blockParamKey.toStdString()) > 0)
                        {
                            proxyMap[i].clear();
                            if (proxyParams[i] != nullptr)
                            {
                                proxyParams[i]->setDynamicName (juce::String ("Slot ") + juce::String (i + 1));
                                proxyParams[i]->clearDisplayInfo();
                                proxySyncActive.store (true);
                                proxyParams[i]->setValueNotifyingHost (0.0f);
                                proxySyncActive.store (false);
                            }
                        }
                    }
                }
            }
        }

        updateHostDisplay (juce::AudioProcessor::ChangeDetails{}.withParameterInfoChanged (true));
    }

    LOG_TO_FILE ("updateExposeState: processed expose state update");
}
