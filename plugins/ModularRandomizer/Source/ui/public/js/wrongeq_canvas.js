/*
 * WrongEQ Canvas Module — drawable frequency-band EQ
 * Each breakpoint creates a bus slot for plugin routing.
 * Adapted from lane_module.js with logarithmic frequency axis.
 * Depends on: state.js (wrongEqPoints, routingMode)
 */

// ── Constants ──
var WEQ_CANVAS_H = 360;
var WEQ_Y_PAD = 16;
var WEQ_MIN_FREQ = 20;
var WEQ_MAX_FREQ = 20000;
var WEQ_MIN_DB = -24; // DEPRECATED: use -weqDBRangeMax instead (dynamic range)
var WEQ_MAX_DB = 24;  // DEPRECATED: use weqDBRangeMax instead (dynamic range)
var WEQ_DB_RANGE = WEQ_MAX_DB - WEQ_MIN_DB; // DEPRECATED
var WEQ_BAND_COLORS = ['#ff6464', '#64b4ff', '#64dc8c', '#ffc850', '#c882ff', '#ff8cb4', '#50dcdc'];
var WEQ_TYPES = ['Bell', 'LP', 'HP', 'Notch', 'LShf', 'HShf'];

// Hex color to rgba string (safe against non-hex inputs)
function weqHexRgba(hex, alpha) {
    if (!hex || hex.charAt(0) !== '#' || hex.length < 7) return 'rgba(128,128,128,' + alpha + ')';
    var r = parseInt(hex.slice(1, 3), 16);
    var g = parseInt(hex.slice(3, 5), 16);
    var b = parseInt(hex.slice(5, 7), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}

// Read computed accent color from CSS variable for canvas drawing
function _weqAccentRgba(alpha) {
    try {
        var accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
        if (accent && accent.charAt(0) === '#' && accent.length >= 7) return weqHexRgba(accent, alpha);
    } catch (e) { }
    return 'rgba(130,180,130,' + alpha + ')';
}
// Read computed color variable for canvas
function _weqCssColorRgba(varName, alpha) {
    try {
        var c = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
        if (c && c.charAt(0) === '#' && c.length >= 7) return weqHexRgba(c, alpha);
    } catch (e) { }
    return 'rgba(128,128,128,' + alpha + ')';
}

// Resolve plugin names for a point's assigned plugins
function _weqPlugNames(pt) {
    if (!pt) return '';
    var ids = pt.pluginIds;
    // Backward compat: old busId → convert
    if (!ids && pt.busId != null && pt.busId >= 0) ids = [pt.busId];
    if (!ids || ids.length === 0) return '';
    if (typeof pluginBlocks === 'undefined' || !pluginBlocks.length) {
        return ids.map(function (id) { return 'Plugin ' + id; }).join(' → ');
    }
    var names = [];
    ids.forEach(function (id) {
        for (var pi = 0; pi < pluginBlocks.length; pi++) {
            if (pluginBlocks[pi].id === id) { names.push(pluginBlocks[pi].name); return; }
        }
        names.push('Plugin ' + id);
    });
    return names.join(' → ');
}

// Resolve a CSS variable for use in canvas context
var _weqStyleCache = {};
function weqCssVar(name, fallback) {
    if (_weqStyleCache[name]) return _weqStyleCache[name];
    var val = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    if (!val) val = fallback || '#1a1a20';
    _weqStyleCache[name] = val;
    return val;
}
// Invalidate cache on theme change
function weqInvalidateStyleCache() { _weqStyleCache = {}; }

// Frequency ↔ normalized position (log scale)
function weqFreqToX(hz) {
    return Math.log2(Math.max(WEQ_MIN_FREQ, Math.min(WEQ_MAX_FREQ, hz)) / WEQ_MIN_FREQ) / Math.log2(WEQ_MAX_FREQ / WEQ_MIN_FREQ);
}
function weqXToFreq(x) {
    return WEQ_MIN_FREQ * Math.pow(WEQ_MAX_FREQ / WEQ_MIN_FREQ, Math.max(0, Math.min(1, x)));
}

// dB ↔ normalized Y (0=top=+maxDB, 1=bottom=-maxDB) — uses dynamic weqDBRangeMax
function weqDBtoY(db) {
    return 1.0 - (db - (-weqDBRangeMax)) / (weqDBRangeMax * 2);
}
function weqYToDB(y) {
    return (-weqDBRangeMax) + (1.0 - y) * (weqDBRangeMax * 2);
}

// Y position ↔ canvas pixel (with padding)
function weqYtoCanvas(y, H) { return WEQ_Y_PAD + y * (H - 2 * WEQ_Y_PAD); }
function weqCanvasToY(py, H) { return Math.max(0, Math.min(1, (py - WEQ_Y_PAD) / (H - 2 * WEQ_Y_PAD))); }

// Format frequency for display
function weqFmtFreq(hz) {
    if (hz >= 10000) return (hz / 1000).toFixed(1) + 'k';
    if (hz >= 1000) return (hz / 1000).toFixed(1) + 'k';
    return Math.round(hz) + '';
}
function weqFmtDB(db) {
    return (db >= 0 ? '+' : '') + db.toFixed(1);
}

// Compute Q-based band frequency range for a point
// Returns { lo: Hz, hi: Hz } based on filter type and Q
function weqBandRange(pt) {
    var f0 = weqXToFreq(pt.x);

    // ── Split mode: band range from prev point to this point ──
    if (weqSplitMode) {
        var sorted = wrongEqPoints.slice().sort(function (a, b) { return a.x - b.x; });
        var idx = -1;
        for (var i = 0; i < sorted.length; i++) {
            if (sorted[i] === pt) { idx = i; break; }
        }
        if (idx < 0) {
            // Fallback: find by x position
            for (var j = 0; j < sorted.length; j++) {
                if (Math.abs(sorted[j].x - pt.x) < 0.001) { idx = j; break; }
            }
        }
        var lo = (idx > 0) ? weqXToFreq(sorted[idx - 1].x) : 20;
        var hi = f0;
        return { lo: Math.max(20, lo), hi: Math.min(20000, hi) };
    }

    var Q = Math.max(0.025, pt.q || 0.707);
    var type = pt.type || 'Bell';
    if (type === 'LP') return { lo: 20, hi: f0 };
    if (type === 'HP') return { lo: f0, hi: 20000 };
    if (type === 'LShf') return { lo: 20, hi: f0 };
    if (type === 'HShf') return { lo: f0, hi: 20000 };
    // Bell/Notch: exact bandwidth from Cookbook analog prototype relationship:
    // 1/Q = 2*sinh(ln(2)/2 * BW)  →  BW = 2/ln(2) * asinh(1/(2*Q))
    // The old approximation BW ≈ 1/Q was 35% wrong at Q=0.707 (Butterworth).
    var bwOct = (2 / Math.LN2) * Math.asinh(1 / (2 * Q));
    var lo = f0 / Math.pow(2, bwOct / 2);
    var hi = f0 * Math.pow(2, bwOct / 2);
    return { lo: Math.max(20, lo), hi: Math.min(20000, hi) };
}

// Format a band range for display: "500Hz–2kHz"
function weqFmtRange(pt) {
    var r = weqBandRange(pt);
    return weqFmtFreq(r.lo) + '–' + weqFmtFreq(r.hi) + 'Hz';
}

// Update legend chip ranges in-place (no full re-render)
function _weqUpdateLegendRanges() {
    var chips = document.querySelectorAll('.weq-band-range');
    if (chips.length === 0) return;
    var sorted = wrongEqPoints.map(function (p, idx) {
        return { x: p.x, ref: p, origIdx: idx };
    });
    sorted.sort(function (a, b) { return a.x - b.x; });
    var qr = sorted.map(function (lp) { return weqBandRange(lp.ref); });
    for (var oi = 0; oi < qr.length - 1; oi++) {
        if (qr[oi].hi > qr[oi + 1].lo) {
            var mid = Math.sqrt(qr[oi].hi * qr[oi + 1].lo);
            qr[oi].hi = mid;
            qr[oi + 1].lo = mid;
        }
    }
    for (var ci = 0; ci < qr.length && ci < chips.length; ci++) {
        chips[ci].textContent = weqFmtFreq(qr[ci].lo) + '–' + weqFmtFreq(qr[ci].hi);
    }
}

// ── State ──
var weqTool = 'draw';
var weqGrid = 'free'; // 'free','oct','1/3oct','semi'
var weqSelectedPt = -1;
var weqDragPt = -1;
var weqDragAxis = null; // 'h','v' when shift held during drag
var weqGlobalInterp = 'smooth';
var weqGlobalDepth = 100;
var weqGlobalWarp = 0;
var weqGlobalSteps = 0;
var weqGlobalTilt = 0;   // -100 to +100: tilt spectrum (+ = boost highs, cut lows)


var weqGlobalBypass = false;
var weqUnassignedMode = 1;  // Always 1 (global post-EQ inserts). Per-plugin bypass handles individual skipping.
var weqPreEq = true;        // DEPRECATED: now per-point (pt.preEq). Kept for backward compat loading.
var weqFocusBand = -1; // which band row is focused/highlighted on canvas (-1 = none)
var weqDBRangeMax = 24; // max dB for canvas display/limits: 6, 12, 18, 24, 36, 48
var weqSplitMode = false; // Split mode: show visible band zones on canvas with draggable crossover dividers
var weqOversample = 1;    // EQ oversampling: 1=off, 2=2×, 4=4×
var _weqSplitSavedGains = null; // Saved gains before entering split mode (for undo-like restore)

// ── EQ Undo/Redo System ──
// Snapshots the full EQ state (points, globals, split mode) so Ctrl+Z works.
var _weqUndoStack = [];
var _weqRedoStack = [];
var _weqMaxUndo = 40;

function _weqSnapshotState() {
    return {
        points: wrongEqPoints.map(function (p) {
            return { uid: p.uid, x: p.x, y: p.y, q: p.q, type: p.type, solo: p.solo, mute: p.mute, drift: p.drift, preEq: p.preEq, stereoMode: p.stereoMode, slope: p.slope || 1, pluginIds: (p.pluginIds || []).slice(), seg: p.seg };
        }),
        splitMode: weqSplitMode,
        depth: weqGlobalDepth,
        warp: weqGlobalWarp,
        steps: weqGlobalSteps,
        tilt: weqGlobalTilt,
        bypass: weqGlobalBypass,
        dbRange: weqDBRangeMax
    };
}

function _weqRestoreSnapshot(snap) {
    wrongEqPoints = snap.points.map(function (p) {
        return { uid: p.uid, x: p.x, y: p.y, q: p.q, type: p.type, solo: p.solo || false, mute: p.mute || false, drift: p.drift || 0, preEq: p.preEq !== false, stereoMode: p.stereoMode || 0, slope: p.slope || 1, pluginIds: (p.pluginIds || []).slice(), seg: p.seg || null };
    });
    // Sync uid counter
    var maxUid = 0;
    wrongEqPoints.forEach(function (pt) { if (pt.uid > maxUid) maxUid = pt.uid; });
    if (maxUid >= _weqNextUid) _weqNextUid = maxUid + 1;
    weqSplitMode = snap.splitMode;
    if (snap.depth != null) weqGlobalDepth = snap.depth;
    if (snap.warp != null) weqGlobalWarp = snap.warp;
    if (snap.steps != null) weqGlobalSteps = snap.steps;
    if (snap.tilt != null) weqGlobalTilt = snap.tilt;
    if (snap.bypass != null) weqGlobalBypass = snap.bypass;
    if (snap.dbRange != null) weqDBRangeMax = snap.dbRange;
    // Update animation bases
    weqAnimBaseY = wrongEqPoints.map(function (p) { return p.y; });
    weqAnimBaseX = wrongEqPoints.map(function (p) { return p.x; });
    _weqSyncPluginBusIds();
    weqRenderPanel();
    weqSyncToHost();
    if (typeof markStateDirty === 'function') markStateDirty();
}

function _weqPushUndo() {
    _weqUndoStack.push(_weqSnapshotState());
    if (_weqUndoStack.length > _weqMaxUndo) _weqUndoStack.shift();
    _weqRedoStack = []; // new action clears redo
}

function _weqPerformUndo() {
    if (_weqUndoStack.length === 0) return;
    _weqRedoStack.push(_weqSnapshotState());
    var snap = _weqUndoStack.pop();
    _weqRestoreSnapshot(snap);
}

function _weqPerformRedo() {
    if (_weqRedoStack.length === 0) return;
    _weqUndoStack.push(_weqSnapshotState());
    var snap = _weqRedoStack.pop();
    _weqRestoreSnapshot(snap);
}

// Sync pluginBlocks[].busId from wrongEqPoints[].pluginIds.
// Called after any EQ routing change to keep the main plugin rack in sync.
function _weqSyncPluginBusIds() {
    if (typeof pluginBlocks === 'undefined' || !pluginBlocks.length) return;
    // Build pluginId → band UID map from EQ points
    var idToUid = {};
    for (var pi = 0; pi < wrongEqPoints.length; pi++) {
        var ids = wrongEqPoints[pi].pluginIds || [];
        var uid = wrongEqPoints[pi].uid || 0;
        for (var ii = 0; ii < ids.length; ii++) {
            idToUid[ids[ii]] = uid;
        }
    }
    var busFn = (window.__JUCE__ && window.__JUCE__.backend) ? window.__juceGetNativeFunction('setPluginBus') : null;
    for (var bi = 0; bi < pluginBlocks.length; bi++) {
        var pb = pluginBlocks[bi];
        var newBus = idToUid[pb.id] != null ? idToUid[pb.id] : 0;
        if ((pb.busId || 0) !== newBus) {
            pb.busId = newBus;
            if (busFn) busFn(pb.hostId !== undefined ? pb.hostId : pb.id, newBus);
        }
    }
    if (typeof renderAllPlugins === 'function') renderAllPlugins();
    if (typeof saveUiStateToHost === 'function') saveUiStateToHost();
}
var weqSegSel = new Set(); // segment selection: set of band indices for multi-select operations

// ── EQ Preset state ──
var _weqCurrentPreset = null; // current loaded preset name (null = Init)
var _weqPresetList = [];      // cached list of preset names from disk

// ── Stable point UIDs ──
// Each EQ point gets a unique, permanent uid on creation.
// This uid is used as busId for plugin routing — never changes when points are
// added, removed, or reordered. Prevents the bug where adding a new point
// caused assigned plugins to jump to a different band.
var _weqNextUid = 1;
function _weqAllocUid() { return _weqNextUid++; }
// Ensure a point has a uid (backward compat for loaded data without uids)
function _weqEnsureUid(pt) {
    if (!pt.uid) pt.uid = _weqAllocUid();
    return pt;
}
// Stable color for a point — based on its UID, never changes on reorder.
// Band 0 (below first crossover) has no owning point, so use index 0 color.
function _weqPointColor(pt) {
    _weqEnsureUid(pt);
    return WEQ_BAND_COLORS[(pt.uid - 1) % WEQ_BAND_COLORS.length];
}
// Color for a band by its owning point (or band-0 fallback)
// sortedPts = array of point objects sorted by X. Band i+1 is owned by sortedPts[i].
function _weqBandColor(bandIdx, sortedPts) {
    if (bandIdx === 0) return WEQ_BAND_COLORS[0]; // sub-band below all crossovers
    var pt = sortedPts[bandIdx - 1];
    return pt ? _weqPointColor(pt) : WEQ_BAND_COLORS[bandIdx % WEQ_BAND_COLORS.length];
}

// ── Spectrum analyzer ──
var weqSpectrumBins = null;   // Float32Array of dB values (log-spaced bins 20-20kHz)
var weqSpectrumSmooth = null; // smoothed version for drawing

// Called from C++ to provide FFT data: array of dB values mapped to log-spaced freq bins
function weqSetSpectrum(binArray) {
    if (!binArray || binArray.length === 0) return;
    if (!weqSpectrumBins || weqSpectrumBins.length !== binArray.length) {
        weqSpectrumBins = new Float32Array(binArray);
        weqSpectrumSmooth = new Float32Array(binArray);
    } else {
        for (var i = 0; i < binArray.length; i++) {
            weqSpectrumBins[i] = binArray[i];
            // Exponential smoothing (fall slower than rise)
            var target = binArray[i];
            var curr = weqSpectrumSmooth[i];
            weqSpectrumSmooth[i] = target > curr ? curr + (target - curr) * 0.6 : curr + (target - curr) * 0.15;
        }
    }
}
// ── Animation state ──
var weqAnimSpeed = 0;       // Hz — 0 = static, >0 = animate curve
var weqAnimDepth = 6;       // dB modulation depth (how much gains oscillate)
var weqAnimPhase = 0;       // current phase 0-1 (wraps)
var weqAnimRafId = null;    // requestAnimationFrame ID
var weqAnimLastTime = 0;    // last frame timestamp
var weqAnimBaseY = [];      // snapshot of base Y values (user-drawn positions)
var weqAnimShape = 'sine';  // LFO waveform shape

// ── LFO Shape Definitions ──
// Each shape takes phase (0-1) and returns bipolar value (-1 to +1)
var WEQ_LFO_SHAPES = {
    'sine': { label: 'Sine', icon: '∿', fn: function (p) { return Math.sin(p * Math.PI * 2); } },
    'tri': { label: 'Triangle', icon: '△', fn: function (p) { return 1 - 4 * Math.abs(((p + 0.25) % 1) - 0.5); } },
    'saw': { label: 'Saw Up', icon: '⟋', fn: function (p) { return 2 * (p % 1) - 1; } },
    'sawdn': { label: 'Saw Down', icon: '⟍', fn: function (p) { return 1 - 2 * (p % 1); } },
    'square': { label: 'Square', icon: '⊓', fn: function (p) { return (p % 1) < 0.5 ? 1 : -1; } },
    'pulse': { label: 'Pulse 25%', icon: '⌐', fn: function (p) { return (p % 1) < 0.25 ? 1 : -1; } },
    'tanhsat': { label: 'Tanh Sat', icon: '⌢', fn: function (p) { var s = Math.sin(p * Math.PI * 2); return Math.tanh(s * 2.5) / Math.tanh(2.5); } },
    'rectified': { label: 'Rectified', icon: '⌒', fn: function (p) { return Math.abs(Math.sin(p * Math.PI * 2)) * 2 - 1; } },
    'harm2': { label: 'Sine+2nd', icon: '⏝', fn: function (p) { return Math.sin(p * Math.PI * 2) + 0.3 * Math.sin(p * Math.PI * 4); } },
    'steps4': { label: 'Stepped 4', icon: '⊟', fn: function (p) { return Math.round(Math.sin(p * Math.PI * 2) * 4) / 4; } },
    'steps8': { label: 'Stepped 8', icon: '⊞', fn: function (p) { return Math.round(Math.sin(p * Math.PI * 2) * 8) / 8; } },
    'sah': { label: 'S&H', icon: '⫾', fn: function (p) { return _weqHashI(Math.floor(p * 4) * 73 + 17); } },
    'noise': { label: 'Smooth Noise', icon: '⁘', fn: function (p) { return _weqSmoothNoise(p * 4); } },
    'multilayer': { label: 'Multi-Layer', icon: '★', fn: function (p) { return _weqSmoothNoise(p * 3) * 0.5 + _weqSmoothNoise(p * 7.3 + 3.1) * 0.3 + _weqHashI(Math.floor(p * 6) * 41) * 0.2; } },
    'cubic': { label: 'Cubic Sine', icon: '◠', fn: function (p) { var s = Math.sin(p * Math.PI * 2); return s * s * s; } }
};
var WEQ_LFO_SHAPE_KEYS = Object.keys(WEQ_LFO_SHAPES);

// ── Drift Texture Modes ──
var weqDriftTexture = 'smooth'; // drift character / texture
var WEQ_DRIFT_TEXTURES = {
    'smooth': { label: 'Smooth', desc: 'Dual sine, low harmonics' },
    'wander': { label: 'Wander', desc: 'Hermite noise, slow rate' },
    'jitter': { label: 'Jitter', desc: 'High-rate noise + hash' },
    'drunk': { label: 'Drunk', desc: 'Layered noise, low correlation' },
    'stutter': { label: 'Stutter', desc: 'Quantized hold + glide' },
    'chaos': { label: 'Chaos', desc: '5-layer noise + sine + hash' }
};
var WEQ_DRIFT_TEXTURE_KEYS = Object.keys(WEQ_DRIFT_TEXTURES);

// Evaluate drift texture at given phase with per-point seed
function _weqDriftEval(texture, phase, seed) {
    var p = phase;
    switch (texture) {
        case 'smooth':
            return Math.sin(p * Math.PI * 2) * 0.7 + Math.sin(p * Math.PI * 2 * 2.17 + 1.3) * 0.3;
        case 'wander':
            return _weqSmoothNoise(p * 2 + seed * 0.1) * 0.6 + _weqSmoothNoise(p * 0.7 + seed * 0.3) * 0.4;
        case 'jitter':
            return _weqSmoothNoise(p * 9.3 + seed) * 0.4 + _weqSmoothNoise(p * 17 + seed * 2) * 0.35 + _weqHashI(Math.floor(p * 12) * 41 + seed) * 0.25;
        case 'drunk':
            // Brownian-style: accumulate small random steps (simulated via layered noise)
            return _weqSmoothNoise(p * 1.5 + seed * 0.7) * 0.5 + _weqSmoothNoise(p * 3.7 + seed * 1.3) * 0.3 + _weqSmoothNoise(p * 0.4 + seed * 2.1) * 0.2;
        case 'stutter':
            // Stepped random: hold value for a period then jump
            var stepIdx = Math.floor(p * 6);
            var stepVal = _weqHashI(stepIdx * 73 + seed * 11);
            var nextVal = _weqHashI((stepIdx + 1) * 73 + seed * 11);
            var stepFrac = (p * 6) - stepIdx;
            // Quick cubic-eased glide at step boundaries
            var glide = stepFrac < 0.15 ? stepFrac / 0.15 : 1;
            var eased = 1 - Math.pow(1 - glide, 3);
            return stepVal + (nextVal - stepVal) * eased;
        case 'chaos':
            return _weqSmoothNoise(p * 4 + seed) * 0.3
                + _weqSmoothNoise(p * 9.3 + seed + 5.7) * 0.25
                + _weqSmoothNoise(p * 17.1 + seed + 11.2) * 0.2
                + _weqHashI(Math.floor(p * 8) * 31 + seed) * 0.15
                + Math.sin(p * Math.PI * 2 * 3.14 + seed) * 0.1;
        default:
            return Math.sin(p * Math.PI * 2);
    }
}

// ── Drift state (from lane module) ──
var weqDrift = 0;           // speed/character: -50..+50 (+slow / -jitter, >70% = sharp)
var weqDriftRange = 5;      // amplitude as % of gain range (0..50)
var weqDriftScale = '1/1';  // musical period for one drift cycle
var weqDriftContinuous = false; // continuous mode: also modulate gain with cursed noise
var weqDriftMode = 'independent'; // 'independent' = each point has own noise (kept for compat)

// ── Modulation Zone (separate frequency limits for gain LFO vs drift) ──
var weqGainLoCut = 20;       // Hz — LFO gain: no modulation below this
var weqGainHiCut = 20000;    // Hz — LFO gain: no modulation above this
var weqDriftLoCut = 20;      // Hz — Drift: no modulation below this
var weqDriftHiCut = 20000;   // Hz — Drift: no modulation above this

// Returns 0 or 1: hard cut at the boundary.
function _weqGainZoneScale(pointX) {
    if (weqGainLoCut <= 20 && weqGainHiCut >= 20000) return 1;
    var freq = weqXToFreq(pointX);
    if (weqGainLoCut > 20 && freq < weqGainLoCut) return 0;
    if (weqGainHiCut < 20000 && freq > weqGainHiCut) return 0;
    return 1;
}
function _weqDriftZoneScale(pointX) {
    if (weqDriftLoCut <= 20 && weqDriftHiCut >= 20000) return 1;
    var freq = weqXToFreq(pointX);
    if (weqDriftLoCut > 20 && freq < weqDriftLoCut) return 0;
    if (weqDriftHiCut < 20000 && freq > weqDriftHiCut) return 0;
    return 1;
}

// ── Q Modulation ──
var weqQModSpeed = 0;        // Hz (0 = off)
var weqQModDepth = 50;       // 0..100 — how much Q changes
var weqQModShape = 'sine';   // shape key
var weqQLoCut = 20;          // Hz — Q mod low cut
var weqQHiCut = 20000;       // Hz — Q mod high cut
var weqAnimBaseQ = [];       // snapshot of base Q values

var WEQ_QMOD_SHAPES = {
    sine: { label: 'Sine', fn: function (p) { return Math.sin(p * Math.PI * 2); } },
    tri: { label: 'Triangle', fn: function (p) { return 2 * Math.abs(2 * (p % 1) - 1) - 1; } },
    saw: { label: 'Saw', fn: function (p) { return 2 * (p % 1) - 1; } },
    square: { label: 'Square', fn: function (p) { return (p % 1) < 0.5 ? 1 : -1; } },
    pulse: { label: 'Pulse', fn: function (p) { var t = p % 1; return t < 0.1 ? Math.sin(t / 0.1 * Math.PI) : 0; } },
    noise: { label: 'Noise', fn: function (p, s) { return _weqSmoothNoise(p * 1.7 + (s || 0) * 3.1) * 0.6 + _weqSmoothNoise(p * 4.3 + (s || 0) * 7.7) * 0.4; } },
    steps: { label: 'Steps', fn: function (p, s) { return _weqHashI(Math.floor(p * 4) * 17 + (s || 0)) * 2 - 1; } },
    scatter: { label: 'Scatter', fn: function (p, s) { return _weqHashI(Math.floor(p * 8) * 31 + (s || 0)) * 2 - 1; } },
    breathe: { label: 'Breathe', fn: function (p) { var t = p % 1; return Math.pow(Math.sin(t * Math.PI), 3); } },
    comb: { label: 'Comb', fn: function (p) { var t = p % 1; return Math.abs(Math.sin(t * Math.PI * 6)) * 2 - 1; } },
    ratchet: { label: 'Ratchet', fn: function (p) { var cyc = Math.floor(p) % 4; var t = p % 1; return (cyc / 3) * Math.abs(Math.sin(t * Math.PI * 2)); } },
    formant: { label: 'Formant', fn: function (p, s) { var f1 = Math.sin(p * Math.PI * 2); var f2 = Math.sin(p * Math.PI * 5.3 + (s || 0)); return f1 * 0.6 + f2 * 0.4; } }
};
var WEQ_QMOD_SHAPE_KEYS = Object.keys(WEQ_QMOD_SHAPES);

function _weqQZoneScale(pointX) {
    if (weqQLoCut <= 20 && weqQHiCut >= 20000) return 1;
    var freq = weqXToFreq(pointX);
    if (weqQLoCut > 20 && freq < weqQLoCut) return 0;
    if (weqQHiCut < 20000 && freq > weqQHiCut) return 0;
    return 1;
}

// ── Drift noise helpers (Hermite-interpolated value noise — matches lane_module.js) ──
function _weqHashI(n) {
    var h = n | 0;
    h = ((h >>> 16) ^ h) | 0; h = Math.imul(h, 0x45d9f3b) | 0;
    h = ((h >>> 16) ^ h) | 0; h = Math.imul(h, 0x45d9f3b) | 0;
    h = ((h >>> 16) ^ h) | 0;
    return ((h & 0xFFFF) / 32768.0) - 1.0;
}
function _weqSmoothNoise(phase) {
    var i0 = Math.floor(phase);
    var frac = phase - i0;
    var v0 = _weqHashI(i0 - 1), v1 = _weqHashI(i0), v2 = _weqHashI(i0 + 1), v3 = _weqHashI(i0 + 2);
    var a = -0.5 * v0 + 1.5 * v1 - 1.5 * v2 + 0.5 * v3;
    var b2 = v0 - 2.5 * v1 + 2.0 * v2 - 0.5 * v3;
    var c = -0.5 * v0 + 0.5 * v2;
    return ((a * frac + b2) * frac + c) * frac + v1;
}

// Start/stop animation loop
var weqAnimBaseX = [];      // snapshot of base X values (for frequency drift travel)

// Single source of truth: does any modulation source need the animation loop?
function _weqNeedsAnim() {
    return weqAnimSpeed > 0
        || (Math.abs(weqDrift) > 0 && weqDriftRange > 0)
        || (weqDriftContinuous && weqDriftRange > 0)
        || (weqQModSpeed > 0 && weqQModDepth > 0);
}

function weqAnimStart() {
    if (weqAnimRafId) return;
    weqAnimBaseY = wrongEqPoints.map(function (p) { return p.y; });
    weqAnimBaseX = wrongEqPoints.map(function (p) { return p.x; });
    weqAnimBaseQ = wrongEqPoints.map(function (p) { return p.q || 0.707; });
    weqAnimLastTime = performance.now();
    _weqDriftTimeAccum = 0;
    weqAnimRafId = requestAnimationFrame(weqAnimTick);
}
function weqAnimStop() {
    if (weqAnimRafId) {
        cancelAnimationFrame(weqAnimRafId);
        weqAnimRafId = null;
    }
    // Restore base positions (both X and Y)
    for (var i = 0; i < wrongEqPoints.length; i++) {
        if (i < weqAnimBaseY.length) wrongEqPoints[i].y = weqAnimBaseY[i];
        if (i < weqAnimBaseX.length) wrongEqPoints[i].x = weqAnimBaseX[i];
        if (i < weqAnimBaseQ.length) wrongEqPoints[i].q = weqAnimBaseQ[i];
    }
    weqAnimPhase = 0;
    _weqDriftTimeAccum = 0;
    weqDrawCanvas();
    weqSyncToHost();
}

var _weqAnimSyncCounter = 0;
var _weqDriftTimeAccum = 0; // accumulated drift time in seconds
function weqAnimTick(now) {
    try {
        var hasSine = weqAnimSpeed > 0;
        var driftAmt = Math.abs(weqDrift) / 50;
        var driftRangeNorm = weqDriftRange / 100;
        var hasDrift = driftAmt > 0.001 && driftRangeNorm > 0.001;
        var hasContinuous = weqDriftContinuous && driftRangeNorm > 0.001;
        var hasQMod = weqQModSpeed > 0 && weqQModDepth > 0;

        if (!hasSine && !hasDrift && !hasContinuous && !hasQMod) { weqAnimStop(); return; }

        var dt = (now - weqAnimLastTime) / 1000;
        if (dt > 0.1) dt = 0.016; // cap delta to prevent huge jumps
        weqAnimLastTime = now;

        // Advance sine phase
        if (hasSine) {
            weqAnimPhase += dt * weqAnimSpeed;
            if (weqAnimPhase > 1) weqAnimPhase -= Math.floor(weqAnimPhase);
        }

        // Advance drift time
        _weqDriftTimeAccum += dt;

        var nPts = wrongEqPoints.length;
        if (nPts === 0) { weqAnimRafId = requestAnimationFrame(weqAnimTick); return; }

        if (weqAnimBaseY.length !== nPts || weqAnimBaseX.length !== nPts || weqAnimBaseQ.length !== nPts) {
            weqAnimBaseY = wrongEqPoints.map(function (p) { return p.y; });
            weqAnimBaseX = wrongEqPoints.map(function (p) { return p.x; });
            weqAnimBaseQ = wrongEqPoints.map(function (p) { return p.q || 0.707; });
        }

        // Compute drift rate and range
        var driftSweepRate = 0, driftSweepWidth = 0;
        if (hasDrift || hasContinuous) {
            var DS_BEAT_MAP = { '1/16': 0.25, '1/8': 0.5, '1/4': 1, '1/2': 2, '1/1': 4, '2/1': 8, '4/1': 16, '8/1': 32, '16/1': 64, '32/1': 128 };
            var driftScaleBeats = DS_BEAT_MAP[weqDriftScale || '1/1'] || 4;
            var driftPeriodSec = driftScaleBeats * 0.5;

            // Rate scales linearly with drift amount (texture is independent)
            driftSweepRate = hasDrift ? (0.05 + driftAmt * 1.95) : 0.15;
            driftSweepRate /= driftPeriodSec;
            driftSweepWidth = (weqDriftRange / 50) * 4.0;
        }


        // Modulate each point
        for (var i = 0; i < nPts; i++) {
            var baseDB = weqYToDB(weqAnimBaseY[i]);
            var baseX = weqAnimBaseX[i];
            var totalModDB = 0;

            // Separate zone scales: gain (vertical) vs drift (horizontal)
            var gainZone = _weqGainZoneScale(baseX);
            var driftZone = _weqDriftZoneScale(baseX);

            if (hasSine && gainZone > 0) {
                var phaseOffset = nPts > 1 ? (i / (nPts - 1)) * 0.5 : 0;
                var shapeFn = (WEQ_LFO_SHAPES[weqAnimShape] || WEQ_LFO_SHAPES.sine).fn;
                totalModDB += shapeFn(weqAnimPhase + phaseOffset) * weqAnimDepth;
            }

            // 2a) Drift = frequency sweep LFO (modulates X position)
            if (hasDrift && driftZone > 0) {
                var ptPhaseOff = _weqHashI(i * 73 + 11) * 0.5;
                var sweepPhase = _weqDriftTimeAccum * driftSweepRate + ptPhaseOff;

                var sweep = _weqDriftEval(weqDriftTexture, sweepPhase, i * 73 + 11);

                var baseFreq = weqXToFreq(baseX);
                var sweepOctaves = sweep * driftSweepWidth;
                var newFreq = baseFreq * Math.pow(2, sweepOctaves);
                newFreq = Math.max(WEQ_MIN_FREQ, Math.min(WEQ_MAX_FREQ, newFreq));
                wrongEqPoints[i].x = weqFreqToX(newFreq);
            } else {
                wrongEqPoints[i].x = baseX;
            }

            // 2b) Continuous = gain noise (modulates Y) — uses gain zone
            if (hasContinuous && gainZone > 0) {
                var gainRate = hasDrift ? driftSweepRate : 0.15;
                var gainSeed = i * 137 + 47;
                var gainPhaseOff = _weqHashI(gainSeed) * 0.7;
                var gainPhase = _weqDriftTimeAccum * gainRate * 0.8 + gainPhaseOff;

                var gainNoise =
                    _weqSmoothNoise(gainPhase * 1.0 + _weqHashI(gainSeed + 1) * 3.0) * 0.35
                    + _weqSmoothNoise(gainPhase * 2.71 + _weqHashI(gainSeed + 2) * 7.0) * 0.30
                    + _weqSmoothNoise(gainPhase * 6.28 + _weqHashI(gainSeed + 3) * 13.0) * 0.20
                    + _weqSmoothNoise(gainPhase * 13.7 + _weqHashI(gainSeed + 4) * 19.0) * 0.15;

                var gainModDB = gainNoise * (weqDriftRange / 50) * 18.0;
                if (hasDrift) gainModDB *= driftAmt;
                totalModDB += gainModDB;
            }

            var newDB = Math.max(-weqDBRangeMax, Math.min(weqDBRangeMax, baseDB + totalModDB));
            wrongEqPoints[i].y = weqDBtoY(newDB);

            // 3) Q modulation
            if (hasQMod && _weqQZoneScale(baseX) > 0) {
                var baseQ = weqAnimBaseQ[i];
                var qSeed = i * 211 + 59;
                var qPhaseOff = nPts > 1 ? (i / (nPts - 1)) * 0.3 : 0;
                var qPhase = _weqDriftTimeAccum * weqQModSpeed + qPhaseOff;
                var qShapeFn = (WEQ_QMOD_SHAPES[weqQModShape] || WEQ_QMOD_SHAPES.sine).fn;
                var qMod = qShapeFn(qPhase, qSeed);
                var qDepthMul = weqQModDepth / 100;
                var qMultiplier = Math.pow(2, qMod * qDepthMul * 2);
                var newQ = Math.max(0.1, Math.min(30, baseQ * qMultiplier));
                wrongEqPoints[i].q = newQ;
            } else if (hasQMod) {
                wrongEqPoints[i].q = weqAnimBaseQ[i];
            }
        }

        // Redraw canvas only when popup is visible (save CPU)
        var overlay = document.getElementById('weqOverlay');
        if (overlay && overlay.classList.contains('visible')) {
            weqDrawCanvas();
        }

        // Sync to C++ at ~10Hz (every 6th frame) — drift only
        _weqAnimSyncCounter++;
        if (_weqAnimSyncCounter >= 6) {
            _weqAnimSyncCounter = 0;
            weqSyncToHost();
            weqSyncVirtualParams();
        }
    } catch (err) {
        // Don't let animation errors break all event handlers
        if (typeof console !== 'undefined') console.warn('weqAnimTick error:', err);
    }

    weqAnimRafId = requestAnimationFrame(weqAnimTick);
}

// ── Render the WrongEQ panel HTML ──
var _weqLastPtCount = -1;
function weqRenderPanel() {
    var el = document.getElementById('weqPanel');
    if (!el) return;

    // Rebuild virtual block when point count changes
    if (_weqVirtualBlock && wrongEqPoints.length !== _weqLastPtCount) {
        _weqLastPtCount = wrongEqPoints.length;
        weqRebuildVirtualBlock();
    }

    // Update plugin card bus dropdowns when band data changes (freq/Q/type)
    // Uses a stamp to avoid expensive re-renders on every animation frame
    if (routingMode === 2 && typeof renderAllPlugins === 'function') {
        var bandStamp = wrongEqPoints.map(function (p) {
            return (p.uid || 0) + ':' + p.x.toFixed(3) + ':' + (p.q || 0.707).toFixed(3) + ':' + (p.type || 'Bell');
        }).join('|');
        if (bandStamp !== weqRenderPanel._lastBandStamp) {
            weqRenderPanel._lastBandStamp = bandStamp;
            renderAllPlugins();
        }
    }

    var h = '';

    // Header
    h += '<div class="weq-header">';
    h += '<div style="display:flex;align-items:center;gap:6px">';
    h += '<span class="weq-title">WRONG<span style="color:var(--accent)">EQ</span></span>';
    h += '<span class="weq-subtitle">' + wrongEqPoints.length + ' points</span>';
    h += '<button class="weq-hdr-btn' + (weqGlobalBypass ? ' on weq-bypass-on' : '') + '" id="weqBypass" title="Bypass all EQ processing">⊘ Bypass</button>';
    h += '</div>';
    h += '<div class="weq-preset-strip">';
    h += '<button class="weq-preset-nav" id="weqPresetPrev" title="Previous preset">◄</button>';
    h += '<button class="weq-preset-name" id="weqPresetName" title="Browse EQ presets">' + (_weqCurrentPreset || 'Init') + '</button>';
    h += '<button class="weq-preset-nav" id="weqPresetNext" title="Next preset">►</button>';
    h += '<button class="weq-hdr-btn" id="weqPresetSave" title="Save EQ preset">Save</button>';
    h += '</div>';
    h += '<div class="weq-header-ctrls">';
    h += '<button class="weq-hdr-btn" id="weqMirrorAll" title="Mirror all gains across 0dB">↕</button>';
    h += '<button class="weq-hdr-btn" id="weqSmoothAll" title="Smooth all — halve gains toward 0dB">∿</button>';
    h += '<button class="weq-hdr-btn" id="weqClear" title="Clear all points">⊘ Clear</button>';
    h += '<button class="weq-hdr-btn" id="weqRandom" title="Random EQ curve">⚄ Random</button>';
    var osLabel = weqOversample === 4 ? '4×' : weqOversample === 2 ? '2×' : 'Off';
    h += '<button class="weq-hdr-btn' + (weqOversample > 1 ? ' on' : '') + '" id="weqOversampleBtn" title="Oversampling — reduces frequency cramping near Nyquist">Oversampling ' + osLabel + '</button>';
    h += '<button class="weq-hdr-btn weq-close-btn" id="weqClose" title="Close (Escape)">×</button>';
    h += '</div>';
    h += '</div>';

    h += '<div class="weq-toolbar">';
    h += '<span class="weq-tlbl">Grid</span>';
    h += '<div class="weq-grid-tabs">';
    ['free', 'oct', '1/3', 'semi'].forEach(function (g) {
        h += '<button class="weq-grid-tab' + (weqGrid === g ? ' on' : '') + '" data-wg="' + g + '">' + (g === 'free' ? 'Free' : g === '1/3' ? '⅓ Oct' : g === 'oct' ? 'Oct' : 'Semi') + '</button>';
    });
    h += '</div>';
    h += '<div style="flex:1"></div>';
    var splitLabel = '⫿ Split';
    if (weqSplitMode && wrongEqPoints.length > 0) splitLabel += ' ×' + (wrongEqPoints.length + 1);
    h += '<button class="weq-ft-btn' + (weqSplitMode ? ' on' : '') + '" id="weqSplitBtn" title="Split mode — divide spectrum into bands for per-band plugin routing (Ctrl+Z to undo)">' + splitLabel + '</button>';
    h += '<button class="weq-ft-btn" id="weqShapes">∿ Shape ▾</button>';
    h += '</div>';

    // Canvas area
    h += '<div class="weq-body-wrap">';
    h += '<div class="weq-body-main">';
    h += '<div class="weq-canvas-area">';
    // Canvas (axis labels are drawn directly on the canvas — no HTML duplicates)
    h += '<div class="weq-canvas-wrap" id="weqCanvasWrap">';
    h += '<canvas id="weqCanvas"></canvas>';
    h += '</div>';
    h += '</div>'; // end weq-canvas-area

    // Band legend — Q-based ranges matching C++ crossover splits
    if (wrongEqPoints.length > 0) {
        // Sort points by position — use base X during animation to avoid jittery labels
        var legendPts = wrongEqPoints.map(function (p, idx) {
            var stableX = (weqAnimRafId && weqAnimBaseX.length > idx) ? weqAnimBaseX[idx] : p.x;
            return { x: stableX, ref: p, origIdx: idx };
        });
        legendPts.sort(function (a, b) { return a.x - b.x; });
        var legendRefs = legendPts.map(function (lp) { return lp.ref; });

        // Compute Q-based [lo, hi] for each sorted point (matching C++ ptLo/ptHi)
        var qRanges = legendPts.map(function (lp) { return weqBandRange(lp.ref); });

        // Handle overlapping Q ranges — same logic as C++:
        // when ptHi[i] > ptLo[i+1], split at geometric midpoint
        for (var oi = 0; oi < qRanges.length - 1; oi++) {
            if (qRanges[oi].hi > qRanges[oi + 1].lo) {
                var mid = Math.sqrt(qRanges[oi].hi * qRanges[oi + 1].lo);
                qRanges[oi].hi = mid;
                qRanges[oi + 1].lo = mid;
            }
        }

        h += '<div class="weq-band-legend">';
        for (var i = 0; i < legendPts.length; i++) {
            var lo = qRanges[i].lo;
            var hi = qRanges[i].hi;
            var col = _weqBandColor(i + 1, legendRefs);
            var hasPlug = legendPts[i].ref.pluginIds && legendPts[i].ref.pluginIds.length > 0;
            h += '<span class="weq-band-chip' + (hasPlug ? ' has-fx' : '') + '">';
            h += '<span class="weq-band-dot" style="background:' + col + '"></span>';
            h += '<span class="weq-band-label">B' + i + '</span>';
            if (!weqSplitMode) {
                var bType = legendPts[i].ref.type || 'Bell';
                h += '<span class="weq-band-type">' + bType + '</span>';
            }
            h += '<span class="weq-band-range">' + weqFmtFreq(lo) + '\u2013' + weqFmtFreq(hi) + '</span>';
            if (hasPlug) h += '<span class="weq-band-fx-dot" title="' + legendPts[i].ref.pluginIds.length + ' plugin(s) routed">●</span>';
            h += '</span>';
        }
        // In split mode: add passthrough zone chip
        if (weqSplitMode && legendPts.length > 0) {
            var lastPtFreq = weqXToFreq(legendPts[legendPts.length - 1].x);
            h += '<span class="weq-band-chip weq-band-pass">';
            h += '<span class="weq-band-range">' + weqFmtFreq(lastPtFreq) + '\u2013' + weqFmtFreq(20000) + ' pass</span>';
            h += '</span>';
        }
        h += '</div>';
    }

    h += '</div>'; // end weq-body-main

    // ── SIDE PANEL — Modulation Controls ──
    h += '<div class="weq-side-panel" id="weqSidePanel">';

    // ─── CURVE section ───
    h += '<div class="weq-sp-section">';
    h += '<div class="weq-sp-title">Curve</div>';
    h += '<div class="weq-sp-row"><span class="weq-sp-label">Dep</span><span class="weq-sp-knob" data-wk="depth" title="Depth — scales all band gains, dbl-click reset">' + weqGlobalDepth + '%</span></div>';
    h += '<div class="weq-sp-row"><span class="weq-sp-label">Wrp</span><span class="weq-sp-knob" data-wk="warp" title="Warp — S-curve contrast, dbl-click reset">' + (weqGlobalWarp >= 0 ? '+' : '') + weqGlobalWarp + '</span></div>';
    h += '<div class="weq-sp-row"><span class="weq-sp-label">Stp</span><span class="weq-sp-knob" data-wk="steps" title="Steps — quantize gain levels, dbl-click reset">' + (weqGlobalSteps || 'Off') + '</span></div>';
    h += '<div class="weq-sp-row"><span class="weq-sp-label">Tlt</span><span class="weq-sp-knob" data-wk="tilt" title="Tilt — tilt spectrum (+ highs / − lows), dbl-click reset">' + (weqGlobalTilt >= 0 ? '+' : '') + weqGlobalTilt + '</span></div>';
    h += '</div>';



    // ─── DRIFT section (freq sweep only — independent operation) ───
    var driftActive = Math.abs(weqDrift) > 0 && weqDriftRange > 0;
    h += '<div class="weq-sp-section">';
    h += '<div class="weq-sp-title">Drift</div>';
    h += '<div class="weq-sp-row"><span class="weq-sp-label">Spd</span><span class="weq-sp-knob' + (driftActive ? ' weq-anim-on' : '') + '" data-wk="drift" title="Drift — freq sweep speed (+smooth / −jitter), dbl-click reset">' + (weqDrift >= 0 ? '+' : '') + weqDrift + '</span></div>';
    h += '<div class="weq-sp-row"><span class="weq-sp-label">Rng</span><span class="weq-sp-knob' + (driftActive ? ' weq-anim-on' : '') + '" data-wk="driftRange" title="Drift Range — sweep width 0-4 oct, dbl-click reset">' + weqDriftRange + '%</span></div>';
    h += '<div class="weq-sp-row"><span class="weq-sp-label">Scl</span><select class="weq-sp-sel" data-wf="driftScale" title="Drift Scale — musical period">';
    var DS_WEQ_OPTS = ['1/16', '1/8', '1/4', '1/2', '1/1', '2/1', '4/1', '8/1', '16/1', '32/1'];
    var DS_WEQ_LABELS = { '1/1': '1 bar', '2/1': '2 bars', '4/1': '4 bars', '8/1': '8 bars', '16/1': '16 bars', '32/1': '32 bars' };
    DS_WEQ_OPTS.forEach(function (dv) {
        h += '<option value="' + dv + '"' + (weqDriftScale === dv ? ' selected' : '') + '>' + (DS_WEQ_LABELS[dv] || dv) + '</option>';
    });
    h += '</select></div>';
    h += '<div class="weq-sp-row"><span class="weq-sp-label">Tex</span><select class="weq-sp-sel" data-wf="driftTexture" title="Drift texture — frequency modulation character">';
    WEQ_DRIFT_TEXTURE_KEYS.forEach(function (tk) {
        h += '<option value="' + tk + '"' + (weqDriftTexture === tk ? ' selected' : '') + '>' + WEQ_DRIFT_TEXTURES[tk].label + '</option>';
    });
    h += '</select></div>';
    h += '<div class="weq-sp-row">';
    h += '<button class="weq-sp-toggle' + (weqDriftContinuous ? ' on weq-anim-on' : '') + '" id="weqContinuous" title="Continuous — also modulate gain with complex noise">∿ Cont</button>';
    h += '</div>';
    h += '<div class="weq-sp-row"><span class="weq-sp-label">Lo</span><span class="weq-sp-knob' + (weqDriftLoCut > 20 ? ' weq-anim-on' : '') + '" data-wk="driftLo" title="Drift low cut, dbl-click reset">' + (weqDriftLoCut > 20 ? weqFmtFreq(weqDriftLoCut) : 'Off') + '</span></div>';
    h += '<div class="weq-sp-row"><span class="weq-sp-label">Hi</span><span class="weq-sp-knob' + (weqDriftHiCut < 20000 ? ' weq-anim-on' : '') + '" data-wk="driftHi" title="Drift high cut, dbl-click reset">' + (weqDriftHiCut < 20000 ? weqFmtFreq(weqDriftHiCut) : 'Off') + '</span></div>';
    h += '</div>';

    // ─── LFO section ───
    h += '<div class="weq-sp-section">';
    h += '<div class="weq-sp-title">LFO</div>';
    var _spdDisp = weqAnimSpeed > 0 ? (weqAnimSpeed < 1 ? weqAnimSpeed.toFixed(2) + 'Hz' : weqAnimSpeed.toFixed(1) + 'Hz') : 'Off';
    h += '<div class="weq-sp-row"><span class="weq-sp-label">Rate</span><span class="weq-sp-knob' + (weqAnimSpeed > 0 ? ' weq-anim-on' : '') + '" data-wk="speed" title="LFO rate (Hz), dbl-click to stop">' + _spdDisp + '</span></div>';
    h += '<div class="weq-sp-row"><span class="weq-sp-label">Dep</span><span class="weq-sp-knob' + (weqAnimDepth > 0 && weqAnimSpeed > 0 ? ' weq-anim-on' : '') + '" data-wk="mod" title="LFO depth (dB), dbl-click reset">' + weqAnimDepth + 'dB</span></div>';
    h += '<div class="weq-sp-row"><span class="weq-sp-label">Shp</span><select class="weq-sp-sel" data-wf="lfoShape" title="LFO waveform shape">';
    WEQ_LFO_SHAPE_KEYS.forEach(function (sk) {
        var sh = WEQ_LFO_SHAPES[sk];
        h += '<option value="' + sk + '"' + (weqAnimShape === sk ? ' selected' : '') + '>' + sh.icon + ' ' + sh.label + '</option>';
    });
    h += '</select></div>';
    h += '<div class="weq-sp-row"><span class="weq-sp-label">Lo</span><span class="weq-sp-knob' + (weqGainLoCut > 20 ? ' weq-anim-on' : '') + '" data-wk="gainLo" title="Gain LFO low cut, dbl-click reset">' + (weqGainLoCut > 20 ? weqFmtFreq(weqGainLoCut) : 'Off') + '</span></div>';
    h += '<div class="weq-sp-row"><span class="weq-sp-label">Hi</span><span class="weq-sp-knob' + (weqGainHiCut < 20000 ? ' weq-anim-on' : '') + '" data-wk="gainHi" title="Gain LFO high cut, dbl-click reset">' + (weqGainHiCut < 20000 ? weqFmtFreq(weqGainHiCut) : 'Off') + '</span></div>';
    h += '</div>';

    // ─── Q MOD section ───
    var qModActive = weqQModSpeed > 0 && weqQModDepth > 0;
    h += '<div class="weq-sp-section">';
    h += '<div class="weq-sp-title">Q Mod</div>';
    var _qSpdDisp = weqQModSpeed > 0 ? (weqQModSpeed < 1 ? weqQModSpeed.toFixed(2) + 'Hz' : weqQModSpeed.toFixed(1) + 'Hz') : 'Off';
    h += '<div class="weq-sp-row"><span class="weq-sp-label">Rate</span><span class="weq-sp-knob' + (qModActive ? ' weq-anim-on' : '') + '" data-wk="qSpeed" title="Q modulation rate (Hz), dbl-click to stop">' + _qSpdDisp + '</span></div>';
    h += '<div class="weq-sp-row"><span class="weq-sp-label">Dep</span><span class="weq-sp-knob' + (qModActive ? ' weq-anim-on' : '') + '" data-wk="qDepth" title="Q modulation depth (%), dbl-click reset">' + weqQModDepth + '%</span></div>';
    h += '<div class="weq-sp-row"><span class="weq-sp-label">Shp</span><select class="weq-sp-sel" data-wf="qShape" title="Q modulation waveform">';
    WEQ_QMOD_SHAPE_KEYS.forEach(function (qk) {
        var qs = WEQ_QMOD_SHAPES[qk];
        h += '<option value="' + qk + '"' + (weqQModShape === qk ? ' selected' : '') + '>' + qs.label + '</option>';
    });
    h += '</select></div>';
    h += '<div class="weq-sp-row"><span class="weq-sp-label">Lo</span><span class="weq-sp-knob' + (weqQLoCut > 20 ? ' weq-anim-on' : '') + '" data-wk="qLo" title="Q mod low cut, dbl-click reset">' + (weqQLoCut > 20 ? weqFmtFreq(weqQLoCut) : 'Off') + '</span></div>';
    h += '<div class="weq-sp-row"><span class="weq-sp-label">Hi</span><span class="weq-sp-knob' + (weqQHiCut < 20000 ? ' weq-anim-on' : '') + '" data-wk="qHi" title="Q mod high cut, dbl-click reset">' + (weqQHiCut < 20000 ? weqFmtFreq(weqQHiCut) : 'Off') + '</span></div>';
    h += '</div>';

    // ─── RANGE section ───
    h += '<div class="weq-sp-section">';
    h += '<div class="weq-sp-title">Range</div>';
    h += '<div class="weq-sp-row"><span class="weq-sp-label">dB</span><select class="weq-sp-sel" data-wf="dbRange" title="dB range for the canvas">';
    [6, 12, 18, 24, 36, 48].forEach(function (r) {
        h += '<option value="' + r + '"' + (weqDBRangeMax === r ? ' selected' : '') + '>±' + r + ' dB</option>';
    });
    h += '</select></div>';
    h += '</div>';

    h += '</div>'; // end weq-side-panel
    h += '</div>'; // end weq-body-wrap

    // ── Band Cards (vertical box per band, horizontal scroll) ──
    if (wrongEqPoints.length > 0) {
        var anySoloRow = false;
        for (var sri = 0; sri < wrongEqPoints.length; sri++) if (wrongEqPoints[sri].solo) anySoloRow = true;

        h += '<div class="weq-bands-section">';
        // Segment toolbar inline when 2+ selected (no title header)
        if (weqSegSel.size >= 2) {
            h += '<div class="weq-bands-header">';
            h += '<div class="weq-seg-toolbar-inline">';
            h += '<span class="weq-seg-info">' + weqSegSel.size + ' sel</span>';
            h += '<button class="weq-seg-btn" data-segop="fill" title="Fill">Fill</button>';
            h += '<button class="weq-seg-btn" data-segop="mirror" title="Mirror">Mirror</button>';
            h += '<button class="weq-seg-btn" data-segop="randomize" title="Rand">Rand</button>';
            h += '<button class="weq-seg-btn" data-segop="shape" title="Shape">Shape ▾</button>';
            h += '<button class="weq-seg-btn" data-segop="fade" title="Fade">Fade</button>';
            h += '<button class="weq-seg-btn" data-segop="normalize" title="Normalize">Norm</button>';
            h += '<button class="weq-seg-btn" data-segop="flatten" title="Flatten">Flat</button>';
            h += '<button class="weq-seg-btn weq-seg-clear" data-segop="clear" title="Clear">✕</button>';
            h += '</div>';
            h += '</div>';
        }

        // ── Row container: routing sidebar + band cards ──
        h += '<div class="weq-bands-row">';

        // ── Routing sidebar: vertical tab + collapsible panel ──
        var _rpGlobalPlugins = [];
        var _rpGlobalCount = 0;
        if (typeof pluginBlocks !== 'undefined' && pluginBlocks.length > 0) {
            var _assignedIds = new Set();
            for (var _ai = 0; _ai < wrongEqPoints.length; _ai++) {
                var _aids = wrongEqPoints[_ai].pluginIds || [];
                for (var _aii = 0; _aii < _aids.length; _aii++) _assignedIds.add(_aids[_aii]);
            }
            for (var _gpi = 0; _gpi < pluginBlocks.length; _gpi++) {
                var _gp = pluginBlocks[_gpi];
                if (_gp && _gp.id != null && !_gp.isVirtual && !_assignedIds.has(_gp.id)) {
                    _rpGlobalPlugins.push(_gp);
                }
            }
            _rpGlobalCount = _rpGlobalPlugins.length;
        }

        var rpOpen = window._weqRoutingPanelOpen || false;
        h += '<div class="weq-routing-sidebar' + (rpOpen ? ' open' : '') + '">';
        h += '<div class="weq-routing-tab" id="weqRoutingTab" title="Toggle routing panel">';
        h += '<span class="weq-routing-tab-label">R O U T I N G</span>';
        if (_rpGlobalCount > 0) h += '<span class="weq-routing-tab-badge">' + _rpGlobalCount + '</span>';
        h += '</div>';
        h += '<div class="weq-routing-panel-content">';
        // ── Signal chain header ──
        h += '<div class="weq-global-header">';
        h += '<span class="weq-global-title">Signal Chain</span>';
        h += '</div>';

        // ── WrongEQ — always first in chain, non-removable ──
        var _weqBypassed = typeof weqGlobalBypass !== 'undefined' && weqGlobalBypass;
        h += '<div class="weq-chain-list">';
        h += '<div class="weq-chain-item weq-chain-eq' + (_weqBypassed ? ' bypassed' : '') + '">';
        h += '<span class="weq-chain-icon">◆</span>';
        h += '<span class="weq-chain-name">WrongEQ</span>';
        h += '<span class="weq-chain-info">' + wrongEqPoints.length + ' band' + (wrongEqPoints.length !== 1 ? 's' : '') + '</span>';
        h += '</div>';

        // ── Chain arrow ──
        h += '<div class="weq-chain-arrow">↓</div>';

        // ── Global Inserts section ──
        h += '<div class="weq-chain-section-hdr">';
        h += '<span class="weq-chain-section-label">Post-EQ Inserts</span>';
        h += '</div>';

        if (_rpGlobalCount > 0) {
            for (var _gli = 0; _gli < _rpGlobalPlugins.length; _gli++) {
                var _glp = _rpGlobalPlugins[_gli];
                var _glpByp = !!_glp.bypassed;
                h += '<div class="weq-global-row' + (_glpByp ? ' bypassed' : '') + '">';
                h += '<span class="weq-global-name" title="' + _glp.name + '">' + _glp.name + '</span>';
                h += '<button class="weq-routing-byp' + (_glpByp ? ' on' : '') + '" data-weqplugbypass="' + _glp.id + '" title="' + (_glpByp ? 'Unbypass' : 'Bypass') + '">BYP</button>';
                h += '<button class="weq-routing-ui" data-weqplugopen="' + _glp.id + '" title="Open UI">UI</button>';
                h += '<button class="weq-routing-assign-band" data-weqglobalassign="' + _glp.id + '" title="Assign to a band">→ Band</button>';
                h += '<button class="weq-routing-rm" data-weqglobalrm="' + _glp.id + '" title="Remove plugin">×</button>';
                h += '</div>';
            }
        } else {
            h += '<div class="weq-routing-empty" style="font-size:9px">No post-EQ plugins</div>';
        }
        h += '</div>'; // end chain list
        // Add plugin button for global section
        h += '<div class="weq-routing-actions" style="padding:4px 6px">';
        h += '<button class="weq-routing-load" id="weqGlobalLoad" title="Load new plugin (unassigned)">+ Load</button>';
        h += '</div>';
        h += '</div>'; // end panel content
        h += '</div>'; // end routing sidebar

        h += '<div class="weq-bands-scroll">';

        // Sort band cards by frequency (left-to-right matches canvas)
        var _bandOrder = [];
        for (var _bi = 0; _bi < wrongEqPoints.length; _bi++) _bandOrder.push(_bi);
        _bandOrder.sort(function (a, b) {
            var ax = (weqAnimRafId && weqAnimBaseX.length > a) ? weqAnimBaseX[a] : wrongEqPoints[a].x;
            var bx = (weqAnimRafId && weqAnimBaseX.length > b) ? weqAnimBaseX[b] : wrongEqPoints[b].x;
            return ax - bx;
        });

        for (var _boi = 0; _boi < _bandOrder.length; _boi++) {
            var ri = _bandOrder[_boi];
            var pt = wrongEqPoints[ri];
            var col = _weqPointColor(pt);
            var isSoloed = pt.solo;
            var isMuted = pt.mute;
            var dimmed = isMuted || (anySoloRow && !isSoloed);

            var displayX = (weqAnimRafId && weqAnimBaseX.length > ri) ? weqAnimBaseX[ri] : pt.x;
            var displayY = (weqAnimRafId && weqAnimBaseY.length > ri) ? weqAnimBaseY[ri] : pt.y;
            var rFreq = weqXToFreq(displayX);
            var rGain = weqYToDB(displayY);
            var rQ = pt.q != null ? pt.q : 0.707;
            var rType = pt.type || 'Bell';
            var isSegSelected = weqSegSel.has(ri);
            var ptPreEq = pt.preEq !== false;

            var classes = 'weq-band-card';
            if (dimmed) classes += ' dimmed';
            if (isMuted) classes += ' muted';
            if (isSoloed) classes += ' soloed';
            if (weqSelectedPt === ri) classes += ' focused';
            if (isSegSelected) classes += ' seg-sel';

            // Wrap card + strip in a unit container
            h += '<div class="weq-band-unit">';
            h += '<div class="' + classes + '" data-bandidx="' + ri + '" style="--band-color:' + col + '">';

            // ── Top accent bar ──
            h += '<div class="weq-card-accent" style="background:' + col + '"></div>';

            // ── Card header: band number + controls ──
            h += '<div class="weq-card-head">';
            h += '<span class="weq-card-num">' + (ri + 1) + '</span>';
            h += '<button class="weq-seg-chk' + (isSegSelected ? ' on' : '') + '" data-weqseg="' + ri + '" title="Segment select">✓</button>';
            h += '<div class="weq-card-head-spacer"></div>';
            h += '<button class="weq-s-btn' + (isSoloed ? ' on solo' : '') + '" data-weqsolo="' + ri + '" title="Solo">S</button>';
            h += '<button class="weq-s-btn' + (isMuted ? ' on mute' : '') + '" data-weqmute="' + ri + '" title="Mute">M</button>';
            h += '<button class="weq-s-btn del" data-weqdel="' + ri + '" title="Delete">×</button>';
            h += '</div>';

            // ── Type selector ──
            var types = ['LP', 'HP', 'Bell', 'Notch', 'LS', 'HS'];
            var typeMap = { 'LP': 'LP', 'HP': 'HP', 'Bell': 'Bell', 'Notch': 'Notch', 'LS': 'LShf', 'HS': 'HShf' };
            h += '<div class="weq-card-types">';
            for (var ti = 0; ti < types.length; ti++) {
                var tLabel = types[ti];
                var tVal = typeMap[tLabel];
                var isActive = (rType === tVal) ? ' active' : '';
                h += '<button class="weq-type-btn' + isActive + '" data-weqtypeset="' + ri + ':' + tVal + '" title="' + tVal + '">' + tLabel + '</button>';
            }
            h += '</div>';

            // ── Slope selector (12/24/48 dB/oct) ──
            var ptSlope = pt.slope || 1;
            h += '<div class="weq-card-types weq-card-slope">';
            h += '<button class="weq-type-btn' + (ptSlope === 1 ? ' active' : '') + '" data-weqslope="' + ri + ':1" title="12 dB/oct">12</button>';
            h += '<button class="weq-type-btn' + (ptSlope === 2 ? ' active' : '') + '" data-weqslope="' + ri + ':2" title="24 dB/oct">24</button>';
            h += '<button class="weq-type-btn' + (ptSlope === 4 ? ' active' : '') + '" data-weqslope="' + ri + ':4" title="48 dB/oct">48</button>';
            h += '</div>';

            // ── Frequency — hero value (draggable) ──
            h += '<div class="weq-card-freq" data-weqfreq="' + ri + '" title="Drag ↕ frequency">' + weqFmtFreq(rFreq) + '</div>';

            // ── Gain + Q — labeled param boxes ──
            h += '<div class="weq-card-params">';
            if (rType === 'LP' || rType === 'HP') {
                var slopeDB = (ptSlope || 1) * 12;
                h += '<div class="weq-card-param-box"><span class="weq-card-plbl">GAIN</span><span class="weq-card-pval slope">' + slopeDB + 'dB/o</span></div>';
            } else {
                var gCls = rGain > 0.1 ? ' boost' : (rGain < -0.1 ? ' cut' : '');
                h += '<div class="weq-card-param-box"><span class="weq-card-plbl">GAIN</span><span class="weq-card-pval' + gCls + '" data-weqgain="' + ri + '" title="Drag ↕ gain">' + weqFmtDB(rGain) + '</span></div>';
            }
            h += '<div class="weq-card-param-box"><span class="weq-card-plbl">Q</span><span class="weq-card-pval" data-weqq="' + ri + '" title="Drag ↕ Q">' + rQ.toFixed(2) + '</span></div>';
            h += '</div>';

            // ── Stereo + Mode row ──
            h += '<div class="weq-card-mode-row">';
            var sm = pt.stereoMode || 0;
            h += '<div class="weq-card-stereo">';
            h += '<button class="weq-ms-btn' + (sm === 0 ? ' active' : '') + '" data-weqstereo="' + ri + ':0" title="Stereo">LR</button>';
            h += '<button class="weq-ms-btn' + (sm === 1 ? ' active' : '') + '" data-weqstereo="' + ri + ':1" title="Mid">M</button>';
            h += '<button class="weq-ms-btn' + (sm === 2 ? ' active' : '') + '" data-weqstereo="' + ri + ':2" title="Side">S</button>';
            h += '</div>';
            h += '<button class="weq-card-mode' + (ptPreEq ? ' on' : '') + '" data-weqpointpreq="' + ri + '" title="Toggle Post-EQ / Split">' + (ptPreEq ? 'EQ' : 'SPL') + '</button>';
            h += '</div>'; // end weq-card-mode-row

            h += '</div>'; // end card

            // ── Vertical strip (+ button, attached to card right) ──
            var bandPlugins = pt.pluginIds || [];
            var plugCount = bandPlugins.length;
            var stripActive = (window._weqRoutingOpen === ri) ? ' active' : '';
            h += '<div class="weq-card-strip' + stripActive + '" data-weqrouting="' + ri + '" title="Routing — ' + plugCount + ' plugin' + (plugCount !== 1 ? 's' : '') + '">';
            h += '<span class="weq-strip-plus">+</span>';
            if (plugCount > 0) h += '<span class="weq-strip-badge">' + plugCount + '</span>';
            h += '</div>';

            h += '</div>'; // end weq-band-unit

            // ── Routing panel (inline, hidden by default) ──
            var panelOpen = (window._weqRoutingOpen === ri);
            h += '<div class="weq-routing-panel' + (panelOpen ? ' open' : '') + '" data-routingband="' + ri + '">';
            h += '<div class="weq-routing-hdr"><span class="weq-routing-title">ROUTING</span><span class="weq-routing-band" style="color:' + col + '">Band ' + (ri + 1) + '</span></div>';
            h += '<div class="weq-routing-scroll">';
            if (plugCount > 0) {
                for (var bpi = 0; bpi < bandPlugins.length; bpi++) {
                    var bpId = bandPlugins[bpi];
                    var bpName = 'Plugin ' + bpId;
                    var bpBypassed = false;
                    for (var pbi = 0; pbi < pluginBlocks.length; pbi++) {
                        if (pluginBlocks[pbi].id === bpId) { bpName = pluginBlocks[pbi].name; bpBypassed = !!pluginBlocks[pbi].bypassed; break; }
                    }
                    h += '<div class="weq-routing-row' + (bpBypassed ? ' bypassed' : '') + '">';
                    h += '<span class="weq-routing-idx">' + (bpi + 1) + '</span>';
                    // Reorder arrows
                    h += '<span class="weq-routing-order">';
                    if (bpi > 0) h += '<button class="weq-routing-mv" data-weqplugmove="' + ri + ':' + bpi + ':up" title="Move up">▲</button>';
                    if (bpi < bandPlugins.length - 1) h += '<button class="weq-routing-mv" data-weqplugmove="' + ri + ':' + bpi + ':down" title="Move down">▼</button>';
                    h += '</span>';
                    h += '<span class="weq-routing-name" title="' + bpName + '">' + bpName + '</span>';
                    h += '<button class="weq-routing-byp' + (bpBypassed ? ' on' : '') + '" data-weqplugbypass="' + bpId + '" title="' + (bpBypassed ? 'Unbypass' : 'Bypass') + '">BYP</button>';
                    h += '<button class="weq-routing-ui" data-weqplugopen="' + bpId + '" title="Open UI">UI</button>';
                    h += '<button class="weq-routing-toglobal" data-weqplugtoglobal="' + ri + ':' + bpId + '" title="Move to Global inserts">→ G</button>';
                    h += '<button class="weq-routing-rm" data-weqplugremove="' + ri + ':' + bpId + '" title="Remove">×</button>';
                    h += '</div>';
                }
            } else {
                h += '<div class="weq-routing-empty">No plugins routed</div>';
            }
            h += '</div>'; // end scroll
            h += '<div class="weq-routing-actions">';
            h += '<button class="weq-routing-assign" data-weqplugassign="' + ri + '" title="Assign loaded plugins">Assign</button>';
            h += '<button class="weq-routing-load" data-weqplugload="' + ri + '" title="Load new plugin">+ Load</button>';
            h += '</div>';
            h += '</div>'; // end routing panel
        }

        h += '</div>'; // end weq-bands-scroll
        h += '</div>'; // end weq-bands-row
        h += '</div>'; // end weq-bands-section
    }

    // Save scroll positions before DOM rebuild
    var savedScroll = el.scrollTop;
    var bandsScroll = el.querySelector('.weq-bands-scroll');
    var savedBandsScroll = bandsScroll ? bandsScroll.scrollLeft : 0;

    el.innerHTML = h;

    // Setup canvas + events
    weqCanvasSetup();
    weqSetupEvents();

    // Restore scroll positions after DOM rebuild
    if (savedScroll > 0) el.scrollTop = savedScroll;
    if (savedBandsScroll > 0) {
        var newBands = el.querySelector('.weq-bands-scroll');
        if (newBands) newBands.scrollLeft = savedBandsScroll;
    }

    // Trigger plugin rack re-render so bus dropdowns reflect EQ point frequencies
    if (typeof renderAllPlugins === 'function') renderAllPlugins();
}

// ── Canvas sizing and initial draw ──
function weqCanvasSetup() {
    var wrap = document.getElementById('weqCanvasWrap');
    var canvas = document.getElementById('weqCanvas');
    if (!wrap || !canvas) return;

    function sizeCanvas() {
        var rect = wrap.getBoundingClientRect();
        var W = Math.round(rect.width);
        if (W < 50) return; // not laid out yet
        var H = WEQ_CANVAS_H;
        wrap.style.height = H + 'px';

        var dpr = window.devicePixelRatio || 1;
        canvas.width = W * dpr;
        canvas.height = H * dpr;
        canvas.style.width = W + 'px';
        canvas.style.height = H + 'px';
        weqDrawCanvas();
    }

    sizeCanvas();

    // ResizeObserver for responsive canvas
    if (typeof ResizeObserver !== 'undefined' && !wrap._weqRO) {
        wrap._weqRO = new ResizeObserver(function () {
            sizeCanvas();
        });
        wrap._weqRO.observe(wrap);
    }
}

// Actual sample rate from C++ (updated via __rt_data__.sr). Default 48kHz until first update.
// Previously hardcoded — caused wrong curve shape at 44.1kHz/96kHz near Nyquist.
var _WEQ_REF_FS = 48000;

function _weqBiquadDB(b0, b1, b2, a0, a1, a2, w) {
    // H(e^jw) = (b0 + b1*e^-jw + b2*e^-2jw) / (a0 + a1*e^-jw + a2*e^-2jw)
    var cw = Math.cos(w), sw = Math.sin(w);
    var c2w = Math.cos(2 * w), s2w = Math.sin(2 * w);

    var nr = b0 + b1 * cw + b2 * c2w;   // real part of numerator
    var ni = -b1 * sw - b2 * s2w;         // imag part of numerator
    var dr = a0 + a1 * cw + a2 * c2w;    // real part of denominator
    var di = -a1 * sw - a2 * s2w;         // imag part of denominator

    var numMagSq = nr * nr + ni * ni;
    var denMagSq = dr * dr + di * di;
    if (denMagSq < 1e-30) return 0;

    var magSq = numMagSq / denMagSq;
    if (magSq < 1e-30) return -200;
    return 10 * Math.log10(magSq);
}

// ── Evaluate single band's dB contribution ──
function _weqBandDB(xPos, band) {
    var gainDB = weqYToDB(band.y);
    var type = band.type || 'Bell';
    var Q = Math.max(0.025, band.q || 0.707);
    var f0 = weqXToFreq(band.x);
    var f = weqXToFreq(xPos);

    // LP/HP are unity-gain filters — gain has no effect on DSP.
    // Skip the gain check for LP/HP; always evaluate their response.
    if ((type === 'Bell' || type === 'LShf' || type === 'HShf') && Math.abs(gainDB) < 0.1) return 0;

    var w0 = 2 * Math.PI * f0 / _WEQ_REF_FS;
    var w = 2 * Math.PI * f / _WEQ_REF_FS;
    var sw0 = Math.sin(w0), cw0 = Math.cos(w0);
    var b0, b1, b2, a0, a1, a2;

    if (type === 'Bell') {
        // Peaking EQ — A = 10^(dBgain/40)
        var A = Math.pow(10, gainDB / 40);
        var alpha = sw0 / (2 * Q);
        b0 = 1 + alpha * A;
        b1 = -2 * cw0;
        b2 = 1 - alpha * A;
        a0 = 1 + alpha / A;
        a1 = -2 * cw0;
        a2 = 1 - alpha / A;
        return _weqBiquadDB(b0, b1, b2, a0, a1, a2, w);
    }
    if (type === 'LP') {
        // Low-pass: unity-gain, gain parameter is ignored (matches C++ DSP).
        // Q controls resonance at cutoff.
        var alphaLP = sw0 / (2 * Q);
        b0 = (1 - cw0) / 2;
        b1 = 1 - cw0;
        b2 = (1 - cw0) / 2;
        a0 = 1 + alphaLP;
        a1 = -2 * cw0;
        a2 = 1 - alphaLP;
        return _weqBiquadDB(b0, b1, b2, a0, a1, a2, w);
    }
    if (type === 'HP') {
        // High-pass: unity-gain, gain parameter is ignored (matches C++ DSP).
        // Q controls resonance at cutoff.
        var alphaHP = sw0 / (2 * Q);
        b0 = (1 + cw0) / 2;
        b1 = -(1 + cw0);
        b2 = (1 + cw0) / 2;
        a0 = 1 + alphaHP;
        a1 = -2 * cw0;
        a2 = 1 - alphaHP;
        return _weqBiquadDB(b0, b1, b2, a0, a1, a2, w);
    }
    if (type === 'Notch') {
        // Band-reject: full depth, Q controls width
        var alphaN = sw0 / (2 * Q);
        b0 = 1;
        b1 = -2 * cw0;
        b2 = 1;
        a0 = 1 + alphaN;
        a1 = -2 * cw0;
        a2 = 1 - alphaN;
        return _weqBiquadDB(b0, b1, b2, a0, a1, a2, w);
    }
    if (type === 'LShf') {
        // Low Shelf — Audio EQ Cookbook S (slope) form
        // Q knob value is reinterpreted as shelf slope S.
        // S=1 = steepest monotonic shelf, S>1 = shelf bump/overshoot.
        // Cookbook: 2*sqrt(A)*alpha = sin(w0) * sqrt((A+1/A)*(1/S-1)+2)
        var A = Math.pow(10, gainDB / 40);
        var S = Q; // reinterpret Q as slope
        var twoSqrtAalpha = sw0 * Math.sqrt(Math.max(0, (A + 1 / A) * (1 / S - 1) + 2));
        if (!isFinite(twoSqrtAalpha) || twoSqrtAalpha < 1e-10) twoSqrtAalpha = 1e-10;
        b0 = A * ((A + 1) - (A - 1) * cw0 + twoSqrtAalpha);
        b1 = 2 * A * ((A - 1) - (A + 1) * cw0);
        b2 = A * ((A + 1) - (A - 1) * cw0 - twoSqrtAalpha);
        a0 = (A + 1) + (A - 1) * cw0 + twoSqrtAalpha;
        a1 = -2 * ((A - 1) + (A + 1) * cw0);
        a2 = (A + 1) + (A - 1) * cw0 - twoSqrtAalpha;
        return _weqBiquadDB(b0, b1, b2, a0, a1, a2, w);
    }
    if (type === 'HShf') {
        // High Shelf — Audio EQ Cookbook S (slope) form
        var A = Math.pow(10, gainDB / 40);
        var S = Q; // reinterpret Q as slope
        var twoSqrtAalpha = sw0 * Math.sqrt(Math.max(0, (A + 1 / A) * (1 / S - 1) + 2));
        if (!isFinite(twoSqrtAalpha) || twoSqrtAalpha < 1e-10) twoSqrtAalpha = 1e-10;
        b0 = A * ((A + 1) + (A - 1) * cw0 + twoSqrtAalpha);
        b1 = -2 * A * ((A - 1) + (A + 1) * cw0);
        b2 = A * ((A + 1) + (A - 1) * cw0 - twoSqrtAalpha);
        a0 = (A + 1) - (A - 1) * cw0 + twoSqrtAalpha;
        a1 = 2 * ((A - 1) - (A + 1) * cw0);
        a2 = (A + 1) - (A - 1) * cw0 - twoSqrtAalpha;
        return _weqBiquadDB(b0, b1, b2, a0, a1, a2, w);
    }
    return 0;
}

// ── Evaluate total curve dB at a given X position (0-1 log freq) — additive bands ──
// Warp/Steps/Tilt are applied to the SUMMED gain-based curve (post-sum).
// C++ matches this: depth per-biquad, warp/steps per-biquad (close approx),
// tilt as a separate post-EQ filter.
function weqEvalAtX(xPos) {
    var pts = wrongEqPoints;
    if (!pts || pts.length === 0) return 0;

    // Total curve always includes ALL non-muted points regardless of solo state.
    // Solo is an audio-only concept handled by C++ ProcessBlock — the visual curve
    // must always reflect the full EQ shape.
    var depthScale = weqGlobalDepth / 100;
    var gainDB = 0;  // All gain-based: EQ bands — subject to depth, warp, steps, tilt
    var unityDB = 0; // LP, HP, Notch — always at full strength, no warp
    for (var i = 0; i < pts.length; i++) {
        if (pts[i].mute) continue;
        var pt = pts[i].type || 'Bell';
        var isGainBased = (pt === 'Bell' || pt === 'LShf' || pt === 'HShf');
        if (isGainBased) {
            gainDB += _weqBandDB(xPos, pts[i]) * depthScale;
        } else {
            unityDB += _weqBandDB(xPos, pts[i]);
        }
    }

    // Apply global warp to gain-based portion
    if (Math.abs(weqGlobalWarp) > 0.5) {
        var norm = (gainDB - (-weqDBRangeMax)) / (weqDBRangeMax * 2);
        var w = weqGlobalWarp / 100;
        if (w > 0) {
            var mid = norm * 2 - 1;
            norm = 0.5 + 0.5 * Math.tanh(w * 3 * mid) / Math.tanh(w * 3);
        } else {
            var aw = -w;
            var c = norm * 2 - 1;
            var sv = c >= 0 ? 1 : -1;
            norm = 0.5 + 0.5 * sv * Math.pow(Math.abs(c), 1 / (1 + aw * 3));
        }
        gainDB = (-weqDBRangeMax) + norm * (weqDBRangeMax * 2);
    }

    // Apply global steps
    if (weqGlobalSteps >= 2) {
        var stepSize = (weqDBRangeMax * 2) / (weqGlobalSteps - 1);
        gainDB = Math.round(gainDB / stepSize) * stepSize;
    }

    // Apply global tilt: frequency-dependent gain offset across the whole curve
    if (Math.abs(weqGlobalTilt) > 0.5) {
        var xFreq = weqXToFreq(xPos);
        var logPos = Math.log2(xFreq / 632);
        var tiltDB = logPos * (weqGlobalTilt / 100) * 12;
        gainDB = Math.max(-weqDBRangeMax, Math.min(weqDBRangeMax, gainDB + tiltDB));
    }

    return gainDB + unityDB;
}

// ── Main canvas draw ──
function weqDrawCanvas() {
    var canvas = document.getElementById('weqCanvas');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    var dpr = window.devicePixelRatio || 1;
    var W = canvas.width / dpr;
    var H = canvas.height / dpr;
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);
    try {
        // Background
        ctx.fillStyle = weqCssVar('--bg-inset', '#1a1a20');
        ctx.fillRect(0, 0, W, H);

        // Bypass overlay: dim the whole canvas
        if (weqGlobalBypass) {
            ctx.fillStyle = 'rgba(160, 48, 48, 0.08)';
            ctx.fillRect(0, 0, W, H);
        }

        // ── Spectrum analyzer (behind everything) ──
        if (weqSpectrumSmooth && weqSpectrumSmooth.length > 0) {
            var specBins = weqSpectrumSmooth.length;
            var zeroY = (1 - (0 - (-weqDBRangeMax)) / (weqDBRangeMax * 2)) * H;
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(0, H);
            for (var si = 0; si < specBins; si++) {
                var sx = (si / (specBins - 1)) * W;
                var sdb = Math.max(-weqDBRangeMax, Math.min(weqDBRangeMax, weqSpectrumSmooth[si]));
                var sy = (1 - (sdb - (-weqDBRangeMax)) / (weqDBRangeMax * 2)) * H;
                if (si === 0) ctx.moveTo(sx, sy);
                else ctx.lineTo(sx, sy);
            }
            ctx.lineTo(W, H);
            ctx.lineTo(0, H);
            ctx.closePath();
            var specGrad = ctx.createLinearGradient(0, 0, 0, H);
            specGrad.addColorStop(0, 'rgba(60, 180, 200, 0.15)');
            specGrad.addColorStop(0.5, 'rgba(40, 120, 160, 0.08)');
            specGrad.addColorStop(1, 'rgba(20, 60, 100, 0.03)');
            ctx.fillStyle = specGrad;
            ctx.fill();
            // Spectrum line
            ctx.beginPath();
            for (var si2 = 0; si2 < specBins; si2++) {
                var sx2 = (si2 / (specBins - 1)) * W;
                var sdb2 = Math.max(-weqDBRangeMax, Math.min(weqDBRangeMax, weqSpectrumSmooth[si2]));
                var sy2 = (1 - (sdb2 - (-weqDBRangeMax)) / (weqDBRangeMax * 2)) * H;
                if (si2 === 0) ctx.moveTo(sx2, sy2);
                else ctx.lineTo(sx2, sy2);
            }
            ctx.strokeStyle = 'rgba(80, 200, 220, 0.25)';
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.restore();
        }

        // ── Split mode: colored band zones ──
        if (weqSplitMode && wrongEqPoints.length > 0) {
            var splitPts = wrongEqPoints.slice().sort(function (a, b) { return a.x - b.x; });
            var nBands = splitPts.length + 1;
            var edges = [0]; // start at x=0 (20Hz)
            for (var ei = 0; ei < splitPts.length; ei++) edges.push(splitPts[ei].x);
            edges.push(1); // end at x=1 (20kHz)

            for (var bi = 0; bi < nBands; bi++) {
                var x0 = edges[bi] * W;
                var x1 = edges[bi + 1] * W;
                var bandW = x1 - x0;
                var isPassthrough = (bi === nBands - 1); // last zone = above highest point
                var bandCol = isPassthrough ? weqCssVar('--text-muted', '#666') : _weqBandColor(bi + 1, splitPts);

                // Gradient fill — stronger at edges for depth
                ctx.save();
                if (bandW > 4) {
                    var bandGrad = ctx.createLinearGradient(x0, 0, x1, 0);
                    var fillAlpha = isPassthrough ? 0.03 : 0.10;
                    bandGrad.addColorStop(0, weqHexRgba(bandCol, fillAlpha * 0.5));
                    bandGrad.addColorStop(0.15, weqHexRgba(bandCol, fillAlpha));
                    bandGrad.addColorStop(0.85, weqHexRgba(bandCol, fillAlpha));
                    bandGrad.addColorStop(1, weqHexRgba(bandCol, fillAlpha * 0.5));
                    ctx.fillStyle = bandGrad;
                } else {
                    ctx.globalAlpha = isPassthrough ? 0.03 : 0.08;
                    ctx.fillStyle = bandCol;
                }
                ctx.fillRect(x0, 0, bandW, H);
                ctx.restore();

                // Band label (centered)
                ctx.save();
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                if (bandW > 24) {
                    if (isPassthrough) {
                        // Passthrough zone label
                        ctx.font = '600 9px ' + weqCssVar('--font-mono', 'monospace');
                        ctx.fillStyle = bandCol;
                        ctx.globalAlpha = 0.3;
                        ctx.fillText('PASS', (x0 + x1) / 2, H / 2 - 6);
                        ctx.font = '400 8px ' + weqCssVar('--font-mono', 'monospace');
                        ctx.fillText('▸ ' + weqFmtFreq(weqXToFreq(edges[bi])), (x0 + x1) / 2, H / 2 + 6);
                    } else {
                        // Band number + plugin indicator
                        var bandPt = splitPts[bi > 0 ? bi - 1 : 0];
                        var hasPlugins = bandPt && bandPt.pluginIds && bandPt.pluginIds.length > 0;
                        ctx.font = '700 12px ' + weqCssVar('--font-mono', 'monospace');
                        ctx.fillStyle = bandCol;
                        ctx.globalAlpha = hasPlugins ? 0.55 : 0.25;
                        ctx.fillText('B' + bi, (x0 + x1) / 2, H / 2 - (hasPlugins ? 7 : 0));

                        // Show plugin count badge
                        if (hasPlugins && bandW > 40) {
                            ctx.font = '500 8px ' + weqCssVar('--font-mono', 'monospace');
                            ctx.globalAlpha = 0.45;
                            var plugLabel = bandPt.pluginIds.length + ' fx';
                            ctx.fillText(plugLabel, (x0 + x1) / 2, H / 2 + 8);
                        }
                    }
                }
                ctx.restore();
            }

            // Divider lines at crossover frequencies
            for (var di = 0; di < splitPts.length; di++) {
                var dx = splitPts[di].x * W;
                var divCol = _weqBandColor(di + 1, splitPts);

                // Glow behind divider
                ctx.save();
                var glowGrad = ctx.createLinearGradient(dx - 8, 0, dx + 8, 0);
                glowGrad.addColorStop(0, 'rgba(0,0,0,0)');
                glowGrad.addColorStop(0.5, weqHexRgba(divCol, 0.08));
                glowGrad.addColorStop(1, 'rgba(0,0,0,0)');
                ctx.fillStyle = glowGrad;
                ctx.fillRect(dx - 8, 0, 16, H);
                ctx.restore();

                // Divider line
                ctx.save();
                ctx.strokeStyle = divCol;
                ctx.globalAlpha = 0.6;
                ctx.lineWidth = 1.5;
                ctx.setLineDash([4, 3]);
                ctx.beginPath();
                ctx.moveTo(dx, 0);
                ctx.lineTo(dx, H);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.restore();

                // Frequency label at divider (pill background for readability)
                var divFreq = weqXToFreq(splitPts[di].x);
                var divLabel = divFreq >= 1000 ? (divFreq / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : Math.round(divFreq) + '';
                ctx.save();
                ctx.font = '600 9px ' + weqCssVar('--font-mono', 'monospace');
                var lblW = ctx.measureText(divLabel).width + 8;
                // Pill background
                ctx.fillStyle = weqCssVar('--bg-card', '#1a1a20');
                ctx.globalAlpha = 0.7;
                ctx.beginPath();
                ctx.roundRect(dx - lblW / 2, 4, lblW, 14, 3);
                ctx.fill();
                // Text
                ctx.fillStyle = divCol;
                ctx.globalAlpha = 0.9;
                ctx.textAlign = 'center';
                ctx.fillText(divLabel, dx, 14);
                ctx.restore();
            }
        }

        var sorted = wrongEqPoints.slice().sort(function (a, b) { return a.x - b.x; });

        // Check for solo state
        var anySolo = false;
        for (var si = 0; si < sorted.length; si++) if (sorted[si].solo) anySolo = true;

        // ── Solo band highlight overlay ──
        if (anySolo && sorted.length > 0) {
            // Dim the entire canvas first
            ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
            ctx.fillRect(0, 0, W, H);

            // Highlight soloed band regions using Q-based frequency ranges
            for (var sbi = 0; sbi < sorted.length; sbi++) {
                if (!sorted[sbi].solo) continue;
                var soloColor = _weqBandColor(sbi + 1, sorted);
                // Use Q-based frequency range
                var soloRange = weqBandRange(sorted[sbi]);
                var regionLeft = weqFreqToX(soloRange.lo) * W;
                var regionRight = weqFreqToX(soloRange.hi) * W;

                // Restore the soloed region (un-dim it)
                ctx.save();
                ctx.globalCompositeOperation = 'destination-out';
                ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
                ctx.fillRect(regionLeft, 0, regionRight - regionLeft, H);
                ctx.restore();

                // Add colored glow within Q-based range
                var soloGrad = ctx.createLinearGradient(regionLeft, 0, regionRight, 0);
                soloGrad.addColorStop(0, 'rgba(0, 0, 0, 0)');
                soloGrad.addColorStop(0.1, weqHexRgba(soloColor, 0.10));
                soloGrad.addColorStop(0.5, weqHexRgba(soloColor, 0.14));
                soloGrad.addColorStop(0.9, weqHexRgba(soloColor, 0.10));
                soloGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
                ctx.fillStyle = soloGrad;
                ctx.fillRect(regionLeft, 0, regionRight - regionLeft, H);

                // Draw vertical boundary lines at Q edges
                ctx.strokeStyle = weqHexRgba(soloColor, 0.35);
                ctx.lineWidth = 1;
                ctx.setLineDash([4, 3]);
                ctx.beginPath();
                ctx.moveTo(regionLeft, 0); ctx.lineTo(regionLeft, H);
                ctx.moveTo(regionRight, 0); ctx.lineTo(regionRight, H);
                ctx.stroke();
                ctx.setLineDash([]);

                // Label at top showing Q range
                ctx.font = '9px "Share Tech Mono", monospace';
                ctx.textAlign = 'center';
                ctx.fillStyle = weqHexRgba(soloColor, 0.7);
                var rangeLbl = weqFmtRange(sorted[sbi]);
                ctx.fillText(rangeLbl, (regionLeft + regionRight) / 2, 12);
            }
        }

        // ── Band regions removed — additive EQ uses per-point bands ──

        // ── Grid lines ──
        // Horizontal: dB lines (dynamic based on weqDBRangeMax)
        var dbStep = weqDBRangeMax <= 6 ? 2 : (weqDBRangeMax <= 12 ? 3 : (weqDBRangeMax <= 24 ? 6 : 12));
        var dbMinorStep = dbStep / 2;
        var dbGridValues = [];
        var dbMinorValues = [];
        for (var dgi = -weqDBRangeMax; dgi <= weqDBRangeMax; dgi += dbStep) dbGridValues.push(dgi);
        for (var dmi = -weqDBRangeMax + dbMinorStep; dmi < weqDBRangeMax; dmi += dbStep) dbMinorValues.push(dmi);

        ctx.font = '11px "Share Tech Mono", monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';

        // Minor grid
        ctx.lineWidth = 0.3;
        ctx.strokeStyle = 'rgba(255,255,255,0.03)';
        dbMinorValues.forEach(function (dbm) {
            var gym = weqYtoCanvas(weqDBtoY(dbm), H);
            ctx.beginPath();
            ctx.moveTo(0, gym);
            ctx.lineTo(W, gym);
            ctx.stroke();
        });

        // Major grid with labels
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.7)';
        ctx.shadowBlur = 3;
        ctx.shadowOffsetX = 1;
        ctx.shadowOffsetY = 1;
        dbGridValues.forEach(function (dbv) {
            var gy = weqYtoCanvas(weqDBtoY(dbv), H);
            ctx.strokeStyle = dbv === 0 ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.08)';
            ctx.lineWidth = dbv === 0 ? 1.5 : 0.5;
            ctx.beginPath();
            ctx.moveTo(32, gy);
            ctx.lineTo(W, gy);
            ctx.stroke();
            // dB label — prominent
            ctx.font = '11px "Share Tech Mono", monospace';
            ctx.fillStyle = dbv === 0 ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.55)';
            var label = dbv === 0 ? '  0 dB' : (dbv > 0 ? '+' + dbv : '' + dbv);
            ctx.fillText(label, 3, gy);
        });
        ctx.restore();

        // Vertical: frequency lines with labels
        var freqGrid = [20, 30, 40, 50, 60, 80, 100, 150, 200, 300, 400, 500, 600, 800,
            1000, 1500, 2000, 3000, 4000, 5000, 6000, 8000, 10000, 15000, 20000];
        var freqLabels = {
            20: '20', 50: '50', 100: '100', 200: '200', 500: '500',
            1000: '1k', 2000: '2k', 5000: '5k', 10000: '10k', 20000: '20k'
        };
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';

        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.7)';
        ctx.shadowBlur = 3;
        ctx.shadowOffsetX = 1;
        ctx.shadowOffsetY = 1;
        freqGrid.forEach(function (f) {
            var gx = weqFreqToX(f) * W;
            var isLabel = freqLabels[f] != null;
            ctx.strokeStyle = isLabel ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.04)';
            ctx.lineWidth = isLabel ? 0.6 : 0.3;
            ctx.beginPath();
            ctx.moveTo(gx, 0);
            ctx.lineTo(gx, H - (isLabel ? 16 : 0));
            ctx.stroke();
            // Frequency label at bottom — prominent
            if (isLabel) {
                ctx.fillStyle = 'rgba(255,255,255,0.55)';
                ctx.font = '10px "Share Tech Mono", monospace';
                ctx.fillText(freqLabels[f], gx, H - 3);
            }
        });
        ctx.restore();

        // ── Draw per-band individual curves (ghost) ──
        if (sorted.length > 0) {
            // Use lower resolution during animation for performance
            var isAnimating = weqAnimRafId != null;
            var resBase = isAnimating ? Math.max(120, Math.floor(W / 2)) : Math.max(200, W);
            var resolution = resBase;

            // Draw per-band ghost curves
            var ghostRes = isAnimating ? Math.max(80, Math.floor(W / 3)) : resolution;
            for (var bi = 0; bi < sorted.length; bi++) {
                var band = sorted[bi];
                var realBandIdx = wrongEqPoints.indexOf(band);
                if (band.mute) continue;
                // Don't skip non-soloed bands — always draw all ghost curves
                var bandCol = _weqBandColor(bi + 1, sorted);
                var isSelBand = (realBandIdx === weqSelectedPt);
                var isSoloed = band.solo && anySolo;
                ctx.globalAlpha = isSoloed ? 0.7 : (isSelBand ? 0.3 : (isAnimating ? 0.04 : 0.06));
                ctx.strokeStyle = bandCol;
                ctx.lineWidth = isSoloed ? 2.5 : (isSelBand ? 1.5 : 1);
                ctx.lineJoin = 'round';
                ctx.lineCap = 'round';
                ctx.beginPath();
                for (var bpx = 0; bpx <= ghostRes; bpx++) {
                    var bxN = bpx / ghostRes;
                    var bGainBased = ((band.type || 'Bell') === 'Bell' || band.type === 'LShf' || band.type === 'HShf');
                    var bandDB = _weqBandDB(bxN, band) * (bGainBased ? (weqGlobalDepth / 100) : 1);
                    var bandY = weqDBtoY(bandDB);
                    var bcy = weqYtoCanvas(bandY, H);
                    if (bpx === 0) ctx.moveTo(bxN * W, bcy);
                    else ctx.lineTo(bxN * W, bcy);
                }
                ctx.stroke();
            }
            ctx.globalAlpha = 1;

            // ── Compute total curve ONCE, cache for reuse ──
            var depthMul = weqGlobalDepth / 100;
            var curveX = new Float32Array(resolution + 1);
            var curveY = new Float32Array(resolution + 1);
            for (var px = 0; px <= resolution; px++) {
                var xNorm = px / resolution;
                // weqEvalAtX already applies global depth, warp, and steps internally
                var db = weqEvalAtX(xNorm);
                curveX[px] = xNorm * W;
                curveY[px] = weqYtoCanvas(weqDBtoY(db), H);
            }

            // ── Draw total EQ curve (from cache) ──
            ctx.lineWidth = 2.5;
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';
            ctx.strokeStyle = weqCssVar('--accent', '#2D6B3F');
            ctx.beginPath();
            for (var cx = 0; cx <= resolution; cx++) {
                if (cx === 0) ctx.moveTo(curveX[cx], curveY[cx]);
                else ctx.lineTo(curveX[cx], curveY[cx]);
            }
            ctx.stroke();

            // Filled area under/over 0dB (reuse cached curve)
            var zeroY = weqYtoCanvas(weqDBtoY(0), H);
            ctx.globalAlpha = 0.08;
            ctx.beginPath();
            for (var fx = 0; fx <= resolution; fx++) {
                if (fx === 0) ctx.moveTo(curveX[fx], curveY[fx]);
                else ctx.lineTo(curveX[fx], curveY[fx]);
            }
            ctx.lineTo(W, zeroY);
            ctx.lineTo(0, zeroY);
            ctx.closePath();
            ctx.fillStyle = weqCssVar('--accent', '#2D6B3F');
            ctx.fill();
            ctx.globalAlpha = 1;

            // biquad contributions. What you see IS what you hear — WYSIWYG.
        } else {
            // No points: flat 0dB line
            var zy = weqYtoCanvas(weqDBtoY(0), H);
            ctx.strokeStyle = 'rgba(255,255,255,0.2)';
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(0, zy);
            ctx.lineTo(W, zy);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        // ── Draw breakpoints ──
        // First pass: draw segment selection connection line
        if (weqSegSel.size >= 2) {
            var segPts = _weqSortedSel().map(function (i) { return wrongEqPoints[i]; });
            ctx.beginPath();
            ctx.strokeStyle = _weqAccentRgba(0.5);
            ctx.lineWidth = 2;
            ctx.setLineDash([5, 3]);
            for (var si = 0; si < segPts.length; si++) {
                var sx = segPts[si].x * W, sy = weqYtoCanvas(segPts[si].y, H);
                if (si === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
            }
            ctx.stroke();
            ctx.setLineDash([]);
        }

        for (var pi = 0; pi < sorted.length; pi++) {
            var pt = sorted[pi];
            var realIdx = wrongEqPoints.indexOf(pt);
            var cx = pt.x * W;
            var cy = weqYtoCanvas(pt.y, H);
            var isSel = (realIdx === weqSelectedPt);
            var isSegSel = weqSegSel.has(realIdx);
            var col = _weqPointColor(pt);
            var isMutedPt = pt.mute;
            var isNonSoloed = anySolo && !pt.solo;

            // Dim non-soloed or muted dots
            if (isMutedPt) {
                ctx.globalAlpha = 0.15;
            } else if (isNonSoloed) {
                ctx.globalAlpha = 0.25;
            } else {
                ctx.globalAlpha = 1.0;
            }

            // Frequency marker line (only for selected point)
            if (isSel) {
                ctx.strokeStyle = weqHexRgba(col, 0.3);
                ctx.lineWidth = 1;
                ctx.setLineDash([3, 3]);
                ctx.beginPath();
                ctx.moveTo(cx, 0);
                ctx.lineTo(cx, H);
                ctx.stroke();
                ctx.setLineDash([]);
            }

            // Segment selection glow ring
            if (isSegSel) {
                ctx.beginPath();
                ctx.arc(cx, cy, 10, 0, Math.PI * 2);
                ctx.strokeStyle = _weqAccentRgba(0.6);
                ctx.lineWidth = 2;
                ctx.stroke();
            }

            // Point shape based on filter type (FabFilter convention)
            var ptType = pt.type || 'Bell';
            var r = isSel ? 7 : (isSegSel ? 6 : 5);
            ctx.beginPath();
            if (ptType === 'Bell' || ptType === 'Notch') {
                // Circle (Bell) or Diamond (Notch)
                if (ptType === 'Notch') {
                    ctx.moveTo(cx, cy - r);
                    ctx.lineTo(cx + r, cy);
                    ctx.lineTo(cx, cy + r);
                    ctx.lineTo(cx - r, cy);
                    ctx.closePath();
                } else {
                    ctx.arc(cx, cy, r, 0, Math.PI * 2);
                }
            } else if (ptType === 'LP') {
                // Left-pointing triangle (cuts highs)
                ctx.moveTo(cx + r, cy - r);
                ctx.lineTo(cx - r, cy);
                ctx.lineTo(cx + r, cy + r);
                ctx.closePath();
            } else if (ptType === 'HP') {
                // Right-pointing triangle (cuts lows)
                ctx.moveTo(cx - r, cy - r);
                ctx.lineTo(cx + r, cy);
                ctx.lineTo(cx - r, cy + r);
                ctx.closePath();
            } else if (ptType === 'LShf') {
                // Left half-circle (shelf below)
                ctx.arc(cx, cy, r, Math.PI * 0.5, Math.PI * 1.5);
                ctx.closePath();
            } else if (ptType === 'HShf') {
                // Right half-circle (shelf above)
                ctx.arc(cx, cy, r, -Math.PI * 0.5, Math.PI * 0.5);
                ctx.closePath();
            } else {
                ctx.arc(cx, cy, r, 0, Math.PI * 2);
            }
            ctx.fillStyle = isSel ? '#fff' : (isSegSel ? _weqAccentRgba(0.7) : col);
            ctx.fill();
            ctx.lineWidth = isSel ? 2 : (isSegSel ? 2 : 1.5);
            ctx.strokeStyle = isSel ? col : (isSegSel ? _weqAccentRgba(0.8) : 'rgba(0,0,0,0.5)');
            ctx.stroke();

            // Q bandwidth visualization for selected point
            if (isSel && (ptType === 'Bell' || ptType === 'Notch')) {
                var q = pt.q || 0.707;
                // Exact Cookbook BW: 1/Q = 2*sinh(ln(2)/2*BW) → BW = 2/ln(2)*asinh(1/(2*Q))
                var bwOctaves = (2 / Math.LN2) * Math.asinh(1 / (2 * q));
                var centerFreq = weqXToFreq(pt.x);
                var loFreq = centerFreq / Math.pow(2, bwOctaves / 2);
                var hiFreq = centerFreq * Math.pow(2, bwOctaves / 2);
                // Unclamped positions for bell shape — let canvas clip at edges
                var xLoFull = weqFreqToX(loFreq) * W;
                var xHiFull = weqFreqToX(hiFreq) * W;
                // Clamped positions for dashed edge lines (only draw if visible)
                var xLo = Math.max(0, xLoFull);
                var xHi = Math.min(W, xHiFull);
                ctx.save();
                ctx.globalAlpha = 0.12;
                ctx.fillStyle = col;
                ctx.beginPath();
                ctx.moveTo(xLoFull, zeroY);
                // Bell curve approximation — uses full (unclamped) range
                var bellSteps = 32;
                for (var bs = 0; bs <= bellSteps; bs++) {
                    var bx = xLoFull + (xHiFull - xLoFull) * (bs / bellSteps);
                    var bf = (bs / bellSteps) * 2 - 1; // -1 to 1
                    var bellY = Math.exp(-bf * bf * 2);
                    var by = zeroY + (cy - zeroY) * bellY;
                    ctx.lineTo(bx, by);
                }
                ctx.lineTo(xHiFull, zeroY);
                ctx.closePath();
                ctx.fill();
                ctx.globalAlpha = 0.4;
                ctx.strokeStyle = col;
                ctx.lineWidth = 1;
                ctx.setLineDash([2, 2]);
                // Only draw edge lines if they're within view
                if (xLo > 0) {
                    ctx.beginPath();
                    ctx.moveTo(xLo, 0); ctx.lineTo(xLo, H);
                    ctx.stroke();
                }
                if (xHi < W) {
                    ctx.beginPath();
                    ctx.moveTo(xHi, 0); ctx.lineTo(xHi, H);
                    ctx.stroke();
                }
                ctx.setLineDash([]);
                ctx.restore();
            }

            // Frequency + type label at top
            var freq = weqXToFreq(pt.x);
            var typeStr = pt.type || 'Bell';
            ctx.fillStyle = isSel ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.5)';
            ctx.font = (isSel ? 'bold ' : '') + '9px "Share Tech Mono", monospace';
            ctx.textAlign = 'center';
            ctx.fillText((pi + 1) + ' ' + typeStr + ' ' + weqFmtFreq(freq), cx, 10);

            // dB + Q label near point
            var dbVal = weqYToDB(pt.y);
            var ptQ = pt.q || 0.707;
            var detailLabel;
            if (typeStr === 'LP' || typeStr === 'HP') {
                detailLabel = '12dB/oct';
            } else {
                detailLabel = weqFmtDB(dbVal) + 'dB  Q' + ptQ.toFixed(2);
            }
            ctx.fillStyle = isSel ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.35)';
            ctx.font = '8px "Share Tech Mono", monospace';
            ctx.textAlign = cx > W - 50 ? 'right' : 'left';
            var xOff = cx > W - 50 ? -8 : 8;
            ctx.fillText(detailLabel, cx + xOff, cy - 8);
        }

        ctx.globalAlpha = 1; // reset after dot loop

        // ── Modulation zone boundaries (separate gain vs drift) ──
        var _isModulating = weqAnimSpeed > 0 || (Math.abs(weqDrift) > 0 && weqDriftRange > 0) || (weqDriftContinuous && weqDriftRange > 0);
        if (_isModulating) {
            ctx.save();
            ctx.font = '8px "Share Tech Mono", monospace';

            // ── Gain zone (LFO + continuous) — solid green lines ──
            var _gLo = weqGainLoCut > 20, _gHi = weqGainHiCut < 20000;
            if (_gLo || _gHi) {
                var gLoX = _gLo ? weqFreqToX(weqGainLoCut) * W : -1;
                var gHiX = _gHi ? weqFreqToX(weqGainHiCut) * W : W + 1;
                ctx.globalAlpha = 0.06;
                ctx.fillStyle = '#000';
                if (_gLo) ctx.fillRect(0, 0, gLoX, H);
                if (_gHi) ctx.fillRect(gHiX, 0, W - gHiX, H);
                ctx.globalAlpha = 0.6;
                ctx.lineWidth = 1;
                ctx.setLineDash([]);
                ctx.strokeStyle = 'rgba(80, 220, 120, 0.7)';
                if (_gLo) { ctx.beginPath(); ctx.moveTo(gLoX, 0); ctx.lineTo(gLoX, H); ctx.stroke(); }
                if (_gHi) { ctx.beginPath(); ctx.moveTo(gHiX, 0); ctx.lineTo(gHiX, H); ctx.stroke(); }
                ctx.globalAlpha = 1;
                ctx.fillStyle = 'rgba(80, 220, 120, 0.6)';
                if (_gLo) { ctx.textAlign = 'left'; ctx.fillText('G ' + weqFmtFreq(weqGainLoCut), gLoX + 3, H - 4); }
                if (_gHi) { ctx.textAlign = 'right'; ctx.fillText(weqFmtFreq(weqGainHiCut) + ' G', gHiX - 3, H - 4); }
            }

            // ── Drift zone — short-dash orange lines ──
            var _dLo = weqDriftLoCut > 20, _dHi = weqDriftHiCut < 20000;
            if (_dLo || _dHi) {
                var dLoX = _dLo ? weqFreqToX(weqDriftLoCut) * W : -1;
                var dHiX = _dHi ? weqFreqToX(weqDriftHiCut) * W : W + 1;
                ctx.globalAlpha = 0.06;
                ctx.fillStyle = '#000';
                if (_dLo) ctx.fillRect(0, 0, dLoX, H);
                if (_dHi) ctx.fillRect(dHiX, 0, W - dHiX, H);
                ctx.globalAlpha = 0.6;
                ctx.lineWidth = 1;
                ctx.setLineDash([3, 3]);
                ctx.strokeStyle = 'rgba(255, 170, 50, 0.7)';
                if (_dLo) { ctx.beginPath(); ctx.moveTo(dLoX, 0); ctx.lineTo(dLoX, H); ctx.stroke(); }
                if (_dHi) { ctx.beginPath(); ctx.moveTo(dHiX, 0); ctx.lineTo(dHiX, H); ctx.stroke(); }
                ctx.setLineDash([]);
                ctx.globalAlpha = 1;
                ctx.fillStyle = 'rgba(255, 170, 50, 0.6)';
                if (_dLo) { ctx.textAlign = 'left'; ctx.fillText('D ' + weqFmtFreq(weqDriftLoCut), dLoX + 3, H - 14); }
                if (_dHi) { ctx.textAlign = 'right'; ctx.fillText(weqFmtFreq(weqDriftHiCut) + ' D', dHiX - 3, H - 14); }
            }

            ctx.restore();
        }

        // ── Q zone boundaries — dotted cyan lines ──
        var _hasQZone = weqQLoCut > 20 || weqQHiCut < 20000;
        var _qModActive = weqQModSpeed > 0 && weqQModDepth > 0;
        if (_hasQZone && _qModActive) {
            ctx.save();
            ctx.font = '8px "Share Tech Mono", monospace';
            var _qLo = weqQLoCut > 20, _qHi = weqQHiCut < 20000;
            var qLoX = _qLo ? weqFreqToX(weqQLoCut) * W : -1;
            var qHiX = _qHi ? weqFreqToX(weqQHiCut) * W : W + 1;
            ctx.globalAlpha = 0.06;
            ctx.fillStyle = '#000';
            if (_qLo) ctx.fillRect(0, 0, qLoX, H);
            if (_qHi) ctx.fillRect(qHiX, 0, W - qHiX, H);
            ctx.globalAlpha = 0.6;
            ctx.lineWidth = 1;
            ctx.setLineDash([2, 3]);
            ctx.strokeStyle = 'rgba(100, 200, 255, 0.7)';
            if (_qLo) { ctx.beginPath(); ctx.moveTo(qLoX, 0); ctx.lineTo(qLoX, H); ctx.stroke(); }
            if (_qHi) { ctx.beginPath(); ctx.moveTo(qHiX, 0); ctx.lineTo(qHiX, H); ctx.stroke(); }
            ctx.setLineDash([]);
            ctx.globalAlpha = 1;
            ctx.fillStyle = 'rgba(100, 200, 255, 0.6)';
            if (_qLo) { ctx.textAlign = 'left'; ctx.fillText('Q ' + weqFmtFreq(weqQLoCut), qLoX + 3, 12); }
            if (_qHi) { ctx.textAlign = 'right'; ctx.fillText(weqFmtFreq(weqQHiCut) + ' Q', qHiX - 3, 12); }
            ctx.restore();
        }

        // ── Animation indicator ──
        if (weqAnimSpeed > 0 && weqAnimRafId) {
            // Show "ANIM" badge
            var pulseAlpha = 0.4 + 0.3 * Math.sin(weqAnimPhase * Math.PI * 2);
            ctx.fillStyle = 'rgba(45, 200, 90, ' + pulseAlpha.toFixed(2) + ')';
            ctx.font = 'bold 9px "Share Tech Mono", monospace';
            ctx.textAlign = 'right';
            ctx.fillText('● LFO ' + (WEQ_LFO_SHAPES[weqAnimShape] || WEQ_LFO_SHAPES.sine).icon + ' ' + weqAnimSpeed.toFixed(1) + 'Hz', W - 6, 12);

            // Ghost: draw base position dots (where points rest without animation)
            if (weqAnimBaseY.length === sorted.length) {
                ctx.globalAlpha = 0.2;
                for (var gi = 0; gi < sorted.length; gi++) {
                    var gx = sorted[gi].x * W;
                    var gy = weqYtoCanvas(weqAnimBaseY[wrongEqPoints.indexOf(sorted[gi])], H);
                    ctx.beginPath();
                    ctx.arc(gx, gy, 2.5, 0, Math.PI * 2);
                    ctx.fillStyle = 'rgba(255,255,255,0.5)';
                    ctx.fill();
                }
                ctx.globalAlpha = 1;
            }
        }

    } catch (drawErr) {
        if (typeof console !== 'undefined') console.warn('weqDrawCanvas error:', drawErr);
    }
    ctx.restore();
}

// ── Event setup ──
function weqSetupEvents() {
    var wrap = document.getElementById('weqCanvasWrap');
    if (!wrap) return;


    // Close button
    var closeBtn = document.getElementById('weqClose');
    if (closeBtn) closeBtn.onclick = function () { weqClose(); };

    // Header drag-to-move
    var headerEl = document.querySelector('.weq-header');
    var popupEl = document.getElementById('weqPanel');
    if (headerEl && popupEl) {
        headerEl.onmousedown = function (e) {
            // Don't drag if clicking a button inside header
            if (e.target.tagName === 'BUTTON' || e.target.closest('button')) return;
            e.preventDefault();

            // On first drag, convert from centered transform to pixel position
            if (popupEl.style.transform === '' || popupEl.style.transform.indexOf('translate') >= 0) {
                var rect = popupEl.getBoundingClientRect();
                popupEl.style.left = rect.left + 'px';
                popupEl.style.top = rect.top + 'px';
                popupEl.style.transform = 'none';
            }

            var startX = e.clientX;
            var startY = e.clientY;
            var startLeft = parseInt(popupEl.style.left) || 0;
            var startTop = parseInt(popupEl.style.top) || 0;

            function onDragMove(ev) {
                var dx = ev.clientX - startX;
                var dy = ev.clientY - startY;
                popupEl.style.left = (startLeft + dx) + 'px';
                popupEl.style.top = (startTop + dy) + 'px';
            }
            function onDragUp() {
                document.removeEventListener('mousemove', onDragMove);
                document.removeEventListener('mouseup', onDragUp);
            }
            document.addEventListener('mousemove', onDragMove);
            document.addEventListener('mouseup', onDragUp);
        };
    }

    // Grid buttons
    document.querySelectorAll('[data-wg]').forEach(function (btn) {
        btn.onclick = function () {
            weqGrid = btn.dataset.wg;
            document.querySelectorAll('[data-wg]').forEach(function (b) { b.classList.toggle('on', b.dataset.wg === weqGrid); });
            weqDrawCanvas();
        };
    });

    // Clear / Random
    var clearBtn = document.getElementById('weqClear');
    if (clearBtn) clearBtn.onclick = function () {
        _weqPushUndo();
        wrongEqPoints = [];
        weqAnimBaseY = []; weqAnimBaseX = [];
        weqSelectedPt = -1;
        weqFocusBand = -1;
        weqRenderPanel();
        weqSyncToHost();
        if (typeof markStateDirty === 'function') markStateDirty();
    };

    var randBtn = document.getElementById('weqRandom');
    if (randBtn) randBtn.onclick = function () {
        _weqPushUndo();
        weqRandomize();
    };

    // ── WrongEQ Undo System ──
    // Mirror All: flip every point's gain across 0dB
    var mirrorAllBtn = document.getElementById('weqMirrorAll');
    if (mirrorAllBtn) mirrorAllBtn.onclick = function () {
        _weqPushUndo();
        wrongEqPoints.forEach(function (pt, i) {
            var newY = weqDBtoY(-weqYToDB(pt.y));
            pt.y = newY;
            if (weqAnimBaseY.length > i) weqAnimBaseY[i] = newY;
        });
        weqRenderPanel(); weqSyncToHost();
        if (typeof markStateDirty === 'function') markStateDirty();
    };

    // Smooth All: halve every point's gain toward 0dB
    var smoothAllBtn = document.getElementById('weqSmoothAll');
    if (smoothAllBtn) smoothAllBtn.onclick = function () {
        _weqPushUndo();
        wrongEqPoints.forEach(function (pt, i) {
            var newY = weqDBtoY(weqYToDB(pt.y) * 0.5);
            pt.y = newY;
            if (weqAnimBaseY.length > i) weqAnimBaseY[i] = newY;
        });
        weqRenderPanel(); weqSyncToHost();
        if (typeof markStateDirty === 'function') markStateDirty();
    };



    // (Pre/Post EQ is now per-bus — handled in plugin_rack.js wireBusHeaders)

    // Bypass toggle
    var bypassBtn = document.getElementById('weqBypass');
    if (bypassBtn) bypassBtn.onclick = function () {
        weqGlobalBypass = !weqGlobalBypass;
        bypassBtn.classList.toggle('on', weqGlobalBypass);
        bypassBtn.classList.toggle('weq-bypass-on', weqGlobalBypass);
        weqSyncToHost();
    };

    // Continuous drift toggle
    var contBtn = document.getElementById('weqContinuous');
    if (contBtn) contBtn.onclick = function () {
        weqDriftContinuous = !weqDriftContinuous;
        contBtn.classList.toggle('on', weqDriftContinuous);
        contBtn.classList.toggle('weq-anim-on', weqDriftContinuous);
        var needsLoop = _weqNeedsAnim();
        if (needsLoop && !weqAnimRafId) weqAnimStart();
        else if (!needsLoop && weqAnimRafId) weqAnimStop();
        weqSyncToHost();
        if (typeof markStateDirty === 'function') markStateDirty();
    };

    // Oversampling cycle button: Off → 2× → 4× → Off
    var osBtn = document.getElementById('weqOversampleBtn');
    if (osBtn) osBtn.onclick = function () {
        if (weqOversample === 1) weqOversample = 2;
        else if (weqOversample === 2) weqOversample = 4;
        else weqOversample = 1;
        weqRenderPanel();
        weqSyncToHost();
        if (typeof markStateDirty === 'function') markStateDirty();
    };






    // Band card click-to-focus: highlight band region on canvas
    // Shift+click adds to segment selection
    document.querySelectorAll('.weq-band-card').forEach(function (row) {
        row.onclick = function (e) {
            // Don't trigger focus if clicking a button/control inside the card
            if (e.target.tagName === 'BUTTON' || e.target.hasAttribute('data-weqgain') ||
                e.target.hasAttribute('data-weqq') || e.target.hasAttribute('data-weqdrift') ||
                e.target.hasAttribute('data-weqfreq') || e.target.hasAttribute('data-weqpointpreq')) return;
            var idx = parseInt(row.dataset.bandidx);
            if (e.shiftKey || e.ctrlKey) {
                if (weqSegSel.has(idx)) weqSegSel.delete(idx);
                else weqSegSel.add(idx);
                weqRenderPanel();
                return;
            }
            var wasSelected = (weqFocusBand === idx && weqSelectedPt === idx);
            weqFocusBand = wasSelected ? -1 : idx;
            weqSelectedPt = wasSelected ? -1 : idx;
            document.querySelectorAll('.weq-band-card').forEach(function (r) {
                r.classList.toggle('focused', parseInt(r.dataset.bandidx) === weqFocusBand);
            });
            weqDrawCanvas();
        };
    });

    // Segment selection checkbox buttons
    document.querySelectorAll('[data-weqseg]').forEach(function (btn) {
        btn.onclick = function (e) {
            e.stopPropagation();
            var idx = parseInt(btn.dataset.weqseg);
            if (weqSegSel.has(idx)) weqSegSel.delete(idx);
            else weqSegSel.add(idx);
            weqRenderPanel();
        };
    });

    // Segment toolbar operations
    document.querySelectorAll('[data-segop]').forEach(function (btn) {
        btn.onclick = function (e) {
            e.stopPropagation();
            var op = btn.dataset.segop;
            if (op === 'clear') { weqSegSel.clear(); weqRenderPanel(); return; }
            if (op === 'shape') { _weqSegShapeMenu(e); return; }
            _weqSegApply(op);
        };
    });

    // Routing panel toggle (+ button on each card)
    document.querySelectorAll('[data-weqrouting]').forEach(function (btn) {
        btn.onclick = function (e) {
            e.stopPropagation();
            var bandIdx = parseInt(btn.dataset.weqrouting);
            if (window._weqRoutingOpen === bandIdx) {
                window._weqRoutingOpen = -1; // close
            } else {
                window._weqRoutingOpen = bandIdx; // open this one
            }
            weqRenderPanel();
        };
    });

    // Plugin open-editor buttons on band cards and routing panels
    document.querySelectorAll('[data-weqplugopen]').forEach(function (btn) {
        btn.onclick = function (e) {
            e.stopPropagation();
            var pid = parseInt(btn.dataset.weqplugopen);
            // Find the plugin block to get hostId
            var pb = null;
            if (typeof pluginBlocks !== 'undefined') {
                for (var i = 0; i < pluginBlocks.length; i++) {
                    if (pluginBlocks[i].id === pid) { pb = pluginBlocks[i]; break; }
                }
            }
            if (window.__JUCE__ && window.__JUCE__.backend) {
                var fn = window.__juceGetNativeFunction('openPluginEditor');
                fn(pb && pb.hostId !== undefined ? pb.hostId : pid);
            }
        };
    });

    // Per-plugin bypass toggle in routing panels
    document.querySelectorAll('[data-weqplugbypass]').forEach(function (btn) {
        btn.onclick = function (e) {
            e.stopPropagation();
            var pid = parseInt(btn.dataset.weqplugbypass);
            var pb = null;
            if (typeof pluginBlocks !== 'undefined') {
                for (var i = 0; i < pluginBlocks.length; i++) {
                    if (pluginBlocks[i].id === pid) { pb = pluginBlocks[i]; break; }
                }
            }
            if (!pb) return;
            pb.bypassed = !pb.bypassed;
            if (window.__JUCE__ && window.__JUCE__.backend) {
                var fn = window.__juceGetNativeFunction('setPluginBypass');
                fn(pb.hostId, pb.bypassed);
            }
            if (typeof renderAllPlugins === 'function') renderAllPlugins();
            if (typeof saveUiStateToHost === 'function') saveUiStateToHost();
            weqRenderPanel();
        };
    });

    // Plugin assign buttons on band cards — reuses existing context menu
    document.querySelectorAll('[data-weqplugassign]').forEach(function (btn) {
        btn.onclick = function (e) {
            e.stopPropagation();
            var ptIdx = parseInt(btn.dataset.weqplugassign);
            weqShowPluginAssign(ptIdx, e);
        };
    });

    // Plugin load buttons — opens the main plugin browser,
    // auto-assigns the loaded plugin to this band on completion
    document.querySelectorAll('[data-weqplugload]').forEach(function (btn) {
        btn.onclick = function (e) {
            e.stopPropagation();
            var ptIdx = parseInt(btn.dataset.weqplugload);
            // Store the target band so the load callback can auto-assign
            window._weqLoadTargetBand = ptIdx;
            if (typeof openPluginBrowser === 'function') openPluginBrowser();
        };
    });

    // Remove plugin from band
    document.querySelectorAll('[data-weqplugremove]').forEach(function (btn) {
        btn.onclick = function (e) {
            e.stopPropagation();
            var parts = btn.dataset.weqplugremove.split(':');
            var bandIdx = parseInt(parts[0]);
            var plugId = parseInt(parts[1]);
            if (bandIdx < 0 || bandIdx >= wrongEqPoints.length) return;
            var pt = wrongEqPoints[bandIdx];
            if (!pt.pluginIds) return;
            var idx = pt.pluginIds.indexOf(plugId);
            if (idx >= 0) pt.pluginIds.splice(idx, 1);
            if (typeof weqSyncToHost === 'function') weqSyncToHost();
            if (typeof markStateDirty === 'function') markStateDirty();
            _weqSyncPluginBusIds();
            weqRenderPanel();
        };
    });

    // Reorder plugins within a band (move up / move down)
    document.querySelectorAll('[data-weqplugmove]').forEach(function (btn) {
        btn.onclick = function (e) {
            e.stopPropagation();
            var parts = btn.dataset.weqplugmove.split(':');
            var bandIdx = parseInt(parts[0]);
            var plugIdx = parseInt(parts[1]);
            var dir = parts[2]; // 'up' or 'down'
            if (bandIdx < 0 || bandIdx >= wrongEqPoints.length) return;
            var pt = wrongEqPoints[bandIdx];
            if (!pt.pluginIds || plugIdx < 0 || plugIdx >= pt.pluginIds.length) return;
            var swapIdx = dir === 'up' ? plugIdx - 1 : plugIdx + 1;
            if (swapIdx < 0 || swapIdx >= pt.pluginIds.length) return;
            // Swap
            var tmp = pt.pluginIds[plugIdx];
            pt.pluginIds[plugIdx] = pt.pluginIds[swapIdx];
            pt.pluginIds[swapIdx] = tmp;
            if (typeof weqSyncToHost === 'function') weqSyncToHost();
            if (typeof markStateDirty === 'function') markStateDirty();
            weqRenderPanel();
        };
    });

    // Move plugin from band to global (unassign from band)
    document.querySelectorAll('[data-weqplugtoglobal]').forEach(function (btn) {
        btn.onclick = function (e) {
            e.stopPropagation();
            var parts = btn.dataset.weqplugtoglobal.split(':');
            var bandIdx = parseInt(parts[0]);
            var plugId = parseInt(parts[1]);
            if (bandIdx < 0 || bandIdx >= wrongEqPoints.length) return;
            var pt = wrongEqPoints[bandIdx];
            if (!pt.pluginIds) return;
            var idx = pt.pluginIds.indexOf(plugId);
            if (idx >= 0) pt.pluginIds.splice(idx, 1);
            // Auto-enable global mode when moving first plugin there
            if (weqUnassignedMode === 0) weqUnassignedMode = 1;
            if (typeof weqSyncToHost === 'function') weqSyncToHost();
            if (typeof markStateDirty === 'function') markStateDirty();
            _weqSyncPluginBusIds();
            weqRenderPanel();
        };
    });

    // Assign global plugin to a band (shows context menu with band choices)
    document.querySelectorAll('[data-weqglobalassign]').forEach(function (btn) {
        btn.onclick = function (e) {
            e.stopPropagation();
            var plugId = parseInt(btn.dataset.weqglobalassign);
            if (wrongEqPoints.length === 0) return;
            // Build context menu items
            var items = wrongEqPoints.map(function (pt, idx) {
                var col = _weqBandColor(idx + 1, wrongEqPoints);
                var freq = weqFmtFreq(weqXToFreq(pt.x));
                return {
                    label: 'Band ' + (idx + 1) + ' — ' + freq,
                    color: col,
                    action: function () {
                        if (!wrongEqPoints[idx].pluginIds) wrongEqPoints[idx].pluginIds = [];
                        if (wrongEqPoints[idx].pluginIds.indexOf(plugId) < 0) {
                            wrongEqPoints[idx].pluginIds.push(plugId);
                        }
                        weqSyncToHost();
                        if (typeof markStateDirty === 'function') markStateDirty();
                        _weqSyncPluginBusIds();
                        weqRenderPanel();
                    }
                };
            });
            _weqShowCtxMenu(items, e);
        };
    });

    // Routing sidebar tab toggle
    var routingTab = document.getElementById('weqRoutingTab');
    if (routingTab) routingTab.onclick = function (e) {
        e.stopPropagation();
        window._weqRoutingPanelOpen = !window._weqRoutingPanelOpen;
        var sidebar = routingTab.closest('.weq-routing-sidebar');
        if (sidebar) sidebar.classList.toggle('open', window._weqRoutingPanelOpen);
    };

    // Global load button — load plugin as unassigned (global)
    var globalLoadBtn = document.getElementById('weqGlobalLoad');
    if (globalLoadBtn) globalLoadBtn.onclick = function (e) {
        e.stopPropagation();
        window._weqLoadTargetBand = -1; // ensure no band auto-assign
        if (typeof openPluginBrowser === 'function') openPluginBrowser();
    };

    // Delete plugin from global routing section
    document.querySelectorAll('[data-weqglobalrm]').forEach(function (btn) {
        btn.onclick = function (e) {
            e.stopPropagation();
            var plugId = parseInt(btn.dataset.weqglobalrm);
            if (typeof removePlugin === 'function') removePlugin(plugId);
        };
    });

    // Per-band Solo buttons
    document.querySelectorAll('[data-weqsolo]').forEach(function (btn) {
        btn.onclick = function (e) {
            e.stopPropagation();
            var idx = parseInt(btn.dataset.weqsolo);
            if (idx < 0 || idx >= wrongEqPoints.length) return;
            var wasSoloed = wrongEqPoints[idx].solo;
            // Exclusive solo: unsolo all others, toggle this one
            for (var si = 0; si < wrongEqPoints.length; si++) wrongEqPoints[si].solo = false;
            wrongEqPoints[idx].solo = !wasSoloed;
            weqRenderPanel();
            weqSyncToHost();
            if (typeof markStateDirty === 'function') markStateDirty();
        };
    });

    // Per-band Mute buttons
    document.querySelectorAll('[data-weqmute]').forEach(function (btn) {
        btn.onclick = function (e) {
            e.stopPropagation();
            var idx = parseInt(btn.dataset.weqmute);
            if (idx < 0 || idx >= wrongEqPoints.length) return;
            wrongEqPoints[idx].mute = !wrongEqPoints[idx].mute;
            weqRenderPanel();
            weqSyncToHost();
            if (typeof markStateDirty === 'function') markStateDirty();
        };
    });

    // Band row: Gain drag + double-click reset
    document.querySelectorAll('[data-weqgain]').forEach(function (el) {
        var idx = parseInt(el.dataset.weqgain);
        el.ondblclick = function (e) {
            e.stopPropagation();
            if (idx >= 0 && idx < wrongEqPoints.length) {
                wrongEqPoints[idx].y = weqDBtoY(0); // reset to 0dB
                if (weqAnimRafId) weqAnimBaseY[idx] = weqDBtoY(0);
                weqRenderPanel(); weqSyncToHost(); weqSyncVirtualParams();
                if (typeof markStateDirty === 'function') markStateDirty();
            }
        };
        el.onmousedown = function (e) {
            e.preventDefault(); e.stopPropagation();
            var startY = e.clientY;
            var baseYVal = (weqAnimRafId && weqAnimBaseY[idx] != null) ? weqAnimBaseY[idx] : (idx >= 0 && idx < wrongEqPoints.length ? wrongEqPoints[idx].y : weqDBtoY(0));
            var startDB = weqYToDB(baseYVal);
            function onMove(ev) {
                var dy = startY - ev.clientY;
                var newDB = Math.max(-weqDBRangeMax, Math.min(weqDBRangeMax, startDB + dy * 0.3));
                if (idx >= 0 && idx < wrongEqPoints.length) {
                    wrongEqPoints[idx].y = weqDBtoY(newDB);
                    if (weqAnimRafId) weqAnimBaseY[idx] = weqDBtoY(newDB);
                    el.textContent = weqFmtDB(newDB);
                    el.className = 'weq-card-pval' + (newDB > 0.1 ? ' boost' : (newDB < -0.1 ? ' cut' : ''));
                    weqDrawCanvas();
                    weqSyncToHost(); // real-time sync
                }
            }
            function onUp() {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                // Skip full re-render during animation — text was updated inline during drag
                if (!weqAnimRafId) weqRenderPanel();
                weqSyncToHost(); weqSyncVirtualParams();
                if (typeof markStateDirty === 'function') markStateDirty();
            }
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        };
    });

    // Band card: Frequency drag + double-click reset
    document.querySelectorAll('[data-weqfreq]').forEach(function (el) {
        var idx = parseInt(el.dataset.weqfreq);
        el.style.cursor = 'ns-resize';
        el.ondblclick = function (e) {
            e.stopPropagation();
            if (idx >= 0 && idx < wrongEqPoints.length) {
                wrongEqPoints[idx].x = weqFreqToX(1000); // reset to 1kHz
                if (weqAnimRafId && weqAnimBaseX[idx] != null) weqAnimBaseX[idx] = wrongEqPoints[idx].x;
                weqRenderPanel(); weqSyncToHost(); weqSyncVirtualParams();
                if (typeof markStateDirty === 'function') markStateDirty();
            }
        };
        el.onmousedown = function (e) {
            e.preventDefault(); e.stopPropagation();
            var startY = e.clientY;
            var startFreq = (idx >= 0 && idx < wrongEqPoints.length) ? weqXToFreq(wrongEqPoints[idx].x) : 1000;
            function onMove(ev) {
                var dy = startY - ev.clientY; // up = higher freq
                var newFreq = Math.max(WEQ_MIN_FREQ, Math.min(WEQ_MAX_FREQ, startFreq * Math.pow(1.006, dy)));
                if (idx >= 0 && idx < wrongEqPoints.length) {
                    wrongEqPoints[idx].x = weqFreqToX(newFreq);
                    if (weqAnimRafId && weqAnimBaseX[idx] != null) weqAnimBaseX[idx] = wrongEqPoints[idx].x;
                    el.textContent = weqFmtFreq(newFreq);
                    weqDrawCanvas();
                    weqSyncToHost();
                }
            }
            function onUp() {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                if (!weqAnimRafId) weqRenderPanel();
                weqSyncToHost(); weqSyncVirtualParams();
                if (typeof markStateDirty === 'function') markStateDirty();
            }
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        };
    });

    // Band row: Q drag + double-click reset
    document.querySelectorAll('[data-weqq]').forEach(function (el) {
        var idx = parseInt(el.dataset.weqq);
        var _qDragPending = null; // timeout ID for deferred drag start
        var _qDragActive = false;

        el.ondblclick = function (e) {
            e.stopPropagation(); e.preventDefault();
            // Cancel any pending drag setup
            if (_qDragPending) { clearTimeout(_qDragPending); _qDragPending = null; }
            _qDragActive = false;
            if (idx >= 0 && idx < wrongEqPoints.length) {
                wrongEqPoints[idx].q = 0.707;
                if (weqAnimRafId && weqAnimBaseQ[idx] != null) weqAnimBaseQ[idx] = 0.707;
                el.textContent = '0.71';
                weqDrawCanvas();
                weqSyncToHost(); weqSyncVirtualParams();
                if (typeof markStateDirty === 'function') markStateDirty();
            }
        };
        el.onmousedown = function (e) {
            e.preventDefault(); e.stopPropagation();
            var startY = e.clientY;
            var startQ = (idx >= 0 && idx < wrongEqPoints.length && wrongEqPoints[idx].q != null) ? wrongEqPoints[idx].q : 0.707;
            _qDragActive = false;

            function onMove(ev) {
                _qDragActive = true;
                var dy = startY - ev.clientY;
                var newQ = Math.max(0.025, Math.min(40, startQ * Math.pow(1.01, dy)));
                if (idx >= 0 && idx < wrongEqPoints.length) {
                    wrongEqPoints[idx].q = newQ;
                    if (weqAnimRafId && weqAnimBaseQ[idx] != null) weqAnimBaseQ[idx] = newQ;
                    el.textContent = newQ.toFixed(2);
                    weqDrawCanvas();
                    _weqUpdateLegendRanges();
                    weqSyncToHost();
                }
            }
            function onUp() {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                if (_qDragActive) {
                    if (!weqAnimRafId) weqRenderPanel();
                    weqSyncToHost(); weqSyncVirtualParams();
                    if (typeof markStateDirty === 'function') markStateDirty();
                }
                _qDragActive = false;
            }
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        };
    });

    // Band row: Type cycle
    document.querySelectorAll('[data-weqtype]').forEach(function (btn) {
        var idx = parseInt(btn.dataset.weqtype);
        btn.onclick = function (e) {
            e.stopPropagation();
            if (idx < 0 || idx >= wrongEqPoints.length) return;
            var current = wrongEqPoints[idx].type || 'Bell';
            var ci = WEQ_TYPES.indexOf(current);
            var newType = WEQ_TYPES[(ci + 1) % WEQ_TYPES.length];
            wrongEqPoints[idx].type = newType;
            // LP/HP always sit at 0dB — snap Y to center
            if (newType === 'LP' || newType === 'HP') {
                wrongEqPoints[idx].y = weqDBtoY(0);
            }
            weqRenderPanel();
            weqSyncToHost();
            if (typeof markStateDirty === 'function') markStateDirty();
        };
    });
    // Band strip: direct type set via inline radio toggles
    document.querySelectorAll('[data-weqtypeset]').forEach(function (btn) {
        var parts = btn.dataset.weqtypeset.split(':');
        var idx = parseInt(parts[0]);
        var newType = parts[1];
        btn.onclick = function (e) {
            e.stopPropagation();
            if (idx < 0 || idx >= wrongEqPoints.length) return;
            if (wrongEqPoints[idx].type === newType) return; // already active
            wrongEqPoints[idx].type = newType;
            if (newType === 'LP' || newType === 'HP') {
                wrongEqPoints[idx].y = weqDBtoY(0);
            }
            weqRenderPanel();
            weqSyncToHost();
            if (typeof markStateDirty === 'function') markStateDirty();
        };
    });
    // Band row: per-point slope selector (12/24/48 dB/oct)
    document.querySelectorAll('[data-weqslope]').forEach(function (btn) {
        var parts = btn.dataset.weqslope.split(':');
        var idx = parseInt(parts[0]);
        var newSlope = parseInt(parts[1]);
        btn.onclick = function (e) {
            e.stopPropagation();
            if (idx < 0 || idx >= wrongEqPoints.length) return;
            if ((wrongEqPoints[idx].slope || 1) === newSlope) return;
            wrongEqPoints[idx].slope = newSlope;
            weqRenderPanel();
            weqSyncToHost();
            if (typeof markStateDirty === 'function') markStateDirty();
        };
    });
    // Band row: per-point Pre/Post EQ toggle
    document.querySelectorAll('[data-weqpointpreq]').forEach(function (btn) {
        var idx = parseInt(btn.dataset.weqpointpreq);
        btn.onclick = function (e) {
            e.stopPropagation();
            if (idx < 0 || idx >= wrongEqPoints.length) return;
            wrongEqPoints[idx].preEq = !(wrongEqPoints[idx].preEq !== false);
            weqRenderPanel();
            weqSyncToHost();
            if (typeof renderAllPlugins === 'function') renderAllPlugins();
            if (typeof markStateDirty === 'function') markStateDirty();
        };
    });

    // Band strip: Stereo mode selector (LR / M / S)
    document.querySelectorAll('[data-weqstereo]').forEach(function (btn) {
        var parts = btn.dataset.weqstereo.split(':');
        var idx = parseInt(parts[0]);
        var mode = parseInt(parts[1]);
        btn.onclick = function (e) {
            e.stopPropagation();
            if (idx < 0 || idx >= wrongEqPoints.length) return;
            if ((wrongEqPoints[idx].stereoMode || 0) === mode) return; // already set
            wrongEqPoints[idx].stereoMode = mode;
            weqRenderPanel();
            weqSyncToHost();
            if (typeof markStateDirty === 'function') markStateDirty();
        };
    });

    // Band row: Drift drag + double-click reset
    document.querySelectorAll('[data-weqdrift]').forEach(function (el) {
        var idx = parseInt(el.dataset.weqdrift);
        el.ondblclick = function (e) {
            e.stopPropagation();
            if (idx >= 0 && idx < wrongEqPoints.length) {
                wrongEqPoints[idx].drift = 0;
                weqRenderPanel(); weqSyncToHost();
                if (typeof markStateDirty === 'function') markStateDirty();
            }
        };
        el.onmousedown = function (e) {
            e.preventDefault(); e.stopPropagation();
            var startY = e.clientY;
            var startDrift = (idx >= 0 && idx < wrongEqPoints.length && wrongEqPoints[idx].drift != null) ? wrongEqPoints[idx].drift : 0;
            function onMove(ev) {
                var dy = startY - ev.clientY;
                var newDrift = Math.max(0, Math.min(100, Math.round(startDrift + dy * 0.5)));
                if (idx >= 0 && idx < wrongEqPoints.length) {
                    wrongEqPoints[idx].drift = newDrift;
                    el.textContent = 'Drift ' + newDrift + '%';
                    weqSyncToHost(); // real-time sync
                }
            }
            function onUp() {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                // Skip full re-render during animation — drift text was updated inline
                if (!weqAnimRafId) weqRenderPanel();
                weqSyncToHost();
                if (typeof markStateDirty === 'function') markStateDirty();
            }
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        };
    });

    // Band row: Delete button
    document.querySelectorAll('[data-weqdel]').forEach(function (btn) {
        var idx = parseInt(btn.dataset.weqdel);
        btn.onclick = function (e) {
            e.stopPropagation();
            if (idx >= 0 && idx < wrongEqPoints.length) {
                _weqPushUndo();
                wrongEqPoints.splice(idx, 1);
                if (weqAnimRafId && weqAnimBaseY.length > idx) { weqAnimBaseY.splice(idx, 1); weqAnimBaseX.splice(idx, 1); }
                weqSelectedPt = -1;
                weqFocusBand = -1;
                weqSegSel.clear();
                weqRenderPanel(); weqSyncToHost();
                if (typeof markStateDirty === 'function') markStateDirty();
            }
        };
    });

    // Footer knobs (drag vertical + double-click reset)
    document.querySelectorAll('[data-wk]').forEach(function (knob) {
        var key = knob.dataset.wk;
        // Double-click: reset to default
        knob.ondblclick = function (e) {
            e.preventDefault(); e.stopPropagation();
            if (key === 'depth') { weqGlobalDepth = 100; knob.textContent = '100%'; }
            else if (key === 'warp') { weqGlobalWarp = 0; knob.textContent = '+0'; }
            else if (key === 'steps') { weqGlobalSteps = 0; knob.textContent = 'Off'; }
            else if (key === 'tilt') { weqGlobalTilt = 0; knob.textContent = '+0'; }

            else if (key === 'drift') { weqDrift = 0; knob.textContent = '+0'; knob.classList.remove('weq-anim-on'); if (!_weqNeedsAnim()) weqAnimStop(); }
            else if (key === 'driftRange') { weqDriftRange = 5; knob.textContent = '5%'; }
            else if (key === 'speed') { weqAnimSpeed = 0; knob.textContent = 'Off'; knob.classList.remove('weq-anim-on'); if (!_weqNeedsAnim()) weqAnimStop(); }
            else if (key === 'mod') { weqAnimDepth = 6; knob.textContent = '6dB'; }
            else if (key === 'gainLo') { weqGainLoCut = 20; knob.textContent = 'Off'; knob.classList.remove('weq-anim-on'); }
            else if (key === 'gainHi') { weqGainHiCut = 20000; knob.textContent = 'Off'; knob.classList.remove('weq-anim-on'); }
            else if (key === 'driftLo') { weqDriftLoCut = 20; knob.textContent = 'Off'; knob.classList.remove('weq-anim-on'); }
            else if (key === 'driftHi') { weqDriftHiCut = 20000; knob.textContent = 'Off'; knob.classList.remove('weq-anim-on'); }
            else if (key === 'qSpeed') { weqQModSpeed = 0; knob.textContent = 'Off'; knob.classList.remove('weq-anim-on'); if (!_weqNeedsAnim()) weqAnimStop(); }
            else if (key === 'qDepth') { weqQModDepth = 50; knob.textContent = '50%'; }
            else if (key === 'qLo') { weqQLoCut = 20; knob.textContent = 'Off'; knob.classList.remove('weq-anim-on'); }
            else if (key === 'qHi') { weqQHiCut = 20000; knob.textContent = 'Off'; knob.classList.remove('weq-anim-on'); }

            weqDrawCanvas(); weqSyncToHost(); weqSyncVirtualParams();
            if (typeof markStateDirty === 'function') markStateDirty();
        };
        knob.onmousedown = function (e) {
            e.preventDefault();
            var startY = e.clientY;
            var startVal;
            if (key === 'depth') startVal = weqGlobalDepth;
            else if (key === 'warp') startVal = weqGlobalWarp;
            else if (key === 'steps') startVal = weqGlobalSteps;
            else if (key === 'tilt') startVal = weqGlobalTilt;

            else if (key === 'drift') startVal = weqDrift;
            else if (key === 'driftRange') startVal = weqDriftRange;
            else if (key === 'speed') startVal = weqAnimSpeed;
            else if (key === 'mod') startVal = weqAnimDepth;
            // Freq knobs: normalized 0..1 over 20–20000 Hz (log scale)
            else if (key === 'gainLo') startVal = Math.log(weqGainLoCut / 20) / Math.log(20000 / 20);
            else if (key === 'gainHi') startVal = Math.log(weqGainHiCut / 20) / Math.log(20000 / 20);
            else if (key === 'driftLo') startVal = Math.log(weqDriftLoCut / 20) / Math.log(20000 / 20);
            else if (key === 'driftHi') startVal = Math.log(weqDriftHiCut / 20) / Math.log(20000 / 20);
            else if (key === 'qSpeed') startVal = weqQModSpeed;
            else if (key === 'qDepth') startVal = weqQModDepth;
            else if (key === 'qLo') startVal = Math.log(weqQLoCut / 20) / Math.log(20000 / 20);
            else if (key === 'qHi') startVal = Math.log(weqQHiCut / 20) / Math.log(20000 / 20);



            // Shared freq-drag helper (returns clamped Hz from normalized value)
            function _freqFromNorm(norm) {
                return Math.round(20 * Math.pow(20000 / 20, Math.max(0, Math.min(1, norm))));
            }

            function onMove(ev) {
                var dy = startY - ev.clientY;
                if (key === 'depth') {
                    weqGlobalDepth = Math.max(0, Math.min(200, startVal + dy));
                    knob.textContent = weqGlobalDepth + '%';
                } else if (key === 'warp') {
                    weqGlobalWarp = Math.max(-100, Math.min(100, startVal + dy));
                    knob.textContent = (weqGlobalWarp >= 0 ? '+' : '') + weqGlobalWarp;
                } else if (key === 'steps') {
                    weqGlobalSteps = Math.max(0, Math.min(32, Math.round(startVal + dy / 5)));
                    knob.textContent = (weqGlobalSteps || 'Off');
                } else if (key === 'tilt') {
                    weqGlobalTilt = Math.max(-100, Math.min(100, Math.round(startVal + dy * 0.5)));
                    knob.textContent = (weqGlobalTilt >= 0 ? '+' : '') + weqGlobalTilt;
                } else if (key === 'drift') {
                    weqDrift = Math.max(-50, Math.min(50, Math.round(startVal + dy * 0.5)));
                    knob.textContent = (weqDrift >= 0 ? '+' : '') + weqDrift;
                    knob.classList.toggle('weq-anim-on', Math.abs(weqDrift) > 0 && weqDriftRange > 0);
                    var nl = _weqNeedsAnim();
                    if (nl && !weqAnimRafId) weqAnimStart();
                    else if (!nl && weqAnimRafId) weqAnimStop();
                } else if (key === 'driftRange') {
                    weqDriftRange = Math.max(0, Math.min(50, Math.round(startVal + dy * 0.3)));
                    knob.textContent = weqDriftRange + '%';
                    knob.classList.toggle('weq-anim-on', Math.abs(weqDrift) > 0 && weqDriftRange > 0);
                    var nl2 = _weqNeedsAnim();
                    if (nl2 && !weqAnimRafId) weqAnimStart();
                    else if (!nl2 && weqAnimRafId) weqAnimStop();
                } else if (key === 'speed') {
                    var rawSpeed = startVal + dy * 0.05;
                    if (rawSpeed < 1) {
                        weqAnimSpeed = Math.max(0, Math.round(rawSpeed * 100) / 100);
                    } else {
                        weqAnimSpeed = Math.max(0, Math.min(10, Math.round(rawSpeed * 10) / 10));
                    }
                    knob.textContent = weqAnimSpeed > 0 ? (weqAnimSpeed < 1 ? weqAnimSpeed.toFixed(2) + 'Hz' : weqAnimSpeed.toFixed(1) + 'Hz') : 'Off';
                    knob.classList.toggle('weq-anim-on', weqAnimSpeed > 0);
                    var nl3 = _weqNeedsAnim();
                    if (nl3 && !weqAnimRafId) weqAnimStart();
                    else if (!nl3 && weqAnimRafId) weqAnimStop();
                } else if (key === 'mod') {
                    weqAnimDepth = Math.max(0, Math.min(24, Math.round(startVal + dy * 0.3)));
                    knob.textContent = weqAnimDepth + 'dB';
                    knob.classList.toggle('weq-anim-on', weqAnimDepth > 0 && weqAnimSpeed > 0);
                } else if (key === 'gainLo') {
                    weqGainLoCut = _freqFromNorm(startVal + dy * 0.003);
                    if (weqGainLoCut <= 25) weqGainLoCut = 20;
                    if (weqGainLoCut >= weqGainHiCut) weqGainLoCut = weqGainHiCut - 1;
                    knob.textContent = weqGainLoCut > 20 ? weqFmtFreq(weqGainLoCut) : 'Off';
                    knob.classList.toggle('weq-anim-on', weqGainLoCut > 20);
                } else if (key === 'gainHi') {
                    weqGainHiCut = _freqFromNorm(startVal + dy * 0.003);
                    if (weqGainHiCut >= 19500) weqGainHiCut = 20000;
                    if (weqGainHiCut <= weqGainLoCut) weqGainHiCut = weqGainLoCut + 1;
                    knob.textContent = weqGainHiCut < 20000 ? weqFmtFreq(weqGainHiCut) : 'Off';
                    knob.classList.toggle('weq-anim-on', weqGainHiCut < 20000);
                } else if (key === 'driftLo') {
                    weqDriftLoCut = _freqFromNorm(startVal + dy * 0.003);
                    if (weqDriftLoCut <= 25) weqDriftLoCut = 20;
                    if (weqDriftLoCut >= weqDriftHiCut) weqDriftLoCut = weqDriftHiCut - 1;
                    knob.textContent = weqDriftLoCut > 20 ? weqFmtFreq(weqDriftLoCut) : 'Off';
                    knob.classList.toggle('weq-anim-on', weqDriftLoCut > 20);
                } else if (key === 'driftHi') {
                    weqDriftHiCut = _freqFromNorm(startVal + dy * 0.003);
                    if (weqDriftHiCut >= 19500) weqDriftHiCut = 20000;
                    if (weqDriftHiCut <= weqDriftLoCut) weqDriftHiCut = weqDriftLoCut + 1;
                    knob.textContent = weqDriftHiCut < 20000 ? weqFmtFreq(weqDriftHiCut) : 'Off';
                    knob.classList.toggle('weq-anim-on', weqDriftHiCut < 20000);
                } else if (key === 'qSpeed') {
                    var rawQSpd = startVal + dy * 0.05;
                    if (rawQSpd < 1) {
                        weqQModSpeed = Math.max(0, Math.round(rawQSpd * 100) / 100);
                    } else {
                        weqQModSpeed = Math.max(0, Math.min(10, Math.round(rawQSpd * 10) / 10));
                    }
                    knob.textContent = weqQModSpeed > 0 ? (weqQModSpeed < 1 ? weqQModSpeed.toFixed(2) + 'Hz' : weqQModSpeed.toFixed(1) + 'Hz') : 'Off';
                    knob.classList.toggle('weq-anim-on', weqQModSpeed > 0 && weqQModDepth > 0);
                    var nlq = _weqNeedsAnim();
                    if (nlq && !weqAnimRafId) weqAnimStart();
                    else if (!nlq && weqAnimRafId) weqAnimStop();
                } else if (key === 'qDepth') {
                    weqQModDepth = Math.max(0, Math.min(100, Math.round(startVal + dy * 0.5)));
                    knob.textContent = weqQModDepth + '%';
                    knob.classList.toggle('weq-anim-on', weqQModSpeed > 0 && weqQModDepth > 0);
                    var nlqd = _weqNeedsAnim();
                    if (nlqd && !weqAnimRafId) weqAnimStart();
                    else if (!nlqd && weqAnimRafId) weqAnimStop();
                } else if (key === 'qLo') {
                    weqQLoCut = _freqFromNorm(startVal + dy * 0.003);
                    if (weqQLoCut <= 25) weqQLoCut = 20;
                    if (weqQLoCut >= weqQHiCut) weqQLoCut = weqQHiCut - 1;
                    knob.textContent = weqQLoCut > 20 ? weqFmtFreq(weqQLoCut) : 'Off';
                    knob.classList.toggle('weq-anim-on', weqQLoCut > 20);
                } else if (key === 'qHi') {
                    weqQHiCut = _freqFromNorm(startVal + dy * 0.003);
                    if (weqQHiCut >= 19500) weqQHiCut = 20000;
                    if (weqQHiCut <= weqQLoCut) weqQHiCut = weqQLoCut + 1;
                    knob.textContent = weqQHiCut < 20000 ? weqFmtFreq(weqQHiCut) : 'Off';
                    knob.classList.toggle('weq-anim-on', weqQHiCut < 20000);
                }
                weqDrawCanvas();
                weqSyncToHost(); // real-time sync during drag
            }
            function onUp() {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                weqSyncToHost(); weqSyncVirtualParams();
                if (typeof markStateDirty === 'function') markStateDirty();
            }
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        };
    });

    // Drift Scale dropdown
    document.querySelectorAll('[data-wf="driftScale"]').forEach(function (sel) {
        sel.onchange = function () {
            weqDriftScale = sel.value;
            weqSyncToHost();
            if (typeof markStateDirty === 'function') markStateDirty();
        };
    });

    // Drift Texture dropdown
    document.querySelectorAll('[data-wf="driftTexture"]').forEach(function (sel) {
        sel.onchange = function () {
            weqDriftTexture = sel.value;
            weqSyncToHost();
            if (typeof markStateDirty === 'function') markStateDirty();
        };
    });

    // LFO Shape dropdown
    document.querySelectorAll('[data-wf="lfoShape"]').forEach(function (sel) {
        sel.onchange = function () {
            weqAnimShape = sel.value;
            weqSyncToHost();
            if (typeof markStateDirty === 'function') markStateDirty();
        };
    });
    document.querySelectorAll('[data-wf="qShape"]').forEach(function (sel) {
        sel.onchange = function () {
            weqQModShape = sel.value;
            weqSyncToHost();
            if (typeof markStateDirty === 'function') markStateDirty();
        };
    });

    // dB Range dropdown
    document.querySelectorAll('[data-wf="dbRange"]').forEach(function (sel) {
        sel.onchange = function () {
            weqDBRangeMax = parseInt(sel.value);
            weqRenderPanel(); // re-render to update axis + canvas
            weqSyncToHost();
            if (typeof markStateDirty === 'function') markStateDirty();
        };
    });

    // Split mode toggle
    var splitBtn = document.getElementById('weqSplitBtn');
    if (splitBtn) splitBtn.onclick = function () {
        _weqPushUndo(); // Always snapshot before toggle

        if (!weqSplitMode) {
            // ── Entering split mode ──
            weqSplitMode = true;

            if (wrongEqPoints.length > 0) {
                // Save current gains so we can restore them when leaving split mode
                _weqSplitSavedGains = wrongEqPoints.map(function (p) { return p.y; });

                // Smart redistribute: only spread points if any are too close together
                // (less than 5% apart in normalized X). This preserves intentional positions.
                var sorted = wrongEqPoints.slice().sort(function (a, b) { return a.x - b.x; });
                var needsDistribute = false;
                for (var si = 1; si < sorted.length; si++) {
                    if (sorted[si].x - sorted[si - 1].x < 0.05) {
                        needsDistribute = true;
                        break;
                    }
                }
                // Also distribute if any point is too close to the edges
                if (sorted.length > 0 && (sorted[0].x < 0.03 || sorted[sorted.length - 1].x > 0.97)) {
                    needsDistribute = true;
                }

                if (needsDistribute) {
                    var n = sorted.length;
                    for (var di = 0; di < n; di++) {
                        sorted[di].x = (di + 1) / (n + 1);
                    }
                }

                // Set gains to 0dB in split mode — crossovers work best flat
                for (var gi = 0; gi < wrongEqPoints.length; gi++) {
                    wrongEqPoints[gi].y = 0.5;
                }
            }

            if (typeof showToast === 'function') showToast('Split mode — bands act as frequency dividers for plugin routing', 'info', 2500);
        } else {
            // ── Leaving split mode ──
            weqSplitMode = false;

            // Restore saved gains from before entering split mode
            if (_weqSplitSavedGains && _weqSplitSavedGains.length === wrongEqPoints.length) {
                for (var ri = 0; ri < wrongEqPoints.length; ri++) {
                    wrongEqPoints[ri].y = _weqSplitSavedGains[ri];
                }
            }
            _weqSplitSavedGains = null;
        }

        // Update animation bases
        weqAnimBaseY = wrongEqPoints.map(function (p) { return p.y; });
        weqAnimBaseX = wrongEqPoints.map(function (p) { return p.x; });

        weqSyncToHost();
        markStateDirty();
        weqRenderPanel();
        weqDrawCanvas();
    };

    // Shapes menu
    var shapesBtn = document.getElementById('weqShapes');
    if (shapesBtn) shapesBtn.onclick = function () { weqShowShapesMenu(shapesBtn); };

    // EQ Preset buttons
    var presetNameBtn = document.getElementById('weqPresetName');
    if (presetNameBtn) presetNameBtn.onclick = function () { _weqShowPresetBrowser(presetNameBtn); };
    var presetSaveBtn = document.getElementById('weqPresetSave');
    if (presetSaveBtn) presetSaveBtn.onclick = function () { _weqSavePresetPrompt(); };
    var presetPrevBtn = document.getElementById('weqPresetPrev');
    if (presetPrevBtn) presetPrevBtn.onclick = function () { _weqNavPreset(-1); };
    var presetNextBtn = document.getElementById('weqPresetNext');
    if (presetNextBtn) presetNextBtn.onclick = function () { _weqNavPreset(1); };

    // Keyboard shortcuts (when popup is visible)
    if (!wrap._weqKeyBound) {
        wrap._weqKeyBound = true;
        document.addEventListener('keydown', function (e) {
            var overlay = document.getElementById('weqOverlay');
            if (!overlay || !overlay.classList.contains('visible')) return;
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

            if (e.key === 'Escape') {
                // Close any open context menu
                var ctxMenu = document.querySelector('.weq-ctx');
                if (ctxMenu) ctxMenu.remove();
                // Deselect
                weqSelectedPt = -1;
                weqFocusBand = -1;
                weqDrawCanvas();
                e.preventDefault();
            }
            // Ctrl+Z: undo last EQ action
            else if (e.key === 'z' && e.ctrlKey && !e.shiftKey) {
                _weqPerformUndo();
                e.preventDefault();
                e.stopPropagation(); // prevent global undo from also firing
            }
            // Delete selected point
            else if ((e.key === 'Delete' || e.key === 'Backspace') && weqSelectedPt >= 0 && weqSelectedPt < wrongEqPoints.length) {
                _weqPushUndo();
                wrongEqPoints.splice(weqSelectedPt, 1);
                if (weqAnimRafId && weqAnimBaseY.length > weqSelectedPt) { weqAnimBaseY.splice(weqSelectedPt, 1); weqAnimBaseX.splice(weqSelectedPt, 1); }
                weqSegSel.clear();
                weqSelectedPt = -1;
                weqFocusBand = -1;
                weqRenderPanel(); weqSyncToHost();
                if (typeof markStateDirty === 'function') markStateDirty();
                e.preventDefault();
            }
            // Clear all
            else if (e.key === 'X' && e.ctrlKey && e.shiftKey) {
                _weqPushUndo();
                wrongEqPoints = []; weqAnimBaseY = []; weqAnimBaseX = []; weqSelectedPt = -1;
                weqRenderPanel(); weqSyncToHost();
                if (typeof markStateDirty === 'function') markStateDirty();
                e.preventDefault();
            }
            // Ctrl+A select all (set weqSelectedPt to last — visual feedback)
            else if (e.key === 'a' && e.ctrlKey) {
                if (wrongEqPoints.length > 0) weqSelectedPt = 0;
                weqDrawCanvas();
                e.preventDefault();
            }
            // Ctrl+D duplicate selected point
            else if (e.key === 'd' && e.ctrlKey) {
                if (weqSelectedPt >= 0 && weqSelectedPt < wrongEqPoints.length) {
                    var src = wrongEqPoints[weqSelectedPt];
                    var dupFreq = Math.min(WEQ_MAX_FREQ, weqXToFreq(src.x) * 1.1);
                    var dup = { uid: _weqAllocUid(), x: weqFreqToX(dupFreq), y: src.y, pluginIds: [], preEq: true, seg: null, solo: false, mute: false, q: src.q || 0.707, type: src.type || 'Bell', drift: src.drift || 0 };
                    wrongEqPoints.push(dup);
                    if (weqAnimRafId) { weqAnimBaseY.push(dup.y); weqAnimBaseX.push(dup.x); }
                    weqSelectedPt = wrongEqPoints.length - 1;
                    weqRenderPanel(); weqSyncToHost();
                    if (typeof markStateDirty === 'function') markStateDirty();
                }
                e.preventDefault();
            }
            // Arrow keys: gain nudge (Up/Down), freq nudge (Left/Right)
            else if (e.key === 'ArrowUp' && !e.altKey && weqSelectedPt >= 0 && weqSelectedPt < wrongEqPoints.length) {
                var step = e.shiftKey ? 6 : 1;
                var curDB = weqYToDB((weqAnimRafId && weqAnimBaseY[weqSelectedPt] != null) ? weqAnimBaseY[weqSelectedPt] : wrongEqPoints[weqSelectedPt].y);
                var newY = weqDBtoY(Math.min(weqDBRangeMax, curDB + step));
                wrongEqPoints[weqSelectedPt].y = newY;
                if (weqAnimRafId && weqAnimBaseY[weqSelectedPt] != null) weqAnimBaseY[weqSelectedPt] = newY;
                weqRenderPanel(); weqSyncToHost();
                if (typeof markStateDirty === 'function') markStateDirty();
                e.preventDefault();
            }
            else if (e.key === 'ArrowDown' && !e.altKey && weqSelectedPt >= 0 && weqSelectedPt < wrongEqPoints.length) {
                var stepD = e.shiftKey ? 6 : 1;
                var curDBd = weqYToDB((weqAnimRafId && weqAnimBaseY[weqSelectedPt] != null) ? weqAnimBaseY[weqSelectedPt] : wrongEqPoints[weqSelectedPt].y);
                var newYd = weqDBtoY(Math.max(-weqDBRangeMax, curDBd - stepD));
                wrongEqPoints[weqSelectedPt].y = newYd;
                if (weqAnimRafId && weqAnimBaseY[weqSelectedPt] != null) weqAnimBaseY[weqSelectedPt] = newYd;
                weqRenderPanel(); weqSyncToHost();
                if (typeof markStateDirty === 'function') markStateDirty();
                e.preventDefault();
            }
            else if (e.key === 'ArrowRight' && weqSelectedPt >= 0 && weqSelectedPt < wrongEqPoints.length) {
                var curFreq = weqXToFreq((weqAnimRafId && weqAnimBaseX[weqSelectedPt] != null) ? weqAnimBaseX[weqSelectedPt] : wrongEqPoints[weqSelectedPt].x);
                var mult = e.shiftKey ? Math.pow(2, 1 / 3) : Math.pow(2, 1 / 12);
                var newFreq = Math.min(WEQ_MAX_FREQ, curFreq * mult);
                var newXr = weqFreqToX(newFreq);
                wrongEqPoints[weqSelectedPt].x = newXr;
                if (weqAnimRafId && weqAnimBaseX[weqSelectedPt] != null) weqAnimBaseX[weqSelectedPt] = newXr;
                weqRenderPanel(); weqSyncToHost();
                if (typeof markStateDirty === 'function') markStateDirty();
                e.preventDefault();
            }
            else if (e.key === 'ArrowLeft' && weqSelectedPt >= 0 && weqSelectedPt < wrongEqPoints.length) {
                var curFreqL = weqXToFreq((weqAnimRafId && weqAnimBaseX[weqSelectedPt] != null) ? weqAnimBaseX[weqSelectedPt] : wrongEqPoints[weqSelectedPt].x);
                var multL = e.shiftKey ? Math.pow(2, 1 / 3) : Math.pow(2, 1 / 12);
                var newFreqL = Math.max(WEQ_MIN_FREQ, curFreqL / multL);
                var newXl = weqFreqToX(newFreqL);
                wrongEqPoints[weqSelectedPt].x = newXl;
                if (weqAnimRafId && weqAnimBaseX[weqSelectedPt] != null) weqAnimBaseX[weqSelectedPt] = newXl;
                weqRenderPanel(); weqSyncToHost();
                if (typeof markStateDirty === 'function') markStateDirty();
                e.preventDefault();
            }
            // Alt+Up/Down: adjust Q of selected point
            else if (e.key === 'ArrowUp' && e.altKey && weqSelectedPt >= 0 && weqSelectedPt < wrongEqPoints.length) {
                var pt = wrongEqPoints[weqSelectedPt];
                var qFact = e.shiftKey ? 1.5 : 1.15;
                pt.q = Math.min(40, (pt.q || 0.707) * qFact);
                weqRenderPanel(); weqSyncToHost();
                if (typeof markStateDirty === 'function') markStateDirty();
                e.preventDefault();
            }
            else if (e.key === 'ArrowDown' && e.altKey && weqSelectedPt >= 0 && weqSelectedPt < wrongEqPoints.length) {
                var ptD = wrongEqPoints[weqSelectedPt];
                var qFactD = e.shiftKey ? 1.5 : 1.15;
                ptD.q = Math.max(0.025, (ptD.q || 0.707) / qFactD);
                weqRenderPanel(); weqSyncToHost();
                if (typeof markStateDirty === 'function') markStateDirty();
                e.preventDefault();
            }
            // Tab: cycle through points
            else if (e.key === 'Tab' && wrongEqPoints.length > 0) {
                if (e.shiftKey) {
                    weqSelectedPt = weqSelectedPt <= 0 ? wrongEqPoints.length - 1 : weqSelectedPt - 1;
                } else {
                    weqSelectedPt = weqSelectedPt >= wrongEqPoints.length - 1 ? 0 : weqSelectedPt + 1;
                }
                weqDrawCanvas();
                e.preventDefault();
            }
            // 0 key: reset selected point gain to 0dB
            else if (e.key === '0' && !e.ctrlKey && weqSelectedPt >= 0 && weqSelectedPt < wrongEqPoints.length) {
                wrongEqPoints[weqSelectedPt].y = weqDBtoY(0);
                if (weqAnimRafId && weqAnimBaseY[weqSelectedPt] != null) weqAnimBaseY[weqSelectedPt] = weqDBtoY(0);
                weqRenderPanel(); weqSyncToHost();
                if (typeof markStateDirty === 'function') markStateDirty();
                e.preventDefault();
            }
            // E key: equal-distribute points across spectrum (split mode power tool)
            else if ((e.key === 'e' || e.key === 'E') && !e.ctrlKey && !e.altKey && wrongEqPoints.length > 1) {
                _weqPushUndo();
                var eqSorted = wrongEqPoints.slice().sort(function (a, b) { return a.x - b.x; });
                var eqN = eqSorted.length;
                for (var eqi = 0; eqi < eqN; eqi++) {
                    eqSorted[eqi].x = (eqi + 1) / (eqN + 1);
                }
                weqAnimBaseX = wrongEqPoints.map(function (p) { return p.x; });
                weqRenderPanel(); weqSyncToHost();
                if (typeof markStateDirty === 'function') markStateDirty();
                if (typeof showToast === 'function') showToast('Points equally distributed', 'info', 1500);
                e.preventDefault();
            }
            // S key: toggle split mode
            else if ((e.key === 's' || e.key === 'S') && !e.ctrlKey && !e.altKey) {
                var splitBtnK = document.getElementById('weqSplitBtn');
                if (splitBtnK) splitBtnK.click();
                e.preventDefault();
            }
        });
    }

    // Canvas mouse interaction
    weqSetupMouse(wrap);
    // Context menus (canvas + band rows)
    weqSetupContextMenu(wrap);
}

// ── Mouse interaction on canvas ──
function weqSetupMouse(wrap) {
    var canvas = document.getElementById('weqCanvas');
    if (!canvas) return;

    function pos(e) {
        var rect = canvas.getBoundingClientRect();
        var dpr = window.devicePixelRatio || 1;
        return {
            x: (e.clientX - rect.left) / rect.width,
            y: weqCanvasToY(e.clientY - rect.top, WEQ_CANVAS_H)
        };
    }

    function snapFreq(x) {
        if (weqGrid === 'free') return x;
        var freq = weqXToFreq(x);
        var lines;
        if (weqGrid === 'oct') {
            lines = [31.25, 62.5, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
        } else if (weqGrid === '1/3') {
            lines = [];
            for (var f = 25; f <= 20000; f *= Math.pow(2, 1 / 3)) lines.push(f);
        } else { // semi
            lines = [];
            for (var f2 = 27.5; f2 <= 20000; f2 *= Math.pow(2, 1 / 12)) lines.push(f2);
        }
        var best = freq, bestDist = Infinity;
        lines.forEach(function (fl) {
            var d = Math.abs(Math.log2(freq) - Math.log2(fl));
            if (d < bestDist) { bestDist = d; best = fl; }
        });
        return weqFreqToX(best);
    }

    function findNearest(p, radius) {
        var bestIdx = -1, bestD = radius;
        var rectW = canvas.getBoundingClientRect().width;
        for (var i = 0; i < wrongEqPoints.length; i++) {
            var dx = (wrongEqPoints[i].x - p.x) * rectW;
            var ptType = wrongEqPoints[i].type || 'Bell';
            var d;
            if (ptType === 'LP' || ptType === 'HP') {
                // LP/HP points sit at 0dB — use X-distance only so the user
                // can grab them from anywhere along their frequency column.
                d = Math.abs(dx);
            } else {
                var dy = (wrongEqPoints[i].y - p.y) * WEQ_CANVAS_H;
                d = Math.sqrt(dx * dx + dy * dy);
            }
            if (d < bestD) { bestD = d; bestIdx = i; }
        }
        return bestIdx;
    }

    wrap.onmousedown = function (e) {
        if (e.button !== 0) return;
        var p = pos(e);
        var dragOrigin = { x: p.x, y: p.y };
        weqDragAxis = null;

        if (weqTool === 'draw') {
            var existing = findNearest(p, 14);
            if (existing >= 0) {
                // Grab existing point
                _weqPushUndo(); // snapshot before drag
                weqDragPt = existing;
                weqSelectedPt = existing;
                weqDrawCanvas();
            } else {
                // Create new point
                _weqPushUndo();
                // In split mode, new points are crossover dividers — force 0dB
                var newY = weqSplitMode ? 0.5 : p.y;
                var newPt = { uid: _weqAllocUid(), x: snapFreq(p.x), y: newY, pluginIds: [], preEq: true, seg: null, solo: false, mute: false, q: 0.707, type: 'Bell', drift: 0 };
                wrongEqPoints.push(newPt);
                weqSelectedPt = wrongEqPoints.length - 1;
                weqDragPt = weqSelectedPt;
                if (weqAnimRafId) { weqAnimBaseY.push(newY); weqAnimBaseX.push(snapFreq(p.x)); }
                weqDrawCanvas();
                weqSyncToHost();
            }
        }

        function onMove(ev) {
            if (weqDragPt < 0) return;
            var pm = pos(ev);

            // Clamp X to valid frequency range (20Hz – 20kHz)
            var xMin = weqFreqToX(WEQ_MIN_FREQ);
            var xMax = weqFreqToX(WEQ_MAX_FREQ);
            var newX = Math.max(xMin + 0.001, Math.min(xMax - 0.001, snapFreq(pm.x)));
            var newY = Math.max(0, Math.min(1, pm.y));
            if (ev.shiftKey) {
                if (!weqDragAxis) {
                    var dx = Math.abs(pm.x - dragOrigin.x);
                    var dy = Math.abs(pm.y - dragOrigin.y);
                    if (dx > 0.01 || dy > 0.01) weqDragAxis = dx > dy ? 'h' : 'v';
                }
                if (weqDragAxis === 'h') newY = wrongEqPoints[weqDragPt].y;
                else if (weqDragAxis === 'v') newX = wrongEqPoints[weqDragPt].x;
            } else {
                weqDragAxis = null;
            }
            wrongEqPoints[weqDragPt].x = newX;
            wrongEqPoints[weqDragPt].y = newY;

            // Split mode: clamp X between neighbors (can't cross)
            if (weqSplitMode) {
                var _spSorted = wrongEqPoints.slice().sort(function (a, b) { return a.x - b.x; });
                var _spIdx = _spSorted.indexOf(wrongEqPoints[weqDragPt]);
                var _spMinX = _spIdx > 0 ? _spSorted[_spIdx - 1].x + 0.02 : 0.02;
                var _spMaxX = _spIdx < _spSorted.length - 1 ? _spSorted[_spIdx + 1].x - 0.02 : 0.98;
                wrongEqPoints[weqDragPt].x = Math.max(_spMinX, Math.min(_spMaxX, wrongEqPoints[weqDragPt].x));
            }
            // LP/HP: vertical drag controls Q (resonance/slope), Y stays at 0dB
            var dragType = wrongEqPoints[weqDragPt].type || 'Bell';
            if (dragType === 'LP' || dragType === 'HP') {
                // Map vertical drag distance from 0dB center to Q: up = higher Q, down = lower Q
                var dragDeltaY = weqDBtoY(0) - newY; // positive when dragged up
                var newQ = 0.707 + dragDeltaY * 8; // scale: full drag = ~4 Q range
                wrongEqPoints[weqDragPt].q = Math.max(0.025, Math.min(40, newQ));
                wrongEqPoints[weqDragPt].y = weqDBtoY(0); // keep at 0dB
            }
            // Update animation base so drift/anim is relative to dragged position
            if (weqAnimRafId) {
                if (weqAnimBaseY[weqDragPt] != null) weqAnimBaseY[weqDragPt] = wrongEqPoints[weqDragPt].y;
                if (weqAnimBaseX[weqDragPt] != null) weqAnimBaseX[weqDragPt] = wrongEqPoints[weqDragPt].x;
                if (weqAnimBaseQ[weqDragPt] != null) weqAnimBaseQ[weqDragPt] = wrongEqPoints[weqDragPt].q;
            }
            weqDrawCanvas();
            // Update band card freq + gain in real-time during drag
            if (wrongEqPoints[weqDragPt]) {
                var dragFreq = weqXToFreq(wrongEqPoints[weqDragPt].x);
                var dragDB = weqYToDB(wrongEqPoints[weqDragPt].y);
                // Update band card frequency hero value
                var freqEl = document.querySelector('[data-weqfreq="' + weqDragPt + '"]');
                if (freqEl) freqEl.textContent = weqFmtFreq(dragFreq);
                // Update band card gain value
                var gainEl = document.querySelector('[data-weqgain="' + weqDragPt + '"]');
                if (gainEl) {
                    gainEl.textContent = weqFmtDB(dragDB);
                    gainEl.className = 'weq-card-pval' + (dragDB > 0.1 ? ' boost' : (dragDB < -0.1 ? ' cut' : ''));
                }
                // Update legend chip ranges
                _weqUpdateLegendRanges();
                weqSyncToHost();
                weqSyncVirtualParams();
                if (typeof markStateDirty === 'function') markStateDirty();
            }
        }
        function onUp() {
            weqDragPt = -1;
            weqDragAxis = null;
            wrap.style.cursor = '';
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            // Update animation base positions if animation is running
            if (weqAnimRafId) {
                weqAnimBaseY = wrongEqPoints.map(function (p) { return p.y; });
            }
            weqRenderPanel(); // full re-render on mouseup to update band rows
            weqSyncToHost();
            weqSyncVirtualParams();
            if (typeof markStateDirty === 'function') markStateDirty();
        }
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    };

    // Double-click: on point = reset gain to 0dB, on empty = add point at 0dB
    wrap.ondblclick = function (e) {
        var p = pos(e);
        var hit = findNearest(p, 12);
        if (hit >= 0) {
            // Reset point gain to 0dB (pro EQ behavior)
            _weqPushUndo();
            wrongEqPoints[hit].y = weqDBtoY(0);
            if (weqAnimRafId && weqAnimBaseY[hit] != null) weqAnimBaseY[hit] = weqDBtoY(0);
            weqSelectedPt = hit;
            weqRenderPanel();
            weqSyncToHost();
            if (typeof markStateDirty === 'function') markStateDirty();
        } else {
            // Add new point at 0dB at clicked frequency
            _weqPushUndo();
            var newPt = { uid: _weqAllocUid(), x: snapFreq(p.x), y: weqDBtoY(0), pluginIds: [], preEq: true, seg: null, solo: false, mute: false, q: 0.707, type: 'Bell', drift: 0 };
            wrongEqPoints.push(newPt);
            if (weqAnimRafId) { weqAnimBaseY.push(newPt.y); weqAnimBaseX.push(newPt.x); }
            weqSelectedPt = wrongEqPoints.length - 1;
            weqRenderPanel();
            weqSyncToHost();
            if (typeof markStateDirty === 'function') markStateDirty();
        }
    };

    // Hover cursor + tooltip
    wrap.onmousemove = function (e) {
        var p = pos(e);
        // Floating tooltip
        var tip = wrap.querySelector('.weq-tip');
        if (!tip) {
            tip = document.createElement('div');
            tip.className = 'weq-tip';
            wrap.appendChild(tip);
        }

        // During drag: show live tooltip following the dragged point
        if (weqDragPt >= 0 && weqDragPt < wrongEqPoints.length) {
            var dpt = wrongEqPoints[weqDragPt];
            var dFreq = weqXToFreq(dpt.x);
            var dDB = weqYToDB(dpt.y);
            tip.textContent = 'P' + (weqDragPt + 1) + '  ' + weqFmtFreq(dFreq) + 'Hz  ' + (dDB >= 0 ? '+' : '') + weqFmtDB(dDB) + 'dB  Q=' + (dpt.q || 0.707).toFixed(2);
            var rect = canvas.getBoundingClientRect();
            tip.style.left = ((dpt.x * rect.width) | 0) + 'px';
            tip.style.top = (weqYtoCanvas(dpt.y, WEQ_CANVAS_H) - 24) + 'px';
            tip.style.display = '';
            tip.style.opacity = '1';
            tip.style.borderColor = 'var(--accent)';
            return;
        }

        // Reset border color when not dragging
        tip.style.borderColor = '';

        var near = findNearest(p, 14);
        if (weqTool === 'draw') {
            wrap.style.cursor = near >= 0 ? 'grab' : 'crosshair';
        }
        if (near >= 0) {
            var pt = wrongEqPoints[near];
            var freq = weqXToFreq(pt.x);
            var db = weqYToDB(pt.y);
            tip.textContent = 'P' + (near + 1) + '  ' + weqFmtFreq(freq) + 'Hz  ' + (db >= 0 ? '+' : '') + weqFmtDB(db) + 'dB  Q=' + (pt.q || 0.707).toFixed(2);
            var rect = canvas.getBoundingClientRect();
            tip.style.left = ((pt.x * rect.width) | 0) + 'px';
            tip.style.top = (weqYtoCanvas(pt.y, WEQ_CANVAS_H) - 24) + 'px';
            tip.style.display = '';
        } else {
            // Show crosshair position
            var freq2 = weqXToFreq(p.x);
            var db2 = weqYToDB(p.y);
            tip.textContent = weqFmtFreq(freq2) + 'Hz  ' + (db2 >= 0 ? '+' : '') + weqFmtDB(db2) + 'dB';
            tip.style.left = ((e.clientX - canvas.getBoundingClientRect().left) | 0) + 'px';
            tip.style.top = ((e.clientY - canvas.getBoundingClientRect().top) - 24) + 'px';
            tip.style.display = '';
            tip.style.opacity = '0.4';
        }
        if (near >= 0) tip.style.opacity = '1';
    };

    wrap.onmouseleave = function () {
        var tip = wrap.querySelector('.weq-tip');
        if (tip) tip.style.display = 'none';
    };

    // ── Scroll wheel: adjust Q of nearest point (FabFilter-style) ──
    wrap.onwheel = function (e) {
        e.preventDefault();
        var p = pos(e);
        var near = findNearest(p, 18);
        if (near < 0) return;
        var pt = wrongEqPoints[near];
        // Logarithmic Q scroll: multiply/divide by factor (Pro-Q 3 style)
        var qFactor = e.shiftKey ? 1.5 : 1.15;
        var dir = e.deltaY < 0 ? 1 : -1;
        var curQ = pt.q || 0.707;
        pt.q = Math.max(0.025, Math.min(40, dir > 0 ? curQ * qFactor : curQ / qFactor));
        weqSelectedPt = near;
        // Update tooltip live
        var tip = wrap.querySelector('.weq-tip');
        var freq = weqXToFreq(pt.x);
        var db = weqYToDB(pt.y);
        if (tip) tip.textContent = weqFmtFreq(freq) + 'Hz  ' + weqFmtDB(db) + 'dB  Q=' + pt.q.toFixed(2);
        weqDrawCanvas();
        _weqUpdateLegendRanges();
        weqSyncToHost();
        weqSyncVirtualParams();
    };
    // Context menu uses global _weqShowCtxMenu (defined below)
}

// ── Global context menu helper ──
function _weqShowCtxMenu(items, e) {
    var old = document.querySelector('.weq-ctx');
    if (old) old.remove();

    var menu = document.createElement('div');
    menu.className = 'ctx weq-ctx';
    menu.style.cssText = 'display:block;position:fixed;left:' + e.clientX + 'px;top:' + e.clientY + 'px;z-index:9999';

    items.forEach(function (item) {
        if (item.sep) {
            var sepEl = document.createElement('div');
            sepEl.className = 'ctx-sep';
            menu.appendChild(sepEl);
            return;
        }
        var el = document.createElement('div');
        el.className = 'ctx-i' + (item.disabled ? ' disabled' : '');
        el.textContent = item.label;
        if (!item.disabled && item.action) {
            el.onclick = function (ev) {
                ev.stopPropagation();
                closeMenu();
                item.action();
            };
        }
        menu.appendChild(el);
    });
    document.body.appendChild(menu);

    var rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) menu.style.left = (window.innerWidth - rect.width - 4) + 'px';
    if (rect.bottom > window.innerHeight) menu.style.top = (window.innerHeight - rect.height - 4) + 'px';

    function closeMenu() {
        if (menu.parentNode) menu.remove();
        document.removeEventListener('mousedown', onOutside);
        document.removeEventListener('keydown', onEsc);
    }
    function onOutside(de) {
        if (!menu.contains(de.target)) closeMenu();
    }
    function onEsc(ke) {
        if (ke.key === 'Escape') { closeMenu(); ke.preventDefault(); }
    }
    setTimeout(function () {
        document.addEventListener('mousedown', onOutside);
        document.addEventListener('keydown', onEsc);
    }, 10);
}

// ── Build point context menu items (shared by canvas & band rows) ──
function _weqBuildPointMenu(hit, e) {
    var pt = wrongEqPoints[hit];
    var freq = weqXToFreq(pt.x);
    weqSelectedPt = hit;

    var typeItems = WEQ_TYPES.map(function (t) {
        return {
            label: (pt.type === t ? '● ' : '  ') + t, action: function () {
                wrongEqPoints[hit].type = t;
                if (t === 'LP' || t === 'HP') wrongEqPoints[hit].y = weqDBtoY(0);
                weqRenderPanel(); weqSyncToHost();
                if (typeof markStateDirty === 'function') markStateDirty();
            }
        };
    });

    var items = [
        { label: 'P' + (hit + 1) + ': ' + weqFmtFreq(freq) + 'Hz  ' + weqFmtDB(weqYToDB(pt.y)) + 'dB  Q=' + (pt.q || 0.707).toFixed(2), disabled: true },
        { sep: true },
        {
            label: 'Reset to 0 dB', action: function () {
                _weqPushUndo();
                wrongEqPoints[hit].y = weqDBtoY(0);
                if (weqAnimRafId && weqAnimBaseY[hit] != null) weqAnimBaseY[hit] = weqDBtoY(0);
                weqRenderPanel(); weqSyncToHost();
                if (typeof markStateDirty === 'function') markStateDirty();
            }
        },
        {
            label: 'Reset Q to 0.707', action: function () {
                _weqPushUndo();
                wrongEqPoints[hit].q = 0.707;
                weqRenderPanel(); weqSyncToHost();
                if (typeof markStateDirty === 'function') markStateDirty();
            }
        },
        {
            label: 'Duplicate Point', action: function () {
                _weqPushUndo();
                var src = wrongEqPoints[hit];
                var dupFreq = Math.min(WEQ_MAX_FREQ, weqXToFreq(src.x) * 1.1);
                var dup = { uid: _weqAllocUid(), x: weqFreqToX(dupFreq), y: src.y, pluginIds: [], preEq: true, seg: null, solo: false, mute: false, q: src.q || 0.707, type: src.type || 'Bell', drift: src.drift || 0 };
                wrongEqPoints.push(dup);
                if (weqAnimRafId) { weqAnimBaseY.push(dup.y); weqAnimBaseX.push(dup.x); }
                weqSelectedPt = wrongEqPoints.length - 1;
                weqRenderPanel(); weqSyncToHost();
                if (typeof markStateDirty === 'function') markStateDirty();
            }
        },
        { sep: true }
    ];

    items.push({ label: 'Filter Type:', disabled: true });
    typeItems.forEach(function (ti) { items.push(ti); });

    items.push({ sep: true });
    items.push({
        label: pt.solo ? '✦ Unsolo' : '✦ Solo', action: function () {
            var was = wrongEqPoints[hit].solo;
            for (var si = 0; si < wrongEqPoints.length; si++) wrongEqPoints[si].solo = false;
            wrongEqPoints[hit].solo = !was;
            weqRenderPanel(); weqSyncToHost();
            if (typeof markStateDirty === 'function') markStateDirty();
        }
    });
    items.push({
        label: pt.mute ? '🔊 Unmute' : '🔇 Mute', action: function () {
            wrongEqPoints[hit].mute = !wrongEqPoints[hit].mute;
            weqRenderPanel(); weqSyncToHost();
            if (typeof markStateDirty === 'function') markStateDirty();
        }
    });
    items.push({ sep: true });
    items.push({ label: 'Assign Plugins...', action: function () { weqShowPluginAssign(hit, e); } });
    items.push({ sep: true });
    items.push({
        label: '⌫ Delete Point', action: function () {
            _weqPushUndo();
            wrongEqPoints.splice(hit, 1);
            weqSegSel.clear();
            if (weqAnimRafId && weqAnimBaseY.length > hit) { weqAnimBaseY.splice(hit, 1); weqAnimBaseX.splice(hit, 1); }
            weqSelectedPt = -1;
            weqFocusBand = -1;
            weqRenderPanel(); weqSyncToHost();
            if (typeof markStateDirty === 'function') markStateDirty();
        }
    });

    return items;
}
// ── Setup canvas & band row right-click context menus ──
function weqSetupContextMenu(wrap) {
    // Helper functions from canvas setup
    var cvs = wrap.querySelector('canvas');
    function pos(e) {
        var r = cvs.getBoundingClientRect();
        return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
    }
    function findNearest(p, maxDist) {
        var best = -1, bestD = Infinity;
        for (var i = 0; i < wrongEqPoints.length; i++) {
            var px = wrongEqPoints[i].x, py = wrongEqPoints[i].y;
            var r = cvs.getBoundingClientRect();
            var dx = (p.x - px) * r.width, dy = (p.y - py) * r.height;
            var d = Math.sqrt(dx * dx + dy * dy);
            if (d < bestD) { bestD = d; best = i; }
        }
        return bestD <= maxDist ? best : -1;
    }
    function snapFreq(x) {
        return Math.max(0.001, Math.min(0.999, x));
    }

    // Canvas right-click
    wrap.oncontextmenu = function (e) {
        e.preventDefault();
        var p = pos(e);
        var hit = findNearest(p, 14);

        if (hit < 0) {
            // Empty space menu
            var freqHere = weqXToFreq(p.x);
            var dbHere = weqYToDB(p.y);
            var emptyItems = [
                { label: weqFmtFreq(freqHere) + 'Hz  ' + weqFmtDB(dbHere) + 'dB', disabled: true },
                { sep: true },
                {
                    label: '+ Add Point Here', action: function () {
                        var newPt = { uid: _weqAllocUid(), x: snapFreq(p.x), y: p.y, pluginIds: [], preEq: true, seg: null, solo: false, mute: false, q: 0.707, type: 'Bell', drift: 0 };
                        wrongEqPoints.push(newPt);
                        if (weqAnimRafId) { weqAnimBaseY.push(p.y); weqAnimBaseX.push(newPt.x); }
                        weqSelectedPt = wrongEqPoints.length - 1;
                        weqRenderPanel(); weqSyncToHost();
                        if (typeof markStateDirty === 'function') markStateDirty();
                    }
                },
                {
                    label: '+ Add at 0 dB', action: function () {
                        var newPt = { uid: _weqAllocUid(), x: snapFreq(p.x), y: weqDBtoY(0), pluginIds: [], preEq: true, seg: null, solo: false, mute: false, q: 0.707, type: 'Bell', drift: 0 };
                        wrongEqPoints.push(newPt);
                        if (weqAnimRafId) { weqAnimBaseY.push(newPt.y); weqAnimBaseX.push(newPt.x); }
                        weqSelectedPt = wrongEqPoints.length - 1;
                        weqRenderPanel(); weqSyncToHost();
                        if (typeof markStateDirty === 'function') markStateDirty();
                    }
                }
            ];
            _weqShowCtxMenu(emptyItems, e);
            return;
        }

        // Point context menu
        _weqShowCtxMenu(_weqBuildPointMenu(hit, e), e);
    };

    // Band card right-click
    document.querySelectorAll('.weq-band-card').forEach(function (row) {
        row.oncontextmenu = function (e) {
            e.preventDefault();
            e.stopPropagation();
            var idx = parseInt(row.dataset.bandidx);
            if (idx >= 0 && idx < wrongEqPoints.length) {
                _weqShowCtxMenu(_weqBuildPointMenu(idx, e), e);
            }
        };
    });
}

// ── Plugin assignment toggle menu (multi-plugin per band) ──
function weqShowPluginAssign(ptIdx, evt) {
    var pt = wrongEqPoints[ptIdx];
    if (!pt) return;
    if (!pt.pluginIds) pt.pluginIds = [];

    var old = document.querySelector('.weq-ctx');
    if (old) old.remove();

    var menu = document.createElement('div');
    menu.className = 'ctx weq-ctx';
    menu.style.cssText = 'display:block;position:fixed;left:' + evt.clientX + 'px;top:' + evt.clientY + 'px;z-index:9999;min-width:180px';

    // Title
    var title = document.createElement('div');
    title.className = 'ctx-i disabled';
    title.textContent = 'Plugins for Band ' + (ptIdx + 1);
    menu.appendChild(title);

    var sep = document.createElement('div');
    sep.className = 'ctx-sep';
    menu.appendChild(sep);

    if (typeof pluginBlocks === 'undefined' || pluginBlocks.length === 0) {
        var none = document.createElement('div');
        none.className = 'ctx-i disabled';
        none.textContent = 'No plugins loaded';
        menu.appendChild(none);
    } else {
        // One row per plugin — toggle on/off
        for (var pi = 0; pi < pluginBlocks.length; pi++) {
            if (pluginBlocks[pi].isVirtual) continue; // skip WrongEQ virtual block
            (function (pb) {
                var isOn = pt.pluginIds.indexOf(pb.id) >= 0;
                var chainPos = isOn ? (pt.pluginIds.indexOf(pb.id) + 1) : 0;
                var el = document.createElement('div');
                el.className = 'ctx-i' + (isOn ? ' on' : '');
                el.textContent = (isOn ? '✓ [' + chainPos + '] ' : '○ ') + pb.name;
                el.style.cursor = 'pointer';
                el.onclick = function (ev) {
                    ev.stopPropagation();
                    var idx = pt.pluginIds.indexOf(pb.id);
                    _weqEnsureUid(pt); // ensure stable uid exists
                    var bandBusId = pt.uid; // Stable UID — survives point reordering
                    if (idx >= 0) {
                        pt.pluginIds.splice(idx, 1); // remove from band
                        pb.busId = 0; // unassign
                        // Tell C++ this plugin is no longer on any bus
                        if (window.__JUCE__ && window.__JUCE__.backend) {
                            var busFn = window.__juceGetNativeFunction('setPluginBus');
                            busFn(pb.hostId !== undefined ? pb.hostId : pb.id, 0);
                        }
                    } else {
                        // Remove from any other band first
                        for (var oi = 0; oi < wrongEqPoints.length; oi++) {
                            if (!wrongEqPoints[oi].pluginIds) continue;
                            var oidx = wrongEqPoints[oi].pluginIds.indexOf(pb.id);
                            if (oidx >= 0) wrongEqPoints[oi].pluginIds.splice(oidx, 1);
                        }
                        pt.pluginIds.push(pb.id); // add to this band's chain
                        pb.busId = bandBusId;
                        // Tell C++ to route this plugin to this band's bus
                        if (window.__JUCE__ && window.__JUCE__.backend) {
                            var busFn = window.__juceGetNativeFunction('setPluginBus');
                            busFn(pb.hostId !== undefined ? pb.hostId : pb.id, bandBusId);
                        }
                    }
                    // Re-render the menu in place
                    menu.remove();
                    weqShowPluginAssign(ptIdx, evt);
                    weqDrawCanvas();
                    weqSyncToHost();
                    if (typeof renderAllPlugins === 'function') renderAllPlugins();
                    if (typeof markStateDirty === 'function') markStateDirty();
                };
                menu.appendChild(el);
            })(pluginBlocks[pi]);
        }
    }

    // Clear all
    if (pt.pluginIds.length > 0) {
        var sep2 = document.createElement('div');
        sep2.className = 'ctx-sep';
        menu.appendChild(sep2);
        var clearEl = document.createElement('div');
        clearEl.className = 'ctx-i';
        clearEl.textContent = '✕ Clear All';
        clearEl.onclick = function () {
            // Unassign all plugins from this band in C++
            var oldIds = pt.pluginIds.slice();
            pt.pluginIds = [];
            if (window.__JUCE__ && window.__JUCE__.backend) {
                var busFn = window.__juceGetNativeFunction('setPluginBus');
                oldIds.forEach(function (pid) {
                    // Find the plugin block and update its busId
                    for (var pi = 0; pi < pluginBlocks.length; pi++) {
                        if (pluginBlocks[pi].id === pid) {
                            pluginBlocks[pi].busId = 0;
                            busFn(pluginBlocks[pi].hostId !== undefined ? pluginBlocks[pi].hostId : pid, 0);
                            break;
                        }
                    }
                });
            }
            menu.remove();
            weqRenderPanel(); weqSyncToHost();
            if (typeof renderAllPlugins === 'function') renderAllPlugins();
            if (typeof markStateDirty === 'function') markStateDirty();
        };
        menu.appendChild(clearEl);
    }

    // Close
    var sep3 = document.createElement('div');
    sep3.className = 'ctx-sep';
    menu.appendChild(sep3);
    var closeEl = document.createElement('div');
    closeEl.className = 'ctx-i';
    closeEl.textContent = 'Done';
    closeEl.onclick = function () {
        menu.remove();
        weqRenderPanel();
    };
    menu.appendChild(closeEl);

    document.body.appendChild(menu);

    // Clamp to viewport
    var rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) menu.style.left = (window.innerWidth - rect.width - 4) + 'px';
    if (rect.bottom > window.innerHeight) menu.style.top = (window.innerHeight - rect.height - 4) + 'px';

    function onEsc(ke) { if (ke.key === 'Escape') { menu.remove(); weqRenderPanel(); document.removeEventListener('keydown', onEsc); } }
    document.addEventListener('keydown', onEsc);
}

// ── Per-segment settings popup ──
function weqShowSegSettings(ptIdx, evt) {
    var pt = wrongEqPoints[ptIdx];
    if (!pt) return;
    if (!pt.seg) pt.seg = {};
    var seg = pt.seg;

    var existing = document.querySelector('.weq-seg-popup');
    if (existing) existing.remove();

    var popup = document.createElement('div');
    popup.className = 'weq-seg-popup visible';
    popup.style.left = evt.clientX + 'px';
    popup.style.top = evt.clientY + 'px';
    popup.style.position = 'fixed';

    var freq = weqXToFreq(pt.x);
    var h = '<div class="weq-seg-popup-title">Segment from P' + (ptIdx + 1) + ' (' + weqFmtFreq(freq) + 'Hz)</div>';


    // Warp
    h += '<div class="weq-seg-row"><span class="weq-seg-label">Warp</span><span class="weq-seg-val" data-segk="warp">' + (seg.warp != null ? seg.warp : 'G') + '</span></div>';
    // Steps
    h += '<div class="weq-seg-row"><span class="weq-seg-label">Steps</span><span class="weq-seg-val" data-segk="steps">' + (seg.steps != null ? seg.steps : 'G') + '</span></div>';
    // Per-segment curve effects
    h += '<div class="weq-seg-row" style="margin-top:4px"><span class="weq-seg-label">Effects</span></div>';
    h += '<div style="display:flex;gap:3px;flex-wrap:wrap;margin:2px 0">';
    h += '<button class="weq-ft-btn" data-segfx="mirror" title="Mirror gain across 0dB">↕ Mirror</button>';
    h += '<button class="weq-ft-btn" data-segfx="invert" title="Invert gain (positive↔negative)">⊖ Invert</button>';
    h += '<button class="weq-ft-btn" data-segfx="smooth" title="Smooth — halve gain toward 0dB">∿ Smooth</button>';
    h += '<button class="weq-ft-btn" data-segfx="random" title="Randomize gain within ±12dB">⚄ Random</button>';
    h += '<button class="weq-ft-btn" data-segfx="zero" title="Reset gain to 0dB">0dB</button>';
    h += '</div>';
    // Reset
    h += '<div style="margin-top:6px"><button class="weq-ft-btn" id="weqSegReset" style="width:100%">Reset to Global</button></div>';

    popup.innerHTML = h;
    document.body.appendChild(popup);


    // Drag knobs
    popup.querySelectorAll('[data-segk]').forEach(function (knob) {
        var key = knob.dataset.segk;
        knob.onmousedown = function (me) {
            me.preventDefault();
            var startY = me.clientY;
            var startVal = seg[key] != null ? seg[key] : (key === 'warp' ? weqGlobalWarp : weqGlobalSteps);
            function onMove(ev) {
                var dy = startY - ev.clientY;
                if (key === 'warp') {
                    seg.warp = Math.max(-100, Math.min(100, startVal + dy));
                    knob.textContent = seg.warp;
                } else if (key === 'steps') {
                    seg.steps = Math.max(0, Math.min(32, Math.round(startVal + dy / 5)));
                    knob.textContent = seg.steps || 'Off';
                }
                weqDrawCanvas();
            }
            function onUp2() {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp2);
                weqSyncToHost();
            }
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp2);
        };
    });

    // Per-segment effects — apply to BOTH endpoints of the segment
    // (current point = start, next sorted point = end)
    popup.querySelectorAll('[data-segfx]').forEach(function (btn) {
        btn.onclick = function (fxe) {
            fxe.stopPropagation();
            var fx = btn.dataset.segfx;

            // Find the next point after this one in sorted order
            var sortedPts = wrongEqPoints.slice().sort(function (a, b) { return a.x - b.x; });
            var sortedIdx = sortedPts.indexOf(pt);
            var endPt = (sortedIdx >= 0 && sortedIdx < sortedPts.length - 1) ? sortedPts[sortedIdx + 1] : null;

            // Apply effect to start point
            var curDB = weqYToDB(pt.y);
            if (fx === 'mirror') {
                pt.y = weqDBtoY(-curDB);
                if (endPt) endPt.y = weqDBtoY(-weqYToDB(endPt.y));
            } else if (fx === 'invert') {
                pt.y = weqDBtoY(-curDB);
                if (endPt) endPt.y = weqDBtoY(-weqYToDB(endPt.y));
            } else if (fx === 'smooth') {
                pt.y = weqDBtoY(curDB * 0.5);
                if (endPt) endPt.y = weqDBtoY(weqYToDB(endPt.y) * 0.5);
            } else if (fx === 'random') {
                pt.y = weqDBtoY((Math.random() - 0.5) * 24);
                if (endPt) endPt.y = weqDBtoY((Math.random() - 0.5) * 24);
            } else if (fx === 'zero') {
                pt.y = weqDBtoY(0);
                if (endPt) endPt.y = weqDBtoY(0);
            }
            weqRenderPanel(); // full re-render so band rows update
            weqSyncToHost();
            if (typeof markStateDirty === 'function') markStateDirty();
            // Close the popup after applying
            popup.remove();
            document.removeEventListener('mousedown', dismiss);
        };
    });

    // Reset
    var resetBtn = popup.querySelector('#weqSegReset');
    if (resetBtn) resetBtn.onclick = function () {
        pt.seg = null;
        popup.remove();
        weqDrawCanvas();
        weqSyncToHost();
    };

    // Dismiss
    function dismiss(de) {
        if (!popup.contains(de.target)) {
            popup.remove();
            document.removeEventListener('mousedown', dismiss);
        }
    }
    setTimeout(function () { document.addEventListener('mousedown', dismiss); }, 10);
}

// ── Shapes menu ──
var WEQ_SHAPES = [
    { name: 'Flat', pts: function () { return []; } },
    {
        name: 'Tilt +', pts: function () {
            return [
                { x: weqFreqToX(80), db: -4, type: 'LShf', q: 0.707 },
                { x: weqFreqToX(8000), db: 4, type: 'HShf', q: 0.707 }
            ];
        }
    },
    {
        name: 'Tilt −', pts: function () {
            return [
                { x: weqFreqToX(80), db: 4, type: 'LShf', q: 0.707 },
                { x: weqFreqToX(8000), db: -4, type: 'HShf', q: 0.707 }
            ];
        }
    },
    {
        name: 'Smile', pts: function () {
            return [
                { x: weqFreqToX(60), db: 5, type: 'LShf', q: 0.707 },
                { x: weqFreqToX(400), db: -3, type: 'Bell', q: 0.8 },
                { x: weqFreqToX(2500), db: -3, type: 'Bell', q: 0.8 },
                { x: weqFreqToX(10000), db: 5, type: 'HShf', q: 0.707 }
            ];
        }
    },
    {
        name: 'Scoop', pts: function () {
            return [
                { x: weqFreqToX(60), db: -2, type: 'LShf', q: 0.707 },
                { x: weqFreqToX(400), db: 4, type: 'Bell', q: 1.0 },
                { x: weqFreqToX(2500), db: 4, type: 'Bell', q: 1.0 },
                { x: weqFreqToX(10000), db: -2, type: 'HShf', q: 0.707 }
            ];
        }
    },
    {
        name: 'Presence', pts: function () {
            return [
                { x: weqFreqToX(2500), db: 5, type: 'Bell', q: 1.5 },
                { x: weqFreqToX(5000), db: 3, type: 'Bell', q: 1.0 }
            ];
        }
    },
    {
        name: 'Air', pts: function () {
            return [
                { x: weqFreqToX(10000), db: 6, type: 'HShf', q: 0.707 }
            ];
        }
    },
    {
        name: 'Low Cut', pts: function () {
            return [
                { x: weqFreqToX(80), db: 0, type: 'HP', q: 0.707 }
            ];
        }
    },
    {
        name: 'High Cut', pts: function () {
            return [
                { x: weqFreqToX(12000), db: 0, type: 'LP', q: 0.707 }
            ];
        }
    },
    {
        name: 'Telephone', pts: function () {
            return [
                { x: weqFreqToX(300), db: 0, type: 'HP', q: 1.0 },
                { x: weqFreqToX(1000), db: 3, type: 'Bell', q: 0.5 },
                { x: weqFreqToX(3500), db: 0, type: 'LP', q: 1.0 }
            ];
        }
    },
    {
        name: 'Sub Boost', pts: function () {
            return [
                { x: weqFreqToX(50), db: 6, type: 'LShf', q: 0.707 },
                { x: weqFreqToX(120), db: 3, type: 'Bell', q: 1.5 }
            ];
        }
    },
    {
        name: 'De-Mud', pts: function () {
            return [
                { x: weqFreqToX(250), db: -4, type: 'Bell', q: 0.8 },
                { x: weqFreqToX(500), db: -3, type: 'Bell', q: 1.0 }
            ];
        }
    },
    {
        name: 'Vocal', pts: function () {
            return [
                { x: weqFreqToX(100), db: 0, type: 'HP', q: 0.707 },
                { x: weqFreqToX(250), db: -2, type: 'Bell', q: 1.0 },
                { x: weqFreqToX(3000), db: 4, type: 'Bell', q: 1.2 },
                { x: weqFreqToX(12000), db: 3, type: 'HShf', q: 0.707 }
            ];
        }
    }
];

function weqShowShapesMenu(anchor) {
    var menu = document.createElement('div');
    menu.className = 'ctx';
    var rect = anchor.getBoundingClientRect();
    menu.style.cssText = 'display:block;position:fixed;left:' + rect.left + 'px;top:' + (rect.bottom + 2) + 'px;z-index:999';

    WEQ_SHAPES.forEach(function (shape) {
        var el = document.createElement('div');
        el.className = 'ctx-i';
        el.textContent = shape.name;
        el.onclick = function () {
            menu.remove();
            _weqPushUndo();
            var raw = shape.pts();
            wrongEqPoints = raw.map(function (p) {
                var pType = p.type || 'Bell';
                var pQ = p.q != null ? p.q : 0.707;
                // LP/HP sit at 0dB — ignore db from shape
                var pY = (pType === 'LP' || pType === 'HP') ? weqDBtoY(0) : weqDBtoY(p.db);
                return {
                    uid: _weqAllocUid(), x: p.x, y: pY,
                    pluginIds: [], preEq: true, seg: null,
                    solo: false, mute: false,
                    q: pQ, type: pType, drift: 0
                };
            });
            weqAnimBaseY = wrongEqPoints.map(function (p) { return p.y; });
            weqAnimBaseX = wrongEqPoints.map(function (p) { return p.x; });
            weqSelectedPt = -1;
            weqFocusBand = -1;
            weqRenderPanel();
            weqSyncToHost();
            if (typeof markStateDirty === 'function') markStateDirty();
        };
        menu.appendChild(el);
    });

    document.body.appendChild(menu);
    function dismiss(de) { if (!menu.contains(de.target)) { menu.remove(); document.removeEventListener('click', dismiss); } }
    setTimeout(function () { document.addEventListener('click', dismiss); }, 10);
}

// ── Randomize ──
function weqRandomize() {
    var n = 4 + Math.floor(Math.random() * 5); // 4-8 points
    wrongEqPoints = [];
    for (var i = 0; i < n; i++) {
        wrongEqPoints.push({
            uid: _weqAllocUid(),
            x: 0.05 + (i / (n - 1)) * 0.9,
            y: weqDBtoY((Math.random() - 0.5) * 24),
            pluginIds: [], preEq: true,
            seg: null,
            solo: false,
            mute: false,
            q: 0.707,
            type: 'Bell',
            drift: 0
        });
    }
    weqAnimBaseY = wrongEqPoints.map(function (p) { return p.y; });
    weqAnimBaseX = wrongEqPoints.map(function (p) { return p.x; });
    weqSelectedPt = -1;
    weqRenderPanel();
    weqSyncToHost();
    if (typeof markStateDirty === 'function') markStateDirty();
}

// ── Sync EQ curve to C++ (send evaluated bin gains) ──
var _weqSyncPending = false;
var _weqSyncTimer = null;
var _weqSyncMinInterval = 0; // no throttle — every event syncs immediately for zero-stepping

function weqSyncToHost() {
    if (!window.__JUCE__ || !window.__JUCE__.backend) return;
    // No throttle — sync immediately on every call for zero-stepping EQ
    _weqDoSync();
}

function _weqDoSync() {
    try {
        var setEqFn = window.__juceGetNativeFunction('setEqCurve');
        if (!setEqFn) return;

        var data = {
            globalBypass: weqGlobalBypass,
            preEq: weqPreEq,
            points: wrongEqPoints.map(function (p, i) {
                _weqEnsureUid(p);
                return {
                    freqHz: weqXToFreq(p.x),
                    gainDB: weqYToDB(p.y),
                    busId: p.uid,
                    pluginIds: p.pluginIds || [],
                    solo: p.solo || false,
                    mute: p.mute || false,
                    q: p.q != null ? p.q : 0.707,
                    type: p.type || 'Bell',
                    drift: p.drift || 0,
                    preEq: p.preEq !== false,
                    stereoMode: p.stereoMode || 0,
                    slope: p.slope || 1,
                    seg: p.seg || null
                };
            }),
            globalDepth: weqGlobalDepth,
            globalWarp: weqGlobalWarp,
            globalSteps: weqGlobalSteps,
            globalTilt: weqGlobalTilt,
            unassignedMode: weqUnassignedMode,
            animSpeed: weqAnimSpeed,
            animDepth: weqAnimDepth,
            animShape: weqAnimShape,
            drift: weqDrift,
            driftRange: weqDriftRange,
            driftScale: weqDriftScale,
            driftContinuous: weqDriftContinuous,
            driftMode: weqDriftMode,
            driftTexture: weqDriftTexture,
            gainLoCut: weqGainLoCut,
            gainHiCut: weqGainHiCut,
            driftLoCut: weqDriftLoCut,
            driftHiCut: weqDriftHiCut,
            qModSpeed: weqQModSpeed,
            qModDepth: weqQModDepth,
            qModShape: weqQModShape,
            qLoCut: weqQLoCut,
            qHiCut: weqQHiCut,
            dbRange: weqDBRangeMax,
            splitMode: weqSplitMode,
            oversample: weqOversample
        };
        setEqFn(JSON.stringify(data));
        weqSyncVirtualParams();
    } catch (e) { /* native not ready */ }
}

// ── Visibility toggle (called when routing mode changes) ──
function weqSetVisible(visible) {
    var overlay = document.getElementById('weqOverlay');
    var openBtn = document.getElementById('weqOpenBtn');
    // Show/hide the open button based on routing mode
    if (openBtn) openBtn.style.display = visible ? '' : 'none';
    // Close popup if switching away from WrongEQ mode
    if (!visible && overlay) overlay.classList.remove('visible');

    // Virtual plugin block: create when entering WrongEQ mode, destroy when leaving
    if (visible) {
        weqCreateVirtualBlock();
    } else {
        weqDestroyVirtualBlock();
    }
}

// ════════════════════════════════════════════════════════════
// SEGMENT EFFECTS — operations on selected band groups
// ════════════════════════════════════════════════════════════

// Get sorted selected indices (by frequency, low to high)
function _weqSortedSel() {
    var arr = Array.from(weqSegSel).filter(function (idx) {
        return idx >= 0 && idx < wrongEqPoints.length;
    });
    arr.sort(function (a, b) { return wrongEqPoints[a].x - wrongEqPoints[b].x; });
    return arr;
}

// ── Apply a segment operation ──
function _weqSegApply(op) {
    if (weqSegSel.size < 2) return;
    var sorted = _weqSortedSel();
    _weqPushUndo();
    switch (op) {
        case 'fill': _weqSegFill(sorted); break;
        case 'mirror': _weqSegMirror(sorted); break;
        case 'randomize': _weqSegRand(sorted); break;
        case 'fade': _weqSegFade(sorted); break;
        case 'normalize': _weqSegNormalize(sorted); break;
        case 'flatten': _weqSegFlatten(sorted); break;
        default: break;
    }

    weqRenderPanel();
    weqSyncToHost();
    weqSyncVirtualParams();
    if (typeof markStateDirty === 'function') markStateDirty();
}

// FILL: Generate evenly-spaced points between the two outermost selected bands
function _weqSegFill(sorted) {
    var first = wrongEqPoints[sorted[0]];
    var last = wrongEqPoints[sorted[sorted.length - 1]];
    var xMin = first.x, xMax = last.x;
    var yMin = first.y, yMax = last.y;
    var qFirst = first.q || 0.707, qLast = last.q || 0.707;

    // How many to add? prompt or use count. Use count = max(2, selected-2) to fill gaps
    var count = Math.max(2, sorted.length);
    for (var i = 1; i < count; i++) {
        var t = i / count;
        var newX = xMin + (xMax - xMin) * t;
        var newY = yMin + (yMax - yMin) * t;
        var newQ = qFirst + (qLast - qFirst) * t;
        // Check if a point already exists near this frequency
        var fNew = weqXToFreq(newX);
        var exists = false;
        for (var j = 0; j < wrongEqPoints.length; j++) {
            var fExist = weqXToFreq(wrongEqPoints[j].x);
            if (Math.abs(fExist - fNew) / fNew < 0.03) { exists = true; break; } // within 3%
        }
        if (!exists && wrongEqPoints.length < 32) {
            var pt = { uid: _weqAllocUid(), x: newX, y: newY, pluginIds: [], preEq: true, seg: null, solo: false, mute: false, q: Math.round(newQ * 100) / 100, type: 'Bell', drift: 0 };
            wrongEqPoints.push(pt);
            if (weqAnimRafId) { weqAnimBaseY.push(pt.y); weqAnimBaseX.push(pt.x); }
        }
    }
}

// MIRROR: Flip gains across 0 dB
function _weqSegMirror(sorted) {
    for (var i = 0; i < sorted.length; i++) {
        var pt = wrongEqPoints[sorted[i]];
        var db = weqYToDB(pt.y);
        pt.y = weqDBtoY(-db);
        if (weqAnimRafId && weqAnimBaseY[sorted[i]] != null) {
            weqAnimBaseY[sorted[i]] = pt.y;
        }
    }
}

// RANDOMIZE: Scatter gains randomly within ±range
function _weqSegRand(sorted) {
    for (var i = 0; i < sorted.length; i++) {
        var pt = wrongEqPoints[sorted[i]];
        // Random gain within ±maxDB range
        var db = (Math.random() * 2 - 1) * weqDBRangeMax * 0.75;
        pt.y = weqDBtoY(db);
        // Random Q between 0.3 and 8
        pt.q = Math.round((0.3 + Math.random() * 7.7) * 100) / 100;
        if (weqAnimRafId && weqAnimBaseY[sorted[i]] != null) {
            weqAnimBaseY[sorted[i]] = pt.y;
        }
    }
}

// FADE: Linear interpolation of gain between first and last selected band
function _weqSegFade(sorted) {
    if (sorted.length < 2) return;
    var first = wrongEqPoints[sorted[0]];
    var last = wrongEqPoints[sorted[sorted.length - 1]];
    var dbStart = weqYToDB(first.y);
    var dbEnd = weqYToDB(last.y);

    for (var i = 0; i < sorted.length; i++) {
        var t = i / (sorted.length - 1);
        var db = dbStart + (dbEnd - dbStart) * t;
        wrongEqPoints[sorted[i]].y = weqDBtoY(db);
        if (weqAnimRafId && weqAnimBaseY[sorted[i]] != null) {
            weqAnimBaseY[sorted[i]] = weqDBtoY(db);
        }
    }
}

// NORMALIZE: Scale all selected gains so the peak reaches ±maxDB * 0.8
function _weqSegNormalize(sorted) {
    var maxAbs = 0;
    for (var i = 0; i < sorted.length; i++) {
        var db = Math.abs(weqYToDB(wrongEqPoints[sorted[i]].y));
        if (db > maxAbs) maxAbs = db;
    }
    if (maxAbs < 0.1) return; // all flat, nothing to normalize
    var target = weqDBRangeMax * 0.8;
    var scale = target / maxAbs;
    for (var i = 0; i < sorted.length; i++) {
        var db = weqYToDB(wrongEqPoints[sorted[i]].y);
        wrongEqPoints[sorted[i]].y = weqDBtoY(db * scale);
        if (weqAnimRafId && weqAnimBaseY[sorted[i]] != null) {
            weqAnimBaseY[sorted[i]] = weqDBtoY(db * scale);
        }
    }
}

// FLATTEN: Set all selected bands to 0 dB
function _weqSegFlatten(sorted) {
    for (var i = 0; i < sorted.length; i++) {
        wrongEqPoints[sorted[i]].y = weqDBtoY(0);
        if (weqAnimRafId && weqAnimBaseY[sorted[i]] != null) {
            weqAnimBaseY[sorted[i]] = weqDBtoY(0);
        }
    }
}

// SHAPE APPLY: Apply a waveform shape across the spectral range of selection
function _weqSegShapeApply(sorted, shapeFn) {
    if (sorted.length < 2) return;
    for (var i = 0; i < sorted.length; i++) {
        var t = i / (sorted.length - 1); // 0 to 1 across selection
        var shapeVal = shapeFn(t); // -1 to 1
        var db = shapeVal * weqDBRangeMax * 0.7; // scale to 70% of range
        wrongEqPoints[sorted[i]].y = weqDBtoY(db);
        if (weqAnimRafId && weqAnimBaseY[sorted[i]] != null) {
            weqAnimBaseY[sorted[i]] = weqDBtoY(db);
        }
    }
    weqRenderPanel();
    weqSyncToHost();
    weqSyncVirtualParams();
    if (typeof markStateDirty === 'function') markStateDirty();
}

// Shape selection popup menu
function _weqSegShapeMenu(e) {
    var sorted = _weqSortedSel();
    if (sorted.length < 2) return;

    var shapes = [
        { label: '∿ Sine', fn: function (t) { return Math.sin(t * Math.PI * 2); } },
        { label: '∿ Sine ×2', fn: function (t) { return Math.sin(t * Math.PI * 4); } },
        { label: '∿ Sine ×4', fn: function (t) { return Math.sin(t * Math.PI * 8); } },
        { sep: true },
        { label: '⟋ Saw Up', fn: function (t) { return t * 2 - 1; } },
        { label: '⟍ Saw Down', fn: function (t) { return 1 - t * 2; } },
        { label: '△ Triangle', fn: function (t) { return t < 0.5 ? t * 4 - 1 : 3 - t * 4; } },
        { label: '⊓ Square', fn: function (t) { return t < 0.5 ? 1 : -1; } },
        { sep: true },
        { label: '⤴ Rise', fn: function (t) { return Math.pow(t, 1.5) * 2 - 1; } },
        { label: '⤵ Fall', fn: function (t) { return (1 - Math.pow(t, 1.5)) * 2 - 1; } },
        { label: '∩ Bump', fn: function (t) { return Math.sin(t * Math.PI); } },
        { label: '∪ Dip', fn: function (t) { return -Math.sin(t * Math.PI); } },
        { sep: true },
        { label: '⚡ Noise', fn: function () { return Math.random() * 2 - 1; } },
        { label: '↝ Smooth Noise', fn: function (t) { return Math.sin(t * 7.3 + 1.2) * 0.6 + Math.sin(t * 13.1 + 0.7) * 0.4; } }
    ];

    var items = shapes.map(function (s) {
        if (s.sep) return { sep: true };
        return { label: s.label, action: function () { _weqSegShapeApply(sorted, s.fn); } };
    });

    _weqShowCtxMenu(items, e);
}

// ── Open/close helpers ──
function weqOpen() {
    var overlay = document.getElementById('weqOverlay');
    if (overlay) {
        overlay.classList.add('visible');
        var popup = document.getElementById('weqPanel');
        if (popup && !popup.classList.contains('weq-dragged')) {
            // First open: center it
            popup.style.left = '50%';
            popup.style.top = '50%';
            popup.style.transform = 'translate(-50%, -50%)';
        }
        weqInvalidateStyleCache();
        weqRenderPanel();
    }
}
function weqClose() {
    var overlay = document.getElementById('weqOverlay');
    if (overlay) overlay.classList.remove('visible');
}

// ── Drag-to-move via header bar ──
var _weqDragState = null;
function _weqInitDrag() {
    document.addEventListener('mousedown', function (e) {
        // Only drag from the header bar (not buttons inside it)
        var hdr = e.target.closest('.weq-header');
        if (!hdr) return;
        if (e.target.tagName === 'BUTTON' || e.target.tagName === 'SELECT') return;
        var popup = document.getElementById('weqPanel');
        if (!popup) return;

        e.preventDefault();

        // If this is the first drag, switch from centered to absolute positioning
        if (!popup.classList.contains('weq-dragged')) {
            var rect = popup.getBoundingClientRect();
            popup.style.left = rect.left + 'px';
            popup.style.top = rect.top + 'px';
            popup.classList.add('weq-dragged');
        }

        var startX = e.clientX;
        var startY = e.clientY;
        var startLeft = parseInt(popup.style.left) || 0;
        var startTop = parseInt(popup.style.top) || 0;

        function onMove(ev) {
            var dx = ev.clientX - startX;
            var dy = ev.clientY - startY;
            var newLeft = startLeft + dx;
            var newTop = startTop + dy;
            // Clamp so at least 80px of header stays visible horizontally,
            // and 30px vertically — prevents losing the popup off-screen
            var pw = popup.offsetWidth;
            var ph = popup.offsetHeight;
            var vw = window.innerWidth;
            var vh = window.innerHeight;
            var minVisible = 80;
            newLeft = Math.max(-pw + minVisible, Math.min(vw - minVisible, newLeft));
            newTop = Math.max(-30, Math.min(vh - 30, newTop));
            popup.style.left = newLeft + 'px';
            popup.style.top = newTop + 'px';
        }
        function onUp() {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        }
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });
}
_weqInitDrag();

// Wire up the open button + Escape key
(function () {
    document.addEventListener('click', function (e) {
        if (e.target && e.target.id === 'weqOpenBtn') weqOpen();
    });
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
            var overlay = document.getElementById('weqOverlay');
            if (overlay && overlay.classList.contains('visible')) {
                weqClose();
                e.preventDefault();
                e.stopPropagation();
            }
        }
    });
})();

// ════════════════════════════════════════════════════════════
// WrongEQ VIRTUAL PLUGIN BLOCK
// Exposes EQ parameters in the plugin rack for modulation
// ════════════════════════════════════════════════════════════

var WEQ_VIRTUAL_ID = -100; // negative to avoid collision with real hosted plugin IDs
var _weqVirtualBlock = null; // reference to the virtual plugin block in pluginBlocks[]

// ── Parameter definitions ──
// Each param: { key, name, toNorm(val), fromNorm(v), display(val), get(), set(val) }
function _weqParamDefs() {
    var defs = [];

    // Global params — cppIndex starts at 100 to avoid collision with per-band (band*4+field)
    // Must match C++ kWeqGlobalBase = 100
    defs.push({
        key: 'depth', name: 'Depth', min: 0, max: 200,
        cppIndex: 100,
        get: function () { return weqGlobalDepth; },
        set: function (v) { weqGlobalDepth = v; },
        toNorm: function (v) { return v / 200; },
        fromNorm: function (n) { return Math.round(n * 200); },
        display: function (v) { return v + '%'; }
    });
    defs.push({
        key: 'warp', name: 'Warp', min: -100, max: 100,
        cppIndex: 101,
        get: function () { return weqGlobalWarp; },
        set: function (v) { weqGlobalWarp = v; },
        toNorm: function (v) { return (v + 100) / 200; },
        fromNorm: function (n) { return Math.round(n * 200 - 100); },
        display: function (v) { return (v >= 0 ? '+' : '') + v; }
    });
    defs.push({
        key: 'steps', name: 'Steps', min: 0, max: 32,
        cppIndex: 102,
        get: function () { return weqGlobalSteps; },
        set: function (v) { weqGlobalSteps = v; },
        toNorm: function (v) { return v / 32; },
        fromNorm: function (n) { return Math.round(n * 32); },
        display: function (v) { return v === 0 ? 'Off' : '' + v; }
    });
    defs.push({
        key: 'tilt', name: 'Tilt', min: -100, max: 100,
        cppIndex: 103,
        get: function () { return weqGlobalTilt; },
        set: function (v) { weqGlobalTilt = v; },
        toNorm: function (v) { return (v + 100) / 200; },
        fromNorm: function (n) { return Math.round(n * 200 - 100); },
        display: function (v) { return (v >= 0 ? '+' : '') + v; }
    });


    defs.push({
        key: 'driftSpd', name: 'Drift Speed', min: -50, max: 50,
        cppIndex: 107,
        get: function () { return weqDrift; },
        set: function (v) { weqDrift = v; },
        toNorm: function (v) { return (v + 50) / 100; },
        fromNorm: function (n) { return Math.round(n * 100 - 50); },
        display: function (v) { return (v >= 0 ? '+' : '') + v; }
    });
    defs.push({
        key: 'driftRng', name: 'Drift Range', min: 0, max: 50,
        cppIndex: 108,
        get: function () { return weqDriftRange; },
        set: function (v) { weqDriftRange = v; },
        toNorm: function (v) { return v / 50; },
        fromNorm: function (n) { return Math.round(n * 50); },
        display: function (v) { return v + '%'; }
    });
    defs.push({
        key: 'lfoRate', name: 'LFO Rate', min: 0, max: 10,
        cppIndex: 109,
        get: function () { return weqAnimSpeed; },
        set: function (v) { weqAnimSpeed = v; },
        toNorm: function (v) { return v / 10; },
        fromNorm: function (n) { return Math.round(n * 100) / 10; },
        display: function (v) { return v > 0 ? v.toFixed(1) + 'Hz' : 'Off'; }
    });
    defs.push({
        key: 'lfoDep', name: 'LFO Depth', min: 0, max: 24,
        cppIndex: 110,
        get: function () { return weqAnimDepth; },
        set: function (v) { weqAnimDepth = v; },
        toNorm: function (v) { return v / 24; },
        fromNorm: function (n) { return Math.round(n * 24); },
        display: function (v) { return v + 'dB'; }
    });


    // Per-band params (one set per EQ point)
    // cppIndex maps to C++ layout: band*4 + field (0=freq, 1=gain, 2=q, 3=drift)
    for (var i = 0; i < wrongEqPoints.length && i < 8; i++) {
        (function (idx) {
            var pt = wrongEqPoints[idx];
            defs.push({
                key: 'freq_' + idx, name: 'Band ' + (idx + 1) + ' Freq',
                cppIndex: idx * 4 + 0,
                get: function () { return weqXToFreq(wrongEqPoints[idx].x); },
                set: function (v) { wrongEqPoints[idx].x = weqFreqToX(v); },
                toNorm: function (v) { return weqFreqToX(v); },
                fromNorm: function (n) { return weqXToFreq(n); },
                display: function (v) { return weqFmtFreq(v) + 'Hz'; }
            });
            defs.push({
                key: 'gain_' + idx, name: 'Band ' + (idx + 1) + ' Gain',
                cppIndex: idx * 4 + 1,
                get: function () { return weqYToDB(wrongEqPoints[idx].y); },
                set: function (v) { wrongEqPoints[idx].y = weqDBtoY(v); },
                toNorm: function (v) { return (v + weqDBRangeMax) / (weqDBRangeMax * 2); },
                fromNorm: function (n) { return n * weqDBRangeMax * 2 - weqDBRangeMax; },
                display: function (v) { return weqFmtDB(v); }
            });
            defs.push({
                key: 'q_' + idx, name: 'Band ' + (idx + 1) + ' Q',
                cppIndex: idx * 4 + 2,
                get: function () { return wrongEqPoints[idx].q != null ? wrongEqPoints[idx].q : 0.707; },
                set: function (v) { wrongEqPoints[idx].q = v; },
                toNorm: function (v) { return (v - 0.025) / 39.975; },
                fromNorm: function (n) { return Math.round((n * 39.975 + 0.025) * 100) / 100; },
                display: function (v) { return 'Q ' + v.toFixed(2); }
            });
            defs.push({
                key: 'drift_' + idx, name: 'Band ' + (idx + 1) + ' Drift',
                cppIndex: idx * 4 + 3,
                get: function () { return wrongEqPoints[idx].drift || 0; },
                set: function (v) { wrongEqPoints[idx].drift = v; },
                toNorm: function (v) { return v / 100; },
                fromNorm: function (n) { return Math.round(n * 100); },
                display: function (v) { return v + '%'; }
            });
        })(i);
    }

    return defs;
}

// ── Create the virtual plugin block ──
function weqCreateVirtualBlock() {
    weqDestroyVirtualBlock(); // clean up any existing

    var defs = _weqParamDefs();
    var params = [];
    for (var i = 0; i < defs.length; i++) {
        var d = defs[i];
        var fid = WEQ_VIRTUAL_ID + ':' + d.key;
        var currentVal = d.get();
        var normVal = d.toNorm(currentVal);
        // cppIndex maps to C++ paramIndex: per-band uses band*4+field,
        // global params use 100+ (kWeqGlobalBase) to avoid collision.
        var paramIdx = d.cppIndex != null ? d.cppIndex : i;
        var param = {
            id: fid,
            name: d.name,
            v: normVal,
            disp: d.display(currentVal),
            lk: false,
            alk: false,
            realIndex: paramIdx,
            hostId: WEQ_VIRTUAL_ID,
            _weqDef: d // private reference to definition
        };
        PMap[fid] = param;
        params.push(param);
    }

    _weqVirtualBlock = {
        id: WEQ_VIRTUAL_ID,
        hostId: WEQ_VIRTUAL_ID,
        name: '⬡ WrongEQ',
        path: '__virtual__',
        manufacturer: 'Noizefield',
        params: params,
        expanded: true,
        searchFilter: '',
        isVirtual: true // flag for special rendering
    };

    // Insert at position 0 (before real plugins)
    pluginBlocks.unshift(_weqVirtualBlock);

    if (typeof renderAllPlugins === 'function') renderAllPlugins();
    if (typeof updCounts === 'function') updCounts();
}

// ── Destroy the virtual plugin block ──
function weqDestroyVirtualBlock() {
    if (!_weqVirtualBlock) return;

    // Remove params from PMap and from any block targets
    _weqVirtualBlock.params.forEach(function (p) {
        delete PMap[p.id];
        if (typeof blocks !== 'undefined') {
            blocks.forEach(function (b) {
                b.targets.delete(p.id);
                if (typeof cleanBlockAfterUnassign === 'function') cleanBlockAfterUnassign(b, p.id);
            });
        }
    });

    // Remove from pluginBlocks
    pluginBlocks = pluginBlocks.filter(function (pb) { return pb.id !== WEQ_VIRTUAL_ID; });
    _weqVirtualBlock = null;

    if (typeof renderAllPlugins === 'function') renderAllPlugins();
    if (typeof updCounts === 'function') updCounts();
}

// ── Rebuild the virtual block (when EQ points are added/removed) ──
function weqRebuildVirtualBlock() {
    if (!_weqVirtualBlock) return;
    // Preserve any block assignment references by matching param keys
    var oldTargets = {};
    if (typeof blocks !== 'undefined') {
        blocks.forEach(function (b) {
            _weqVirtualBlock.params.forEach(function (p) {
                if (b.targets.has(p.id)) oldTargets[p.id] = true;
            });
        });
    }
    weqCreateVirtualBlock();
    // Re-assign old targets (keys match since they use stable key format)
    if (typeof blocks !== 'undefined') {
        blocks.forEach(function (b) {
            for (var pid in oldTargets) {
                if (PMap[pid]) b.targets.add(pid);
            }
        });
    }
}

// ── Sync virtual param values (called from modulation system) ──
// When modulation changes a virtual param, apply it to the EQ state
function weqApplyVirtualParam(pid, normVal) {
    var p = PMap[pid];
    if (!p || !p._weqDef) return;
    var def = p._weqDef;
    var realVal = def.fromNorm(normVal);
    def.set(realVal);
    p.v = normVal;
    p.disp = def.display(realVal);
}

// ── Read current values back into virtual params + update DOM ──
function weqSyncVirtualParams() {
    if (!_weqVirtualBlock) return;
    try {
        for (var i = 0; i < _weqVirtualBlock.params.length; i++) {
            var p = _weqVirtualBlock.params[i];
            if (!p._weqDef) continue;
            var currentVal = p._weqDef.get();
            var newNorm = p._weqDef.toNorm(currentVal);
            var newDisp = p._weqDef.display(currentVal);
            p.v = newNorm;
            p.disp = newDisp;

            // Live DOM update: find the knob and value elements
            var knobEl = document.querySelector('.pr-knob[data-pid="' + p.id + '"]');
            if (knobEl) {
                // Regenerate SVG from the canonical buildParamKnob
                if (typeof buildParamKnob === 'function') {
                    knobEl.innerHTML = buildParamKnob(newNorm, 30, null);
                }
                // Update value text and bar fill
                var row = knobEl.closest('.pr-row');
                if (row) {
                    var valEl = row.querySelector('.pr-val');
                    if (valEl) valEl.textContent = newDisp;
                    var barF = row.querySelector('.pr-bar-f');
                    if (barF) barF.style.width = (newNorm * 100) + '%';
                }
            }
        }
    } catch (err) {
        if (typeof console !== 'undefined') console.warn('weqSyncVirtualParams error:', err);
    }
}

// ════════════════════════════════════════════════════════════
// EQ PRESET SYSTEM — save/load/browse EQ-only presets
// ════════════════════════════════════════════════════════════

// Build EQ preset data (EQ state only — no routing/plugins)
function _weqBuildPresetData() {
    return {
        version: 1,
        points: wrongEqPoints.map(function (p, idx) {
            var sx = (weqAnimRafId && weqAnimBaseX.length > idx) ? weqAnimBaseX[idx] : p.x;
            var sy = (weqAnimRafId && weqAnimBaseY.length > idx) ? weqAnimBaseY[idx] : p.y;
            return {
                x: sx, y: sy,
                q: p.q != null ? p.q : 0.707,
                type: p.type || 'Bell',
                preEq: p.preEq !== false,
                stereoMode: p.stereoMode || 0,
                drift: p.drift || 0,
                solo: p.solo || false,
                mute: p.mute || false,
                slope: p.slope || 1
            };
        }),
        depth: weqGlobalDepth,
        warp: weqGlobalWarp,
        steps: weqGlobalSteps,
        tilt: weqGlobalTilt,
        bypass: weqGlobalBypass,
        unassignedMode: weqUnassignedMode,
        animSpeed: weqAnimSpeed,
        animDepth: weqAnimDepth,
        animShape: weqAnimShape,
        drift: weqDrift,
        driftRange: weqDriftRange,
        driftScale: weqDriftScale,
        driftContinuous: weqDriftContinuous,
        driftMode: weqDriftMode,
        driftTexture: weqDriftTexture,
        gainLoCut: weqGainLoCut,
        gainHiCut: weqGainHiCut,
        driftLoCut: weqDriftLoCut,
        driftHiCut: weqDriftHiCut,
        qModSpeed: weqQModSpeed,
        qModDepth: weqQModDepth,
        qModShape: weqQModShape,
        qLoCut: weqQLoCut,
        qHiCut: weqQHiCut,
        dbRange: weqDBRangeMax,
        splitMode: weqSplitMode,
        oversample: weqOversample
    };
}

// Apply EQ preset data (restores state, re-renders, syncs)
function _weqApplyPresetData(data) {
    if (!data) return;
    _weqPushUndo();

    // Stop animation before restoring
    if (typeof weqAnimStop === 'function') weqAnimStop();

    // Restore points
    if (data.points) {
        wrongEqPoints = data.points.map(function (p) {
            return {
                uid: _weqAllocUid(),
                x: p.x, y: p.y,
                pluginIds: [], // don't restore routing — instance-specific
                seg: null,
                solo: p.solo || false,
                mute: p.mute || false,
                q: p.q != null ? p.q : 0.707,
                type: p.type || 'Bell',
                drift: p.drift || 0,
                preEq: p.preEq !== false,
                stereoMode: p.stereoMode || 0,
                slope: p.slope || 1
            };
        });
    }
    weqAnimBaseY = wrongEqPoints.map(function (p) { return p.y; });
    weqAnimBaseX = wrongEqPoints.map(function (p) { return p.x; });

    // Restore globals
    if (data.depth != null) weqGlobalDepth = data.depth;
    if (data.warp != null) weqGlobalWarp = data.warp;
    if (data.steps != null) weqGlobalSteps = data.steps;
    if (data.tilt != null) weqGlobalTilt = data.tilt;
    if (data.bypass != null) weqGlobalBypass = data.bypass;
    if (data.unassignedMode != null) weqUnassignedMode = data.unassignedMode;
    if (data.animSpeed != null) weqAnimSpeed = data.animSpeed;
    if (data.animDepth != null) weqAnimDepth = data.animDepth;
    if (data.animShape != null) weqAnimShape = data.animShape;
    if (data.drift != null) weqDrift = data.drift;
    if (data.driftRange != null) weqDriftRange = data.driftRange;
    if (data.driftScale != null) weqDriftScale = data.driftScale;
    if (data.driftContinuous != null) weqDriftContinuous = data.driftContinuous;
    if (data.driftMode != null) weqDriftMode = data.driftMode;
    if (data.driftTexture != null) weqDriftTexture = data.driftTexture;
    if (data.gainLoCut != null) weqGainLoCut = data.gainLoCut;
    if (data.gainHiCut != null) weqGainHiCut = data.gainHiCut;
    if (data.driftLoCut != null) weqDriftLoCut = data.driftLoCut;
    if (data.driftHiCut != null) weqDriftHiCut = data.driftHiCut;
    if (data.qModSpeed != null) weqQModSpeed = data.qModSpeed;
    if (data.qModDepth != null) weqQModDepth = data.qModDepth;
    if (data.qModShape != null) weqQModShape = data.qModShape;
    if (data.qLoCut != null) weqQLoCut = data.qLoCut;
    if (data.qHiCut != null) weqQHiCut = data.qHiCut;
    if (data.dbRange != null) weqDBRangeMax = data.dbRange;
    if (data.splitMode != null) weqSplitMode = data.splitMode;
    if (data.oversample != null) weqOversample = data.oversample;

    weqSelectedPt = -1;
    weqFocusBand = -1;
    weqRenderPanel();
    weqSyncToHost();

    // Restart animation if needed
    var needsAnim = _weqNeedsAnim();
    if (needsAnim && typeof weqAnimStart === 'function') weqAnimStart();
    if (typeof markStateDirty === 'function') markStateDirty();
}

// Save preset — prompt with overlay input
function _weqSavePresetPrompt() {
    // Remove existing prompt if any
    var old = document.querySelector('.weq-preset-save-prompt');
    if (old) old.remove();

    var overlay = document.createElement('div');
    overlay.className = 'weq-preset-save-prompt';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:1000;display:flex;align-items:center;justify-content:center';

    var box = document.createElement('div');
    box.style.cssText = 'background:var(--bg-panel);border:1px solid var(--border);border-radius:6px;padding:16px 20px;min-width:280px;display:flex;flex-direction:column;gap:10px;';

    var label = document.createElement('span');
    label.textContent = 'Save EQ Preset';
    label.style.cssText = 'font-family:var(--font-mono);font-size:13px;color:var(--text-primary);font-weight:600';
    box.appendChild(label);

    var input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Preset name…';
    input.value = _weqCurrentPreset || '';
    input.style.cssText = 'font-family:var(--font-mono);font-size:12px;padding:6px 10px;background:var(--bg-inset);border:1px solid var(--border);border-radius:4px;color:var(--text-primary);outline:none';
    box.appendChild(input);

    var btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:8px;justify-content:flex-end';

    var cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = 'font-family:var(--font-mono);font-size:11px;padding:4px 12px;background:none;border:1px solid var(--border);border-radius:4px;color:var(--text-muted);cursor:pointer';
    cancelBtn.onclick = function () { overlay.remove(); };
    btnRow.appendChild(cancelBtn);

    var saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save';
    saveBtn.style.cssText = 'font-family:var(--font-mono);font-size:11px;padding:4px 12px;background:var(--accent);border:1px solid var(--accent);border-radius:4px;color:var(--fire-text);cursor:pointer;font-weight:600';
    saveBtn.onclick = function () {
        var name = input.value.trim();
        if (!name) { input.focus(); return; }
        overlay.remove();
        _weqDoSavePreset(name);
    };
    btnRow.appendChild(saveBtn);
    box.appendChild(btnRow);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    overlay.onclick = function (e) { if (e.target === overlay) overlay.remove(); };
    input.onkeydown = function (e) {
        if (e.key === 'Enter') saveBtn.onclick();
        if (e.key === 'Escape') overlay.remove();
        e.stopPropagation(); // prevent EQ keyboard shortcuts
    };
    setTimeout(function () { input.focus(); input.select(); }, 50);
}

function _weqDoSavePreset(name) {
    if (!window.__JUCE__ || !window.__JUCE__.backend) return;
    var fn = window.__juceGetNativeFunction('saveEqPreset');
    var data = _weqBuildPresetData();
    fn(name, JSON.stringify(data)).then(function () {
        _weqCurrentPreset = name;
        _weqRefreshPresetList();
        weqRenderPanel();
    });
}

// Refresh cached preset list from disk
function _weqRefreshPresetList(cb) {
    if (!window.__JUCE__ || !window.__JUCE__.backend) { if (cb) cb(); return; }
    var fn = window.__juceGetNativeFunction('getEqPresets');
    fn().then(function (list) {
        _weqPresetList = Array.isArray(list) ? list : [];
        if (cb) cb();
    });
}

// Show preset browser dropdown
function _weqShowPresetBrowser(anchor) {
    // Remove existing
    var old = document.querySelector('.weq-preset-dropdown');
    if (old) { old.remove(); return; }

    // Refresh list first, then show
    _weqRefreshPresetList(function () {
        var menu = document.createElement('div');
        menu.className = 'weq-preset-dropdown';
        var rect = anchor.getBoundingClientRect();
        menu.style.left = rect.left + 'px';
        menu.style.top = (rect.bottom + 2) + 'px';

        // Init option
        var initEl = document.createElement('div');
        initEl.className = 'weq-pd-row' + (!_weqCurrentPreset ? ' active' : '');
        initEl.textContent = 'Init';
        initEl.onclick = function () {
            menu.remove();
            _weqCurrentPreset = null;
            wrongEqPoints = [];
            weqAnimBaseY = []; weqAnimBaseX = [];
            weqGlobalDepth = 100; weqGlobalWarp = 0; weqGlobalSteps = 0; weqGlobalTilt = 0;
            weqGlobalBypass = false;
            weqAnimSpeed = 0; weqAnimDepth = 6; weqAnimShape = 'sine';
            weqDrift = 0; weqDriftRange = 5; weqDriftContinuous = false; weqDriftTexture = 'smooth';
            weqGainLoCut = 20; weqGainHiCut = 20000; weqDriftLoCut = 20; weqDriftHiCut = 20000;
            weqQModSpeed = 0; weqQModDepth = 50; weqQModShape = 'sine'; weqQLoCut = 20; weqQHiCut = 20000;
            weqDBRangeMax = 24; weqOversample = 1;
            weqSelectedPt = -1; weqFocusBand = -1;
            if (typeof weqAnimStop === 'function') weqAnimStop();
            weqRenderPanel(); weqSyncToHost();
            if (typeof markStateDirty === 'function') markStateDirty();
        };
        menu.appendChild(initEl);

        // Separator
        if (_weqPresetList.length > 0) {
            var sep = document.createElement('div');
            sep.className = 'weq-pd-sep';
            menu.appendChild(sep);
        }

        _weqPresetList.forEach(function (name) {
            var row = document.createElement('div');
            row.className = 'weq-pd-row' + (name === _weqCurrentPreset ? ' active' : '');

            var label = document.createElement('span');
            label.className = 'weq-pd-label';
            label.textContent = name;
            row.appendChild(label);

            var delBtn = document.createElement('span');
            delBtn.className = 'weq-pd-del';
            delBtn.textContent = '×';
            delBtn.title = 'Delete';
            delBtn.onclick = function (e) {
                e.stopPropagation();
                if (!window.__JUCE__ || !window.__JUCE__.backend) return;
                var fn = window.__juceGetNativeFunction('deleteEqPreset');
                fn(name).then(function () {
                    if (_weqCurrentPreset === name) _weqCurrentPreset = null;
                    row.remove();
                    _weqRefreshPresetList();
                    weqRenderPanel();
                });
            };
            row.appendChild(delBtn);

            row.onclick = function () {
                menu.remove();
                _weqLoadPreset(name);
            };
            menu.appendChild(row);
        });

        document.body.appendChild(menu);
        function dismiss(de) { if (!menu.contains(de.target)) { menu.remove(); document.removeEventListener('click', dismiss); } }
        setTimeout(function () { document.addEventListener('click', dismiss); }, 10);
    });
}

// Load a preset by name
function _weqLoadPreset(name) {
    if (!window.__JUCE__ || !window.__JUCE__.backend) return;
    var fn = window.__juceGetNativeFunction('loadEqPreset');
    fn(name).then(function (jsonStr) {
        if (!jsonStr) return;
        try {
            var data = JSON.parse(jsonStr);
            _weqCurrentPreset = name;
            _weqApplyPresetData(data);
        } catch (e) { console.log('EQ preset parse error:', e); }
    });
}

// Navigate presets (prev/next)
function _weqNavPreset(dir) {
    _weqRefreshPresetList(function () {
        if (_weqPresetList.length === 0) return;
        var idx = _weqCurrentPreset ? _weqPresetList.indexOf(_weqCurrentPreset) : -1;
        var next = idx + dir;
        if (next < 0) next = _weqPresetList.length - 1;
        if (next >= _weqPresetList.length) next = 0;
        _weqLoadPreset(_weqPresetList[next]);
    });
}
