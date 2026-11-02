// EqInternalMod.cpp — the WrongEQ's own modulation: gain LFO, drift (frequency sweep +
// continuous gain noise) and Q mod.
//
// This used to be computed by the editor (wrongeq_canvas.js weqAnimTick) and pushed to
// the audio as offsets, so it only moved while the editor was open, froze when it closed
// and never rendered offline. It now runs here, once per block on the audio thread, and
// the editor only DRAWS it, following the clocks published by getEqModGainPhase() /
// getEqModDriftTime().
//
// The maths is a line-for-line port of the JS (shapes, textures, hash noise, seeds), so
// keep the two in step: weqAnimTick, WEQ_LFO_SHAPES, WEQ_QMOD_SHAPES, _weqDriftEval,
// _weqHashI, _weqSmoothNoise.

#include "PluginProcessor.h"

namespace
{
// _weqHashI(): integer hash → [-1, 1)
double hashI (double n)
{
    if (! std::isfinite (n)) n = 0.0;
    auto h = (uint32_t) (int32_t) (int64_t) n;
    h = (h >> 16) ^ h; h *= 0x45d9f3bu;
    h = (h >> 16) ^ h; h *= 0x45d9f3bu;
    h = (h >> 16) ^ h;
    return (double) (h & 0xFFFFu) / 32768.0 - 1.0;
}

// _weqSmoothNoise(): Hermite-interpolated value noise
double smoothNoise (double phase)
{
    const double i0 = std::floor (phase);
    const double frac = phase - i0;
    const double v0 = hashI (i0 - 1), v1 = hashI (i0), v2 = hashI (i0 + 1), v3 = hashI (i0 + 2);
    const double a = -0.5 * v0 + 1.5 * v1 - 1.5 * v2 + 0.5 * v3;
    const double b = v0 - 2.5 * v1 + 2.0 * v2 - 0.5 * v3;
    const double c = -0.5 * v0 + 0.5 * v2;
    return ((a * frac + b) * frac + c) * frac + v1;
}

constexpr double twoPi = juce::MathConstants<double>::twoPi;
constexpr double pi = juce::MathConstants<double>::pi;

double jsMod1 (double p) { return std::fmod (p, 1.0); }      // JS `p % 1`
double jsRound (double x) { return std::floor (x + 0.5); }   // Math.round

// WEQ_LFO_SHAPES — index order matches kGainShapes below
double gainShape (int shape, double p)
{
    switch (shape)
    {
        case 1:  return 1.0 - 4.0 * std::abs (jsMod1 (p + 0.25) - 0.5);                  // tri
        case 2:  return 2.0 * jsMod1 (p) - 1.0;                                          // saw
        case 3:  return 1.0 - 2.0 * jsMod1 (p);                                          // sawdn
        case 4:  return jsMod1 (p) < 0.5 ? 1.0 : -1.0;                                   // square
        case 5:  return jsMod1 (p) < 0.25 ? 1.0 : -1.0;                                  // pulse
        case 6:  return std::tanh (std::sin (p * twoPi) * 2.5) / std::tanh (2.5);        // tanhsat
        case 7:  return std::abs (std::sin (p * twoPi)) * 2.0 - 1.0;                     // rectified
        case 8:  return std::sin (p * twoPi) + 0.3 * std::sin (p * pi * 4.0);            // harm2
        case 9:  return jsRound (std::sin (p * twoPi) * 4.0) / 4.0;                      // steps4
        case 10: return jsRound (std::sin (p * twoPi) * 8.0) / 8.0;                      // steps8
        case 11: return hashI (std::floor (p * 4.0) * 73.0 + 17.0);                      // sah
        case 12: return smoothNoise (p * 4.0);                                           // noise
        case 13: return smoothNoise (p * 3.0) * 0.5 + smoothNoise (p * 7.3 + 3.1) * 0.3  // multilayer
                        + hashI (std::floor (p * 6.0) * 41.0) * 0.2;
        case 14: { const double s = std::sin (p * twoPi); return s * s * s; }            // cubic
        default: return std::sin (p * twoPi);                                            // sine
    }
}

// WEQ_QMOD_SHAPES — index order matches kQShapes below
double qShape (int shape, double p, double s)
{
    const double t = jsMod1 (p);
    switch (shape)
    {
        case 1:  return 2.0 * std::abs (2.0 * t - 1.0) - 1.0;                            // tri
        case 2:  return 2.0 * t - 1.0;                                                   // saw
        case 3:  return t < 0.5 ? 1.0 : -1.0;                                            // square
        case 4:  return t < 0.1 ? std::sin (t / 0.1 * pi) : 0.0;                         // pulse
        case 5:  return smoothNoise (p * 1.7 + s * 3.1) * 0.6 + smoothNoise (p * 4.3 + s * 7.7) * 0.4; // noise
        case 6:  return hashI (std::floor (p * 4.0) * 17.0 + s) * 2.0 - 1.0;             // steps
        case 7:  return hashI (std::floor (p * 8.0) * 31.0 + s) * 2.0 - 1.0;             // scatter
        case 8:  return std::pow (std::sin (t * pi), 3.0);                               // breathe
        case 9:  return std::abs (std::sin (t * pi * 6.0)) * 2.0 - 1.0;                  // comb
        case 10: return (std::fmod (std::floor (p), 4.0) / 3.0) * std::abs (std::sin (t * twoPi)); // ratchet
        case 11: return std::sin (p * twoPi) * 0.6 + std::sin (p * pi * 5.3 + s) * 0.4;  // formant
        default: return std::sin (p * twoPi);                                            // sine
    }
}

// _weqDriftEval()
double driftEval (int texture, double p, double seed)
{
    switch (texture)
    {
        case 0: return std::sin (p * twoPi) * 0.7 + std::sin (p * twoPi * 2.17 + 1.3) * 0.3;            // smooth
        case 1: return smoothNoise (p * 2.0 + seed * 0.1) * 0.6 + smoothNoise (p * 0.7 + seed * 0.3) * 0.4; // wander
        case 2: return smoothNoise (p * 9.3 + seed) * 0.4 + smoothNoise (p * 17.0 + seed * 2.0) * 0.35  // jitter
                       + hashI (std::floor (p * 12.0) * 41.0 + seed) * 0.25;
        case 3: return smoothNoise (p * 1.5 + seed * 0.7) * 0.5 + smoothNoise (p * 3.7 + seed * 1.3) * 0.3 // drunk
                       + smoothNoise (p * 0.4 + seed * 2.1) * 0.2;
        case 4:                                                                                          // stutter
        {
            const double stepIdx = std::floor (p * 6.0);
            const double stepVal = hashI (stepIdx * 73.0 + seed * 11.0);
            const double nextVal = hashI ((stepIdx + 1.0) * 73.0 + seed * 11.0);
            const double stepFrac = p * 6.0 - stepIdx;
            const double glide = stepFrac < 0.15 ? stepFrac / 0.15 : 1.0;
            const double eased = 1.0 - std::pow (1.0 - glide, 3.0);
            return stepVal + (nextVal - stepVal) * eased;
        }
        case 5: return smoothNoise (p * 4.0 + seed) * 0.3 + smoothNoise (p * 9.3 + seed + 5.7) * 0.25    // chaos
                       + smoothNoise (p * 17.1 + seed + 11.2) * 0.2
                       + hashI (std::floor (p * 8.0) * 31.0 + seed) * 0.15
                       + std::sin (p * pi * 2.0 * 3.14 + seed) * 0.1;
        default: return std::sin (p * twoPi);
    }
}

const char* const kGainShapes[] = { "sine", "tri", "saw", "sawdn", "square", "pulse", "tanhsat", "rectified",
                                    "harm2", "steps4", "steps8", "sah", "noise", "multilayer", "cubic" };
const char* const kQShapes[] = { "sine", "tri", "saw", "square", "pulse", "noise", "steps", "scatter",
                                 "breathe", "comb", "ratchet", "formant" };
const char* const kDriftTextures[] = { "smooth", "wander", "jitter", "drunk", "stutter", "chaos" };

template <size_t N>
int indexOf (const char* const (&names)[N], const juce::String& name, int fallback)
{
    for (size_t i = 0; i < N; ++i)
        if (name == names[i]) return (int) i;
    return fallback;
}

// Sync divisions (_weqSyncDivToHz BEAT_MAP) and drift scale (DS_BEAT_MAP), in beats
float syncDivBeats (const juce::String& div)
{
    static const std::pair<const char*, float> map[] = {
        { "1/16", 0.25f }, { "1/8", 0.5f }, { "1/4", 1.0f }, { "1/2", 2.0f },
        { "1/1", 4.0f }, { "2/1", 8.0f }, { "4/1", 16.0f }, { "8/1", 32.0f } };
    for (auto& m : map) if (div == m.first) return m.second;
    return 1.0f;
}

float driftScaleBeats (const juce::String& div)
{
    static const std::pair<const char*, float> map[] = {
        { "1/16", 0.25f }, { "1/8", 0.5f }, { "1/4", 1.0f }, { "1/2", 2.0f }, { "1/1", 4.0f },
        { "2/1", 8.0f }, { "4/1", 16.0f }, { "8/1", 32.0f }, { "16/1", 64.0f }, { "32/1", 128.0f } };
    for (auto& m : map) if (div == m.first) return m.second;
    return 4.0f;
}

// _weqGainZoneScale / _weqDriftZoneScale / _weqQZoneScale: hard cut outside the zone
bool inZone (float freq, float lo, float hi)
{
    if (lo <= 20.0f && hi >= 20000.0f) return true;
    if (lo > 20.0f && freq < lo) return false;
    if (hi < 20000.0f && freq > hi) return false;
    return true;
}
} // namespace

//==============================================================================
void HostesaAudioProcessor::parseEqInternalModSettings (const juce::DynamicObject& eq)
{
    auto& s = eqIntMod;
    // Bad values (NaN, strings, inf) are ignored: one non-finite offset would poison the
    // EQ filters' state until reload.
    auto f = [&] (const char* key, std::atomic<float>& dst)
    {
        if (! eq.hasProperty (key)) return;
        const auto v = (double) eq.getProperty (key);
        if (std::isfinite (v)) dst.store ((float) v);
    };
    auto b = [&] (const char* key, std::atomic<bool>& dst)
    {
        if (eq.hasProperty (key)) dst.store ((bool) eq.getProperty (key));
    };

    b ("modEnabled", s.enabled);
    f ("animSpeed", s.gainSpeedHz);
    f ("animDepth", s.gainDepthDB);
    f ("animSpread", s.gainSpread);
    if (eq.hasProperty ("animShape"))  s.gainShape.store (indexOf (kGainShapes, eq.getProperty ("animShape").toString(), 0));
    b ("gainSync", s.gainSync);
    if (eq.hasProperty ("gainSyncDiv")) s.gainSyncBeats.store (syncDivBeats (eq.getProperty ("gainSyncDiv").toString()));
    f ("drift", s.drift);
    f ("driftRange", s.driftRange);
    if (eq.hasProperty ("driftScale"))  s.driftPeriodSec.store (driftScaleBeats (eq.getProperty ("driftScale").toString()) * 0.5f);
    b ("driftContinuous", s.driftContinuous);
    if (eq.hasProperty ("driftTexture")) s.driftTexture.store (indexOf (kDriftTextures, eq.getProperty ("driftTexture").toString(), -1));
    f ("gainLoCut", s.gainLoCut);
    f ("gainHiCut", s.gainHiCut);
    f ("driftLoCut", s.driftLoCut);
    f ("driftHiCut", s.driftHiCut);
    f ("qModSpeed", s.qSpeedHz);
    f ("qModDepth", s.qDepth);
    f ("qModSpread", s.qSpread);
    if (eq.hasProperty ("qModShape"))  s.qShape.store (indexOf (kQShapes, eq.getProperty ("qModShape").toString(), 0));
    b ("qSync", s.qSync);
    if (eq.hasProperty ("qSyncDiv"))   s.qSyncBeats.store (syncDivBeats (eq.getProperty ("qSyncDiv").toString()));
    f ("qLoCut", s.qLoCut);
    f ("qHiCut", s.qHiCut);
    if (eq.hasProperty ("syncSource")) s.syncInternal.store (eq.getProperty ("syncSource").toString() == "internal");
    f ("internalBpm", s.internalBpm);

    // Per-point settings, indexed like eqPoints (the editor's point order)
    if (auto* pts = eq.getProperty ("points").getArray())
    {
        for (int i = 0; i < juce::jmin (pts->size(), (int) maxEqBands); ++i)
        {
            const auto& pt = pts->getReference (i);
            auto depth = [&] (const char* key)
            {
                auto v = pt.getProperty (key, {});
                const auto d = v.isVoid() ? 100.0 : (double) v; // _weqPtDepth(): missing = 100
                return std::isfinite (d) ? (float) d : 100.0f;
            };
            eqPoints[i].modExclude.store ((int) pt.getProperty ("modExclude", 0));
            eqPoints[i].modGainDepth.store (depth ("modGainDepth"));
            eqPoints[i].modDriftDepth.store (depth ("modDriftDepth"));
            eqPoints[i].modQDepth.store (depth ("modQDepth"));
        }
    }
}

//==============================================================================
void HostesaAudioProcessor::advanceEqInternalMod (int nPts, int numSamples)
{
    auto& s = eqIntMod;
    const float gainSpeed  = s.gainSpeedHz.load (std::memory_order_relaxed);
    const float gainDepth  = s.gainDepthDB.load (std::memory_order_relaxed);
    const bool  gainSync   = s.gainSync.load (std::memory_order_relaxed);
    const float drift      = s.drift.load (std::memory_order_relaxed);
    const float driftRange = s.driftRange.load (std::memory_order_relaxed);
    const bool  driftCont  = s.driftContinuous.load (std::memory_order_relaxed);
    const float qSpeed     = s.qSpeedHz.load (std::memory_order_relaxed);
    const float qDepth     = s.qDepth.load (std::memory_order_relaxed);
    const bool  qSync      = s.qSync.load (std::memory_order_relaxed);

    const bool   hasSine  = gainSpeed > 0.0f || (gainSync && gainDepth > 0.0f);
    const double driftAmt = std::abs (drift) / 50.0;
    const double driftRangeNorm = driftRange / 100.0;
    const bool   hasDrift = driftAmt > 0.001 && driftRangeNorm > 0.001;
    const bool   hasCont  = driftCont && driftRangeNorm > 0.001;
    const bool   hasQMod  = (qSpeed > 0.0f || qSync) && qDepth > 0.0f;

    auto clearOffsets = [this]
    {
        for (int i = 0; i < maxEqBands; ++i)
            if (eqPoints[i].uiModActive.load (std::memory_order_relaxed))
            {
                eqPoints[i].uiModActive.store (false, std::memory_order_relaxed);
                eqPoints[i].uiModFreqHz.store (0.0f, std::memory_order_relaxed);
                eqPoints[i].uiModGainDB.store (0.0f, std::memory_order_relaxed);
                eqPoints[i].uiModQ.store (0.0f, std::memory_order_relaxed);
            }
    };

    if (! s.enabled.load (std::memory_order_relaxed) || ! (hasSine || hasDrift || hasCont || hasQMod))
    {
        // weqAnimStop(): clocks restart from zero next time modulation is switched on
        eqIntModGainPhase = 0.0;
        eqIntModDriftTime = 0.0;
        eqIntModGainPhaseOut.store (0.0, std::memory_order_relaxed);
        eqIntModDriftTimeOut.store (0.0, std::memory_order_relaxed);
        clearOffsets();
        return;
    }

    // Tempo for synced rates (_weqSyncBpm)
    double bpm = s.syncInternal.load (std::memory_order_relaxed)
                     ? (double) s.internalBpm.load (std::memory_order_relaxed)
                     : currentBpm.load (std::memory_order_relaxed);
    if (! std::isfinite (bpm) || bpm <= 0.0) bpm = 120.0;
    const double gainRate = gainSync ? (bpm / 60.0) / s.gainSyncBeats.load (std::memory_order_relaxed) : gainSpeed;
    const double qRate    = qSync    ? (bpm / 60.0) / s.qSyncBeats.load (std::memory_order_relaxed)    : qSpeed;

    // Advance the clocks
    const double dt = (double) numSamples / juce::jmax (1.0, currentSampleRate);
    if (hasSine && std::isfinite (gainRate))
    {
        eqIntModGainPhase += dt * gainRate;
        if (eqIntModGainPhase > 1.0) eqIntModGainPhase -= std::floor (eqIntModGainPhase);
    }
    eqIntModDriftTime += dt;
    eqIntModGainPhaseOut.store (eqIntModGainPhase, std::memory_order_relaxed);
    eqIntModDriftTimeOut.store (eqIntModDriftTime, std::memory_order_relaxed);

    if (nPts <= 0) { clearOffsets(); return; }

    // Drift sweep rate (cycles/s) and width (octaves)
    double driftSweepRate = 0.0, driftSweepWidth = 0.0;
    if (hasDrift || hasCont)
    {
        driftSweepRate = (hasDrift ? (0.05 + driftAmt * 1.95) : 0.15) / s.driftPeriodSec.load (std::memory_order_relaxed);
        driftSweepWidth = (driftRange / 50.0) * 4.0;
    }

    const double t = eqIntModDriftTime;
    const double maxDB = eqDbRange.load (std::memory_order_relaxed);
    const int    gShape = s.gainShape.load (std::memory_order_relaxed);
    const int    qShapeIdx = s.qShape.load (std::memory_order_relaxed);
    const int    texture = s.driftTexture.load (std::memory_order_relaxed);
    const double spread = s.gainSpread.load (std::memory_order_relaxed);
    const double qSpread = s.qSpread.load (std::memory_order_relaxed);
    const float  gLo = s.gainLoCut.load(), gHi = s.gainHiCut.load();
    const float  dLo = s.driftLoCut.load(), dHi = s.driftHiCut.load();
    const float  qLo = s.qLoCut.load(), qHi = s.qHiCut.load();
    const double driftFloor = dLo > 20.0f ? dLo : 20.0;
    const double driftCeil  = dHi < 20000.0f ? dHi : 20000.0;

    const int n = juce::jmin (nPts, (int) maxEqBands);
    for (int i = 0; i < n; ++i)
    {
        auto& pt = eqPoints[i];
        const double baseFreq = pt.freqHz.load (std::memory_order_relaxed);
        const double baseDB   = pt.gainDB.load (std::memory_order_relaxed);
        const double baseQ    = pt.q.load (std::memory_order_relaxed);
        const int    excl     = pt.modExclude.load (std::memory_order_relaxed);
        const bool   gainZone = inZone ((float) baseFreq, gLo, gHi);
        const bool   driftZone = inZone ((float) baseFreq, dLo, dHi);
        const double spreadPos = n > 1 ? (double) i / (double) (n - 1) : 0.0;

        double totalModDB = 0.0, freqOffset = 0.0, qOffset = 0.0;

        // 1) Gain LFO
        if (hasSine && gainZone && ! (excl & 1))
        {
            const double phaseOffset = spreadPos * (spread / 100.0) * 0.5;
            totalModDB += gainShape (gShape, eqIntModGainPhase + phaseOffset) * gainDepth
                          * pt.modGainDepth.load (std::memory_order_relaxed) / 100.0;
        }

        // 2a) Drift = frequency sweep
        if (hasDrift && driftZone && ! (excl & 4))
        {
            const double seed = i * 73 + 11;
            const double sweepPhase = t * driftSweepRate + hashI (seed) * 0.5;
            const double sweep = driftEval (texture, sweepPhase, seed);
            const double octaves = sweep * driftSweepWidth * pt.modDriftDepth.load (std::memory_order_relaxed) / 100.0;
            const double newFreq = juce::jlimit (driftFloor, driftCeil, baseFreq * std::pow (2.0, octaves));
            freqOffset = newFreq - baseFreq;
        }

        // 2b) Continuous = gain noise
        if (hasCont && gainZone && ! (excl & 1))
        {
            const double rate = hasDrift ? driftSweepRate : 0.15;
            const double seed = i * 137 + 47;
            const double ph = t * rate * 0.8 + hashI (seed) * 0.7;
            const double noise = smoothNoise (ph * 1.0  + hashI (seed + 1) * 3.0)  * 0.35
                               + smoothNoise (ph * 2.71 + hashI (seed + 2) * 7.0)  * 0.30
                               + smoothNoise (ph * 6.28 + hashI (seed + 3) * 13.0) * 0.20
                               + smoothNoise (ph * 13.7 + hashI (seed + 4) * 19.0) * 0.15;
            double gainModDB = noise * (driftRange / 50.0) * 18.0 * pt.modGainDepth.load (std::memory_order_relaxed) / 100.0;
            if (hasDrift) gainModDB *= driftAmt;
            totalModDB += gainModDB;
        }

        const double newDB = juce::jlimit (-maxDB, maxDB, baseDB + totalModDB);
        double gainOffset = newDB - baseDB;

        // 3) Q mod
        if (hasQMod && inZone ((float) baseFreq, qLo, qHi) && ! (excl & 2))
        {
            const double seed = i * 211 + 59;
            const double qPhase = t * qRate + spreadPos * (qSpread / 100.0) * 0.5;
            const double depthMul = (qDepth / 100.0) * pt.modQDepth.load (std::memory_order_relaxed) / 100.0;
            const double newQ = juce::jlimit (0.1, 30.0, baseQ * std::pow (2.0, qShape (qShapeIdx, qPhase, seed) * depthMul));
            qOffset = newQ - baseQ;
        }

        if (! std::isfinite (freqOffset)) freqOffset = 0.0;
        if (! std::isfinite (gainOffset)) gainOffset = 0.0;
        if (! std::isfinite (qOffset))    qOffset = 0.0;

        const bool active = std::abs (freqOffset) > 1e-6 || std::abs (gainOffset) > 1e-6 || std::abs (qOffset) > 1e-6;
        pt.uiModFreqHz.store ((float) freqOffset, std::memory_order_relaxed);
        pt.uiModGainDB.store ((float) gainOffset, std::memory_order_relaxed);
        pt.uiModQ.store ((float) qOffset, std::memory_order_relaxed);
        pt.uiModActive.store (active, std::memory_order_relaxed);
    }
    for (int i = n; i < maxEqBands; ++i)
        if (eqPoints[i].uiModActive.load (std::memory_order_relaxed))
            eqPoints[i].uiModActive.store (false, std::memory_order_relaxed);
}
