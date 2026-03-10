// ============================================================
// UNDO / REDO SYSTEM
// Granular: param changes store only what changed
// ============================================================

var undoStack = [], redoStack = [], maxUndo = 80;

// ── Single param change (knob drag) ──
function pushParamUndo(paramId, oldVal) {
    undoStack.push({ type: 'param', id: paramId, val: oldVal });
    if (undoStack.length > maxUndo) undoStack.shift();
    redoStack = [];
    updateUndoBadge();
}

// ── Multiple param changes (randomize, preset load) ──
// changes: [{id: paramId, val: oldValue}, ...]
function pushMultiParamUndo(changes) {
    if (!changes || !changes.length) return;
    undoStack.push({ type: 'multiParam', changes: changes });
    if (undoStack.length > maxUndo) undoStack.shift();
    redoStack = [];
    updateUndoBadge();
}

// ── Full state snapshot (structural: blocks, locks, bypass) ──
function captureFullSnapshot() {
    var paramSnap = {};
    var ap = allParams();
    for (var i = 0; i < ap.length; i++) {
        var p = ap[i];
        paramSnap[p.id] = { v: p.v, lk: !!p.lk, alk: !!p.alk };
    }
    var blockSnap = blocks.map(function (b) {
        return JSON.parse(JSON.stringify(b, function (k, v) {
            if (v instanceof Set) return { __set__: Array.from(v) };
            return v;
        }));
    });
    var pluginSnap = pluginBlocks.map(function (pb) {
        return { id: pb.id, bypassed: !!pb.bypassed, expanded: pb.expanded, busId: pb.busId || 0 };
    });
    return { params: paramSnap, blocks: blockSnap, plugins: pluginSnap, actId: actId };
}

function pushUndoSnapshot() {
    undoStack.push({ type: 'full', snapshot: captureFullSnapshot() });
    if (undoStack.length > maxUndo) undoStack.shift();
    redoStack = [];
    updateUndoBadge();
}

// ── Undo ──
function performUndo() {
    if (undoStack.length === 0) return;
    var entry = undoStack.pop();

    if (entry.type === 'param') {
        var p = PMap[entry.id];
        if (p) {
            redoStack.push({ type: 'param', id: entry.id, val: p.v });
            p.v = entry.val;
            if (window.__JUCE__ && window.__JUCE__.backend) {
                var setParamFn = window.__juceGetNativeFunction('setParam');
                if (setParamFn) setParamFn(p.hostId, p.realIndex, p.v);
            }
            _modDirty = true;
            refreshParamDisplay();
        }
    } else if (entry.type === 'multiParam') {
        var redoChanges = [];
        var batch = [];
        entry.changes.forEach(function (c) {
            var p = PMap[c.id];
            if (p) {
                redoChanges.push({ id: c.id, val: p.v });
                p.v = c.val;
                batch.push({ p: p.hostId, i: p.realIndex, v: p.v });
            }
        });
        if (batch.length > 0 && window.__JUCE__ && window.__JUCE__.backend) {
            var batchFn = window.__juceGetNativeFunction('applyParamBatch');
            if (batchFn) batchFn(JSON.stringify(batch));
        }
        redoStack.push({ type: 'multiParam', changes: redoChanges });
        renderAllPlugins();
    } else if (entry.type === 'full') {
        redoStack.push({ type: 'full', snapshot: captureFullSnapshot() });
        applyFullSnapshot(entry.snapshot);
    }
    updateUndoBadge();
}

// ── Redo ──
function performRedo() {
    if (redoStack.length === 0) return;
    var entry = redoStack.pop();

    if (entry.type === 'param') {
        var p = PMap[entry.id];
        if (p) {
            undoStack.push({ type: 'param', id: entry.id, val: p.v });
            p.v = entry.val;
            if (window.__JUCE__ && window.__JUCE__.backend) {
                var setParamFn = window.__juceGetNativeFunction('setParam');
                if (setParamFn) setParamFn(p.hostId, p.realIndex, p.v);
            }
            _modDirty = true;
            refreshParamDisplay();
        }
    } else if (entry.type === 'multiParam') {
        var undoChanges = [];
        var batch = [];
        entry.changes.forEach(function (c) {
            var p = PMap[c.id];
            if (p) {
                undoChanges.push({ id: c.id, val: p.v });
                p.v = c.val;
                batch.push({ p: p.hostId, i: p.realIndex, v: p.v });
            }
        });
        if (batch.length > 0 && window.__JUCE__ && window.__JUCE__.backend) {
            var batchFn = window.__juceGetNativeFunction('applyParamBatch');
            if (batchFn) batchFn(JSON.stringify(batch));
        }
        undoStack.push({ type: 'multiParam', changes: undoChanges });
        renderAllPlugins();
    } else if (entry.type === 'full') {
        undoStack.push({ type: 'full', snapshot: captureFullSnapshot() });
        applyFullSnapshot(entry.snapshot);
    }
    updateUndoBadge();
}

// ── Apply full snapshot (for structural undo) ──
function applyFullSnapshot(snap) {
    var batch = [];
    for (var id in snap.params) {
        var p = PMap[id];
        if (!p) continue;
        var s = snap.params[id];
        p.v = s.v; p.lk = s.lk; p.alk = s.alk;
        batch.push({ p: p.hostId, i: p.realIndex, v: p.v });
    }
    if (batch.length > 0 && window.__JUCE__ && window.__JUCE__.backend) {
        var batchFn = window.__juceGetNativeFunction('applyParamBatch');
        if (batchFn) batchFn(JSON.stringify(batch));
    }
    if (snap.blocks) {
        blocks = snap.blocks.map(function (b) {
            var restored = JSON.parse(JSON.stringify(b), function (k, v) {
                if (v && v.__set__) return new Set(v.__set__);
                return v;
            });
            if (restored.targets && !(restored.targets instanceof Set)) {
                restored.targets = new Set(Array.isArray(restored.targets) ? restored.targets : []);
            }
            return restored;
        });
    }
    if (snap.plugins) {
        for (var pi = 0; pi < snap.plugins.length && pi < pluginBlocks.length; pi++) {
            var ps = snap.plugins[pi];
            var pb = pluginBlocks[pi];
            if (pb.id === ps.id) {
                pb.bypassed = ps.bypassed;
                pb.expanded = ps.expanded;
                pb.busId = ps.busId;
            }
        }
    }
    if (snap.actId !== undefined) actId = snap.actId;
    renderAllPlugins(); renderBlocks(); updCounts(); syncBlocksToHost();
}

function updateUndoBadge() {
    var btn = document.getElementById('undoBtn');
    var badge = document.getElementById('undoCount');
    badge.textContent = undoStack.length;
    btn.disabled = undoStack.length === 0;
    var redoBtn = document.getElementById('redoBtn');
    var redoBadge = document.getElementById('redoCount');
    if (redoBtn) {
        redoBadge.textContent = redoStack.length;
        redoBtn.disabled = redoStack.length === 0;
    }
}
