// StateRestore.cpp — run a saved session without the editor.
//
// Until now the processor stored the UI's state as an opaque JSON blob and only the
// WebView knew how to turn it back into running modulation (restoreFromHost →
// syncBlocksToHost, setPluginBypass, setBus*, setEqCurve, updateExposeState). A
// project reopened without opening Hostesa's window therefore ran no modulation,
// ignored bypass/bus settings, and lost DAW automation of exposed params.
//
// This file does the same work in C++ when the state is loaded:
//   - compileBlocksForDsp()  ports persistence.js restore + logic_blocks.js
//                            syncBlocksToHost(), including their defaults and quirks,
//                            so the editor's later re-sync is a no-op.
//   - applySavedUiState()    bypass, bus mixer, routing, WrongEQ, blocks.
//   - save/restoreProxyMap() exact AP_ slot assignments across reloads.
//   - HeadlessSyncTimer      drains DAW → block automation and proxy value sync
//                            while no editor exists.
//
// Keep compileBlocksForDsp() in step with syncBlocksToHost() when block fields change.

#include "PluginProcessor.h"

namespace
{
//==============================================================================
// JavaScript value semantics over juce::var (JSON null and a missing property both
// arrive as void, which matches how the JS treats them with `!= null` / `||`).

bool isNull (const juce::var& v) { return v.isVoid() || v.isUndefined(); }

bool truthy (const juce::var& v)
{
    if (isNull (v)) return false;
    if (v.isBool()) return (bool) v;
    if (v.isInt() || v.isInt64() || v.isDouble())
    {
        const double d = (double) v;
        return d != 0.0 && ! std::isnan (d);
    }
    if (v.isString()) return v.toString().isNotEmpty();
    return true; // objects and arrays, even empty ones
}

/** JS `v || def` */
juce::var orDef (const juce::var& v, const juce::var& def) { return truthy (v) ? v : def; }
/** JS `v != null ? v : def` */
juce::var nnDef (const juce::var& v, const juce::var& def) { return isNull (v) ? def : v; }
/** JS `v !== false` */
bool notFalse (const juce::var& v) { return ! (v.isBool() && ! (bool) v); }

double num (const juce::var& v) { return (double) v; }

juce::var prop (const juce::var& obj, const juce::Identifier& name) { return obj.getProperty (name, {}); }

bool hasKey (const juce::var& obj, const juce::String& name)
{
    auto* o = obj.getDynamicObject();
    return o != nullptr && o->hasProperty (name);
}

juce::var newObject() { return juce::var (new juce::DynamicObject()); }
juce::var newArray()  { return juce::var (juce::Array<juce::var>()); }

void put (juce::var& obj, const juce::Identifier& name, const juce::var& value)
{
    if (auto* o = obj.getDynamicObject())
        o->setProperty (name, value);
}

double jsRound (double x) { return std::floor (x + 0.5); } // Math.round

// logic_blocks.js clampToCircle()
void clampToCircle (double& x, double& y)
{
    double dx = x - 0.5, dy = y - 0.5;
    const double dist = std::sqrt (dx * dx + dy * dy);
    const double r = 0.45;
    if (dist > r) { const double s = r / dist; dx *= s; dy *= s; }
    x = 0.5 + dx;
    y = 0.5 + dy;
}

// logic_blocks.js envDialToHz() / envBwIdxToOct()
double envDialToHz (const juce::var& dp) { return 20.0 * std::pow (10.0, num (nnDef (dp, 50)) * 0.03); }

double envBwIdxToOct (const juce::var& idx)
{
    static const double steps[] = { 0.1, 0.33, 0.67, 1, 1.5, 2, 3, 5 };
    const double x = num (idx);
    if (std::isnan (x)) return 2.0;
    return steps[(int) jsRound (juce::jlimit (0.0, 7.0, x))];
}

// logic_blocks.js targetDepthOf() / targetCurveOf()
double targetDepthOf (const juce::var& b, const juce::String& pid)
{
    auto d = prop (prop (b, "targetDepths"), pid);
    if (isNull (d) || std::isnan (num (d))) return 100.0;
    return juce::jlimit (-200.0, 200.0, num (d));
}

int targetCurveOf (const juce::var& b, const juce::String& pid)
{
    auto c = prop (prop (b, "targetCurves"), pid);
    if (isNull (c) || std::isnan (num (c))) return 0;
    return juce::jlimit (0, 3, (int) num (c));
}

//==============================================================================
/** What the editor's PMap would contain right after restoreFromHost(). */
struct ParamUniverse
{
    std::unordered_map<int, std::vector<float>> pluginValues; // hosted plugin id → live values
    std::unordered_map<juce::String, int> weqIndex;           // WrongEQ virtual key → C++ index
    std::unordered_set<juce::String> locked;
    std::function<float (int)> weqValue;
    int weqPluginId = 0;

    struct Resolved { bool exists = false; int hostId = 0; int paramIndex = 0; };

    Resolved resolve (const juce::String& pid) const
    {
        Resolved r;
        const int colon = pid.indexOfChar (':');
        if (colon <= 0) return r;
        const int pluginId = pid.substring (0, colon).getIntValue();
        const auto key = pid.substring (colon + 1);

        if (pluginId == weqPluginId)
        {
            auto it = weqIndex.find (key);
            if (it == weqIndex.end()) return r;
            return { true, pluginId, it->second };
        }

        auto it = pluginValues.find (pluginId);
        const int idx = key.getIntValue();
        if (it == pluginValues.end() || idx < 0 || idx >= (int) it->second.size()
            || key.isEmpty() || ! key.containsOnly ("0123456789"))
            return r;
        return { true, pluginId, idx };
    }

    float liveValue (const juce::String& pid) const
    {
        auto r = resolve (pid);
        if (! r.exists) return 0.5f;
        if (r.hostId == weqPluginId) return weqValue (r.paramIndex);
        return pluginValues.at (r.hostId)[(size_t) r.paramIndex];
    }
};
} // namespace

//==============================================================================
const juce::var& HostesaAudioProcessor::getUiStateRootLocked() const
{
    if (! uiStateRootValid)
    {
        uiStateRoot = uiStateJson.isNotEmpty() ? juce::JSON::parse (uiStateJson) : juce::var();
        uiStateRootValid = true;
    }
    return uiStateRoot;
}

void HostesaAudioProcessor::flushUiStateJsonLocked() const
{
    if (uiStateJsonStale && uiStateRootValid && uiStateRoot.isObject())
        uiStateJson = juce::JSON::toString (uiStateRoot, true);
    uiStateJsonStale = false;
}

//==============================================================================
juce::var HostesaAudioProcessor::compileBlocksForDsp (const juce::var& root)
{
    // Caller holds uiStateMutex. Snapshot what the editor's PMap would hold.
    ParamUniverse u;
    {
        std::lock_guard<std::mutex> lock (pluginMutex);
        for (auto& hp : hostedPlugins)
        {
            if (hp->id < 0) continue;
            std::vector<float> values;
            if (hp->instance != nullptr)
            {
                auto& params = hp->instance->getParameters();
                values.resize ((size_t) params.size());
                for (int i = 0; i < (int) params.size(); ++i)
                    values[(size_t) i] = params[i]->getValue();
            }
            else if (hp->isMissing())
            {
                // Placeholder: the editor lists its saved params, so they exist here too
                if (auto* paramsEl = hp->missingState->getChildByName ("PARAMS"))
                    for (auto* pEl : paramsEl->getChildWithTagNameIterator ("P"))
                    {
                        const int idx = pEl->getIntAttribute ("i", -1);
                        if (idx < 0 || idx > 100000) continue;
                        if ((size_t) idx >= values.size()) values.resize ((size_t) idx + 1, 0.0f);
                        values[(size_t) idx] = (float) pEl->getDoubleAttribute ("v", 0.0);
                    }
            }
            else continue;
            u.pluginValues[hp->id] = std::move (values);
        }
    }

    // WrongEQ virtual params exist only in WrongEQ routing (weqCreateVirtualBlock)
    if (routingMode.load() == 2)
    {
        static const std::pair<const char*, int> globals[] = {
            { "depth", 100 }, { "warp", 101 }, { "steps", 102 }, { "tilt", 103 },
            { "driftSpd", 107 }, { "driftRng", 108 }, { "lfoRate", 109 }, { "lfoDep", 110 } };
        for (auto& g : globals)
            u.weqIndex[g.first] = g.second;

        auto pts = prop (prop (root, "wrongEq"), "points");
        const int nBands = juce::jmin (pts.isArray() ? pts.size() : 0, 8);
        for (int i = 0; i < nBands; ++i)
        {
            u.weqIndex["freq_"  + juce::String (i)] = i * 4 + 0;
            u.weqIndex["gain_"  + juce::String (i)] = i * 4 + 1;
            u.weqIndex["q_"     + juce::String (i)] = i * 4 + 2;
            u.weqIndex["drift_" + juce::String (i)] = i * 4 + 3;
        }
    }
    u.weqPluginId = kWeqPluginId;
    u.weqValue = [this] (int idx) { return getParamValue (kWeqPluginId, idx); };

    if (auto* locks = prop (root, "locks").getDynamicObject())
        for (auto& l : locks->getProperties())
            if (u.resolve (l.name.toString()).exists)
                u.locked.insert (l.name.toString());

    const auto internalBpm = orDef (prop (root, "internalBpm"), 120);
    bool rootModified = false;

    auto out = newArray();
    auto savedBlocks = prop (root, "blocks");
    if (! savedBlocks.isArray()) return out;

    for (auto& sb : *savedBlocks.getArray())
    {
        if (! sb.isObject()) continue;

        const auto rawMode = prop (sb, "mode");
        const auto mode = orDef (rawMode, "randomize").toString();

        // Restored target set (existing params, saved order, de-duplicated) …
        juce::StringArray tSet;
        auto savedTargets = prop (sb, "targets");
        if (savedTargets.isArray())
            for (auto& t : *savedTargets.getArray())
                if (u.resolve (t.toString()).exists)
                    tSet.addIfNotAlreadyThere (t.toString());

        // … and the targets actually sent to the DSP (locked ones skipped)
        juce::StringArray tIds;
        auto tList = newArray();
        for (auto& pid : tSet)
        {
            if (u.locked.count (pid) > 0) continue;
            auto r = u.resolve (pid);
            auto t = newObject();
            put (t, "hostId", r.hostId);
            put (t, "paramIndex", r.paramIndex);
            put (t, "depth", targetDepthOf (sb, pid) / 100.0);
            put (t, "curve", targetCurveOf (sb, pid));
            tList.append (t);
            tIds.add (pid);
        }

        // Per-target lookup: saved value if present, else a fallback
        auto perTarget = [&] (const char* mapName, std::function<juce::var (const juce::String&)> fallback)
        {
            auto arr = newArray();
            auto map = prop (sb, mapName);
            for (auto& pid : tIds)
                arr.append (hasKey (map, pid) ? juce::var (num (prop (map, pid))) : fallback (pid));
            return arr;
        };
        auto live = [&] (const juce::String& pid) { return juce::var ((double) u.liveValue (pid)); };

        auto obj = newObject();
        put (obj, "id", prop (sb, "id"));
        put (obj, "mode", mode);
        put (obj, "targets", tList);
        put (obj, "trigger", orDef (prop (sb, "trigger"), "manual"));
        put (obj, "beatDiv", orDef (prop (sb, "beatDiv"), "1/4"));
        put (obj, "trigFree", truthy (prop (sb, "trigFree")));
        put (obj, "trigHz", nnDef (prop (sb, "trigHz"), 1));
        put (obj, "midiMode", orDef (prop (sb, "midiMode"), "any_note"));
        put (obj, "midiNote", orDef (prop (sb, "midiNote"), 60));
        put (obj, "midiCC", orDef (prop (sb, "midiCC"), 1));
        {
            const double ch = num (nnDef (prop (sb, "midiCh"), 0)); // parseInt(…) || 0
            put (obj, "midiCh", std::isnan (ch) ? 0 : (int) ch);
        }
        put (obj, "threshold", orDef (prop (sb, "threshold"), -12));
        put (obj, "audioSrc", orDef (prop (sb, "audioSrc"), "main"));
        put (obj, "rMin", num (orDef (prop (sb, "rMin"), 0)) / 100.0);
        put (obj, "rMax", (hasKey (sb, "rMax") ? num (prop (sb, "rMax")) : 100.0) / 100.0);
        put (obj, "rangeMode", rawMode.toString() == "randomize" ? orDef (prop (sb, "rangeMode"), "absolute")
                                                                  : juce::var ("relative"));
        put (obj, "polarity", orDef (prop (sb, "polarity"), "bipolar"));
        put (obj, "quantize", truthy (prop (sb, "quantize")));
        put (obj, "qSteps", orDef (prop (sb, "qSteps"), 12));
        put (obj, "movement", orDef (prop (sb, "movement"), "instant"));
        put (obj, "glideMs", orDef (prop (sb, "glideMs"), 200));
        put (obj, "envAtk", orDef (prop (sb, "envAtk"), 10));
        put (obj, "envRel", orDef (prop (sb, "envRel"), 100));
        put (obj, "envSens", orDef (prop (sb, "envSens"), 50));
        // renderEnvBody() forces envelope blocks to "no invert" whenever they're drawn
        put (obj, "envInvert", mode != "envelope" && truthy (prop (sb, "envInvert")));
        put (obj, "envFilterMode", orDef (prop (sb, "envFilterMode"), "flat"));
        put (obj, "envFilterFreq", envDialToHz (prop (sb, "envFilterFreq")));
        put (obj, "envFilterBW", envBwIdxToOct (nnDef (prop (sb, "envFilterBW"), 5)));
        put (obj, "loopMode", orDef (prop (sb, "loopMode"), "loop"));
        put (obj, "sampleSpeed", orDef (prop (sb, "sampleSpeed"), 1.0));
        put (obj, "sampleReverse", truthy (prop (sb, "sampleReverse")));
        put (obj, "jumpMode", orDef (prop (sb, "jumpMode"), "restart"));
        put (obj, "clockSource", orDef (prop (sb, "clockSource"), "daw"));
        put (obj, "internalBpm", internalBpm);
        put (obj, "enabled", notFalse (prop (sb, "enabled")));
        put (obj, "targetBases", perTarget ("targetBases", live));

        if (mode == "morph_pad")
        {
            auto snaps = newArray();
            auto savedSnaps = prop (sb, "snapshots");
            if (savedSnaps.isArray())
            {
                for (auto& s : *savedSnaps.getArray())
                {
                    // Restore prunes values to the target set; sync then fills any
                    // missing target from the live value ONCE and stores it.
                    auto oldValues = prop (s, "values");
                    auto values = newObject();
                    int kept = 0;
                    for (auto& pid : tSet)
                        if (hasKey (oldValues, pid)) { put (values, pid, prop (oldValues, pid)); ++kept; }
                    auto* oldObj = oldValues.getDynamicObject();
                    bool snapChanged = oldObj == nullptr || oldObj->getProperties().size() != kept;

                    auto vals = newArray();
                    for (auto& pid : tIds)
                    {
                        if (! hasKey (values, pid))
                        {
                            put (values, pid, (double) u.liveValue (pid));
                            snapChanged = true;
                        }
                        vals.append (prop (values, pid));
                    }

                    if (snapChanged && s.isObject())
                    {
                        put (s, "values", values);
                        rootModified = true;
                    }

                    auto so = newObject();
                    put (so, "x", nnDef (prop (s, "x"), 0.5));
                    put (so, "y", nnDef (prop (s, "y"), 0.5));
                    put (so, "targetValues", vals);
                    put (so, "weight", nnDef (prop (s, "weight"), 100));
                    put (so, "curve", orDef (prop (s, "curve"), 0));
                    put (so, "depth", nnDef (prop (s, "depth"), 100));
                    snaps.append (so);
                }
            }
            put (obj, "snapshots", snaps);

            double px = num (nnDef (prop (sb, "playheadX"), 0.5));
            double py = num (nnDef (prop (sb, "playheadY"), 0.5));
            clampToCircle (px, py);
            put (obj, "playheadX", px);
            put (obj, "playheadY", py);
            put (obj, "morphMode", orDef (prop (sb, "morphMode"), "manual"));
            auto explore = prop (sb, "exploreMode");
            put (obj, "exploreMode", orDef (explore.toString() == "lfo" ? juce::var ("shapes") : explore, "wander"));
            put (obj, "lfoShape", orDef (prop (sb, "lfoShape"), "circle"));
            put (obj, "lfoDepth", num (nnDef (prop (sb, "lfoDepth"), 80)) / 100.0);
            put (obj, "lfoRotation", num (orDef (prop (sb, "lfoRotation"), 0)) / 100.0);
            put (obj, "morphSpeed", num (orDef (prop (sb, "morphSpeed"), 50)) / 100.0);
            put (obj, "morphHz", nnDef (prop (sb, "morphHz"), 0.5));
            put (obj, "morphAction", orDef (prop (sb, "morphAction"), "jump"));
            put (obj, "stepOrder", orDef (prop (sb, "stepOrder"), "cycle"));
            put (obj, "morphSource", orDef (prop (sb, "morphSource"), "midi"));
            put (obj, "jitter", num (orDef (prop (sb, "jitter"), 0)) / 100.0);
            put (obj, "morphGlide", orDef (prop (sb, "morphGlide"), 200));
            put (obj, "morphTempoSync", truthy (prop (sb, "morphTempoSync")));
            put (obj, "morphSyncDiv", orDef (prop (sb, "morphSyncDiv"), "1/4"));
            put (obj, "snapRadius", num (orDef (prop (sb, "snapRadius"), 100)) / 100.0);
        }

        if (mode == "shapes" || mode == "shapes_range")
        {
            const bool range = mode == "shapes_range";
            const double size = num (nnDef (prop (sb, "shapeSize"), 80));
            put (obj, "shapeType", orDef (prop (sb, "shapeType"), "circle"));
            put (obj, "shapeTracking", orDef (prop (sb, "shapeTracking"), "horizontal"));
            put (obj, "shapeSize", range ? 1.0 : size / 100.0);
            put (obj, "shapeSpin", num (orDef (prop (sb, "shapeSpin"), 0)) / 100.0);
            put (obj, "shapeSpeed", num (orDef (prop (sb, "shapeSpeed"), 50)) / 100.0);
            put (obj, "shapeHz", nnDef (prop (sb, "shapeHz"), 0.5));
            put (obj, "shapeDepth", range ? 1.0 : size / 200.0);
            // The shapes body render forces "relative" (the DSP does too)
            put (obj, "shapeRange", "relative");
            put (obj, "shapePolarity", orDef (prop (sb, "shapePolarity"), "bipolar"));
            put (obj, "shapeTempoSync", truthy (prop (sb, "shapeTempoSync")));
            put (obj, "shapeSyncDiv", orDef (prop (sb, "shapeSyncDiv"), "1/4"));
            put (obj, "shapeTrigger", orDef (prop (sb, "shapeTrigger"), "free"));
            put (obj, "shapePhaseOffset", num (orDef (prop (sb, "shapePhaseOffset"), 0)) / 360.0);
        }

        if (mode == "shapes_range")
        {
            put (obj, "targetRanges", perTarget ("targetRanges", [] (const juce::String&) { return juce::var (0); }));
            put (obj, "targetRangeBases", perTarget ("targetRangeBases", live));
        }

        if (mode == "lane")
        {
            auto lanes = newArray();
            auto savedLanes = prop (sb, "lanes");
            if (savedLanes.isArray())
            {
                for (auto& lane : *savedLanes.getArray())
                {
                    auto laneTargets = newArray();
                    auto pids = prop (lane, "pids");
                    if (! truthy (pids))
                    {
                        pids = newArray();
                        if (truthy (prop (lane, "pid"))) pids.append (prop (lane, "pid"));
                    }
                    if (pids.isArray())
                    {
                        for (auto& pidVar : *pids.getArray())
                        {
                            const auto pid = pidVar.toString();
                            if (! tIds.contains (pid)) continue; // only resolved, unlocked block targets
                            auto r = u.resolve (pid);
                            auto t = newObject();
                            put (t, "pluginId", r.hostId);
                            put (t, "paramIndex", r.paramIndex);
                            put (t, "depth", targetDepthOf (sb, pid) / 100.0);
                            put (t, "curve", targetCurveOf (sb, pid));
                            laneTargets.append (t);
                        }
                    }

                    auto pts = newArray();
                    auto savedPts = prop (lane, "pts");
                    if (savedPts.isArray())
                    {
                        for (auto& p : *savedPts.getArray())
                        {
                            auto q = newObject();
                            put (q, "x", prop (p, "x"));
                            put (q, "y", prop (p, "y"));
                            if (truthy (prop (p, "ip"))) put (q, "ip", prop (p, "ip"));
                            pts.append (q);
                        }
                    }

                    auto snaps = newArray();
                    auto savedSnaps = prop (lane, "morphSnapshots");
                    if (savedSnaps.isArray())
                    {
                        for (auto& s : *savedSnaps.getArray())
                        {
                            auto so = newObject();
                            put (so, "position", orDef (prop (s, "position"), 0));
                            put (so, "hold", nnDef (prop (s, "hold"), 0.5));
                            put (so, "curve", orDef (prop (s, "curve"), 0));
                            put (so, "depth", nnDef (prop (s, "depth"), 1.0));
                            put (so, "drift", orDef (prop (s, "drift"), 0));
                            put (so, "driftRange", nnDef (prop (s, "driftRange"), 5));
                            put (so, "driftScale", orDef (prop (s, "driftScale"), ""));
                            put (so, "warp", orDef (prop (s, "warp"), 0));
                            put (so, "steps", orDef (prop (s, "steps"), 0));
                            put (so, "name", orDef (prop (s, "name"), ""));
                            put (so, "source", orDef (prop (s, "source"), ""));
                            put (so, "values", orDef (prop (s, "values"), newObject()));
                            snaps.append (so);
                        }
                    }

                    auto lo = newObject();
                    put (lo, "targets", laneTargets);
                    put (lo, "pts", pts);
                    put (lo, "loopLen", orDef (prop (lane, "loopLen"), "1/1"));
                    put (lo, "steps", orDef (prop (lane, "steps"), 0));
                    put (lo, "depth", num (nnDef (prop (lane, "depth"), 100)) / 100.0);
                    put (lo, "drift", orDef (prop (lane, "drift"), 0));
                    put (lo, "driftRange", nnDef (prop (lane, "driftRange"), 5));
                    put (lo, "driftScale", orDef (prop (lane, "driftScale"), "1/1"));
                    put (lo, "warp", orDef (prop (lane, "warp"), 0));
                    put (lo, "interp", orDef (prop (lane, "interp"), "smooth"));
                    put (lo, "fxLo", nnDef (prop (lane, "fxLo"), 0));
                    put (lo, "fxHi", nnDef (prop (lane, "fxHi"), 1));
                    put (lo, "playMode", orDef (prop (lane, "playMode"), "forward"));
                    put (lo, "freeSecs", orDef (prop (lane, "freeSecs"), 4));
                    put (lo, "synced", notFalse (prop (lane, "synced")));
                    put (lo, "muted", truthy (prop (lane, "muted")));
                    put (lo, "trigMode", orDef (prop (lane, "trigMode"), "loop"));
                    put (lo, "trigSource", orDef (prop (lane, "trigSource"), "manual"));
                    put (lo, "trigMidiNote", nnDef (prop (lane, "trigMidiNote"), -1));
                    put (lo, "trigMidiCh", orDef (prop (lane, "trigMidiCh"), 0));
                    put (lo, "trigThreshold", nnDef (prop (lane, "trigThreshold"), -12));
                    put (lo, "trigAudioSrc", orDef (prop (lane, "trigAudioSrc"), "main"));
                    put (lo, "trigRetrigger", notFalse (prop (lane, "trigRetrigger")));
                    put (lo, "trigHold", truthy (prop (lane, "trigHold")));
                    put (lo, "morphMode", truthy (prop (lane, "morphMode")));
                    put (lo, "morphSnapshots", snaps);
                    lanes.append (lo);
                }
            }
            put (obj, "lanes", lanes);
        }

        if (mode == "link")
        {
            auto sources = prop (sb, "linkSources");
            if (! truthy (sources))
            {
                // Legacy single-source format
                sources = newArray();
                auto legacyPid = prop (sb, "linkSourcePluginId");
                if (! isNull (legacyPid) && num (legacyPid) >= 0)
                {
                    auto s = newObject();
                    put (s, "pluginId", legacyPid);
                    put (s, "paramIndex", orDef (prop (sb, "linkSourceParamIndex"), -1));
                    sources.append (s);
                }
            }
            auto outSources = newArray();
            if (sources.isArray())
            {
                for (auto& s : *sources.getArray())
                {
                    auto so = newObject();
                    auto pluginId = prop (s, "pluginId");
                    put (so, "pluginId", nnDef (pluginId, -1));
                    put (so, "paramIndex", nnDef (prop (s, "paramIndex"), -1));
                    if (! isNull (pluginId) && ! pluginId.isString() && num (pluginId) == -2.0
                        && ! isNull (prop (s, "macroValue")))
                        put (so, "macroValue", prop (s, "macroValue"));
                    outSources.append (so);
                }
            }
            put (obj, "linkSources", outSources);
            put (obj, "linkSmoothMs", orDef (prop (sb, "linkSmoothMs"), 0));
            put (obj, "linkMin", perTarget ("linkMin", [] (const juce::String&) { return juce::var (0); }));
            put (obj, "linkMax", perTarget ("linkMax", [] (const juce::String&) { return juce::var (100); }));
            put (obj, "linkBases", perTarget ("linkBases", live));
        }

        out.append (obj);
    }

    if (rootModified)
        uiStateJsonStale = true;
    return out;
}

//==============================================================================
void HostesaAudioProcessor::applySavedUiState (bool proxyMapRestored)
{
    juce::var root;
    {
        std::lock_guard<std::mutex> lock (uiStateMutex);
        root = getUiStateRootLocked();
    }

    if (! root.isObject())
    {
        // No UI state: nothing to run (the previous session's blocks were dropped
        // in setStateInformation when its plugins were torn down).
        updateReportedLatency();
        return;
    }

    // Routing first: it decides whether the WrongEQ (and its virtual params) exist
    if (hasKey (root, "routingMode"))
        routingMode.store (juce::jlimit (0, 2, (int) prop (root, "routingMode")));

    // -- WrongEQ (persistence.js restore + wrongeq_canvas.js _weqDoSync) --
    auto weq = prop (root, "wrongEq");
    if (routingMode.load() == 2 && weq.isObject())
    {
        const double dbRange = num (nnDef (prop (weq, "dbRange"), 24));
        auto eq = newObject();
        put (eq, "globalBypass", nnDef (prop (weq, "bypass"), false));
        put (eq, "preEq", nnDef (prop (weq, "preEq"), true));
        put (eq, "unassignedMode", nnDef (prop (weq, "unassignedMode"), 1));
        put (eq, "splitMode", nnDef (prop (weq, "splitMode"), false));
        put (eq, "oversample", nnDef (prop (weq, "oversample"), 1));
        put (eq, "dbRange", dbRange);
        put (eq, "globalDepth", nnDef (prop (weq, "depth"), 100));
        put (eq, "globalWarp", nnDef (prop (weq, "warp"), 0));
        put (eq, "globalSteps", nnDef (prop (weq, "steps"), 0));
        put (eq, "globalTilt", nnDef (prop (weq, "tilt"), 0));

        // Internal modulation (gain LFO / drift / Q mod) — wrongeq_canvas.js defaults
        const std::pair<const char*, juce::var> modDefaults[] = {
            { "modEnabled", true }, { "animSpeed", 0 }, { "animDepth", 6 }, { "animShape", "sine" },
            { "animSpread", 0 }, { "gainSync", false }, { "gainSyncDiv", "1/4" },
            { "drift", 0 }, { "driftRange", 5 }, { "driftScale", "1/1" }, { "driftContinuous", false },
            { "driftTexture", "smooth" }, { "gainLoCut", 20 }, { "gainHiCut", 20000 },
            { "driftLoCut", 20 }, { "driftHiCut", 20000 }, { "qModSpeed", 0 }, { "qModDepth", 30 },
            { "qModShape", "sine" }, { "qModSpread", 0 }, { "qSync", false }, { "qSyncDiv", "1/4" },
            { "qLoCut", 20 }, { "qHiCut", 20000 }, { "syncSource", "daw" } };
        for (auto& d : modDefaults)
            put (eq, d.first, nnDef (prop (weq, d.first), d.second));
        put (eq, "internalBpm", orDef (prop (root, "internalBpm"), 120));

        auto points = newArray();
        auto savedPts = prop (weq, "points");
        int nextUid = 1; // _weqEnsureUid() for points saved before uids existed
        if (savedPts.isArray())
        {
            for (auto& p : *savedPts.getArray())
            {
                auto uid = prop (p, "uid");
                if (! truthy (uid)) uid = nextUid++;
                const auto pointPreEq = hasKey (p, "preEq") ? prop (p, "preEq") : nnDef (prop (weq, "preEq"), true);

                auto po = newObject();
                put (po, "freqHz", 20.0 * std::pow (1000.0, juce::jlimit (0.0, 1.0, num (prop (p, "x")))));
                put (po, "gainDB", -dbRange + (1.0 - num (prop (p, "y"))) * (dbRange * 2.0));
                put (po, "busId", uid);
                put (po, "pluginIds", orDef (prop (p, "pluginIds"), newArray()));
                put (po, "solo", orDef (prop (p, "solo"), false));
                put (po, "mute", orDef (prop (p, "mute"), false));
                put (po, "q", nnDef (prop (p, "q"), 0.707));
                put (po, "type", orDef (prop (p, "type"), "Bell"));
                put (po, "drift", orDef (prop (p, "drift"), 0));
                put (po, "preEq", notFalse (pointPreEq));
                put (po, "stereoMode", orDef (prop (p, "stereoMode"), 0));
                put (po, "slope", orDef (prop (p, "slope"), 1));
                put (po, "seg", orDef (prop (p, "seg"), juce::var()));
                put (po, "modExclude", orDef (prop (p, "modExclude"), 0));
                for (auto* key : { "modGainDepth", "modDriftDepth", "modQDepth" })
                    if (! isNull (prop (p, key)))
                        put (po, key, prop (p, key));
                points.append (po);
            }
        }
        put (eq, "points", points);
        setEqCurve (juce::JSON::toString (eq, true));

        // Older states carried a global resonance value
        if (hasKey (weq, "reso"))
            eqGlobalReso.store (juce::jlimit (0.0f, 100.0f, (float) num (prop (weq, "reso"))));
    }

    // -- Plugin bypass --
    if (auto* byp = prop (root, "pluginBypassed").getDynamicObject())
        for (auto& b : byp->getProperties())
            if (truthy (b.value))
                setPluginBypass (b.name.toString().getIntValue(), true);

    // -- Parallel bus mixer (the editor holds 7 buses) --
    auto applyBusArray = [&] (const char* name, std::function<void (int, const juce::var&)> setter)
    {
        auto arr = prop (root, name);
        if (arr.isArray())
            for (int i = 0; i < juce::jmin (arr.size(), 7); ++i)
                setter (i, arr[i]);
    };
    applyBusArray ("busVolumes", [this] (int i, const juce::var& v) { setBusVolume (i, (float) num (v)); });
    applyBusArray ("busMutes",   [this] (int i, const juce::var& v) { setBusMute (i, truthy (v)); });
    applyBusArray ("busSolos",   [this] (int i, const juce::var& v) { setBusSolo (i, truthy (v)); });

    // -- Expose state for sessions saved before the exact slot map existed. Plugin
    //    exclusions apply now; block slots need the editor's param definitions and
    //    are assigned when it opens (the next save then stores the full map). --
    if (! proxyMapRestored)
    {
        auto expose = prop (root, "exposeState");
        if (expose.isObject())
            updateExposeState (juce::JSON::toString (expose, true));
    }

    // -- Logic blocks --
    juce::var dspBlocks;
    {
        std::lock_guard<std::mutex> lock (uiStateMutex);
        dspBlocks = compileBlocksForDsp (getUiStateRootLocked());
    }
    updateLogicBlocks (dspBlocks);

    updateReportedLatency();
}

//==============================================================================
void HostesaAudioProcessor::applyBlockParamUpdatesHeadless (const std::vector<BlockParamUpdate>& updates)
{
    juce::var dspBlocks;
    {
        std::lock_guard<std::mutex> lock (uiStateMutex);
        auto root = getUiStateRootLocked();
        auto blocks = prop (root, "blocks");
        if (! blocks.isArray()) return;

        bool changed = false;
        for (auto& upd : updates)
        {
            juce::var b;
            for (auto& candidate : *blocks.getArray())
                if ((int) prop (candidate, "id") == upd.blockId) { b = candidate; break; }
            if (! b.isObject()) continue;

            // The slot carries the param definition the editor exposed it with
            const ProxyMapping* def = nullptr;
            for (int i = 0; i < proxyParamCount; ++i)
                if (proxyMap[i].blockId == upd.blockId && proxyMap[i].blockParamKey == upd.paramKey) { def = &proxyMap[i]; break; }

            const auto& key = upd.paramKey;
            const double value = upd.value;
            const double fMin = def != nullptr ? def->blockMin : 0.0;
            const double fMax = def != nullptr ? def->blockMax : 100.0;

            if (key.startsWith ("lane."))
            {
                // "lane.<i>.<prop>"
                auto parts = juce::StringArray::fromTokens (key, ".", "");
                auto lanes = prop (b, "lanes");
                const int li = parts[1].getIntValue();
                if (parts.size() == 3 && lanes.isArray() && li >= 0 && li < lanes.size())
                {
                    juce::var lane = lanes[li];
                    put (lane, juce::Identifier (parts[2]), value * (fMax - fMin) + fMin);
                }
            }
            else if (key.startsWith ("linkMacro."))
            {
                // "linkMacro.<i>.value" — 0..1 DAW → 0..100 internal
                auto parts = juce::StringArray::fromTokens (key, ".", "");
                auto sources = prop (b, "linkSources");
                const int mi = parts[1].getIntValue();
                if (sources.isArray() && mi >= 0 && mi < sources.size())
                {
                    juce::var src = sources[mi];
                    if (num (prop (src, "pluginId")) == -2.0)
                        put (src, "macroValue", value * 100.0);
                }
            }
            else if (def == nullptr || def->blockParamType.isEmpty())
                put (b, juce::Identifier (key), value);
            else if (def->blockParamType == "bool")
                put (b, juce::Identifier (key), value >= 0.5);
            else if (def->blockParamType == "discrete" && def->blockOptions.size() > 0)
            {
                const int n = def->blockOptions.size();
                const int idx = juce::jlimit (0, n - 1, (int) jsRound (value * (n - 1)));
                put (b, juce::Identifier (key), def->blockOptions[idx]);
            }
            else
                put (b, juce::Identifier (key), value * (fMax - fMin) + fMin);

            changed = true;
        }

        if (! changed) return;
        uiStateJsonStale = true;
        dspBlocks = compileBlocksForDsp (root);
    }
    updateLogicBlocks (dspBlocks);
}

//==============================================================================
namespace
{
/** Which plugin list a slot map belongs to: "id:name;" for each saved plugin. */
juce::String pluginListSignature (const std::vector<std::pair<int, juce::String>>& plugins)
{
    juce::String sig;
    for (auto& p : plugins)
        sig << p.first << ":" << p.second << ";";
    return sig;
}
} // namespace

static juce::String missingParamName (const juce::XmlElement& plugEl, int paramIndex)
{
    if (auto* paramsEl = plugEl.getChildByName ("PARAMS"))
        for (auto* pEl : paramsEl->getChildWithTagNameIterator ("P"))
            if (pEl->getIntAttribute ("i", -1) == paramIndex)
                return pEl->getStringAttribute ("n", "Param " + juce::String (paramIndex + 1));
    return "Param " + juce::String (paramIndex + 1);
}

void HostesaAudioProcessor::saveProxyMap (juce::XmlElement& parent)
{
    // Must describe the same plugins HOSTED_PLUGINS saves (live entries, in order)
    std::vector<std::pair<int, juce::String>> plugins;
    {
        std::lock_guard<std::mutex> lock (pluginMutex);
        for (auto& hp : hostedPlugins)
            if (hp->id >= 0)
                plugins.emplace_back (hp->id, hp->name);
    }

    auto* mapXml = parent.createNewChildElement ("PROXY_MAP");
    mapXml->setAttribute ("plugins", pluginListSignature (plugins));
    for (int i = 0; i < proxyParamCount; ++i)
    {
        const auto& m = proxyMap[i];
        if (m.isPlugin())
        {
            auto* e = mapXml->createNewChildElement ("P");
            e->setAttribute ("s", i);
            e->setAttribute ("p", m.pluginId);
            e->setAttribute ("i", m.paramIndex);
        }
        else if (m.isBlock())
        {
            auto* e = mapXml->createNewChildElement ("B");
            e->setAttribute ("s", i);
            e->setAttribute ("b", m.blockId);
            e->setAttribute ("k", m.blockParamKey);
            e->setAttribute ("n", m.blockSlotName);
            e->setAttribute ("t", m.blockParamType);
            e->setAttribute ("min", (double) m.blockMin);
            e->setAttribute ("max", (double) m.blockMax);
            e->setAttribute ("sfx", m.blockSuffix);
            for (auto& opt : m.blockOptions)
                e->createNewChildElement ("O")->setAttribute ("v", opt);
        }
    }
}

bool HostesaAudioProcessor::restoreProxyMap (const juce::XmlElement* mapXml, const juce::XmlElement* pluginsXml)
{
    if (mapXml == nullptr) return false;

    // A map saved alongside a different plugin list (e.g. the state went through an
    // older build and back) would put automation on the wrong params — ignore it.
    std::vector<std::pair<int, juce::String>> savedPlugins;
    if (pluginsXml != nullptr)
        for (auto* plugEl : pluginsXml->getChildWithTagNameIterator ("PLUGIN"))
            savedPlugins.emplace_back (plugEl->getIntAttribute ("id", 0), plugEl->getStringAttribute ("name"));
    if (mapXml->getStringAttribute ("plugins") != pluginListSignature (savedPlugins))
        return false;

    // Discard the load-order assignment loadPlugin() just made and rebuild the
    // saved one exactly. APVTS has already restored the slot values.
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

    for (auto* e : mapXml->getChildIterator())
    {
        const int slot = e->getIntAttribute ("s", -1);
        if (slot < 0 || slot >= proxyParamCount) continue;
        auto& m = proxyMap[slot];

        if (e->hasTagName ("P"))
        {
            const int pluginId = e->getIntAttribute ("p", -1);
            const int paramIndex = e->getIntAttribute ("i", -1);

            std::lock_guard<std::mutex> lock (pluginMutex);
            for (auto& hp : hostedPlugins)
            {
                if (hp->id != pluginId) continue;
                if (hp->isMissing())
                {
                    // Keep the slot so the DAW lane is still there when the plugin is back
                    if (paramIndex < 0) break;
                    m.pluginId = pluginId;
                    m.paramIndex = paramIndex;
                    if (proxyParams[slot] != nullptr)
                        proxyParams[slot]->setDynamicName (hp->name + ": "
                            + missingParamName (*hp->missingState, paramIndex) + " (missing)");
                    break;
                }
                if (hp->instance == nullptr) continue;
                auto& params = hp->instance->getParameters();
                if (paramIndex < 0 || paramIndex >= (int) params.size()) break; // plugin changed

                m.pluginId = pluginId;
                m.paramIndex = paramIndex;
                if (proxyParams[slot] != nullptr)
                {
                    proxyParams[slot]->setDynamicName (hp->name + ": " + params[paramIndex]->getName (128));
                    proxySyncActive.store (true);
                    proxyParams[slot]->setValueNotifyingHost (params[paramIndex]->getValue());
                    proxySyncActive.store (false);
                }
                break;
            }
        }
        else if (e->hasTagName ("B"))
        {
            m.blockId = e->getIntAttribute ("b", -1);
            m.blockParamKey = e->getStringAttribute ("k");
            m.blockSlotName = e->getStringAttribute ("n");
            m.blockParamType = e->getStringAttribute ("t", "float");
            m.blockMin = (float) e->getDoubleAttribute ("min", 0.0);
            m.blockMax = (float) e->getDoubleAttribute ("max", 100.0);
            m.blockSuffix = e->getStringAttribute ("sfx");
            for (auto* o : e->getChildWithTagNameIterator ("O"))
                m.blockOptions.add (o->getStringAttribute ("v"));
            if (m.blockId < 0 || m.blockParamKey.isEmpty())
                m.clear();
            else
                applyBlockSlotDisplay (slot);
        }
    }

    updateHostDisplay (juce::AudioProcessor::ChangeDetails{}.withParameterInfoChanged (true));
    return true;
}

//==============================================================================
void HostesaAudioProcessor::HeadlessSyncTimer::timerCallback()
{
    // While an editor exists its own timer does this (and forwards block
    // automation to the UI, which re-syncs the blocks).
    if (owner.getActiveEditor() != nullptr)
        return;

    owner.syncProxyCacheToHost();

    auto updates = owner.drainBlockProxyCache();
    if (! updates.empty())
        owner.applyBlockParamUpdatesHeadless (updates);
}

//==============================================================================
namespace
{
void diffVars (const juce::var& a, const juce::var& b, const juce::String& path, juce::StringArray& out)
{
    if (out.size() >= 60) return;
    auto isNum = [] (const juce::var& v) { return v.isInt() || v.isInt64() || v.isDouble() || v.isBool(); };

    if (isNum (a) && isNum (b))
    {
        if (std::abs ((double) a - (double) b) > 1e-4)
            out.add (path + ": C++ " + a.toString() + " vs editor " + b.toString());
        return;
    }
    if (a.isArray() && b.isArray())
    {
        if (a.size() != b.size())
            out.add (path + ": length C++ " + juce::String (a.size()) + " vs editor " + juce::String (b.size()));
        for (int i = 0; i < juce::jmin (a.size(), b.size()); ++i)
            diffVars (a[i], b[i], path + "[" + juce::String (i) + "]", out);
        return;
    }
    auto* ao = a.getDynamicObject();
    auto* bo = b.getDynamicObject();
    if (ao != nullptr && bo != nullptr)
    {
        for (auto& p : ao->getProperties())
            diffVars (p.value, bo->getProperty (p.name), path + "." + p.name.toString(), out);
        for (auto& p : bo->getProperties())
            if (! ao->hasProperty (p.name))
                out.add (path + "." + p.name.toString() + ": missing in C++ (editor " + p.value.toString() + ")");
        return;
    }
    if (isNull (a) && isNull (b)) return;
    if (a.toString() != b.toString())
        out.add (path + ": C++ '" + a.toString() + "' vs editor '" + b.toString() + "'");
}
} // namespace

void HostesaAudioProcessor::verifyHeadlessCompile (const juce::String& editorBlocksJson)
{
    juce::var ours;
    {
        std::lock_guard<std::mutex> lock (uiStateMutex);
        auto root = getUiStateRootLocked();
        if (! root.isObject()) return; // fresh session, nothing was restored
        ours = compileBlocksForDsp (root);
    }

    juce::StringArray diffs;
    diffVars (ours, juce::JSON::parse (editorBlocksJson), "blocks", diffs);

    // Only a mismatch leaves a file behind (a field diagnostic for "the session
    // sounded different before I opened the window").
    auto file = getDataRoot().getChildFile ("restore_check.txt");
    if (diffs.isEmpty())
    {
        file.deleteFile();
        return;
    }
    juce::String report;
    report << juce::Time::getCurrentTime().toString (true, true) << "\n"
           << "DIFFERENCES (bases/values read live may differ slightly if modulation was running):\n"
           << diffs.joinIntoString ("\n") << "\n";
    file.replaceWithText (report);
}
