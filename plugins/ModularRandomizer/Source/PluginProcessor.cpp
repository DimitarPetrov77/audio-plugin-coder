/*
  ==============================================================================

    Modular Randomizer - PluginProcessor
    VST3 Plugin Hosting Engine with parameter randomization

  ==============================================================================
*/

#include "PluginProcessor.h"
#include "PluginEditor.h"
#include "ParameterIDs.hpp"

//==============================================================================
// Enum parsers — called once per updateLogicBlocks (message thread), so processBlock
// uses integer comparisons instead of ~100 juce::String == "literal" per call (H4 fix).
//==============================================================================
using P = HostesaAudioProcessor;

P::BlockMode P::parseBlockMode (const juce::String& s) {
    if (s == "randomize")    return BlockMode::Randomize;
    if (s == "envelope")     return BlockMode::Envelope;
    if (s == "sample")       return BlockMode::Sample;
    if (s == "morph_pad")    return BlockMode::MorphPad;
    if (s == "shapes")       return BlockMode::Shapes;
    if (s == "shapes_range") return BlockMode::ShapesRange;
    if (s == "lane")         return BlockMode::Lane;
    return BlockMode::Unknown;
}
P::TriggerType P::parseTriggerType (const juce::String& s) {
    if (s == "tempo") return TriggerType::Tempo;
    if (s == "midi")  return TriggerType::Midi;
    if (s == "audio") return TriggerType::Audio;
    return TriggerType::Manual;
}
P::MidiTrigMode P::parseMidiTrigMode (const juce::String& s) {
    if (s == "specific_note") return MidiTrigMode::SpecificNote;
    if (s == "cc")            return MidiTrigMode::CC;
    return MidiTrigMode::AnyNote;
}
P::AudioSource P::parseAudioSource (const juce::String& s) {
    if (s == "sidechain") return AudioSource::Sidechain;
    return AudioSource::Main;
}
P::RangeMode P::parseRangeMode (const juce::String& s) {
    if (s == "relative") return RangeMode::Relative;
    return RangeMode::Absolute;
}
P::Movement P::parseMovement (const juce::String& s) {
    if (s == "glide") return Movement::Glide;
    return Movement::Instant;
}
P::Polarity P::parsePolarity (const juce::String& s) {
    if (s == "up")       return Polarity::Up;
    if (s == "down")     return Polarity::Down;
    if (s == "unipolar") return Polarity::Unipolar;
    return Polarity::Bipolar;
}
P::ClockSource P::parseClockSource (const juce::String& s) {
    if (s == "internal") return ClockSource::Internal;
    return ClockSource::Daw;
}
P::LoopMode P::parseLoopMode (const juce::String& s) {
    if (s == "loop")     return LoopMode::Loop;
    if (s == "pingpong") return LoopMode::Pingpong;
    return LoopMode::Oneshot;
}
P::JumpMode P::parseJumpMode (const juce::String& s) {
    if (s == "random") return JumpMode::Random;
    return JumpMode::Restart;
}
P::MorphMode P::parseMorphMode (const juce::String& s) {
    if (s == "auto")    return MorphMode::Auto;
    if (s == "trigger") return MorphMode::Trigger;
    return MorphMode::Manual;
}
P::ExploreMode P::parseExploreMode (const juce::String& s) {
    if (s == "bounce") return ExploreMode::Bounce;
    if (s == "shapes") return ExploreMode::Shapes;
    if (s == "orbit")  return ExploreMode::Orbit;
    if (s == "path")   return ExploreMode::Path;
    return ExploreMode::Wander;
}
P::LfoShape P::parseLfoShape (const juce::String& s) {
    if (s == "figure8")    return LfoShape::Figure8;
    if (s == "sweepX")     return LfoShape::SweepX;
    if (s == "sweepY")     return LfoShape::SweepY;
    if (s == "triangle")   return LfoShape::Triangle;
    if (s == "square")     return LfoShape::Square;
    if (s == "hexagon")    return LfoShape::Hexagon;
    if (s == "pentagram")  return LfoShape::Pentagram;
    if (s == "hexagram")   return LfoShape::Hexagram;
    if (s == "rose4")      return LfoShape::Rose4;
    if (s == "lissajous")  return LfoShape::Lissajous;
    if (s == "spiral")     return LfoShape::Spiral;
    if (s == "cat")        return LfoShape::Cat;
    if (s == "butterfly")  return LfoShape::Butterfly;
    if (s == "infinityKnot") return LfoShape::InfinityKnot;
    return LfoShape::Circle;
}
P::MorphAction P::parseMorphAction (const juce::String& s) {
    if (s == "step") return MorphAction::Step;
    return MorphAction::Jump;
}
P::StepOrder P::parseStepOrder (const juce::String& s) {
    if (s == "random") return StepOrder::Random;
    return StepOrder::Cycle;
}
P::ShapeTracking P::parseShapeTracking (const juce::String& s) {
    if (s == "vertical") return ShapeTracking::Vertical;
    if (s == "distance") return ShapeTracking::Distance;
    return ShapeTracking::Horizontal;
}
P::ShapeTrigger P::parseShapeTrigger (const juce::String& s) {
    if (s == "midi") return ShapeTrigger::Midi;
    return ShapeTrigger::Free;
}
P::LaneInterp P::parseLaneInterp (const juce::String& s) {
    if (s == "step")   return LaneInterp::Step;
    if (s == "linear") return LaneInterp::Linear;
    return LaneInterp::Smooth;
}
P::LanePlayMode P::parseLanePlayMode (const juce::String& s) {
    if (s == "reverse")  return LanePlayMode::Reverse;
    if (s == "pingpong") return LanePlayMode::Pingpong;
    if (s == "random")   return LanePlayMode::Random;
    return LanePlayMode::Forward;
}
float P::parseBeatsPerDiv (const juce::String& div) {
    if (div == "32"  || div == "32/1") return 128.0f;
    if (div == "16"  || div == "16/1") return 64.0f;
    if (div == "8"   || div == "8/1")  return 32.0f;
    if (div == "4"   || div == "4/1")  return 16.0f;
    if (div == "2"   || div == "2/1")  return 8.0f;
    if (div == "1/1")  return 4.0f;
    if (div == "1/2")  return 2.0f;
    if (div == "1/4")  return 1.0f;
    if (div == "1/8")  return 0.5f;
    if (div == "1/16") return 0.25f;
    if (div == "1/32") return 0.125f;
    if (div == "1/64") return 0.0625f;
    if (div == "1/2.")  return 3.0f;
    if (div == "1/4.")  return 1.5f;
    if (div == "1/8.")  return 0.75f;
    if (div == "1/16.") return 0.375f;
    if (div == "1/2T")  return 4.0f / 3.0f;
    if (div == "1/4T")  return 2.0f / 3.0f;
    if (div == "1/8T")  return 1.0f / 3.0f;
    if (div == "1/16T") return 0.5f / 3.0f;
    return 1.0f;
}

//==============================================================================
HostesaAudioProcessor::HostesaAudioProcessor()
#ifndef JucePlugin_PreferredChannelConfigurations
     : AudioProcessor (BusesProperties()
                     #if ! JucePlugin_IsMidiEffect
                      #if ! JucePlugin_IsSynth
                       .withInput  ("Input",  juce::AudioChannelSet::stereo(), true)
                      #endif
                       .withOutput ("Output", juce::AudioChannelSet::stereo(), true)
                     #endif
                       .withInput  ("Sidechain", juce::AudioChannelSet::stereo(), false)
                       ),
#else
     :
#endif
       apvts (*this, nullptr, "Hostesa", createParameterLayout())
{
    // Register VST3 format for plugin scanning/hosting
    formatManager.addFormat (new juce::VST3PluginFormat());

    // Register audio file formats for sample modulator
    audioFileFormatManager.registerBasicFormats();

    // Initialize flat param tracking arrays (zero heap allocations on audio thread)
    for (int s = 0; s < kMaxPlugins; ++s)
        for (int p = 0; p < kMaxParams; ++p)
        {
            paramWritten[s][p] = -1.0f;  // sentinel: never written
            paramTouched[s][p].store (false, std::memory_order_relaxed);
        }
    initParamBase();

    // Pre-allocate hosted plugin vector so push_back never reallocates
    // while the audio thread iterates (audio thread doesn't hold pluginMutex)
    hostedPlugins.reserve (32);

    // Look up proxy raw pointers from APVTS (unified pool: AP_0000–AP_2047)
    for (int i = 0; i < proxyParamCount; ++i)
    {
        auto id = juce::String ("AP_") + juce::String (i).paddedLeft ('0', 4);
        proxyParams[i] = dynamic_cast<ProxyParameter*> (apvts.getParameter (id));
        apvts.addParameterListener (id, this);
        proxyValueCache[i].store (-999.0f);
    }

    // -- Create organized preset directory structure --
    getDataRoot().createDirectory();
    getChainsDir().createDirectory();
    getSnapshotsDir().createDirectory();
    getImportDir().createDirectory();

    // One-time migration from old flat ? new organized structure
    migrateOldPresets();
}


HostesaAudioProcessor::~HostesaAudioProcessor()
{
    // Unregister proxy listeners (unified pool)
    for (int i = 0; i < proxyParamCount; ++i)
    {
        auto id = juce::String ("AP_") + juce::String (i).paddedLeft ('0', 4);
        apvts.removeParameterListener (id, this);
    }

    // Release all hosted plugins — SEH-guarded per-plugin so one crashing
    // plugin doesn't prevent cleanup of the rest.
    {
        std::lock_guard<std::mutex> lock (pluginMutex);
        for (auto& hp : hostedPlugins)
        {
            if (hp->instance)
            {
#ifdef _WIN32
                sehReleaseResources (hp->instance.get());
                sehDestroyInstance (hp->instance.release());
#else
                try { hp->instance->releaseResources(); } catch (...) {}
                hp->instance.reset();
#endif
            }
        }
        hostedPlugins.clear();
    }
}

//==============================================================================
juce::AudioProcessorValueTreeState::ParameterLayout HostesaAudioProcessor::createParameterLayout()
{
    std::vector<std::unique_ptr<juce::RangedAudioParameter>> params;

    params.push_back (std::make_unique<juce::AudioParameterFloat> (
        juce::ParameterID { ParameterIDs::MIX, 1 },
        "Mix",
        juce::NormalisableRange<float> (0.0f, 100.0f, 0.1f),
        100.0f,
        juce::String(),
        juce::AudioProcessorParameter::genericParameter,
        [](float value, int) { return juce::String (value, 0) + "%"; }
    ));

    params.push_back (std::make_unique<juce::AudioParameterBool> (
        juce::ParameterID { ParameterIDs::BYPASS, 1 },
        "Bypass",
        false
    ));

    // Unified proxy parameter pool — AP_0000 to AP_2047
    // Block params assigned first (top of DAW list), plugin params fill after
    for (int i = 0; i < proxyParamCount; ++i)
    {
        auto id = juce::String ("AP_") + juce::String (i).paddedLeft ('0', 4);
        auto name = juce::String ("Slot ") + juce::String (i + 1);
        params.push_back (std::make_unique<ProxyParameter> (
            juce::ParameterID { id, 1 },
            name,
            juce::NormalisableRange<float> (0.0f, 1.0f, 0.0f),
            0.0f
        ));
    }

    return { params.begin(), params.end() };
}

//==============================================================================
void HostesaAudioProcessor::prepareToPlay (double sampleRate, int samplesPerBlock)
{
    currentSampleRate = sampleRate;
    currentBlockSize = samplesPerBlock;

    // Reset glide pool (fixed-size array, no allocation needed)
    numActiveGlides = 0;

    // Initialize modbus base tracking
    initParamBase();

    // Pre-allocate parallel bus buffers (sized for max channels + block size)
    int numCh = getTotalNumOutputChannels();
    for (int i = 0; i < maxBuses; ++i)
        busBuffers[i].setSize (numCh, samplesPerBlock, false, false, true);

    // Pre-allocate dry buffer for wet/dry mix (avoids heap alloc in processBlock)
    dryBuffer.setSize (numCh, samplesPerBlock, false, false, true);

    // Pre-allocate synth accumulation buffer for layering multiple synths (sequential mode)
    synthAccum.setSize (numCh, samplesPerBlock, false, false, true);

    // Pre-allocate MIDI trigger event buffer
    blockMidiEvents.reserve (kMaxBlockMidi);

    // Pre-allocate WrongEQ band-split buffers (2N+1 bands for N points)
    for (int i = 0; i < maxXoverBands; ++i)
    {
        eqBandBuffers[i].setSize (numCh, samplesPerBlock, false, false, true);
        eqBandGain[i] = 1.0f; // start at full volume
    }

    // Prepare crossover filters, allpass compensation (2N crossovers for N points max)
    for (int i = 0; i < maxCrossovers; ++i)
    {
        crossovers[i].reset();

        // Reset per-(crossover, lower-band) allpass filters for phase compensation.
        for (int lb = 0; lb < maxCrossovers; ++lb)
            for (int ch = 0; ch < 2; ++ch)
                allpassComp[i][lb][ch].reset();
    }

    // Reset per-point parametric EQ biquad filters (all cascaded stages)
    for (int i = 0; i < maxEqBands; ++i)
    {
        for (int st = 0; st < maxBiquadStages; ++st)
            for (int ch = 0; ch < maxEqChannels; ++ch)
                eqBiquads[i][st][ch].reset();
        eqBiquadActive[i] = false;
        eqPrevValid[i] = false;
    }

    // Initialize EQ oversampler
    {
        int factor = eqOversampleFactor.load();
        int order = (factor >= 4) ? 2 : (factor >= 2) ? 1 : 0;
        eqOversampleOrder = order;
        if (order > 0)
        {
            eqOversampler = std::make_unique<juce::dsp::Oversampling<float>>(
                (juce::uint32) numCh, (juce::uint32) order,
                juce::dsp::Oversampling<float>::filterHalfBandPolyphaseIIR, false);
            eqOversampler->initProcessing ((size_t) samplesPerBlock);
            eqOversamplerReady = true;
        }
        else
        {
            eqOversampler.reset();
            eqOversamplerReady = false;
        }
    }


    // Initialize proxy value cache sentinels (-999.0f = no pending update)
    for (int i = 0; i < proxyParamCount; ++i)
        proxyValueCache[i].store (-999.0f, std::memory_order_relaxed);
    proxyDirty.store (false);

    // Purge dead plugin entries (safe: processBlock is not running during prepareToPlay)
    purgeDeadPlugins();

    // Prepare all hosted plugins (reconfigure on rate/blocksize change)
    // Per-plugin try-catch: one crashing plugin doesn't prevent the rest
    std::lock_guard<std::mutex> lock (pluginMutex);
    for (auto& hp : hostedPlugins)
    {
        if (hp->instance != nullptr)
        {
            try
            {
                // Always reconfigure — sample rate or block size may have changed
                int pluginIns  = hp->instance->getTotalNumInputChannels();
                int pluginOuts = hp->instance->getTotalNumOutputChannels();
                hp->instance->setPlayConfigDetails (pluginIns, pluginOuts,
                                                     sampleRate, samplesPerBlock);
                hp->instance->prepareToPlay (sampleRate, samplesPerBlock);
                hp->prepared = true;
            }
            catch (...)
            {
                LOG_TO_FILE ("prepareToPlay: EXCEPTION for plugin '" << hp->name.toStdString()
                             << "' (ID: " << hp->id << "). Marking crashed.");
                hp->crashed = true;
                hp->prepared = false;
            }
        }
    }
}

void HostesaAudioProcessor::syncProxyCacheToHost()
{
    // Drain proxy value cache from audio thread ? call setValueNotifyingHost on message thread.
    // Audio thread writes float values into proxyValueCache atomics; this method reads them.
    if (! proxyDirty.exchange (false, std::memory_order_acquire))
        return;

    proxySyncActive.store (true);
    for (int i = 0; i < proxyParamCount; ++i)
    {
        float cached = proxyValueCache[i].exchange (-999.0f, std::memory_order_relaxed);
        if (cached > -998.0f && proxyParams[i] != nullptr)
        {
            if (std::abs (cached - proxyParams[i]->get()) > 0.0001f)
                proxyParams[i]->setValueNotifyingHost (cached);
        }
    }
    proxySyncActive.store (false);
}

std::vector<HostesaAudioProcessor::BlockParamUpdate>
HostesaAudioProcessor::drainBlockProxyCache()
{
    std::vector<BlockParamUpdate> updates;
    if (! blockProxyDirty.exchange (false))
        return updates;

    for (int i = 0; i < proxyParamCount; ++i)
    {
        auto& m = proxyMap[i];
        if (! m.isBlock()) continue;

        float cached = proxyValueCache[i].exchange (-999.0f);
        if (cached < -900.0f) continue;

        updates.push_back ({ m.blockId, m.blockParamKey, cached });
    }
    return updates;
}

void HostesaAudioProcessor::releaseResources()
{
    std::lock_guard<std::mutex> lock (pluginMutex);
    for (auto& hp : hostedPlugins)
    {
        if (hp->instance != nullptr && hp->prepared)
        {
#ifdef _WIN32
            sehReleaseResources (hp->instance.get());
#else
            try { hp->instance->releaseResources(); } catch (...) {}
#endif
            hp->prepared = false;
        }
    }
}

#ifndef JucePlugin_PreferredChannelConfigurations
bool HostesaAudioProcessor::isBusesLayoutSupported (const BusesLayout& layouts) const
{
  #if JucePlugin_IsMidiEffect
    juce::ignoreUnused (layouts);
    return true;
  #else
    if (layouts.getMainOutputChannelSet() != juce::AudioChannelSet::mono()
     && layouts.getMainOutputChannelSet() != juce::AudioChannelSet::stereo())
        return false;

   #if ! JucePlugin_IsSynth
    if (layouts.getMainOutputChannelSet() != layouts.getMainInputChannelSet())
        return false;
   #endif

    // Sidechain: accept disabled, mono, or stereo
    auto scLayout = layouts.getChannelSet (true, 1);
    if (! scLayout.isDisabled()
        && scLayout != juce::AudioChannelSet::mono()
        && scLayout != juce::AudioChannelSet::stereo())
        return false;

    return true;
  #endif
}
#endif




void HostesaAudioProcessor::updateLogicBlocks (const juce::String& jsonData)
{
    auto parsed = juce::JSON::parse (jsonData);
    if (! parsed.isArray()) return;

    std::vector<LogicBlock> newBlocks;
    newBlocks.reserve ((size_t) parsed.size());

    for (int i = 0; i < parsed.size(); ++i)
    {
        auto* obj = parsed[i].getDynamicObject();
        if (obj == nullptr) continue;

        LogicBlock lb;
        lb.id       = (int) obj->getProperty ("id");
        lb.mode     = obj->getProperty ("mode").toString();
        lb.enabled  = obj->hasProperty ("enabled") ? (bool) obj->getProperty ("enabled") : true;
        lb.trigger  = obj->getProperty ("trigger").toString();
        lb.beatDiv  = obj->getProperty ("beatDiv").toString();
        lb.midiMode = obj->getProperty ("midiMode").toString();
        lb.midiNote = (int) obj->getProperty ("midiNote");
        lb.midiCC   = (int) obj->getProperty ("midiCC");
        lb.midiCh   = (int) obj->getProperty ("midiCh");
        lb.threshold = (float) (double) obj->getProperty ("threshold");
        lb.audioSrc  = obj->getProperty ("audioSrc").toString();
        lb.rMin      = (float) (double) obj->getProperty ("rMin");
        lb.rMax      = (float) (double) obj->getProperty ("rMax");
        lb.rangeMode = obj->getProperty ("rangeMode").toString();
        lb.quantize  = (bool) obj->getProperty ("quantize");
        lb.qSteps    = (int) obj->getProperty ("qSteps");
        lb.movement  = obj->getProperty ("movement").toString();
        lb.glideMs   = (float) (double) obj->getProperty ("glideMs");
        lb.envAtk    = (float) (double) obj->getProperty ("envAtk");
        lb.envRel    = (float) (double) obj->getProperty ("envRel");
        lb.envSens   = (float) (double) obj->getProperty ("envSens");
        lb.envInvert = (bool) obj->getProperty ("envInvert");
        lb.envFilterMode = obj->hasProperty("envFilterMode") ? obj->getProperty("envFilterMode").toString() : "flat";
        lb.envFilterFreq = obj->hasProperty("envFilterFreq") ? (float)(double) obj->getProperty("envFilterFreq") : 1000.0f;
        lb.envFilterBW   = obj->hasProperty("envFilterBW")   ? (float)(double) obj->getProperty("envFilterBW")   : 2.0f;
        // Convert mode+freq+bw to HPF/LPF cutoffs
        if (lb.envFilterMode == "lp")       { lb.envBandLo = 20.0f; lb.envBandHi = lb.envFilterFreq; }
        else if (lb.envFilterMode == "hp")  { lb.envBandLo = lb.envFilterFreq; lb.envBandHi = 20000.0f; }
        else if (lb.envFilterMode == "bp")  { lb.envBandLo = lb.envFilterFreq / std::pow(2.0f, lb.envFilterBW * 0.5f);
                                              lb.envBandHi = lb.envFilterFreq * std::pow(2.0f, lb.envFilterBW * 0.5f); }
        else                                { lb.envBandLo = 20.0f; lb.envBandHi = 20000.0f; } // flat

        // Polarity control (relative mode: bipolar, up, down)
        lb.polarity  = obj->getProperty ("polarity").toString();
        if (lb.polarity.isEmpty()) lb.polarity = "bipolar";

        // Clock source: "daw" or "internal"
        lb.clockSource  = obj->getProperty ("clockSource").toString();
        if (lb.clockSource.isEmpty()) lb.clockSource = "daw";
        lb.internalBpm  = (float) (double) obj->getProperty ("internalBpm");
        if (lb.internalBpm <= 0.0f) lb.internalBpm = 120.0f;

        // Sample modulator settings
        lb.loopMode      = obj->getProperty ("loopMode").toString();
        lb.sampleSpeed   = (float) (double) obj->getProperty ("sampleSpeed");
        lb.sampleReverse = (bool) obj->getProperty ("sampleReverse");
        lb.jumpMode      = obj->getProperty ("jumpMode").toString();

        // Defaults for missing values
        if (lb.loopMode.isEmpty()) lb.loopMode = "loop";
        if (lb.sampleSpeed <= 0.0f) lb.sampleSpeed = 1.0f;
        if (lb.jumpMode.isEmpty()) lb.jumpMode = "restart";

        // Morph Pad settings
        lb.morphMode    = obj->getProperty("morphMode").toString();
        lb.exploreMode  = obj->getProperty("exploreMode").toString();
        lb.lfoShape     = obj->getProperty("lfoShape").toString();
        lb.lfoDepth     = obj->hasProperty("lfoDepth") ? (float)(double) obj->getProperty("lfoDepth") : 0.8f;
        lb.lfoRotation  = obj->hasProperty("lfoRotation") ? (float)(double) obj->getProperty("lfoRotation") : 0.0f;
        lb.morphSpeed   = (float)(double) obj->getProperty("morphSpeed");
        lb.morphAction  = obj->getProperty("morphAction").toString();
        lb.stepOrder    = obj->getProperty("stepOrder").toString();
        lb.morphSource  = obj->getProperty("morphSource").toString();
        lb.playheadX    = (float)(double) obj->getProperty("playheadX");
        lb.playheadY    = (float)(double) obj->getProperty("playheadY");
        // Circular clamp â€” ensure playhead is inside the pad (r=0.45)
        { float pdx = lb.playheadX - 0.5f, pdy = lb.playheadY - 0.5f;
          float pd = std::sqrt (pdx * pdx + pdy * pdy);
          if (pd > 0.45f) { float ps = 0.45f / pd; lb.playheadX = 0.5f + pdx * ps; lb.playheadY = 0.5f + pdy * ps; } }
        lb.jitter       = (float)(double) obj->getProperty("jitter");
        lb.morphGlide   = (float)(double) obj->getProperty("morphGlide");
        lb.morphTempoSync = (bool) obj->getProperty("morphTempoSync");
        lb.morphSyncDiv   = obj->getProperty("morphSyncDiv").toString();
        lb.snapRadius     = (float)(double) obj->getProperty("snapRadius");

        // Defaults
        if (lb.morphMode.isEmpty())   lb.morphMode = "manual";
        if (lb.exploreMode.isEmpty()) lb.exploreMode = "wander";
        if (lb.exploreMode == "lfo")  lb.exploreMode = "shapes"; // backward compat
        if (lb.lfoShape.isEmpty())    lb.lfoShape = "circle";
        if (lb.morphAction.isEmpty()) lb.morphAction = "jump";
        if (lb.stepOrder.isEmpty())   lb.stepOrder = "cycle";
        if (lb.morphSource.isEmpty()) lb.morphSource = "midi";
        if (lb.morphGlide <= 0.0f)    lb.morphGlide = 200.0f;
        if (lb.morphSyncDiv.isEmpty()) lb.morphSyncDiv = "1/4";
        if (lb.snapRadius <= 0.0f)    lb.snapRadius = 1.0f;

        // â”€â”€ Shapes Block fields â”€â”€
        lb.shapeType      = obj->getProperty("shapeType").toString();
        lb.shapeTracking  = obj->getProperty("shapeTracking").toString();
        lb.shapeSize      = (float)(double) obj->getProperty("shapeSize");
        lb.shapeSpin      = (float)(double) obj->getProperty("shapeSpin");
        lb.shapeSpeed     = (float)(double) obj->getProperty("shapeSpeed");
        lb.shapePhaseOffset = (float)(double) obj->getProperty("shapePhaseOffset");
        lb.shapeDepth     = (float)(double) obj->getProperty("shapeDepth");
        lb.shapeRange     = obj->getProperty("shapeRange").toString();
        lb.shapePolarity  = obj->getProperty("shapePolarity").toString();
        lb.shapeTempoSync = (bool) obj->getProperty("shapeTempoSync");
        lb.shapeSyncDiv   = obj->getProperty("shapeSyncDiv").toString();
        lb.shapeTrigger   = obj->getProperty("shapeTrigger").toString();
        if (lb.shapeType.isEmpty())     lb.shapeType = "circle";
        if (lb.shapeTracking.isEmpty()) lb.shapeTracking = "horizontal";
        if (lb.shapeRange.isEmpty())    lb.shapeRange = "relative";
        if (lb.shapePolarity.isEmpty()) lb.shapePolarity = "bipolar";
        if (lb.shapeSyncDiv.isEmpty())  lb.shapeSyncDiv = "1/4";
        if (lb.shapeTrigger.isEmpty())  lb.shapeTrigger = "free";

        // Per-param ranges for shapes_range mode
        auto rangesVar = obj->getProperty("targetRanges");
        if (rangesVar.isArray())
        {
            for (int ri = 0; ri < rangesVar.size(); ++ri)
                lb.targetRangeValues.push_back((float)(double) rangesVar[ri]);
        }
        // Per-param base values (anchor positions) for shapes_range mode
        auto rangeBasesVar = obj->getProperty("targetRangeBases");
        if (rangeBasesVar.isArray())
        {
            for (int ri = 0; ri < rangeBasesVar.size(); ++ri)
                lb.targetRangeBaseValues.push_back((float)(double) rangeBasesVar[ri]);
        }

        // -- Lane clips --
        auto lanesVar = obj->getProperty("lanes");
        if (lanesVar.isArray())
        {
            for (int li = 0; li < lanesVar.size(); ++li)
            {
                if (auto* lObj = lanesVar[li].getDynamicObject())
                {
                    LogicBlock::LaneClip lc;
                    // Parse lane targets (multi-param per lane)
                    auto laneTargetsVar = lObj->getProperty("targets");
                    if (laneTargetsVar.isArray())
                    {
                        for (int lt = 0; lt < laneTargetsVar.size(); ++lt)
                        {
                            if (auto* ltObj = laneTargetsVar[lt].getDynamicObject())
                            {
                                LogicBlock::LaneClip::LaneTarget tgt;
                                tgt.pluginId   = (int) ltObj->getProperty("pluginId");
                                tgt.paramIndex = (int) ltObj->getProperty("paramIndex");
                                lc.targets.push_back(tgt);
                            }
                        }
                    }
                    else
                    {
                        // Backwards compat: single pluginId/paramIndex
                        LogicBlock::LaneClip::LaneTarget tgt;
                        tgt.pluginId   = (int) lObj->getProperty("pluginId");
                        tgt.paramIndex = (int) lObj->getProperty("paramIndex");
                        lc.targets.push_back(tgt);
                    }
                    lc.loopLen    = lObj->getProperty("loopLen").toString();
                    lc.steps      = (float)(double) lObj->getProperty("steps"); // 0=off, 2-32
                    lc.depth      = (float)(double) lObj->getProperty("depth");
                    lc.drift      = (lObj->hasProperty("drift") ? (float)(double) lObj->getProperty("drift") : (float)(double) lObj->getProperty("slew")) / 50.0f;  // -1..+1 (fallback: legacy slew)
                    lc.driftRange = lObj->hasProperty("driftRange") ? (float)(double) lObj->getProperty("driftRange") : 5.0f;
                    lc.driftScale = lObj->hasProperty("driftScale") ? lObj->getProperty("driftScale").toString() : "1/1";
                    lc.driftScaleBeats = parseBeatsPerDiv(lc.driftScale);
                    lc.warp       = (float)(double) lObj->getProperty("warp") / 50.0f;   // -1..+1

                    lc.interp     = lObj->getProperty("interp").toString();
                    lc.synced     = (bool) lObj->getProperty("synced");
                    lc.muted      = (bool) lObj->getProperty("muted");
                    lc.playMode   = lObj->getProperty("playMode").toString();
                    lc.freeSecs   = (float)(double) lObj->getProperty("freeSecs");
                    if (lc.loopLen.isEmpty()) lc.loopLen = "1/1";
                    if (lc.interp.isEmpty())  lc.interp = "smooth";
                    if (lc.playMode.isEmpty()) lc.playMode = "forward";
                    if (lc.freeSecs <= 0.0f) lc.freeSecs = 4.0f;

                    // Oneshot / trigger config
                    lc.oneshotMode = (lObj->hasProperty("trigMode") ? lObj->getProperty("trigMode").toString() : "loop") == "oneshot";
                    juce::String trigSrc = lObj->hasProperty("trigSource") ? lObj->getProperty("trigSource").toString() : "manual";
                    lc.trigSourceE = (trigSrc == "midi") ? 1 : (trigSrc == "audio") ? 2 : 0;
                    lc.trigMidiNote = lObj->hasProperty("trigMidiNote") ? (int) lObj->getProperty("trigMidiNote") : -1;
                    lc.trigMidiCh = lObj->hasProperty("trigMidiCh") ? (int) lObj->getProperty("trigMidiCh") : 0;
                    float threshDb = lObj->hasProperty("trigThreshold") ? (float)(double) lObj->getProperty("trigThreshold") : -12.0f;
                    lc.trigThresholdLin = std::pow(10.0f, threshDb / 20.0f);
                    lc.trigRetrigger = lObj->hasProperty("trigRetrigger") ? (bool) lObj->getProperty("trigRetrigger") : true;
                    lc.trigHold = lObj->hasProperty("trigHold") ? (bool) lObj->getProperty("trigHold") : false;
                    lc.trigAudioSrc = (lObj->hasProperty("trigAudioSrc") ? lObj->getProperty("trigAudioSrc").toString() : "main") == "sidechain";

                    auto ptsVar = lObj->getProperty("pts");
                    if (ptsVar.isArray())
                    {
                        for (int pi = 0; pi < ptsVar.size(); ++pi)
                        {
                            if (auto* ptObj = ptsVar[pi].getDynamicObject())
                            {
                                LogicBlock::LaneClip::Point pt;
                                pt.x = (float)(double) ptObj->getProperty("x");
                                pt.y = (float)(double) ptObj->getProperty("y");
                                lc.pts.push_back(pt);
                            }
                        }
                    }

                    // Morph lane mode
                    lc.morphMode = lObj->hasProperty("morphMode") ? (bool) lObj->getProperty("morphMode") : false;
                    auto morphSnapsVar = lObj->getProperty("morphSnapshots");
                    if (morphSnapsVar.isArray())
                    {
                        for (int ms = 0; ms < morphSnapsVar.size(); ++ms)
                        {
                            if (auto* msObj = morphSnapsVar[ms].getDynamicObject())
                            {
                                LogicBlock::LaneClip::MorphSnapshot snap;
                                snap.position = (float)(double) msObj->getProperty("position");
                                snap.hold = msObj->hasProperty("hold") ? (float)(double) msObj->getProperty("hold") : 0.5f;
                                snap.curve = msObj->hasProperty("curve") ? (int) msObj->getProperty("curve") : 0;
                                snap.depth = msObj->hasProperty("depth") ? (float)(double) msObj->getProperty("depth") : 1.0f;
                                snap.drift = msObj->hasProperty("drift") ? (float)(double) msObj->getProperty("drift") : (msObj->hasProperty("slew") ? (float)(double) msObj->getProperty("slew") : 0.0f);
                                snap.driftRange = msObj->hasProperty("driftRange") ? (float)(double) msObj->getProperty("driftRange") : 5.0f;
                                {
                                    juce::String dsStr = msObj->hasProperty("driftScale") ? msObj->getProperty("driftScale").toString()
                                                       : (lObj->hasProperty("driftScale") ? lObj->getProperty("driftScale").toString() : "1/1");
                                    snap.driftScaleBeats = parseBeatsPerDiv(dsStr);
                                }
                                snap.warp  = msObj->hasProperty("warp")  ? (float)(double) msObj->getProperty("warp")  : 0.0f;
                                snap.steps = msObj->hasProperty("steps") ? (int) msObj->getProperty("steps") : 0;
                                snap.label = msObj->getProperty("name").toString();
                                snap.source = msObj->getProperty("source").toString();
                                auto valsVar = msObj->getProperty("values");
                                if (auto* valsObj = valsVar.getDynamicObject())
                                {
                                    for (auto& prop : valsObj->getProperties())
                                    {
                                        snap.values[prop.name.toString().toStdString()] = (float)(double) prop.value;
                                    }
                                }
                                lc.morphSnapshots.push_back(std::move(snap));
                            }
                        }
                        // Ensure sorted by position
                        std::sort(lc.morphSnapshots.begin(), lc.morphSnapshots.end(),
                            [](const auto& a, const auto& b) { return a.position < b.position; });

                        // -- Pre-parse snapshot values for audio thread (ZERO allocations at RT) --
                        // Convert string keys "pluginId:paramIndex" ? integer pairs.
                        // Sort by (pluginId, paramIndex) so all snapshots share the same key order,
                        // enabling index-matched iteration on the audio thread.
                        for (auto& snap : lc.morphSnapshots)
                        {
                            snap.parsedValues.clear();
                            snap.parsedValues.reserve(snap.values.size());
                            for (const auto& [key, val] : snap.values)
                            {
                                auto colon = key.find(':');
                                if (colon != std::string::npos)
                                {
                                    LogicBlock::LaneClip::MorphSnapshot::ParsedValue pv;
                                    pv.pluginId = std::atoi(key.substr(0, colon).c_str());
                                    pv.paramIndex = std::atoi(key.substr(colon + 1).c_str());
                                    pv.value = val;
                                    snap.parsedValues.push_back(pv);
                                }
                            }
                            // Sort so index i in snapA == index i in snapB for same param
                            std::sort(snap.parsedValues.begin(), snap.parsedValues.end(),
                                [](const auto& a, const auto& b) {
                                    return a.pluginId < b.pluginId ||
                                           (a.pluginId == b.pluginId && a.paramIndex < b.paramIndex);
                                });
                        }
                    }

                    // -- Pre-build sorted target key set for audio thread --
                    lc.targetKeySorted.clear();
                    lc.targetKeySorted.reserve(lc.targets.size());
                    for (const auto& tgt : lc.targets)
                        lc.targetKeySorted.push_back({ tgt.pluginId, tgt.paramIndex });
                    std::sort(lc.targetKeySorted.begin(), lc.targetKeySorted.end());

                    lb.laneClips.push_back(std::move(lc));
                }
            }
        }

        // Parse snapshots array
        auto snapsVar = obj->getProperty("snapshots");
        if (snapsVar.isArray()) {
            for (int si = 0; si < snapsVar.size() && si < 12; ++si) {
                if (auto* sObj = snapsVar[si].getDynamicObject()) {
                    LogicBlock::MorphSnapshot snap;
                    snap.x = (float)(double) sObj->getProperty("x");
                    snap.y = (float)(double) sObj->getProperty("y");
                    auto valsVar = sObj->getProperty("targetValues");
                    if (valsVar.isArray()) {
                        for (int vi = 0; vi < valsVar.size(); ++vi)
                            snap.targetValues.push_back((float)(double) valsVar[vi]);
                    }
                    lb.snapshots.push_back(snap);
                }
            }
        }

        // Parse targets array: [{hostId, paramIndex}, ...]
        auto targetsVar = obj->getProperty ("targets");
        if (targetsVar.isArray())
        {
            for (int t = 0; t < targetsVar.size(); ++t)
            {
                if (auto* tObj = targetsVar[t].getDynamicObject())
                {
                    ParamTarget pt;
                    pt.pluginId   = (int) tObj->getProperty ("hostId");
                    pt.paramIndex = (int) tObj->getProperty ("paramIndex");
                    lb.targets.push_back (pt);
                }
            }
        }

        // Parse targetBases array (base values captured at assignment time in JS)
        auto basesVar = obj->getProperty ("targetBases");
        if (basesVar.isArray())
        {
            lb.targetBaseValues.resize (lb.targets.size(), 0.5f);
            lb.targetLastWritten.resize (lb.targets.size(), 0.5f);
            for (int t = 0; t < basesVar.size() && t < (int) lb.targets.size(); ++t)
            {
                float base = (float)(double) basesVar[t];
                lb.targetBaseValues[t] = base;
                lb.targetLastWritten[t] = base;
            }
        }

        // Preserve runtime state from existing blocks with matching ID
        for (const auto& existing : logicBlocks)
        {
            if (existing.id == lb.id)
            {
                lb.currentEnvValue     = existing.currentEnvValue;
                lb.lastBeat            = existing.lastBeat;
                lb.lastAudioTrigSample = existing.lastAudioTrigSample;
                lb.internalPpq         = existing.internalPpq;

                // Preserve sample data and playback state
                lb.sampleData      = existing.sampleData;
                lb.samplePlayhead  = existing.samplePlayhead;
                lb.sampleDirection = existing.sampleDirection;

                // Preserve relative-mode base values if mode and targets unchanged
                // Covers both randomize/sample (rangeMode) and shapes (shapeRange)
                bool newRelative = (lb.rangeMode == "relative" || lb.shapeRange == "relative");
                bool oldRelative = (existing.rangeMode == "relative" || existing.shapeRange == "relative");
                if (newRelative && oldRelative
                    && lb.targets.size() == existing.targets.size())
                {
                    // Carry over base values and last-written state smoothly
                    // Polarity changes only affect the formula, no need to reset params
                    lb.targetBaseValues = existing.targetBaseValues;
                    lb.targetLastWritten = existing.targetLastWritten;
                }

                // Preserve morph runtime state
                lb.morphVelX      = existing.morphVelX;
                lb.morphVelY      = existing.morphVelY;
                lb.morphAngle     = existing.morphAngle;
                lb.morphLfoPhase  = existing.morphLfoPhase;
                lb.morphStepIndex = existing.morphStepIndex;
                lb.morphSmoothX   = existing.morphSmoothX;
                lb.morphSmoothY   = existing.morphSmoothY;
                lb.prevAppliedX   = existing.prevAppliedX;
                lb.prevAppliedY   = existing.prevAppliedY;
                lb.morphNoisePhaseX = existing.morphNoisePhaseX;
                lb.morphNoisePhaseY = existing.morphNoisePhaseY;
                lb.morphOrbitPhase  = existing.morphOrbitPhase;
                lb.morphOrbitTarget = existing.morphOrbitTarget;
                lb.morphPathProgress = existing.morphPathProgress;
                lb.morphPathIndex   = existing.morphPathIndex;
                lb.lfoRotAngle      = existing.lfoRotAngle;

                // Preserve shapes runtime state
                lb.shapePhase    = existing.shapePhase;
                lb.shapeRotAngle = existing.shapeRotAngle;
                lb.smoothedRangeValues = existing.smoothedRangeValues;
                lb.smoothedShapeDepth = existing.smoothedShapeDepth;
                lb.shapeWasPlaying = existing.shapeWasPlaying;
                lb.shapeWasEnabled = existing.shapeWasEnabled;

                // Preserve envelope follower runtime state
                lb.currentEnvValue = existing.currentEnvValue;
                lb.envHpf = existing.envHpf;
                lb.envLpf = existing.envLpf;

                // Preserve lane playhead positions
                if (lb.laneClips.size() == existing.laneClips.size())
                {
                    for (size_t li = 0; li < lb.laneClips.size(); ++li)
                    {
                        lb.laneClips[li].playhead = existing.laneClips[li].playhead;
                        lb.laneClips[li].direction = existing.laneClips[li].direction;
                        lb.laneClips[li].driftPhase = existing.laneClips[li].driftPhase;
                        lb.laneClips[li].wasPlaying = existing.laneClips[li].wasPlaying;
                        lb.laneClips[li].oneshotActive = existing.laneClips[li].oneshotActive;
                        lb.laneClips[li].oneshotDone = existing.laneClips[li].oneshotDone;
                        lb.laneClips[li].midiNoteHeld = existing.laneClips[li].midiNoteHeld;
                    }
                }

                // Force prevApplied to match morphSmooth so the block rebuild
                // doesn't trigger a spurious IDW re-application (which would
                // overwrite any manual parameter tweaks the user has made).
                lb.prevAppliedX = lb.morphSmoothX;
                lb.prevAppliedY = lb.morphSmoothY;

                break;
            }
        }
        // H4 fix: parse string fields ? enum mirrors + pre-compute beat divisions
        // Called once on message thread so processBlock uses integer comparisons.
        lb.modeE          = parseBlockMode (lb.mode);
        lb.triggerE       = parseTriggerType (lb.trigger);
        lb.midiModeE      = parseMidiTrigMode (lb.midiMode);
        lb.audioSrcE      = parseAudioSource (lb.audioSrc);
        lb.rangeModeE     = parseRangeMode (lb.rangeMode);
        lb.movementE      = parseMovement (lb.movement);
        lb.polarityE      = parsePolarity (lb.polarity);
        lb.clockSourceE   = parseClockSource (lb.clockSource);
        lb.loopModeE      = parseLoopMode (lb.loopMode);
        lb.jumpModeE      = parseJumpMode (lb.jumpMode);
        lb.morphModeE     = parseMorphMode (lb.morphMode);
        lb.exploreModeE   = parseExploreMode (lb.exploreMode);
        lb.lfoShapeE      = parseLfoShape (lb.lfoShape);
        lb.morphActionE   = parseMorphAction (lb.morphAction);
        lb.stepOrderE     = parseStepOrder (lb.stepOrder);
        lb.shapeTypeE     = parseLfoShape (lb.shapeType);
        lb.shapeTrackingE = parseShapeTracking (lb.shapeTracking);
        lb.shapeRangeE    = parseRangeMode (lb.shapeRange);
        lb.shapePolarityE = parsePolarity (lb.shapePolarity);
        lb.shapeTriggerE  = parseShapeTrigger (lb.shapeTrigger);
        lb.beatDivBeats     = parseBeatsPerDiv (lb.beatDiv);
        lb.morphSyncDivBeats = parseBeatsPerDiv (lb.morphSyncDiv);
        lb.shapeSyncDivBeats = parseBeatsPerDiv (lb.shapeSyncDiv);

        // Force relative for continuous blocks — absolute only valid for Randomize
        if (lb.modeE == BlockMode::Envelope || lb.modeE == BlockMode::Sample)
            lb.rangeModeE = RangeMode::Relative;
        if (lb.modeE == BlockMode::Shapes || lb.modeE == BlockMode::ShapesRange)
            lb.shapeRangeE = RangeMode::Relative;

        // Pre-compute lane clip enums + beat division floats
        for (auto& lc : lb.laneClips)
        {
            lc.interpE   = parseLaneInterp (lc.interp);
            lc.playModeE = parseLanePlayMode (lc.playMode);
            lc.loopLenFree = (lc.loopLen == "free");
            lc.loopLenBeats = lc.loopLenFree ? 0.0f : parseBeatsPerDiv (lc.loopLen);
        }

        // H3 fix: Pre-allocate vectors that processBlock uses, so the audio thread
        // never needs to call resize() (which can heap-allocate).
        auto n = lb.targets.size();
        if (lb.targetBaseValues.size() != n)
        {
            lb.targetBaseValues.resize (n, 0.5f);
            lb.targetLastWritten.resize (n, -1.0f);
        }
        // smoothedRangeValues for shapes_range mode
        if (lb.modeE == BlockMode::ShapesRange && lb.smoothedRangeValues.size() < n)
            lb.smoothedRangeValues.resize (n, 0.0f);

        newBlocks.push_back (std::move (lb));
    }

    std::lock_guard<std::mutex> lock (blockMutex);

    // Restore base values for blocks that transitioned enabledâ†’disabled
    // or lost targets (proper modulation recall behavior)
    for (const auto& old : logicBlocks)
    {
        if (!old.enabled || old.targetBaseValues.empty()) continue;

        // Find matching new block
        const LogicBlock* newLb = nullptr;
        for (const auto& nb : newBlocks)
        {
            if (nb.id == old.id) { newLb = &nb; break; }
        }

        bool wasModulating = old.enabled && !old.targets.empty()
            && (old.modeE == BlockMode::Envelope || old.modeE == BlockMode::Shapes || old.modeE == BlockMode::ShapesRange
                || old.modeE == BlockMode::MorphPad || old.modeE == BlockMode::Sample || old.modeE == BlockMode::Lane);

        if (!wasModulating) continue;

        // Block removed, disabled, or targets cleared â†’ restore bases
        bool shouldRestore = (newLb == nullptr)
            || (!newLb->enabled)
            || (newLb->targets.empty());

        if (shouldRestore)
        {
            for (size_t ti = 0; ti < old.targets.size() && ti < old.targetBaseValues.size(); ++ti)
            {
                setHostedParam (old.targets[ti].pluginId, old.targets[ti].paramIndex,
                                old.targetBaseValues[ti]);
                int slot = slotForId (old.targets[ti].pluginId);
                if (slot >= 0 && old.targets[ti].paramIndex < kMaxParams)
                {
                    paramWritten[slot][old.targets[ti].paramIndex] = -1.0f;
                    paramTouched[slot][old.targets[ti].paramIndex].store (false, std::memory_order_release);
                }
            }
        }
        else if (newLb != nullptr)
        {
            // Check for specific targets that were removed
            for (size_t ti = 0; ti < old.targets.size() && ti < old.targetBaseValues.size(); ++ti)
            {
                bool stillPresent = false;
                for (const auto& nt : newLb->targets)
                {
                    if (nt.pluginId == old.targets[ti].pluginId && nt.paramIndex == old.targets[ti].paramIndex)
                    { stillPresent = true; break; }
                }
                if (!stillPresent)
                {
                    setHostedParam (old.targets[ti].pluginId, old.targets[ti].paramIndex,
                                    old.targetBaseValues[ti]);
                    int slot = slotForId (old.targets[ti].pluginId);
                    if (slot >= 0 && old.targets[ti].paramIndex < kMaxParams)
                    {
                        paramWritten[slot][old.targets[ti].paramIndex] = -1.0f;
                        paramTouched[slot][old.targets[ti].paramIndex].store (false, std::memory_order_release);
                    }
                }
            }
        }
    }

    // Clear paramTouched only for params belonging to blocks whose config changed
    // (prevents stale touched state while not disrupting unrelated knob drags)
    for (auto& nb : newBlocks)
    {
        // Find matching old block
        const LogicBlock* oldMatch = nullptr;
        for (auto& old : logicBlocks)
            if (old.id == nb.id) { oldMatch = &old; break; }

        // If block is new, changed mode, or changed targets ? clear touched for its targets
        bool changed = (oldMatch == nullptr)
                     || (oldMatch->mode != nb.mode)
                     || (oldMatch->targets.size() != nb.targets.size());

        if (!changed && oldMatch)
        {
            for (size_t ti = 0; ti < nb.targets.size(); ++ti)
            {
                if (nb.targets[ti].pluginId != oldMatch->targets[ti].pluginId
                    || nb.targets[ti].paramIndex != oldMatch->targets[ti].paramIndex)
                { changed = true; break; }
            }
        }

        if (changed)
        {
            for (auto& tgt : nb.targets)
            {
                int slot = slotForId (tgt.pluginId);
                if (slot >= 0 && tgt.paramIndex < kMaxParams)
                    paramTouched[slot][tgt.paramIndex].store (false, std::memory_order_release);
            }
        }
    }

    logicBlocks = std::move (newBlocks);
}

void HostesaAudioProcessor::updateMorphPlayhead (int blockId, float x, float y)
{
    std::lock_guard<std::mutex> lock (blockMutex);
    for (auto& lb : logicBlocks)
    {
        if (lb.id == blockId && lb.mode == "morph_pad")
        {
            // Circular clamp (r=0.45) before storing
            float dx = x - 0.5f, dy = y - 0.5f;
            float d = std::sqrt (dx * dx + dy * dy);
            if (d > 0.45f) { float s = 0.45f / d; x = 0.5f + dx * s; y = 0.5f + dy * s; }
            lb.playheadX = x;
            lb.playheadY = y;
            break;
        }
    }
}

void HostesaAudioProcessor::fireLaneTrigger (int blockId, int laneIdx)
{
    std::lock_guard<std::mutex> lock (blockMutex);
    for (auto& lb : logicBlocks)
    {
        if (lb.id == blockId && (int) lb.laneClips.size() > laneIdx)
        {
            lb.laneClips[laneIdx].manualTrigger = true;
            break;
        }
    }
}

int HostesaAudioProcessor::slotForId (int pluginId) const
{
    // Use pluginId directly as the array slot (modulo kMaxPlugins).
    // pluginIds are unique and monotonically increasing, so no collisions
    // occur as long as we don't exceed kMaxPlugins simultaneous plugins.
    if (pluginId < 0) return -1;
    return pluginId % kMaxPlugins;
}

int HostesaAudioProcessor::getSpectrumBins (float* outBins, int maxBins)
{
    if (!fftReady.load()) return 0;
    fftReady.store (false);

    // Perform FFT (on message thread — safe, no audio thread overhead)
    juce::dsp::FFT fft (fftOrder);
    fft.performRealOnlyForwardTransform (fftWorkBuffer, true);

    int halfSize = fftSize / 2;
    int numBins = juce::jmin (spectrumBinCount, maxBins);

    // Map to log-spaced frequency bins (20Hz - 20kHz)
    float minFreq = 20.0f;
    float maxFreq = 20000.0f;
    float logMin = std::log10 (minFreq);
    float logMax = std::log10 (maxFreq);
    float sr = (float) currentSampleRate;
    if (sr < 1.0f) sr = 44100.0f;

    for (int b = 0; b < numBins; ++b)
    {
        // Frequency at this bin position
        float t = (float) b / (float) (numBins - 1);
        float freq = std::pow (10.0f, logMin + t * (logMax - logMin));

        // Map frequency to FFT bin index
        int fftBin = juce::jlimit (0, halfSize - 1, (int) (freq * (float) fftSize / sr));

        // Average a small range of bins for smoother display
        int lo = juce::jmax (0, fftBin - 1);
        int hi = juce::jmin (halfSize - 1, fftBin + 1);
        float mag = 0.0f;
        for (int i = lo; i <= hi; ++i)
        {
            float re = fftWorkBuffer[i * 2];
            float im = fftWorkBuffer[i * 2 + 1];
            mag += std::sqrt (re * re + im * im);
        }
        mag /= (float) (hi - lo + 1);

        // Convert to dB
        float db = mag > 0.0f ? 20.0f * std::log10 (mag / (float) fftSize) : -100.0f;
        outBins[b] = juce::jlimit (-100.0f, 20.0f, db);
    }

    return numBins;
}

void HostesaAudioProcessor::rebuildPluginSlots()
{
    // Called from message thread whenever plugins are added/removed/reordered.
    // Populates O(1) lookup table used by audio thread hot path.
    std::memset (pluginSlots, 0, sizeof (pluginSlots));

    // Remove old gesture listeners BEFORE destroying them (prevents dangling pointers)
    for (auto& hp : hostedPlugins)
    {
        if (hp && hp->instance)
        {
            auto& params = hp->instance->getParameters();
            for (auto& gl : gestureListeners)
                for (auto* p : params)
                    p->removeListener (gl.get());
        }
    }
    gestureListeners.clear();

    for (auto& hp : hostedPlugins)
    {
        if (hp)
        {
            int slot = slotForId (hp->id);
            if (slot >= 0)
                pluginSlots[slot] = hp.get();

            // Register gesture listeners on all params for hosted-UI touch detection.
            if (hp->instance && slot >= 0)
            {
                auto listener = std::make_unique<GestureListener> (slot, paramTouched);
                auto& params = hp->instance->getParameters();
                for (auto* p : params)
                    p->addListener (listener.get());
                gestureListeners.push_back (std::move (listener));
            }
        }
    }
}

// The actual gesture callback is handled by GestureListener (see header)
void HostesaAudioProcessor::parameterGestureChanged (int, bool) {}


void HostesaAudioProcessor::setParamDirect (int pluginId, int paramIndex, float value)
{
    // -- WrongEQ virtual params: write modulation OFFSETS to eqPoints --
    // The base values (freqHz, gainDB, q) are set by JS via setEqCurve().
    // Modulation writes to separate modFreqHz/modGainDB/modQ offsets so
    // JS drift animation doesn't fight with C++ modulation sources.
    if (pluginId == kWeqPluginId)
    {
        // -- Per-band params (0..31): band*4+field --
        if (paramIndex >= 0 && paramIndex < maxEqBands * 4)
        {
            int band  = paramIndex / 4;
            int field = paramIndex % 4;
            if (band >= 0 && band < numEqPoints.load (std::memory_order_relaxed))
            {
                switch (field)
                {
                    case 0: // freqHz (log: norm 0..1 ? 20..20000 Hz)
                    {
                        float targetHz = 20.0f * std::pow (1000.0f, juce::jlimit (0.0f, 1.0f, value));
                        float baseHz   = eqPoints[band].freqHz.load (std::memory_order_relaxed);
                        eqPoints[band].modFreqHz.store (targetHz - baseHz, std::memory_order_relaxed);
                        eqPoints[band].modActive.store (true, std::memory_order_relaxed);
                        break;
                    }
                    case 1: // gainDB (norm 0..1 ? -maxDB..+maxDB dB)
                    {
                        float maxDB   = eqDbRange.load (std::memory_order_relaxed);
                        float targetDB = juce::jlimit (0.0f, 1.0f, value) * maxDB * 2.0f - maxDB;
                        float baseDB   = eqPoints[band].gainDB.load (std::memory_order_relaxed);
                        eqPoints[band].modGainDB.store (targetDB - baseDB, std::memory_order_relaxed);
                        eqPoints[band].modActive.store (true, std::memory_order_relaxed);
                        break;
                    }
                    case 2: // Q (norm 0..1 ? 0.025..40.0)
                    {
                        float targetQ = 0.025f + juce::jlimit (0.0f, 1.0f, value) * 39.975f;
                        float baseQ   = eqPoints[band].q.load (std::memory_order_relaxed);
                        eqPoints[band].modQ.store (targetQ - baseQ, std::memory_order_relaxed);
                        eqPoints[band].modActive.store (true, std::memory_order_relaxed);
                        break;
                    }
                    case 3: // driftPct (norm 0..1 ? 0..100%)
                        eqPoints[band].driftPct.store (juce::jlimit (0.0f, 1.0f, value) * 100.0f,
                                                        std::memory_order_relaxed);
                        eqDirty.store (true, std::memory_order_release);
                        break;
                }
            }
        }
        // -- Global params (100..110): EQ globals --
        else if (paramIndex >= kWeqGlobalBase && paramIndex < kWeqGlobalBase + kWeqGlobalCount)
        {
            int g = paramIndex - kWeqGlobalBase;
            float v = juce::jlimit (0.0f, 1.0f, value);
            switch (g)
            {
                case 0: // depth (norm 0..1 ? 0..200%)
                    eqGlobalDepth.store (v * 200.0f, std::memory_order_relaxed);
                    eqDirty.store (true, std::memory_order_release);
                    break;
                case 1: // warp (norm 0..1 ? -100..+100)
                    eqGlobalWarp.store (v * 200.0f - 100.0f, std::memory_order_relaxed);
                    eqDirty.store (true, std::memory_order_release);
                    break;
                case 2: // steps (norm 0..1 ? 0..32)
                    eqGlobalSteps.store ((int) (v * 32.0f), std::memory_order_relaxed);
                    eqDirty.store (true, std::memory_order_release);
                    break;
                case 3: // tilt (norm 0..1 ? -100..+100)
                    eqGlobalTilt.store (v * 200.0f - 100.0f, std::memory_order_relaxed);
                    eqDirty.store (true, std::memory_order_release);
                    break;
                // Cases 4-10 are JS-side meta params (drift, lfo) — they don't
                // have C++ atomics. Modulation for these is applied via JS weqApplyVirtualParam.
                // Setting eqDirty is enough to trigger a re-sync from JS.
                default:
                    eqDirty.store (true, std::memory_order_release);
                    break;
            }
        }
        return;
    }

    // Skip if user is currently grabbing this param (lock-free atomic read)
    int slot = slotForId (pluginId);
    if (slot < 0) return;

    if (paramIndex >= 0 && paramIndex < kMaxParams
        && paramTouched[slot][paramIndex].load (std::memory_order_acquire))
        return;

    // O(1) lookup via pluginSlots — no linear scan
    auto* hp = pluginSlots[slot];
    if (hp && hp->id == pluginId && hp->instance)
    {
        auto& params = hp->instance->getParameters();
        if (paramIndex >= 0 && paramIndex < params.size())
        {
            params[paramIndex]->setValue (value);
        }
    }
}

float HostesaAudioProcessor::getParamValue (int pluginId, int paramIndex) const
{
    // -- WrongEQ virtual params: read from eqPoints/globals atomics --
    if (pluginId == kWeqPluginId)
    {
        // Per-band params (0..31)
        if (paramIndex >= 0 && paramIndex < maxEqBands * 4)
        {
            int band  = paramIndex / 4;
            int field = paramIndex % 4;
            if (band >= 0 && band < numEqPoints.load (std::memory_order_relaxed))
            {
                switch (field)
                {
                    case 0: return std::log (eqPoints[band].freqHz.load (std::memory_order_relaxed) / 20.0f)
                                   / std::log (1000.0f);
                    case 1:
                    {
                        float maxDB = eqDbRange.load (std::memory_order_relaxed);
                        return (eqPoints[band].gainDB.load (std::memory_order_relaxed) + maxDB) / (maxDB * 2.0f);
                    }
                    case 2: return (eqPoints[band].q.load (std::memory_order_relaxed) - 0.025f) / 39.975f;
                    case 3: return eqPoints[band].driftPct.load (std::memory_order_relaxed) / 100.0f;
                }
            }
        }
        // Global params (100..113)
        else if (paramIndex >= kWeqGlobalBase && paramIndex < kWeqGlobalBase + kWeqGlobalCount)
        {
            int g = paramIndex - kWeqGlobalBase;
            switch (g)
            {
                case 0: return eqGlobalDepth.load (std::memory_order_relaxed) / 200.0f;
                case 1: return (eqGlobalWarp.load (std::memory_order_relaxed) + 100.0f) / 200.0f;
                case 2: return (float) eqGlobalSteps.load (std::memory_order_relaxed) / 32.0f;
                case 3: return (eqGlobalTilt.load (std::memory_order_relaxed) + 100.0f) / 200.0f;
                // Cases 4-13: JS-side meta params — no C++ atomics. Return 0.5 as safe default.
                default: return 0.5f;
            }
        }
        return 0.5f;
    }

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
    return 0.5f; // safe default center
}

void HostesaAudioProcessor::randomizeParams (int pluginId,
                                                        const std::vector<int>& paramIndices,
                                                        float minVal, float maxVal)
{
    // Persistent RNG — avoids identical sequences when called rapidly (M2 fix)
    static juce::Random messageThreadRng;

    // No mutex needed — hostedPlugins is structurally stable, setValue() is atomic
    for (auto& hp : hostedPlugins)
    {
        if (hp->id == pluginId && hp->instance != nullptr)
        {
            auto& params = hp->instance->getParameters();

            for (int idx : paramIndices)
            {
                if (idx >= 0 && idx < params.size())
                {
                    float val = minVal + messageThreadRng.nextFloat() * (maxVal - minVal);
                    params[idx]->setValue (juce::jlimit (0.0f, 1.0f, val));
                    recordSelfWrite (pluginId, idx);
                }
            }
            break;
        }
    }
}

void HostesaAudioProcessor::applyParamBatch (const juce::String& jsonBatch)
{
    // Batch param apply — sets N params in a single call.
    // JSON format: [{"p":pluginId,"i":paramIndex,"v":value}, ...]
    // No lock needed: hostedPlugins is structurally stable, setValue() is atomic.
    auto parsed = juce::JSON::parse (jsonBatch);
    if (! parsed.isArray()) return;

    for (int k = 0; k < parsed.size(); ++k)
    {
        auto* obj = parsed[k].getDynamicObject();
        if (obj == nullptr) continue;

        int pluginId   = (int) obj->getProperty ("p");
        int paramIndex = (int) obj->getProperty ("i");
        float value    = (float) (double) obj->getProperty ("v");

        for (auto& hp : hostedPlugins)
        {
            if (hp->id == pluginId && hp->instance != nullptr)
            {
                auto& params = hp->instance->getParameters();
                if (paramIndex >= 0 && paramIndex < params.size())
                {
                    params[paramIndex]->setValue (juce::jlimit (0.0f, 1.0f, value));
                    recordSelfWrite (pluginId, paramIndex);
                    updateParamBase (pluginId, paramIndex, juce::jlimit (0.0f, 1.0f, value));
                }
                break;
            }
        }
    }
}

std::vector<HostesaAudioProcessor::HostedPluginInfo>
HostesaAudioProcessor::getHostedPluginList()
{
    std::vector<HostedPluginInfo> result;
    std::lock_guard<std::mutex> lock (pluginMutex);

    for (auto& hp : hostedPlugins)
    {
        if (hp->id < 0) continue; // skip tombstoned entries
        HostedPluginInfo info;
        info.id = hp->id;
        info.name = hp->name;
        info.path = hp->path;
        info.manufacturer = hp->description.manufacturerName;
        info.numParams = hp->instance ? (int) hp->instance->getParameters().size() : 0;
        info.busId = hp->busId;
        info.isInstrument = hp->isInstrument;
        result.push_back (info);
    }
    return result;
}

juce::AudioPluginInstance* HostesaAudioProcessor::getHostedPluginInstance (int pluginId)
{
    std::lock_guard<std::mutex> lock (pluginMutex);

    for (auto& hp : hostedPlugins)
    {
        if (hp->id == pluginId && hp->instance != nullptr)
            return hp->instance.get();
    }
    return nullptr;
}

void HostesaAudioProcessor::setPluginBusId (int pluginId, int busId)
{
    std::lock_guard<std::mutex> lock (pluginMutex);
    for (auto& hp : hostedPlugins)
    {
        if (hp->id == pluginId)
        {
            // busId is now a stable UID (not a band index) — just store it.
            // 0 = unassigned, positive = matches eqPoints[p].busId for routing.
            hp->busId = std::max (0, busId);
            break;
        }
    }
}

void HostesaAudioProcessor::setBusVolume (int bus, float vol)
{
    if (bus >= 0 && bus < maxBuses)
        busVolume[bus].store (juce::jlimit (0.0f, 2.0f, vol));
}

void HostesaAudioProcessor::setBusMute (int bus, bool m)
{
    if (bus >= 0 && bus < maxBuses)
        busMute[bus].store (m);
}

void HostesaAudioProcessor::setBusSolo (int bus, bool s)
{
    if (bus >= 0 && bus < maxBuses)
        busSolo[bus].store (s);
}

// -- WrongEQ: receive curve data from JS --
void HostesaAudioProcessor::setEqCurve (const juce::String& jsonData)
{
    auto parsed = juce::JSON::parse (jsonData);
    if (parsed.isVoid()) return;

    auto* obj = parsed.getDynamicObject();
    if (! obj) return;

    // Global flags
    if (obj->hasProperty ("globalBypass"))
        eqGlobalBypass.store ((bool) obj->getProperty ("globalBypass"));
    if (obj->hasProperty ("preEq"))
        eqPreEq.store ((bool) obj->getProperty ("preEq"));
    if (obj->hasProperty ("unassignedMode"))
        eqUnassignedMode.store ((int) obj->getProperty ("unassignedMode"));
    if (obj->hasProperty ("splitMode"))
    {
        bool newSplit = (bool) obj->getProperty ("splitMode");
        if (newSplit != eqSplitMode.load())
        {
            eqSplitMode.store (newSplit);
            eqDirty.store (true, std::memory_order_release); // reconfigure crossovers
        }
    }
    // Oversampling factor (1=off, 2=2×, 4=4×)
    if (obj->hasProperty ("oversample"))
    {
        int newOS = juce::jlimit (1, 4, (int) obj->getProperty ("oversample"));
        // Normalize to valid values: 1, 2, or 4
        if (newOS == 3) newOS = 2;
        int oldOS = eqOversampleFactor.load();
        if (newOS != oldOS)
        {
            eqOversampleFactor.store (newOS);
            // Reconfigure oversampler (safe: setEqCurve is called from message thread)
            int numCh = getTotalNumOutputChannels();
            int order = (newOS >= 4) ? 2 : (newOS >= 2) ? 1 : 0;
            eqOversampleOrder = order;
            if (order > 0)
            {
                eqOversampler = std::make_unique<juce::dsp::Oversampling<float>>(
                    (juce::uint32) numCh, (juce::uint32) order,
                    juce::dsp::Oversampling<float>::filterHalfBandPolyphaseIIR, false);
                eqOversampler->initProcessing ((size_t) currentBlockSize);
                eqOversamplerReady = true;
            }
            else
            {
                eqOversampler.reset();
                eqOversamplerReady = false;
            }
        }
    }

    // Dynamic dB range: parse from JS so gain clamping uses the user-selected range
    if (obj->hasProperty ("dbRange"))
    {
        float dbr = (float)(double) obj->getProperty ("dbRange");
        eqDbRange.store (juce::jlimit (6.0f, 48.0f, dbr));
    }
    // Snapshot old global values to detect changes
    float oldDepth = eqGlobalDepth.load();
    float oldWarp  = eqGlobalWarp.load();
    int   oldSteps = eqGlobalSteps.load();
    float oldTilt  = eqGlobalTilt.load();

    // Global depth: scales all EQ gains (0-200%).
    // Skip if actively modulated by logic blocks (modbus would fight setEqCurve).
    // weqParamBase[slot] >= 0 when modulation was recently active (persists across buffers).
    if (obj->hasProperty ("globalDepth"))
    {
        int slot = weqSlot (kWeqGlobalBase + 0);
        if (slot < 0 || weqParamBase[slot] < -0.5f)
            eqGlobalDepth.store (juce::jlimit (0.0f, 200.0f, (float)(double) obj->getProperty ("globalDepth")));
    }
    // Global warp: S-curve contrast (-100 to +100)
    if (obj->hasProperty ("globalWarp"))
    {
        int slot = weqSlot (kWeqGlobalBase + 1);
        if (slot < 0 || weqParamBase[slot] < -0.5f)
            eqGlobalWarp.store (juce::jlimit (-100.0f, 100.0f, (float)(double) obj->getProperty ("globalWarp")));
    }
    // Global steps: quantize gain to N discrete levels (0 = continuous, =2 = stepped)
    if (obj->hasProperty ("globalSteps"))
    {
        int slot = weqSlot (kWeqGlobalBase + 2);
        if (slot < 0 || weqParamBase[slot] < -0.5f)
            eqGlobalSteps.store (juce::jlimit (0, 64, (int) obj->getProperty ("globalSteps")));
    }
    // Global tilt: frequency-dependent gain offset (-100 to +100)
    if (obj->hasProperty ("globalTilt"))
    {
        int slot = weqSlot (kWeqGlobalBase + 3);
        if (slot < 0 || weqParamBase[slot] < -0.5f)
            eqGlobalTilt.store (juce::jlimit (-100.0f, 100.0f, (float)(double) obj->getProperty ("globalTilt")));
    }

    // If any global EQ parameter changed, set eqDirty so biquad coefficients are recalculated.
    // Note: this triggers BIQUAD recalc but NOT crossover reconfig (gated separately by curveChanged).
    bool globalsChanged = (std::abs (eqGlobalDepth.load() - oldDepth) > 0.1f ||
                           std::abs (eqGlobalWarp.load() - oldWarp) > 0.1f ||
                           eqGlobalSteps.load() != oldSteps ||
                           std::abs (eqGlobalTilt.load() - oldTilt) > 0.1f);
    if (globalsChanged)
        eqDirty.store (true, std::memory_order_release);

    float maxDB = eqDbRange.load();

    auto pointsVar = obj->getProperty ("points");
    if (auto* pointsArr = pointsVar.getArray())
    {
        int n = juce::jmin ((int) pointsArr->size(), (int) maxEqBands);

        // Sort by frequency for crossover filter configuration
        struct PtSort { float hz; float db; int busId; bool solo; bool mute; float q; int filterType; float drift; bool preEq; int stereoMode; int slope; int origIdx; };
        std::vector<PtSort> sorted;
        sorted.reserve (n);
        for (int i = 0; i < n; ++i)
        {
            if (auto* pt = (*pointsArr)[i].getDynamicObject())
            {
                // Parse filter type string to int
                int ft = 0;
                auto typeStr = pt->getProperty ("type").toString().toLowerCase();
                if      (typeStr == "lp")   ft = 1;
                else if (typeStr == "hp")   ft = 2;
                else if (typeStr == "notch") ft = 3;
                else if (typeStr == "lshf") ft = 4;
                else if (typeStr == "hshf") ft = 5;

                int sl = pt->hasProperty ("slope") ? (int) pt->getProperty ("slope") : 1;
                if (sl != 1 && sl != 2 && sl != 4) sl = 1;

                sorted.push_back ({
                    (float)(double) pt->getProperty ("freqHz"),
                    (float)(double) pt->getProperty ("gainDB"),
                    (int) pt->getProperty ("busId"),
                    (bool) pt->getProperty ("solo"),
                    (bool) pt->getProperty ("mute"),
                    pt->hasProperty ("q") ? (float)(double) pt->getProperty ("q") : 0.707f,
                    ft,
                    pt->hasProperty ("drift") ? (float)(double) pt->getProperty ("drift") : 0.0f,
                    pt->hasProperty ("preEq") ? (bool) pt->getProperty ("preEq") : true,
                    pt->hasProperty ("stereoMode") ? (int) pt->getProperty ("stereoMode") : 0,
                    sl,
                    i
                });
            }
        }
        std::sort (sorted.begin(), sorted.end(),
                   [] (const PtSort& a, const PtSort& b) { return a.hz < b.hz; });

        // Only set eqDirty if the point data actually changed.
        // The animation calls setEqCurve periodically, but usually only
        // drift offsets change — user EQ points stay the same. Setting
        // eqDirty unconditionally caused crossover reconfig too often.
        bool pointDataChanged = ((int) sorted.size() != numEqPoints.load());
        if (!pointDataChanged)
        {
            for (int i = 0; i < (int) sorted.size() && !pointDataChanged; ++i)
            {
                int idx = sorted[i].origIdx;
                float curFreq = eqPoints[idx].freqHz.load();
                float curGain = eqPoints[idx].gainDB.load();
                float curQ    = eqPoints[idx].q.load();
                int   curFt   = eqPoints[idx].filterType.load();
                if (std::abs (curFreq - juce::jlimit (20.0f, 20000.0f, sorted[i].hz)) > 0.5f ||
                    std::abs (curGain - juce::jlimit (-maxDB, maxDB, sorted[i].db)) > 0.05f ||
                    std::abs (curQ - juce::jlimit (0.25f, 18.0f, sorted[i].q)) > 0.01f ||
                    curFt != sorted[i].filterType)
                    pointDataChanged = true;
            }
        }

        // Store sorted points into atomic arrays
        // KEY: Write to eqPoints[origIdx] (original JS order), NOT sorted position.
        // This keeps each biquad slot associated with the same logical point even
        // when points swap frequency order during drag — preventing massive
        // coefficient discontinuities (FabFilter Pro-Q 3 behavior).
        for (int i = 0; i < (int) sorted.size(); ++i)
        {
            int idx = sorted[i].origIdx;
            eqPoints[idx].freqHz.store (juce::jlimit (20.0f, 20000.0f, sorted[i].hz));
            eqPoints[idx].gainDB.store (juce::jlimit (-maxDB, maxDB, sorted[i].db));
            eqPoints[idx].busId.store (sorted[i].busId);
            eqPoints[idx].solo.store (sorted[i].solo);
            eqPoints[idx].mute.store (sorted[i].mute);
            eqPoints[idx].q.store (juce::jlimit (0.025f, 40.0f, sorted[i].q));
            eqPoints[idx].filterType.store (sorted[i].filterType);
            eqPoints[idx].driftPct.store (juce::jlimit (0.0f, 100.0f, sorted[i].drift));
            eqPoints[idx].preEq.store (sorted[i].preEq);
            eqPoints[idx].stereoMode.store (juce::jlimit (0, 2, sorted[i].stereoMode));
            eqPoints[idx].slope.store (sorted[i].slope);
        }

        // Store sorted order for crossover pass (sorted position ? original index)
        for (int i = 0; i < (int) sorted.size(); ++i)
            eqSortOrder[i] = sorted[i].origIdx;
        for (int i = (int) sorted.size(); i < maxEqBands; ++i)
            eqSortOrder[i] = -1;

        // Clear unused slots
        for (int i = (int) sorted.size(); i < maxEqBands; ++i)
        {
            eqPoints[i].busId.store (-1);
            eqPoints[i].solo.store (false);
            eqPoints[i].mute.store (false);
            eqPoints[i].q.store (0.707f);
            eqPoints[i].filterType.store (0);
            eqPoints[i].driftPct.store (0.0f);
            eqPoints[i].stereoMode.store (0);
            eqPoints[i].slope.store (1);
        }

        numEqPoints.store ((int) sorted.size());
        if (pointDataChanged)
            eqDirty.store (true, std::memory_order_release);
    }

}

//==============================================================================
//==============================================================================
void HostesaAudioProcessor::setUiState (const juce::String& json)
{
    std::lock_guard<std::mutex> lock (uiStateMutex);
    uiStateJson = json;
}

juce::String HostesaAudioProcessor::getUiState() const
{
    std::lock_guard<std::mutex> lock (uiStateMutex);
    return uiStateJson;
}

//==============================================================================
// Sample Modulator API
//==============================================================================

bool HostesaAudioProcessor::loadSampleForBlock (int blockId, const juce::String& filePath)
{
    juce::File file (filePath);
    if (! file.existsAsFile())
    {
        LOG_TO_FILE ("loadSampleForBlock: file not found: " << filePath.toStdString());
        return false;
    }

    std::unique_ptr<juce::AudioFormatReader> reader (audioFileFormatManager.createReaderFor (file));
    if (reader == nullptr)
    {
        LOG_TO_FILE ("loadSampleForBlock: unsupported format: " << filePath.toStdString());
        return false;
    }

    // Read audio, convert to mono
    juce::AudioBuffer<float> rawBuffer ((int) reader->numChannels, (int) reader->lengthInSamples);
    reader->read (&rawBuffer, 0, (int) reader->lengthInSamples, 0, true, true);

    // Mix to mono
    juce::AudioBuffer<float> monoBuffer (1, (int) reader->lengthInSamples);
    monoBuffer.clear();
    for (int ch = 0; ch < rawBuffer.getNumChannels(); ++ch)
        monoBuffer.addFrom (0, 0, rawBuffer, ch, 0, rawBuffer.getNumSamples(),
                            1.0f / (float) rawBuffer.getNumChannels());

    // Generate waveform peaks for UI (~200 points)
    int numPeaks = 200;
    int samplesPerPeak = juce::jmax (1, (int) reader->lengthInSamples / numPeaks);
    std::vector<float> peaks;
    peaks.reserve ((size_t) numPeaks);
    const float* mono = monoBuffer.getReadPointer (0);
    for (int p = 0; p < numPeaks && p * samplesPerPeak < monoBuffer.getNumSamples(); ++p)
    {
        float peak = 0.0f;
        int start = p * samplesPerPeak;
        int end = juce::jmin (start + samplesPerPeak, monoBuffer.getNumSamples());
        for (int s = start; s < end; ++s)
            peak = juce::jmax (peak, std::abs (mono[s]));
        peaks.push_back (peak);
    }

    // Build SampleData
    auto sd = std::make_shared<SampleData>();
    sd->buffer = std::move (monoBuffer);
    sd->sampleRate = reader->sampleRate;
    sd->filePath = filePath;
    sd->fileName = file.getFileName();
    sd->waveformPeaks = std::move (peaks);
    sd->durationSeconds = (float) reader->lengthInSamples / (float) reader->sampleRate;

    // Assign to the matching logic block
    std::lock_guard<std::mutex> lock (blockMutex);
    for (auto& lb : logicBlocks)
    {
        if (lb.id == blockId)
        {
            lb.sampleData = sd;
            lb.samplePlayhead = 0.0;
            lb.sampleDirection = lb.sampleReverse ? -1 : 1;
            LOG_TO_FILE ("loadSampleForBlock: loaded " << sd->fileName.toStdString()
                         << " (" << sd->durationSeconds << "s, " << sd->buffer.getNumSamples() << " samples)");
            return true;
        }
    }

    LOG_TO_FILE ("loadSampleForBlock: block ID " << blockId << " not found");
    return false;
}

std::vector<float> HostesaAudioProcessor::getSampleWaveform (int blockId)
{
    std::lock_guard<std::mutex> lock (blockMutex);
    for (const auto& lb : logicBlocks)
    {
        if (lb.id == blockId && lb.sampleData != nullptr)
            return lb.sampleData->waveformPeaks;
    }
    return {};
}

juce::String HostesaAudioProcessor::getSampleFileName (int blockId)
{
    std::lock_guard<std::mutex> lock (blockMutex);
    for (const auto& lb : logicBlocks)
    {
        if (lb.id == blockId && lb.sampleData != nullptr)
            return lb.sampleData->fileName;
    }
    return {};
}

//==============================================================================
juce::AudioProcessorEditor* HostesaAudioProcessor::createEditor()
{
    return new HostesaAudioProcessorEditor (*this);
}

bool HostesaAudioProcessor::hasEditor() const
{
    return true;
}

//==============================================================================
const juce::String HostesaAudioProcessor::getName() const           { return JucePlugin_Name; }
bool HostesaAudioProcessor::acceptsMidi() const                     { return true; }
bool HostesaAudioProcessor::producesMidi() const                    { return false; }
bool HostesaAudioProcessor::isMidiEffect() const                    { return false; }
double HostesaAudioProcessor::getTailLengthSeconds() const          { return 0.0; }
int HostesaAudioProcessor::getNumPrograms()                         { return 1; }
int HostesaAudioProcessor::getCurrentProgram()                      { return 0; }
void HostesaAudioProcessor::setCurrentProgram (int)                 {}
const juce::String HostesaAudioProcessor::getProgramName (int)      { return {}; }
void HostesaAudioProcessor::changeProgramName (int, const juce::String&) {}

//==============================================================================
void HostesaAudioProcessor::getStateInformation (juce::MemoryBlock& destData)
{
    auto state = apvts.copyState();
    std::unique_ptr<juce::XmlElement> xml (state.createXml());

    // Save hosted plugins (defensive: if a plugin crashes during param read,
    // we still save the rest of the state)
    try
    {
        std::lock_guard<std::mutex> lock (pluginMutex);
        auto* pluginsXml = xml->createNewChildElement ("HOSTED_PLUGINS");
        for (auto& hp : hostedPlugins)
        {
            if (hp->id < 0) continue; // skip dead entries
            auto* plugEl = pluginsXml->createNewChildElement ("PLUGIN");
            plugEl->setAttribute ("id", hp->id);
            plugEl->setAttribute ("name", hp->name);
            plugEl->setAttribute ("path", hp->path);
            plugEl->setAttribute ("busId", hp->busId);

            // Save all parameter values — wrapped per-plugin so one
            // misbehaving VST3 doesn't prevent saving the others.
            if (hp->instance)
            {
                try
                {
                    auto& params = hp->instance->getParameters();
                    auto* paramsEl = plugEl->createNewChildElement ("PARAMS");
                    for (int i = 0; i < (int) params.size(); ++i)
                    {
                        auto* pEl = paramsEl->createNewChildElement ("P");
                        pEl->setAttribute ("i", i);
                        pEl->setAttribute ("v", (double) params[i]->getValue());
                    }
                }
                catch (...)
                {
                    LOG_TO_FILE ("getState: exception reading params for plugin '" << hp->name.toStdString() << "'");
                }
            }
        }
        pluginsXml->setAttribute ("nextId", nextPluginId);
        pluginsXml->setAttribute ("routingMode", routingMode.load());
    }
    catch (...)
    {
        LOG_TO_FILE ("getState: exception during plugin serialization");
    }

    // Save UI state (blocks, mappings, locks)
    {
        std::lock_guard<std::mutex> lock (uiStateMutex);
        if (uiStateJson.isNotEmpty())
            xml->createNewChildElement ("UI_STATE")->addTextElement (uiStateJson);
    }

    copyXmlToBinary (*xml, destData);
}

void HostesaAudioProcessor::setStateInformation (const void* data, int sizeInBytes)
{
    std::unique_ptr<juce::XmlElement> xmlState (getXmlFromBinary (data, sizeInBytes));
    if (xmlState == nullptr) return;

    // Restore APVTS
    if (xmlState->hasTagName (apvts.state.getType()))
        apvts.replaceState (juce::ValueTree::fromXml (*xmlState));

    // Restore hosted plugins
    auto* pluginsXml = xmlState->getChildByName ("HOSTED_PLUGINS");
    if (pluginsXml != nullptr)
    {
        int restoredNextId = pluginsXml->getIntAttribute ("nextId", 0);
        routingMode.store (pluginsXml->getIntAttribute ("routingMode", 0));

        // Clear existing plugins safely — audio thread doesn't hold pluginMutex.
        // Single lock scope: null instances + clear vector atomically so the audio
        // thread never sees a partially-cleared vector.
        {
            std::lock_guard<std::mutex> lock (pluginMutex);
            for (auto& hp : hostedPlugins)
            {
                if (hp->instance && hp->prepared)
                {
#ifdef _WIN32
                    sehReleaseResources (hp->instance.get());
#else
                    try { hp->instance->releaseResources(); } catch (...) {}
#endif
                }
#ifdef _WIN32
                // SEH-guard the destructor: some plugins crash during teardown
                if (hp->instance)
                    sehDestroyInstance (hp->instance.release());
#else
                hp->instance.reset();  // audio thread sees nullptr ? skips
#endif
                hp->prepared = false;
            }
            hostedPlugins.clear();
            hostedPlugins.reserve (32);  // maintain pre-reserved capacity
        }

        // Reset flat param tracking arrays
        for (int s = 0; s < kMaxPlugins; ++s)
            for (int p = 0; p < kMaxParams; ++p)
            {
                paramWritten[s][p] = -1.0f;
                paramTouched[s][p].store (false, std::memory_order_relaxed);
            }
        initParamBase();
        numActiveGlides = 0;

        // Clear proxy mappings (unified pool: reset all fields)
        for (int i = 0; i < proxyParamCount; ++i)
        {
            proxyMap[i].clear();
            if (proxyParams[i] != nullptr)
            {
                proxyParams[i]->setDynamicName (juce::String ("Slot ") + juce::String (i + 1));
                proxyParams[i]->clearDisplayInfo();
            }
            proxyValueCache[i].store (-999.0f);
        }

        // Reload each plugin from its saved path — wrapped per-plugin so
        // one crashing VST3 doesn't prevent restoring the others.
        for (auto* plugEl : pluginsXml->getChildIterator())
        {
            if (plugEl->getTagName() != "PLUGIN") continue;

            int savedId      = plugEl->getIntAttribute ("id", 0);
            auto savedPath   = plugEl->getStringAttribute ("path");

            if (savedPath.isEmpty()) continue;

            try
            {
                // Load the plugin (this handles scanning + instantiation)
                int newId = loadPlugin (savedPath);
                if (newId < 0)
                {
                    LOG_TO_FILE ("State restore: failed to reload plugin from " << savedPath.toStdString());
                    continue;
                }

                // Patch the plugin ID to match saved ID (preserves block target refs)
                {
                    std::lock_guard<std::mutex> lock (pluginMutex);
                    for (auto& hp : hostedPlugins)
                    {
                        if (hp->id == newId)
                        {
                            hp->id = savedId;

                            // Restore parameter values
                            auto* paramsEl = plugEl->getChildByName ("PARAMS");
                            if (paramsEl != nullptr && hp->instance)
                            {
                                auto& params = hp->instance->getParameters();
                                for (auto* pEl : paramsEl->getChildIterator())
                                {
                                    int idx = pEl->getIntAttribute ("i", -1);
                                    float val = (float) pEl->getDoubleAttribute ("v", 0.0);
                                    if (idx >= 0 && idx < (int) params.size())
                                        params[idx]->setValue (val);
                                }
                            }

                            // Patch proxy map entries to match new ID
                            for (int pi = 0; pi < proxyParamCount; ++pi)
                            {
                                if (proxyMap[pi].pluginId == newId)
                                    proxyMap[pi].pluginId = savedId;
                            }

                            // Restore bus ID for parallel routing
                            hp->busId = plugEl->getIntAttribute ("busId", 0);

                            break;
                        }
                    }
                }
            }
            catch (...)
            {
                LOG_TO_FILE ("State restore: EXCEPTION loading plugin '" << savedPath.toStdString()
                             << "' (id " << savedId << "). Skipping.");
            }
        }

        // Restore nextPluginId to avoid ID collisions
        nextPluginId = juce::jmax (nextPluginId, restoredNextId);
    }

    // Restore UI state
    auto* uiStateXml = xmlState->getChildByName ("UI_STATE");
    if (uiStateXml != nullptr)
    {
        std::lock_guard<std::mutex> lock (uiStateMutex);
        uiStateJson = uiStateXml->getAllSubText().trim();

        // -- Pre-populate EQ points from saved UI state so audio processing starts
        // immediately without waiting for the WebView to load and call setEqCurve. --
        if (routingMode.load() == 2 && uiStateJson.isNotEmpty())
        {
            auto parsed = juce::JSON::parse (uiStateJson);
            if (auto* root = parsed.getDynamicObject())
            {
                auto weqVar = root->getProperty ("wrongEq");
                if (auto* weq = weqVar.getDynamicObject())
                {
                    // Restore global params
                    float dbRange = weq->hasProperty ("dbRange") ? (float)(double) weq->getProperty ("dbRange") : 24.0f;
                    eqDbRange.store (juce::jlimit (6.0f, 48.0f, dbRange));
                    if (weq->hasProperty ("depth"))
                        eqGlobalDepth.store (juce::jlimit (0.0f, 200.0f, (float)(double) weq->getProperty ("depth")));
                    if (weq->hasProperty ("warp"))
                        eqGlobalWarp.store (juce::jlimit (-100.0f, 100.0f, (float)(double) weq->getProperty ("warp")));
                    if (weq->hasProperty ("steps"))
                        eqGlobalSteps.store (juce::jlimit (0, 64, (int) weq->getProperty ("steps")));
                    if (weq->hasProperty ("tilt"))
                        eqGlobalTilt.store (juce::jlimit (-100.0f, 100.0f, (float)(double) weq->getProperty ("tilt")));
                    if (weq->hasProperty ("reso"))
                        eqGlobalReso.store (juce::jlimit (0.0f, 100.0f, (float)(double) weq->getProperty ("reso")));
                    if (weq->hasProperty ("bypass"))
                        eqGlobalBypass.store ((bool) weq->getProperty ("bypass"));

                    // Restore oversampling factor
                    if (weq->hasProperty ("oversample"))
                    {
                        int osf = juce::jlimit (1, 4, (int) weq->getProperty ("oversample"));
                        if (osf == 3) osf = 2;
                        eqOversampleFactor.store (osf);
                        // Oversampler will be configured in prepareToPlay
                    }

                    auto ptsVar = weq->getProperty ("points");
                    if (auto* ptsArr = ptsVar.getArray())
                    {
                        float maxDB = eqDbRange.load();
                        int n = juce::jmin ((int) ptsArr->size(), (int) maxEqBands);

                        struct PtRestore { float hz; float db; int busId; bool solo; bool mute; float q; int ft; float drift; bool preEq; int stereoMode; int slope; };
                        std::vector<PtRestore> pts;
                        pts.reserve (n);

                        for (int i = 0; i < n; ++i)
                        {
                            if (auto* pt = (*ptsArr)[i].getDynamicObject())
                            {
                                // Convert normalized x (0-1 log scale) ? freq Hz
                                float xNorm = (float)(double) pt->getProperty ("x");
                                float hz = 20.0f * std::pow (1000.0f, juce::jlimit (0.0f, 1.0f, xNorm));

                                // Convert normalized y (0=top=+maxDB, 1=bottom=-maxDB) ? dB
                                float yNorm = (float)(double) pt->getProperty ("y");
                                float db = (-maxDB) + (1.0f - juce::jlimit (0.0f, 1.0f, yNorm)) * (maxDB * 2.0f);

                                int ft = 0; // Bell default
                                auto typeStr = pt->getProperty ("type").toString().toLowerCase();
                                if      (typeStr == "lp")   ft = 1;
                                else if (typeStr == "hp")   ft = 2;
                                else if (typeStr == "notch") ft = 3;
                                else if (typeStr == "lshf") ft = 4;
                                else if (typeStr == "hshf") ft = 5;

                                pts.push_back ({
                                    hz, db,
                                    pt->hasProperty ("uid") ? (int) pt->getProperty ("uid") : (i + 1),
                                    (bool) pt->getProperty ("solo"),
                                    (bool) pt->getProperty ("mute"),
                                    pt->hasProperty ("q") ? (float)(double) pt->getProperty ("q") : 0.707f,
                                    ft,
                                    pt->hasProperty ("drift") ? (float)(double) pt->getProperty ("drift") : 0.0f,
                                    pt->hasProperty ("preEq") ? (bool) pt->getProperty ("preEq") : true,
                                    pt->hasProperty ("stereoMode") ? (int) pt->getProperty ("stereoMode") : 0,
                                    pt->hasProperty ("slope") ? (int) pt->getProperty ("slope") : 1
                                });
                            }
                        }

                        // Sort by frequency (same as setEqCurve)
                        std::sort (pts.begin(), pts.end(),
                                   [] (const PtRestore& a, const PtRestore& b) { return a.hz < b.hz; });

                        numEqPoints.store ((int) pts.size());
                        for (int i = 0; i < (int) pts.size(); ++i)
                        {
                            eqPoints[i].freqHz.store (juce::jlimit (20.0f, 20000.0f, pts[i].hz));
                            eqPoints[i].gainDB.store (juce::jlimit (-maxDB, maxDB, pts[i].db));
                            eqPoints[i].busId.store (pts[i].busId);
                            eqPoints[i].solo.store (pts[i].solo);
                            eqPoints[i].mute.store (pts[i].mute);
                            eqPoints[i].q.store (juce::jlimit (0.025f, 40.0f, pts[i].q));
                            eqPoints[i].filterType.store (pts[i].ft);
                            eqPoints[i].driftPct.store (juce::jlimit (0.0f, 100.0f, pts[i].drift));
                            eqPoints[i].preEq.store (pts[i].preEq);
                            eqPoints[i].stereoMode.store (juce::jlimit (0, 2, pts[i].stereoMode));
                            eqPoints[i].slope.store (juce::jlimit (1, 4, pts[i].slope));
                            // Sorted order = identity (pts are already sorted by frequency)
                            eqSortOrder[i] = i;
                        }
                        for (int i = (int) pts.size(); i < maxEqBands; ++i)
                        {
                            eqPoints[i].busId.store (-1);
                            eqPoints[i].solo.store (false);
                            eqPoints[i].mute.store (false);
                            eqSortOrder[i] = -1; // clear unused sort order slots
                        }
                        eqDirty.store (true);
                    }
                }
            }
        }
    }
}

//==============================================================================
void HostesaAudioProcessor::setPluginBypass (int pluginId, bool bypass)
{
    std::lock_guard<std::mutex> lock (pluginMutex);
    for (auto& hp : hostedPlugins)
    {
        if (hp->id == pluginId)
        {
            hp->bypassed = bypass;
            break;
        }
    }
}

void HostesaAudioProcessor::resetPluginCrash (int pluginId)
{
    std::lock_guard<std::mutex> lock (pluginMutex);
    for (auto& hp : hostedPlugins)
    {
        if (hp->id == pluginId && hp->crashed)
        {
            // Re-prepare the plugin before allowing it to process again
            if (hp->instance != nullptr)
            {
                try
                {
                    hp->instance->prepareToPlay (currentSampleRate, currentBlockSize);
                    hp->crashed = false;
                    hp->prepared = true;
                    LOG_TO_FILE ("resetPluginCrash: Re-enabled plugin '"
                                 << hp->name.toStdString() << "' (ID: " << pluginId << ")");
                }
                catch (...)
                {
                    LOG_TO_FILE ("resetPluginCrash: Plugin '"
                                 << hp->name.toStdString() << "' crashed again during prepareToPlay");
                    // Leave crashed = true
                }
            }
            break;
        }
    }
}

//==============================================================================
// One-time migration: old flat structure ? new organized structure
//==============================================================================
void HostesaAudioProcessor::migrateOldPresets()
{
    auto root = getDataRoot();
    auto marker = root.getChildFile (".migrated_v2");

    if (marker.existsAsFile())
        return; // already migrated

    LOG_TO_FILE ("migrateOldPresets: starting one-time preset migration...");

    // -- Migrate GlobalPresets/*.json ? Chains/*.mrchain --
    auto oldGlobal = root.getChildFile ("GlobalPresets");
    if (oldGlobal.isDirectory())
    {
        for (const auto& f : oldGlobal.findChildFiles (juce::File::findFiles, false, "*.json"))
        {
            auto dest = getChainsDir().getChildFile (f.getFileNameWithoutExtension() + ".mrchain");
            if (! dest.existsAsFile())
            {
                f.copyFileTo (dest);
                LOG_TO_FILE ("  Migrated chain: " << f.getFileName().toStdString()
                             << " -> " << dest.getFileName().toStdString());
            }
        }
    }

    // -- Migrate Presets/{pluginName}/ ? Snapshots/Unknown/{pluginName}/ --
    auto oldPresets = root.getChildFile ("Presets");
    if (oldPresets.isDirectory())
    {
        for (const auto& dir : oldPresets.findChildFiles (juce::File::findDirectories, false))
        {
            auto destDir = getSnapshotsDir()
                .getChildFile ("Unknown")
                .getChildFile (sanitizeForFilename (dir.getFileName()));
            destDir.createDirectory();

            for (const auto& f : dir.findChildFiles (juce::File::findFiles, false, "*.json"))
            {
                auto dest = destDir.getChildFile (f.getFileName());
                if (! dest.existsAsFile())
                {
                    f.copyFileTo (dest);
                    LOG_TO_FILE ("  Migrated snapshot: " << dir.getFileName().toStdString()
                                 << "/" << f.getFileName().toStdString());
                }
            }
        }
    }

    // -- Generate README.txt --
    auto readme = root.getChildFile ("README.txt");
    if (! readme.existsAsFile())
    {
        readme.replaceWithText (
            "Hostesa Preset Library\n"
            "================================\n\n"
            "Chains/       - Complete plugin chains (.mrchain files)\n"
            "                Share these with other Hostesa users!\n"
            "                Drop .mrchain files into Chains/_Import/ to import them.\n\n"
            "Snapshots/    - Individual plugin presets, organized by manufacturer\n"
            "                e.g. Snapshots/Xfer Records/OTT/My Preset.json\n\n"
            "PluginCache/  - VST3 scan cache (auto-generated, safe to delete)\n\n"
            "This folder is shared across all plugin formats (VST3, AU, Standalone).\n"
        );
    }

    marker.replaceWithText ("migrated");
    LOG_TO_FILE ("migrateOldPresets: migration complete.");
}

//==============================================================================
juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
    return new HostesaAudioProcessor();
}
