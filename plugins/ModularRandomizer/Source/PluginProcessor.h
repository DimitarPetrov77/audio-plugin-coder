#pragma once

#ifdef _WIN32
#include <windows.h>
#endif

#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_audio_utils/juce_audio_utils.h>
#include <juce_gui_extra/juce_gui_extra.h>
#include <juce_dsp/juce_dsp.h>
#include <atomic>
#include <array>
#include <mutex>
#include <sstream>

// Debug logger — outputs to debugger console only, no disk I/O.
// Uses DBG in Debug builds; compiles to nothing in Release.
#ifdef JUCE_DEBUG
  #define LOG_TO_FILE(msg) do { \
      std::ostringstream _oss; _oss << msg; \
      DBG (_oss.str()); \
  } while(0)
#else
  #define LOG_TO_FILE(msg) do {} while(0)
#endif

//==============================================================================
/**
 * Hostesa - Multi-Plugin Parameter Host
 *
 * Hosts multiple VST3 plugins, exposes their parameters,
 * and allows randomization via the WebView UI.
 */

struct HostedPlugin
{
    int id = 0;
    juce::String name;
    juce::String path;
    std::unique_ptr<juce::AudioPluginInstance> instance;
    juce::PluginDescription description;
    bool prepared = false;
    bool bypassed = false;
    bool crashed  = false;      // true if plugin threw/faulted during processBlock
    bool isInstrument = false;  // true if synth/sampler — buffer zeroed before processBlock
    int crashCount = 0;         // lifetime crash counter
    int busId = 0;              // parallel bus ID (0 = default/main)
};

/** SEH-guarded processBlock wrapper.
    Isolated as a free function because __try/__except cannot coexist
    with C++ objects that have destructors in the same function scope. */
bool sehGuardedProcessBlock (juce::AudioPluginInstance* instance,
                             juce::AudioBuffer<float>& buffer,
                             juce::MidiBuffer& midi);

/** SEH-guarded releaseResources — catches hardware faults during plugin cleanup */
bool sehReleaseResources (juce::AudioPluginInstance* instance);

/** SEH-guarded instance destruction — catches hardware faults in plugin destructors.
    Takes ownership of the raw pointer and deletes it. */
bool sehDestroyInstance (juce::AudioPluginInstance* rawInstance);

/** A parameter with a dynamically changeable display name and range.
    Used for the proxy parameter pool so the DAW shows
    meaningful names like "Vital: Cutoff" instead of "Slot 1". */
class ProxyParameter : public juce::AudioParameterFloat
{
public:
    ProxyParameter (const juce::ParameterID& paramID, const juce::String& defaultName,
                    const juce::NormalisableRange<float>& range, float defaultVal)
        : juce::AudioParameterFloat (paramID, defaultName, range, defaultVal),
          dynamicName (defaultName) {}

    juce::String getName (int maxLen) const override
    {
        const juce::SpinLock::ScopedLockType sl (nameLock);
        return dynamicName.substring (0, maxLen);
    }

    void setDynamicName (const juce::String& newName)
    {
        const juce::SpinLock::ScopedLockType sl (nameLock);
        dynamicName = newName;
    }

    /** Set discrete option labels — DAW shows these in automation dropdown */
    void setDiscreteOptions (const juce::StringArray& opts)
    {
        const juce::SpinLock::ScopedLockType sl (nameLock);
        discreteOptions = opts;
        numDiscreteSteps = opts.size();
    }

    /** Set float display suffix and range for text display */
    void setDisplayInfo (const juce::String& suffix, float dispMin, float dispMax)
    {
        const juce::SpinLock::ScopedLockType sl (nameLock);
        displaySuffix = suffix;
        displayMin = dispMin;
        displayMax = dispMax;
        numDiscreteSteps = 0;
    }

    void clearDisplayInfo()
    {
        const juce::SpinLock::ScopedLockType sl (nameLock);
        discreteOptions.clear();
        displaySuffix = "";
        numDiscreteSteps = 0;
    }

    juce::String getText (float normValue, int /*maxLen*/) const override
    {
        const juce::SpinLock::ScopedLockType sl (nameLock);
        if (numDiscreteSteps > 0 && discreteOptions.size() > 0)
        {
            int idx = juce::jlimit (0, discreteOptions.size() - 1,
                                     (int) std::round (normValue * (discreteOptions.size() - 1)));
            return discreteOptions[idx];
        }
        if (displaySuffix.isNotEmpty())
        {
            float val = displayMin + normValue * (displayMax - displayMin);
            return juce::String (val, 1) + displaySuffix;
        }
        return juce::String (normValue, 3);
    }

    float getValueForText (const juce::String& text) const override
    {
        const juce::SpinLock::ScopedLockType sl (nameLock);
        if (numDiscreteSteps > 0 && discreteOptions.size() > 0)
        {
            int idx = discreteOptions.indexOf (text);
            if (idx >= 0) return (float) idx / (float) (discreteOptions.size() - 1);
        }
        return text.getFloatValue();
    }

    int getNumSteps() const override
    {
        const juce::SpinLock::ScopedLockType sl (nameLock);
        return numDiscreteSteps > 0 ? numDiscreteSteps : 0x7fffffff;
    }

    bool isDiscrete() const override
    {
        const juce::SpinLock::ScopedLockType sl (nameLock);
        return numDiscreteSteps > 0;
    }

    bool isBoolean() const override
    {
        const juce::SpinLock::ScopedLockType sl (nameLock);
        return numDiscreteSteps == 2;
    }

private:
    mutable juce::SpinLock nameLock;
    juce::String dynamicName;
    juce::StringArray discreteOptions;
    juce::String displaySuffix;
    float displayMin = 0.0f;
    float displayMax = 1.0f;
    int numDiscreteSteps = 0;
};

struct ScannedPlugin
{
    juce::String name;
    juce::String vendor;
    juce::String category;
    juce::String path;
    juce::String format;
    int numParams = 0;
};

/** Audio sample data loaded for Sample Modulator blocks.
    Shared via shared_ptr so audio thread can hold a reference
    while message thread replaces it. */
struct SampleData
{
    juce::AudioBuffer<float> buffer;    // mono, at original sample rate
    double sampleRate = 44100.0;
    juce::String filePath;
    juce::String fileName;
    std::vector<float> waveformPeaks;   // downsampled peak values for UI (~200 points)
    float durationSeconds = 0.0f;
};

class HostesaAudioProcessor : public juce::AudioProcessor,
                                        public juce::AudioProcessorValueTreeState::Listener,
                                        public juce::AudioProcessorParameter::Listener
{
public:
    //==============================================================================
    HostesaAudioProcessor();
    ~HostesaAudioProcessor() override;

    //==============================================================================
    void prepareToPlay (double sampleRate, int samplesPerBlock) override;
    void releaseResources() override;

   #ifndef JucePlugin_PreferredChannelConfigurations
    bool isBusesLayoutSupported (const BusesLayout& layouts) const override;
   #endif

    void processBlock (juce::AudioBuffer<float>&, juce::MidiBuffer&) override;

    //==============================================================================
    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override;

    //==============================================================================
    const juce::String getName() const override;
    bool acceptsMidi() const override;
    bool producesMidi() const override;
    bool isMidiEffect() const override;
    double getTailLengthSeconds() const override;

    //==============================================================================
    int getNumPrograms() override;
    int getCurrentProgram() override;
    void setCurrentProgram (int index) override;
    const juce::String getProgramName (int index) override;
    void changeProgramName (int index, const juce::String& newName) override;

    //==============================================================================
    void getStateInformation (juce::MemoryBlock& destData) override;
    void setStateInformation (const void* data, int sizeInBytes) override;

    //==============================================================================
    juce::AudioProcessorValueTreeState& getAPVTS() { return apvts; }

    //==============================================================================
    // Plugin Hosting API (called from Editor via native functions)
    //==============================================================================

    /** Scan VST3 directories and return found plugins */
    std::vector<ScannedPlugin> scanForPlugins (const juce::StringArray& paths);

    /** Delete the plugin scan cache — forces a full rescan on next call */
    void clearPluginCache();

    /** Get current scan progress for UI feedback */
    struct ScanProgress { juce::String currentPlugin; float progress; bool scanning; };
    ScanProgress getScanProgress();

    // Scan progress state (written by scan thread, read by UI via getScanProgress)
    std::mutex scanProgressMutex;
    juce::String scanProgressName;
    std::atomic<float> scanProgressFraction { 0.0f };
    std::atomic<bool>  scanActive { false };

    /** Load a VST3 plugin by file path, returns the hosted plugin ID or -1 */
    int loadPlugin (const juce::String& pluginPath);

    /** Phase 1: Find plugin description from cache or disk scan (thread-safe) */
    bool findPluginDescription (const juce::String& pluginPath,
                                 juce::PluginDescription& descOut);

    /** Phase 2: Instantiate from description (message thread only — COM) */
    int instantiatePlugin (const juce::PluginDescription& desc);

    /** Remove a hosted plugin by ID */
    void removePlugin (int pluginId);

    /** Garbage-collect dead plugin entries (call from message thread only) */
    void purgeDeadPlugins();

    /** Reorder hosted plugins to match the given ID order from the UI */
    void reorderPlugins (const std::vector<int>& orderedIds);

    /** Get parameter info for a hosted plugin */
    struct ParamInfo {
        int index;
        juce::String name;
        float value;        // normalised 0-1
        juce::String label;
        juce::String displayText;  // formatted value from plugin (e.g. "440 Hz", "50%")
        bool automatable;
    };
    std::vector<ParamInfo> getHostedParams (int pluginId);

    /** Set a parameter on a hosted plugin (instant, for UI knob turns) */
    void setHostedParam (int pluginId, int paramIndex, float normValue);

    /** Start a smooth parameter glide (called from JS, processed per-buffer in processBlock) */
    void startGlide (int pluginId, int paramIndex, float targetValue, float durationMs);

    /** Update logic blocks from UI JSON (called from Editor native function) */
    void updateLogicBlocks (const juce::String& jsonData);

    /** Lightweight morph playhead update (called from drag — avoids full JSON reparse) */
    void updateMorphPlayhead (int blockId, float x, float y);

    /** Fire a manual oneshot trigger on a specific lane */
    void fireLaneTrigger (int blockId, int laneIdx);

    /** Randomize specific parameters on a hosted plugin */
    void randomizeParams (int pluginId, const std::vector<int>& paramIndices,
                          float minVal, float maxVal);

    /** Bypass or unbypass a hosted plugin (audio thread safe) */
    void setPluginBypass (int pluginId, bool bypass);

    /** Reset a crashed plugin so it can process again */
    void resetPluginCrash (int pluginId);

    /** Get the list of currently hosted plugins (for UI) */
    struct HostedPluginInfo {
        int id;
        juce::String name;
        juce::String path;
        juce::String manufacturer;
        int numParams;
        int busId;
        bool isInstrument;
    };
    std::vector<HostedPluginInfo> getHostedPluginList();

    /** Get a raw pointer to a hosted plugin instance (for opening its editor) */
    juce::AudioPluginInstance* getHostedPluginInstance (int pluginId);

    /** Get factory preset (program) names from a hosted plugin */
    struct FactoryPresetInfo { int index; juce::String name; juce::String filePath; };
    std::vector<FactoryPresetInfo> getFactoryPresets (int pluginId);

    /** Load a factory preset by program index, returns all param values after switch */
    std::vector<ParamInfo> loadFactoryPreset (int pluginId, int programIndex);

    /** Load a factory preset from a .vstpreset file, returns all param values after load */
    std::vector<ParamInfo> loadFactoryPresetFromFile (int pluginId, const juce::String& filePath);

    /** Preset indexing — scan all VST3 preset directories once, cache to disk */
    void buildPresetIndex();
    std::vector<FactoryPresetInfo> getIndexedPresets (const juce::String& pluginName, const juce::String& vendorName);
    bool isPresetIndexReady() const { return presetIndexReady.load(); }

    // Preset index internals
    std::map<juce::String, std::vector<FactoryPresetInfo>> presetIndex;
    std::mutex presetIndexMutex;
    std::atomic<bool> presetIndexReady { false };
    juce::File getPresetIndexFile() const;
    void savePresetIndexToFile();
    bool loadPresetIndexFromFile();

    /** Set the parallel bus ID for a hosted plugin */
    void setPluginBusId (int pluginId, int busId);

    /** Routing mode: 0=sequential, 1=parallel, 2=wrongeq */
    int  getRoutingMode() const    { return routingMode.load(); }
    void setRoutingMode (int mode) { routingMode.store (juce::jlimit (0, 2, mode)); }

    /** WrongEQ: receive EQ curve data from JS */
    void setEqCurve (const juce::String& jsonData);

    /** WrongEQ fast path: update a single field on one EQ point (no JSON, no alloc).
        field: "freq", "gain", "q", "solo", "mute", "type", "slope", "drift", "stereo" */
    void setEqPointFast (int pointIndex, const juce::String& field, double value);

    void setBusVolume (int bus, float vol);
    void setBusMute  (int bus, bool m);
    void setBusSolo  (int bus, bool s);

    //==============================================================================
    // File System Helpers — organized preset directory structure
    //==============================================================================

    /** Root data directory: %APPDATA%/DimitarPetrov/Hostesa (Win)
                             ~/Library/DimitarPetrov/Hostesa (Mac)
                             ~/.local/share/DimitarPetrov/Hostesa (Linux, future) */
    static juce::File getDataRoot()
    {
        return juce::File::getSpecialLocation (juce::File::userApplicationDataDirectory)
            .getChildFile ("DimitarPetrov/Hostesa");
    }

    static juce::File getChainsDir()    { return getDataRoot().getChildFile ("Chains"); }
    static juce::File getSnapshotsDir() { return getDataRoot().getChildFile ("Snapshots"); }
    static juce::File getEqPresetsDir() { return getDataRoot().getChildFile ("EqPresets"); }
    static juce::File getImportDir()    { return getChainsDir().getChildFile ("_Import"); }

    /** Strip characters that are invalid in file/folder names on any OS */
    static juce::String sanitizeForFilename (const juce::String& name)
    {
        return name.removeCharacters ("\\/:*?\"<>|")
                   .trimStart().trimEnd()
                   .substring (0, 100);
    }

    /** One-time migration from old flat structure to new organized structure */
    void migrateOldPresets();

    /** Platform-appropriate default VST3 scan directories */
    static juce::StringArray getDefaultScanPaths()
    {
        juce::StringArray paths;
#if JUCE_MAC
        paths.add ("/Library/Audio/Plug-Ins/VST3");
        paths.add (juce::File::getSpecialLocation (juce::File::userHomeDirectory)
                       .getChildFile ("Library/Audio/Plug-Ins/VST3").getFullPathName());
#elif JUCE_WINDOWS
        paths.add ("C:\\Program Files\\Common Files\\VST3");
        paths.add ("C:\\Program Files\\VSTPlugins");
#elif JUCE_LINUX
        paths.add (juce::File::getSpecialLocation (juce::File::userHomeDirectory)
                       .getChildFile (".vst3").getFullPathName());
        paths.add ("/usr/lib/vst3");
        paths.add ("/usr/local/lib/vst3");
#endif
        return paths;
    }

    /** UI state persistence — blocks, mappings, locks, order stored as JSON */
    void setUiState (const juce::String& json);
    juce::String getUiState() const;

    //==============================================================================
    // Sample Modulator API
    //==============================================================================

    /** Load an audio file for a specific logic block. Returns true on success. */
    bool loadSampleForBlock (int blockId, const juce::String& filePath);

    /** Get downsampled waveform peaks for UI display. */
    std::vector<float> getSampleWaveform (int blockId);

    /** Get the sample file name for a block (empty if none loaded). */
    juce::String getSampleFileName (int blockId);

private:
    //==============================================================================
    juce::AudioProcessorValueTreeState::ParameterLayout createParameterLayout();
    juce::AudioProcessorValueTreeState apvts;

    //==============================================================================
    // Plugin Hosting Engine
    //==============================================================================
    juce::AudioPluginFormatManager formatManager;
    juce::KnownPluginList knownPlugins;
    juce::AudioFormatManager audioFileFormatManager;  // WAV, AIFF, FLAC, etc.

    std::vector<std::unique_ptr<HostedPlugin>> hostedPlugins;
    std::mutex pluginMutex;
    int nextPluginId = 0;

    // Routing mode: 0 = sequential (chain), 1 = parallel (split/sum), 2 = wrongeq (band-split)
    std::atomic<int> routingMode { 0 };
    static constexpr int maxBuses = 8;
    juce::AudioBuffer<float> busBuffers[maxBuses];  // pre-allocated in prepareToPlay

    // Per-bus mixer state (parallel mode)
    std::atomic<float> busVolume[maxBuses]  { 1.0f, 1.0f, 1.0f, 1.0f, 1.0f, 1.0f, 1.0f, 1.0f };
    std::atomic<bool>  busMute[maxBuses]    { false, false, false, false, false, false, false, false };
    std::atomic<bool>  busSolo[maxBuses]    { false, false, false, false, false, false, false, false };

    double currentSampleRate = 44100.0;
    int currentBlockSize = 512;

    // Pre-allocated scratch buffers (sized in prepareToPlay, never allocate on audio thread)
    juce::AudioBuffer<float> dryBuffer;      // dry signal copy for wet/dry mix
    juce::AudioBuffer<float> synthAccum;     // accumulates layered synth outputs (sequential mode)
    struct MidiTrigEvent { int note; int vel; int ch; bool isCC; };
    std::vector<MidiTrigEvent> blockMidiEvents;  // MIDI events for trigger matching
    static constexpr int kMaxBlockMidi = 128;

    // ── WrongEQ: band-split DSP ──
    // Crossover filter bank: 2 crossovers per EQ point (lo/hi Q edges).
    // Each bell creates an exact Q-width band. Gap bands between bells are passthrough.
    // N points → 2N crossovers → 2N+1 bands.
    // Allpass compensation: each (crossover, lower-band) pair has its OWN allpass filter
    // to maintain phase coherence across all bands (mastering-grade transparency).
    static constexpr int maxEqBands = 8;  // max user EQ points
    static constexpr int maxCrossovers = maxEqBands * 2;  // 2 crossovers per point (lo + hi Q edge)
    static constexpr int maxXoverBands = maxCrossovers + 1;  // 2N+1 bands
    static constexpr int kWeqPluginId = -100; // matches JS WEQ_VIRTUAL_ID — used as pluginId for WrongEQ params
    static constexpr int kWeqGlobalBase = 100; // Global params start at index 100 (matches JS cppIndex offsets)
    static constexpr int kWeqGlobalCount = 11; // depth(100)..lfoDep(110)

    // ── SVF-based LR4 crossover filter ──
    // Linkwitz-Riley 4th order = two cascaded Butterworth 2nd-order SVFs (Q = 1/√2).
    // Per-sample coefficient interpolation eliminates thumps on frequency changes.
    struct SVFLR4 {
        // Single SVF stage (2nd-order Butterworth, Q = 1/√2 → k = √2)
        struct SVFStage {
            float ic1eq = 0.0f, ic2eq = 0.0f;
            float g = 0.0f, a1c = 1.0f, a2c = 0.0f, a3c = 0.0f;
            float dg = 0.0f, da1c = 0.0f, da2c = 0.0f, da3c = 0.0f;
            float tgt_g = 0.0f, tgt_a1c = 1.0f, tgt_a2c = 0.0f, tgt_a3c = 0.0f;
            bool paramsSet = false;

            inline void setTarget (float freqHz, float sampleRate, int nSamples)
            {
                static constexpr float kBW = 1.41421356237f;
                tgt_g = std::tan (juce::MathConstants<float>::pi * freqHz / sampleRate);
                tgt_a1c = 1.0f / (1.0f + tgt_g * (tgt_g + kBW));
                tgt_a2c = tgt_g * tgt_a1c;
                tgt_a3c = tgt_g * tgt_a2c;
                if (! paramsSet) {
                    g = tgt_g; a1c = tgt_a1c; a2c = tgt_a2c; a3c = tgt_a3c;
                    dg = da1c = da2c = da3c = 0.0f;
                    paramsSet = true;
                } else {
                    float inv = 1.0f / (float) juce::jmax (1, nSamples);
                    dg   = (tgt_g   - g)   * inv;
                    da1c = (tgt_a1c - a1c) * inv;
                    da2c = (tgt_a2c - a2c) * inv;
                    da3c = (tgt_a3c - a3c) * inv;
                }
            }
            inline void step() { g += dg; a1c += da1c; a2c += da2c; a3c += da3c; }
            inline void snapToTarget() { g = tgt_g; a1c = tgt_a1c; a2c = tgt_a2c; a3c = tgt_a3c; }

            // Process one sample, returns LP output. HP = in - k*bp - lp
            inline float tickLP (float in)
            {
                float v3 = in - ic2eq;
                float v1 = a1c * ic1eq + a2c * v3;
                float v2 = ic2eq + a2c * ic1eq + a3c * v3;
                ic1eq = 2.0f * v1 - ic1eq;
                ic2eq = 2.0f * v2 - ic2eq;
                if (std::abs(ic1eq) < 1e-20f) ic1eq = 0.0f;
                if (std::abs(ic2eq) < 1e-20f) ic2eq = 0.0f;
                return v2; // lowpass
            }
            inline float tickHP (float in)
            {
                static constexpr float kBW = 1.41421356237f;
                float v3 = in - ic2eq;
                float v1 = a1c * ic1eq + a2c * v3;
                float v2 = ic2eq + a2c * ic1eq + a3c * v3;
                ic1eq = 2.0f * v1 - ic1eq;
                ic2eq = 2.0f * v2 - ic2eq;
                if (std::abs(ic1eq) < 1e-20f) ic1eq = 0.0f;
                if (std::abs(ic2eq) < 1e-20f) ic2eq = 0.0f;
                return in - kBW * v1 - v2; // highpass
            }
            void reset() { ic1eq = ic2eq = 0.0f; paramsSet = false; }
        };

        // 4 stages: 2 for LP cascade, 2 for HP cascade
        SVFStage lp1, lp2, hp1, hp2;

        inline void setTarget (float freqHz, float sampleRate, int nSamples) {
            lp1.setTarget(freqHz, sampleRate, nSamples);
            lp2.setTarget(freqHz, sampleRate, nSamples);
            hp1.setTarget(freqHz, sampleRate, nSamples);
            hp2.setTarget(freqHz, sampleRate, nSamples);
        }
        inline void step() { lp1.step(); lp2.step(); hp1.step(); hp2.step(); }
        inline void snapToTarget() { lp1.snapToTarget(); lp2.snapToTarget(); hp1.snapToTarget(); hp2.snapToTarget(); }

        // Process one sample: LR4 LP = LP2(LP1(x)), LR4 HP = HP2(HP1(x))
        inline void tick (float in, float& lp_out, float& hp_out)
        {
            lp_out = lp2.tickLP(lp1.tickLP(in));
            hp_out = hp2.tickHP(hp1.tickHP(in));
        }

        // Allpass output = LP + HP (LR4 property)
        inline float tickAllpass (float in)
        {
            float lp, hp;
            tick(in, lp, hp);
            return lp + hp;
        }

        void reset() { lp1.reset(); lp2.reset(); hp1.reset(); hp2.reset(); }
    };

    // Crossover band: one LR4 pair per crossover point, per channel
    struct CrossoverBand {
        SVFLR4 filters[2]; // per-channel (stereo max)
        float cutoffHz = 1000.0f;
        float targetCutoffHz = 1000.0f;
        bool active = false;

        void prepare (float sampleRate, int nSamples)
        {
            cutoffHz = targetCutoffHz;
            for (int ch = 0; ch < 2; ++ch)
                filters[ch].setTarget(cutoffHz, sampleRate, nSamples);
        }
        void reset() { for (int ch = 0; ch < 2; ++ch) filters[ch].reset(); }
    };

    CrossoverBand crossovers[maxCrossovers];
    // Per-(crossover, lower-band) allpass filters for phase compensation — per channel
    SVFLR4 allpassComp[maxCrossovers][maxCrossovers][2]; // [xover][lower_band][channel]
    juce::AudioBuffer<float> eqBandBuffers[maxXoverBands];
    int numEqBands = 0;
    float eqBandGain[maxXoverBands];
    // TPT State Variable Filter (Cytomic / Zavalishin topology).
    // Immune to zipper noise: integrator state remains valid across parameter changes.
    // Parameters (freq, gain, Q) can change every sample with zero artifacts.
    static constexpr int maxEqChannels = 2;

    struct SVFEqFilter {
        float ic1eq = 0.0f, ic2eq = 0.0f; // integrator states

        // Current interpolated coefficients (advanced per sample via deltas)
        float g = 0.0f, k = 1.0f, a1c = 1.0f, a2c = 0.0f, a3c = 0.0f;
        float A = 1.0f;
        int   cachedType = 0;

        // Target coefficients (computed once per buffer from target params)
        float tgt_g = 0.0f, tgt_k = 1.0f, tgt_a1c = 1.0f, tgt_a2c = 0.0f, tgt_a3c = 0.0f;
        float tgt_A = 1.0f;

        // Per-sample deltas for linear interpolation
        float dg = 0.0f, dk = 0.0f, da1c = 0.0f, da2c = 0.0f, da3c = 0.0f, dA = 0.0f;

        bool paramsSet = false; // false until first setTarget call

        // Compute TARGET coefficients from parameters. Call once per buffer.
        // Does NOT update current coefficients — those advance per-sample via step().
        inline void setTarget (float freqHz, float gainDB, float Q, int filterType, float sampleRate, int nSamples)
        {
            cachedType = filterType;
            tgt_g = std::tan (juce::MathConstants<float>::pi * freqHz / sampleRate);
            tgt_A = std::pow (10.0f, gainDB / 40.0f);
            tgt_k = 1.0f / Q; // constant-Q for all types
            tgt_a1c = 1.0f / (1.0f + tgt_g * (tgt_g + tgt_k));
            tgt_a2c = tgt_g * tgt_a1c;
            tgt_a3c = tgt_g * tgt_a2c;

            if (! paramsSet)
            {
                // First call: snap current to target (no interpolation)
                g = tgt_g; k = tgt_k; a1c = tgt_a1c; a2c = tgt_a2c; a3c = tgt_a3c; A = tgt_A;
                dg = dk = da1c = da2c = da3c = dA = 0.0f;
                paramsSet = true;
            }
            else
            {
                // Compute per-sample deltas for linear interpolation
                float inv = 1.0f / (float) juce::jmax (1, nSamples);
                dg   = (tgt_g   - g)   * inv;
                dk   = (tgt_k   - k)   * inv;
                da1c = (tgt_a1c - a1c) * inv;
                da2c = (tgt_a2c - a2c) * inv;
                da3c = (tgt_a3c - a3c) * inv;
                dA   = (tgt_A   - A)   * inv;
            }
        }

        // Advance coefficients by one sample (linear interpolation step)
        inline void step()
        {
            g   += dg;
            k   += dk;
            a1c += da1c;
            a2c += da2c;
            a3c += da3c;
            A   += dA;
        }

        // Process one sample using current (interpolated) coefficients. No transcendentals.
        inline float tick (float in)
        {
            float v3 = in - ic2eq;
            float v1 = a1c * ic1eq + a2c * v3;
            float v2 = ic2eq + a2c * ic1eq + a3c * v3;
            ic1eq = 2.0f * v1 - ic1eq;
            ic2eq = 2.0f * v2 - ic2eq;

            // Flush denormals
            if (std::abs (ic1eq) < 1.0e-20f) ic1eq = 0.0f;
            if (std::abs (ic2eq) < 1.0e-20f) ic2eq = 0.0f;

            if (std::isnan (ic1eq) || std::isnan (ic2eq) ||
                std::isinf (ic1eq) || std::isinf (ic2eq))
            {
                ic1eq = ic2eq = 0.0f;
                return in;
            }

            float lp = v2;
            float bp = v1;
            float hp = in - k * bp - lp;
            float invA = (A > 0.001f) ? (1.0f / A) : 0.0f;
            float gainMix = A - invA; // constant-Q bell: (A - 1/A)

            switch (cachedType)
            {
                case 0:  return in + gainMix * k * bp;        // Bell (constant-Q)
                case 1:  return lp;                            // Low-pass
                case 2:  return hp;                            // High-pass
                case 3:  return lp + hp;                       // Notch
                case 4:  return in + gainMix * lp;             // Low shelf
                case 5:  return in + gainMix * hp;             // High shelf
                case 6:  return k * bp;                        // Band-pass (Solo)
                default: return in + gainMix * k * bp;
            }
        }

        // Snap current coefficients to target (call at end of buffer to prevent drift)
        inline void snapToTarget()
        {
            g = tgt_g; k = tgt_k; a1c = tgt_a1c; a2c = tgt_a2c; a3c = tgt_a3c; A = tgt_A;
        }

        void reset() { ic1eq = ic2eq = 0.0f; paramsSet = false; }
    };

    // Up to 4 cascaded SVF stages per band per channel (for 12/24/48 dB/oct slopes).
    static constexpr int maxBiquadStages = 4;
    SVFEqFilter eqBiquads[maxEqBands][maxBiquadStages][maxEqChannels];
    bool eqBiquadActive[maxEqBands] {};

    // Per-point previous parameter values for linear interpolation across each buffer.
    // The SVF is updated per-sample with interpolated params → zero staircase even at
    // low buffer rates. On first use or after reset, these snap to the target.
    float eqPrevFreq[maxEqBands];
    float eqPrevGain[maxEqBands];
    float eqPrevQ[maxEqBands];
    bool  eqPrevValid[maxEqBands];  // false until first processBlock initialises

    // EQ point data: frequency + busId for routing
    struct EqPointData {
        std::atomic<float> freqHz { 1000.0f };
        std::atomic<int>   busId  { -1 };      // which bus processes this band (-1 = passthrough)
        std::atomic<float> gainDB { 0.0f };
        std::atomic<bool>  solo   { false };    // audition this band only
        std::atomic<bool>  mute   { false };    // silence this band
        std::atomic<float> q      { 0.707f };   // Q factor (resonance)
        std::atomic<int>   filterType { 0 };    // 0=Bell, 1=LP, 2=HP, 3=Notch, 4=LShelf, 5=HShelf
        std::atomic<float> driftPct { 0.0f };   // frequency drift amount 0-100%
        std::atomic<bool>  preEq   { true };    // true = apply EQ before plugins, false = split-only
        std::atomic<int>   stereoMode { 0 };    // 0=Stereo(LR), 1=Mid, 2=Side
        std::atomic<int>   slope { 1 };          // biquad stages: 1=12dB/oct, 2=24dB/oct, 4=48dB/oct

        // Modulation offsets (additive, from setEqParam / proxy params).
        // Applied ON TOP of base values during audio processing.
        // This separates JS drift (which writes base values) from C++ modulation.
        std::atomic<float> modFreqHz { 0.0f };  // offset in Hz (added to freqHz)
        std::atomic<float> modGainDB { 0.0f };  // offset in dB (added to gainDB)
        std::atomic<float> modQ      { 0.0f };  // offset (added to q)
        std::atomic<bool>  modActive { false };  // true = modulation is applied
    };
    EqPointData eqPoints[maxEqBands];
    std::atomic<int> numEqPoints { 0 };
    std::atomic<bool> eqDirty { false }; // set by setEqCurve, consumed by processBlock to reconfigure filters
    std::atomic<int> eqSortOrder[maxEqBands]; // maps sorted position → original JS index for crossover


    // Dynamic dB range: parsed from JS (6, 12, 18, 24, 36, 48). Used for gain clamping.
    std::atomic<float> eqDbRange { 24.0f };
    // Global depth: 0-200%, scales all EQ gains. 100% = full effect, 0% = no EQ.
    std::atomic<float> eqGlobalDepth { 100.0f };
    // Global warp: -100 to +100. +warp = S-curve contrast (tanh), -warp = expand (power curve)
    std::atomic<float> eqGlobalWarp { 0.0f };
    // Global steps: 0 = continuous, ≥2 = quantize gain to N steps across ±dBrange
    std::atomic<int> eqGlobalSteps { 0 };
    // Global tilt: -100 to +100. Applies a frequency-dependent gain tilt.
    // +tilt boosts highs / cuts lows, -tilt boosts lows / cuts highs. Pivot at geometric center.
    std::atomic<float> eqGlobalTilt { 0.0f };
    // Post-EQ tilt filter state: 1st-order LP/HP split at 632Hz
    // Applied AFTER all EQ biquads — tilts the whole combined curve uniformly (matching JS visual).
    float tiltLpState[2] = { 0.0f, 0.0f }; // per-channel 1st-order LP state
    float tiltGainLowCur[2]  = { 1.0f, 1.0f }; // smoothed low-band gain (per channel)
    float tiltGainHighCur[2] = { 1.0f, 1.0f }; // smoothed high-band gain (per channel)

    // Global reso: 0 to 100. Multiplies all band Q values for resonant character.
    // 0 = no boost (Q stays as set), 100 = Q boosted by up to 8x.
    std::atomic<float> eqGlobalReso { 0.0f };

    // Global WrongEQ flags
    std::atomic<bool> eqGlobalBypass { false }; // true = bypass all EQ processing (dry signal)
    // Note: eqPreEq is DEPRECATED — now per-point (eqPoints[i].preEq). Kept for backward compat.
    std::atomic<bool> eqPreEq { true };
    // Unassigned plugin mode: 0 = bypassed (skip), 1 = global (post-EQ insert on summed signal)
    std::atomic<int> eqUnassignedMode { 0 };
    // Split mode: when true, crossovers use point frequency directly (no Q-based bandwidth).
    // Each point = 1 crossover, giving N+1 clean frequency bands at the visible divider positions.
    std::atomic<bool> eqSplitMode { false };

    // Oversampling for EQ biquad processing (reduces frequency cramping near Nyquist).
    // Factor: 1 = off, 2 = 2× oversampling, 4 = 4× oversampling.
    std::atomic<int> eqOversampleFactor { 1 };
    std::unique_ptr<juce::dsp::Oversampling<float>> eqOversampler;
    int eqOversampleOrder = 0; // current oversampler order (0=1x, 1=2x, 2=4x)
    std::atomic<bool> eqOversamplerReady { false };

public:
    /** Batch param apply — sets multiple params in a single call (avoids N IPC round-trips).
        Called from message thread. */
    void applyParamBatch (const juce::String& jsonBatch);

private:

public:
    // ── WrongEQ readback for editor timer ──
    struct WeqReadbackPoint {
        float freqHz, gainDB, q, driftPct;
    };
    int getWeqReadback (WeqReadbackPoint* out, int maxPts) const
    {
        int n = numEqPoints.load (std::memory_order_relaxed);
        if (n > maxPts) n = maxPts;
        if (n > maxEqBands) n = maxEqBands;
        for (int i = 0; i < n; ++i)
        {
            out[i].freqHz   = eqPoints[i].freqHz.load (std::memory_order_relaxed);
            out[i].gainDB   = eqPoints[i].gainDB.load (std::memory_order_relaxed);
            out[i].q        = eqPoints[i].q.load (std::memory_order_relaxed);
            out[i].driftPct = eqPoints[i].driftPct.load (std::memory_order_relaxed);
        }
        return n;
    }

    struct WeqGlobalReadback {
        float depth, warp, tilt;
        int steps;
    };
    WeqGlobalReadback getWeqGlobals() const
    {
        return {
            eqGlobalDepth.load (std::memory_order_relaxed),
            eqGlobalWarp.load (std::memory_order_relaxed),
            eqGlobalTilt.load (std::memory_order_relaxed),
            eqGlobalSteps.load (std::memory_order_relaxed)
        };
    }

    //==============================================================================
    // Unified Proxy Parameter Pool — single pool for both block + plugin params
    // Block params assigned first → top of DAW list, plugin params fill after
    //==============================================================================
    static constexpr int proxyParamCount = 2048;

    /** Drain proxy value cache from audio thread and call setValueNotifyingHost.
        Must be called from the message thread (editor timer). */
    void syncProxyCacheToHost();

    /** Drain block proxy cache — returns pending DAW-driven block param updates */
    struct BlockParamUpdate { int blockId; juce::String paramKey; float value; };
    std::vector<BlockParamUpdate> drainBlockProxyCache();

    /** Update expose state from JS: selectively assign/free proxy slots based on user preferences.
        JSON format: { plugins: { id: { exposed, excluded: [...] } }, blocks: { ... } } */
    void updateExposeState (const juce::String& jsonData);

private:

    struct ProxyMapping {
        int pluginId       = -1;   // >= 0 = hosted plugin param
        int paramIndex     = -1;
        int blockId        = -1;   // >= 0 = logic block param
        juce::String blockParamKey; // e.g. "shapeDepth", "lane.0.depth"

        bool isFree() const { return pluginId < 0 && blockId < 0; }
        bool isBlock() const { return blockId >= 0; }
        bool isPlugin() const { return pluginId >= 0; }
        void clear() { pluginId = -1; paramIndex = -1; blockId = -1; blockParamKey = ""; }
    };

    ProxyMapping                  proxyMap[proxyParamCount];
    ProxyParameter*               proxyParams[proxyParamCount] {};  // raw ptrs (owned by APVTS)
    std::atomic<bool>             proxySyncActive { false };        // prevents feedback loops
    int                           proxySyncCounter = 0;             // per-instance throttle counter

    /** Proxy value cache: audio thread writes, message thread reads + calls setValueNotifyingHost.
        Sentinel -999.0f = not yet written / no update pending. */
    std::atomic<float>            proxyValueCache[proxyParamCount];
    std::atomic<bool>             proxyDirty { false };             // true when cache has pending updates

    /** Block proxy dirty flag — set when DAW automates a block param slot */
    std::atomic<bool>             blockProxyDirty { false };

    /** Assign proxy slots when a plugin is loaded, free them on remove */
    void assignProxySlotsForPlugin (int pluginId);
    void freeProxySlotsForPlugin   (int pluginId);

    /** Called by APVTS listener when a proxy param is automated from the DAW */
    void parameterChanged (const juce::String& parameterID, float newValue) override;

    //==============================================================================
    // UI State Persistence
    //==============================================================================
    mutable std::mutex uiStateMutex;
    juce::String uiStateJson;  // Full UI state as JSON (blocks, mappings, locks)

    //==============================================================================
    // Glide Engine — per-buffer parameter interpolation
    //==============================================================================

    /** Lock-free command FIFO: message thread writes, audio thread reads */
    struct GlideCommand {
        int pluginId    = 0;
        int paramIndex  = 0;
        float targetVal = 0.0f;
        float durationMs = 0.0f;
    };
    static constexpr int glideRingSize = 512;
    GlideCommand glideRing[glideRingSize];
    juce::AbstractFifo glideFifo { glideRingSize };

    /** Active glides being interpolated — only accessed on audio thread.
        Fixed-size pool: swap-to-end removal, no heap allocations. */
    struct ActiveGlide {
        int pluginId     = 0;
        int paramIndex   = 0;
        float currentVal = 0.0f;
        float targetVal  = 0.0f;
        float increment  = 0.0f;  // per-sample linear increment
        int samplesLeft  = 0;
    };
    static constexpr int kMaxGlides = 256;
    std::array<ActiveGlide, kMaxGlides> glidePool;
    int numActiveGlides = 0;  // only modified on audio thread

    //==============================================================================
    // Logic Block Engine — triggers, randomization, envelope followers
    // Runs in processBlock so it works even when the editor window is closed.
    //==============================================================================

    // ── Enum types for zero-alloc comparison in processBlock (H4 fix) ──
    enum class BlockMode : uint8_t { Randomize, Envelope, Sample, MorphPad, Shapes, ShapesRange, Lane, Link, Unknown };
    enum class TriggerType : uint8_t { Manual, Tempo, Midi, Audio };
    enum class MidiTrigMode : uint8_t { AnyNote, SpecificNote, CC };
    enum class AudioSource : uint8_t { Main, Sidechain };
    enum class RangeMode : uint8_t { Absolute, Relative };
    enum class Movement : uint8_t { Instant, Glide };
    enum class Polarity : uint8_t { Bipolar, Up, Down, Unipolar };
    enum class ClockSource : uint8_t { Daw, Internal };
    enum class LoopMode : uint8_t { Oneshot, Loop, Pingpong };
    enum class JumpMode : uint8_t { Restart, Random };
    enum class MorphMode : uint8_t { Manual, Auto, Trigger };
    enum class ExploreMode : uint8_t { Wander, Bounce, Shapes, Orbit, Path };
    enum class LfoShape : uint8_t { Circle, Figure8, SweepX, SweepY, Triangle, Square, Hexagon, Pentagram, Hexagram, Rose4, Lissajous, Spiral, Cat, Butterfly, InfinityKnot };
    enum class MorphAction : uint8_t { Jump, Step };
    enum class StepOrder : uint8_t { Cycle, Random };
    enum class ShapeTracking : uint8_t { Horizontal, Vertical, Distance };
    enum class ShapeTrigger : uint8_t { Free, Midi };
    enum class LaneInterp : uint8_t { Smooth, Step, Linear };
    enum class LanePlayMode : uint8_t { Forward, Reverse, Pingpong, Random };

    // ── Enum parsers (called once in updateLogicBlocks, message thread) ──
    static BlockMode      parseBlockMode    (const juce::String& s);
    static TriggerType    parseTriggerType  (const juce::String& s);
    static MidiTrigMode   parseMidiTrigMode (const juce::String& s);
    static AudioSource    parseAudioSource  (const juce::String& s);
    static RangeMode      parseRangeMode    (const juce::String& s);
    static Movement       parseMovement     (const juce::String& s);
    static Polarity       parsePolarity     (const juce::String& s);
    static ClockSource    parseClockSource  (const juce::String& s);
    static LoopMode       parseLoopMode     (const juce::String& s);
    static JumpMode       parseJumpMode     (const juce::String& s);
    static MorphMode      parseMorphMode    (const juce::String& s);
    static ExploreMode    parseExploreMode  (const juce::String& s);
    static LfoShape       parseLfoShape     (const juce::String& s);
    static MorphAction    parseMorphAction  (const juce::String& s);
    static StepOrder      parseStepOrder    (const juce::String& s);
    static ShapeTracking  parseShapeTracking(const juce::String& s);
    static ShapeTrigger   parseShapeTrigger (const juce::String& s);
    static LaneInterp     parseLaneInterp   (const juce::String& s);
    static LanePlayMode   parseLanePlayMode (const juce::String& s);
    static float          parseBeatsPerDiv  (const juce::String& s);

    struct ParamTarget {
        int pluginId   = 0;
        int paramIndex = 0;
    };

    struct LogicBlock {
        int id = 0;
        juce::String mode;       // kept for serialization
        BlockMode modeE = BlockMode::Unknown;  // enum mirror for processBlock
        bool enabled = true;     // false = bypassed, skip processing
        std::vector<ParamTarget> targets;

        // Trigger
        juce::String trigger;
        TriggerType triggerE = TriggerType::Manual;
        juce::String beatDiv;
        float beatDivBeats = 1.0f;  // pre-computed beats-per-trigger
        juce::String midiMode;
        MidiTrigMode midiModeE = MidiTrigMode::AnyNote;
        int midiNote = 60;
        int midiCC   = 1;
        int midiCh   = 0;        // 0 = any channel
        float threshold = -12.0f;
        juce::String audioSrc;
        AudioSource audioSrcE = AudioSource::Main;

        // Range
        float rMin = 0.0f;
        float rMax = 1.0f;
        juce::String rangeMode;
        RangeMode rangeModeE = RangeMode::Absolute;
        bool quantize = false;
        int qSteps = 12;

        // Movement
        juce::String movement;
        Movement movementE = Movement::Instant;
        float glideMs = 200.0f;

        float envAtk = 10.0f;
        float envRel = 100.0f;
        float envSens = 50.0f;
        bool envInvert = false;
        float envBandLo = 20.0f;      // HPF cutoff Hz (computed from mode+freq+bw)
        float envBandHi = 20000.0f;   // LPF cutoff Hz (computed from mode+freq+bw)
        juce::String envFilterMode;   // flat, lp, hp, bp
        float envFilterFreq = 1000.0f;// Center/cutoff frequency in Hz
        float envFilterBW = 2.0f;     // Bandwidth in octaves (for bp mode)

        // Per-block biquad state for envelope band filter
        struct BiquadState {
            float s1 = 0, s2 = 0;  // Transposed Direct Form II state
            float a0 = 1, a1 = 0, a2 = 0, b1 = 0, b2 = 0;
            float lastFreq = -1;
            void setHighpass(float freq, float sr) {
                if (std::abs(freq - lastFreq) < 0.5f) return; // skip if unchanged
                lastFreq = freq;
                float w0 = juce::MathConstants<float>::twoPi * freq / sr;
                float cosw = std::cos(w0), sinw = std::sin(w0);
                float alpha = sinw / (2.0f * 0.707f); // Q = 0.707 (Butterworth)
                float norm = 1.0f / (1.0f + alpha);
                a0 = ((1.0f + cosw) * 0.5f) * norm;
                a1 = -(1.0f + cosw) * norm;
                a2 = a0;
                b1 = -2.0f * cosw * norm;
                b2 = (1.0f - alpha) * norm;
            }
            void setLowpass(float freq, float sr) {
                if (std::abs(freq - lastFreq) < 0.5f) return;
                lastFreq = freq;
                float w0 = juce::MathConstants<float>::twoPi * freq / sr;
                float cosw = std::cos(w0), sinw = std::sin(w0);
                float alpha = sinw / (2.0f * 0.707f);
                float norm = 1.0f / (1.0f + alpha);
                a0 = ((1.0f - cosw) * 0.5f) * norm;
                a1 = (1.0f - cosw) * norm;
                a2 = a0;
                b1 = -2.0f * cosw * norm;
                b2 = (1.0f - alpha) * norm;
            }
            // Transposed Direct Form II — numerically stable, correct IIR
            float process(float in) {
                float out = a0 * in + s1;
                s1 = a1 * in - b1 * out + s2;
                s2 = a2 * in - b2 * out;
                return out;
            }
            void reset() { s1 = s2 = 0; lastFreq = -1; }
        };
        BiquadState envHpf, envLpf;

        // Polarity control
        juce::String polarity = "bipolar";
        Polarity polarityE = Polarity::Bipolar;

        // Clock source
        juce::String clockSource = "daw";
        ClockSource clockSourceE = ClockSource::Daw;
        float internalBpm = 120.0f;
        double internalPpq = 0.0;  // internal clock beat accumulator (for tempo triggers)

        // Sample modulator settings
        juce::String loopMode;
        LoopMode loopModeE = LoopMode::Oneshot;
        float sampleSpeed = 1.0f;
        bool sampleReverse = false;
        juce::String jumpMode;
        JumpMode jumpModeE = JumpMode::Restart;

        // Runtime state (audio thread only, preserved across updateLogicBlocks)
        float currentEnvValue = 0.0f;
        int lastBeat = -1;
        double lastAudioTrigSample = 0.0;

        // Sample runtime state
        std::shared_ptr<SampleData> sampleData;
        double samplePlayhead = 0.0;
        int sampleDirection = 1;
        std::vector<float> targetBaseValues;
        std::vector<float> targetLastWritten;
        std::vector<int>   targetExtPause;  // per-target cooldown frames: pause mod after hosted-UI change

        // ── Morph Pad ──
        struct MorphSnapshot {
            float x = 0.5f, y = 0.5f;
            std::vector<float> targetValues;
        };
        std::vector<MorphSnapshot> snapshots;
        float playheadX = 0.5f, playheadY = 0.5f;
        juce::String morphMode;
        MorphMode morphModeE = MorphMode::Manual;
        juce::String exploreMode;
        ExploreMode exploreModeE = ExploreMode::Wander;
        juce::String lfoShape;
        LfoShape lfoShapeE = LfoShape::Circle;
        float lfoDepth = 0.8f;
        float lfoRotation = 0.0f;
        float morphSpeed = 0.5f;
        juce::String morphAction;
        MorphAction morphActionE = MorphAction::Jump;
        juce::String stepOrder;
        StepOrder stepOrderE = StepOrder::Cycle;
        juce::String morphSource;
        float jitter = 0.0f;
        float morphGlide = 200.0f;
        bool  morphTempoSync = false;
        juce::String morphSyncDiv;
        float morphSyncDivBeats = 1.0f;  // pre-computed
        float snapRadius = 1.0f;

        // Morph runtime state (audio thread only, preserved across updateLogicBlocks)
        float morphVelX = 0.0f, morphVelY = 0.0f;
        float morphAngle = 0.0f;
        float morphLfoPhase = 0.0f;
        float lfoRotAngle = 0.0f;
        int morphStepIndex = 0;
        float morphSmoothX = 0.5f, morphSmoothY = 0.5f;
        float prevAppliedX = 0.5f, prevAppliedY = 0.5f;
        float morphNoisePhaseX = 0.0f, morphNoisePhaseY = 0.0f;
        float morphOrbitPhase = 0.0f;
        int   morphOrbitTarget = 0;
        float morphPathProgress = 0.0f;
        int   morphPathIndex = 0;

        // ── Shapes Block ──
        juce::String shapeType;
        LfoShape shapeTypeE = LfoShape::Circle;  // reuses LfoShape enum
        juce::String shapeTracking;
        ShapeTracking shapeTrackingE = ShapeTracking::Horizontal;
        float shapeSize = 0.8f;
        float shapeSpin = 0.0f;
        float shapeSpeed = 0.5f;
        float shapePhaseOffset = 0.0f;  // User phase offset (0..1 = 0..360°)
        float shapeDepth = 0.5f;
        juce::String shapeRange;
        RangeMode shapeRangeE = RangeMode::Absolute;
        juce::String shapePolarity;
        Polarity shapePolarityE = Polarity::Bipolar;
        bool shapeTempoSync = false;
        juce::String shapeSyncDiv;
        float shapeSyncDivBeats = 1.0f;  // pre-computed
        juce::String shapeTrigger;
        ShapeTrigger shapeTriggerE = ShapeTrigger::Free;
        // Per-param range values for shapes_range mode (aligned with targets)
        std::vector<float> targetRangeValues;
        std::vector<float> targetRangeBaseValues;
        std::vector<float> smoothedRangeValues;
        // Shapes runtime state
        float shapePhase = 0.0f;
        float shapeRotAngle = 0.0f;
        float smoothedShapeDepth = 0.0f;
        bool shapeWasPlaying = false;   // for transport-start PPQ snap
        bool shapeWasEnabled = false;   // for restore-on-disable

        // ── Lane Clips ──
        struct LaneClip {
            struct LaneTarget { int pluginId = 0; int paramIndex = 0; };
            std::vector<LaneTarget> targets;
            struct Point { float x = 0.0f, y = 0.0f; };
            std::vector<Point> pts;
            juce::String loopLen;
            float loopLenBeats = 1.0f;  // pre-computed (0 = free mode)
            bool loopLenFree = false;   // true when loopLen == "free"
            float freeSecs = 4.0f;
            float steps = 0.0f;     // output quantization: 0=off, 2-32=discrete levels
            float depth = 1.0f;
            float drift = 0.0f;
            float driftRange = 5.0f;  // 0-100: amplitude as % of full parameter range
            juce::String driftScale;  // musical period for drift noise: "1/4", "1/1", "4/1", etc.
            float driftScaleBeats = 4.0f; // parsed beats for driftScale
            float warp  = 0.0f;

            juce::String interp;
            LaneInterp interpE = LaneInterp::Smooth;
            juce::String playMode;
            LanePlayMode playModeE = LanePlayMode::Forward;
            bool synced = true;
            bool muted = false;
            // Oneshot / trigger config
            bool oneshotMode = false;        // true = oneshot, false = loop
            bool oneshotActive = false;      // currently playing (runtime)
            bool oneshotDone = false;        // completed, waiting for retrigger
            bool manualTrigger = false;       // set from JS fire button
            int trigSourceE = 0;             // 0=manual, 1=midi, 2=audio
            int trigMidiNote = -1;           // -1=any, 0-127=specific
            int trigMidiCh = 0;              // 0=any
            float trigThresholdLin = 0.25f;  // linear threshold (from dB)
            bool trigRetrigger = true;
            bool trigHold = false;           // MIDI: false=trigger once, true=gate/sustain
            bool trigAudioSrc = false;       // false=main, true=sidechain
            // Morph lane mode
            bool morphMode = false;          // false = curve lane, true = morph lane
            struct MorphSnapshot {
                float position = 0.0f;       // 0-1 on timeline
                float hold = 0.5f;           // 0-1: fraction of zone as plateau
                int   curve = 0;             // 0=smooth,1=linear,2=sharp,3=late
                float depth = 1.0f;          // 0-1: per-snapshot depth (default 100%)
                float drift = 0.0f;          // per-snapshot drift variation
                float driftRange = 5.0f;     // per-snapshot drift range (0-100%)
                float driftScaleBeats = 4.0f; // per-snapshot drift timing (beats)
                float warp  = 0.0f;          // per-snapshot warp (S-curve contrast)
                int   steps = 0;             // per-snapshot output quantization (0=off)
                juce::String label;
                juce::String source;         // plugin name it came from
                // paramId ("pluginId:paramIndex") → normalised value
                std::unordered_map<std::string, float> values;

                // ── Pre-parsed for audio thread (ZERO allocations) ──
                // Built by updateLogicBlocks on message thread.
                // Mirrors 'values' but with integer keys for RT-safe access.
                struct ParsedValue {
                    int pluginId;
                    int paramIndex;
                    float value;
                };
                std::vector<ParsedValue> parsedValues;  // pre-parsed from 'values'
            };
            std::vector<MorphSnapshot> morphSnapshots;  // sorted by position

            // ── Pre-built target lookup for audio thread (ZERO allocations) ──
            // Built by updateLogicBlocks. Uses flat sorted vector for O(log n) lookup
            // without any string operations on the audio thread.
            struct IntKey {
                int pluginId;
                int paramIndex;
                bool operator<(const IntKey& o) const {
                    return pluginId < o.pluginId || (pluginId == o.pluginId && paramIndex < o.paramIndex);
                }
                bool operator==(const IntKey& o) const {
                    return pluginId == o.pluginId && paramIndex == o.paramIndex;
                }
            };
            std::vector<IntKey> targetKeySorted;  // sorted for binary search

            // Runtime
            double playhead = 0.0;
            int direction = 1;
            float driftPhase = 0.0f;  // running phase for deterministic noise
            bool wasPlaying = false;   // for transport-start PPQ snap
            bool midiNoteHeld = false; // MIDI sustain tracking
        };
        std::vector<LaneClip> laneClips;

        // ── Link ──
        struct LinkSource {
            int pluginId   = -1;
            int paramIndex = -1;
            float macroValue = 0.0f;   // 0..1, used when pluginId == -2 (macro)
        };
        std::vector<LinkSource> linkSources;   // multiple source params, averaged
        std::vector<float> linkMin;       // per-target, 0..100 (target value when source = 0%)
        std::vector<float> linkMax;       // per-target, 0..100 (target value when source = 100%)
        std::vector<float> linkBases;     // per-target, 0..1 base position for base-relative modulation
        float linkSmoothMs = 0.0f;
        // Link runtime state (audio thread only)
        float linkSmoothedValue = -1.0f;
    };

    std::mutex blockMutex;                  // Protects logicBlocks; updateLogicBlocks holds it,
                                            // processBlock uses try_lock
    std::vector<LogicBlock> logicBlocks;
    juce::Random audioRandom;               // RNG for audio-thread randomization
    juce::Random messageRandom;             // RNG for message-thread randomization (per-instance)
    double sampleCounter = 0.0;             // Monotonic sample position for trigger cooldowns

    // ══════════════════════════════════════════════════════════════
    // Pre-allocated flat arrays — ZERO heap allocations on audio thread
    // ══════════════════════════════════════════════════════════════
    static constexpr int kMaxPlugins = 32;
    static constexpr int kMaxParams  = 1024;

    // O(1) plugin lookup by slot — avoids linear scan of hostedPlugins
    // Updated by rebuildPluginSlots() whenever plugins are added/removed
    HostedPlugin* pluginSlots[kMaxPlugins] = {};
    void rebuildPluginSlots();

    // Last value written to each param by ANY logic block.
    // Used by relative mode to distinguish "another block wrote this" from "user moved it".
    // Sentinel: -1.0f = never written.
    float paramWritten[kMaxPlugins][kMaxParams];

    // Params currently being touched (grabbed) by the user — skip modulation.
    // Atomic: written by UI thread, read by audio thread.
    std::atomic<bool> paramTouched[kMaxPlugins][kMaxParams];

    // ── Modulation Bus ──
    // Accumulates offsets from all continuous blocks per buffer, resolves once.
    // Prevents "last-writer-wins" when multiple blocks target the same param.
    struct ModAccum {
        float base   = 0.0f;   // Base value (from Randomize/Morph)
        float offset = 0.0f;   // Sum of all continuous block offsets
        bool  hasBase   = false;
        bool  hasOffset = false;
    };
    ModAccum modBus[kMaxPlugins][kMaxParams];
    // WrongEQ dedicated modbus: per-band (8 bands × 4 fields = 32) + global (14)
    static constexpr int kWeqModSlots_perBand = maxEqBands * 4;
    static constexpr int kWeqModSlots = kWeqModSlots_perBand + kWeqGlobalCount;
    ModAccum weqModBus[kWeqModSlots];

    // ── Dirty-list: tracks which modbus cells were written this buffer ──
    // Avoids scanning all 32K cells in clearModBus / resolveModBus.
    struct DirtyEntry { int16_t slot; int16_t param; };
    static constexpr int kMaxDirtyEntries = 512;  // way more than ever needed
    DirtyEntry dirtyList[kMaxDirtyEntries];
    int numDirty = 0;
    DirtyEntry prevDirtyList[kMaxDirtyEntries]; // last buffer's dirty cells (for base release)
    int numPrevDirty = 0;
    // WrongEQ dirty list (separate, small)
    int weqDirtyList[kWeqModSlots];
    int numWeqDirty = 0;
    int prevWeqDirtyList[kWeqModSlots];
    int numPrevWeqDirty = 0;

    // Stable base value for each param — the "user knob position" that
    // modulation offsets are applied relative to.  -1 = not yet captured.
    float paramBase[kMaxPlugins][kMaxParams];
    // What the modbus wrote last buffer — for detecting external changes.
    float paramModWritten[kMaxPlugins][kMaxParams];
    // WrongEQ dedicated base/written arrays
    float weqParamBase[kWeqModSlots];
    float weqParamModWritten[kWeqModSlots];

    void initParamBase()
    {
        for (int s = 0; s < kMaxPlugins; ++s)
            for (int p = 0; p < kMaxParams; ++p)
            {
                paramBase[s][p] = -1.0f;
                paramModWritten[s][p] = -1.0f;
            }
        for (int w = 0; w < kWeqModSlots; ++w)
        {
            weqParamBase[w] = -1.0f;
            weqParamModWritten[w] = -1.0f;
        }
    }

    void clearModBus()
    {
        // Only clear cells that were actually written last buffer
        for (int i = 0; i < numDirty; ++i)
            modBus[dirtyList[i].slot][dirtyList[i].param] = {};
        numDirty = 0;
        for (int i = 0; i < numWeqDirty; ++i)
            weqModBus[weqDirtyList[i]] = {};
        numWeqDirty = 0;
    }

    // Map WrongEQ paramIndex to flat modbus slot:
    //   per-band (0..31) → slot 0..31 (direct)
    //   global (100..110) → slot 32..42 (kWeqModSlots_perBand + offset)
    //   Returns -1 if out of range.
    static int weqSlot (int paramIndex)
    {
        if (paramIndex >= 0 && paramIndex < kWeqModSlots_perBand)
            return paramIndex;  // per-band
        if (paramIndex >= kWeqGlobalBase && paramIndex < kWeqGlobalBase + kWeqGlobalCount)
            return kWeqModSlots_perBand + (paramIndex - kWeqGlobalBase);  // global
        return -1;
    }

    void writeModBase (int pluginId, int paramIndex, float value)
    {
        if (pluginId == kWeqPluginId)
        {
            int s = weqSlot (paramIndex);
            if (s >= 0)
            {
                if (!weqModBus[s].hasBase && !weqModBus[s].hasOffset && numWeqDirty < kWeqModSlots)
                    weqDirtyList[numWeqDirty++] = s;
                weqModBus[s].base = value;
                weqModBus[s].hasBase = true;
                weqParamBase[s] = value;
            }
            return;
        }
        int s = slotForId (pluginId);
        if (s >= 0 && paramIndex >= 0 && paramIndex < kMaxParams)
        {
            if (!modBus[s][paramIndex].hasBase && !modBus[s][paramIndex].hasOffset && numDirty < kMaxDirtyEntries)
                dirtyList[numDirty++] = { (int16_t) s, (int16_t) paramIndex };
            modBus[s][paramIndex].base = value;
            modBus[s][paramIndex].hasBase = true;
            paramBase[s][paramIndex] = value;
        }
    }

    void addModOffset (int pluginId, int paramIndex, float off)
    {
        if (pluginId == kWeqPluginId)
        {
            int s = weqSlot (paramIndex);
            if (s >= 0)
            {
                if (!weqModBus[s].hasBase && !weqModBus[s].hasOffset && numWeqDirty < kWeqModSlots)
                    weqDirtyList[numWeqDirty++] = s;
                weqModBus[s].offset += off;
                weqModBus[s].hasOffset = true;
            }
            return;
        }
        int s = slotForId (pluginId);
        if (s >= 0 && paramIndex >= 0 && paramIndex < kMaxParams)
        {
            if (!modBus[s][paramIndex].hasBase && !modBus[s][paramIndex].hasOffset && numDirty < kMaxDirtyEntries)
                dirtyList[numDirty++] = { (int16_t) s, (int16_t) paramIndex };
            modBus[s][paramIndex].offset += off;
            modBus[s][paramIndex].hasOffset = true;
        }
    }

    // Called by Randomize when it fires — sets the new resting position
    void updateParamBase (int pluginId, int paramIndex, float value)
    {
        if (pluginId == kWeqPluginId) return; // WrongEQ: base IS the atomic — no separate storage
        int s = slotForId (pluginId);
        if (s >= 0 && paramIndex >= 0 && paramIndex < kMaxParams)
            paramBase[s][paramIndex] = value;
    }

    void resolveModBus()
    {
        // ── Hosted plugins: only process dirty cells ──
        // Also need to check previously-active cells that are now inactive
        // to release their base values. We track this via prevDirtyList.
        for (int i = 0; i < numDirty; ++i)
        {
            int s = dirtyList[i].slot;
            int p = dirtyList[i].param;
            auto* hp = pluginSlots[s];
            if (hp == nullptr) continue;
            int pid = hp->id;

            auto& acc = modBus[s][p];
            float base;
            if (acc.hasBase)
            {
                base = acc.base;
            }
            else
            {
                if (paramBase[s][p] < -0.5f)
                    paramBase[s][p] = getParamValue (pid, p);
                else if (paramModWritten[s][p] > -0.5f)
                {
                    float cur = getParamValue (pid, p);
                    if (std::abs (cur - paramModWritten[s][p]) > 0.005f)
                        paramBase[s][p] = cur;
                }
                base = paramBase[s][p];
            }

            float final_ = juce::jlimit (0.0f, 1.0f, base + acc.offset);
            setParamDirect (pid, p, final_);
            paramWritten[s][p] = final_;
            paramModWritten[s][p] = final_;
        }

        // Release bases for previously-dirty cells that are no longer active
        for (int i = 0; i < numPrevDirty; ++i)
        {
            int s = prevDirtyList[i].slot;
            int p = prevDirtyList[i].param;
            auto& acc = modBus[s][p];
            if (!acc.hasBase && !acc.hasOffset && paramBase[s][p] > -0.5f)
            {
                paramBase[s][p] = -1.0f;
                paramModWritten[s][p] = -1.0f;
            }
        }

        // Save current dirty list as prev for next buffer
        numPrevDirty = numDirty;
        std::memcpy (prevDirtyList, dirtyList, numDirty * sizeof (DirtyEntry));

        // ── WrongEQ modbus resolution ──
        auto weqParamIndex = [] (int slot) -> int {
            if (slot < kWeqModSlots_perBand) return slot;
            return kWeqGlobalBase + (slot - kWeqModSlots_perBand);
        };

        for (int i = 0; i < numWeqDirty; ++i)
        {
            int w = weqDirtyList[i];
            auto& acc = weqModBus[w];
            int pi = weqParamIndex (w);

            float base;
            if (acc.hasBase)
            {
                base = acc.base;
            }
            else
            {
                if (weqParamBase[w] < -0.5f)
                    weqParamBase[w] = getParamValue (kWeqPluginId, pi);
                else if (weqParamModWritten[w] > -0.5f)
                {
                    float cur = getParamValue (kWeqPluginId, pi);
                    if (std::abs (cur - weqParamModWritten[w]) > 0.005f)
                        weqParamBase[w] = cur;
                }
                base = weqParamBase[w];
            }

            float final_ = juce::jlimit (0.0f, 1.0f, base + acc.offset);
            setParamDirect (kWeqPluginId, pi, final_);
            weqParamModWritten[w] = final_;
        }

        // Release WrongEQ bases for prev-dirty slots no longer active
        for (int i = 0; i < numPrevWeqDirty; ++i)
        {
            int w = prevWeqDirtyList[i];
            auto& acc = weqModBus[w];
            if (!acc.hasBase && !acc.hasOffset && weqParamBase[w] > -0.5f)
            {
                weqParamBase[w] = -1.0f;
                weqParamModWritten[w] = -1.0f;
            }
        }

        numPrevWeqDirty = numWeqDirty;
        std::memcpy (prevWeqDirtyList, weqDirtyList, numWeqDirty * sizeof (int));
    }

    // Per-plugin gesture listener — detects hosted plugin UI knob drags.
    // Sets paramTouched[slot][paramIndex] when a gesture begins, clears on end.
    struct GestureListener : public juce::AudioProcessorParameter::Listener
    {
        int slot;
        std::atomic<bool> (&touched)[kMaxPlugins][kMaxParams];

        GestureListener (int s, std::atomic<bool> (&t)[kMaxPlugins][kMaxParams])
            : slot (s), touched (t) {}

        void parameterValueChanged (int, float) override {}
        void parameterGestureChanged (int paramIndex, bool starting) override
        {
            if (paramIndex >= 0 && paramIndex < kMaxParams)
                touched[slot][paramIndex].store (starting, std::memory_order_release);
        }
    };
    std::vector<std::unique_ptr<GestureListener>> gestureListeners;

    // Map pluginId → array slot index (pluginId % kMaxPlugins)
    int slotForId (int pluginId) const;


    /** Set a param directly on a hosted plugin (audio thread) */
    void setParamDirect (int pluginId, int paramIndex, float value);

    // AudioProcessorParameter::Listener — detects hosted plugin UI gestures
    void parameterValueChanged (int, float) override {} // unused, we poll instead
    void parameterGestureChanged (int parameterIndex, bool gestureIsStarting) override;

public:
    /** Mark a param as touched (user grabbing it) — modulation suspends */
    void touchParam (int pluginId, int paramIndex)
    {
        int slot = slotForId (pluginId);
        if (slot >= 0 && paramIndex >= 0 && paramIndex < kMaxParams)
            paramTouched[slot][paramIndex].store (true, std::memory_order_release);
    }

    /** Release a touched param — modulation continues from the already-adopted base */
    void untouchParam (int pluginId, int paramIndex)
    {
        int slot = slotForId (pluginId);
        if (slot >= 0 && paramIndex >= 0 && paramIndex < kMaxParams)
        {
            paramTouched[slot][paramIndex].store (false, std::memory_order_release);
            // Note: base value was already adopted continuously during processBlock
            // (Bitwig-style). No recapture needed here — just clear the flag.
        }
    }

    /** Read a param value from a hosted plugin (audio thread, pluginMutex already held) */
    float getParamValue (int pluginId, int paramIndex) const;

    /** Get the set of param keys (pluginId:paramIndex strings) currently targeted by any logic block.
        Used by the editor to prioritize polling of modulated params.
        Uses blockMutex (not pluginMutex), so safe to call from message thread. */
    std::unordered_set<std::string> getModulatedParamKeys()
    {
        std::unordered_set<std::string> result;
        std::lock_guard<std::mutex> lock (blockMutex);
        for (const auto& lb : logicBlocks)
        {
            if (!lb.enabled) continue;
            for (const auto& t : lb.targets)
                result.insert (std::to_string (t.pluginId) + ":" + std::to_string (t.paramIndex));
            for (const auto& lc : lb.laneClips)
                for (const auto& lt : lc.targets)
                    result.insert (std::to_string (lt.pluginId) + ":" + std::to_string (lt.paramIndex));
        }
        return result;
    }

    /** Fast single-param value read — lock-free, O(1) lookup!
        JUCE's AudioProcessorParameter::getValue() is already atomic internally.
        hostedPlugins vector is stable (pre-reserved, never erased during processing).
        This is how DAWs read params without blocking the audio thread. */
    float getParamValueFast (int pluginId, int paramIndex)
    {
        int slot = slotForId (pluginId);
        if (slot >= 0)
        {
            auto* hp = pluginSlots[slot];
            if (hp && hp->id == pluginId && hp->instance)
            {
                auto& params = hp->instance->getParameters();
                if (paramIndex >= 0 && paramIndex < params.size())
                    return params[paramIndex]->getValue();
            }
        }
        return -1.0f;
    }

    /** Fast single-param display text — lock-free, O(1) lookup! */
    juce::String getParamDisplayTextFast (int pluginId, int paramIndex)
    {
        int slot = slotForId (pluginId);
        if (slot >= 0)
        {
            auto* hp = pluginSlots[slot];
            if (hp && hp->id == pluginId && hp->instance)
            {
                auto& params = hp->instance->getParameters();
                if (paramIndex >= 0 && paramIndex < params.size())
                    return params[paramIndex]->getText (params[paramIndex]->getValue(), 32);
            }
        }
        return {};
    }

    /** Convert an arbitrary normalized value (0..1) to the plugin's display text.
        Like getParamDisplayTextFast but for a hypothetical value, not the current one. */
    juce::String getParamTextForValue (int pluginId, int paramIndex, float normalizedValue)
    {
        int slot = slotForId (pluginId);
        if (slot >= 0)
        {
            auto* hp = pluginSlots[slot];
            if (hp && hp->id == pluginId && hp->instance)
            {
                auto& params = hp->instance->getParameters();
                if (paramIndex >= 0 && paramIndex < params.size())
                    return params[paramIndex]->getText (juce::jlimit (0.0f, 1.0f, normalizedValue), 32);
            }
        }
        return {};
    }

public:
    //==============================================================================
    // Real-time data for UI (written in processBlock, read from editor timer)
    //==============================================================================
    std::atomic<float> currentRmsLevel { 0.0f };   // Main input audio RMS (0..1)
    std::atomic<float> sidechainRmsLevel { 0.0f };  // Sidechain input RMS (0..1)
    std::atomic<double> currentBpm { 120.0 };       // DAW BPM
    std::atomic<bool> isPlaying { false };           // DAW transport playing
    std::atomic<double> ppqPosition { 0.0 };         // PPQ position for tempo sync

    // ── Spectrum Analyzer (FFT) ──
    // Maximum FFT size (allocated once); active size controlled by fftActiveOrder
    static constexpr int fftMaxOrder = 13;            // 2^13 = 8192
    static constexpr int fftMaxSize  = 1 << fftMaxOrder;
    static constexpr int spectrumBinCount = 256;      // log-spaced output bins (high-res for spline rendering)

    std::atomic<int> fftActiveOrder { 11 };            // current order: 10=1024, 11=2048, 12=4096, 13=8192
    int fftCurrentOrder = 11;                          // last-applied order (audio thread)
    int fftCurrentSize  = 1 << 11;                     // cached 2^fftCurrentOrder

    float fftInputBuffer[fftMaxSize] = {};
    int   fftInputPos = 0;
    std::atomic<bool> fftReady { false };
    float fftWorkBuffer[fftMaxSize * 2] = {};
    float spectrumBinsOut[spectrumBinCount] = {};
    juce::dsp::FFT fftInstance { 11 };                // persistent FFT (recreated on order change)
    float hannWindow[fftMaxSize] = {};                // pre-computed Hann window

    /** Set FFT order from message thread. Takes effect on next fill cycle. */
    void setFftOrder (int order)
    {
        order = juce::jlimit (10, (int) fftMaxOrder, order);
        fftActiveOrder.store (order, std::memory_order_relaxed);
    }

    /** Called from audio thread when fftActiveOrder changes. Rebuilds window + FFT. */
    void applyFftOrderChange ()
    {
        int newOrder = fftActiveOrder.load (std::memory_order_relaxed);
        if (newOrder == fftCurrentOrder) return;
        fftCurrentOrder = newOrder;
        fftCurrentSize  = 1 << newOrder;
        fftInputPos = 0;
        fftReady.store (false, std::memory_order_relaxed);
        // Rebuild Hann window for new size
        for (int i = 0; i < fftCurrentSize; ++i)
            hannWindow[i] = 0.5f * (1.0f - std::cos (2.0f * juce::MathConstants<float>::pi * (float) i / (float) fftCurrentSize));
        // Recreate FFT instance
        fftInstance = juce::dsp::FFT (newOrder);
    }

    /** Get log-spaced spectrum bins (dB) for UI. Returns bin count (128) or 0 if not ready. */
    int getSpectrumBins (float* outBins, int maxBins);

    // MIDI event buffer for UI (recent note-on/CC events)
    // Lock-free SPSC FIFO: audio thread writes, UI timer reads
    struct MidiEvent {
        int note     = 0; // MIDI note number (0-127) or CC number
        int velocity = 0; // velocity or CC value
        int channel  = 0; // MIDI channel (1-16)
        bool isCC    = false; // true if CC, false if note
    };
    static constexpr int midiRingSize = 256;
    MidiEvent midiRing[midiRingSize];
    juce::AbstractFifo midiFifo { midiRingSize };

    // Envelope follower levels for UI display (written by processBlock)
    static constexpr int maxEnvReadback = 16;
    struct EnvReadback {
        std::atomic<int>   blockId { -1 };
        std::atomic<float> level   { 0.0f };
    };
    EnvReadback envReadback[maxEnvReadback];
    std::atomic<int> numActiveEnvBlocks { 0 };

    // Sample modulator playhead positions for UI display
    static constexpr int maxSampleReadback = 16;
    struct SampleReadback {
        std::atomic<int>   blockId  { -1 };
        std::atomic<float> playhead { 0.0f };  // 0..1 normalised position
    };
    SampleReadback sampleReadback[maxSampleReadback];
    std::atomic<int> numActiveSampleBlocks { 0 };

    // Morph pad playhead positions for UI display
    static constexpr int maxMorphReadback = 8;
    struct MorphReadback {
        std::atomic<int>   blockId    { -1 };
        std::atomic<float> headX      { 0.5f };
        std::atomic<float> headY      { 0.5f };
        std::atomic<float> rotAngle   { 0.0f };
        std::atomic<float> modOutput  { 0.0f };  // raw shapes output -1..+1 for fill arc
    };
    MorphReadback morphReadback[maxMorphReadback];
    std::atomic<int> numActiveMorphBlocks { 0 };

    // Lane playhead positions for UI display
    static constexpr int maxLaneReadback = 32; // max lanes across all blocks
    struct LaneReadback {
        std::atomic<int>   blockId   { -1 };
        std::atomic<int>   laneIdx   { -1 };
        std::atomic<float> playhead  { 0.0f };
        std::atomic<float> value     { 0.5f }; // current evaluated value (0..1)
        std::atomic<bool>  active    { true };  // false when oneshot is done/idle
    };
    LaneReadback laneReadback[maxLaneReadback];
    std::atomic<int> numActiveLanes { 0 };

    // Trigger fire events for UI flash (lock-free FIFO)
    static constexpr int triggerRingSize = 64;
    int triggerRing[triggerRingSize] = {};
    juce::AbstractFifo triggerFifo { triggerRingSize };

    // Crash notification FIFO — audio thread writes, UI timer reads
    struct CrashEvent {
        int pluginId = 0;
        char pluginName[64] = {};
        char reason[128] = {};
    };
    static constexpr int crashRingSize = 16;
    CrashEvent crashRing[crashRingSize] = {};
    juce::AbstractFifo crashFifo { crashRingSize };

    // Self-write tracking for auto-locate filtering
    // Records pluginId:paramIndex pairs that OUR code wrote,
    // so the editor can exclude them from "touched by plugin UI" detection.
    struct SelfWriteEvent {
        int pluginId;
        int paramIndex;
    };
    static constexpr int selfWriteRingSize = 2048;
    SelfWriteEvent selfWriteRing[selfWriteRingSize] = {};
    juce::AbstractFifo selfWriteFifo { selfWriteRingSize };

    /** Record that we wrote a param (call from any thread, lock-free) */
    void recordSelfWrite (int pluginId, int paramIndex)
    {
        const auto scope = selfWriteFifo.write (1);
        if (scope.blockSize1 > 0)
            selfWriteRing[scope.startIndex1] = { pluginId, paramIndex };
    }

private:
    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (HostesaAudioProcessor)
};
