/*
  ==============================================================================

    ProcessBlock.cpp
    Audio processing pipeline: processBlock, SEH crash guard, glide engine

  ==============================================================================
*/

#include "PluginProcessor.h"
#include "ParameterIDs.hpp"
#include <unordered_set>
//==============================================================================
// SEH-guarded processBlock wrapper (Windows only)
// Isolated as a free function because __try/__except cannot coexist
// with C++ objects that have destructors in the same function scope.
//==============================================================================
#ifdef _WIN32
bool sehGuardedProcessBlock (juce::AudioPluginInstance* instance,
                             juce::AudioBuffer<float>& buffer,
                             juce::MidiBuffer& midi)
{
    __try
    {
        instance->processBlock (buffer, midi);
        return true;  // success
    }
    __except (EXCEPTION_EXECUTE_HANDLER)
    {
        return false; // hardware fault caught
    }
}
#else
// Non-Windows: no SEH available, just call directly (C++ try/catch wraps this)
bool sehGuardedProcessBlock (juce::AudioPluginInstance* instance,
                             juce::AudioBuffer<float>& buffer,
                             juce::MidiBuffer& midi)
{
    instance->processBlock (buffer, midi);
    return true;
}
#endif

void HostesaAudioProcessor::processBlock (juce::AudioBuffer<float>& buffer,
                                                     juce::MidiBuffer& midiMessages)
{
    juce::ScopedNoDenormals noDenormals;

    // Clear any output channels that don't have corresponding inputs
    // (standard JUCE boilerplate — prevents garbage in unused channels)
    auto totalNumInputChannels  = getTotalNumInputChannels();
    auto totalNumOutputChannels = getTotalNumOutputChannels();
    for (auto i = totalNumInputChannels; i < totalNumOutputChannels; ++i)
        buffer.clear (i, 0, buffer.getNumSamples());

    // Determine main bus channel count (exclude sidechain channels)
    int mainBusChannels = (getBus (true, 0) != nullptr)
                        ? getBus (true, 0)->getNumberOfChannels() : buffer.getNumChannels();
    mainBusChannels = juce::jmin (mainBusChannels, buffer.getNumChannels());

    // ── Reset EQ modulation offsets each block ──
    // The meta-modulation pass (below) will re-apply them via setParamDirect
    // if still active. This ensures offsets decay to zero when modulation stops.
    if (routingMode.load() == 2)
    {
        int nPts = numEqPoints.load (std::memory_order_relaxed);
        for (int i = 0; i < nPts && i < maxEqBands; ++i)
        {
            if (eqPoints[i].modActive.load (std::memory_order_relaxed))
            {
                eqPoints[i].modFreqHz.store (0.0f, std::memory_order_relaxed);
                eqPoints[i].modGainDB.store (0.0f, std::memory_order_relaxed);
                eqPoints[i].modQ.store (0.0f, std::memory_order_relaxed);
                eqPoints[i].modActive.store (false, std::memory_order_relaxed);
            }
        }
    }

    // â”€â”€ Capture real-time data for UI â”€â”€

    // Audio RMS level (from main input, before processing)
    {
        int scStart = getBus (true, 1) != nullptr && getBus (true, 1)->isEnabled()
                      ? getBus (true, 0)->getNumberOfChannels() : -1;

        float rms = 0.0f;
        float scRms = 0.0f;
        for (int ch = 0; ch < buffer.getNumChannels(); ++ch)
        {
            float chRms = buffer.getRMSLevel (ch, 0, buffer.getNumSamples());
            if (scStart >= 0 && ch >= scStart)
                scRms = juce::jmax (scRms, chRms);
            else
                rms = juce::jmax (rms, chRms);
        }
        currentRmsLevel.store (rms);
        sidechainRmsLevel.store (scRms);
    }

    // ── FFT spectrum accumulation (mono sum into ring buffer) ──
    {
        int numSamp = buffer.getNumSamples();
        int chCount = juce::jmin(mainBusChannels, buffer.getNumChannels());
        for (int s = 0; s < numSamp; ++s)
        {
            float mono = 0.0f;
            for (int ch = 0; ch < chCount; ++ch)
                mono += buffer.getReadPointer(ch)[s];
            if (chCount > 1) mono /= (float) chCount;
            fftInputBuffer[fftInputPos] = mono;
            if (++fftInputPos >= fftSize)
            {
                fftInputPos = 0;
                // Copy + Hann window into work buffer
                for (int i = 0; i < fftSize; ++i)
                {
                    float w = 0.5f * (1.0f - std::cos(juce::MathConstants<float>::twoPi * (float)i / (float)(fftSize - 1)));
                    fftWorkBuffer[i] = fftInputBuffer[i] * w;
                }
                std::memset(fftWorkBuffer + fftSize, 0, sizeof(float) * fftSize);
                fftReady.store(true);
            }
        }
    }

    // MIDI events for UI triggers (lock-free FIFO write)
    for (const auto metadata : midiMessages)
    {
        auto msg = metadata.getMessage();
        MidiEvent ev;
        if (msg.isNoteOn())
        {
            ev = { msg.getNoteNumber(), msg.getVelocity(), msg.getChannel(), false };
        }
        else if (msg.isController())
        {
            ev = { msg.getControllerNumber(), msg.getControllerValue(), msg.getChannel(), true };
        }
        else
        {
            continue;
        }

        const auto scope = midiFifo.write (1);
        if (scope.blockSize1 > 0)
            midiRing[scope.startIndex1] = ev;
        else if (scope.blockSize2 > 0)
            midiRing[scope.startIndex2] = ev;
        // If FIFO is full, event is silently dropped (acceptable for UI triggers)
    }

    // DAW transport info
    if (auto* playHead = getPlayHead())
    {
        if (auto pos = playHead->getPosition())
        {
            if (auto bpm = pos->getBpm())
                currentBpm.store (*bpm);
            isPlaying.store (pos->getIsPlaying());
            if (auto ppq = pos->getPpqPosition())
                ppqPosition.store (*ppq);
        }
    }

    // â”€â”€ Audio processing â”€â”€

    auto bypass = apvts.getRawParameterValue (ParameterIDs::BYPASS)->load();
    if (bypass > 0.5f)
        return; // Bypass: audio passes through unmodified

    auto mixPercent = apvts.getRawParameterValue (ParameterIDs::MIX)->load();
    float wet = mixPercent / 100.0f;

    // No pluginMutex lock on the audio thread! â€” a single block of unprocessed audio is
    // inaudible, whereas blocking would cause priority inversion and clicks.
    // NOTE: No pluginMutex lock on the audio thread!
    // hostedPlugins is structurally stable: removePlugin() only nulls instances
    // (never erases), purgeDeadPlugins() only runs from prepareToPlay().
    // processOnePlugin() checks for null instance. The old try_lock caused
    // crackles because UI parameter polling blocked the mutex, making the
    // audio thread skip processing for entire buffers.
    if (wet < 0.001f)
        return;

    // In WrongEQ mode, the EQ biquads and crossover processing must run even
    // without any hosted plugins — the EQ IS the effect.  Only skip when
    // there are genuinely no plugins AND we're not in WrongEQ mode with points.
    bool hasEqWork = (routingMode.load() == 2 && numEqPoints.load() > 0);
    if (hostedPlugins.empty() && !hasEqWork)
        return;

    // Save dry signal (use pre-allocated member buffer — no heap alloc)
    bool needsDryMix = wet < 0.999f;
    if (needsDryMix)
    {
        int dryChannels = juce::jmin (mainBusChannels, dryBuffer.getNumChannels());
        int drySamples  = juce::jmin (buffer.getNumSamples(),  dryBuffer.getNumSamples());
        for (int ch = 0; ch < dryChannels; ++ch)
            dryBuffer.copyFrom (ch, 0, buffer, ch, 0, drySamples);
    }

    // Advance monotonic sample counter (for trigger cooldowns)
    sampleCounter += buffer.getNumSamples();

    // â”€â”€ Logic Block Engine: triggers + envelope followers â”€â”€
    {
        std::unique_lock<std::mutex> blockLock (blockMutex, std::try_to_lock);
        if (blockLock.owns_lock() && ! logicBlocks.empty())
        {
            clearModBus();

            float mainRms = currentRmsLevel.load();
            float scRms   = sidechainRmsLevel.load();
            double ppq    = ppqPosition.load();
            bool   playing = isPlaying.load();
            int    numSamples = buffer.getNumSamples();
            float  bufferRate = (float) (currentSampleRate / numSamples);  // Hz

            // Collect MIDI events from this buffer for trigger matching
            // Uses pre-allocated member vector — no per-buffer allocation
            blockMidiEvents.clear();
            for (const auto metadata : midiMessages)
            {
                auto msg = metadata.getMessage();
                if (msg.isNoteOn())
                    blockMidiEvents.push_back ({ msg.getNoteNumber(), msg.getVelocity(), msg.getChannel(), false });
                else if (msg.isNoteOff())
                    blockMidiEvents.push_back ({ msg.getNoteNumber(), 0, msg.getChannel(), false }); // vel=0 for note-off
                else if (msg.isController())
                    blockMidiEvents.push_back ({ msg.getControllerNumber(), msg.getControllerValue(), msg.getChannel(), true });
            }

            // Beat divisions are now pre-computed as floats in updateLogicBlocks (H4 fix)

            // ── Reusable filtered audio level helper ──
            // Returns RMS level for a block, optionally band-filtered via its biquad state.
            // Blocks with default band (20/20k) skip filtering for zero overhead.
            auto getFilteredAudioLevel = [&](LogicBlock& lb) -> float {
                bool useBand = (lb.envBandLo > 25.0f || lb.envBandHi < 19000.0f);
                if (!useBand)
                    return (lb.audioSrcE == AudioSource::Sidechain) ? scRms : mainRms;

                float sr = (float) currentSampleRate;
                lb.envHpf.setHighpass(juce::jlimit(20.0f, 20000.0f, lb.envBandLo), sr);
                lb.envLpf.setLowpass(juce::jlimit(20.0f, 20000.0f, lb.envBandHi), sr);

                float sumSq = 0.0f;
                bool useSc = (lb.audioSrcE == AudioSource::Sidechain);
                int ch0 = useSc ? mainBusChannels : 0;
                int chN = useSc ? buffer.getNumChannels() : mainBusChannels;
                if (ch0 >= chN) { ch0 = 0; chN = juce::jmin(1, buffer.getNumChannels()); }
                for (int ch = ch0; ch < chN; ch++)
                {
                    const float* data = buffer.getReadPointer(ch);
                    for (int s = 0; s < numSamples; s++)
                    {
                        float sig = lb.envHpf.process(data[s]);
                        sig = lb.envLpf.process(sig);
                        sumSq += sig * sig;
                    }
                }
                return std::sqrt(sumSq / std::max(1, numSamples * (chN - ch0)));
            };

            int envIdx = 0;
            int smpIdx = 0;
            int morphIdx = 0;
            numActiveLanes.store(0);

            // ── Reusable trigger detection helper ──
            // Checks MIDI, Tempo, and Audio triggers for a logic block.
            // Advances internal clock and updates lastBeat/lastAudioTrigSample as needed.
            // Used by Randomize and Sample blocks (which share identical trigger logic).
            auto checkTrigger = [&](LogicBlock& lb) -> bool {
                bool fired = false;

                // MIDI trigger
                if (lb.triggerE == TriggerType::Midi && ! blockMidiEvents.empty())
                {
                    for (const auto& ev : blockMidiEvents)
                    {
                        if (lb.midiCh > 0 && ev.ch != lb.midiCh) continue;
                        if (ev.isCC && lb.midiModeE == MidiTrigMode::CC && ev.note == lb.midiCC) { fired = true; break; }
                        if (ev.isCC || ev.vel == 0) continue; // skip CCs and note-offs
                        if (lb.midiModeE == MidiTrigMode::AnyNote)       { fired = true; break; }
                        if (lb.midiModeE == MidiTrigMode::SpecificNote && ev.note == lb.midiNote) { fired = true; break; }
                    }
                }

                // Tempo trigger
                if (lb.triggerE == TriggerType::Tempo)
                {
                    bool useInternal = (lb.clockSourceE == ClockSource::Internal);
                    if (useInternal && lb.internalBpm > 0.0f)
                    {
                        double beatsPerSec = (double) lb.internalBpm / 60.0;
                        double secsThisBuffer = (double) numSamples / currentSampleRate;
                        lb.internalPpq += beatsPerSec * secsThisBuffer;
                    }
                    double effectivePpq = useInternal ? lb.internalPpq : ppq;
                    bool   canFire      = useInternal ? true : playing;
                    if (canFire)
                    {
                        float bpt = lb.beatDivBeats;
                        int currentBeat = (int) std::floor (effectivePpq / bpt);
                        if (lb.lastBeat < 0) lb.lastBeat = currentBeat;
                        if (currentBeat != lb.lastBeat)
                        {
                            lb.lastBeat = currentBeat;
                            fired = true;
                        }
                    }
                }

                // Audio trigger
                if (lb.triggerE == TriggerType::Audio)
                {
                    float audioLvl = getFilteredAudioLevel(lb);
                    float threshLin = std::pow (10.0f, lb.threshold / 20.0f);
                    double cooldownSamples = currentSampleRate * 0.1;
                    if (audioLvl > threshLin && (sampleCounter - lb.lastAudioTrigSample) > cooldownSamples)
                    {
                        lb.lastAudioTrigSample = sampleCounter;
                        fired = true;
                    }
                }

                return fired;
            };

            // ── Reusable 2D shape position computer ──
            // Given a shape enum, phase angle t, and radius R, returns (dx, dy).
            // Used by Morph Pad LFO shapes and Shapes block — identical geometry.
            auto computeShapeXY = [](LfoShape shape, float t, float R) -> std::pair<float, float> {
                float twoPi = juce::MathConstants<float>::twoPi;
                float halfPi = juce::MathConstants<float>::halfPi;
                float dx = 0.0f, dy = 0.0f;

                if (shape == LfoShape::Circle) {
                    dx = R * std::cos(t); dy = R * std::sin(t);
                } else if (shape == LfoShape::Figure8) {
                    dx = R * std::sin(t); dy = R * std::sin(t * 2.0f);
                } else if (shape == LfoShape::SweepX) {
                    dx = R * std::sin(t); dy = 0.0f;
                } else if (shape == LfoShape::SweepY) {
                    dx = 0.0f; dy = R * std::sin(t);
                } else if (shape == LfoShape::Triangle || shape == LfoShape::Square || shape == LfoShape::Hexagon) {
                    int n = (shape == LfoShape::Triangle) ? 3 : (shape == LfoShape::Square) ? 4 : 6;
                    float segF = t * (float)n / twoPi;
                    int seg = ((int)segF) % n;
                    float segT = segF - std::floor(segF);
                    float a0 = twoPi * seg / (float)n - halfPi;
                    float a1 = twoPi * ((seg + 1) % n) / (float)n - halfPi;
                    dx = R * (std::cos(a0) + segT * (std::cos(a1) - std::cos(a0)));
                    dy = R * (std::sin(a0) + segT * (std::sin(a1) - std::sin(a0)));
                } else if (shape == LfoShape::Pentagram) {
                    constexpr int order[5] = {0,2,4,1,3};
                    float segF = t * 5.0f / twoPi;
                    int seg = ((int)segF) % 5;
                    float segT = segF - std::floor(segF);
                    int from = order[seg], to = order[(seg+1)%5];
                    float a0 = twoPi * from / 5.0f - halfPi;
                    float a1 = twoPi * to / 5.0f - halfPi;
                    dx = R * (std::cos(a0) + segT * (std::cos(a1) - std::cos(a0)));
                    dy = R * (std::sin(a0) + segT * (std::sin(a1) - std::sin(a0)));
                } else if (shape == LfoShape::Hexagram) {
                    // Star of David: trace two interlocked triangles
                    // First triangle (0,2,4), then second triangle (1,3,5)
                    // Full path: 0→2→4→0→1→3→5→1 (normalized to 6 segments)
                    constexpr int starOrder[6] = {0, 2, 4, 1, 3, 5};
                    float segF = t * 6.0f / twoPi;
                    int seg = ((int)segF) % 6;
                    float segT = segF - std::floor(segF);
                    int fromIdx = starOrder[seg], toIdx = starOrder[(seg+1)%6];
                    float aFrom = twoPi * fromIdx / 6.0f - halfPi;
                    float aTo   = twoPi * toIdx   / 6.0f - halfPi;
                    dx = R * (std::cos(aFrom) + segT * (std::cos(aTo) - std::cos(aFrom)));
                    dy = R * (std::sin(aFrom) + segT * (std::sin(aTo) - std::sin(aFrom)));
                } else if (shape == LfoShape::Rose4) {
                    float r = R * std::cos(2.0f * t);
                    dx = r * std::cos(t); dy = r * std::sin(t);
                } else if (shape == LfoShape::Lissajous) {
                    dx = R * 0.7f * std::sin(3.0f * t); dy = R * 0.7f * std::sin(2.0f * t);
                } else if (shape == LfoShape::Spiral) {
                    float progress = t / twoPi;
                    float rNorm = progress < 0.5f ? progress * 2.0f : (1.0f - progress) * 2.0f;
                    float sR = R * (0.05f + 0.95f * rNorm);
                    float sA = t * 3.0f;
                    dx = sR * std::cos(sA); dy = sR * std::sin(sA);
                } else if (shape == LfoShape::Cat) {
                    // Cat face: polar contour with ears, eyes, nose, mouth
                    float bodyR = R * 0.52f;
                    float pi = juce::MathConstants<float>::pi;

                    // Angular distance helper (wraps around)
                    auto angDist = [twoPi](float a, float b) {
                        float d = std::abs(a - b);
                        return d > juce::MathConstants<float>::pi ? twoPi - d : d;
                    };

                    float bump = 0.0f;

                    // -- Ears: sharp triangular bumps at ~55deg and ~125deg --
                    float earR = R * 0.42f, earW = 0.32f, earTipW = 0.09f;
                    float dE;
                    dE = angDist(t, pi * 0.31f); // right ear ~56deg
                    if (dE < earW) {
                        float x = 1.0f - dE / earW;
                        bump += earR * x * x;
                        if (dE < earTipW) bump += R * 0.18f * (1.0f - dE / earTipW);
                    }
                    dE = angDist(t, pi * 0.69f); // left ear ~124deg
                    if (dE < earW) {
                        float x = 1.0f - dE / earW;
                        bump += earR * x * x;
                        if (dE < earTipW) bump += R * 0.18f * (1.0f - dE / earTipW);
                    }

                    // -- Eyes: small outward bumps at ~320deg and ~220deg --
                    float eyeR = R * 0.08f, eyeW = 0.18f;
                    dE = angDist(t, pi * 1.78f); // right eye ~320deg
                    if (dE < eyeW) bump += eyeR * (1.0f - dE / eyeW) * (1.0f - dE / eyeW);
                    dE = angDist(t, pi * 1.22f); // left eye ~220deg
                    if (dE < eyeW) bump += eyeR * (1.0f - dE / eyeW) * (1.0f - dE / eyeW);

                    // -- Nose: small inward dip at ~270deg --
                    dE = angDist(t, pi * 1.5f);
                    if (dE < 0.12f) bump -= R * 0.06f * (1.0f - dE / 0.12f);

                    // -- Mouth: W-shape at bottom (~255deg and ~285deg bumps, ~270deg dip) --
                    dE = angDist(t, pi * 1.42f); // left mouth corner ~255deg
                    if (dE < 0.1f) bump += R * 0.04f * (1.0f - dE / 0.1f);
                    dE = angDist(t, pi * 1.58f); // right mouth corner ~285deg
                    if (dE < 0.1f) bump += R * 0.04f * (1.0f - dE / 0.1f);

                    // -- Chin: slight flat tuck --
                    dE = angDist(t, pi * 1.5f);
                    if (dE < 0.35f) bump -= R * 0.03f * (1.0f - dE / 0.35f) * (1.0f - dE / 0.35f);

                    float totalR = bodyR + bump;
                    dx = totalR * std::cos(t); dy = totalR * std::sin(t);
                } else if (shape == LfoShape::Butterfly) {
                    // Butterfly curve: r = e^cos(t) - 2*cos(4t), closes in one 2pi cycle
                    float r = std::exp(std::cos(t)) - 2.0f * std::cos(4.0f * t);
                    float scale = R * 0.21f;
                    dx = scale * r * std::sin(t); dy = -scale * r * std::cos(t);
                } else if (shape == LfoShape::InfinityKnot) {
                    // Trefoil knot 2D projection: three-lobed continuous path
                    dx = R * 0.7f * (std::sin(t) + 2.0f * std::sin(2.0f * t)) / 3.0f;
                    dy = R * 0.7f * (std::cos(t) - 2.0f * std::cos(2.0f * t)) / 3.0f;
                } else {
                    dx = R * std::cos(t); dy = R * std::sin(t);
                }

                return { dx, dy };
            };

            for (auto& lb : logicBlocks)
            {
                if (lb.targets.empty() || ! lb.enabled) continue;

                // ===== RANDOMIZE MODE =====
                if (lb.modeE == BlockMode::Randomize)
                {
                    bool shouldFire = checkTrigger(lb);

                    // --- FIRE: generate random values and apply ---
                    if (shouldFire)
                    {
                        for (const auto& tgt : lb.targets)
                        {
                            float newVal;
                            if (lb.rangeModeE == RangeMode::Relative)
                            {
                                // Get current value — O(1) lookup
                                float cur = getParamValue (tgt.pluginId, tgt.paramIndex);
                                newVal = cur + (audioRandom.nextFloat() * 2.0f - 1.0f) * lb.rMax;
                            }
                            else
                            {
                                newVal = lb.rMin + audioRandom.nextFloat() * (lb.rMax - lb.rMin);
                            }

                            if (lb.quantize && lb.qSteps > 1)
                                newVal = std::round (newVal * (lb.qSteps - 1)) / (float) (lb.qSteps - 1);

                            newVal = juce::jlimit (0.0f, 1.0f, newVal);

                            if (lb.movementE == Movement::Glide && lb.glideMs > 0.0f)
                            {
                                // Push directly to glidePool (already on audio thread)
                                float cur = getParamValue (tgt.pluginId, tgt.paramIndex);
                                int total = juce::jmax (1, (int) (lb.glideMs * 0.001 * currentSampleRate));
                                // Update existing glide or create new
                                bool found = false;
                                for (int gi = 0; gi < numActiveGlides; ++gi)
                                {
                                    auto& g = glidePool[gi];
                                    if (g.pluginId == tgt.pluginId && g.paramIndex == tgt.paramIndex)
                                    {
                                        g.targetVal = newVal;
                                        g.increment = (newVal - g.currentVal) / (float) total;
                                        g.samplesLeft = total;
                                        found = true;
                                        break;
                                    }
                                }
                                if (! found && numActiveGlides < kMaxGlides)
                                {
                                    glidePool[numActiveGlides++] = { tgt.pluginId, tgt.paramIndex, cur, newVal,
                                                              (newVal - cur) / (float) total, total };
                                }
                                // Glide target is the new user base
                                updateParamBase (tgt.pluginId, tgt.paramIndex, newVal);
                            }
                            else
                            {
                                setParamDirect (tgt.pluginId, tgt.paramIndex, newVal);
                                updateParamBase (tgt.pluginId, tgt.paramIndex, newVal);
                            }
                        }

                        // Notify UI of trigger fire (lock-free FIFO)
                        const auto tScope = triggerFifo.write (1);
                        if (tScope.blockSize1 > 0)      triggerRing[tScope.startIndex1] = lb.id;
                        else if (tScope.blockSize2 > 0) triggerRing[tScope.startIndex2] = lb.id;
                    }
                }

                // ===== ENVELOPE MODE =====
                else if (lb.modeE == BlockMode::Envelope)
                {
                    float audioLvl = getFilteredAudioLevel(lb);
                    float raw = audioLvl * (lb.envSens / 50.0f);

                    // Per-buffer attack/release smoothing
                    float ac = std::exp (-1.0f / std::max (1.0f, lb.envAtk * 0.001f * bufferRate));
                    float rc = std::exp (-1.0f / std::max (1.0f, lb.envRel * 0.001f * bufferRate));

                    if (raw > lb.currentEnvValue)
                        lb.currentEnvValue = ac * lb.currentEnvValue + (1.0f - ac) * raw;
                    else
                        lb.currentEnvValue = rc * lb.currentEnvValue + (1.0f - rc) * raw;

                    float cl = juce::jlimit (0.0f, 1.0f, lb.currentEnvValue);
                    float mp = lb.envInvert ? (1.0f - cl) : cl;

                    // Always relative: offset ±depth from resting value (modbus)
                    {
                        float depth = lb.rMax;

                        // Compute offset based on polarity setting
                        float offset;
                        if (lb.polarityE == Polarity::Up)
                            offset = mp * depth;
                        else if (lb.polarityE == Polarity::Down)
                            offset = -mp * depth;
                        else
                            offset = (mp * 2.0f - 1.0f) * depth;

                        for (size_t ti = 0; ti < lb.targets.size(); ++ti)
                            addModOffset (lb.targets[ti].pluginId, lb.targets[ti].paramIndex, offset);
                    }

                    // Write envelope level for UI readback
                    if (envIdx < maxEnvReadback)
                    {
                        envReadback[envIdx].blockId.store (lb.id);
                        envReadback[envIdx].level.store (cl);
                        envIdx++;
                    }
                }

                // ===== SAMPLE MODULATOR MODE =====
                else if (lb.modeE == BlockMode::Sample && lb.sampleData != nullptr)
                {
                    auto sd = lb.sampleData;  // shared_ptr copy (safe)
                    int totalSamp = sd->buffer.getNumSamples();
                    if (totalSamp < 2) continue;

                    // --- Check for jump triggers (same system as randomize) ---
                    bool shouldJump = checkTrigger(lb);

                    // Apply jump
                    if (shouldJump)
                    {
                        if (lb.jumpModeE == JumpMode::Random)
                            lb.samplePlayhead = audioRandom.nextDouble() * (double) (totalSamp - 1);
                        else // "restart"
                            lb.samplePlayhead = lb.sampleReverse ? (double) (totalSamp - 1) : 0.0;
                        lb.sampleDirection = lb.sampleReverse ? -1 : 1;

                        // Notify UI of trigger fire
                        const auto tScope = triggerFifo.write (1);
                        if (tScope.blockSize1 > 0)      triggerRing[tScope.startIndex1] = lb.id;
                        else if (tScope.blockSize2 > 0) triggerRing[tScope.startIndex2] = lb.id;
                    }

                    // --- Advance playhead ---
                    double playbackRate = (sd->sampleRate / currentSampleRate) * (double) lb.sampleSpeed;
                    double advance = playbackRate * (double) numSamples;
                    if (lb.sampleReverse) advance = -advance;
                    if (lb.sampleDirection < 0) advance = -advance;

                    lb.samplePlayhead += advance;

                    // Handle loop modes
                    if (lb.loopModeE == LoopMode::Loop)
                    {
                        lb.samplePlayhead = std::fmod (lb.samplePlayhead, (double) totalSamp);
                        if (lb.samplePlayhead < 0.0) lb.samplePlayhead += (double) totalSamp;
                    }
                    else if (lb.loopModeE == LoopMode::Pingpong)
                    {
                        // Reflect playhead as many times as needed (handles high speed)
                        double len = (double) totalSamp;
                        int safety = 100;
                        while (safety-- > 0 && (lb.samplePlayhead >= len || lb.samplePlayhead < 0.0))
                        {
                            if (lb.samplePlayhead >= len)
                            {
                                lb.samplePlayhead = 2.0 * len - lb.samplePlayhead;
                                lb.sampleDirection *= -1;
                            }
                            if (lb.samplePlayhead < 0.0)
                            {
                                lb.samplePlayhead = -lb.samplePlayhead;
                                lb.sampleDirection *= -1;
                            }
                        }
                        lb.samplePlayhead = juce::jlimit (0.0, len - 1.0, lb.samplePlayhead);
                    }
                    else // "oneshot"
                    {
                        lb.samplePlayhead = juce::jlimit (0.0, (double) (totalSamp - 1), lb.samplePlayhead);
                    }

                    // --- Compute amplitude over traversed samples (with optional band filtering) ---
                    float raw;
                    {
                        bool useBand = (lb.envBandLo > 25.0f || lb.envBandHi < 19000.0f);
                        if (useBand)
                        {
                            float sr = (float) sd->sampleRate;
                            lb.envHpf.setHighpass(juce::jlimit(20.0f, 20000.0f, lb.envBandLo), sr);
                            lb.envLpf.setLowpass(juce::jlimit(20.0f, 20000.0f, lb.envBandHi), sr);
                        }

                        // Iterate through all sample positions the playhead covered this buffer
                        int steps = juce::jmax(1, (int) std::abs(advance));
                        double step = (steps > 1) ? advance / (double) steps : 0.0;
                        double readHead = lb.samplePlayhead - advance; // start of this buffer's traversal
                        float sumSq = 0.0f;

                        for (int si = 0; si < steps; si++)
                        {
                            double rh = readHead + step * (double) si;
                            // Wrap for loop mode
                            if (lb.loopModeE == LoopMode::Loop)
                            {
                                rh = std::fmod(rh, (double) totalSamp);
                                if (rh < 0.0) rh += (double) totalSamp;
                            }
                            int p = juce::jlimit(0, totalSamp - 1, (int) rh);
                            float s = sd->buffer.getSample(0, p);

                            if (useBand)
                            {
                                s = lb.envHpf.process(s);
                                s = lb.envLpf.process(s);
                            }
                            sumSq += s * s;
                        }
                        raw = std::sqrt(sumSq / (float) steps) * (lb.envSens / 50.0f);
                    }

                    // --- Attack/release envelope smoothing ---
                    float ac = std::exp (-1.0f / std::max (1.0f, lb.envAtk * 0.001f * bufferRate));
                    float rc = std::exp (-1.0f / std::max (1.0f, lb.envRel * 0.001f * bufferRate));
                    if (raw > lb.currentEnvValue)
                        lb.currentEnvValue = ac * lb.currentEnvValue + (1.0f - ac) * raw;
                    else
                        lb.currentEnvValue = rc * lb.currentEnvValue + (1.0f - rc) * raw;

                    float cl = juce::jlimit (0.0f, 1.0f, lb.currentEnvValue);
                    float mp = lb.envInvert ? (1.0f - cl) : cl;

                    // Always relative: offset ±depth from resting value (modbus)
                    {
                        float depth = lb.rMax;

                        float offset;
                        if (lb.polarityE == Polarity::Up)
                            offset = mp * depth;
                        else if (lb.polarityE == Polarity::Down)
                            offset = -mp * depth;
                        else
                            offset = (mp * 2.0f - 1.0f) * depth;

                        for (size_t ti = 0; ti < lb.targets.size(); ++ti)
                            addModOffset (lb.targets[ti].pluginId, lb.targets[ti].paramIndex, offset);
                    }

                    // Write envelope level for UI readback (shares env readback)
                    if (envIdx < maxEnvReadback)
                    {
                        envReadback[envIdx].blockId.store (lb.id);
                        envReadback[envIdx].level.store (cl);
                        envIdx++;
                    }

                    // Write playhead position for UI
                    if (smpIdx < maxSampleReadback)
                    {
                        sampleReadback[smpIdx].blockId.store (lb.id);
                        sampleReadback[smpIdx].playhead.store ((float) (lb.samplePlayhead / (double) totalSamp));
                        smpIdx++;
                    }
                }

                // ===== MORPH PAD MODE =====
                else if (lb.modeE == BlockMode::MorphPad && !lb.snapshots.empty() && lb.enabled)
                {
                    float targetX = lb.playheadX;
                    float targetY = lb.playheadY;

                    // -- Trigger detection (for trigger mode) --
                    bool shouldTrigger = false;
                    if (lb.morphModeE == MorphMode::Trigger)
                    {
                        juce::String src = lb.morphSource;

                        if (src == "midi" && ! blockMidiEvents.empty()) {
                            for (const auto& ev : blockMidiEvents) {
                                if (lb.midiCh > 0 && ev.ch != lb.midiCh) continue;
                                if (lb.midiModeE == MidiTrigMode::CC && ev.isCC && ev.note == lb.midiCC) { shouldTrigger = true; break; }
                                if (ev.isCC || ev.vel == 0) continue; // skip CCs and note-offs
                                if (lb.midiModeE == MidiTrigMode::AnyNote) { shouldTrigger = true; break; }
                                if (lb.midiModeE == MidiTrigMode::SpecificNote && ev.note == lb.midiNote) { shouldTrigger = true; break; }
                            }
                        }
                        if (src == "tempo") {
                            bool useInternal = (lb.clockSourceE == ClockSource::Internal);
                            if (useInternal && lb.internalBpm > 0.0f) {
                                double beatsPerSec = (double) lb.internalBpm / 60.0;
                                double secsThisBuffer = (double) numSamples / currentSampleRate;
                                lb.internalPpq += beatsPerSec * secsThisBuffer;
                            }
                            double effectivePpq = useInternal ? lb.internalPpq : ppq;
                            bool canFire = useInternal ? true : playing;
                            if (canFire) {
                                float bpt = lb.beatDivBeats;
                                int currentBeat = (int) std::floor (effectivePpq / bpt);
                                if (lb.lastBeat < 0) lb.lastBeat = currentBeat;
                                if (currentBeat != lb.lastBeat) { lb.lastBeat = currentBeat; shouldTrigger = true; }
                            }
                        }
                        if (src == "audio") {
                            float audioLvl = (lb.audioSrcE == AudioSource::Sidechain) ? scRms : mainRms;
                            float threshLin = std::pow (10.0f, lb.threshold / 20.0f);
                            double cooldownSamples = currentSampleRate * 0.1;
                            if (audioLvl > threshLin && (sampleCounter - lb.lastAudioTrigSample) > cooldownSamples) {
                                lb.lastAudioTrigSample = sampleCounter;
                                shouldTrigger = true;
                            }
                        }
                    }

                    // -- Auto-Explore mode --
                    if (lb.morphModeE == MorphMode::Auto)
                    {
                        int numSnaps = (int) lb.snapshots.size();

                        // -- CORRECT time computation --
                        // secsPerBuffer = actual wall-clock seconds this buffer covers
                        float secsPerBuffer = (float) numSamples / (float) currentSampleRate;
                        float cyclesPerSec;

                        if (lb.morphTempoSync)
                        {
                            double bpm = (lb.clockSourceE == ClockSource::Internal) ? (double) lb.internalBpm : currentBpm.load();
                            if (bpm > 0.0)
                            {
                                float divBeats = lb.morphSyncDivBeats;
                                double beatsPerSec = bpm / 60.0;
                                cyclesPerSec = (float) (beatsPerSec / divBeats);
                            }
                            else
                            {
                                cyclesPerSec = 0.5f; // fallback if no BPM
                            }
                        }
                        else
                        {
                            // morphSpeed 0..1 â†’ 0.02 Hz .. 4 Hz
                            float sp = lb.morphSpeed;
                            cyclesPerSec = 0.02f + sp * sp * 4.0f;
                        }

                        // Phase delta per buffer (radians) â€” cap at Ï€ to avoid aliasing
                        float rawPhaseDelta = juce::MathConstants<float>::twoPi * cyclesPerSec * secsPerBuffer;
                        float phaseDelta = std::min (rawPhaseDelta, juce::MathConstants<float>::pi);
                        // Linear speed: pad-diameters per second â†’ distance this buffer
                        float linearDelta = cyclesPerSec * secsPerBuffer;

                        // Unified linear speed matching LFO circle tangential velocity:
                        // LFO circle radius = 0.4, tangential speed = 2Ï€ * r * cps
                        float padSpeed = juce::MathConstants<float>::twoPi * 0.4f * cyclesPerSec; // pad-units/sec
                        float distThisBuffer = padSpeed * secsPerBuffer; // distance to travel this buffer

                        if (lb.exploreModeE == ExploreMode::Wander) {
                            // â”€â”€ Brownian random walk â”€â”€
                            // Acceleration drives direction changes; scaled to padSpeed
                            float accelMag = padSpeed * 6.0f * secsPerBuffer;
                            lb.morphVelX += (audioRandom.nextFloat() - 0.5f) * accelMag;
                            lb.morphVelY += (audioRandom.nextFloat() - 0.5f) * accelMag;

                            // Drag â€” smooth curves with gradual direction changes
                            float drag = std::exp (-3.0f * secsPerBuffer);
                            lb.morphVelX *= drag;
                            lb.morphVelY *= drag;

                            // Clamp velocity to padSpeed (same linear speed as LFO)
                            float velMag = std::sqrt (lb.morphVelX * lb.morphVelX + lb.morphVelY * lb.morphVelY);
                            if (velMag > padSpeed && velMag > 0.0f) {
                                float sc = padSpeed / velMag;
                                lb.morphVelX *= sc;
                                lb.morphVelY *= sc;
                            }

                            // Integrate position
                            targetX = lb.playheadX + lb.morphVelX * secsPerBuffer;
                            targetY = lb.playheadY + lb.morphVelY * secsPerBuffer;

                            // Bounce off circle boundary (radius 0.44)
                            float cdx = targetX - 0.5f, cdy = targetY - 0.5f;
                            float cdist = std::sqrt (cdx * cdx + cdy * cdy);
                            if (cdist > 0.44f && cdist > 0.0f) {
                                float nx = cdx / cdist, ny = cdy / cdist;
                                float dot = lb.morphVelX * nx + lb.morphVelY * ny;
                                if (dot > 0.0f) {
                                    lb.morphVelX -= 2.0f * dot * nx;
                                    lb.morphVelY -= 2.0f * dot * ny;
                                }
                                targetX = 0.5f + nx * 0.43f;
                                targetY = 0.5f + ny * 0.43f;
                            }
                        }
                        else if (lb.exploreModeE == ExploreMode::Bounce) {
                            // â”€â”€ Billiard ball â€” same speed as LFO circle â”€â”€
                            float bdx = std::cos (lb.morphAngle) * distThisBuffer;
                            float bdy = std::sin (lb.morphAngle) * distThisBuffer;
                            targetX = lb.playheadX + bdx;
                            targetY = lb.playheadY + bdy;

                            // Circular boundary reflection
                            float cdx = targetX - 0.5f, cdy = targetY - 0.5f;
                            float cdist = std::sqrt (cdx * cdx + cdy * cdy);
                            if (cdist > 0.44f && cdist > 0.0f) {
                                float bnx = cdx / cdist, bny = cdy / cdist;
                                float dot = std::cos (lb.morphAngle) * bnx + std::sin (lb.morphAngle) * bny;
                                lb.morphAngle = std::atan2 (std::sin (lb.morphAngle) - 2.0f * dot * bny,
                                                            std::cos (lb.morphAngle) - 2.0f * dot * bnx);
                                lb.morphAngle += (audioRandom.nextFloat() - 0.5f) * 0.25f;
                                targetX = 0.5f + bnx * 0.43f;
                                targetY = 0.5f + bny * 0.43f;
                            }
                        }
                        else if (lb.exploreModeE == ExploreMode::Shapes) {
                            lb.morphLfoPhase += phaseDelta;
                            while (lb.morphLfoPhase > juce::MathConstants<float>::twoPi)
                                lb.morphLfoPhase -= juce::MathConstants<float>::twoPi;

                            // Accumulate shape rotation (lfoRotation: -1..+1 â†’ Â±2 rev/sec)
                            float rotSpeed = lb.lfoRotation * 2.0f * juce::MathConstants<float>::twoPi;
                            lb.lfoRotAngle += rotSpeed * secsPerBuffer;
                            while (lb.lfoRotAngle > juce::MathConstants<float>::twoPi)
                                lb.lfoRotAngle -= juce::MathConstants<float>::twoPi;
                            while (lb.lfoRotAngle < -juce::MathConstants<float>::twoPi)
                                lb.lfoRotAngle += juce::MathConstants<float>::twoPi;

                            float t = lb.morphLfoPhase;
                            // Depth controls shape radius: 0..1 â†’ 0..0.48
                            float R = lb.lfoDepth * 0.48f;

                            // Compute shape position relative to center
                            auto [dx, dy] = computeShapeXY (lb.lfoShapeE, t, R);

                            // SweepX/SweepY: preserve current position on the non-sweeping axis
                            if (lb.lfoShapeE == LfoShape::SweepX) dy = lb.playheadY - 0.5f;
                            if (lb.lfoShapeE == LfoShape::SweepY) dx = lb.playheadX - 0.5f;

                            // Apply shape rotation (rotate dx,dy around center)
                            if (std::abs (lb.lfoRotAngle) > 0.0001f) {
                                float cosR = std::cos (lb.lfoRotAngle);
                                float sinR = std::sin (lb.lfoRotAngle);
                                float rx = dx * cosR - dy * sinR;
                                float ry = dx * sinR + dy * cosR;
                                dx = rx;
                                dy = ry;
                            }

                            targetX = 0.5f + dx;
                            targetY = 0.5f + dy;
                        }
                        else if (lb.exploreModeE == ExploreMode::Orbit && numSnaps > 0) {
                            lb.morphOrbitPhase += phaseDelta;
                            while (lb.morphOrbitPhase > juce::MathConstants<float>::twoPi) {
                                lb.morphOrbitPhase -= juce::MathConstants<float>::twoPi;
                                lb.morphOrbitTarget = (lb.morphOrbitTarget + 1) % numSnaps;
                            }
                            int ot = lb.morphOrbitTarget % numSnaps;
                            float orbitR = 0.12f;
                            targetX = lb.snapshots[ot].x + orbitR * std::cos (lb.morphOrbitPhase);
                            targetY = lb.snapshots[ot].y + orbitR * std::sin (lb.morphOrbitPhase);
                        }
                        else if (lb.exploreModeE == ExploreMode::Path && numSnaps > 1) {
                            // Path speed: traverse one segment in the same time
                            // as one LFO revolution
                            lb.morphPathProgress += cyclesPerSec * secsPerBuffer;
                            if (lb.morphPathProgress >= 1.0f) {
                                lb.morphPathProgress -= 1.0f;
                                lb.morphPathIndex = (lb.morphPathIndex + 1) % numSnaps;
                            }
                            int curr = lb.morphPathIndex % numSnaps;
                            int next = (lb.morphPathIndex + 1) % numSnaps;
                            float t = lb.morphPathProgress;
                            t = t * t * (3.0f - 2.0f * t); // smoothstep
                            targetX = lb.snapshots[curr].x + t * (lb.snapshots[next].x - lb.snapshots[curr].x);
                            targetY = lb.snapshots[curr].y + t * (lb.snapshots[next].y - lb.snapshots[curr].y);
                        }

                        // Final circular clamp (all explore modes)
                        float fcx = targetX - 0.5f, fcy = targetY - 0.5f;
                        float fcd = std::sqrt (fcx * fcx + fcy * fcy);
                        if (fcd > 0.48f) { float s = 0.48f / fcd; targetX = 0.5f + fcx * s; targetY = 0.5f + fcy * s; }

                        lb.playheadX = targetX;
                        lb.playheadY = targetY;
                    }

                    // -- Trigger mode: apply jump/step on trigger --
                    if (lb.morphModeE == MorphMode::Trigger && shouldTrigger)
                    {
                        int numSnaps = (int) lb.snapshots.size();
                        if (lb.morphActionE == MorphAction::Jump) {
                            int ri = audioRandom.nextInt (numSnaps);
                            targetX = lb.snapshots[ri].x;
                            targetY = lb.snapshots[ri].y;
                        } else if (lb.morphActionE == MorphAction::Step) {
                            if (lb.stepOrderE == StepOrder::Cycle)
                                lb.morphStepIndex = (lb.morphStepIndex + 1) % numSnaps;
                            else
                                lb.morphStepIndex = audioRandom.nextInt (numSnaps);
                            targetX = lb.snapshots[lb.morphStepIndex].x;
                            targetY = lb.snapshots[lb.morphStepIndex].y;
                        }
                        lb.playheadX = targetX;
                        lb.playheadY = targetY;

                        // Fire trigger notification to UI
                        const auto tScope = triggerFifo.write (1);
                        if (tScope.blockSize1 > 0)      triggerRing[tScope.startIndex1] = lb.id;
                        else if (tScope.blockSize2 > 0) triggerRing[tScope.startIndex2] = lb.id;
                    }

                    // -- Apply jitter --
                    float finalX = lb.playheadX;
                    float finalY = lb.playheadY;
                    if (lb.jitter > 0.001f) {
                        finalX += (audioRandom.nextFloat() - 0.5f) * lb.jitter * 0.2f;
                        finalY += (audioRandom.nextFloat() - 0.5f) * lb.jitter * 0.2f;
                        // Circular clamp
                        float jdx = finalX - 0.5f, jdy = finalY - 0.5f;
                        float jd = std::sqrt (jdx * jdx + jdy * jdy);
                        if (jd > 0.48f) { float js = 0.48f / jd; finalX = 0.5f + jdx * js; finalY = 0.5f + jdy * js; }
                    }

                    // -- Smooth playhead (glide) --
                    // Auto-explore modes produce continuous motion â€” pass through directly.
                    // Only trigger/manual modes need glide smoothing (discrete jumps).
                    if (lb.morphModeE == MorphMode::Auto) {
                        lb.morphSmoothX = finalX;
                        lb.morphSmoothY = finalY;
                    } else {
                        float glideTimeSec = std::max (0.001f, lb.morphGlide * 0.001f);
                        float secsThisBuffer = (float) numSamples / (float) currentSampleRate;
                        float glideCoeff = std::exp (-secsThisBuffer / glideTimeSec);
                        lb.morphSmoothX = glideCoeff * lb.morphSmoothX + (1.0f - glideCoeff) * finalX;
                        lb.morphSmoothY = glideCoeff * lb.morphSmoothY + (1.0f - glideCoeff) * finalY;
                    }

                    // Snap to target when close enough â€” prevents asymptotic residual
                    // from keeping IDW firing indefinitely
                    if (std::abs (lb.morphSmoothX - finalX) < 1e-5f) lb.morphSmoothX = finalX;
                    if (std::abs (lb.morphSmoothY - finalY) < 1e-5f) lb.morphSmoothY = finalY;

                    // -- Only apply IDW when the smoothed playhead has actually moved --
                    // This prevents constant parameter overwrites when the dot is stationary,
                    // allowing the user to manually tweak hosted plugin parameters.
                    float dsx = lb.morphSmoothX - lb.prevAppliedX;
                    float dsy = lb.morphSmoothY - lb.prevAppliedY;
                    if (dsx * dsx + dsy * dsy > 1e-6f)
                    {
                        lb.prevAppliedX = lb.morphSmoothX;
                        lb.prevAppliedY = lb.morphSmoothY;

                        // -- IDW Interpolation with exact radius boundary --
                        // snapRadius is the actual distance (0.05..1.0) in pad coordinates.
                        // Weight = (1 - dist/radius)^2 â€” drops to exactly zero at boundary.
                        float radius = lb.snapRadius;
                        float weights[12] = {};
                        int numSnaps = juce::jmin ((int) lb.snapshots.size(), 12);
                        float totalWeight = 0.0f;
                        for (int si = 0; si < numSnaps; ++si) {
                            float dx = lb.morphSmoothX - lb.snapshots[si].x;
                            float dy = lb.morphSmoothY - lb.snapshots[si].y;
                            float dist = std::sqrt (dx * dx + dy * dy);
                            float w = 0.0f;
                            if (dist < radius) {
                                float t = 1.0f - dist / radius;
                                w = t * t;  // quadratic: smooth at center, zero at boundary
                            }
                            weights[si] = w;
                            totalWeight += w;
                        }
                        if (totalWeight > 0.0f)
                        {
                            for (int si = 0; si < numSnaps; ++si) weights[si] /= totalWeight;

                            // -- Mix target values and apply --
                            for (size_t ti = 0; ti < lb.targets.size(); ++ti) {
                                float mixed = 0.0f;
                                for (int si = 0; si < numSnaps; ++si) {
                                    if (ti < lb.snapshots[si].targetValues.size())
                                        mixed += weights[si] * lb.snapshots[si].targetValues[ti];
                                }
                                mixed = juce::jlimit (0.0f, 1.0f, mixed);
                                writeModBase (lb.targets[ti].pluginId, lb.targets[ti].paramIndex, mixed);
                            }
                        }
                    }

                    // -- Write playhead readback for UI --
                    if (morphIdx < maxMorphReadback) {
                        // Circular clamp before sending to UI (r=0.45)
                        float rbX = lb.morphSmoothX, rbY = lb.morphSmoothY;
                        float rbdx = rbX - 0.5f, rbdy = rbY - 0.5f;
                        float rbd = std::sqrt (rbdx * rbdx + rbdy * rbdy);
                        if (rbd > 0.48f) { float rbs = 0.48f / rbd; rbX = 0.5f + rbdx * rbs; rbY = 0.5f + rbdy * rbs; }
                        morphReadback[morphIdx].blockId.store (lb.id);
                        morphReadback[morphIdx].headX.store (rbX);
                        morphReadback[morphIdx].headY.store (rbY);
                        morphReadback[morphIdx].rotAngle.store (lb.lfoRotAngle);
                        morphIdx++;
                    }
                }

                // ===== SHAPES BLOCK: restore base values on disable or mode change =====
                else if (lb.shapeWasEnabled && !lb.targets.empty()
                         && (!lb.enabled || (lb.modeE != BlockMode::Shapes && lb.modeE != BlockMode::ShapesRange)))
                {
                    lb.shapeWasEnabled = false;
                    // Snap all params back to their user-defined base values
                    for (size_t ti = 0; ti < lb.targets.size() && ti < lb.targetBaseValues.size(); ++ti)
                    {
                        float base = lb.targetBaseValues[ti];
                        setParamDirect (lb.targets[ti].pluginId, lb.targets[ti].paramIndex, base);
                        lb.targetLastWritten[ti] = base;
                        int _s = slotForId (lb.targets[ti].pluginId);
                        if (_s >= 0 && lb.targets[ti].paramIndex < kMaxParams)
                            paramWritten[_s][lb.targets[ti].paramIndex] = base;
                    }
                }

                // ===== SHAPES BLOCK (including shapes_range) =====
                else if ((lb.modeE == BlockMode::Shapes || lb.modeE == BlockMode::ShapesRange) && lb.enabled && !lb.targets.empty())
                {
                    lb.shapeWasEnabled = true;
                    float twoPi = juce::MathConstants<float>::twoPi;
                    float secsPerBuffer = (float) numSamples / (float) currentSampleRate;

                    bool dawSynced = (lb.shapeTempoSync && lb.clockSourceE != ClockSource::Internal);

                    // Transport gating: DAW-synced shapes pause when transport stops
                    if (dawSynced && !playing)
                    {
                        lb.shapeWasPlaying = false;
                        // Still write dot readback so UI shows frozen position
                        if (morphIdx < maxMorphReadback) {
                            float t = lb.shapePhase + lb.shapePhaseOffset * twoPi;
                            while (t > twoPi) t -= twoPi;
                            float effectiveSize = (lb.modeE == BlockMode::ShapesRange) ? 1.0f : lb.shapeSize;
                            float R = effectiveSize * 0.48f;
                            float dx = R * std::cos(t), dy = R * std::sin(t);
                            if (std::abs(lb.shapeRotAngle) > 0.0001f) {
                                float cosR = std::cos(lb.shapeRotAngle), sinR = std::sin(lb.shapeRotAngle);
                                float rx = dx * cosR - dy * sinR, ry = dx * sinR + dy * cosR;
                                dx = rx; dy = ry;
                            }
                            morphReadback[morphIdx].blockId.store(lb.id);
                            morphReadback[morphIdx].headX.store(0.5f + dx);
                            morphReadback[morphIdx].headY.store(0.5f + dy);
                            morphReadback[morphIdx].rotAngle.store(lb.shapeRotAngle);
                            morphIdx++;
                        }
                        continue;
                    }

                    // PPQ sync: snap phase to beat position on transport start
                    if (dawSynced && playing && !lb.shapeWasPlaying)
                    {
                        float beatsPerCycle = lb.shapeSyncDivBeats;
                        if (beatsPerCycle > 0.0f)
                        {
                            double beatsIntoLoop = std::fmod(ppq, (double) beatsPerCycle);
                            if (beatsIntoLoop < 0.0) beatsIntoLoop += (double) beatsPerCycle;
                            lb.shapePhase = (float)(beatsIntoLoop / beatsPerCycle) * twoPi;
                        }
                    }
                    lb.shapeWasPlaying = playing;

                    // MIDI retrigger: reset phase on note-on (with channel filtering + soft-engage reset)
                    if (lb.shapeTriggerE == ShapeTrigger::Midi && ! blockMidiEvents.empty())
                    {
                        for (const auto& ev : blockMidiEvents)
                        {
                            if (ev.isCC || ev.vel == 0) continue; // skip CCs and note-offs
                            if (lb.midiCh > 0 && ev.ch != lb.midiCh) continue;
                            lb.shapePhase = 0.0f;
                            // Reset soft-engage depth so it ramps in smoothly from 0
                            lb.smoothedShapeDepth = 0.0f;
                            for (auto& sv : lb.smoothedRangeValues) sv = 0.0f;
                            break;
                        }
                    }

                    // Advance phase based on speed
                    float speedHz;
                    // Determine effective BPM from chosen clock source
                    float effectiveBpm = (lb.clockSourceE == ClockSource::Internal) ? lb.internalBpm : (float) currentBpm.load();
                    if (lb.shapeTempoSync && effectiveBpm > 0.0f)
                    {
                        float beatsPerCycle = lb.shapeSyncDivBeats;
                        float secsPerCycle = beatsPerCycle * 60.0f / effectiveBpm;
                        speedHz = 1.0f / std::max(0.001f, secsPerCycle);
                    }
                    else
                    {
                        speedHz = 0.02f + lb.shapeSpeed * lb.shapeSpeed * lb.shapeSpeed * 4.98f; // exponential: 0.02â€“5 Hz, most range in slow end
                    }
                    float phaseDelta = speedHz * twoPi * secsPerBuffer;
                    lb.shapePhase += phaseDelta;
                    while (lb.shapePhase > twoPi) lb.shapePhase -= twoPi;

                    // Accumulate spin (exponential: gentle near center, fast at extremes)
                    float spinNorm = lb.shapeSpin; // -1..+1
                    float spinExp = spinNorm * spinNorm * (spinNorm > 0 ? 1.0f : -1.0f); // preserve sign, square magnitude
                    float spinSpeed = spinExp * 2.0f * twoPi;
                    lb.shapeRotAngle += spinSpeed * secsPerBuffer;
                    while (lb.shapeRotAngle > twoPi) lb.shapeRotAngle -= twoPi;
                    while (lb.shapeRotAngle < -twoPi) lb.shapeRotAngle += twoPi;

                    // Apply user phase offset (0..1 maps to 0..2π)
                    float t = lb.shapePhase + lb.shapePhaseOffset * twoPi;
                    while (t > twoPi) t -= twoPi;
                    // shapes_range always uses max size
                    float effectiveSize = (lb.modeE == BlockMode::ShapesRange) ? 1.0f : lb.shapeSize;
                    float R = effectiveSize * 0.48f;

                    // ── Shape computation (uses shared helper) ──
                    auto [dx, dy] = computeShapeXY (lb.shapeTypeE, t, R);


                    // Apply spin rotation
                    if (std::abs(lb.shapeRotAngle) > 0.0001f) {
                        float cosR = std::cos(lb.shapeRotAngle);
                        float sinR = std::sin(lb.shapeRotAngle);
                        float rx = dx * cosR - dy * sinR;
                        float ry = dx * sinR + dy * cosR;
                        dx = rx; dy = ry;
                    }

                    // â”€â”€ Tracking: reduce 2D â†’ 1D â”€â”€
                    float normR = std::max(R, 0.001f);
                    float output = 0.0f;
                    if (lb.shapeTrackingE == ShapeTracking::Horizontal) {
                        output = dx / normR; // -1..+1
                    } else if (lb.shapeTrackingE == ShapeTracking::Vertical) {
                        output = dy / normR; // -1..+1
                    } else { // "distance"
                        output = std::sqrt(dx*dx + dy*dy) / normR; // 0..+1
                    }

                    // Apply polarity â€” compute modVal per-target for shapes_range
                    bool isShapesRange = (lb.modeE == BlockMode::ShapesRange);

                    // â”€â”€ Apply to targets â”€â”€
                    auto n = lb.targets.size();
                    if (lb.targetBaseValues.size() != n)
                    {
                        lb.targetBaseValues.resize (n);
                        lb.targetLastWritten.resize (n, -1.0f);
                        lb.targetExtPause.resize (n, 0);
                        for (size_t ti = 0; ti < n; ++ti)
                        {
                            // shapes_range: use JS-supplied base values (anchor positions)
                            if (isShapesRange && ti < lb.targetRangeBaseValues.size())
                                lb.targetBaseValues[ti] = lb.targetRangeBaseValues[ti];
                            else
                                lb.targetBaseValues[ti] = getParamValue (lb.targets[ti].pluginId, lb.targets[ti].paramIndex);
                        }
                    }

                    // shapes_range: always pick up latest JS-supplied bases
                    // (e.g. after randomize updates targetRangeBases → syncBlocksToHost)
                    if (isShapesRange)
                    {
                        for (size_t ti = 0; ti < n && ti < lb.targetRangeBaseValues.size(); ++ti)
                            lb.targetBaseValues[ti] = lb.targetRangeBaseValues[ti];
                    }

                    // Rate-correct smoothing coefficient for ~80ms ramp
                    float rampCoeff = 1.0f - std::exp (-secsPerBuffer / 0.08f);

                    for (size_t ti = 0; ti < n; ++ti)
                    {
                        // Per-param depth: use targetRangeValues for shapes_range, else global shapeDepth
                        float targetDepth = isShapesRange
                            ? (ti < lb.targetRangeValues.size() ? lb.targetRangeValues[ti] : 0.0f)
                            : lb.shapeDepth;

                        // Soft-engage: smoothly ramp effective depth to prevent jumps
                        float depth;
                        if (isShapesRange)
                        {
                            if (lb.smoothedRangeValues.size() <= ti)
                                lb.smoothedRangeValues.resize (ti + 1, 0.0f);

                            float prevSmoothed = lb.smoothedRangeValues[ti];
                            lb.smoothedRangeValues[ti] += rampCoeff * (targetDepth - lb.smoothedRangeValues[ti]);
                            depth = lb.smoothedRangeValues[ti];

                            // Recapture base when modulation first engages (0 → non-zero)
                            if (std::abs (prevSmoothed) < 0.001f && std::abs (depth) >= 0.001f)
                                lb.targetBaseValues[ti] = getParamValue (lb.targets[ti].pluginId, lb.targets[ti].paramIndex);
                        }
                        else
                        {
                            // Regular shapes: ramp shapeDepth with soft-engage
                            float prevSD = lb.smoothedShapeDepth;
                            lb.smoothedShapeDepth += rampCoeff * (targetDepth - lb.smoothedShapeDepth);
                            depth = lb.smoothedShapeDepth;

                            // Recapture base when modulation first engages
                            if (ti == 0 && std::abs (prevSD) < 0.001f && std::abs (depth) >= 0.001f)
                            {
                                for (size_t ri = 0; ri < n; ++ri)
                                    lb.targetBaseValues[ri] = getParamValue (lb.targets[ri].pluginId, lb.targets[ri].paramIndex);
                            }
                        }

                        // Check if user is currently dragging this param
                        int _tSlot = slotForId (lb.targets[ti].pluginId);
                        bool isTouched = (_tSlot >= 0 && lb.targets[ti].paramIndex < kMaxParams
                                         && paramTouched[_tSlot][lb.targets[ti].paramIndex].load (std::memory_order_acquire));

                        float modVal = 0.0f;
                        if (lb.shapePolarityE == Polarity::Bipolar) {
                            modVal = output * std::abs(depth);
                        } else if (lb.shapePolarityE == Polarity::Unipolar) {
                            float norm = (lb.shapeTrackingE == ShapeTracking::Distance) ? output : (output + 1.0f) * 0.5f;
                            modVal = norm * depth;
                        } else if (lb.shapePolarityE == Polarity::Up) {
                            float norm = (lb.shapeTrackingE == ShapeTracking::Distance) ? output : std::abs(output);
                            modVal = norm * std::abs(depth);
                        } else { // "down"
                            float norm = (lb.shapeTrackingE == ShapeTracking::Distance) ? output : std::abs(output);
                            modVal = -norm * std::abs(depth);
                        }
                        // Always relative — modbus handles base resolution
                        float newVal = modVal;  // Raw offset for modbus

                        // Detect external param changes (base tracking for shapes)
                        if (!isShapesRange && !isTouched)
                        {
                            float cur = getParamValue (lb.targets[ti].pluginId, lb.targets[ti].paramIndex);
                            int _sl = slotForId (lb.targets[ti].pluginId);
                            float _pw = (_sl >= 0 && lb.targets[ti].paramIndex < kMaxParams) ? paramWritten[_sl][lb.targets[ti].paramIndex] : -1.0f;
                            bool extChanged = false;
                            if (_pw > -0.5f && std::abs (cur - _pw) > 0.02f)
                                extChanged = true;
                            else if (_pw < -0.5f && lb.targetLastWritten[ti] >= 0.0f && std::abs (cur - lb.targetLastWritten[ti]) > 0.02f)
                                extChanged = true;
                            if (extChanged && ti < lb.targetExtPause.size())
                                lb.targetExtPause[ti] = std::max (30, (int)(1.0f / secsPerBuffer));
                        }

                        // Decrement external pause counter
                        bool extPaused = false;
                        if (ti < lb.targetExtPause.size() && lb.targetExtPause[ti] > 0)
                        {
                            lb.targetExtPause[ti]--;
                            extPaused = true;
                        }

                        // When touched or externally paused: skip writing (no fighting),
                        // but modVal was still computed so LFO cycle continues smoothly.
                        if (isTouched || extPaused)
                        {
                            lb.targetLastWritten[ti] = newVal;
                            // Sync paramWritten to current param value so external-change
                            // detection doesn't re-fire every buffer (which would reset
                            // the cooldown endlessly and cause flicker)
                            if (extPaused)
                            {
                                int _s = slotForId (lb.targets[ti].pluginId);
                                if (_s >= 0 && lb.targets[ti].paramIndex < kMaxParams)
                                    paramWritten[_s][lb.targets[ti].paramIndex] = getParamValue (lb.targets[ti].pluginId, lb.targets[ti].paramIndex);
                            }
                            continue;
                        }

                        // Skip writing when depth is effectively zero — no modulation to apply.
                        // Without this, shapes_range targets with range=0 would continuously
                        // write base+0=base, fighting any user knob movements.
                        if (std::abs (depth) < 0.001f)
                            continue;

                        addModOffset (lb.targets[ti].pluginId, lb.targets[ti].paramIndex, newVal);
                        lb.targetLastWritten[ti] = newVal;
                    }

                    // -- Write dot readback for UI --
                    if (morphIdx < maxMorphReadback) {
                        float dotX = 0.5f + dx, dotY = 0.5f + dy;
                        morphReadback[morphIdx].blockId.store(lb.id);
                        morphReadback[morphIdx].headX.store(dotX);
                        morphReadback[morphIdx].headY.store(dotY);
                        morphReadback[morphIdx].rotAngle.store(lb.shapeRotAngle);
                        morphReadback[morphIdx].modOutput.store(output);
                        morphIdx++;
                    }
                }
                // ===== LANE CLIPS =====
                else if (lb.modeE == BlockMode::Lane && lb.enabled && !lb.laneClips.empty())
                {
                    float secsPerBuffer = (float) numSamples / (float) currentSampleRate;
                    int laneIdx = 0;

                    // Advance internal beat accumulator for this block
                    bool useInternal = (lb.clockSourceE == ClockSource::Internal);
                    if (useInternal && lb.internalBpm > 0.0f)
                    {
                        double beatsPerSec = (double) lb.internalBpm / 60.0;
                        lb.internalPpq += beatsPerSec * (double) secsPerBuffer;
                    }

                    for (auto& lc : lb.laneClips)
                    {
                        bool hasDriftData = !lc.morphMode && (std::abs(lc.drift) > 0.001f && lc.driftRange > 0.001f);
                        bool hasCurveData = !lc.pts.empty() || hasDriftData;
                        bool hasMorphData = lc.morphMode && lc.morphSnapshots.size() >= 2;
                        if (lc.muted || (!hasCurveData && !hasMorphData)) { laneIdx++; continue; }

                        // Calculate loop duration in seconds
                        float loopSecs;
                        bool dawSynced = (lc.synced && lb.clockSourceE != ClockSource::Internal);

                        if (lc.loopLenFree)
                        {
                            loopSecs = std::max(0.1f, lc.freeSecs);
                        }
                        else
                        {
                            float loopBeats = lc.loopLenBeats;

                            float bpm = dawSynced
                                ? (float) currentBpm.load()
                                : lb.internalBpm;
                            if (bpm <= 0.0f) bpm = 120.0f;
                            loopSecs = loopBeats * 60.0f / bpm;
                        }

                        // ── ONESHOT TRIGGER DETECTION ──
                        if (lc.oneshotMode)
                        {
                            bool shouldTrigger = false;

                            if (lc.trigSourceE == 0) { // Manual
                                if (lc.manualTrigger)
                                {
                                    lc.manualTrigger = false;
                                    shouldTrigger = true;
                                }
                            }
                            else if (lc.trigSourceE == 1) { // MIDI
                                for (const auto& ev : blockMidiEvents) {
                                    if (ev.isCC) continue;
                                    bool noteMatch = (lc.trigMidiNote < 0 || ev.note == lc.trigMidiNote);
                                    bool chMatch = (lc.trigMidiCh == 0 || ev.ch == lc.trigMidiCh);
                                    if (noteMatch && chMatch) {
                                        if (ev.vel > 0) {
                                            if (lc.trigHold) lc.midiNoteHeld = true;
                                            if (!lc.oneshotActive || lc.trigRetrigger)
                                                shouldTrigger = true;
                                        } else if (lc.trigHold) {
                                            lc.midiNoteHeld = false; // note-off (gate mode only)
                                        }
                                    }
                                }
                            }
                            else if (lc.trigSourceE == 2) { // Audio
                                float rms = lc.trigAudioSrc ? scRms : mainRms;
                                if (rms > lc.trigThresholdLin && !lc.oneshotActive)
                                    shouldTrigger = true;
                            }

                            if (shouldTrigger && (lc.trigRetrigger || lc.oneshotDone || !lc.oneshotActive))
                            {
                                lc.playhead = 0.0;
                                lc.oneshotActive = true;
                                lc.oneshotDone = false;
                                lc.driftPhase = 0.0f;
                            }

                            // MIDI gate: if note released while active, stop (only in hold mode)
                            if (lc.trigHold && lc.trigSourceE == 1 && !lc.midiNoteHeld && lc.oneshotActive)
                            {
                                lc.oneshotActive = false;
                                lc.oneshotDone = true;
                            }

                            if (!lc.oneshotActive)
                            {
                                // Write idle readback and skip processing
                                int rbIdx = numActiveLanes.load();
                                if (rbIdx < maxLaneReadback)
                                {
                                    laneReadback[rbIdx].blockId.store(lb.id);
                                    laneReadback[rbIdx].laneIdx.store(laneIdx);
                                    laneReadback[rbIdx].playhead.store((float) lc.playhead);
                                    laneReadback[rbIdx].value.store(0.5f);
                                    laneReadback[rbIdx].active.store(false);
                                    numActiveLanes.store(rbIdx + 1);
                                }
                                laneIdx++;
                                continue;
                            }

                            // Advance playhead: gate mode loops, trigger mode stops at end
                            float playDelta = secsPerBuffer / std::max(0.001f, loopSecs);
                            lc.playhead += playDelta;
                            if (lc.playhead >= 1.0)
                            {
                                if (lc.trigHold && lc.trigSourceE == 1 && lc.midiNoteHeld) {
                                    // Loop while note is held (gate mode)
                                    while (lc.playhead >= 1.0) lc.playhead -= 1.0;
                                } else {
                                    lc.playhead = 1.0;
                                    lc.oneshotActive = false;
                                    lc.oneshotDone = true;
                                }
                            }
                        }
                        else
                        {
                        // ── NORMAL LOOP MODE (existing logic) ──

                        // Transport gating: DAW-synced lanes pause when transport stops
                        if (dawSynced && !playing)
                        {
                            lc.wasPlaying = false;
                            // Still write readback so UI shows frozen playhead
                            int rbIdx = numActiveLanes.load();
                            if (rbIdx < maxLaneReadback)
                            {
                                laneReadback[rbIdx].blockId.store(lb.id);
                                laneReadback[rbIdx].laneIdx.store(laneIdx);
                                laneReadback[rbIdx].playhead.store((float) lc.playhead);
                                laneReadback[rbIdx].value.store(0.5f);
                                laneReadback[rbIdx].active.store(true);
                                numActiveLanes.store(rbIdx + 1);
                            }
                            laneIdx++;
                            continue;
                        }

                        // PPQ sync: snap playhead to beat position on transport start
                        if (dawSynced && playing && !lc.wasPlaying && !lc.loopLenFree)
                        {
                            double beatsIntoLoop = std::fmod(ppq, (double) lc.loopLenBeats);
                            if (beatsIntoLoop < 0.0) beatsIntoLoop += (double) lc.loopLenBeats;
                            lc.playhead = beatsIntoLoop / (double) lc.loopLenBeats;
                        }
                        lc.wasPlaying = playing;

                        // Beat-synced forward mode: derive playhead directly from PPQ/internalPpq
                        // so all lanes with the same loopLen show identical positions
                        bool beatSynced = !lc.loopLenFree && lc.playModeE == LanePlayMode::Forward;
                        if (beatSynced && (dawSynced || useInternal))
                        {
                            double effectivePpq = dawSynced ? ppq : lb.internalPpq;
                            double beatsIntoLoop = std::fmod(effectivePpq, (double) lc.loopLenBeats);
                            if (beatsIntoLoop < 0.0) beatsIntoLoop += (double) lc.loopLenBeats;
                            lc.playhead = beatsIntoLoop / (double) lc.loopLenBeats;
                        }
                        else
                        {
                            float playDelta = secsPerBuffer / std::max(0.001f, loopSecs);

                            // Playhead modes
                            if (lc.playModeE == LanePlayMode::Reverse)
                            {
                                lc.playhead -= playDelta;
                                while (lc.playhead < 0.0) lc.playhead += 1.0;
                            }
                            else if (lc.playModeE == LanePlayMode::Pingpong)
                            {
                                lc.playhead += playDelta * lc.direction;
                                if (lc.playhead >= 1.0) { lc.playhead = 2.0 - lc.playhead; lc.direction = -1; }
                                if (lc.playhead <= 0.0) { lc.playhead = -lc.playhead; lc.direction = 1; }
                                lc.playhead = juce::jlimit(0.0, 1.0, lc.playhead);
                            }
                            else if (lc.playModeE == LanePlayMode::Random)
                            {
                                lc.playhead += playDelta;
                                if (lc.playhead >= 1.0) { lc.playhead = audioRandom.nextFloat(); }
                            }
                            else // "forward" (free-running for non-synced or free-length)
                            {
                                lc.playhead += playDelta;
                                while (lc.playhead >= 1.0) lc.playhead -= 1.0;
                            }
                        }

                        } // end else (normal loop mode)

                        float pos = (float) lc.playhead;
                        while (pos >= 1.0f) pos -= 1.0f;
                        while (pos < 0.0f) pos += 1.0f;

                        // ══════════ MORPH LANE OUTPUT ══════════
                        if (lc.morphMode && lc.morphSnapshots.size() >= 2)
                        {
                            auto& snaps = lc.morphSnapshots;
                            int numSnaps = (int) snaps.size();

                            // Find bracketing snapshots
                            int idx = numSnaps - 2;  // default to last pair
                            for (int si = 0; si < numSnaps - 1; ++si)
                            {
                                if (pos <= snaps[si + 1].position) { idx = si; break; }
                            }

                            auto& snapA = snaps[idx];
                            auto& snapB = snaps[idx + 1];
                            float gap = snapB.position - snapA.position;
                            float blend = 0.0f;

                            if (gap > 0.0001f)
                            {
                                // Calculate hold zones
                                float holdA = gap * (snapA.hold * 0.5f);
                                float holdB = gap * (snapB.hold * 0.5f);
                                float morphZone = gap - holdA - holdB;
                                if (morphZone < 0.0f)
                                {
                                    holdA = gap * 0.5f;
                                    holdB = gap * 0.5f;
                                    morphZone = 0.0f;
                                }

                                float localPh = pos - snapA.position;

                                if (localPh <= holdA)
                                    blend = 0.0f;
                                else if (localPh >= gap - holdB)
                                    blend = 1.0f;
                                else
                                {
                                    blend = (localPh - holdA) / std::max(0.0001f, morphZone);

                                    // Per-snapshot transition curve (applied to destination)
                                    switch (snapB.curve)
                                    {
                                        case 0:  // smooth (cosine S-curve)
                                            blend = 0.5f - 0.5f * std::cos(blend * 3.14159265f);
                                            break;
                                        case 1:  // linear — no transform
                                            break;
                                        case 2:  // sharp (ease-in)
                                            blend = blend * blend;
                                            break;
                                        case 3:  // late (ease-out)
                                            blend = 1.0f - (1.0f - blend) * (1.0f - blend);
                                            break;
                                    }
                                }

                                // Global step override
                                if (lc.interpE == LaneInterp::Step)
                                    blend = 0.0f;
                            }

                            // ── AUDIO-THREAD-SAFE morph interpolation ──
                            // Uses pre-parsed integer arrays — ZERO heap allocations.
                            // parsedValues are sorted by (pluginId, paramIndex) so we can
                            // iterate snapA and snapB by index when sizes match, or fall back
                            // to scanning snapB for mismatched sizes.

                            float snapDepth = snapB.depth;
                            float snapWarp  = snapB.warp;
                            int   snapSteps = snapB.steps;

                            auto& pvA = snapA.parsedValues;
                            auto& pvB = snapB.parsedValues;

                            // Fast path: both snapshots have same size and same key order
                            // (common case — all snapshots capture same params)
                            bool sameSize = (pvA.size() == pvB.size());

                            for (int pi = 0; pi < (int)pvA.size(); ++pi)
                            {
                                auto& pA = pvA[pi];

                                // Check if this param is in this lane's target list
                                // Binary search on pre-sorted targetKeySorted — O(log n), no strings
                                if (!lc.targetKeySorted.empty())
                                {
                                    LogicBlock::LaneClip::IntKey searchKey { pA.pluginId, pA.paramIndex };
                                    if (!std::binary_search(lc.targetKeySorted.begin(),
                                                           lc.targetKeySorted.end(), searchKey))
                                        continue;
                                }

                                // Find valB: fast if same index matches, else linear scan
                                float valB;
                                bool foundB = false;
                                if (sameSize && pvB[pi].pluginId == pA.pluginId
                                             && pvB[pi].paramIndex == pA.paramIndex)
                                {
                                    valB = pvB[pi].value;
                                    foundB = true;
                                }
                                else
                                {
                                    // Fallback: linear scan (rare — only when snapshots differ)
                                    for (int bi = 0; bi < (int)pvB.size(); ++bi)
                                    {
                                        if (pvB[bi].pluginId == pA.pluginId
                                            && pvB[bi].paramIndex == pA.paramIndex)
                                        {
                                            valB = pvB[bi].value;
                                            foundB = true;
                                            break;
                                        }
                                    }
                                }
                                if (!foundB) continue;

                                float morphed = pA.value + (valB - pA.value) * blend;

                                // Per-snapshot depth: scale toward center
                                morphed = 0.5f + (morphed - 0.5f) * snapDepth;

                                // Per-snapshot warp: S-curve contrast (bipolar)
                                if (std::abs(snapWarp) > 0.01f)
                                {
                                    float w = snapWarp * 0.01f;
                                    if (w > 0.0f)
                                    {
                                        float t = std::tanh(w * 3.0f * (morphed * 2.0f - 1.0f));
                                        morphed = 0.5f + 0.5f * t / std::tanh(w * 3.0f);
                                    }
                                    else
                                    {
                                        float aw = -w;
                                        float centered = morphed * 2.0f - 1.0f;
                                        float sign = centered >= 0.0f ? 1.0f : -1.0f;
                                        float ac = std::abs(centered);
                                        morphed = 0.5f + 0.5f * sign * std::pow(ac, 1.0f / (1.0f + aw * 3.0f));
                                    }
                                }

                                // Per-snapshot steps: quantize output
                                if (snapSteps >= 2)
                                {
                                    float s = (float)snapSteps;
                                    morphed = std::round(morphed * (s - 1.0f)) / (s - 1.0f);
                                }

                                morphed = juce::jlimit(0.0f, 1.0f, morphed);

                                // Per-param drift: each parameter gets unique organic variation
                                // Uses per-snapshot drift/driftRange + lane-level driftScale
                                float snapDriftNorm = snapB.drift / 50.0f; // -50..+50 → -1..+1
                                float driftAmt = std::abs(snapDriftNorm);
                                float driftRangeNorm = snapB.driftRange / 100.0f;
                                if (driftAmt > 0.001f && driftRangeNorm > 0.001f)
                                {
                                    auto hashI = [](int32_t n) -> float {
                                        uint32_t h = (uint32_t)n;
                                        h ^= h >> 16; h *= 0x45d9f3bu; h ^= h >> 16; h *= 0x45d9f3bu; h ^= h >> 16;
                                        return ((float)(h & 0xFFFF) / 32768.0f) - 1.0f;
                                    };
                                    auto smoothNoise = [&hashI](float phase) -> float {
                                        int i0 = (int)std::floor(phase);
                                        float frac = phase - (float)i0;
                                        float v0 = hashI(i0 - 1), v1 = hashI(i0);
                                        float v2 = hashI(i0 + 1), v3 = hashI(i0 + 2);
                                        float a = -0.5f * v0 + 1.5f * v1 - 1.5f * v2 + 0.5f * v3;
                                        float b = v0 - 2.5f * v1 + 2.0f * v2 - 0.5f * v3;
                                        float c = -0.5f * v0 + 0.5f * v2;
                                        return ((a * frac + b) * frac + c) * frac + v1;
                                    };

                                    float baseFreq = (snapDriftNorm > 0.0f)
                                        ? (1.0f + driftAmt * 2.0f)
                                        : (4.0f + driftAmt * 10.0f);
                                    float phaseScale = lc.loopLenBeats / std::max(0.25f, snapB.driftScaleBeats);
                                    float sharpness = std::max(0.0f, (driftAmt - 0.7f) / 0.3f);
                                    float freq = baseFreq * (1.0f + sharpness * 2.0f) * phaseScale;

                                    float paramSeed = hashI(pA.pluginId * 1000 + pA.paramIndex) * 100.0f;

                                    float p1 = (float)lc.playhead * freq + paramSeed;
                                    float p2 = (float)lc.playhead * freq * 2.37f + 7.13f + paramSeed;
                                    float noise = smoothNoise(p1) * 0.7f + smoothNoise(p2) * 0.3f;

                                    if (sharpness > 0.01f)
                                    {
                                        float p3 = (float)lc.playhead * freq * 5.19f + 13.7f + paramSeed;
                                        noise = noise * (1.0f - sharpness * 0.3f) + smoothNoise(p3) * sharpness * 0.3f;
                                    }

                                    morphed = juce::jlimit(0.0f, 1.0f, morphed + noise * driftRangeNorm);
                                }

                                writeModBase(pA.pluginId, pA.paramIndex, morphed);
                            }

                            // Readback
                            float readbackVal = blend;
                            int rbIdx = numActiveLanes.load();
                            if (rbIdx < maxLaneReadback)
                            {
                                laneReadback[rbIdx].blockId.store(lb.id);
                                laneReadback[rbIdx].laneIdx.store(laneIdx);
                                laneReadback[rbIdx].playhead.store((float) lc.playhead);
                                laneReadback[rbIdx].value.store(readbackVal);
                                laneReadback[rbIdx].active.store(lc.oneshotMode ? lc.oneshotActive : true);
                                numActiveLanes.store(rbIdx + 1);
                            }
                            laneIdx++;
                        }
                        // ══════════ CURVE LANE OUTPUT (existing) ══════════
                        else
                        {
                        // Evaluate curve at position
                        float value = 0.5f;
                        auto& pts = lc.pts;
                        int n = (int) pts.size();

                        if (n == 1)
                        {
                            value = pts[0].y;
                        }
                        else if (pos <= pts[0].x)
                        {
                            value = pts[0].y;
                        }
                        else if (pos >= pts[n - 1].x)
                        {
                            value = pts[n - 1].y;
                        }
                        else
                        {
                            int seg = 0;
                            for (int si = 0; si < n - 1; ++si)
                            {
                                if (pos >= pts[si].x && pos < pts[si + 1].x)
                                { seg = si; break; }
                            }
                            float x0 = pts[seg].x, x1 = pts[seg + 1].x;
                            float y0 = pts[seg].y, y1 = pts[seg + 1].y;
                            float t = (x1 > x0) ? (pos - x0) / (x1 - x0) : 0.0f;

                            if (lc.interpE == LaneInterp::Step)
                                value = y0;
                            else if (lc.interpE == LaneInterp::Smooth)
                            {
                                float ts = t * t * (3.0f - 2.0f * t);
                                value = y0 + (y1 - y0) * ts;
                            }
                            else
                                value = y0 + (y1 - y0) * t;
                        }

                        // y=0 top → param=1, y=1 bottom → param=0
                        float paramVal = 1.0f - value;

                        // Depth: scale toward center (0.5)
                        paramVal = 0.5f + (paramVal - 0.5f) * lc.depth;

                        // Warp: S-curve contrast, bipolar
                        if (std::abs(lc.warp) > 0.001f)
                        {
                            float centered = (paramVal - 0.5f) * 2.0f; // -1..+1
                            if (lc.warp > 0.0f)
                            {
                                // Positive warp: compress (S-curve via tanh)
                                float k = 1.0f + lc.warp * 8.0f;
                                float shaped = std::tanh(centered * k) / std::tanh(k);
                                paramVal = shaped * 0.5f + 0.5f;
                            }
                            else
                            {
                                // Negative warp: expand (inverse S-curve — push extremes)
                                float aw = std::abs(lc.warp);
                                float sign = centered >= 0.0f ? 1.0f : -1.0f;
                                float ac = std::abs(centered);
                                float expanded = std::pow(ac, 1.0f / (1.0f + aw * 3.0f)) * sign;
                                paramVal = expanded * 0.5f + 0.5f;
                            }
                        }

                        // Steps: output quantization
                        int stepsI = (int) lc.steps;
                        if (stepsI >= 2)
                        {
                            paramVal = std::round(paramVal * (float) stepsI) / (float) stepsI;
                        }

                        paramVal = juce::jlimit(0.0f, 1.0f, paramVal);

                        // Drift: deterministic organic variation with smooth→sharp character
                        // Positive (+): slow wandering. Negative (-): fast micro-jitter
                        // drift is -1..+1 (speed/character), driftRange is 0-100 (amplitude %)
                        float driftAmt = std::abs(lc.drift);
                        float driftRangeNorm = lc.driftRange / 100.0f; // 0..1.0
                        if (driftAmt > 0.001f && driftRangeNorm > 0.001f)
                        {
                            // Hash function: integer → deterministic float -1..+1
                            auto hashI = [](int32_t n) -> float {
                                uint32_t h = (uint32_t)n;
                                h ^= h >> 16; h *= 0x45d9f3bu; h ^= h >> 16; h *= 0x45d9f3bu; h ^= h >> 16;
                                return ((float)(h & 0xFFFF) / 32768.0f) - 1.0f;
                            };
                            // Smoothly interpolated value noise (hermite)
                            auto smoothNoise = [&hashI](float phase) -> float {
                                int i0 = (int)std::floor(phase);
                                float frac = phase - (float)i0;
                                float v0 = hashI(i0 - 1);
                                float v1 = hashI(i0);
                                float v2 = hashI(i0 + 1);
                                float v3 = hashI(i0 + 2);
                                float a = -0.5f * v0 + 1.5f * v1 - 1.5f * v2 + 0.5f * v3;
                                float b = v0 - 2.5f * v1 + 2.0f * v2 - 0.5f * v3;
                                float c = -0.5f * v0 + 0.5f * v2;
                                return ((a * frac + b) * frac + c) * frac + v1;
                            };
                            // Base frequency: positive=very slow, negative=moderate jitter
                            float baseFreq = (lc.drift > 0.0f)
                                ? (1.0f + driftAmt * 2.0f)   // slow: 1-3 cycles per scale period
                                : (4.0f + driftAmt * 10.0f); // jitter: 4-14 cycles per scale period

                            // Phase scaling: drift operates on driftScale time, not loop time
                            float phaseScale = lc.loopLenBeats / std::max(0.25f, lc.driftScaleBeats);

                            // Above 70%: boost frequency for sharper character (up to 3x)
                            float sharpness = std::max(0.0f, (driftAmt - 0.7f) / 0.3f);
                            float freq = baseFreq * (1.0f + sharpness * 2.0f) * phaseScale;

                            float p1 = (float)lc.playhead * freq;
                            float p2 = (float)lc.playhead * freq * 2.37f + 7.13f;
                            float noise = smoothNoise(p1) * 0.7f + smoothNoise(p2) * 0.3f;

                            // Add 3rd octave at high sharpness for extra texture
                            if (sharpness > 0.01f)
                            {
                                float p3 = (float)lc.playhead * freq * 5.19f + 13.7f;
                                noise = noise * (1.0f - sharpness * 0.3f) + smoothNoise(p3) * sharpness * 0.3f;
                            }

                            // Amplitude from driftRange (as fraction of full 0..1 range)
                            paramVal = juce::jlimit(0.0f, 1.0f, paramVal + noise * driftRangeNorm);
                        }

                        // Lane output: absolute parameter positioning (like Morph Pad)
                        // paramVal is already 0..1, representing the target parameter value
                        for (const auto& tgt : lc.targets)
                            writeModBase (tgt.pluginId, tgt.paramIndex, paramVal);

                        // Write readback for UI
                        int rbIdx = numActiveLanes.load();
                        if (rbIdx < maxLaneReadback)
                        {
                            laneReadback[rbIdx].blockId.store(lb.id);
                            laneReadback[rbIdx].laneIdx.store(laneIdx);
                            laneReadback[rbIdx].playhead.store((float) lc.playhead);
                            laneReadback[rbIdx].value.store(paramVal);
                            laneReadback[rbIdx].active.store(lc.oneshotMode ? lc.oneshotActive : true);
                            numActiveLanes.store(rbIdx + 1);
                        }
                        laneIdx++;
                        } // end else (curve mode)
                    }
                }
            }
            resolveModBus();
            numActiveEnvBlocks.store (envIdx);
            numActiveSampleBlocks.store (smpIdx);
            numActiveMorphBlocks.store (morphIdx);
        }
    }

    // â”€â”€ Drain glide command FIFO (lock-free read) â”€â”€
    {
        const auto scope = glideFifo.read (glideFifo.getNumReady());

        auto applyCmd = [this] (const GlideCommand& cmd)
        {
            // O(1) lookup via pluginSlots
            float currentVal = getParamValue (cmd.pluginId, cmd.paramIndex);

            int totalSamples = juce::jmax (1, (int) (cmd.durationMs * 0.001 * currentSampleRate));

            // Check if a glide already exists for this param — update in-place
            for (int gi = 0; gi < numActiveGlides; ++gi)
            {
                auto& g = glidePool[gi];
                if (g.pluginId == cmd.pluginId && g.paramIndex == cmd.paramIndex)
                {
                    g.targetVal  = cmd.targetVal;
                    g.increment  = (cmd.targetVal - g.currentVal) / (float) totalSamples;
                    g.samplesLeft = totalSamples;
                    return;
                }
            }

            // New glide (fixed-size pool, no allocation)
            if (numActiveGlides < kMaxGlides)
            {
                glidePool[numActiveGlides++] = {
                    cmd.pluginId, cmd.paramIndex,
                    currentVal, cmd.targetVal,
                    (cmd.targetVal - currentVal) / (float) totalSamples,
                    totalSamples
                };
            }
        };

        for (int i = 0; i < scope.blockSize1; ++i)
            applyCmd (glideRing[scope.startIndex1 + i]);
        for (int i = 0; i < scope.blockSize2; ++i)
            applyCmd (glideRing[scope.startIndex2 + i]);
    }

    // â”€â”€ Advance active glides (per-buffer interpolation) â”€â”€
    {
        int numSamples = buffer.getNumSamples();

        // Swap-to-end removal: O(1) per removal, no shifting
        for (int gi = 0; gi < numActiveGlides; )
        {
            auto& g = glidePool[gi];
            int advance = juce::jmin (numSamples, g.samplesLeft);
            g.currentVal += g.increment * (float) advance;
            g.samplesLeft -= advance;

            // Snap to target when done
            if (g.samplesLeft <= 0)
                g.currentVal = g.targetVal;

            // Apply to parameter — route through setParamDirect to handle WrongEQ + hosted
            float gVal = juce::jlimit (0.0f, 1.0f, g.currentVal);
            setParamDirect (g.pluginId, g.paramIndex, gVal);
            // Update modbus base so continuous modulators track the glide
            updateParamBase (g.pluginId, g.paramIndex, gVal);

            if (g.samplesLeft <= 0)
            {
                // Swap with last element and decrement count (O(1) removal)
                glidePool[gi] = glidePool[--numActiveGlides];
                // Don't increment gi — re-check the swapped-in element
            }
            else
            {
                ++gi;
            }
        }
    }

    // ── Crash-protected single-plugin processing (shared by both modes) ──
    // Creates a stereo-only alias buffer so hosted plugins never see sidechain channels.
    auto processOnePlugin = [this, &midiMessages, mainBusChannels] (HostedPlugin& hp, juce::AudioBuffer<float>& buf) -> bool
    {
        if (hp.instance == nullptr || ! hp.prepared || hp.bypassed || hp.crashed)
            return true; // skip = success

        // Create a channel-limited alias (no allocation — just pointers into the existing buffer)
        int pluginChannels = juce::jmin (mainBusChannels, buf.getNumChannels());
        int pluginSamples  = buf.getNumSamples();

        // Build an alias AudioBuffer that references only the main bus channels
        float* channelPtrs[8] = {};
        for (int ch = 0; ch < juce::jmin (pluginChannels, 8); ++ch)
            channelPtrs[ch] = buf.getWritePointer (ch);

        juce::AudioBuffer<float> pluginBuf (channelPtrs, pluginChannels, pluginSamples);

        // Use last bus buffer as scratch for crash rollback (never allocated here)
        auto& rollback = busBuffers[maxBuses - 1];
        int numCh = juce::jmin (pluginChannels, rollback.getNumChannels());
        int numSmp = juce::jmin (pluginSamples, rollback.getNumSamples());
        for (int ch = 0; ch < numCh; ++ch)
            rollback.copyFrom (ch, 0, pluginBuf, ch, 0, numSmp);

        bool ok = false;
        try { ok = sehGuardedProcessBlock (hp.instance.get(), pluginBuf, midiMessages); }
        catch (...) { ok = false; }

        if (! ok)
        {
            hp.crashed = true;
            hp.crashCount++;
            for (int ch = 0; ch < numCh; ++ch)
                pluginBuf.copyFrom (ch, 0, rollback, ch, 0, numSmp);

            CrashEvent ce;
            ce.pluginId = hp.id;
            auto nameStd = hp.name.toStdString();
            std::strncpy (ce.pluginName, nameStd.c_str(), sizeof (ce.pluginName) - 1);
            std::strncpy (ce.reason, "Plugin crashed during audio processing",
                          sizeof (ce.reason) - 1);
            const auto scope = crashFifo.write (1);
            if (scope.blockSize1 > 0) crashRing[scope.startIndex1] = ce;
            else if (scope.blockSize2 > 0) crashRing[scope.startIndex2] = ce;

            // NOTE: LOG_TO_FILE removed — it does disk I/O which blocks the audio thread.
            // The crash FIFO carries the info; the editor drains it and can log if needed.
            return false;
        }

        // NaN/Inf sanitization
        for (int ch = 0; ch < pluginChannels; ++ch)
        {
            auto* data = pluginBuf.getWritePointer (ch);
            for (int s = 0; s < pluginSamples; ++s)
            {
                if (std::isnan (data[s]) || std::isinf (data[s]))
                    data[s] = 0.0f;
            }
        }
        return true;
    };

    // ── Route audio through hosted plugins ──
    // NO LOCK here — removePlugin only nulls the instance (never erases),
    // so the vector is stable. processOnePlugin checks for null instance.
    if (routingMode.load() == 0)
    {
        // SEQUENTIAL MODE: DAW-correct instrument + effect routing
        //
        // Strategy: two-pass approach
        //   Pass 1: Process all instruments (synths) — each gets a zeroed buffer,
        //           outputs are SUMMED (layered) into synthAccum
        //   Pass 2: Copy summed synth output into main buffer (replacing DAW input),
        //           then process all effects sequentially
        //
        // If there are NO instruments, effects process the DAW input directly (pure FX chain).

        // Count instruments to decide routing path
        bool hasInstruments = false;
        for (auto& hp : hostedPlugins)
        {
            if (hp->isInstrument && hp->instance && hp->prepared && !hp->bypassed && !hp->crashed)
            {
                hasInstruments = true;
                break;
            }
        }

        if (hasInstruments)
        {
            // Pass 1: Layer all synths into synthAccum
            int numChannels = buffer.getNumChannels();
            int numSamples  = buffer.getNumSamples();
            int accumCh  = juce::jmin (numChannels, synthAccum.getNumChannels());
            int accumSmp = juce::jmin (numSamples,  synthAccum.getNumSamples());

            synthAccum.clear (0, accumSmp);

            for (auto& hp : hostedPlugins)
            {
                if (! hp->isInstrument) continue;

                // Each synth gets a zeroed buffer → generates from MIDI only
                // Use a bus buffer as temporary workspace (never the rollback buffer)
                auto& synthBuf = busBuffers[0]; // safe: not in parallel mode
                for (int ch = 0; ch < juce::jmin (numChannels, synthBuf.getNumChannels()); ++ch)
                    synthBuf.clear (ch, 0, juce::jmin (numSamples, synthBuf.getNumSamples()));

                processOnePlugin (*hp, synthBuf);

                // Accumulate (layer) — ADD this synth's output to the accum buffer
                for (int ch = 0; ch < accumCh; ++ch)
                    synthAccum.addFrom (ch, 0, synthBuf, ch, 0, accumSmp);
            }

            // Replace main buffer with summed synth output
            for (int ch = 0; ch < accumCh; ++ch)
                buffer.copyFrom (ch, 0, synthAccum, ch, 0, accumSmp);

            // Pass 2: Process effects sequentially (they see the combined synth output)
            for (auto& hp : hostedPlugins)
            {
                if (hp->isInstrument) continue; // already processed
                processOnePlugin (*hp, buffer);
            }
        }
        else
        {
            // Pure FX chain — no instruments, process DAW input directly
            for (auto& hp : hostedPlugins)
                processOnePlugin (*hp, buffer);
        }
    }
    else if (routingMode.load() == 2)
    {
        // ── WRONGEQ: band-split → per-band plugin processing → recombine ──
        int numChannels = buffer.getNumChannels();
        int numSamples  = buffer.getNumSamples();
        int nPts = numEqPoints.load();

        // Global bypass: pass audio through unprocessed
        if (eqGlobalBypass.load())
        {
            eqDirty.exchange (false); // consume pending updates
            // Still process serial chain so plugins stay fed
            for (auto& hp : hostedPlugins)
                processOnePlugin (*hp, buffer);
        }
        else if (nPts < 1)
        {
            // No EQ points — serial fallback
            eqDirty.exchange (false);
            for (auto& hp : hostedPlugins)
                processOnePlugin (*hp, buffer);
        }
        else
        {
            // ── Crossover reconfiguration: ONLY when curve data changes from JS ──
            // Crossovers are structural — reconfigured at ~60Hz JS sync rate.
            // Biquad coefficients are recalculated EVERY processBlock from atomics
            // to eliminate the JS-sync-rate staircase (smooth per-buffer tracking).
            bool curveChanged = eqDirty.exchange (false, std::memory_order_acq_rel);

            // 2 crossovers per point → 2N+1 bands.
            // Odd bands (1,3,5...) = point bands (exact Q range).
            // Even bands (0,2,4...) = gap bands (passthrough).
            int nXovers = nPts * 2;
            numEqBands = nXovers + 1;
            float sr = (float) currentSampleRate;

            if (curveChanged)
            {
                // Pre-compute band frequency edges for every sorted point.
                // Matches JS weqBandRange() — each filter type defines its band differently:
                //   Bell/Notch: Q-derived bandwidth edges (Audio EQ Cookbook)
                //   LP/LowShelf: 20Hz to f0 (affects everything below cutoff)
                //   HP/HighShelf: f0 to Nyquist (affects everything above cutoff)
                float ptLo[maxEqBands], ptHi[maxEqBands];
                for (int i = 0; i < nPts; ++i)
                {
                    int origIdx = eqSortOrder[i].load();
                    if (origIdx >= 0 && origIdx < maxEqBands)
                    {
                        float f0 = eqPoints[origIdx].freqHz.load();
                        int   ft = eqPoints[origIdx].filterType.load();
                        float Q  = juce::jlimit (0.025f, 40.0f, eqPoints[origIdx].q.load());

                        switch (ft)
                        {
                            case 0: // Bell
                            case 3: // Notch — same Q-derived bandwidth as Bell
                            {
                                float bwOct = (2.0f / std::log (2.0f)) * std::asinh (1.0f / (2.0f * Q));
                                ptLo[i] = f0 / std::pow (2.0f, bwOct * 0.5f);
                                ptHi[i] = f0 * std::pow (2.0f, bwOct * 0.5f);
                                break;
                            }
                            case 1: // LP — band covers 20Hz to cutoff
                            case 4: // Low Shelf — band covers 20Hz to corner freq
                                ptLo[i] = 20.0f;
                                ptHi[i] = f0;
                                break;
                            case 2: // HP — band covers cutoff to Nyquist
                            case 5: // High Shelf — band covers corner freq to Nyquist
                                ptLo[i] = f0;
                                ptHi[i] = sr * 0.49f;
                                break;
                            default: // fallback: Q-derived
                            {
                                float bwOct = (2.0f / std::log (2.0f)) * std::asinh (1.0f / (2.0f * Q));
                                ptLo[i] = f0 / std::pow (2.0f, bwOct * 0.5f);
                                ptHi[i] = f0 * std::pow (2.0f, bwOct * 0.5f);
                                break;
                            }
                        }
                    }
                    else
                    {
                        ptLo[i] = ptHi[i] = 1000.0f;
                    }
                }

                // ── Split mode override: each point's band spans from prev divider to this divider ──
                // In normal mode: point band = ptLo..ptHi (Q-derived width)
                // In split mode:  point band = prev_point_freq..this_point_freq
                //   Point 0: 20Hz → f[0]    (lowest band)
                //   Point 1: f[0] → f[1]    (between point 0 and 1)
                //   ...
                //   Gap band above last point: f[N-1] → 20kHz  (passthrough)
                // The gap bands (even indices) collapse to zero width.
                if (eqSplitMode.load (std::memory_order_relaxed))
                {
                    for (int i = 0; i < nPts; ++i)
                    {
                        int origIdx = eqSortOrder[i].load();
                        if (origIdx >= 0 && origIdx < maxEqBands)
                        {
                            float f0 = eqPoints[origIdx].freqHz.load();
                            // ptLo = previous point's frequency (or 20Hz for first)
                            if (i == 0)
                                ptLo[i] = 20.0f;
                            else
                            {
                                int prevIdx = eqSortOrder[i - 1].load();
                                ptLo[i] = (prevIdx >= 0 && prevIdx < maxEqBands)
                                          ? eqPoints[prevIdx].freqHz.load() : 20.0f;
                            }
                            // ptHi = this point's frequency (crossover position)
                            ptHi[i] = f0;
                        }
                    }
                }

                // Build crossover frequency array: 2 per point (lo edge, hi edge).
                // xover[2*i]   = ptLo[i]  (lower Q edge)
                // xover[2*i+1] = ptHi[i]  (upper Q edge)
                float xoverFreqs[maxCrossovers];
                for (int i = 0; i < nPts; ++i)
                {
                    xoverFreqs[i * 2]     = juce::jlimit (20.0f, sr * 0.49f, ptLo[i]);
                    xoverFreqs[i * 2 + 1] = juce::jlimit (20.0f, sr * 0.49f, ptHi[i]);
                }

                // Handle overlapping Q ranges between adjacent sorted points.
                // When ptHi[i] > ptLo[i+1] (bells overlap), split the contested
                // frequency region at the geometric midpoint between the two
                // center frequencies. Each band keeps the non-overlapping portion
                // plus half the overlap. The gap band between them collapses.
                for (int i = 0; i < nPts - 1; ++i)
                {
                    float hiOfCurrent = xoverFreqs[i * 2 + 1]; // current point's upper edge
                    float loOfNext    = xoverFreqs[(i + 1) * 2]; // next point's lower edge
                    if (hiOfCurrent > loOfNext)
                    {
                        // Overlap detected: split at geometric midpoint
                        float mid = std::sqrt (hiOfCurrent * loOfNext);
                        mid = juce::jlimit (20.0f, sr * 0.49f, mid);
                        xoverFreqs[i * 2 + 1]   = mid; // pull P_i upper edge down
                        xoverFreqs[(i + 1) * 2]  = mid; // push P_{i+1} lower edge up
                    }
                }

                // Enforce minimum spacing between all consecutive crossovers.
                // After overlap resolution, some crossovers may be coincident.
                static constexpr float kMinOctaveSep = 1.0f / 12.0f; // ~1 semitone minimum
                bool isSplit = eqSplitMode.load (std::memory_order_relaxed);
                for (int i = 1; i < nXovers; ++i)
                {
                    // In split mode, skip spacing for gap band crossover pairs:
                    // xover[2k+1] (ptHi[k]) and xover[2k+2] (ptLo[k+1]) are deliberately
                    // coincident to collapse the gap band to zero width.
                    if (isSplit && (i % 2 == 0) && i >= 2)
                    {
                        // This is an even index (ptLo of next point) following an odd index
                        // (ptHi of prev point). They share the same divider frequency.
                        continue;
                    }
                    float minFreq = xoverFreqs[i - 1] * std::pow (2.0f, kMinOctaveSep);
                    if (xoverFreqs[i] < minFreq)
                        xoverFreqs[i] = juce::jlimit (20.0f, sr * 0.49f, minFreq);
                }

                // Set target crossover frequencies (smooth interpolation happens per-block below)
                for (int i = 0; i < nXovers; ++i)
                {
                    float freq = xoverFreqs[i];
                    bool wasInactive = ! crossovers[i].active;

                    if (std::abs (freq - crossovers[i].targetCutoffHz) > 0.1f || wasInactive)
                    {
                        crossovers[i].targetCutoffHz = freq;

                        if (wasInactive)
                        {
                            // Brand-new crossover: snap immediately (no state to interpolate from)
                            crossovers[i].cutoffHz = freq;
                            crossovers[i].reset();
                            // Prepare with snap (nSamples=1 → instant)
                            crossovers[i].prepare (sr, 1);
                            for (int lb = 0; lb < i; ++lb)
                                for (int ch2 = 0; ch2 < juce::jmin (numChannels, 2); ++ch2)
                                {
                                    allpassComp[i][lb][ch2].reset();
                                    allpassComp[i][lb][ch2].setTarget (freq, sr, 1);
                                    allpassComp[i][lb][ch2].snapToTarget();
                                }
                            // Fade ALL bands from silence when new crossover added.
                            // The remainder band also changes (now HP-filtered), so it
                            // needs fading too to prevent a click.
                            for (int fb = 0; fb < maxXoverBands; ++fb)
                                eqBandGain[fb] = 0.0f;
                        }
                    }
                    crossovers[i].active = true;
                }
                for (int i = nXovers; i < maxCrossovers; ++i)
                    crossovers[i].active = false;
            }

            // ── Crossover coefficient interpolation: set targets EVERY processBlock ──
            // SVF-based crossovers use per-sample coefficient interpolation.
            // Just set the target frequency — interpolation happens in the processing loop.
            {
                for (int i = 0; i < nXovers; ++i)
                {
                    if (! crossovers[i].active) continue;
                    float tgt = crossovers[i].targetCutoffHz;
                    crossovers[i].cutoffHz = tgt;
                    for (int ch2 = 0; ch2 < juce::jmin (numChannels, 2); ++ch2)
                        crossovers[i].filters[ch2].setTarget (tgt, sr, numSamples);
                    for (int lb = 0; lb < i; ++lb)
                        for (int ch2 = 0; ch2 < juce::jmin (numChannels, 2); ++ch2)
                            allpassComp[i][lb][ch2].setTarget (tgt, sr, numSamples);
                }
            }

            // ── Parametric EQ: read parameters for SVF per-sample processing ──
            // SVF TPT filters compute coefficients internally per-sample, so we just
            // read the parameters from atomics — no coefficient computation needed.
            float eqFreqs[maxEqBands], eqGains[maxEqBands], eqQs[maxEqBands];
            int   eqTypes[maxEqBands], eqStages[maxEqBands];
            bool  eqMuted[maxEqBands];
            {
                for (int i = 0; i < nPts; ++i)
                {
                    float freqBase = eqPoints[i].freqHz.load();
                    float gainBase = eqPoints[i].gainDB.load();
                    float qBase    = eqPoints[i].q.load();
                    if (eqPoints[i].modActive.load (std::memory_order_relaxed))
                    {
                        freqBase += eqPoints[i].modFreqHz.load (std::memory_order_relaxed);
                        gainBase += eqPoints[i].modGainDB.load (std::memory_order_relaxed);
                        qBase    += eqPoints[i].modQ.load (std::memory_order_relaxed);
                    }
                    float maxDB = eqDbRange.load();
                    float gain  = juce::jlimit (-maxDB, maxDB, gainBase) * (eqGlobalDepth.load() / 100.0f);

                    // Apply global warp to target gain
                    float warpVal = eqGlobalWarp.load();
                    if (std::abs (warpVal) > 0.5f)
                    {
                        float norm = (gain + maxDB) / (maxDB * 2.0f);
                        float w = warpVal / 100.0f;
                        if (w > 0.0f)
                        {
                            float mid = norm * 2.0f - 1.0f;
                            norm = 0.5f + 0.5f * std::tanh (w * 3.0f * mid) / std::tanh (w * 3.0f);
                        }
                        else
                        {
                            float aw = -w;
                            float c = norm * 2.0f - 1.0f;
                            float sv = c >= 0.0f ? 1.0f : -1.0f;
                            norm = 0.5f + 0.5f * sv * std::pow (std::abs (c), 1.0f / (1.0f + aw * 3.0f));
                        }
                        gain = -maxDB + norm * (maxDB * 2.0f);
                    }

                    // Apply global steps
                    int steps = eqGlobalSteps.load();
                    if (steps >= 2)
                    {
                        float stepSz = (maxDB * 2.0f) / (float)(steps - 1);
                        gain = std::round (gain / stepSz) * stepSz;
                    }

                    // Muted or preEq-off → passthrough (0 dB gain makes SVF bell/shelf = unity)
                    bool isMuted = eqPoints[i].mute.load() || !eqPoints[i].preEq.load();

                    eqFreqs[i]  = juce::jlimit (20.0f, sr * 0.49f, freqBase);
                    eqGains[i]  = isMuted ? 0.0f : gain;
                    eqQs[i]     = juce::jlimit (0.025f, 40.0f, qBase);
                    eqTypes[i]  = eqPoints[i].filterType.load();
                    eqStages[i] = juce::jlimit (1, maxBiquadStages, eqPoints[i].slope.load());
                    eqMuted[i]  = isMuted;
                    eqBiquadActive[i] = true;
                }
            }

            // ── Step 0: Apply parametric EQ SVFs with per-sample coefficient interpolation ──
            // Coefficients (g, k, a1c, a2c, a3c, A) are linearly interpolated per-sample.
            // Target coefficients computed ONCE per buffer (one tan/pow). Per-sample deltas
            // ensure coefficient changes are 1/nSamples of total → zero thumps at any frequency.
            // No parameter smoothing needed — the coefficient interpolation IS the smoothing.
            {
                auto processSVFs = [&](float** channelData, int nSamp, int nCh, float svfSR)
                {
                    for (int i = 0; i < nPts && i < maxEqBands; ++i)
                    {
                        if (! eqBiquadActive[i]) continue;
                        // For muted LP/HP/Notch: still process to keep SVF state warm,
                        // but output the original input (passthrough). This prevents
                        // a click when unmuting — the filter state is already primed.
                        bool muteBypass = eqMuted[i] && (eqTypes[i] == 1 || eqTypes[i] == 2 || eqTypes[i] == 3);

                        float freq = juce::jlimit (20.0f, svfSR * 0.49f, eqFreqs[i]);
                        float gain = eqGains[i];
                        float Q    = juce::jlimit (0.025f, 40.0f, eqQs[i]);
                        int   ft   = eqTypes[i];
                        int   ns   = eqStages[i];

                        // Set target coefficients + compute per-sample deltas (once per buffer)
                        for (int st = 0; st < ns; ++st)
                            for (int ch = 0; ch < juce::jmin (nCh, (int) maxEqChannels); ++ch)
                                eqBiquads[i][st][ch].setTarget (freq, gain, Q, ft, svfSR, nSamp);

                        // Per-sample: step coefficients, then tick audio
                        for (int ch = 0; ch < juce::jmin (nCh, (int) maxEqChannels); ++ch)
                        {
                            auto* samples = channelData[ch];
                            for (int s = 0; s < nSamp; ++s)
                            {
                                for (int st = 0; st < ns; ++st)
                                {
                                    eqBiquads[i][st][ch].step();
                                    float filtered = eqBiquads[i][st][ch].tick (samples[s]);
                                    if (! muteBypass)
                                        samples[s] = filtered;
                                    // When muteBypass: filter processes (keeping state warm)
                                    // but output stays as original input
                                }
                            }
                        }

                        // Snap to target at end of buffer (prevent floating-point drift)
                        for (int st = 0; st < ns; ++st)
                            for (int ch = 0; ch < juce::jmin (nCh, (int) maxEqChannels); ++ch)
                                eqBiquads[i][st][ch].snapToTarget();
                    }
                };

                if (eqOversamplerReady && eqOversampler)
                {
                    int osFactor = 1 << eqOversampleOrder;
                    float osSR = sr * osFactor;
                    juce::dsp::AudioBlock<float> inputBlock (buffer);
                    auto osBlock = eqOversampler->processSamplesUp (inputBlock);
                    int osNumSamples = (int) osBlock.getNumSamples();
                    int osNumChannels = (int) osBlock.getNumChannels();
                    float* osChannels[2] = { nullptr, nullptr };
                    for (int ch = 0; ch < juce::jmin (osNumChannels, 2); ++ch)
                        osChannels[ch] = osBlock.getChannelPointer ((size_t) ch);
                    processSVFs (osChannels, osNumSamples, osNumChannels, osSR);
                    eqOversampler->processSamplesDown (inputBlock);
                }
                else
                {
                    float* channels[2] = { nullptr, nullptr };
                    for (int ch = 0; ch < juce::jmin (numChannels, 2); ++ch)
                        channels[ch] = buffer.getWritePointer (ch);
                    processSVFs (channels, numSamples, numChannels, sr);
                }
            }

            // ── Step 0.5: Post-EQ tilt filter ──
            // 1st-order LP/HP split at 632Hz pivot. Low band gets gainLow, high band gets gainHigh.
            // This tilts the entire combined EQ curve uniformly, matching the JS visual.
            // +tilt = boost highs / cut lows, -tilt = boost lows / cut highs.
            {
                float tiltVal = eqGlobalTilt.load();
                // Compute tilt gains: symmetric in dB around pivot
                // JS: tiltDB = logPos * (tiltVal/100) * 12, logPos ≈ ±5 at 20Hz/20kHz.
                // 1st-order filter asymptotes to gainLow/gainHigh well below/above fc.
                float tiltDB = (tiltVal / 100.0f) * 12.0f; // max ±12dB at frequency extremes
                float gainLowTarget  = std::pow (10.0f, -tiltDB / 20.0f);
                float gainHighTarget = std::pow (10.0f,  tiltDB / 20.0f);

                // 1st-order LP coefficient: alpha = 1 - exp(-2π * fc / sr)
                float tiltSR = (float) currentSampleRate;
                float tiltAlpha = 1.0f - std::exp (-2.0f * juce::MathConstants<float>::pi * 632.0f / tiltSR);

                int tiltChans = juce::jmin (numChannels, 2);
                for (int ch = 0; ch < tiltChans; ++ch)
                {
                    auto* samples = buffer.getWritePointer (ch);
                    float lpState = tiltLpState[ch];
                    float gLow  = tiltGainLowCur[ch];
                    float gHigh = tiltGainHighCur[ch];

                    // Per-sample gain smoothing: ~5ms time constant
                    float smoothCoeff = 1.0f - std::exp (-1.0f / (tiltSR * 0.005f));

                    for (int s = 0; s < numSamples; ++s)
                    {
                        gLow  += smoothCoeff * (gainLowTarget  - gLow);
                        gHigh += smoothCoeff * (gainHighTarget - gHigh);

                        float x = samples[s];
                        lpState += tiltAlpha * (x - lpState);
                        float hp = x - lpState;
                        samples[s] = lpState * gLow + hp * gHigh;
                    }

                    tiltLpState[ch]      = lpState;
                    tiltGainLowCur[ch]   = gLow;
                    tiltGainHighCur[ch]  = gHigh;
                }
            }

            int nBands = numEqBands; // 2*nPts + 1

            // Check if any plugins actually need band routing.
            // If none → skip the entire crossover/band-split/route/sum section.
            // The crossovers use JUCE LinkwitzRiley (DFII biquads) which produce
            // low-frequency thumps when cutoff frequencies change. By skipping when
            // not needed, the SVF-processed buffer passes straight to output.
            bool needsBandSplit = false;
            {
                for (auto& hp : hostedPlugins)
                {
                    if (! hp->instance || ! hp->prepared || hp->bypassed || hp->crashed) continue;
                    int plugBusId = hp->busId;
                    for (int si = 0; si < nPts; ++si)
                    {
                        int origIdx = eqSortOrder[si].load();
                        if (origIdx >= 0 && origIdx < maxEqBands)
                        {
                            int ptBus = eqPoints[origIdx].busId.load();
                            if (ptBus >= 0 && ptBus == plugBusId)
                            { needsBandSplit = true; break; }
                        }
                    }
                    if (needsBandSplit) break;
                }
            }

            if (needsBandSplit)
            {

            // ── Step 1: Cascaded Linkwitz-Riley band splitting with allpass compensation ──
            // remaining = input; for each crossover: band[i] = LP(remaining), remaining = HP(remaining)
            // After each split, compensate ALL lower bands with the allpass at this crossover freq.
            // This ensures every band has identical group delay → transparent reconstruction.
            int remIdx = nBands - 1;
            for (int ch = 0; ch < juce::jmin (numChannels, eqBandBuffers[remIdx].getNumChannels()); ++ch)
                eqBandBuffers[remIdx].copyFrom (ch, 0, buffer, ch, 0, numSamples);

            for (int i = 0; i < nXovers && i < maxCrossovers - 1; ++i)
            {
                if (! crossovers[i].active) continue;

                for (int ch = 0; ch < juce::jmin (numChannels, eqBandBuffers[i].getNumChannels()); ++ch)
                    eqBandBuffers[i].copyFrom (ch, 0, eqBandBuffers[remIdx], ch, 0, numSamples);

                // Per-sample SVF crossover: step coefficients, then tick LP/HP
                int nCh = juce::jmin (numChannels, 2);
                for (int s = 0; s < numSamples; ++s)
                {
                    for (int ch = 0; ch < nCh; ++ch)
                    {
                        crossovers[i].filters[ch].step();
                        float in = eqBandBuffers[remIdx].getSample (ch, s);
                        float lp, hp;
                        crossovers[i].filters[ch].tick (in, lp, hp);
                        eqBandBuffers[i].setSample (ch, s, lp);
                        eqBandBuffers[remIdx].setSample (ch, s, hp);
                    }
                }
                // Snap to target at end of buffer
                for (int ch = 0; ch < nCh; ++ch)
                    crossovers[i].filters[ch].snapToTarget();

                // ── Allpass phase compensation for all lower bands ──
                for (int lb = 0; lb < i; ++lb)
                {
                    for (int s = 0; s < numSamples; ++s)
                    {
                        for (int ch = 0; ch < nCh; ++ch)
                        {
                            allpassComp[i][lb][ch].step();
                            float in = eqBandBuffers[lb].getSample (ch, s);
                            eqBandBuffers[lb].setSample (ch, s, allpassComp[i][lb][ch].tickAllpass (in));
                        }
                    }
                    for (int ch = 0; ch < nCh; ++ch)
                        allpassComp[i][lb][ch].snapToTarget();
                }
            }

            // ── Step 1.5: M/S encode point bands that need it ──
            // Point bands are odd: band = 2*sortedIdx + 1
            // Skip muted bands — avoids M/S encoding without corresponding decode.
            // Zero the unneeded channel BEFORE plugins (Mid-only → zero Side, Side-only → zero Mid).
            // This ensures plugins only receive the selected component.
            if (numChannels >= 2)
            {
                for (int si = 0; si < nPts; ++si)
                {
                    int b = si * 2 + 1; // point band index
                    if (b >= nBands) break;
                    int origIdx = eqSortOrder[si].load();
                    if (origIdx < 0 || origIdx >= maxEqBands) continue;
                    if (eqPoints[origIdx].mute.load()) continue; // muted: skip M/S
                    int sm = eqPoints[origIdx].stereoMode.load();
                    if (sm == 0) continue; // stereo, no encode needed

                    auto* L = eqBandBuffers[b].getWritePointer (0);
                    auto* R = eqBandBuffers[b].getWritePointer (1);
                    for (int s = 0; s < numSamples; ++s)
                    {
                        float mid  = (L[s] + R[s]) * 0.5f;
                        float side = (L[s] - R[s]) * 0.5f;
                        L[s] = mid;
                        R[s] = side;
                    }

                    // Zero the unneeded component BEFORE plugin processing
                    if (sm == 1) // Mid-only: zero Side channel
                    {
                        for (int s = 0; s < numSamples; ++s)
                            R[s] = 0.0f;
                    }
                    else // Side-only: zero Mid channel
                    {
                        for (int s = 0; s < numSamples; ++s)
                            L[s] = 0.0f;
                    }
                }
            }

            // ── Step 2: Solo/mute and route plugins to assigned bands ──
            // Pro-Q 4 semantics:
            //   Mute = bypass the filter (skip plugin processing, but audio passes through)
            //   Solo = bandpass isolation (silence all non-soloed bands)
            // Separate arrays: bandMuted[] for plugin skip, bandSilenced[] for summation.
            bool  bandMuted[maxXoverBands] = {};    // muted bands: skip plugins, but audio passes through
            bool  bandSilenced[maxXoverBands] = {}; // silenced bands: audio removed from output (solo)
            bool  anySolo = false;
            bool  bandSoloed[maxXoverBands] = {};

            for (int si = 0; si < nPts; ++si)
            {
                int b = si * 2 + 1; // point band index
                if (b >= nBands) break;
                int origIdx = eqSortOrder[si].load();
                if (origIdx >= 0 && origIdx < maxEqBands)
                {
                    if (eqPoints[origIdx].solo.load()) { bandSoloed[b] = true; anySolo = true; }
                    if (eqPoints[origIdx].mute.load()) bandMuted[b] = true;
                }
            }
            // Solo: silence all non-soloed bands (including gaps)
            if (anySolo)
            {
                for (int b = 0; b < nBands; ++b)
                    if (! bandSoloed[b]) bandSilenced[b] = true;
            }

            // Process plugins on their assigned bands
            // Skip if band is muted (bypass) or silenced (solo isolation)
            for (auto& hp : hostedPlugins)
            {
                if (! hp->instance || ! hp->prepared || hp->bypassed || hp->crashed) continue;
                int plugBusId = hp->busId;

                int targetBand = -1;
                for (int si = 0; si < nPts; ++si)
                {
                    int origIdx = eqSortOrder[si].load();
                    if (origIdx >= 0 && origIdx < maxEqBands)
                    {
                        int ptBus = eqPoints[origIdx].busId.load();
                        if (ptBus >= 0 && ptBus == plugBusId)
                        {
                            targetBand = si * 2 + 1; // point band = odd index
                            break;
                        }
                    }
                }
                // If no matching eqPoint found, plugin has no valid band
                if (targetBand < 0 || targetBand >= nBands) continue;
                // Skip plugins on muted or silenced bands
                if (bandMuted[targetBand] || bandSilenced[targetBand]) continue;

                // Plugin processes its assigned band
                processOnePlugin (*hp, eqBandBuffers[targetBand]);
            }

            // ── Step 2.5: M/S decode point bands back to L/R ──
            // Skip for muted bands (they weren't encoded in Step 1.5).
            // Channel zeroing already happened in Step 1.5 (before plugins),
            // so we just need to convert M/S → L/R.
            if (numChannels >= 2)
            {
                for (int si = 0; si < nPts; ++si)
                {
                    int b = si * 2 + 1;
                    if (b >= nBands) break;
                    if (bandMuted[b]) continue; // muted: wasn't encoded
                    int origIdx = eqSortOrder[si].load();
                    if (origIdx < 0 || origIdx >= maxEqBands) continue;
                    int sm = eqPoints[origIdx].stereoMode.load();
                    if (sm == 0) continue; // stereo: no decode needed

                    auto* chM = eqBandBuffers[b].getWritePointer (0);
                    auto* chS = eqBandBuffers[b].getWritePointer (1);

                    // M/S → L/R: Left = Mid + Side, Right = Mid - Side
                    for (int s = 0; s < numSamples; ++s)
                    {
                        float left  = chM[s] + chS[s];
                        float right = chM[s] - chS[s];
                        chM[s] = left;
                        chS[s] = right;
                    }
                }
            }

            // ── Step 3: Sum all bands with per-sample gain smoothing ──
            // Smoothed gain ramp prevents clicks on solo/mute transitions.
            // eqBandGain[b] approaches target (0.0 or 1.0) at ~3ms ramp.
            static constexpr float kBandGainRamp = 1.0f / 512.0f; // 512 samples ≈ 11ms at 44.1kHz
            buffer.clear();
            for (int b = 0; b < nBands; ++b)
            {
                float targetGain = bandSilenced[b] ? 0.0f : 1.0f;
                float currentGain = eqBandGain[b];

                if (std::abs (currentGain - targetGain) < 0.001f)
                {
                    // Already at target — fast path
                    currentGain = targetGain;
                    eqBandGain[b] = targetGain;
                    if (targetGain < 0.001f) continue; // fully silent, skip

                    for (int ch = 0; ch < numChannels; ++ch)
                        buffer.addFrom (ch, 0, eqBandBuffers[b], ch, 0, numSamples);
                }
                else
                {
                    // Ramping — per-sample gain interpolation
                    for (int ch = 0; ch < numChannels; ++ch)
                    {
                        auto* dst = buffer.getWritePointer (ch);
                        auto* src = eqBandBuffers[b].getReadPointer (ch);
                        float g = currentGain;
                        for (int s = 0; s < numSamples; ++s)
                        {
                            // Linear ramp toward target
                            if (g < targetGain)
                                g = juce::jmin (g + kBandGainRamp, targetGain);
                            else if (g > targetGain)
                                g = juce::jmax (g - kBandGainRamp, targetGain);
                            dst[s] += src[s] * g;
                        }
                        if (ch == 0) eqBandGain[b] = g; // store final gain after first channel
                    }
                }
            }

            // ── Step 4: Global post-EQ plugins (unassigned to any band) ──
            // When eqUnassignedMode == 1, plugins not matched to any EQ point
            // process the full summed signal sequentially as master inserts.
            if (eqUnassignedMode.load (std::memory_order_relaxed) == 1)
            {
                for (auto& hp : hostedPlugins)
                {
                    if (! hp->instance || ! hp->prepared || hp->bypassed || hp->crashed) continue;
                    int plugBusId = hp->busId;

                    // Check if this plugin is assigned to any EQ band
                    bool assigned = false;
                    for (int si = 0; si < nPts; ++si)
                    {
                        int origIdx = eqSortOrder[si].load();
                        if (origIdx >= 0 && origIdx < maxEqBands)
                        {
                            int ptBus = eqPoints[origIdx].busId.load();
                            if (ptBus >= 0 && ptBus == plugBusId) { assigned = true; break; }
                        }
                    }
                    if (assigned) continue; // already processed in Step 2

                    // Unassigned: process on the full summed buffer (post-EQ global insert)
                    processOnePlugin (*hp, buffer);
                }
            }

            } // end needsBandSplit
            else
            {
                // No band routing needed — SVF output goes straight to buffer.
                // Process all plugins as serial inserts on the full buffer.
                for (auto& hp : hostedPlugins)
                {
                    if (! hp->instance || ! hp->prepared || hp->bypassed || hp->crashed) continue;
                    processOnePlugin (*hp, buffer);
                }
            }

        } // end WrongEQ else block
    }
    else
    {
        // PARALLEL: group by busId, process each bus independently, sum outputs
        int numChannels = buffer.getNumChannels();
        int numSamples  = buffer.getNumSamples();

        // Discover which buses are active (have at least one non-skipped plugin)
        bool busActive[maxBuses] = {};
        bool busHasSynth[maxBuses] = {}; // true if first active plugin on bus is an instrument
        for (auto& hp : hostedPlugins)
        {
            int b = juce::jlimit (0, maxBuses - 2, hp->busId); // clamp, reserve last for rollback
            if (hp->instance && hp->prepared && !hp->bypassed && !hp->crashed)
            {
                if (! busActive[b] && hp->isInstrument)
                    busHasSynth[b] = true; // first active plugin on this bus is a synth
                busActive[b] = true;
            }
        }

        // Check if any bus has solo enabled
        bool anySolo = false;
        for (int i = 0; i < maxBuses - 1; ++i)
            if (busActive[i] && busSolo[i].load()) anySolo = true;

        // Count effective buses (after mute/solo filtering)
        int effectiveBusCount = 0;
        for (int i = 0; i < maxBuses - 1; ++i)
        {
            if (! busActive[i]) continue;
            if (busMute[i].load()) continue;
            if (anySolo && ! busSolo[i].load()) continue;
            effectiveBusCount++;
        }

        if (effectiveBusCount <= 1)
        {
            // Only one effective bus (or none) — process sequentially, no split/sum overhead
            // If the bus starts with a synth, zero the buffer first
            int activeBusIdx = -1;
            for (int i = 0; i < maxBuses - 1; ++i)
            {
                if (busActive[i] && !busMute[i].load() && (!anySolo || busSolo[i].load()))
                { activeBusIdx = i; break; }
            }
            if (activeBusIdx >= 0 && busHasSynth[activeBusIdx])
                buffer.clear();

            for (auto& hp : hostedPlugins)
            {
                int b = juce::jlimit (0, maxBuses - 2, hp->busId);
                if (busMute[b].load()) continue;
                if (anySolo && ! busSolo[b].load()) continue;
                processOnePlugin (*hp, buffer);
            }
            // Apply bus volume for the single active bus
            if (effectiveBusCount == 1)
            {
                for (int i = 0; i < maxBuses - 1; ++i)
                {
                    if (! busActive[i]) continue;
                    if (busMute[i].load()) continue;
                    if (anySolo && ! busSolo[i].load()) continue;
                    float vol = busVolume[i].load();
                    if (std::abs (vol - 1.0f) > 0.001f)
                        buffer.applyGain (vol);
                    break;
                }
            }
        }
        else
        {
            // Initialize each active bus buffer:
            // - Synth buses: zeroed (synths generate from MIDI)
            // - FX buses: copy of input audio (effects process it)
            for (int b = 0; b < maxBuses - 1; ++b)
            {
                if (! busActive[b]) continue;
                if (busMute[b].load()) continue;
                if (anySolo && ! busSolo[b].load()) continue;

                if (busHasSynth[b])
                {
                    // Synth bus: zero the buffer — synth will generate from MIDI
                    for (int ch = 0; ch < juce::jmin (numChannels, busBuffers[b].getNumChannels()); ++ch)
                        busBuffers[b].clear (ch, 0, numSamples);
                }
                else
                {
                    // FX bus: copy input audio for processing
                    for (int ch = 0; ch < juce::jmin (numChannels, busBuffers[b].getNumChannels()); ++ch)
                        busBuffers[b].copyFrom (ch, 0, buffer, ch, 0, numSamples);
                }
            }

            // Process each bus's plugin chain
            for (auto& hp : hostedPlugins)
            {
                int b = juce::jlimit (0, maxBuses - 2, hp->busId);
                if (busMute[b].load()) continue;
                if (anySolo && ! busSolo[b].load()) continue;
                processOnePlugin (*hp, busBuffers[b]);
            }

            // Sum all active bus outputs into main buffer — UNITY GAIN
            // Each bus applies its own volume. No automatic gain compensation.
            buffer.clear();
            for (int b = 0; b < maxBuses - 1; ++b)
            {
                if (! busActive[b]) continue;
                if (busMute[b].load()) continue;
                if (anySolo && ! busSolo[b].load()) continue;
                float vol = busVolume[b].load();
                for (int ch = 0; ch < numChannels; ++ch)
                    buffer.addFrom (ch, 0, busBuffers[b], ch, 0, numSamples, vol);
            }
        }
    }

    // ── Snapshot hosted param values → proxy cache (lock-free atomic writes) ──
    // Audio thread writes to atomic cache; message thread timer reads + calls setValueNotifyingHost.
    // This avoids calling setValueNotifyingHost on the audio thread (Rule 6).
    if (++proxySyncCounter >= 4)
    {
        proxySyncCounter = 0;
        bool anyDirty = false;
        for (int i = 0; i < proxyParamCount; ++i)
        {
            auto& m = proxyMap[i];
            if (! m.isPlugin() || proxyParams[i] == nullptr) continue;

            for (auto& hp : hostedPlugins)
            {
                if (hp->id == m.pluginId && hp->instance)
                {
                    auto& params = hp->instance->getParameters();
                    if (m.paramIndex >= 0 && m.paramIndex < (int) params.size())
                    {
                        float hosted = params[m.paramIndex]->getValue();
                        if (std::abs (hosted - proxyParams[i]->get()) > 0.0001f)
                        {
                            proxyValueCache[i].store (hosted, std::memory_order_relaxed);
                            anyDirty = true;
                        }
                    }
                    break;
                }
            }
        }
        if (anyDirty)
            proxyDirty.store (true, std::memory_order_release);
    }

    // Apply dry/wet mix
    if (needsDryMix)
    {
        float dry = 1.0f - wet;
        int mixChannels = juce::jmin (mainBusChannels, dryBuffer.getNumChannels());
        int mixSamples  = juce::jmin (buffer.getNumSamples(),  dryBuffer.getNumSamples());
        for (int ch = 0; ch < mixChannels; ++ch)
        {
            auto* wetData = buffer.getWritePointer (ch);
            auto* dryData = dryBuffer.getReadPointer (ch);
            for (int s = 0; s < mixSamples; ++s)
                wetData[s] = dryData[s] * dry + wetData[s] * wet;
        }
    }
}
