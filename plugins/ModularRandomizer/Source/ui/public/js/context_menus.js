// ============================================================
// CONTEXT MENUS
// Param context menu, plugin context menu, lock/unlock
// ============================================================
// Context menu
function showCtx(x, y, p) {
    var m = document.getElementById('ctx');
    var menuW = 160, menuH = 200;
    var vw = window.innerWidth, vh = window.innerHeight;
    var posLeft = x, posTop = y;
    if (posLeft + menuW > vw - 4) posLeft = vw - menuW - 4;
    if (posLeft < 4) posLeft = 4;
    if (posTop + menuH > vh - 4) posTop = Math.max(4, y - menuH);
    m.style.left = posLeft + 'px'; m.style.top = posTop + 'px';
    m.classList.add('vis');
    var pids = selectedParams.size > 0 ? Array.from(selectedParams) : [p.id];
    var count = pids.length;
    var suffix = count > 1 ? ' (' + count + ')' : '';
    // Determine Lock/Unlock visibility based on ALL selected params
    var anyLockable = false, anyUnlockable = false, anyLocked = false;
    pids.forEach(function (pid) {
        var pp = PMap[pid]; if (!pp) return;
        if (!pp.lk && !pp.alk) anyLockable = true;
        if (pp.lk && !pp.alk) anyUnlockable = true;
        if (pp.lk) anyLocked = true;
    });
    var cL = document.getElementById('cL');
    var cU = document.getElementById('cU');
    cL.style.display = anyLockable ? '' : 'none';
    cU.style.display = anyUnlockable ? '' : 'none';
    cL.textContent = 'Lock' + suffix;
    cU.textContent = 'Unlock' + suffix;
    // Build "Unassign from Block" submenu — show blocks that have any selected param
    var unSub = document.getElementById('ctxUnassignMenu');
    var unSep = document.getElementById('ctxUnassignSep');
    var unWrap = document.getElementById('ctxUnassignSub');
    var assignedBlocks = [];
    for (var bi = 0; bi < blocks.length; bi++) {
        var bl = blocks[bi];
        var hasAny = false;
        for (var pi = 0; pi < pids.length; pi++) {
            if (bl.targets.has(pids[pi])) { hasAny = true; break; }
        }
        if (hasAny) assignedBlocks.push({ bl: bl, idx: bi });
    }
    if (assignedBlocks.length > 0 && !anyLocked) {
        unSep.style.display = ''; unWrap.style.display = '';
        var ush = '';
        for (var ai = 0; ai < assignedBlocks.length; ai++) {
            var ab = assignedBlocks[ai];
            ush += '<div class="ctx-i" data-unassignblock="' + ab.bl.id + '"><span class="ctx-block-dot" style="background:' + bColor(ab.bl.colorIdx) + '"></span>Block ' + (ab.idx + 1) + ' (' + ab.bl.mode + ')</div>';
        }
        unSub.innerHTML = ush;
        unSub.querySelectorAll('[data-unassignblock]').forEach(function (item) {
            item.onclick = function (e) {
                e.stopPropagation();
                var bid = parseInt(item.dataset.unassignblock);
                var bl = findBlock(bid);
                if (!bl) return;
                pushUndoSnapshot();
                pids.forEach(function (pid) { bl.targets.delete(pid); cleanBlockAfterUnassign(bl, pid); });
                m.classList.remove('vis');
                selectedParams.clear();
                renderAllPlugins(); renderBlocks(); syncBlocksToHost();
            };
        });
    } else {
        unSep.style.display = 'none'; unWrap.style.display = 'none';
    }
    // Build "Assign to Block" submenu
    var sub = document.getElementById('ctxAssignMenu');
    var sep = document.getElementById('ctxAssignSep');
    var subWrap = document.getElementById('ctxAssignSub');
    if (blocks.length > 0 && !anyLocked) {
        sep.style.display = ''; subWrap.style.display = '';
        var sh = '';
        for (var bi = 0; bi < blocks.length; bi++) {
            var bl = blocks[bi];
            sh += '<div class="ctx-i" data-assignblock="' + bl.id + '"><span class="ctx-block-dot" style="background:' + bColor(bl.colorIdx) + '"></span>Block ' + (bi + 1) + ' (' + bl.mode + ')</div>';
        }
        sub.innerHTML = sh;
        sub.querySelectorAll('[data-assignblock]').forEach(function (item) {
            item.onclick = function (e) {
                e.stopPropagation();
                var bid = parseInt(item.dataset.assignblock);
                var bl = findBlock(bid);
                if (!bl) return;
                pushUndoSnapshot();
                pids.forEach(function (pid) {
                    var pp = PMap[pid];
                    if (pp && !pp.lk) assignTarget(bl, pid);
                });
                m.classList.remove('vis');
                selectedParams.clear();
                renderAllPlugins(); renderBlocks(); syncBlocksToHost();
            };
        });
    } else {
        sep.style.display = 'none'; subWrap.style.display = 'none';
    }
    // Build "Assign to Lane" submenu — show lane blocks with their lanes
    var laneSub = document.getElementById('ctxLaneMenu');
    var laneSep = document.getElementById('ctxLaneSep');
    var laneWrap = document.getElementById('ctxLaneSub');
    var laneBlocks = [];
    for (var bi = 0; bi < blocks.length; bi++) {
        var bl = blocks[bi];
        if (bl.mode === 'lanes' && bl.lanes && bl.lanes.length > 0) {
            laneBlocks.push({ bl: bl, idx: bi });
        }
    }
    if (laneBlocks.length > 0 && !anyLocked) {
        laneSep.style.display = ''; laneWrap.style.display = '';
        var lh = '';
        for (var li = 0; li < laneBlocks.length; li++) {
            var lb = laneBlocks[li];
            for (var lj = 0; lj < lb.bl.lanes.length; lj++) {
                var lane = lb.bl.lanes[lj];
                var lName = lane.morphMode ? 'Morph' : (lane.pids && lane.pids.length > 0 ? (PMap[lane.pids[0]] ? PMap[lane.pids[0]].name : 'Lane') : 'Lane');
                if (lName.length > 12) lName = lName.substring(0, 11) + '\u2026';
                lh += '<div class="ctx-i" data-assignlane-b="' + lb.bl.id + '" data-assignlane-li="' + lj + '"><span class="ctx-block-dot" style="background:' + (lane.color || bColor(lb.bl.colorIdx)) + '"></span>B' + (lb.idx + 1) + ' / ' + lName + (lane.morphMode ? ' \u21CB' : '') + '</div>';
            }
        }
        laneSub.innerHTML = lh;
        laneSub.querySelectorAll('[data-assignlane-b]').forEach(function (item) {
            item.onclick = function (e) {
                e.stopPropagation();
                var bid = parseInt(item.dataset.assignlaneB);
                var lIdx = parseInt(item.dataset.assignlaneLi);
                var bl = findBlock(bid);
                if (!bl || !bl.lanes[lIdx]) return;
                var lane = bl.lanes[lIdx];
                pushUndoSnapshot();
                pids.forEach(function (pid) {
                    var pp = PMap[pid];
                    if (pp && !pp.lk) {
                        assignTarget(bl, pid);
                        if (lane.pids.indexOf(pid) < 0) lane.pids.push(pid);
                    }
                });
                m.classList.remove('vis');
                selectedParams.clear();
                renderAllPlugins(); renderBlocks(); syncBlocksToHost();
            };
        });
    } else {
        laneSep.style.display = 'none'; laneWrap.style.display = 'none';
    }
}
function showPlugCtx(x, y, plugId) {
    var m = document.getElementById('plugCtx');
    var menuW = 180, menuH = 220;
    var vw = window.innerWidth, vh = window.innerHeight;
    var posLeft = x, posTop = y;
    if (posLeft + menuW > vw - 4) posLeft = vw - menuW - 4;
    if (posLeft < 4) posLeft = 4;
    if (posTop + menuH > vh - 4) posTop = Math.max(4, y - menuH);
    m.style.left = posLeft + 'px';
    m.style.top = posTop + 'px';
    m.classList.add('vis');
    // Update bypass label
    var pb = null;
    for (var i = 0; i < pluginBlocks.length; i++) { if (pluginBlocks[i].id === plugId) { pb = pluginBlocks[i]; break; } }
    document.getElementById('pcBypass').textContent = (pb && pb.bypassed) ? 'Unbypass Plugin' : 'Bypass Plugin';
    // Build "Add Snapshot to" submenu — show morph_pad blocks
    var snapSep = document.getElementById('pcSnapSep');
    var snapWrap = document.getElementById('pcSnapSub');
    var snapMenu = document.getElementById('pcSnapMenu');
    var morphBlocks = getMorphBlocks();
    if (morphBlocks.length > 0) {
        snapSep.style.display = ''; snapWrap.style.display = '';
        var sh = '';
        for (var mi = 0; mi < morphBlocks.length; mi++) {
            var mb = morphBlocks[mi];
            var full = mb.snapCount >= 12;
            sh += '<div class="ctx-i' + (full ? ' disabled' : '') + '" data-snapblock="' + mb.id + '" data-snapplug="' + plugId + '"><span class="ctx-block-dot" style="background:' + bColor(mb.colorIdx) + '"></span>Block ' + (mb.idx + 1) + ' (' + mb.snapCount + '/12)' + (full ? ' — Full' : '') + '</div>';
        }
        snapMenu.innerHTML = sh;
        snapMenu.querySelectorAll('[data-snapblock]').forEach(function (item) {
            if (item.classList.contains('disabled')) return;
            item.onclick = function (e) {
                e.stopPropagation();
                var bid = parseInt(item.dataset.snapblock);
                var pid = parseInt(item.dataset.snapplug);
                addSnapshotToMorphBlock(bid, pid);
                m.classList.remove('vis');
            };
        });
    } else {
        snapSep.style.display = 'none'; snapWrap.style.display = 'none';
    }
}
document.addEventListener('click', function () {
    document.getElementById('ctx').classList.remove('vis');
    document.getElementById('plugCtx').classList.remove('vis');
});
// Lock: operates on all selected params
document.getElementById('cL').onclick = function () {
    var pids = selectedParams.size > 0 ? Array.from(selectedParams) : (ctxP ? [ctxP.id] : []);
    pushUndoSnapshot();
    pids.forEach(function (pid) {
        var pp = PMap[pid]; if (!pp || pp.alk) return;
        pp.lk = true;
        blocks.forEach(function (b) { b.targets.delete(pid); cleanBlockAfterUnassign(b, pid); });
    });
    selectedParams.clear();
    renderAllPlugins(); renderBlocks(); syncBlocksToHost();
};
// Unlock: operates on all selected params
document.getElementById('cU').onclick = function () {
    var pids = selectedParams.size > 0 ? Array.from(selectedParams) : (ctxP ? [ctxP.id] : []);
    pushUndoSnapshot();
    pids.forEach(function (pid) {
        var pp = PMap[pid]; if (!pp || pp.alk) return;
        pp.lk = false;
    });
    selectedParams.clear();
    renderAllPlugins(); syncBlocksToHost();
};

// Plugin context menu actions
document.getElementById('pcLockAll').onclick = function () {
    var pb = null;
    for (var i = 0; i < pluginBlocks.length; i++) { if (pluginBlocks[i].id === plugCtxPluginId) { pb = pluginBlocks[i]; break; } }
    if (!pb) return;
    pushUndoSnapshot();
    pb.params.forEach(function (p) {
        p.lk = true;
        blocks.forEach(function (b) { b.targets.delete(p.id); cleanBlockAfterUnassign(b, p.id); });
    });
    renderAllPlugins(); renderBlocks(); updCounts(); syncBlocksToHost(); saveUiStateToHost();
};
document.getElementById('pcUnlockAll').onclick = function () {
    var pb = null;
    for (var i = 0; i < pluginBlocks.length; i++) { if (pluginBlocks[i].id === plugCtxPluginId) { pb = pluginBlocks[i]; break; } }
    if (!pb) return;
    pushUndoSnapshot();
    pb.params.forEach(function (p) { if (!p.alk) p.lk = false; });
    renderAllPlugins(); updCounts(); syncBlocksToHost(); saveUiStateToHost();
};
document.getElementById('pcBypass').onclick = function () {
    var pb = null;
    for (var i = 0; i < pluginBlocks.length; i++) { if (pluginBlocks[i].id === plugCtxPluginId) { pb = pluginBlocks[i]; break; } }
    if (!pb) return;
    pb.bypassed = !pb.bypassed;
    // Sync to C++ audio thread
    if (window.__JUCE__ && window.__JUCE__.backend) {
        var fn = window.__juceGetNativeFunction('setPluginBypass');
        fn(pb.hostId, pb.bypassed);
    }
    renderAllPlugins(); saveUiStateToHost();
};
document.getElementById('pcDuplicate').onclick = function () {
    var pb = null;
    for (var i = 0; i < pluginBlocks.length; i++) { if (pluginBlocks[i].id === plugCtxPluginId) { pb = pluginBlocks[i]; break; } }
    if (!pb || !pb.path) return;
    document.getElementById('plugCtx').classList.remove('vis');
    // Load same plugin, then copy all param values
    if (!(window.__JUCE__ && window.__JUCE__.backend)) return;
    showToast('Duplicating ' + pb.name + '…', 'info', 2000);
    var loadFn = window.__juceGetNativeFunction('loadPlugin');
    var savedParams = [];
    pb.params.forEach(function (p) { savedParams.push({ idx: p.realIndex, val: p.v, lk: p.lk, alk: p.alk }); });
    loadFn(pb.path).then(function (result) {
        if (!result || result.error) { showToast('Failed to duplicate: ' + (result ? result.error : 'unknown'), 'error', 3000); return; }
        var hostedId = result.id;
        var params = (result.params || []).map(function (p, i) {
            var fid = hostedId + ':' + p.index;
            var param = { id: fid, name: p.name, v: p.value, disp: p.disp || '', lk: false, alk: false, realIndex: p.index, hostId: hostedId };
            PMap[fid] = param;
            return param;
        });
        pluginBlocks.push({ id: hostedId, hostId: hostedId, name: result.name, path: pb.path, manufacturer: result.manufacturer || pb.manufacturer || '', params: params, expanded: true, searchFilter: '', busId: pb.busId });
        // Apply saved param values
        var setParamFn = window.__juceGetNativeFunction('setParam');
        savedParams.forEach(function (sp) {
            var newParam = null;
            for (var pi = 0; pi < params.length; pi++) { if (params[pi].realIndex === sp.idx) { newParam = params[pi]; break; } }
            if (newParam) {
                newParam.v = sp.val;
                newParam.lk = sp.lk;
                newParam.alk = sp.alk;
                if (setParamFn) setParamFn(hostedId, sp.idx, sp.val);
            }
        });
        showToast(result.name + ' duplicated', 'success', 2000);
        renderAllPlugins(); updCounts(); saveUiStateToHost(); syncExpandedPlugins();
    }).catch(function (err) { showToast('Duplicate failed: ' + err, 'error', 3000); });
};
document.getElementById('pcRandomize').onclick = function () {
    var pb = null;
    for (var i = 0; i < pluginBlocks.length; i++) { if (pluginBlocks[i].id === plugCtxPluginId) { pb = pluginBlocks[i]; break; } }
    if (!pb) return;
    var oldVals = [];
    pb.params.forEach(function (p) { if (!p.lk && !p.alk) oldVals.push({ id: p.id, val: p.v }); });
    var setParamFn = (window.__JUCE__ && window.__JUCE__.backend) ? window.__juceGetNativeFunction('setParam') : null;
    pb.params.forEach(function (p) {
        if (p.lk || p.alk) return;
        var newVal = Math.random();
        p.v = newVal;
        if (setParamFn && p.hostId !== undefined) setParamFn(p.hostId, p.realIndex, newVal);
        // Update base anchor in any shapes_range block targeting this param
        for (var bi = 0; bi < blocks.length; bi++) {
            var b = blocks[bi];
            if (b.mode === 'shapes_range' && b.targets.has(p.id) && b.targetRangeBases) {
                b.targetRangeBases[p.id] = newVal;
            }
        }
    });
    pushMultiParamUndo(oldVals);
    renderAllPlugins();
    syncBlocksToHost();
};
