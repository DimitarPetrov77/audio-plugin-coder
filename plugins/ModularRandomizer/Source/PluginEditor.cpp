/*
  ==============================================================================

    Modular Randomizer - PluginEditor
    WebView2-based UI with native function bridge

  ==============================================================================
*/

#include "PluginEditor.h"
#include <unordered_set>
#include <unordered_map>
#include "ParameterIDs.hpp"
#include <BinaryData.h>

//==============================================================================
HostesaAudioProcessorEditor::HostesaAudioProcessorEditor (
    HostesaAudioProcessor& p)
    : AudioProcessorEditor (&p),
      audioProcessor (p)
{
    DBG ("Hostesa: Editor constructor started");

    //==========================================================================
    // CRITICAL: CREATION ORDER (matches CloudWash webview-004 fix)
    // 1. Relays already created (member initialization)
    // 2. Create attachments BEFORE WebView
    // 3. Create WebBrowserComponent with proper JUCE 8 API
    // 4. addAndMakeVisible LAST
    //==========================================================================

    // Create parameter attachments BEFORE creating WebView
    DBG ("Hostesa: Creating parameter attachments");
    mixAttachment = std::make_unique<juce::WebSliderParameterAttachment> (
        *audioProcessor.getAPVTS().getParameter (ParameterIDs::MIX), mixRelay);

    bypassAttachment = std::make_unique<juce::WebToggleButtonParameterAttachment> (
        *audioProcessor.getAPVTS().getParameter (ParameterIDs::BYPASS), bypassRelay);

    // Create WebBrowserComponent with JUCE 8 proper API
    // CRITICAL: Attachments must be created BEFORE this point
    DBG ("Hostesa: Creating WebView");

    // Build base options — platform-specific backend selection
    auto webViewOptions = juce::WebBrowserComponent::Options{}
#if JUCE_WINDOWS
        .withBackend (juce::WebBrowserComponent::Options::Backend::webview2)
        .withWinWebView2Options (
            juce::WebBrowserComponent::Options::WinWebView2{}
                .withUserDataFolder (juce::File::getSpecialLocation (
                    juce::File::SpecialLocationType::tempDirectory))
        )
#endif
        .withNativeIntegrationEnabled()  // CRITICAL: Enable window.__JUCE__ backend
        .withResourceProvider ([this] (const auto& url) { return getResource (url); })
        .withOptionsFrom (mixRelay)
        .withOptionsFrom (bypassRelay)
        .withNativeFunction (
                "scanPlugins",
                [this] (const juce::Array<juce::var>& args,
                        juce::WebBrowserComponent::NativeFunctionCompletion completion)
                {
                    LOG_TO_FILE ("=== scanPlugins native function called, args count: " << args.size());

                    juce::StringArray paths;
                    if (args.size() > 0 && args[0].isArray())
                    {
                        for (int i = 0; i < args[0].size(); ++i)
                            paths.add (args[0][i].toString());
                    }

                    if (paths.isEmpty())
                        paths = HostesaAudioProcessor::getDefaultScanPaths();

                    // Optional: force rescan (deletes cache) if second arg is true
                    bool forceRescan = args.size() > 1 && (bool) args[1];
                    if (forceRescan)
                        audioProcessor.clearPluginCache();

                    LOG_TO_FILE ("  Launching background scan thread..."
                                 << (forceRescan ? " (FORCED, cache cleared)" : ""));

                    // Move completion into a shared_ptr so it can be safely captured
                    auto sharedCompletion = std::make_shared<juce::WebBrowserComponent::NativeFunctionCompletion> (
                        std::move (completion));

                    juce::Thread::launch ([this, paths, sharedCompletion]()
                    {
                        LOG_TO_FILE ("  Background thread: starting scan");
                        auto results = audioProcessor.scanForPlugins (paths);
                        LOG_TO_FILE ("  Background thread: scan returned " << results.size() << " plugins");

                        juce::Array<juce::var> pluginList;
                        for (const auto& sp : results)
                        {
                            auto* obj = new juce::DynamicObject();
                            obj->setProperty ("name", sp.name);
                            obj->setProperty ("vendor", sp.vendor);
                            obj->setProperty ("category", sp.category);
                            obj->setProperty ("path", sp.path);
                            obj->setProperty ("format", sp.format);
                            pluginList.add (juce::var (obj));
                        }

                        LOG_TO_FILE ("  Background thread: calling completion with " << pluginList.size() << " items");
                        // NativeFunctionCompletion can be called from any thread
                        (*sharedCompletion) (juce::var (pluginList));
                        LOG_TO_FILE ("  Background thread: completion called successfully");

                        // Kick off preset indexing in the background
                        if (! audioProcessor.isPresetIndexReady())
                        {
                            juce::Thread::launch ([this]() {
                                audioProcessor.buildPresetIndex();
                            });
                        }
                    });
                }
            )
            .withNativeFunction (
                "getScanProgress",
                [this] (const juce::Array<juce::var>&,
                        juce::WebBrowserComponent::NativeFunctionCompletion completion)
                {
                    auto prog = audioProcessor.getScanProgress();
                    auto* obj = new juce::DynamicObject();
                    obj->setProperty ("name", prog.currentPlugin);
                    obj->setProperty ("progress", prog.progress);
                    obj->setProperty ("scanning", prog.scanning);
                    completion (juce::var (obj));
                }
            )
            .withNativeFunction (
                "saveUiState",
                [this] (const juce::Array<juce::var>& args,
                        juce::WebBrowserComponent::NativeFunctionCompletion completion)
                {
                    if (args.size() > 0)
                        audioProcessor.setUiState (args[0].toString());
                    completion (juce::var ("ok"));
                }
            )
            .withNativeFunction (
                "getDefaultScanPaths",
                [this] (const juce::Array<juce::var>&,
                        juce::WebBrowserComponent::NativeFunctionCompletion completion)
                {
                    auto paths = HostesaAudioProcessor::getDefaultScanPaths();
                    juce::var result;
                    for (const auto& p : paths)
                        result.append (juce::var (p));
                    completion (result);
                }
            )
            .withNativeFunction (
                "getFullState",
                [this] (const juce::Array<juce::var>&,
                        juce::WebBrowserComponent::NativeFunctionCompletion completion)
                {
                    // Build response: { plugins: [...], uiState: "..." }
                    auto* result = new juce::DynamicObject();

                    // Current hosted plugins (already loaded in processor)
                    juce::Array<juce::var> plugArr;
                    auto pluginList = audioProcessor.getHostedPluginList();
                    for (const auto& info : pluginList)
                    {
                        auto* pObj = new juce::DynamicObject();
                        pObj->setProperty ("id", info.id);
                        pObj->setProperty ("name", info.name);
                        pObj->setProperty ("path", info.path);
                        pObj->setProperty ("manufacturer", info.manufacturer);

                        // Get current parameter values
                        auto params = audioProcessor.getHostedParams (info.id);
                        juce::Array<juce::var> paramArr;
                        for (const auto& p : params)
                        {
                            auto* paramObj = new juce::DynamicObject();
                            paramObj->setProperty ("index", p.index);
                            paramObj->setProperty ("name", p.name);
                            paramObj->setProperty ("value", (double) p.value);
                            paramObj->setProperty ("disp", p.displayText);
                            paramArr.add (juce::var (paramObj));
                        }
                        pObj->setProperty ("params", juce::var (paramArr));
                        pObj->setProperty ("busId", info.busId);
                        pObj->setProperty ("isInstrument", info.isInstrument);
                        plugArr.add (juce::var (pObj));
                    }
                    result->setProperty ("plugins", juce::var (plugArr));
                    result->setProperty ("routingMode", audioProcessor.getRoutingMode());

                    // Saved UI state (blocks, mappings, locks)
                    auto uiState = audioProcessor.getUiState();
                    if (uiState.isNotEmpty())
                        result->setProperty ("uiState", uiState);

                    completion (juce::var (result));
                }
            )
            .withNativeFunction (
                "loadPlugin",
                [this] (const juce::Array<juce::var>& args,
                        juce::WebBrowserComponent::NativeFunctionCompletion completion)
                {
                    if (args.isEmpty())
                    {
                        completion (juce::var());
                        return;
                    }

                    auto pluginPath = args[0].toString();
                    LOG_TO_FILE ("=== loadPlugin async: " << pluginPath.toStdString());

                    // Phase 1: scan on background thread — no COM, pure disk I/O
                    juce::Thread::launch ([this, pluginPath, completion = std::move(completion)]() mutable
                    {
                        juce::PluginDescription desc;
                        bool found = audioProcessor.findPluginDescription (pluginPath, desc);

                        if (! found)
                        {
                            juce::MessageManager::callAsync ([completion = std::move(completion), pluginPath]() mutable
                            {
                                auto* err = new juce::DynamicObject();
                                err->setProperty ("error", "Plugin not found: " + pluginPath);
                                completion (juce::var (err));
                            });
                            return;
                        }

                        // Phase 2: instantiate on message thread — COM-safe
                        juce::MessageManager::callAsync ([this, desc, completion = std::move(completion)]() mutable
                        {
                            int pluginId = audioProcessor.instantiatePlugin (desc);

                            if (pluginId < 0)
                            {
                                auto* err = new juce::DynamicObject();
                                err->setProperty ("error", "Failed to instantiate plugin");
                                completion (juce::var (err));
                                return;
                            }

                            auto params = audioProcessor.getHostedParams (pluginId);
                            auto* result = new juce::DynamicObject();
                            result->setProperty ("id", pluginId);

                            auto hosted = audioProcessor.getHostedPluginList();
                            for (auto& h : hosted)
                            {
                                if (h.id == pluginId)
                                {
                                    result->setProperty ("name", h.name);
                                    result->setProperty ("manufacturer", h.manufacturer);
                                    result->setProperty ("isInstrument", h.isInstrument);
                                    break;
                                }
                            }

                            juce::Array<juce::var> paramList;
                            for (const auto& p : params)
                            {
                                auto* pObj = new juce::DynamicObject();
                                pObj->setProperty ("index", p.index);
                                pObj->setProperty ("name",  p.name);
                                pObj->setProperty ("value", (double) p.value);
                                pObj->setProperty ("label", p.label);
                                pObj->setProperty ("disp",  p.displayText);
                                pObj->setProperty ("automatable", p.automatable);
                                paramList.add (juce::var (pObj));
                            }
                            result->setProperty ("params", juce::var (paramList));

                            completion (juce::var (result));
                        });
                    });
                }
            )
            .withNativeFunction (
                "removePlugin",
                [this] (const juce::Array<juce::var>& args,
                        juce::WebBrowserComponent::NativeFunctionCompletion completion)
                {
                    try
                    {
                        if (args.size() > 0)
                        {
                            int pluginId = (int) args[0];

                            // Close editor window FIRST (prevents dangling pointer)
                            try {
                                auto it = pluginEditorWindows.find (pluginId);
                                if (it != pluginEditorWindows.end())
                                    pluginEditorWindows.erase (it);
                            } catch (...) {}

                            // Now remove from processor
                            try { audioProcessor.removePlugin (pluginId); } catch (...) {}
                        }
                    }
                    catch (...) {}
                    completion (juce::var ("ok"));
                }
            )
            .withNativeFunction (
                "setParam",
                [this] (const juce::Array<juce::var>& args,
                        juce::WebBrowserComponent::NativeFunctionCompletion completion)
                {
                    // args: [pluginId, paramIndex, normValue]
                    if (args.size() >= 3)
                    {
                        int pluginId = (int) args[0];
                        int paramIdx = (int) args[1];
                        float val = (float) (double) args[2];
                        audioProcessor.setHostedParam (pluginId, paramIdx, val);
                    }
                    completion (juce::var ("ok"));
                }
            )
            .withNativeFunction (
                "touchParam",
                [this] (const juce::Array<juce::var>& args,
                        juce::WebBrowserComponent::NativeFunctionCompletion completion)
                {
                    // args: [pluginId, paramIndex]
                    if (args.size() >= 2)
                        audioProcessor.touchParam ((int) args[0], (int) args[1]);
                    completion (juce::var ("ok"));
                }
            )
            .withNativeFunction (
                "untouchParam",
                [this] (const juce::Array<juce::var>& args,
                        juce::WebBrowserComponent::NativeFunctionCompletion completion)
                {
                    // args: [pluginId, paramIndex]
                    if (args.size() >= 2)
                        audioProcessor.untouchParam ((int) args[0], (int) args[1]);
                    completion (juce::var ("ok"));
                }
            )
            .withNativeFunction (
                "getParams",
                [this] (const juce::Array<juce::var>& args,
                        juce::WebBrowserComponent::NativeFunctionCompletion completion)
                {
                    // args: [pluginId]
                    if (args.isEmpty())
                    {
                        completion (juce::var());
                        return;
                    }

                    int pluginId = (int) args[0];
                    auto params = audioProcessor.getHostedParams (pluginId);

                    juce::Array<juce::var> paramList;
                    for (const auto& p : params)
                    {
                        auto pObj = new juce::DynamicObject();
                        pObj->setProperty ("index", p.index);
                        pObj->setProperty ("name", p.name);
                        pObj->setProperty ("value", (double) p.value);
                        pObj->setProperty ("label", p.label);
                        pObj->setProperty ("disp", p.displayText);
                        paramList.add (juce::var (pObj));
                    }
                    completion (juce::var (paramList));
                }
            )
            .withNativeFunction (
                "fireRandomize",
                [this] (const juce::Array<juce::var>& args,
                        juce::WebBrowserComponent::NativeFunctionCompletion completion)
                {
                    // args: [pluginId, paramIndicesArray, minVal, maxVal]
                    if (args.size() >= 4)
                    {
                        int pluginId = (int) args[0];
                        float minVal = (float) (double) args[2];
                        float maxVal = (float) (double) args[3];

                        std::vector<int> indices;
                        if (args[1].isArray())
                        {
                            for (int i = 0; i < args[1].size(); ++i)
                                indices.push_back ((int) args[1][i]);
                        }

                        audioProcessor.randomizeParams (pluginId, indices, minVal, maxVal);

                        // Return updated param values
                        auto params = audioProcessor.getHostedParams (pluginId);
                        juce::Array<juce::var> paramList;
                        for (const auto& p : params)
                        {
                            auto pObj = new juce::DynamicObject();
                            pObj->setProperty ("index", p.index);
                            pObj->setProperty ("name", p.name);
                            pObj->setProperty ("value", (double) p.value);
                            pObj->setProperty ("disp", p.displayText);
                            paramList.add (juce::var (pObj));
                        }
                        completion (juce::var (paramList));
                    }
                    else
                    {
                        completion (juce::var ("error: missing args"));
                    }
                }
            )
            .withNativeFunction (
                "updateBlocks",
                [this] (const juce::Array<juce::var>& args,
                        juce::WebBrowserComponent::NativeFunctionCompletion completion)
                {
                    // args: [jsonString]
                    if (args.size() > 0)
                    {
                        auto jsonStr = args[0].toString();
                        audioProcessor.updateLogicBlocks (jsonStr);
                    }
                    completion (juce::var ("ok"));
                }
            )
            .withNativeFunction (
                "updateMorphPlayhead",
                [this] (const juce::Array<juce::var>& args,
                        juce::WebBrowserComponent::NativeFunctionCompletion completion)
                {
                    // Lightweight playhead update — args: [blockId, x, y]
                    if (args.size() >= 3)
                    {
                        int blockId = (int) args[0];
                        float px = (float) (double) args[1];
                        float py = (float) (double) args[2];
                        audioProcessor.updateMorphPlayhead (blockId, px, py);
                    }
                    completion (juce::var ("ok"));
                }
            )
            .withNativeFunction (
                "startGlide",
                [this] (const juce::Array<juce::var>& args,
                        juce::WebBrowserComponent::NativeFunctionCompletion completion)
                {
                    // args: [pluginId, paramIndex, targetValue, durationMs]
                    if (args.size() >= 4)
                    {
                        int pluginId   = (int) args[0];
                        int paramIdx   = (int) args[1];
                        float target   = (float) (double) args[2];
                        float duration = (float) (double) args[3];
                        audioProcessor.startGlide (pluginId, paramIdx, target, duration);
                    }
                    completion (juce::var ("ok"));
                }
            )
            .withNativeFunction (
                "openPluginEditor",
                [this] (const juce::Array<juce::var>& args,
                        juce::WebBrowserComponent::NativeFunctionCompletion completion)
                {
                    if (args.size() > 0)
                    {
                        int pluginId = (int) args[0];
                        // Must run on message thread (creates GUI)
                        juce::Component::SafePointer<HostesaAudioProcessorEditor> safeThis (this);
                        juce::MessageManager::callAsync ([safeThis, pluginId]()
                        {
                            if (safeThis != nullptr)
                                safeThis->openPluginEditorWindow (pluginId);
                        });
                    }
                    completion (juce::var ("ok"));
                }
            )
            .withNativeFunction (
                "browseSample",
                [this] (const juce::Array<juce::var>& args,
                        juce::WebBrowserComponent::NativeFunctionCompletion completion)
                {
                    int blockId = args.size() > 0 ? (int) args[0] : -1;
                    if (blockId < 0)
                    {
                        completion (juce::var());
                        return;
                    }

                    auto sharedCompletion = std::make_shared<juce::WebBrowserComponent::NativeFunctionCompletion> (
                        std::move (completion));

                    auto chooser = std::make_shared<juce::FileChooser> (
                        "Select Audio File",
                        juce::File::getSpecialLocation (juce::File::userMusicDirectory),
                        "*.wav;*.aiff;*.aif;*.flac;*.mp3;*.ogg");

                    chooser->launchAsync (
                        juce::FileBrowserComponent::openMode | juce::FileBrowserComponent::canSelectFiles,
                        [this, blockId, chooser, sharedCompletion] (const juce::FileChooser& fc)
                        {
                            auto results = fc.getResults();
                            if (results.isEmpty())
                            {
                                (*sharedCompletion) (juce::var());
                                return;
                            }

                            auto filePath = results[0].getFullPathName();
                            bool ok = audioProcessor.loadSampleForBlock (blockId, filePath);

                            if (ok)
                            {
                                auto waveform = audioProcessor.getSampleWaveform (blockId);
                                auto* result = new juce::DynamicObject();
                                result->setProperty ("name", results[0].getFileName());
                                result->setProperty ("path", filePath);
                                result->setProperty ("duration",
                                    juce::var ((double) results[0].getSize() / 44100.0)); // rough estimate

                                juce::Array<juce::var> peaks;
                                for (float p : waveform)
                                    peaks.add ((double) p);
                                result->setProperty ("waveform", juce::var (peaks));

                                (*sharedCompletion) (juce::var (result));
                            }
                            else
                            {
                                (*sharedCompletion) (juce::var());
                            }
                        });
                }
            )
            .withNativeFunction (
                "setPluginBypass",
                [this] (const juce::Array<juce::var>& args,
                        juce::WebBrowserComponent::NativeFunctionCompletion completion)
                {
                    if (args.size() >= 2)
                        audioProcessor.setPluginBypass ((int) args[0], (bool) args[1]);
                    completion (juce::var ("ok"));
                }
            )
            .withNativeFunction (
                "resetPluginCrash",
                [this] (const juce::Array<juce::var>& args,
                        juce::WebBrowserComponent::NativeFunctionCompletion completion)
                {
                    // Re-enable a crashed plugin — user acknowledges the risk
                    if (args.size() >= 1)
                        audioProcessor.resetPluginCrash ((int) args[0]);
                    completion (juce::var ("ok"));
                }
            )
            .withNativeFunction (
                "savePluginPreset",
                [this] (const juce::Array<juce::var>& args,
                        juce::WebBrowserComponent::NativeFunctionCompletion completion)
                {
                    if (args.size() >= 4)
                    {
                        auto manufacturer = HostesaAudioProcessor::sanitizeForFilename (args[0].toString());
                        auto pluginName   = HostesaAudioProcessor::sanitizeForFilename (args[1].toString());
                        auto presetName   = args[2].toString();
                        auto jsonData     = args[3].toString();

                        if (manufacturer.isEmpty()) manufacturer = "Unknown";

                        auto presetsDir = HostesaAudioProcessor::getSnapshotsDir()
                                              .getChildFile (manufacturer)
                                              .getChildFile (pluginName);
                        presetsDir.createDirectory();

                        auto presetFile = presetsDir.getChildFile (presetName + ".json");
                        presetFile.replaceWithText (jsonData);
                        completion (juce::var ("ok"));
                    }
                    else
                        completion (juce::var());
                }
            )
            .withNativeFunction (
                "getPluginPresets",
                [this] (const juce::Array<juce::var>& args,
                        juce::WebBrowserComponent::NativeFunctionCompletion completion)
                {
                    juce::Array<juce::var> presetNames;
                    if (args.size() >= 2)
                    {
                        auto manufacturer = HostesaAudioProcessor::sanitizeForFilename (args[0].toString());
                        auto pluginName   = HostesaAudioProcessor::sanitizeForFilename (args[1].toString());
                        if (manufacturer.isEmpty()) manufacturer = "Unknown";

                        auto presetsDir = HostesaAudioProcessor::getSnapshotsDir()
                                              .getChildFile (manufacturer)
                                              .getChildFile (pluginName);

                        if (presetsDir.isDirectory())
                        {
                            for (const auto& f : presetsDir.findChildFiles (juce::File::findFiles, false, "*.json"))
                                presetNames.add (f.getFileNameWithoutExtension());
                        }
                    }
                    completion (juce::var (presetNames));
                }
            )
            .withNativeFunction (
                "deletePluginPreset",
                [this] (const juce::Array<juce::var>& args,
                        juce::WebBrowserComponent::NativeFunctionCompletion completion)
                {
                    if (args.size() >= 3)
                    {
                        auto manufacturer = HostesaAudioProcessor::sanitizeForFilename (args[0].toString());
                        auto pluginName   = HostesaAudioProcessor::sanitizeForFilename (args[1].toString());
                        auto presetName   = args[2].toString();
                        if (manufacturer.isEmpty()) manufacturer = "Unknown";

                        auto presetsDir = HostesaAudioProcessor::getSnapshotsDir()
                                              .getChildFile (manufacturer)
                                              .getChildFile (pluginName);
                        auto presetFile = presetsDir.getChildFile (presetName + ".json");
                        if (presetFile.existsAsFile())
                            presetFile.deleteFile();
                    }
                    completion (juce::var ("ok"));
                }
            )
            .withNativeFunction (
                "loadPluginPreset",
                [this] (const juce::Array<juce::var>& args,
                        juce::WebBrowserComponent::NativeFunctionCompletion completion)
                {
                    if (args.size() >= 3)
                    {
                        auto manufacturer = HostesaAudioProcessor::sanitizeForFilename (args[0].toString());
                        auto pluginName   = HostesaAudioProcessor::sanitizeForFilename (args[1].toString());
                        auto presetName   = args[2].toString();
                        if (manufacturer.isEmpty()) manufacturer = "Unknown";

                        auto presetsDir = HostesaAudioProcessor::getSnapshotsDir()
                                              .getChildFile (manufacturer)
                                              .getChildFile (pluginName);
                        auto presetFile = presetsDir.getChildFile (presetName + ".json");
                        if (presetFile.existsAsFile())
                        {
                            completion (juce::var (presetFile.loadFileAsString()));
                            return;
                        }
                    }
                    completion (juce::var());
                }
            )
            .withNativeFunction (
                "getFactoryPresets",
                [this] (const juce::Array<juce::var>& args,
                        juce::WebBrowserComponent::NativeFunctionCompletion completion)
                {
                    juce::Array<juce::var> result;
                    if (args.size() >= 1)
                    {
                        int pluginId = (int) args[0];
                        auto presets = audioProcessor.getFactoryPresets (pluginId);
                        for (const auto& fp : presets)
                        {
                            auto* obj = new juce::DynamicObject();
                            obj->setProperty ("index", fp.index);
                            obj->setProperty ("name", fp.name);
                            if (fp.filePath.isNotEmpty())
                                obj->setProperty ("filePath", fp.filePath);
                            result.add (juce::var (obj));
                        }
                    }
                    completion (juce::var (result));
                }
            )
            .withNativeFunction (
                "loadFactoryPreset",
                [this] (const juce::Array<juce::var>& args,
                        juce::WebBrowserComponent::NativeFunctionCompletion completion)
                {
                    if (args.size() >= 2)
                    {
                        int pluginId = (int) args[0];
                        int progIdx  = (int) args[1];
                        juce::String filePath = args.size() >= 3 ? args[2].toString() : "";

                        std::vector<HostesaAudioProcessor::ParamInfo> params;
                        if (filePath.isNotEmpty())
                            params = audioProcessor.loadFactoryPresetFromFile (pluginId, filePath);
                        else
                            params = audioProcessor.loadFactoryPreset (pluginId, progIdx);

                        juce::Array<juce::var> paramArr;
                        for (const auto& p : params)
                        {
                            auto* obj = new juce::DynamicObject();
                            obj->setProperty ("index", p.index);
                            obj->setProperty ("name", p.name);
                            obj->setProperty ("value", (double) p.value);
                            paramArr.add (juce::var (obj));
                        }
                        completion (juce::var (paramArr));
                        return;
                    }
                    completion (juce::var());
                }
            )
            .withNativeFunction (
                "saveGlobalPreset",
                [this] (const juce::Array<juce::var>& args,
                        juce::WebBrowserComponent::NativeFunctionCompletion completion)
                {
                    if (args.size() >= 2)
                    {
                        auto presetName = args[0].toString();
                        auto jsonData   = args[1].toString();
                        auto chainsDir  = HostesaAudioProcessor::getChainsDir();
                        chainsDir.createDirectory();
                        auto presetFile = chainsDir.getChildFile (presetName + ".mrchain");
                        presetFile.replaceWithText (jsonData);
                    }
                    completion (juce::var ("ok"));
                }
            )
            .withNativeFunction (
                "getGlobalPresets",
                [this] (const juce::Array<juce::var>& args,
                        juce::WebBrowserComponent::NativeFunctionCompletion completion)
                {
                    juce::ignoreUnused (args);

                    // Helper: extract plugin names from a preset file (lightweight — reads file once, scans for plugin names)
                    auto extractPluginNames = [] (const juce::File& f) -> juce::Array<juce::var>
                    {
                        juce::Array<juce::var> pluginNames;
                        auto content = f.loadFileAsString();
                        if (content.isEmpty()) return pluginNames;
                        auto parsed = juce::JSON::parse (content);
                        if (parsed.isVoid()) return pluginNames;
                        auto* obj = parsed.getDynamicObject();
                        if (obj == nullptr) return pluginNames;
                        auto pluginsVar = obj->getProperty ("plugins");
                        if (pluginsVar.isArray())
                        {
                            for (int i = 0; i < pluginsVar.size(); ++i)
                            {
                                if (auto* pObj = pluginsVar[i].getDynamicObject())
                                {
                                    auto name = pObj->getProperty ("name").toString();
                                    auto path = pObj->getProperty ("path").toString();
                                    if (name.isNotEmpty() && name != "__virtual__" && path != "__virtual__")
                                        pluginNames.add (name);
                                }
                            }
                        }
                        return pluginNames;
                    };

                    juce::Array<juce::var> presetEntries;
                    auto chainsDir = HostesaAudioProcessor::getChainsDir();
                    if (chainsDir.isDirectory())
                    {
                        for (const auto& f : chainsDir.findChildFiles (juce::File::findFiles, false, "*.mrchain"))
                        {
                            auto* entry = new juce::DynamicObject();
                            entry->setProperty ("name", f.getFileNameWithoutExtension());
                            entry->setProperty ("plugins", juce::var (extractPluginNames (f)));
                            presetEntries.add (juce::var (entry));
                        }
                    }
                    // Also scan _Import/ folder for new chain files
                    auto importDir = HostesaAudioProcessor::getImportDir();
                    if (importDir.isDirectory())
                    {
                        for (const auto& f : importDir.findChildFiles (juce::File::findFiles, false, "*.mrchain"))
                        {
                            auto baseName = f.getFileNameWithoutExtension();
                            auto dest = chainsDir.getChildFile (f.getFileName());

                            // Handle name collision: append _2, _3, etc.
                            if (dest.existsAsFile())
                            {
                                int suffix = 2;
                                while (chainsDir.getChildFile (baseName + "_" + juce::String (suffix) + ".mrchain").existsAsFile())
                                    ++suffix;
                                baseName = baseName + "_" + juce::String (suffix);
                                dest = chainsDir.getChildFile (baseName + ".mrchain");
                            }

                            if (f.copyFileTo (dest))
                            {
                                auto* entry = new juce::DynamicObject();
                                entry->setProperty ("name", baseName);
                                entry->setProperty ("plugins", juce::var (extractPluginNames (dest)));
                                presetEntries.add (juce::var (entry));
                                f.deleteFile(); // remove from _Import/ after successful copy
                            }
                        }
                    }
                    completion (juce::var (presetEntries));
                }
            )
            .withNativeFunction (
                "loadGlobalPreset",
                [this] (const juce::Array<juce::var>& args,
                        juce::WebBrowserComponent::NativeFunctionCompletion completion)
                {
                    if (args.size() >= 1)
                    {
                        auto presetName = args[0].toString();
                        auto chainsDir  = HostesaAudioProcessor::getChainsDir();
                        auto presetFile = chainsDir.getChildFile (presetName + ".mrchain");
                        if (presetFile.existsAsFile())
                        {
                            completion (juce::var (presetFile.loadFileAsString()));
                            return;
                        }
                    }
                    completion (juce::var());
                }
            )
            .withNativeFunction (
                "deleteGlobalPreset",
                [this] (const juce::Array<juce::var>& args,
                        juce::WebBrowserComponent::NativeFunctionCompletion completion)
                {
                    if (args.size() >= 1)
                    {
                        auto presetName = args[0].toString();
                        auto chainsDir  = HostesaAudioProcessor::getChainsDir();
                        auto presetFile = chainsDir.getChildFile (presetName + ".mrchain");
                        if (presetFile.existsAsFile())
                            presetFile.deleteFile();
                    }
                    completion (juce::var ("ok"));
                }
            )
            // ── EQ Presets ──
            .withNativeFunction (
                "saveEqPreset",
                [this] (const juce::Array<juce::var>& args,
                        juce::WebBrowserComponent::NativeFunctionCompletion completion)
                {
                    if (args.size() >= 2)
                    {
                        auto presetName = args[0].toString();
                        auto jsonData   = args[1].toString();
                        auto eqDir      = HostesaAudioProcessor::getEqPresetsDir();
                        eqDir.createDirectory();
                        auto presetFile = eqDir.getChildFile (presetName + ".mreq");
                        presetFile.replaceWithText (jsonData);
                    }
                    completion (juce::var ("ok"));
                }
            )
            .withNativeFunction (
                "getEqPresets",
                [this] (const juce::Array<juce::var>& args,
                        juce::WebBrowserComponent::NativeFunctionCompletion completion)
                {
                    juce::ignoreUnused (args);
                    auto eqDir = HostesaAudioProcessor::getEqPresetsDir();
                    juce::Array<juce::var> presetList;
                    if (eqDir.isDirectory())
                    {
                        for (auto& f : eqDir.findChildFiles (juce::File::findFiles, false, "*.mreq"))
                            presetList.add (f.getFileNameWithoutExtension());
                    }
                    presetList.sort();
                    completion (juce::var (presetList));
                }
            )
            .withNativeFunction (
                "loadEqPreset",
                [this] (const juce::Array<juce::var>& args,
                        juce::WebBrowserComponent::NativeFunctionCompletion completion)
                {
                    if (args.size() >= 1)
                    {
                        auto presetName = args[0].toString();
                        auto eqDir      = HostesaAudioProcessor::getEqPresetsDir();
                        auto presetFile = eqDir.getChildFile (presetName + ".mreq");
                        if (presetFile.existsAsFile())
                        {
                            completion (juce::var (presetFile.loadFileAsString()));
                            return;
                        }
                    }
                    completion (juce::var());
                }
            )
            .withNativeFunction (
                "deleteEqPreset",
                [this] (const juce::Array<juce::var>& args,
                        juce::WebBrowserComponent::NativeFunctionCompletion completion)
                {
                    if (args.size() >= 1)
                    {
                        auto presetName = args[0].toString();
                        auto eqDir      = HostesaAudioProcessor::getEqPresetsDir();
                        auto presetFile = eqDir.getChildFile (presetName + ".mreq");
                        if (presetFile.existsAsFile())
                            presetFile.deleteFile();
                    }
                    completion (juce::var ("ok"));
                }
            )
            .withNativeFunction (
                "revealPresetFile",
                [this] (const juce::Array<juce::var>& args,
                        juce::WebBrowserComponent::NativeFunctionCompletion completion)
                {
                    // args[0] = type ("chain" or "snapshot")
                    // args[1] = presetName
                    // args[2] = manufacturer (snapshot only)
                    // args[3] = pluginName (snapshot only)
                    if (args.size() >= 2)
                    {
                        auto type       = args[0].toString();
                        auto presetName = args[1].toString();

                        juce::File target;
                        if (type == "chain")
                        {
                            target = HostesaAudioProcessor::getChainsDir()
                                         .getChildFile (presetName + ".mrchain");
                        }
                        else if (type == "snapshot" && args.size() >= 4)
                        {
                            auto manufacturer = HostesaAudioProcessor::sanitizeForFilename (args[2].toString());
                            auto pluginName   = HostesaAudioProcessor::sanitizeForFilename (args[3].toString());
                            if (manufacturer.isEmpty()) manufacturer = "Unknown";
                            target = HostesaAudioProcessor::getSnapshotsDir()
                                         .getChildFile (manufacturer)
                                         .getChildFile (pluginName)
                                         .getChildFile (presetName + ".json");
                        }
                        else if (type == "root")
                        {
                            target = HostesaAudioProcessor::getChainsDir();
                        }
                        else if (type == "eq")
                        {
                            target = HostesaAudioProcessor::getEqPresetsDir()
                                         .getChildFile (presetName + ".mreq");
                            if (! target.existsAsFile())
                                target = HostesaAudioProcessor::getEqPresetsDir();
                        }

                        if (target.exists())
                            target.revealToUser();
                    }
                    completion (juce::var ("ok"));
                }
            )
            .withNativeFunction (
                "setEditorScale",
                [this] (const juce::Array<juce::var>& args,
                        juce::WebBrowserComponent::NativeFunctionCompletion completion)
                {
                    if (args.size() >= 1)
                    {
                        double scale = (double) args[0];
                        if (scale < 0.5) scale = 0.5;
                        if (scale > 2.0) scale = 2.0;
                        // Base UI size matches initial setSize
                        constexpr int baseW = 1060, baseH = 720;
                        int w = juce::roundToInt (baseW * scale);
                        int h = juce::roundToInt (baseH * scale);
                        juce::Component::SafePointer<HostesaAudioProcessorEditor> safeThis (this);
                        juce::MessageManager::callAsync ([safeThis, w, h]()
                        {
                            if (safeThis != nullptr)
                                safeThis->setSize (w, h);
                        });
                    }
                    completion (juce::var ("ok"));
                }
            )
            .withNativeFunction (
                "setRoutingMode",
                [this] (const juce::Array<juce::var>& args,
                        juce::WebBrowserComponent::NativeFunctionCompletion completion)
                {
                    if (args.size() >= 1)
                    {
                        int mode = (int) args[0];
                        audioProcessor.setRoutingMode (mode);
                    }
                    completion (juce::var ("ok"));
                }
            )
            .withNativeFunction (
                "setEqCurve",
                [this] (const juce::Array<juce::var>& args,
                        juce::WebBrowserComponent::NativeFunctionCompletion completion)
                {
                    if (args.size() >= 1 && args[0].isString())
                    {
                        audioProcessor.setEqCurve (args[0].toString());
                    }
                    completion (juce::var ("ok"));
                }
            )
            .withNativeFunction (
                "setEqPointFast",
                [this] (const juce::Array<juce::var>& args,
                        juce::WebBrowserComponent::NativeFunctionCompletion completion)
                {
                    // Fast path: setEqPointFast(pointIndex, field, value)
                    // No JSON — direct atomic write to eqPoints[]
                    if (args.size() >= 3)
                    {
                        int idx = (int) args[0];
                        auto field = args[1].toString();
                        double val = (double) args[2];
                        audioProcessor.setEqPointFast (idx, field, val);
                    }
                    completion (juce::var ("ok"));
                }
            )
            .withNativeFunction (
                "setPluginBus",
                [this] (const juce::Array<juce::var>& args,
                        juce::WebBrowserComponent::NativeFunctionCompletion completion)
                {
                    if (args.size() >= 2)
                    {
                        int pluginId = (int) args[0];
                        int busId    = (int) args[1];
                        audioProcessor.setPluginBusId (pluginId, busId);
                    }
                    completion (juce::var ("ok"));
                }
            )
            .withNativeFunction (
                "setBusVolume",
                [this] (const juce::Array<juce::var>& args,
                        juce::WebBrowserComponent::NativeFunctionCompletion completion)
                {
                    if (args.size() >= 2)
                        audioProcessor.setBusVolume ((int) args[0], (float) (double) args[1]);
                    completion (juce::var ("ok"));
                }
            )
            .withNativeFunction (
                "setBusMute",
                [this] (const juce::Array<juce::var>& args,
                        juce::WebBrowserComponent::NativeFunctionCompletion completion)
                {
                    if (args.size() >= 2)
                        audioProcessor.setBusMute ((int) args[0], (bool) args[1]);
                    completion (juce::var ("ok"));
                }
            )
            .withNativeFunction (
                "setBusSolo",
                [this] (const juce::Array<juce::var>& args,
                        juce::WebBrowserComponent::NativeFunctionCompletion completion)
                {
                    if (args.size() >= 2)
                        audioProcessor.setBusSolo ((int) args[0], (bool) args[1]);
                    completion (juce::var ("ok"));
                }
            )
            .withNativeFunction (
                "reorderPlugins",
                [this] (const juce::Array<juce::var>& args,
                        juce::WebBrowserComponent::NativeFunctionCompletion completion)
                {
                    if (args.size() > 0 && args[0].isArray())
                    {
                        auto* arr = args[0].getArray();
                        std::vector<int> orderedIds;
                        orderedIds.reserve ((size_t) arr->size());
                        for (auto& v : *arr)
                            orderedIds.push_back ((int) v);
                        audioProcessor.reorderPlugins (orderedIds);
                    }
                    completion (juce::var ("ok"));
                }
            )
            .withNativeFunction (
                "applyParamBatch",
                [this] (const juce::Array<juce::var>& args,
                        juce::WebBrowserComponent::NativeFunctionCompletion completion)
                {
                    // Batch param apply — sets N params in a single IPC call.
                    // args: [jsonString] where json is [{"p":pluginId,"i":paramIndex,"v":value}, ...]
                    if (args.size() > 0)
                        audioProcessor.applyParamBatch (args[0].toString());
                    completion (juce::var ("ok"));
                }
            )
            .withNativeFunction (
                "setExpandedPlugins",
                [this] (const juce::Array<juce::var>& args,
                        juce::WebBrowserComponent::NativeFunctionCompletion completion)
                {
                    // Visibility culling: JS tells us which plugin IDs are expanded.
                    // We skip polling params from collapsed plugins.
                    std::unordered_set<int> newExpanded;
                    if (args.size() > 0 && args[0].isArray())
                    {
                        for (int i = 0; i < args[0].size(); ++i)
                            newExpanded.insert ((int) args[0][i]);
                    }

                    // Detect newly expanded plugins — clear their lastParamValues for full resync
                    for (int id : newExpanded)
                    {
                        if (expandedPluginIds.count (id) == 0)
                        {
                            // This plugin was just expanded — clear cached values so
                            // Tier 2 treats all its params as new and sends a full batch
                            for (auto it = lastParamValues.begin(); it != lastParamValues.end(); )
                            {
                                auto identIt = paramIdentCache.find (it->first);
                                if (identIt != paramIdentCache.end() && identIt->second.pluginId == id)
                                    it = lastParamValues.erase (it);
                                else
                                    ++it;
                            }
                        }
                    }

                    expandedPluginIds = std::move (newExpanded);
                    completion (juce::var ("ok"));
                }
            )
            .withNativeFunction (
                "fireLaneTrigger",
                [this] (const juce::Array<juce::var>& args,
                        juce::WebBrowserComponent::NativeFunctionCompletion completion)
                {
                    // args: [blockId, laneIdx] — fire manual oneshot trigger
                    if (args.size() >= 2)
                    {
                        int blockId = (int) args[0];
                        int laneIdx = (int) args[1];
                        audioProcessor.fireLaneTrigger (blockId, laneIdx);
                    }
                    completion (juce::var ("ok"));
                }
            )
            .withNativeFunction (
                "getParamTextForValue",
                [this] (const juce::Array<juce::var>& args,
                        juce::WebBrowserComponent::NativeFunctionCompletion completion)
                {
                    // Convert an arbitrary normalized value (0..1) to the plugin's display text.
                    // args: [pluginId, paramIndex, normalizedValue]
                    // Returns the display string (e.g. "600 Hz", "-12.5 dB")
                    if (args.size() >= 3)
                    {
                        int pluginId   = (int) args[0];
                        int paramIndex = (int) args[1];
                        float normVal  = (float) (double) args[2];
                        auto text = audioProcessor.getParamTextForValue (pluginId, paramIndex, normVal);
                        completion (juce::var (text));
                        return;
                    }
                    completion (juce::var (""));
                }
            )
            .withNativeFunction (
                "setVisibleParams",
                [this] (const juce::Array<juce::var>& args,
                        juce::WebBrowserComponent::NativeFunctionCompletion completion)
                {
                    // Fine-grained visibility: JS tells us which PIDs are on screen (~8).
                    // Tier 1 only polls modulated params that are also visible.
                    std::unordered_set<std::string> newVisible;
                    if (args.size() > 0 && args[0].isArray())
                    {
                        for (int i = 0; i < args[0].size(); ++i)
                            newVisible.insert (args[0][i].toString().toStdString());
                    }
                    visibleParamKeys = std::move (newVisible);
                    completion (juce::var ("ok"));
                }
            )
            .withNativeFunction (
                "updateExposeState",
                [this] (const juce::Array<juce::var>& args,
                        juce::WebBrowserComponent::NativeFunctionCompletion completion)
                {
                    if (args.size() > 0)
                        audioProcessor.updateExposeState (args[0].toString());
                    completion (juce::var ("ok"));
                }
            );

    webView = std::make_unique<juce::WebBrowserComponent> (webViewOptions);

    // CRITICAL: addAndMakeVisible AFTER attachments are created
    DBG ("Hostesa: Adding WebView to component");
    addAndMakeVisible (*webView);

    // Navigate to resource provider root (serves index.html via root handler)
    DBG ("Hostesa: Loading web content");
    webView->goToURL (juce::WebBrowserComponent::getResourceProviderRoot());

    // Set editor size
    setSize (1060, 720);

    // Start timer for periodic UI updates (30fps)
    startTimerHz (60);

#if JUCE_DEBUG
    DBG ("Resource provider root: " + juce::WebBrowserComponent::getResourceProviderRoot());
#endif

    DBG ("Hostesa: Editor constructor completed");
}

HostesaAudioProcessorEditor::~HostesaAudioProcessorEditor()
{
    stopTimer();

    // Close all hosted plugin editor windows BEFORE destroying the WebView.
    // This prevents use-after-free from async close callbacks.
    // Wrapped in try/catch because some plugins crash during editor teardown.
    try { pluginEditorWindows.clear(); } catch (...) {}
}

//==============================================================================
void HostesaAudioProcessorEditor::paint (juce::Graphics& g)
{
    g.fillAll (juce::Colour (0xFF252018));
}

void HostesaAudioProcessorEditor::resized()
{
    if (webView != nullptr)
        webView->setBounds (getLocalBounds());
}

void HostesaAudioProcessorEditor::timerCallback()
{
    if (webView == nullptr) return;

    ++timerTickCount;

    // Build real-time data object for JS
    auto* data = new juce::DynamicObject();

    // Audio levels (0..1 RMS)
    data->setProperty ("rms", (double) audioProcessor.currentRmsLevel.load());
    data->setProperty ("scRms", (double) audioProcessor.sidechainRmsLevel.load());

    // Transport
    data->setProperty ("bpm", audioProcessor.currentBpm.load());
    data->setProperty ("playing", audioProcessor.isPlaying.load());
    data->setProperty ("ppq", audioProcessor.ppqPosition.load());

    // Sample rate: sent once per tick so JS EQ visualization uses actual rate (not hardcoded 48k)
    data->setProperty ("sr", audioProcessor.getSampleRate());

    // MIDI events since last tick (lock-free FIFO read)
    juce::Array<juce::var> midiArr;
    {
        const auto scope = audioProcessor.midiFifo.read (audioProcessor.midiFifo.getNumReady());
        for (int i = 0; i < scope.blockSize1; ++i)
        {
            const auto& ev = audioProcessor.midiRing[scope.startIndex1 + i];
            auto* mObj = new juce::DynamicObject();
            mObj->setProperty ("note", ev.note);
            mObj->setProperty ("vel", ev.velocity);
            mObj->setProperty ("ch", ev.channel);
            mObj->setProperty ("cc", ev.isCC);
            midiArr.add (juce::var (mObj));
        }
        for (int i = 0; i < scope.blockSize2; ++i)
        {
            const auto& ev = audioProcessor.midiRing[scope.startIndex2 + i];
            auto* mObj = new juce::DynamicObject();
            mObj->setProperty ("note", ev.note);
            mObj->setProperty ("vel", ev.velocity);
            mObj->setProperty ("ch", ev.channel);
            mObj->setProperty ("cc", ev.isCC);
            midiArr.add (juce::var (mObj));
        }
    }
    data->setProperty ("midi", juce::var (midiArr));

    // Envelope follower levels from C++ logic blocks
    {
        int numEnv = audioProcessor.numActiveEnvBlocks.load();
        if (numEnv > 0)
        {
            juce::Array<juce::var> envArr;
            for (int i = 0; i < numEnv && i < audioProcessor.maxEnvReadback; ++i)
            {
                auto* e = new juce::DynamicObject();
                e->setProperty ("id", audioProcessor.envReadback[i].blockId.load());
                e->setProperty ("level", (double) audioProcessor.envReadback[i].level.load());
                envArr.add (juce::var (e));
            }
            data->setProperty ("envLevels", juce::var (envArr));
        }
    }

    // Trigger fire events from C++ logic blocks
    {
        const auto tScope = audioProcessor.triggerFifo.read (audioProcessor.triggerFifo.getNumReady());
        if (tScope.blockSize1 > 0 || tScope.blockSize2 > 0)
        {
            juce::Array<juce::var> trigArr;
            for (int i = 0; i < tScope.blockSize1; ++i)
                trigArr.add (audioProcessor.triggerRing[tScope.startIndex1 + i]);
            for (int i = 0; i < tScope.blockSize2; ++i)
                trigArr.add (audioProcessor.triggerRing[tScope.startIndex2 + i]);
            data->setProperty ("trigFired", juce::var (trigArr));
        }
    }

    // Sample modulator playhead positions
    {
        int numSmp = audioProcessor.numActiveSampleBlocks.load();
        if (numSmp > 0)
        {
            juce::Array<juce::var> smpArr;
            for (int i = 0; i < numSmp && i < audioProcessor.maxSampleReadback; ++i)
            {
                auto* s = new juce::DynamicObject();
                s->setProperty ("id", audioProcessor.sampleReadback[i].blockId.load());
                s->setProperty ("pos", (double) audioProcessor.sampleReadback[i].playhead.load());
                smpArr.add (juce::var (s));
            }
            data->setProperty ("sampleHeads", juce::var (smpArr));
        }
    }

    // Morph pad playhead positions
    {
        int numMorph = audioProcessor.numActiveMorphBlocks.load();
        if (numMorph > 0)
        {
            juce::Array<juce::var> morphArr;
            for (int i = 0; i < numMorph && i < audioProcessor.maxMorphReadback; ++i)
            {
                auto* obj = new juce::DynamicObject();
                obj->setProperty ("id", audioProcessor.morphReadback[i].blockId.load());
                obj->setProperty ("x", (double) audioProcessor.morphReadback[i].headX.load());
                obj->setProperty ("y", (double) audioProcessor.morphReadback[i].headY.load());
                obj->setProperty ("rot", (double) audioProcessor.morphReadback[i].rotAngle.load());
                obj->setProperty ("out", (double) audioProcessor.morphReadback[i].modOutput.load());
                morphArr.add (juce::var (obj));
            }
            data->setProperty ("morphHeads", juce::var (morphArr));
        }
    }

    // Lane playhead positions
    {
        int numLanes = audioProcessor.numActiveLanes.load();
        if (numLanes > 0)
        {
            juce::Array<juce::var> laneArr;
            for (int i = 0; i < numLanes && i < audioProcessor.maxLaneReadback; ++i)
            {
                auto* obj = new juce::DynamicObject();
                obj->setProperty ("id", audioProcessor.laneReadback[i].blockId.load());
                obj->setProperty ("li", audioProcessor.laneReadback[i].laneIdx.load());
                obj->setProperty ("ph", (double) audioProcessor.laneReadback[i].playhead.load());
                obj->setProperty ("val", (double) audioProcessor.laneReadback[i].value.load());
                obj->setProperty ("act", audioProcessor.laneReadback[i].active.load());
                laneArr.add (juce::var (obj));
            }
            data->setProperty ("laneHeads", juce::var (laneArr));
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // TWO-TIER PARAMETER POLLING
    // Modulated params (targeted by logic blocks): fast poll every tick (60Hz)
    // Idle params: slow poll every 15th tick (~4Hz)
    // This prevents 200+ param plugins like FabFilter Saturn from killing perf
    // ═══════════════════════════════════════════════════════════════
    {
        touchedParamId = {};

        // Drain self-write FIFO every tick (must keep up with audio thread)
        // Purpose: auto-locate exclusion ONLY — prevents params we wrote from
        // triggering the "touched by plugin UI" detection.
        // Does NOT promote to Tier 1 — that would add ALL modulated params back to fast polling.
        std::unordered_set<std::string> selfWritten;
        {
            const auto scope = audioProcessor.selfWriteFifo.read (
                audioProcessor.selfWriteFifo.getNumReady());
            for (int i = 0; i < scope.blockSize1; ++i)
            {
                auto& e = audioProcessor.selfWriteRing[scope.startIndex1 + i];
                selfWritten.insert (std::to_string (e.pluginId) + ":" + std::to_string (e.paramIndex));
            }
            for (int i = 0; i < scope.blockSize2; ++i)
            {
                auto& e = audioProcessor.selfWriteRing[scope.startIndex2 + i];
                selfWritten.insert (std::to_string (e.pluginId) + ":" + std::to_string (e.paramIndex));
            }
        }

        // Refresh modulated param set periodically (every ~0.5s)
        if (timerTickCount % 30 == 0)
            modulatedParamKeys = audioProcessor.getModulatedParamKeys();

        juce::Array<juce::var> paramUpdates;
        float biggestDelta = 0.0f;

        // ── TIER 1: Visible modulated + recently-changed params — fast read every tick (60Hz) ──
        // KEY OPTIMIZATION: Only poll params that are BOTH modulated AND visible on screen.
        // With 2000 modulated params but only ~8 visible, this reduces work by 99.6%.
        // Non-visible modulated params are still set by C++ audio thread — just no UI readback.
        //
        // recently-changed keys are always included (user is actively interacting with them,
        // and they expire after 2s).

        // Build tier1Keys: (modulated ∩ visible) ∪ recentlyChanged
        // JS includes both rack-visible AND lane-visible PIDs in visibleParamKeys,
        // so lane badges still update even when the plugin is collapsed in the rack.
        std::unordered_set<std::string> tier1Keys;
        if (!visibleParamKeys.empty())
        {
            // Iterate the smaller set (visible) and check membership in the larger (modulated)
            for (const auto& vk : visibleParamKeys)
            {
                if (modulatedParamKeys.count (vk) > 0)
                    tier1Keys.insert (vk);
            }
        }
        else
        {
            // No visible set from JS yet — fall back to old behavior (all modulated)
            tier1Keys = modulatedParamKeys;
        }
        // Always add recently-changed keys (user interaction, expires via TTL)
        for (auto& rc : recentlyChangedKeys)
            tier1Keys.insert (rc.first);

        if (!tier1Keys.empty())
        {
            for (const auto& key : tier1Keys)
            {
                auto idIt = paramIdentCache.find (key);
                if (idIt == paramIdentCache.end()) continue; // not yet cached by tier 2

                // Skip collapsed plugins — no point polling invisible params
                if (expandedPluginIds.count (idIt->second.pluginId) == 0) continue;

                float val = audioProcessor.getParamValueFast (idIt->second.pluginId, idIt->second.paramIndex);
                if (val < 0.0f) continue; // lock unavailable, skip

                auto lastIt = lastParamValues.find (key);
                bool changed = (lastIt == lastParamValues.end())
                            || (std::abs (val - lastIt->second) > 0.0005f);

                if (changed)
                {
                    auto* pObj = new juce::DynamicObject();
                    pObj->setProperty ("id", juce::String (key));
                    pObj->setProperty ("v", (double) val);

                    // Display text cache: only call the expensive getText() virtual
                    // when the value has moved enough that the string would change.
                    // Most plugins format to 1-2 decimal places, so 0.3% delta covers it.
                    auto& dtc = dispTextCache[key];
                    if (dtc.lastCalledAt < 0.0f
                        || std::abs (val - dtc.lastCalledAt) > 0.003f)
                    {
                        auto newText = audioProcessor.getParamDisplayTextFast (
                            idIt->second.pluginId, idIt->second.paramIndex);
                        if (newText != dtc.text)
                        {
                            dtc.text = newText;
                            pObj->setProperty ("disp", dtc.text);
                        }
                        dtc.lastCalledAt = val;
                    }

                    paramUpdates.add (juce::var (pObj));

                    // Keep recently-changed alive while still changing
                    if (modulatedParamKeys.count (key) == 0)
                        recentlyChangedKeys[key] = 120; // refresh TTL
                }

                // Modulated params NEVER trigger auto-locate
                // — they change constantly from logic blocks, not user interaction
                lastParamValues[key] = val;
            }
        }

        // Decrement TTLs on recently-changed keys, expire old ones
        for (auto it = recentlyChangedKeys.begin(); it != recentlyChangedKeys.end(); )
        {
            if (--(it->second) <= 0)
                it = recentlyChangedKeys.erase (it);
            else
                ++it;
        }

        // ── TIER 2: IDLE params — sliding-window scan every 10th tick (~6Hz) ──
        // Scans at most BATCH_SIZE params per tick to spread CPU cost.
        // Uses getParamValueFast() + getParamDisplayTextFast() instead of getHostedParams()
        // to avoid pluginMutex contention and expensive getText() calls on unchanged params.
        if (timerTickCount % 10 == 0)
        {
            // Rebuild identity cache periodically (every 60 ticks = ~1s) to pick up new plugins
            bool rebuildCache = (timerTickCount % 60 == 0);
            if (rebuildCache)
            {
                // Use getHostedPluginList + getHostedParams ONLY for initial discovery
                // Skip collapsed plugins — no visible rows to update, saves getText() calls
                auto pluginList = audioProcessor.getHostedPluginList();
                for (const auto& plugInfo : pluginList)
                {
                    if (expandedPluginIds.count (plugInfo.id) == 0)
                        continue;

                    auto params = audioProcessor.getHostedParams (plugInfo.id);
                    for (const auto& p : params)
                    {
                        auto paramId = juce::String (plugInfo.id) + ":" + juce::String (p.index);
                        auto key = paramId.toStdString();
                        paramIdentCache[key] = { plugInfo.id, p.index };
                    }
                }
            }
            // Rebuild flat vector for O(1) sliding window access
            if (rebuildCache)
            {
                paramIdentVec.clear();
                paramIdentVec.reserve (paramIdentCache.size());
                for (const auto& kv : paramIdentCache)
                    paramIdentVec.push_back (kv);
            }

            // Sliding window: scan at most BATCH_SIZE idle params per tick
            constexpr int BATCH_SIZE = 200;
            int totalParams = (int) paramIdentVec.size();
            if (totalParams > 0)
            {
                // Advance window position, wrap around
                if (tier2ScanOffset >= totalParams)
                    tier2ScanOffset = 0;

                int endIdx = std::min (tier2ScanOffset + BATCH_SIZE, totalParams);
                for (int vi = tier2ScanOffset; vi < endIdx; ++vi)
                {
                    const auto& [key, ident] = paramIdentVec[vi];

                    // Skip modulated params — Tier 1 handles them at 60Hz
                    if (modulatedParamKeys.count (key) > 0)
                        continue;

                    // Skip recently-changed keys — tier 1 handles them at 60Hz
                    if (recentlyChangedKeys.count (key) > 0)
                        continue;

                    // Skip collapsed plugins — no visible rows to update
                    if (expandedPluginIds.count (ident.pluginId) == 0)
                        continue;

                    float val = audioProcessor.getParamValueFast (ident.pluginId, ident.paramIndex);
                    if (val < 0.0f) continue;

                    auto lastIt = lastParamValues.find (key);
                    bool changed = (lastIt == lastParamValues.end())
                                || (std::abs (val - lastIt->second) > 0.0005f);

                    if (changed)
                    {
                        auto* pObj = new juce::DynamicObject();
                        pObj->setProperty ("id", juce::String (key));
                        pObj->setProperty ("v", (double) val);

                        // Display text cache: same optimization as Tier 1
                        auto& dtc = dispTextCache[key];
                        if (dtc.lastCalledAt < 0.0f
                            || std::abs (val - dtc.lastCalledAt) > 0.003f)
                        {
                            auto newText = audioProcessor.getParamDisplayTextFast (
                                ident.pluginId, ident.paramIndex);
                            if (newText != dtc.text)
                            {
                                dtc.text = newText;
                                pObj->setProperty ("disp", dtc.text);
                            }
                            dtc.lastCalledAt = val;
                        }

                        paramUpdates.add (juce::var (pObj));

                        // Promote to fast poll — user is actively interacting
                        recentlyChangedKeys[key] = 120; // 2 seconds at 60Hz
                    }

                    // Auto-locate for idle params
                    if (lastIt != lastParamValues.end() && selfWritten.count (key) == 0)
                    {
                        float delta = std::abs (val - lastIt->second);
                        if (delta > 0.0005f && delta > biggestDelta)
                        {
                            biggestDelta = delta;
                            touchedParamId = juce::String (key);
                        }
                    }
                    lastParamValues[key] = val;
                }

                tier2ScanOffset += BATCH_SIZE;

                // Periodic cache cleanup (every ~10s): remove entries for params
                // that no longer exist (plugin removed, etc.)
                if (timerTickCount % 600 == 0 && dispTextCache.size() > paramIdentCache.size() * 2)
                {
                    for (auto it = dispTextCache.begin(); it != dispTextCache.end(); )
                    {
                        if (paramIdentCache.count (it->first) == 0)
                            it = dispTextCache.erase (it);
                        else
                            ++it;
                    }
                }
            }
        }

        if (paramUpdates.size() > 0)
            data->setProperty ("params", juce::var (paramUpdates));

        if (touchedParamId.isNotEmpty())
            data->setProperty ("touchedParam", touchedParamId);
    }

    // ── Proxy sync: read atomic cache from audio thread, apply on message thread ──
    audioProcessor.syncProxyCacheToHost();

    // ── Block proxy sync: forward DAW automation to JS block params ──
    {
        auto blockUpdates = audioProcessor.drainBlockProxyCache();
        for (auto& upd : blockUpdates)
        {
            auto js = juce::String ("if(typeof setBlockParamFromDAW==='function')setBlockParamFromDAW(")
                    + juce::String (upd.blockId) + ",'"
                    + upd.paramKey.replace ("'", "\\'") + "',"
                    + juce::String (upd.value, 6) + ");";
            webView->evaluateJavascript (js, nullptr);
        }
    }

    // Crash notifications from audio thread (lock-free FIFO read)
    {
        const auto cScope = audioProcessor.crashFifo.read (audioProcessor.crashFifo.getNumReady());
        for (int i = 0; i < cScope.blockSize1; ++i)
        {
            const auto& ce = audioProcessor.crashRing[cScope.startIndex1 + i];
            auto* cObj = new juce::DynamicObject();
            cObj->setProperty ("pluginId", ce.pluginId);
            cObj->setProperty ("pluginName", juce::String (ce.pluginName));
            cObj->setProperty ("reason", juce::String (ce.reason));
            webView->emitEventIfBrowserIsVisible ("__plugin_crashed__", juce::var (cObj));
        }
        for (int i = 0; i < cScope.blockSize2; ++i)
        {
            const auto& ce = audioProcessor.crashRing[cScope.startIndex2 + i];
            auto* cObj = new juce::DynamicObject();
            cObj->setProperty ("pluginId", ce.pluginId);
            cObj->setProperty ("pluginName", juce::String (ce.pluginName));
            cObj->setProperty ("reason", juce::String (ce.reason));
            webView->emitEventIfBrowserIsVisible ("__plugin_crashed__", juce::var (cObj));
        }
    }

    // ── Spectrum analyzer data for WrongEQ (~20Hz update) ──
    if (timerTickCount % 3 == 0)
    {
        float specBins[HostesaAudioProcessor::spectrumBinCount];
        int n = audioProcessor.getSpectrumBins (specBins, HostesaAudioProcessor::spectrumBinCount);
        if (n > 0)
        {
            juce::Array<juce::var> specArr;
            specArr.ensureStorageAllocated (n);
            for (int i = 0; i < n; ++i)
                specArr.add ((double) specBins[i]);
            data->setProperty ("spectrum", juce::var (specArr));
        }
    }
    // ── WrongEQ readback: push C++ eqPoints atomics to JS (~10Hz) ──
    // When C++ modulation writes to eqPoints (via setParamDirect), JS needs to know
    // so it can update canvas + virtual param displays. Only send if there are EQ points.
    if (timerTickCount % 6 == 0)
    {
        HostesaAudioProcessor::WeqReadbackPoint weqPts[8];
        int nPts = audioProcessor.getWeqReadback (weqPts, 8);
        if (nPts > 0)
        {
            juce::Array<juce::var> weqArr;
            weqArr.ensureStorageAllocated (nPts);
            for (int i = 0; i < nPts; ++i)
            {
                auto* pt = new juce::DynamicObject();
                pt->setProperty ("freq", (double) weqPts[i].freqHz);
                pt->setProperty ("gain", (double) weqPts[i].gainDB);
                pt->setProperty ("q",    (double) weqPts[i].q);
                pt->setProperty ("drift",(double) weqPts[i].driftPct);
                weqArr.add (juce::var (pt));
            }
            data->setProperty ("weqReadback", juce::var (weqArr));
        }

        // Send global EQ params too (modulation can change them)
        {
            auto wg = audioProcessor.getWeqGlobals();
            auto* gObj = new juce::DynamicObject();
            gObj->setProperty ("depth", (double) wg.depth);
            gObj->setProperty ("warp",  (double) wg.warp);
            gObj->setProperty ("steps", (int) wg.steps);
            gObj->setProperty ("tilt",  (double) wg.tilt);
            data->setProperty ("weqGlobals", juce::var (gObj));
        }
    }

    webView->emitEventIfBrowserIsVisible ("__rt_data__", juce::var (data));
}

std::optional<juce::WebBrowserComponent::Resource>
HostesaAudioProcessorEditor::getResource (const juce::String& url)
{
    const auto urlToRetrieve = url == "/" ? juce::String { "index.html" }
                                         : url.fromFirstOccurrenceOf ("/", false, false);

#if JUCE_DEBUG
    DBG ("Resource requested: " + url + " → resolved: " + urlToRetrieve);
#endif

    // Generic BinaryData lookup — iterate all registered resources
    for (int i = 0; i < BinaryData::namedResourceListSize; ++i)
    {
        const char* resourceName = BinaryData::namedResourceList[i];
        const char* originalFilename = BinaryData::getNamedResourceOriginalFilename (resourceName);

        if (originalFilename != nullptr && urlToRetrieve.endsWith (juce::String (originalFilename)))
        {
            int dataSize = 0;
            const char* data = BinaryData::getNamedResource (resourceName, dataSize);

            if (data != nullptr && dataSize > 0)
            {
                std::vector<std::byte> byteData (static_cast<size_t> (dataSize));
                std::memcpy (byteData.data(), data, static_cast<size_t> (dataSize));

                auto ext = urlToRetrieve.fromLastOccurrenceOf (".", false, false).toLowerCase();
                auto mime = getMimeForExtension (ext);

#if JUCE_DEBUG
                DBG ("Resource FOUND: " + urlToRetrieve + " (" + juce::String (dataSize) + " bytes, " + mime + ")");
#endif

                return juce::WebBrowserComponent::Resource { std::move (byteData), juce::String { mime } };
            }
        }
    }

#if JUCE_DEBUG
    DBG ("Resource NOT FOUND: " + urlToRetrieve);
#endif

    return std::nullopt;
}

const char* HostesaAudioProcessorEditor::getMimeForExtension (const juce::String& extension)
{
    static const std::unordered_map<juce::String, const char*> mimeMap =
    {
        { { "html" }, "text/html" },
        { { "css"  }, "text/css" },
        { { "js"   }, "text/javascript" },
        { { "json" }, "application/json" },
        { { "png"  }, "image/png" },
        { { "jpg"  }, "image/jpeg" },
        { { "svg"  }, "image/svg+xml" },
        { { "ttf"  }, "font/ttf" },
        { { "woff" }, "font/woff" },
        { { "woff2"}, "font/woff2" }
    };

    if (const auto it = mimeMap.find (extension.toLowerCase()); it != mimeMap.end())
        return it->second;

    return "text/plain";
}

void HostesaAudioProcessorEditor::openPluginEditorWindow (int pluginId)
{
    // Toggle: if already open, close it
    auto it = pluginEditorWindows.find (pluginId);
    if (it != pluginEditorWindows.end())
    {
        pluginEditorWindows.erase (it);
        return;
    }

    // Get the plugin instance
    auto* instance = audioProcessor.getHostedPluginInstance (pluginId);
    if (instance == nullptr)
    {
        DBG ("openPluginEditorWindow: plugin ID " + juce::String (pluginId) + " not found");
        return;
    }

    // Find the plugin name for the window title
    juce::String windowTitle = "Plugin Editor";
    auto pluginList = audioProcessor.getHostedPluginList();
    for (const auto& info : pluginList)
    {
        if (info.id == pluginId)
        {
            windowTitle = info.name;
            break;
        }
    }

    // Create the editor window
    pluginEditorWindows[pluginId] = std::make_unique<PluginEditorWindow> (
        windowTitle,
        instance,
        [this, pluginId]()
        {
            // Schedule removal to avoid deleting during callback
            juce::Component::SafePointer<HostesaAudioProcessorEditor> safeThis (this);
            juce::MessageManager::callAsync ([safeThis, pluginId]()
            {
                if (safeThis != nullptr)
                    safeThis->pluginEditorWindows.erase (pluginId);
            });
        }
    );
}
