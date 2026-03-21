// ============================================================
// PRESET SYSTEM
// Plugin presets, snapshots, and global presets
// ============================================================
// ── Preset Browser ──
var presetPluginId = null;
var presetSaveType = 'preset'; // 'preset' or 'snapshot'
var presetFilterType = 'all';  // 'all', 'preset', 'snapshot'
function getPresetPluginName(plugId) {
    for (var i = 0; i < pluginBlocks.length; i++) {
        if (pluginBlocks[i].id === plugId) return pluginBlocks[i].name;
    }
    return 'Unknown';
}
function getPresetPluginManufacturer(plugId) {
    for (var i = 0; i < pluginBlocks.length; i++) {
        if (pluginBlocks[i].id === plugId) return pluginBlocks[i].manufacturer || '';
    }
    return '';
}
function openPresetBrowser(plugId, saveType) {
    presetPluginId = plugId;
    presetSaveType = saveType || 'preset';
    presetFilterType = 'all';
    var pName = getPresetPluginName(plugId);
    document.getElementById('presetModalTitle').textContent = pName + ' \u2014 Library';
    document.getElementById('presetNameInput').value = '';
    // Reset search
    var searchEl = document.getElementById('presetSearch');
    if (searchEl) { searchEl.value = ''; }
    if (typeof presetSearchText !== 'undefined') presetSearchText = '';
    // Sync type toggle
    document.querySelectorAll('.preset-type-btn').forEach(function (b) {
        b.classList.toggle('on', b.dataset.savetype === presetSaveType);
    });
    document.getElementById('presetModal').classList.add('vis');
    // Update filter tab visuals
    document.querySelectorAll('#presetModal .preset-filter').forEach(function (btn) {
        btn.classList.toggle('on', btn.dataset.filter === 'all');
    });
    refreshPresetList();
}
function closePresetBrowser() {
    document.getElementById('presetModal').classList.remove('vis');
    presetPluginId = null;
}
function refreshPresetList() {
    var body = document.getElementById('presetBody');
    var info = document.getElementById('presetInfo');
    body.innerHTML = '<div class="preset-empty">Loading...</div>';
    body._allItems = null; // Clear stale cache immediately
    if (!(window.__JUCE__ && window.__JUCE__.backend)) {
        body.innerHTML = '<div class="preset-empty">No backend connected</div>';
        info.textContent = '0 items';
        return;
    }
    var requestPluginId = presetPluginId; // capture for stale check
    var pName = getPresetPluginName(presetPluginId);
    var pb = null;
    for (var i = 0; i < pluginBlocks.length; i++) {
        if (pluginBlocks[i].id === presetPluginId) { pb = pluginBlocks[i]; break; }
    }
    console.log('[PresetBrowser] refreshPresetList pluginId=' + presetPluginId + ' name=' + pName + ' hostId=' + (pb ? pb.hostId : 'null'));
    var items = [];
    var pending = 2; // user presets + factory presets
    var checkDone = function () {
        if (pending === 0) {
            // Stale guard: if user switched plugin while we were loading, discard
            if (presetPluginId !== requestPluginId) {
                console.log('[PresetBrowser] discarding stale results for pluginId=' + requestPluginId);
                return;
            }
            if (!items.length) {
                body._allItems = null; // Ensure no stale data for filter tabs
                body.innerHTML = '<div class="preset-empty">No presets found</div>';
                info.textContent = '0 items';
                // Hide Factory tab when empty
                var factoryTab = document.querySelector('#presetModal .preset-filter[data-filter="factory"]');
                if (factoryTab) factoryTab.style.display = 'none';
            } else {
                renderPresetItems(items);
            }
        }
    };
    // ── User presets/snapshots ──
    var mfr = getPresetPluginManufacturer(presetPluginId);
    var fn = window.__juceGetNativeFunction('getPluginPresets');
    fn(mfr, pName).then(function (names) {
        if (!names || !names.length) { pending--; checkDone(); return; }
        var loadFn = window.__juceGetNativeFunction('loadPluginPreset');
        var loaded = 0;
        names.forEach(function (n) {
            loadFn(mfr, pName, n).then(function (jsonStr) {
                var type = 'preset'; // default for legacy presets without type field
                if (jsonStr) {
                    try { var d = JSON.parse(jsonStr); if (d.type) type = d.type; } catch (e) { }
                }
                items.push({ name: n, type: type });
                loaded++;
                if (loaded === names.length) { pending--; checkDone(); }
            }).catch(function () {
                items.push({ name: n, type: 'preset' });
                loaded++;
                if (loaded === names.length) { pending--; checkDone(); }
            });
        });
    }).catch(function () { pending--; checkDone(); });
    // ── Factory presets ──
    var getFactoryFn = window.__juceGetNativeFunction('getFactoryPresets');
    if (getFactoryFn && pb) {
        var factoryHostId = pb.hostId !== undefined ? pb.hostId : pb.id;
        console.log('[PresetBrowser] fetching factory presets for hostId=' + factoryHostId);
        getFactoryFn(factoryHostId).then(function (presets) {
            var count = presets ? presets.length : 0;
            var sampleNames = presets ? presets.slice(0, 5).map(function (p) { return p.name; }).join(', ') : '';
            console.log('[PresetBrowser] got ' + count + ' factory presets for hostId=' + factoryHostId + ' first: [' + sampleNames + ']');
            if (presets && presets.length) {
                presets.forEach(function (fp) {
                    items.push({ name: fp.name, type: 'factory', factoryIndex: fp.index, hostId: factoryHostId, filePath: fp.filePath || '' });
                });
            }
            pending--;
            checkDone();
        }).catch(function () { pending--; checkDone(); });
    } else {
        pending--;
        checkDone();
    }
}
function renderPresetItems(items) {
    var body = document.getElementById('presetBody');
    var info = document.getElementById('presetInfo');
    body._allItems = items;
    // Show/hide Factory tab based on whether factory items exist
    var hasFactory = items.some(function (it) { return it.type === 'factory'; });
    var factoryTab = document.querySelector('#presetModal .preset-filter[data-filter="factory"]');
    if (factoryTab) factoryTab.style.display = hasFactory ? '' : 'none';
    // Auto-fallback: if filter is 'factory' but no factory items exist, switch to 'all'
    if (presetFilterType === 'factory' && !hasFactory) {
        presetFilterType = 'all';
        document.querySelectorAll('#presetModal .preset-filter').forEach(function (b) {
            b.classList.toggle('on', b.dataset.filter === 'all');
        });
    }
    // Apply type filter
    var filtered = items;
    if (presetFilterType !== 'all') {
        filtered = items.filter(function (it) { return it.type === presetFilterType; });
    }
    // Apply search filter
    if (typeof presetSearchText === 'string' && presetSearchText) {
        filtered = filtered.filter(function (it) { return it.name.toLowerCase().indexOf(presetSearchText) >= 0; });
    }
    var sorted = filtered.slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
    info.textContent = sorted.length + ' of ' + items.length + ' item' + (items.length !== 1 ? 's' : '');
    if (!sorted.length) {
        body.innerHTML = '<div class="preset-empty">' + (presetSearchText ? 'No matches for "' + escHtml(presetSearchText) + '"' : 'No ' + (presetFilterType === 'all' ? 'saved items' : presetFilterType + 's')) + '</div>';
        return;
    }
    var h = '';
    sorted.forEach(function (it, idx) {
        var badgeClass = it.type === 'snapshot' ? 'type-snapshot' : it.type === 'factory' ? 'type-factory' : 'type-preset';
        h += '<div class="preset-row" data-pname="' + escHtml(it.name) + '" data-pidx="' + idx + '">';
        h += '<span class="preset-type-badge ' + badgeClass + '">' + it.type + '</span>';
        h += '<span class="preset-name">' + escHtml(it.name) + '</span>';
        if (it.type !== 'factory') {
            h += '<button class="preset-reveal" data-preveal="' + escHtml(it.name) + '" title="Show in file explorer"><svg viewBox="0 0 16 16"><path d="M2 4.5C2 3.67 2.67 3 3.5 3H6l1.5 1.5H12.5C13.33 4.5 14 5.17 14 6v5.5c0 .83-.67 1.5-1.5 1.5h-9C2.67 13 2 12.33 2 11.5z"/><path d="M10 9.5l2-2m0 0l-1.5 0m1.5 0l0 1.5"/></svg></button>';
            h += '<button class="preset-del" data-pdel="' + escHtml(it.name) + '">&times;</button>';
        }
        h += '</div>';
    });
    body.innerHTML = h;
    body.querySelectorAll('.preset-row').forEach(function (row) {
        row.onclick = function (e) {
            if (e.target.closest('[data-pdel]') || e.target.closest('[data-preveal]')) return;
            var idx = parseInt(row.dataset.pidx);
            var item = sorted[idx];
            if (item && item.type === 'factory' && item.factoryIndex !== undefined) {
                loadFactoryPresetInPlace(item);
            } else {
                loadPreset(row.dataset.pname);
            }
        };
    });
    // Reveal in file explorer (per-plugin presets)
    body.querySelectorAll('[data-preveal]').forEach(function (btn) {
        btn.onclick = function (e) {
            e.stopPropagation();
            var revealFn = window.__juceGetNativeFunction('revealPresetFile');
            if (revealFn) {
                var mfr = getPresetPluginManufacturer(presetPluginId);
                var pName = getPresetPluginName(presetPluginId);
                revealFn('snapshot', btn.dataset.preveal, mfr, pName);
            }
        };
    });
    // Delete with confirmation
    body.querySelectorAll('[data-pdel]').forEach(function (btn) {
        var confirmTimer = null;
        btn.onclick = function (e) {
            e.stopPropagation();
            if (btn._confirming) {
                clearTimeout(confirmTimer);
                btn._confirming = false;
                deletePreset(btn.dataset.pdel);
            } else {
                btn._confirming = true;
                btn.textContent = 'Delete?';
                btn.style.color = '#e55';
                btn.style.borderColor = '#e55';
                confirmTimer = setTimeout(function () {
                    btn._confirming = false;
                    btn.innerHTML = '&times;';
                    btn.style.color = '';
                    btn.style.borderColor = '';
                }, 2000);
            }
        };
    });
}
function savePresetFromInput() {
    var nameInput = document.getElementById('presetNameInput');
    var name = nameInput.value.trim();
    if (!name) { nameInput.focus(); return; }
    var pb = null;
    for (var i = 0; i < pluginBlocks.length; i++) {
        if (pluginBlocks[i].id === presetPluginId) { pb = pluginBlocks[i]; break; }
    }
    if (!pb) return;
    // Build preset data by param index
    var data = { pluginName: pb.name, type: presetSaveType, params: {} };
    pb.params.forEach(function (p) {
        data.params[p.realIndex] = { name: p.name, value: p.v, locked: p.lk || false, alk: p.alk || false };
    });
    var fn = window.__juceGetNativeFunction('savePluginPreset');
    fn(pb.manufacturer || '', pb.name, name, JSON.stringify(data)).then(function () {
        nameInput.value = '';
        refreshPresetList();
    });
}
function loadPreset(presetName) {
    var pb = null;
    for (var i = 0; i < pluginBlocks.length; i++) {
        if (pluginBlocks[i].id === presetPluginId) { pb = pluginBlocks[i]; break; }
    }
    if (!pb) return;
    if (!(window.__JUCE__ && window.__JUCE__.backend)) return;
    var fn = window.__juceGetNativeFunction('loadPluginPreset');
    fn(pb.manufacturer || '', pb.name, presetName).then(function (jsonStr) {
        if (!jsonStr) return;
        try {
            var data = JSON.parse(jsonStr);
            if (!data.params) return;
            // Capture old values before applying preset
            var oldVals = [];
            pb.params.forEach(function (p) { oldVals.push({ id: p.id, val: p.v }); });
            var batch = [];
            for (var idx in data.params) {
                var entry = data.params[idx];
                var val = (typeof entry === 'object') ? entry.value : entry;
                var savedLk = (typeof entry === 'object') ? entry.locked : false;
                var savedAlk = (typeof entry === 'object') ? entry.alk : false;
                for (var pi = 0; pi < pb.params.length; pi++) {
                    if (pb.params[pi].realIndex === parseInt(idx)) {
                        var p = pb.params[pi];
                        p.lk = !!savedLk;
                        p.alk = !!savedAlk;
                        p.v = val;
                        if (p.hostId !== undefined) batch.push({ p: p.hostId, i: p.realIndex, v: p.v });
                        break;
                    }
                }
            }
            if (batch.length > 0) {
                var batchFn = window.__juceGetNativeFunction('applyParamBatch');
                if (batchFn) batchFn(JSON.stringify(batch));
            }
            pushMultiParamUndo(oldVals);
            renderAllPlugins();
            closePresetBrowser();
            // Visual confirmation: flash the plugin card + toast
            showToast('Preset loaded: ' + presetName, 'success', 2500);
            var card = document.querySelector('.pcard[data-plugid="' + pb.id + '"]');
            if (card) { card.classList.remove('preset-flash'); void card.offsetWidth; card.classList.add('preset-flash'); }
        } catch (e) {
            console.log('Preset parse error:', e);
            showToast('Failed to load preset: ' + e.message, 'error', 4000);
        }
    });
}
function loadFactoryPresetInPlace(item) {
    var pb = null;
    for (var i = 0; i < pluginBlocks.length; i++) {
        if (pluginBlocks[i].id === presetPluginId) { pb = pluginBlocks[i]; break; }
    }
    if (!pb) return;
    if (!(window.__JUCE__ && window.__JUCE__.backend)) return;
    var loadFn = window.__juceGetNativeFunction('loadFactoryPreset');
    loadFn(item.hostId, item.factoryIndex, item.filePath || '').then(function (paramArr) {
        if (!paramArr || !paramArr.length) return;
        // Capture old values for undo
        var oldVals = [];
        pb.params.forEach(function (p) { oldVals.push({ id: p.id, val: p.v }); });
        // Build index→value map
        var valMap = {};
        paramArr.forEach(function (p) { valMap[p.index] = p.value; });
        // Apply to JS param state
        pb.params.forEach(function (p) {
            if (valMap[p.realIndex] !== undefined) {
                p.v = valMap[p.realIndex];
            }
        });
        pushMultiParamUndo(oldVals);
        renderAllPlugins();
        closePresetBrowser();
        showToast('Factory preset loaded: ' + item.name, 'success', 2500);
        var card = document.querySelector('.pcard[data-plugid="' + pb.id + '"]');
        if (card) { card.classList.remove('preset-flash'); void card.offsetWidth; card.classList.add('preset-flash'); }
    });
}
function deletePreset(presetName) {
    var pName = getPresetPluginName(presetPluginId);
    var mfr = getPresetPluginManufacturer(presetPluginId);
    var fn = window.__juceGetNativeFunction('deletePluginPreset');
    fn(mfr, pName, presetName).then(function () {
        refreshPresetList();
    });
}
document.getElementById('presetModalClose').onclick = closePresetBrowser;
document.getElementById('presetModal').onclick = function (e) {
    if (e.target === this) closePresetBrowser();
};
document.getElementById('presetSaveBtn').onclick = function () {
    savePresetFromInput();
    // Flash save button green
    var btn = document.getElementById('presetSaveBtn');
    btn.textContent = '\u2713 Saved';
    btn.style.background = '#4a8';
    setTimeout(function () { btn.textContent = 'Save'; btn.style.background = ''; }, 1200);
};
document.getElementById('presetNameInput').onkeydown = function (e) {
    if (e.key === 'Enter') savePresetFromInput();
};
// Type toggle wiring
document.querySelectorAll('.preset-type-btn').forEach(function (btn) {
    btn.onclick = function () {
        presetSaveType = btn.dataset.savetype;
        document.querySelectorAll('.preset-type-btn').forEach(function (b) { b.classList.toggle('on', b === btn); });
    };
});
// Search wiring
var presetSearchText = '';
document.getElementById('presetSearch').oninput = function () {
    presetSearchText = this.value.toLowerCase();
    var body = document.getElementById('presetBody');
    if (body._allItems) renderPresetItems(body._allItems);
};
// Filter tab wiring
document.querySelectorAll('#presetModal .preset-filter').forEach(function (btn) {
    btn.onclick = function () {
        presetFilterType = btn.dataset.filter;
        document.querySelectorAll('#presetModal .preset-filter').forEach(function (b) { b.classList.toggle('on', b === btn); });
        var body = document.getElementById('presetBody');
        if (body._allItems) renderPresetItems(body._allItems);
    };
});

// Plugin context menu wiring — Save as Preset / Save as Snapshot
function syncTypeToggle(type) {
    document.querySelectorAll('.preset-type-btn').forEach(function (b) {
        b.classList.toggle('on', b.dataset.savetype === type);
    });
}
document.getElementById('pcSavePreset').onclick = function () {
    presetSaveType = 'preset';
    syncTypeToggle('preset');
    openPresetBrowser(plugCtxPluginId, 'preset');
};
document.getElementById('pcSaveSnapshot').onclick = function () {
    presetSaveType = 'snapshot';
    syncTypeToggle('snapshot');
    openPresetBrowser(plugCtxPluginId, 'snapshot');
};
document.getElementById('pcLoadState').onclick = function () {
    openPresetBrowser(plugCtxPluginId, 'preset');
};

// ============================================================
// SNAPSHOT LIBRARY (for morph pad — loads presets/snapshots from any plugin)
// ============================================================
var snapLibBlockId = null;   // which morph pad block requested the library
var snapLibFilter = 'all';
var snapLibSearch = '';
var snapLibAllEntries = [];

function openSnapshotLibrary(blockId) {
    snapLibBlockId = blockId;
    snapLibFilter = 'all';
    snapLibSearch = '';
    document.getElementById('snapLibSearch').value = '';
    document.getElementById('snapLibModal').classList.add('vis');
    // Reset filter tabs
    document.querySelectorAll('#snapLibModal [data-slfilter]').forEach(function (btn) {
        btn.classList.toggle('on', btn.dataset.slfilter === 'all');
    });
    refreshSnapshotLibrary();
}

function closeSnapshotLibrary() {
    document.getElementById('snapLibModal').classList.remove('vis');
    snapLibBlockId = null;
    if (typeof morphLaneLibTarget !== 'undefined') morphLaneLibTarget = null;
}

function refreshSnapshotLibrary() {
    var body = document.getElementById('snapLibBody');
    var info = document.getElementById('snapLibInfo');
    body.innerHTML = '<div class="preset-empty">Loading...</div>';
    snapLibAllEntries = [];
    if (!(window.__JUCE__ && window.__JUCE__.backend)) {
        body.innerHTML = '<div class="preset-empty">No backend connected</div>';
        info.textContent = '0 items';
        return;
    }
    // Determine which plugins to show presets for:
    // If opened from a morph lane, only show plugins whose params are in that lane.
    // Otherwise (morph pad), show all loaded plugins.
    var relevantPlugins = pluginBlocks;
    var laneTarget = (typeof morphLaneLibTarget !== 'undefined' && morphLaneLibTarget) ? morphLaneLibTarget : null;
    if (laneTarget) {
        var b = findBlock(laneTarget.blockId);
        var lane = (b && b.lanes) ? b.lanes[laneTarget.laneIdx] : null;
        if (lane && lane.pids && lane.pids.length > 0) {
            // Collect hostIds of plugins that have params in this lane
            var laneHostIds = {};
            lane.pids.forEach(function (pid) {
                var p = PMap[pid];
                if (p && p.hostId !== undefined) laneHostIds[p.hostId] = true;
            });
            relevantPlugins = pluginBlocks.filter(function (pb) {
                return laneHostIds[pb.id] || laneHostIds[pb.hostId];
            });
        }
        // Also check block-level targets for broader context
        if (relevantPlugins.length === 0 && b && b.targets && b.targets.size > 0) {
            var blockHostIds = {};
            b.targets.forEach(function (pid) {
                var p = PMap[pid];
                if (p && p.hostId !== undefined) blockHostIds[p.hostId] = true;
            });
            relevantPlugins = pluginBlocks.filter(function (pb) {
                return blockHostIds[pb.id] || blockHostIds[pb.hostId];
            });
        }
        // Fallback: if still empty, show all
        if (relevantPlugins.length === 0) relevantPlugins = pluginBlocks;
    }
    // Each plugin gets 2 parallel fetches: user presets + factory presets
    var pending = relevantPlugins.length * 2;
    if (relevantPlugins.length === 0) {
        body.innerHTML = '<div class="preset-empty">No plugins loaded</div>';
        info.textContent = '0 items';
        return;
    }
    var checkDone = function () { if (pending === 0) renderSnapLibItems(); };
    var getPresetsFn = window.__juceGetNativeFunction('getPluginPresets');
    var loadPresetFn = window.__juceGetNativeFunction('loadPluginPreset');
    var getFactoryFn = window.__juceGetNativeFunction('getFactoryPresets');
    relevantPlugins.forEach(function (pb) {
        // ── User presets/snapshots ──
        getPresetsFn(pb.manufacturer || '', pb.name).then(function (names) {
            if (!names || !names.length) { pending--; checkDone(); return; }
            var subPending = names.length;
            names.forEach(function (n) {
                loadPresetFn(pb.manufacturer || '', pb.name, n).then(function (jsonStr) {
                    var type = 'preset';
                    if (jsonStr) {
                        try { var d = JSON.parse(jsonStr); if (d.type) type = d.type; } catch (e) { }
                    }
                    snapLibAllEntries.push({
                        name: n,
                        type: type,
                        pluginName: pb.name,
                        manufacturer: pb.manufacturer || '',
                        pluginId: pb.id,
                        hostId: pb.hostId
                    });
                    subPending--;
                    if (subPending === 0) { pending--; checkDone(); }
                }).catch(function () {
                    snapLibAllEntries.push({ name: n, type: 'preset', pluginName: pb.name, manufacturer: pb.manufacturer || '', pluginId: pb.id, hostId: pb.hostId });
                    subPending--;
                    if (subPending === 0) { pending--; checkDone(); }
                });
            });
        }).catch(function () {
            pending--;
            checkDone();
        });
        // ── Factory presets (from plugin programs) ──
        if (getFactoryFn) {
            getFactoryFn(pb.hostId !== undefined ? pb.hostId : pb.id).then(function (presets) {
                if (presets && presets.length) {
                    presets.forEach(function (fp) {
                        snapLibAllEntries.push({
                            name: fp.name,
                            type: 'factory',
                            pluginName: pb.name,
                            manufacturer: pb.manufacturer || '',
                            pluginId: pb.id,
                            hostId: pb.hostId,
                            factoryIndex: fp.index,
                            filePath: fp.filePath || ''
                        });
                    });
                }
                pending--;
                checkDone();
            }).catch(function () {
                pending--;
                checkDone();
            });
        } else {
            pending--;
            checkDone();
        }
    });
}

function renderSnapLibItems() {
    var body = document.getElementById('snapLibBody');
    var info = document.getElementById('snapLibInfo');
    var filtered = snapLibAllEntries;
    // Type filter
    if (snapLibFilter !== 'all') {
        filtered = filtered.filter(function (it) { return it.type === snapLibFilter; });
    }
    // Search filter
    if (snapLibSearch) {
        var q = snapLibSearch.toLowerCase();
        filtered = filtered.filter(function (it) {
            return it.name.toLowerCase().indexOf(q) >= 0 ||
                it.pluginName.toLowerCase().indexOf(q) >= 0;
        });
    }
    var sorted = filtered.slice().sort(function (a, b) {
        if (a.pluginName !== b.pluginName) return a.pluginName.localeCompare(b.pluginName);
        return a.name.localeCompare(b.name);
    });
    info.textContent = sorted.length + ' item' + (sorted.length !== 1 ? 's' : '');
    if (!sorted.length) {
        body.innerHTML = '<div class="preset-empty">No matching items</div>';
        return;
    }
    var h = '';
    sorted.forEach(function (it, idx) {
        var badgeClass = it.type === 'snapshot' ? 'type-snapshot' : it.type === 'factory' ? 'type-factory' : 'type-preset';
        h += '<div class="preset-row" data-sli="' + idx + '">';
        h += '<span class="preset-type-badge ' + badgeClass + '">' + it.type + '</span>';
        h += '<div class="plug-info"><div class="preset-name">' + escHtml(it.name) + '</div>';
        h += '<div class="preset-sub">' + escHtml(it.pluginName) + '</div></div>';
        h += '</div>';
    });
    body.innerHTML = h;
    body.querySelectorAll('.preset-row').forEach(function (row) {
        row.onclick = function () {
            var idx = parseInt(row.dataset.sli);
            var entry = sorted[idx];
            if (!entry) return;
            loadSnapshotFromLibrary(entry);
        };
    });
}

// Helper: apply a param-index→value map as a snapshot (used by factory presets)
function _applySnapshotFromParamMap(entry, paramMap, laneTarget) {
    if (laneTarget) {
        // ── MORPH LANE ──
        var b = findBlock(laneTarget.blockId);
        var lane = (b && b.lanes) ? b.lanes[laneTarget.laneIdx] : null;
        if (!b || !lane || !lane.morphMode) { closeSnapshotLibrary(); morphLaneLibTarget = null; return; }
        if (!lane.morphSnapshots) lane.morphSnapshots = [];
        // Only include values for params assigned to this lane
        var lanePidSet = new Set(lane.pids);
        var vals = {};
        lane.pids.forEach(function (pid) {
            var p = PMap[pid];
            if (!p || p.lk) return;
            vals[pid] = (paramMap[p.realIndex] !== undefined) ? paramMap[p.realIndex] : p.v;
        });
        var snap = {
            position: 0, hold: 0.5, curve: 0,
            name: entry.name, source: entry.pluginName + ' (factory)',
            values: vals
        };
        lane.morphSnapshots.push(snap);
        if (lane.morphSnapshots.length > 1) {
            for (var si = 0; si < lane.morphSnapshots.length; si++)
                lane.morphSnapshots[si].position = si / (lane.morphSnapshots.length - 1);
        } else {
            lane.morphSnapshots[0].position = 0;
        }
        lane._selectedSnap = lane.morphSnapshots.length - 1;
        renderSingleBlock(laneTarget.blockId);
        syncBlocksToHost();
        closeSnapshotLibrary();
        morphLaneLibTarget = null;
    } else {
        // ── MORPH PAD ──
        var b = findBlock(snapLibBlockId);
        if (!b || b.mode !== 'morph_pad') return;
        if (!b.snapshots) b.snapshots = [];
        if (b.snapshots.length >= 12) { closeSnapshotLibrary(); return; }
        var vals = {};
        b.targets.forEach(function (pid) {
            var p = PMap[pid];
            if (!p) return;
            if (p.hostId === entry.hostId || p.hostId === entry.pluginId) {
                vals[pid] = (paramMap[p.realIndex] !== undefined) ? paramMap[p.realIndex] : p.v;
            } else {
                vals[pid] = p.v;
            }
        });
        var spos = getSnapSectorPos(b.snapshots.length);
        b.snapshots.push({
            x: spos.x, y: spos.y,
            values: vals,
            name: entry.name,
            source: entry.pluginName + ' (factory)'
        });
        renderSingleBlock(snapLibBlockId);
        syncBlocksToHost();
        var pad = document.querySelector('.morph-pad[data-b="' + snapLibBlockId + '"]');
        if (pad) { pad.classList.remove('snap-flash'); void pad.offsetWidth; pad.classList.add('snap-flash'); }
        var chips = document.querySelectorAll('.snap-chip[data-b="' + snapLibBlockId + '"]');
        if (chips.length) { var last = chips[chips.length - 1]; last.classList.add('just-added'); setTimeout(function () { last.classList.remove('just-added'); }, 600); }
        closeSnapshotLibrary();
    }
}

function loadSnapshotFromLibrary(entry) {
    // Load the preset data and create a snapshot — supports both morph pad and morph lanes
    if (!(window.__JUCE__ && window.__JUCE__.backend)) return;

    // Check if targeting a morph lane
    var laneTarget = (typeof morphLaneLibTarget !== 'undefined' && morphLaneLibTarget) ? morphLaneLibTarget : null;

    // ── FACTORY PRESET PATH ──
    if (entry.type === 'factory' && entry.factoryIndex !== undefined) {
        var loadFactoryFn = window.__juceGetNativeFunction('loadFactoryPreset');
        loadFactoryFn(entry.hostId !== undefined ? entry.hostId : entry.pluginId, entry.factoryIndex, entry.filePath || '').then(function (paramArr) {
            if (!paramArr || !paramArr.length) return;
            // Build param index→value map from C++ response
            var paramMap = {};
            paramArr.forEach(function (p) { paramMap[p.index] = p.value; });
            _applySnapshotFromParamMap(entry, paramMap, laneTarget);
        });
        return;
    }

    // ── USER PRESET / SNAPSHOT PATH ──
    if (laneTarget) {
        // ── MORPH LANE TARGET ──
        var b = findBlock(laneTarget.blockId);
        var lane = (b && b.lanes) ? b.lanes[laneTarget.laneIdx] : null;
        if (!b || !lane || !lane.morphMode) { closeSnapshotLibrary(); morphLaneLibTarget = null; return; }
        if (!lane.morphSnapshots) lane.morphSnapshots = [];

        var loadFn = window.__juceGetNativeFunction('loadPluginPreset');
        loadFn(entry.manufacturer || '', entry.pluginName, entry.name).then(function (jsonStr) {
            if (!jsonStr) return;
            try {
                var data = JSON.parse(jsonStr);
                if (!data.params) return;
                var vals = {};
                // Only include values for params assigned to this lane
                lane.pids.forEach(function (pid) {
                    var p = PMap[pid];
                    if (!p || p.lk) return;
                    var savedParam = data.params[p.realIndex];
                    if (savedParam !== undefined) {
                        vals[pid] = (typeof savedParam === 'object') ? savedParam.value : savedParam;
                    } else {
                        vals[pid] = p.v;
                    }
                });
                var snap = {
                    position: 0,
                    hold: 0.5,
                    curve: 0,
                    name: entry.name,
                    source: entry.pluginName,
                    values: vals
                };
                lane.morphSnapshots.push(snap);
                // Re-distribute evenly
                if (lane.morphSnapshots.length > 1) {
                    for (var si = 0; si < lane.morphSnapshots.length; si++)
                        lane.morphSnapshots[si].position = si / (lane.morphSnapshots.length - 1);
                } else {
                    lane.morphSnapshots[0].position = 0;
                }
                lane._selectedSnap = lane.morphSnapshots.length - 1;
                renderSingleBlock(laneTarget.blockId);
                syncBlocksToHost();
                closeSnapshotLibrary();
            } catch (e) { console.log('Snapshot load error:', e); }
            morphLaneLibTarget = null;
        });
    } else {
        // ── MORPH PAD TARGET (original) ──
        var b = findBlock(snapLibBlockId);
        if (!b || b.mode !== 'morph_pad') return;
        if (!b.snapshots) b.snapshots = [];
        if (b.snapshots.length >= 12) { closeSnapshotLibrary(); return; }

        var loadFn = window.__juceGetNativeFunction('loadPluginPreset');
        loadFn(entry.manufacturer || '', entry.pluginName, entry.name).then(function (jsonStr) {
            if (!jsonStr) return;
            try {
                var data = JSON.parse(jsonStr);
                if (!data.params) return;
                var vals = {};
                b.targets.forEach(function (pid) {
                    var p = PMap[pid];
                    if (!p) return;
                    if (p.hostId === entry.hostId || p.hostId === entry.pluginId) {
                        var savedParam = data.params[p.realIndex];
                        if (savedParam !== undefined) {
                            vals[pid] = (typeof savedParam === 'object') ? savedParam.value : savedParam;
                        } else {
                            vals[pid] = p.v;
                        }
                    } else {
                        vals[pid] = p.v;
                    }
                });
                var spos = getSnapSectorPos(b.snapshots.length);
                b.snapshots.push({
                    x: spos.x, y: spos.y,
                    values: vals,
                    name: entry.name,
                    source: entry.pluginName
                });
                renderSingleBlock(snapLibBlockId);
                syncBlocksToHost();
                var pad = document.querySelector('.morph-pad[data-b="' + snapLibBlockId + '"]');
                if (pad) { pad.classList.remove('snap-flash'); void pad.offsetWidth; pad.classList.add('snap-flash'); }
                var chips = document.querySelectorAll('.snap-chip[data-b="' + snapLibBlockId + '"]');
                if (chips.length) { var last = chips[chips.length - 1]; last.classList.add('just-added'); setTimeout(function () { last.classList.remove('just-added'); }, 600); }
                closeSnapshotLibrary();
            } catch (e) { console.log('Snapshot load error:', e); }
        });
    }
}

// Snapshot Library modal wiring
document.getElementById('snapLibClose').onclick = closeSnapshotLibrary;
document.getElementById('snapLibModal').onclick = function (e) {
    if (e.target === this) closeSnapshotLibrary();
};
document.getElementById('snapLibSearch').oninput = function () {
    snapLibSearch = this.value;
    renderSnapLibItems();
};
document.querySelectorAll('#snapLibModal [data-slfilter]').forEach(function (btn) {
    btn.onclick = function () {
        snapLibFilter = btn.dataset.slfilter;
        document.querySelectorAll('#snapLibModal [data-slfilter]').forEach(function (b) { b.classList.toggle('on', b === btn); });
        renderSnapLibItems();
    };
});

// ── Global Preset System ──
var currentGlobalPresetName = null;
function updateGpNameDisplay() {
    document.getElementById('gpName').textContent = currentGlobalPresetName || '\u2014';
}
function openGlobalPresetBrowser() {
    document.getElementById('gpNameInput').value = currentGlobalPresetName || '';
    var gpSearchEl = document.getElementById('gpSearch');
    if (gpSearchEl) gpSearchEl.value = '';
    document.getElementById('globalPresetModal').classList.add('vis');
    refreshGlobalPresetList();
}
var gpLoadInProgress = false;
var _gpPeekCache = {}; // Lazy cache: presetName → parsed JSON data
function closeGlobalPresetBrowser() {
    if (gpLoadInProgress) return; // Prevent closing while plugins are loading
    // Clean up any floating peek popup
    var peek = document.getElementById('gpPeekPopup');
    if (peek) peek.remove();
    document.getElementById('globalPresetModal').classList.remove('vis');
}

function refreshGlobalPresetList() {
    _gpPeekCache = {}; // Clear peek cache on refresh (presets may have changed)
    var body = document.getElementById('gpBody');
    var info = document.getElementById('gpInfo');
    body.innerHTML = '<div class="preset-empty">Loading...</div>';
    if (!(window.__JUCE__ && window.__JUCE__.backend)) {
        body.innerHTML = '<div class="preset-empty">No backend connected</div>';
        info.textContent = '0 presets';
        return;
    }
    var fn = window.__juceGetNativeFunction('getGlobalPresets');
    fn().then(function (entries) {
        if (!entries || !entries.length) {
            body.innerHTML = '<div class="preset-empty">No saved global presets</div>';
            info.textContent = '0 presets';
            body._gpNames = [];
            return;
        }
        // entries = [{ name, plugins: ["PluginA", ...] }, ...]
        var sorted = entries.slice().sort(function (a, b) {
            var na = (typeof a === 'string') ? a : a.name;
            var nb = (typeof b === 'string') ? b : b.name;
            return na.localeCompare(nb);
        });
        body._gpNames = sorted.map(function (e) { return (typeof e === 'string') ? e : e.name; });
        // Build installed-names lookup once (for missing plugin detection in rows)
        var hasScanCache = (typeof scannedPlugins !== 'undefined' && scannedPlugins.length > 0);
        var installedNames = {};
        if (hasScanCache) {
            scannedPlugins.forEach(function (sp) {
                installedNames[sp.name.toLowerCase()] = true;
            });
        }
        // Apply search filter
        var gpSearchText = document.getElementById('gpSearch').value.toLowerCase();
        var filtered = sorted;
        if (gpSearchText) {
            filtered = sorted.filter(function (e) {
                var n = (typeof e === 'string') ? e : e.name;
                return n.toLowerCase().indexOf(gpSearchText) >= 0;
            });
        }
        info.textContent = filtered.length + ' of ' + sorted.length + ' preset' + (sorted.length !== 1 ? 's' : '');
        if (!filtered.length) {
            body.innerHTML = '<div class="preset-empty">No matches for "' + escHtml(gpSearchText) + '"</div>';
            return;
        }
        var h = '';
        filtered.forEach(function (entry) {
            var n = (typeof entry === 'string') ? entry : entry.name;
            var pluginNames = (typeof entry === 'object' && entry.plugins) ? entry.plugins : [];
            // Compute badge HTML inline — no IPC needed
            var badgeHtml = '';
            if (pluginNames.length > 0) {
                var missing = 0;
                if (hasScanCache) {
                    pluginNames.forEach(function (pn) {
                        if (pn && !installedNames[('' + pn).toLowerCase()]) missing++;
                    });
                }
                badgeHtml = '<span class="gp-row-count">' + pluginNames.length + 'p</span>';
                if (missing > 0) badgeHtml += '<span class="gp-row-missing">' + missing + ' missing</span>';
            }
            h += '<div class="preset-row' + (n === currentGlobalPresetName ? ' active' : '') + '" data-gpname="' + escHtml(n) + '">';
            h += '<span class="preset-name">' + escHtml(n) + '</span>';
            h += '<span class="gp-row-badges" data-gpbadges="' + escHtml(n) + '">' + badgeHtml + '</span>';
            h += '<button class="preset-reveal" data-gppeek="' + escHtml(n) + '" title="Preview plugin chain"><svg viewBox="0 0 16 16"><path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8s-2.5 4.5-6.5 4.5S1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/></svg></button>';
            h += '<button class="preset-reveal" data-gpreveal="' + escHtml(n) + '" title="Show in file explorer"><svg viewBox="0 0 16 16"><path d="M2 4.5C2 3.67 2.67 3 3.5 3H6l1.5 1.5H12.5C13.33 4.5 14 5.17 14 6v5.5c0 .83-.67 1.5-1.5 1.5h-9C2.67 13 2 12.33 2 11.5z"/><path d="M10 9.5l2-2m0 0l-1.5 0m1.5 0l0 1.5"/></svg></button>';
            h += '<button class="preset-del" data-gpdel="' + escHtml(n) + '">&times;</button>';
            h += '</div>';
        });
        body.innerHTML = h;
        // ── Single delegated click handler — no per-element onclick, no stopPropagation ──
        body.onclick = function (e) {
            var node = e.target;
            var foundBtn = null;
            var foundRow = null;
            while (node && node !== body) {
                if (!foundBtn && node.tagName === 'BUTTON') foundBtn = node;
                if (!foundRow && node.classList && node.classList.contains('preset-row')) foundRow = node;
                node = node.parentNode;
            }
            if (foundBtn) {
                if (foundBtn.dataset.gppeek) {
                    _gpHandlePeek(foundBtn);
                } else if (foundBtn.dataset.gpreveal) {
                    var revealFn = window.__juceGetNativeFunction('revealPresetFile');
                    if (revealFn) revealFn('chain', foundBtn.dataset.gpreveal);
                } else if (foundBtn.dataset.gpdel) {
                    _gpHandleDelete(foundBtn);
                }
                return;
            }
            if (foundRow) {
                loadGlobalPreset(foundRow.dataset.gpname);
            }
        };
    });
}
// ── Peek popup handler (extracted to avoid nesting) ──
function _gpHandlePeek(btn) {
    var peekName = btn.dataset.gppeek;
    // Toggle: if already open for this preset, close and return
    var old = document.getElementById('gpPeekPopup');
    if (old) {
        var wasForSame = old._peekName === peekName;
        old.remove();
        if (wasForSame) return;
    }
    // Position below button
    var rect = btn.getBoundingClientRect();
    var popup = document.createElement('div');
    popup.id = 'gpPeekPopup';
    popup.className = 'gp-peek-popup';
    popup._peekName = peekName;
    popup.style.top = (rect.bottom + 4) + 'px';
    popup.style.left = Math.max(8, rect.left - 120) + 'px';
    document.body.appendChild(popup);
    // Dismiss on click outside
    setTimeout(function () {
        document.addEventListener('click', function dismiss(ev) {
            if (!popup.contains(ev.target) && !btn.contains(ev.target)) {
                popup.remove();
                document.removeEventListener('click', dismiss);
            }
        });
    }, 50);
    // Render from cache or load
    if (_gpPeekCache[peekName]) {
        _gpRenderPeekContent(popup, peekName, _gpPeekCache[peekName]);
    } else {
        popup.innerHTML = '<div class="gp-peek-loading">Loading...</div>';
        var loadFn = window.__juceGetNativeFunction('loadGlobalPreset');
        if (!loadFn) return;
        loadFn(peekName).then(function (jsonStr) {
            if (!jsonStr) { popup.innerHTML = '<div class="gp-peek-empty">Empty preset</div>'; return; }
            try {
                var data = JSON.parse(jsonStr);
                _gpPeekCache[peekName] = data;
                _gpRenderPeekContent(popup, peekName, data);
            } catch (err) {
                popup.innerHTML = '<div class="gp-peek-empty">Failed to parse preset</div>';
            }
        });
    }
}
// ── Render peek popup content ──
function _gpRenderPeekContent(popup, peekName, data) {
    var h = '<div class="gp-peek-title">' + escHtml(peekName) + '</div>';
    if (data.routingMode !== undefined) {
        var rLabel = data.routingMode === 2 ? 'WrongEQ' : (data.routingMode === 1 ? 'Parallel' : 'Sequential');
        h += '<div class="gp-peek-meta">' + rLabel + ' routing</div>';
    }
    var realPlugins = (data.plugins || []).filter(function (p) { return p.path !== '__virtual__' && p.name !== '__virtual__'; });
    if (realPlugins.length) {
        var hasScanCache = (typeof scannedPlugins !== 'undefined' && scannedPlugins.length > 0);
        var installedNames = {};
        if (hasScanCache) {
            scannedPlugins.forEach(function (sp) {
                installedNames[sp.name.toLowerCase()] = true;
            });
        }
        var missingCount = 0;
        h += '<div class="gp-peek-list">';
        realPlugins.forEach(function (p, idx) {
            var pName = p.name || p.path.split(/[\\/]/).pop().replace(/\.vst3$/i, '') || ('Plugin ' + (idx + 1));
            var isMissing = hasScanCache && !installedNames[pName.toLowerCase()];
            var lockedCount = 0;
            if (p.params) { for (var k in p.params) { if (p.params[k].locked) lockedCount++; } }
            h += '<div class="gp-peek-plug' + (isMissing ? ' missing' : '') + '">';
            h += '<span class="gp-peek-idx">' + (idx + 1) + '</span>';
            h += '<span class="gp-peek-name">' + escHtml(pName) + '</span>';
            if (isMissing) { h += '<span class="gp-peek-badge missing">MISSING</span>'; missingCount++; }
            if (p.bypassed) h += '<span class="gp-peek-badge bypass">BYP</span>';
            if (lockedCount > 0) h += '<span class="gp-peek-badge locked">' + lockedCount + ' locked</span>';
            h += '</div>';
        });
        h += '</div>';
        var summary = realPlugins.length + ' plugin' + (realPlugins.length !== 1 ? 's' : '');
        if (missingCount > 0) summary += ' · ' + missingCount + ' missing';
        h += '<div class="gp-peek-meta">' + summary + '</div>';
    } else {
        h += '<div class="gp-peek-empty">No plugins in preset</div>';
    }
    popup.innerHTML = h;
}
// ── Delete handler with confirmation ──
function _gpHandleDelete(btn) {
    if (btn._confirming) {
        if (btn._confirmTimer) clearTimeout(btn._confirmTimer);
        btn._confirming = false;
        deleteGlobalPreset(btn.dataset.gpdel);
    } else {
        btn._confirming = true;
        btn.textContent = 'Delete?';
        btn.style.color = '#e55';
        btn.style.borderColor = '#e55';
        btn._confirmTimer = setTimeout(function () {
            btn._confirming = false;
            btn.innerHTML = '&times;';
            btn.style.color = '';
            btn.style.borderColor = '';
        }, 2000);
    }
}
function buildGlobalPresetData() {
    return {
        version: 1,
        routingMode: routingMode,
        pluginOrder: pluginBlocks.filter(function (pb) { return !pb.isVirtual; }).map(function (pb) { return pb.id; }),
        plugins: pluginBlocks.filter(function (pb) { return !pb.isVirtual; }).map(function (pb) {
            var paramData = {};
            pb.params.forEach(function (p) {
                paramData[p.realIndex] = { name: p.name, value: p.v, locked: p.lk || false };
            });
            return { name: pb.name, path: pb.path || '', manufacturer: pb.manufacturer || '', hostId: pb.hostId, params: paramData, bypassed: pb.bypassed || false, expanded: pb.expanded, busId: pb.busId || 0 };
        }),
        blocks: blocks.map(function (b) {
            return {
                id: b.id, mode: b.mode, colorIdx: b.colorIdx,
                targets: Array.from(b.targets), targetBases: b.targetBases || {}, targetRanges: b.targetRanges || {}, targetRangeBases: b.targetRangeBases || {},
                trigger: b.trigger, beatDiv: b.beatDiv,
                midiMode: b.midiMode, midiNote: b.midiNote, midiCC: b.midiCC, midiCh: b.midiCh,
                velScale: b.velScale, threshold: b.threshold, audioSrc: b.audioSrc,
                rMin: b.rMin, rMax: b.rMax, rangeMode: (b.mode === 'randomize') ? b.rangeMode : 'relative', polarity: b.polarity || 'bipolar',
                quantize: b.quantize, qSteps: b.qSteps,
                movement: b.movement, glideMs: b.glideMs,
                envAtk: b.envAtk, envRel: b.envRel, envSens: b.envSens, envInvert: b.envInvert,
                envFilterMode: b.envFilterMode || 'flat', envFilterFreq: b.envFilterFreq != null ? b.envFilterFreq : 50, envFilterBW: b.envFilterBW != null ? b.envFilterBW : 5,
                loopMode: b.loopMode, sampleSpeed: b.sampleSpeed, sampleReverse: b.sampleReverse, jumpMode: b.jumpMode,
                sampleName: b.sampleName || '', sampleWaveform: b.sampleWaveform || null,
                // Morph Pad fields
                snapshots: (b.snapshots || []).map(function (s) { return { x: s.x, y: s.y, name: s.name || '', source: s.source || '', values: s.values || {} }; }),
                playheadX: b.playheadX != null ? b.playheadX : 0.5, playheadY: b.playheadY != null ? b.playheadY : 0.5,
                morphMode: b.morphMode || 'manual', exploreMode: b.exploreMode || 'wander',
                lfoShape: b.lfoShape || 'circle', lfoDepth: b.lfoDepth != null ? b.lfoDepth : 80, lfoRotation: b.lfoRotation != null ? b.lfoRotation : 0, morphSpeed: b.morphSpeed != null ? b.morphSpeed : 50,
                morphAction: b.morphAction || 'jump', stepOrder: b.stepOrder || 'cycle',
                morphSource: b.morphSource || 'midi', jitter: b.jitter != null ? b.jitter : 0,
                morphGlide: b.morphGlide != null ? b.morphGlide : 200,
                morphTempoSync: !!b.morphTempoSync, morphSyncDiv: b.morphSyncDiv || '1/4',
                snapRadius: b.snapRadius != null ? b.snapRadius : 100,
                shapeType: b.shapeType || 'circle', shapeTracking: b.shapeTracking || 'horizontal',
                shapeSize: b.shapeSize != null ? b.shapeSize : 80, shapeSpin: b.shapeSpin != null ? b.shapeSpin : 0,
                shapeSpeed: b.shapeSpeed != null ? b.shapeSpeed : 50, shapePhaseOffset: b.shapePhaseOffset || 0,
                shapeRange: b.shapeRange || 'relative', shapePolarity: b.shapePolarity || 'bipolar',
                shapeTempoSync: !!b.shapeTempoSync, shapeSyncDiv: b.shapeSyncDiv || '1/4', shapeTrigger: b.shapeTrigger || 'free',
                clockSource: b.clockSource || 'daw',
                laneTool: b.laneTool || 'draw', laneGrid: b.laneGrid || '1/8',
                lanes: (b.lanes || []).map(function (lane) {
                    return {
                        pids: lane.pids || (lane.pid ? [lane.pid] : []), color: lane.color || '', collapsed: !!lane.collapsed,
                        pts: (lane.pts || []).map(function (p) { return { x: p.x, y: p.y }; }),
                        loopLen: lane.loopLen || '1/1', steps: lane.steps != null ? lane.steps : 0, depth: lane.depth != null ? lane.depth : 100,
                        drift: lane.drift != null ? lane.drift : 0, driftRange: lane.driftRange != null ? lane.driftRange : 5, driftScale: lane.driftScale || '1/1', warp: lane.warp != null ? lane.warp : 0, interp: lane.interp || 'smooth',
                        playMode: lane.playMode || 'forward', freeSecs: lane.freeSecs != null ? lane.freeSecs : 4,
                        synced: lane.synced !== false, muted: !!lane.muted,
                        trigMode: lane.trigMode || 'loop', trigSource: lane.trigSource || 'manual',
                        trigMidiNote: lane.trigMidiNote != null ? lane.trigMidiNote : -1, trigMidiCh: lane.trigMidiCh || 0,
                        trigThreshold: lane.trigThreshold != null ? lane.trigThreshold : -12,
                        trigAudioSrc: lane.trigAudioSrc || 'main', trigRetrigger: lane.trigRetrigger !== false,
                        trigHold: !!lane.trigHold,
                        morphMode: !!lane.morphMode,
                        morphSnapshots: (lane.morphSnapshots || []).map(function (s) { return { position: s.position || 0, hold: s.hold != null ? s.hold : 0.5, curve: s.curve || 0, depth: s.depth != null ? s.depth : 1.0, drift: s.drift || 0, driftRange: s.driftRange != null ? s.driftRange : 5, driftScale: s.driftScale || '', warp: s.warp || 0, steps: s.steps || 0, name: s.name || '', source: s.source || '', values: s.values || {} }; }),
                        overlayLanes: lane._overlayLanes || []
                    };
                }),
                enabled: b.enabled !== false, expanded: b.expanded,
                linkSources: b.linkSources || [], linkMin: b.linkMin || {}, linkMax: b.linkMax || {}, linkBases: b.linkBases || {}, linkSmoothMs: b.linkSmoothMs || 0
            };
        }),
        bc: bc, actId: actId,
        internalBpm: internalBpm,
        autoLocate: autoLocate,
        busVolumes: busVolumes.slice(),
        busMutes: busMutes.slice(),
        busSolos: busSolos.slice(),
        wrongEq: {
            points: wrongEqPoints.map(function (p, idx) {
                var saveX = (typeof weqAnimRafId !== 'undefined' && weqAnimRafId && typeof weqAnimBaseX !== 'undefined' && weqAnimBaseX.length > idx) ? weqAnimBaseX[idx] : p.x;
                var saveY = (typeof weqAnimRafId !== 'undefined' && weqAnimRafId && typeof weqAnimBaseY !== 'undefined' && weqAnimBaseY.length > idx) ? weqAnimBaseY[idx] : p.y;
                return { x: saveX, y: saveY, uid: p.uid, pluginIds: p.pluginIds || [], seg: p.seg || null, solo: p.solo || false, mute: p.mute || false, q: p.q != null ? p.q : 0.707, type: p.type || 'Bell', drift: p.drift || 0, preEq: p.preEq !== false, stereoMode: p.stereoMode || 0, slope: p.slope || 1, modExclude: p.modExclude || 0 };
            }),
            interp: typeof weqGlobalInterp !== 'undefined' ? weqGlobalInterp : 'smooth',
            depth: typeof weqGlobalDepth !== 'undefined' ? weqGlobalDepth : 100,
            warp: typeof weqGlobalWarp !== 'undefined' ? weqGlobalWarp : 0,
            steps: typeof weqGlobalSteps !== 'undefined' ? weqGlobalSteps : 0,
            tilt: typeof weqGlobalTilt !== 'undefined' ? weqGlobalTilt : 0,

            preEq: typeof weqPreEq !== 'undefined' ? weqPreEq : true,
            bypass: typeof weqGlobalBypass !== 'undefined' ? weqGlobalBypass : false,
            animSpeed: typeof weqAnimSpeed !== 'undefined' ? weqAnimSpeed : 0,
            animDepth: typeof weqAnimDepth !== 'undefined' ? weqAnimDepth : 6,
            animShape: typeof weqAnimShape !== 'undefined' ? weqAnimShape : 'sine',
            animSpread: typeof weqAnimSpread !== 'undefined' ? weqAnimSpread : 0,
            drift: typeof weqDrift !== 'undefined' ? weqDrift : 0,
            driftRange: typeof weqDriftRange !== 'undefined' ? weqDriftRange : 5,
            driftScale: typeof weqDriftScale !== 'undefined' ? weqDriftScale : '1/1',
            driftContinuous: typeof weqDriftContinuous !== 'undefined' ? weqDriftContinuous : false,
            driftMode: typeof weqDriftMode !== 'undefined' ? weqDriftMode : 'independent',
            driftTexture: typeof weqDriftTexture !== 'undefined' ? weqDriftTexture : 'smooth',
            gainLoCut: typeof weqGainLoCut !== 'undefined' ? weqGainLoCut : 20,
            gainHiCut: typeof weqGainHiCut !== 'undefined' ? weqGainHiCut : 20000,
            driftLoCut: typeof weqDriftLoCut !== 'undefined' ? weqDriftLoCut : 20,
            driftHiCut: typeof weqDriftHiCut !== 'undefined' ? weqDriftHiCut : 20000,
            qModSpeed: typeof weqQModSpeed !== 'undefined' ? weqQModSpeed : 0,
            qModDepth: typeof weqQModDepth !== 'undefined' ? weqQModDepth : 50,
            qModShape: typeof weqQModShape !== 'undefined' ? weqQModShape : 'sine',
            qModSpread: typeof weqQModSpread !== 'undefined' ? weqQModSpread : 0,
            qLoCut: typeof weqQLoCut !== 'undefined' ? weqQLoCut : 20,
            qHiCut: typeof weqQHiCut !== 'undefined' ? weqQHiCut : 20000,

            dbRange: typeof weqDBRangeMax !== 'undefined' ? weqDBRangeMax : 24,
            splitMode: typeof weqSplitMode !== 'undefined' ? weqSplitMode : false,
            oversample: typeof weqOversample !== 'undefined' ? weqOversample : 1,
            unassignedMode: typeof weqUnassignedMode !== 'undefined' ? weqUnassignedMode : 0,
            eqPresetName: typeof _weqCurrentPreset !== 'undefined' ? _weqCurrentPreset : null,
            modEnabled: typeof weqModEnabled !== 'undefined' ? weqModEnabled : true
        }
    };
}
function saveGlobalPresetFromInput() {
    var nameInput = document.getElementById('gpNameInput');
    var name = nameInput.value.trim();
    if (!name) { nameInput.focus(); return; }
    var data = buildGlobalPresetData();
    var fn = window.__juceGetNativeFunction('saveGlobalPreset');
    fn(name, JSON.stringify(data)).then(function () {
        currentGlobalPresetName = name;
        updateGpNameDisplay();
        clearGpDirty();
        nameInput.value = '';
        refreshGlobalPresetList();
    });
}
function loadGlobalPreset(presetName) {
    if (!(window.__JUCE__ && window.__JUCE__.backend)) return;
    var fn = window.__juceGetNativeFunction('loadGlobalPreset');
    fn(presetName).then(function (jsonStr) {
        if (!jsonStr) return;
        try {
            var data = JSON.parse(jsonStr);
            applyGlobalPreset(data, presetName);
        } catch (e) { console.log('Global preset parse error:', e); }
    });
}
function applyGlobalPreset(data, presetName) {
    // Remove all current plugins
    var removeFn = (window.__JUCE__ && window.__JUCE__.backend) ? window.__juceGetNativeFunction('removePlugin') : null;
    pluginBlocks.forEach(function (pb) {
        if (removeFn && !pb.isVirtual) removeFn(pb.hostId !== undefined ? pb.hostId : pb.id);
        pb.params.forEach(function (p) { delete PMap[p.id]; });
    });
    pluginBlocks = [];
    blocks = [];
    bc = 0;
    actId = null;
    assignMode = null;

    // Clear old UI immediately so placeholders appear in a clean rack
    var plugScroll = document.getElementById('pluginScroll');
    if (plugScroll) plugScroll.innerHTML = '';
    // Show preset name immediately — instant feedback before plugins load
    currentGlobalPresetName = presetName;
    updateGpNameDisplay();
    closeGlobalPresetBrowser();

    // Restore logic blocks immediately from preset data (targets stored as raw strings,
    // validated against PMap later once plugins finish loading)
    if (data.blocks && data.blocks.length) {
        blocks = data.blocks.map(function (sb) {
            var tSet = new Set();
            if (sb.targets) sb.targets.forEach(function (t) { tSet.add(t); });
            return {
                id: sb.id, mode: sb.mode || 'randomize', targets: tSet,
                targetBases: sb.targetBases || {}, targetRanges: sb.targetRanges || {}, targetRangeBases: sb.targetRangeBases || {},
                colorIdx: sb.colorIdx || 0,
                trigger: sb.trigger || 'manual', beatDiv: sb.beatDiv || '1/4',
                midiMode: sb.midiMode || 'any_note', midiNote: sb.midiNote != null ? sb.midiNote : 60, midiCC: sb.midiCC != null ? sb.midiCC : 1, midiCh: sb.midiCh != null ? sb.midiCh : 0,
                velScale: sb.velScale || false, threshold: sb.threshold != null ? sb.threshold : -12, audioSrc: sb.audioSrc || 'main',
                rMin: sb.rMin || 0, rMax: sb.rMax !== undefined ? sb.rMax : 100,
                rangeMode: (sb.mode === 'randomize') ? (sb.rangeMode || 'absolute') : 'relative', polarity: sb.polarity || 'bipolar',
                quantize: sb.quantize || false, qSteps: sb.qSteps != null ? sb.qSteps : 12,
                movement: sb.movement || 'instant', glideMs: sb.glideMs != null ? sb.glideMs : 200,
                envAtk: sb.envAtk != null ? sb.envAtk : 10, envRel: sb.envRel != null ? sb.envRel : 100, envSens: sb.envSens != null ? sb.envSens : 50, envInvert: sb.envInvert || false,
                envFilterMode: sb.envFilterMode || 'flat', envFilterFreq: sb.envFilterFreq != null ? sb.envFilterFreq : 50, envFilterBW: sb.envFilterBW != null ? sb.envFilterBW : 5,
                loopMode: sb.loopMode || 'loop', sampleSpeed: sb.sampleSpeed != null ? sb.sampleSpeed : 1.0,
                sampleReverse: sb.sampleReverse || false, jumpMode: sb.jumpMode || 'restart',
                sampleName: sb.sampleName || '', sampleWaveform: sb.sampleWaveform || null,
                snapshots: (sb.snapshots || []).map(function (s) { return { x: s.x != null ? s.x : 0.5, y: s.y != null ? s.y : 0.5, name: s.name || '', source: s.source || '', values: s.values || {} }; }),
                playheadX: sb.playheadX != null ? sb.playheadX : 0.5, playheadY: sb.playheadY != null ? sb.playheadY : 0.5,
                morphMode: sb.morphMode || 'manual', exploreMode: (sb.exploreMode === 'lfo' ? 'shapes' : sb.exploreMode) || 'wander',
                lfoShape: sb.lfoShape || 'circle', lfoDepth: sb.lfoDepth != null ? sb.lfoDepth : 80, lfoRotation: sb.lfoRotation != null ? sb.lfoRotation : 0, morphSpeed: sb.morphSpeed != null ? sb.morphSpeed : 50,
                morphAction: sb.morphAction || 'jump', stepOrder: sb.stepOrder || 'cycle',
                morphSource: sb.morphSource || 'midi', jitter: sb.jitter != null ? sb.jitter : 0,
                morphGlide: sb.morphGlide != null ? sb.morphGlide : 200,
                morphTempoSync: !!sb.morphTempoSync, morphSyncDiv: sb.morphSyncDiv || '1/4',
                snapRadius: sb.snapRadius != null ? sb.snapRadius : 100,
                shapeType: sb.shapeType || 'circle', shapeTracking: sb.shapeTracking || 'horizontal',
                shapeSize: sb.shapeSize != null ? sb.shapeSize : 80, shapeSpin: sb.shapeSpin != null ? sb.shapeSpin : 0,
                shapeSpeed: sb.shapeSpeed != null ? sb.shapeSpeed : 50, shapePhaseOffset: sb.shapePhaseOffset || 0,
                shapeRange: sb.shapeRange || 'relative', shapePolarity: sb.shapePolarity || 'bipolar',
                shapeTempoSync: !!sb.shapeTempoSync, shapeSyncDiv: sb.shapeSyncDiv || '1/4', shapeTrigger: sb.shapeTrigger || 'free',
                clockSource: sb.clockSource || 'daw',
                laneTool: sb.laneTool || 'draw', laneGrid: sb.laneGrid || '1/8',
                lanes: (sb.lanes || []).map(function (lane) {
                    var lPids = lane.pids || (lane.pid ? [lane.pid] : []);
                    return {
                        pids: lPids, color: lane.color || '', collapsed: !!lane.collapsed,
                        pts: (lane.pts || []).map(function (p) { return { x: p.x, y: p.y }; }),
                        loopLen: lane.loopLen || '1/1', steps: lane.steps != null ? lane.steps : 0, depth: lane.depth != null ? lane.depth : 100,
                        drift: lane.drift != null ? lane.drift : 0, driftRange: lane.driftRange != null ? lane.driftRange : 5, driftScale: lane.driftScale || '1/1', warp: lane.warp != null ? lane.warp : 0, interp: lane.interp || 'smooth',
                        playMode: lane.playMode || 'forward', freeSecs: lane.freeSecs != null ? lane.freeSecs : 4,
                        synced: lane.synced !== false, muted: !!lane.muted,
                        trigMode: lane.trigMode || 'loop', trigSource: lane.trigSource || 'manual',
                        trigMidiNote: lane.trigMidiNote != null ? lane.trigMidiNote : -1, trigMidiCh: lane.trigMidiCh || 0,
                        trigThreshold: lane.trigThreshold != null ? lane.trigThreshold : -12,
                        trigAudioSrc: lane.trigAudioSrc || 'main', trigRetrigger: lane.trigRetrigger !== false,
                        trigHold: !!lane.trigHold,
                        morphMode: !!lane.morphMode,
                        morphSnapshots: (lane.morphSnapshots || []).map(function (s) { return { position: s.position || 0, hold: s.hold != null ? s.hold : 0.5, curve: s.curve || 0, depth: s.depth != null ? s.depth : 1.0, drift: s.drift || 0, driftRange: s.driftRange != null ? s.driftRange : 5, driftScale: s.driftScale || '', warp: s.warp || 0, steps: s.steps || 0, name: s.name || '', source: s.source || '', values: s.values || {} }; }),
                        _overlayLanes: lane.overlayLanes || []
                    };
                }),
                enabled: sb.enabled !== false, expanded: sb.expanded !== false,
                linkSources: sb.linkSources || (sb.linkSourcePluginId != null && sb.linkSourcePluginId >= 0 ? [{ pluginId: sb.linkSourcePluginId, paramIndex: sb.linkSourceParamIndex || -1, pluginName: sb.linkSourcePluginName || '', paramName: sb.linkSourceParamName || '' }] : []),
                linkMin: sb.linkMin || {}, linkMax: sb.linkMax || {}, linkBases: sb.linkBases || {}, linkSmoothMs: sb.linkSmoothMs || 0
            };
        });
        bc = data.bc || blocks.reduce(function (m, b) { return Math.max(m, b.id); }, 0);
        actId = data.actId || (blocks.length > 0 ? blocks[0].id : null);
    } else {
        addBlock('randomize');
    }
    renderBlocks();
    updCounts();

    if (!data.plugins || !data.plugins.length) {
        renderAllPlugins();
        return;
    }

    // Load plugins in parallel — each loadPlugin fires immediately.
    // Phase 1 (disk scan) runs on background threads and overlaps.
    // Phase 2 (COM instantiation) is serialized by JUCE's message thread automatically.
    var loadPluginFn = (window.__JUCE__ && window.__JUCE__.backend) ? window.__juceGetNativeFunction('loadPlugin') : null;
    var setBypassFn = (window.__JUCE__ && window.__JUCE__.backend) ? window.__juceGetNativeFunction('setPluginBypass') : null;
    var getStateFn = (window.__JUCE__ && window.__JUCE__.backend) ? window.__juceGetNativeFunction('getFullState') : null;

    // Filter out virtual blocks that may have been saved in older presets
    data.plugins = data.plugins.filter(function (p) { return p.path !== '__virtual__' && p.name !== '__virtual__'; });

    var pluginPaths = data.plugins.map(function (p) { return p.path; });
    var loadFailures = [];
    var loadedCount = 0;
    var totalCount = pluginPaths.length;
    gpLoadInProgress = true;

    // Set header loading state
    if (typeof setPluginLoading === 'function') setPluginLoading(true, 'preset');

    // Create placeholder cards for all plugins upfront (same visual as addPlugin)
    var placeholderIds = [];
    for (var pi = 0; pi < pluginPaths.length; pi++) {
        var phId = 'gp-loading-' + Date.now() + '-' + pi;
        var phName = pluginPaths[pi].split(/[\\/]/).pop().replace(/\.vst3$/i, '');
        placeholderIds.push(phId);
        appendPlaceholderCard(phId, phName);
    }

    function onPluginDone(idx, failed) {
        removePlaceholderCard(placeholderIds[idx]);
        if (failed) {
            loadFailures.push(pluginPaths[idx].split(/[\\/]/).pop().replace(/\.vst3$/i, ''));
        }
        loadedCount++;
        if (loadedCount >= totalCount) {
            onAllPluginsLoaded();
        }
    }

    function onAllPluginsLoaded() {
        gpLoadInProgress = false;

        // All plugins loaded — now fetch state and apply params
        if (getStateFn) {
            getStateFn().then(function (result) {
                if (result && result.plugins) {
                    // Rebuild pluginBlocks from hosted plugins
                    pluginBlocks = [];
                    PMap = {};
                    var gpBatch = [];
                    result.plugins.forEach(function (plug, idx) {
                        var savedPlug = data.plugins[idx] || {};
                        // Build name→saved param lookup for name-based fallback matching
                        var savedByName = {};
                        if (savedPlug.params) {
                            for (var si in savedPlug.params) {
                                var sp = savedPlug.params[si];
                                if (sp && typeof sp === 'object' && sp.name) {
                                    savedByName[sp.name.toLowerCase()] = sp;
                                }
                            }
                        }
                        var params = (plug.params || []).map(function (p) {
                            var fid = plug.id + ':' + p.index;
                            var savedParam = savedPlug.params ? savedPlug.params[p.index] : null;
                            // If index-matched param has a different name, try name-based fallback
                            if (savedParam && typeof savedParam === 'object' && savedParam.name
                                && savedParam.name.toLowerCase() !== p.name.toLowerCase()) {
                                var byName = savedByName[p.name.toLowerCase()];
                                if (byName) savedParam = byName;
                            }
                            // If no index match at all, try name-based fallback
                            if (!savedParam) {
                                var byName = savedByName[p.name.toLowerCase()];
                                if (byName) savedParam = byName;
                            }
                            var val = savedParam ? (typeof savedParam === 'object' ? savedParam.value : savedParam) : p.value;
                            var locked = savedParam && savedParam.locked ? true : false;
                            var param = { id: fid, name: p.name, v: val, disp: p.disp || '', lk: locked, alk: false, realIndex: p.index, hostId: plug.id };
                            PMap[fid] = param;
                            gpBatch.push({ p: plug.id, i: p.index, v: val });
                            return param;
                        });
                        pluginBlocks.push({
                            id: plug.id, hostId: plug.id,
                            name: plug.name, path: savedPlug.path || '',
                            manufacturer: plug.manufacturer || savedPlug.manufacturer || '',
                            params: params,
                            expanded: savedPlug.expanded !== false,
                            bypassed: savedPlug.bypassed || false,
                            searchFilter: ''
                        });
                        // Apply bypass
                        if (savedPlug.bypassed && setBypassFn) setBypassFn(plug.id, true);
                    });
                    // Send all param values in one IPC call
                    if (gpBatch.length > 0 && window.__JUCE__ && window.__JUCE__.backend) {
                        var batchFn = window.__juceGetNativeFunction('applyParamBatch');
                        if (batchFn) batchFn(JSON.stringify(gpBatch));
                    }

                    // Build old→new plugin ID map for remapping references
                    var idMap = {};
                    for (var mi = 0; mi < data.plugins.length && mi < result.plugins.length; mi++) {
                        var oldId = data.plugins[mi].hostId;
                        var newId = result.plugins[mi].id;
                        if (oldId !== undefined && oldId !== newId) {
                            idMap[oldId] = newId;
                        }
                    }

                    // Restore blocks with re-mapped target IDs
                    // Remap block targets from old IDs to new IDs now that plugins are loaded
                    if (data.blocks && data.blocks.length) {
                        // Re-validate targets against populated PMap + remap IDs
                        blocks.forEach(function (b) {
                            var newSet = new Set();
                            b.targets.forEach(function (t) {
                                var parts = t.split(':');
                                var remapped = t;
                                if (parts.length === 2 && idMap[parseInt(parts[0])] !== undefined) {
                                    remapped = idMap[parseInt(parts[0])] + ':' + parts[1];
                                }
                                if (PMap[remapped]) newSet.add(remapped);
                            });
                            b.targets = newSet;
                            // Remap keyed maps
                            function remapKeyedMap(obj) {
                                if (!obj) return {};
                                var out = {};
                                for (var k in obj) {
                                    var kp = k.split(':');
                                    var nk = k;
                                    if (kp.length === 2 && idMap[parseInt(kp[0])] !== undefined) {
                                        nk = idMap[parseInt(kp[0])] + ':' + kp[1];
                                    }
                                    out[nk] = obj[k];
                                }
                                return out;
                            }
                            b.targetBases = remapKeyedMap(b.targetBases);
                            b.targetRanges = remapKeyedMap(b.targetRanges);
                            b.targetRangeBases = remapKeyedMap(b.targetRangeBases);
                            b.linkMin = remapKeyedMap(b.linkMin);
                            b.linkMax = remapKeyedMap(b.linkMax);
                            b.linkBases = remapKeyedMap(b.linkBases);
                            // Remap snapshots
                            if (b.snapshots) {
                                b.snapshots.forEach(function (s) {
                                    if (s.values) {
                                        var newVals = {};
                                        for (var k in s.values) {
                                            var kp = k.split(':');
                                            var nk = k;
                                            if (kp.length === 2 && idMap[parseInt(kp[0])] !== undefined) {
                                                nk = idMap[parseInt(kp[0])] + ':' + kp[1];
                                            }
                                            newVals[nk] = s.values[k];
                                        }
                                        s.values = newVals;
                                    }
                                });
                            }
                            // Remap lane pids
                            if (b.lanes) {
                                b.lanes.forEach(function (lane) {
                                    if (lane.pids) {
                                        lane.pids = lane.pids.map(function (pid) {
                                            if (!pid) return pid;
                                            var pp = pid.split(':');
                                            if (pp.length === 2 && idMap[parseInt(pp[0])] !== undefined) {
                                                return idMap[parseInt(pp[0])] + ':' + pp[1];
                                            }
                                            return pid;
                                        });
                                    }
                                    // Remap morph lane snapshot values
                                    if (lane.morphSnapshots) {
                                        lane.morphSnapshots.forEach(function (s) {
                                            if (s.values) {
                                                var newVals = {};
                                                for (var k in s.values) {
                                                    var kp = k.split(':');
                                                    var nk = k;
                                                    if (kp.length === 2 && idMap[parseInt(kp[0])] !== undefined) {
                                                        nk = idMap[parseInt(kp[0])] + ':' + kp[1];
                                                    }
                                                    newVals[nk] = s.values[k];
                                                }
                                                s.values = newVals;
                                            }
                                        });
                                    }
                                });
                            }
                            // Remap link source pluginIds
                            if (b.linkSources) {
                                b.linkSources.forEach(function (src) {
                                    if (src.pluginId >= 0 && idMap[src.pluginId] !== undefined) {
                                        src.pluginId = idMap[src.pluginId];
                                    }
                                });
                            }
                        });
                    }
                }
                // Preset name already shown — just restore global settings
                if (data.internalBpm) {
                    internalBpm = data.internalBpm;
                    var bpmInp = document.getElementById('internalBpmInput');
                    if (bpmInp) bpmInp.value = internalBpm;
                }
                if (data.autoLocate !== undefined) {
                    autoLocate = data.autoLocate;
                    var alChk = document.getElementById('autoLocateChk');
                    if (alChk) alChk.checked = autoLocate;
                }

                // Restore routing mode (sequential/parallel/wrongeq)
                if (data.routingMode !== undefined) {
                    routingMode = data.routingMode;
                    var setRoutFn = (window.__JUCE__ && window.__JUCE__.backend) ? window.__juceGetNativeFunction('setRoutingMode') : null;
                    if (setRoutFn) setRoutFn(routingMode);
                    // Update routing dropdown
                    document.getElementById('routingSelect').value = routingMode;
                    document.getElementById('routingSelect').classList.toggle('weq-active', routingMode === 2);
                    if (typeof weqSetVisible === 'function') weqSetVisible(routingMode === 2);
                }

                // Restore WrongEQ state from preset
                if (data.wrongEq) {
                    var weq = data.wrongEq;
                    if (weq.points) {
                        wrongEqPoints = weq.points.map(function (p) {
                            var pt = { x: p.x, y: p.y, pluginIds: p.pluginIds || [], seg: p.seg || null, solo: p.solo || false, mute: p.mute || false, q: p.q != null ? p.q : 0.707, type: p.type || 'Bell', drift: p.drift || 0, preEq: p.preEq !== undefined ? p.preEq : (weq.preEq !== undefined ? weq.preEq : true), stereoMode: p.stereoMode || 0, slope: p.slope || 1, modExclude: p.modExclude || 0 };
                            if (p.uid) pt.uid = p.uid;
                            else if (typeof _weqAllocUid === 'function') pt.uid = _weqAllocUid();
                            return pt;
                        });
                        // Sync UID counter to prevent collisions
                        if (typeof _weqNextUid !== 'undefined') {
                            var maxUid = 0;
                            wrongEqPoints.forEach(function (pt) { if (pt.uid > maxUid) maxUid = pt.uid; });
                            if (maxUid >= _weqNextUid) _weqNextUid = maxUid + 1;
                        }
                    }
                    if (typeof weqGlobalInterp !== 'undefined' && weq.interp) weqGlobalInterp = weq.interp;
                    if (typeof weqGlobalDepth !== 'undefined' && weq.depth != null) weqGlobalDepth = weq.depth;
                    if (typeof weqGlobalWarp !== 'undefined' && weq.warp != null) weqGlobalWarp = weq.warp;
                    if (typeof weqGlobalSteps !== 'undefined' && weq.steps != null) weqGlobalSteps = weq.steps;
                    if (typeof weqGlobalTilt !== 'undefined' && weq.tilt != null) weqGlobalTilt = weq.tilt;

                    if (typeof weqPreEq !== 'undefined' && weq.preEq != null) weqPreEq = weq.preEq;
                    if (typeof weqGlobalBypass !== 'undefined' && weq.bypass != null) weqGlobalBypass = weq.bypass;
                    // Animation params
                    if (typeof weqAnimStop === 'function') weqAnimStop();
                    if (typeof weqAnimSpeed !== 'undefined' && weq.animSpeed != null) weqAnimSpeed = weq.animSpeed;
                    if (typeof weqAnimDepth !== 'undefined' && weq.animDepth != null) weqAnimDepth = weq.animDepth;
                    if (typeof weqAnimShape !== 'undefined' && weq.animShape != null) weqAnimShape = weq.animShape;
                    if (typeof weqAnimSpread !== 'undefined' && weq.animSpread != null) weqAnimSpread = weq.animSpread;
                    // Drift params
                    if (typeof weqDrift !== 'undefined' && weq.drift != null) weqDrift = weq.drift;
                    if (typeof weqDriftRange !== 'undefined' && weq.driftRange != null) weqDriftRange = weq.driftRange;
                    if (typeof weqDriftScale !== 'undefined' && weq.driftScale != null) weqDriftScale = weq.driftScale;
                    if (typeof weqDriftContinuous !== 'undefined' && weq.driftContinuous != null) weqDriftContinuous = weq.driftContinuous;
                    if (typeof weqDriftMode !== 'undefined' && weq.driftMode != null) weqDriftMode = weq.driftMode;
                    if (typeof weqDriftTexture !== 'undefined' && weq.driftTexture != null) weqDriftTexture = weq.driftTexture;
                    if (typeof weqGainLoCut !== 'undefined' && weq.gainLoCut != null) weqGainLoCut = weq.gainLoCut;
                    if (typeof weqGainHiCut !== 'undefined' && weq.gainHiCut != null) weqGainHiCut = weq.gainHiCut;
                    if (typeof weqDriftLoCut !== 'undefined' && weq.driftLoCut != null) weqDriftLoCut = weq.driftLoCut;
                    if (typeof weqDriftHiCut !== 'undefined' && weq.driftHiCut != null) weqDriftHiCut = weq.driftHiCut;
                    if (typeof weqQModSpeed !== 'undefined' && weq.qModSpeed != null) weqQModSpeed = weq.qModSpeed;
                    if (typeof weqQModDepth !== 'undefined' && weq.qModDepth != null) weqQModDepth = weq.qModDepth;
                    if (typeof weqQModShape !== 'undefined' && weq.qModShape != null) weqQModShape = weq.qModShape;
                    if (typeof weqQModSpread !== 'undefined' && weq.qModSpread != null) weqQModSpread = weq.qModSpread;
                    if (typeof weqQLoCut !== 'undefined' && weq.qLoCut != null) weqQLoCut = weq.qLoCut;
                    if (typeof weqQHiCut !== 'undefined' && weq.qHiCut != null) weqQHiCut = weq.qHiCut;

                    if (typeof weqDBRangeMax !== 'undefined' && weq.dbRange != null) weqDBRangeMax = weq.dbRange;
                    if (typeof weqSplitMode !== 'undefined' && weq.splitMode != null) weqSplitMode = weq.splitMode;
                    if (typeof weqOversample !== 'undefined' && weq.oversample != null) weqOversample = weq.oversample;
                    if (typeof weqUnassignedMode !== 'undefined' && weq.unassignedMode != null) weqUnassignedMode = weq.unassignedMode;
                    if (typeof weqModEnabled !== 'undefined' && weq.modEnabled != null) weqModEnabled = weq.modEnabled;
                    if (typeof _weqCurrentPreset !== 'undefined') _weqCurrentPreset = weq.eqPresetName || null;

                    // Remap WrongEQ pluginIds from old host IDs to new IDs
                    if (idMap && Object.keys(idMap).length > 0) {
                        wrongEqPoints.forEach(function (pt) {
                            if (!pt.pluginIds || !pt.pluginIds.length) return;
                            pt.pluginIds = pt.pluginIds.map(function (pid) {
                                return (idMap[pid] !== undefined) ? idMap[pid] : pid;
                            });
                        });
                    }

                    if (routingMode === 2 && typeof weqRenderPanel === 'function') weqRenderPanel();
                    if (typeof weqSyncToHost === 'function') weqSyncToHost();
                    // Retry sync after delay — backend may not be ready
                    setTimeout(function () {
                        if (typeof weqSyncToHost === 'function') weqSyncToHost();
                        if (routingMode === 2 && typeof weqRenderPanel === 'function') weqRenderPanel();
                    }, 500);
                    // Restart animation if speed > 0 or drift active
                    var needsAnim = (typeof _weqNeedsAnim === 'function') ? _weqNeedsAnim() : (weqAnimSpeed > 0);
                    if (needsAnim && typeof weqAnimStart === 'function') weqAnimStart();
                }
                // Restore per-plugin bus assignments
                var setBusFn = (window.__JUCE__ && window.__JUCE__.backend) ? window.__juceGetNativeFunction('setPluginBus') : null;
                if (setBusFn && data.plugins) {
                    for (var bi = 0; bi < data.plugins.length && bi < pluginBlocks.length; bi++) {
                        var savedBus = data.plugins[bi].busId || 0;
                        pluginBlocks[bi].busId = savedBus;
                        if (setBusFn) setBusFn(pluginBlocks[bi].id, savedBus);
                    }
                }

                // Restore bus mixer state
                if (data.busVolumes) {
                    var setBvFn = (window.__JUCE__ && window.__JUCE__.backend) ? window.__juceGetNativeFunction('setBusVolume') : null;
                    for (var bvi = 0; bvi < data.busVolumes.length && bvi < busVolumes.length; bvi++) {
                        busVolumes[bvi] = data.busVolumes[bvi];
                        if (setBvFn) setBvFn(bvi, busVolumes[bvi]);
                    }
                }
                if (data.busMutes) {
                    var setBmFn = (window.__JUCE__ && window.__JUCE__.backend) ? window.__juceGetNativeFunction('setBusMute') : null;
                    for (var bmi = 0; bmi < data.busMutes.length && bmi < busMutes.length; bmi++) {
                        busMutes[bmi] = data.busMutes[bmi];
                        if (setBmFn) setBmFn(bmi, busMutes[bmi]);
                    }
                }
                if (data.busSolos) {
                    var setBsFn = (window.__JUCE__ && window.__JUCE__.backend) ? window.__juceGetNativeFunction('setBusSolo') : null;
                    for (var bsi = 0; bsi < data.busSolos.length && bsi < busSolos.length; bsi++) {
                        busSolos[bsi] = data.busSolos[bsi];
                        if (setBsFn) setBsFn(bsi, busSolos[bsi]);
                    }
                }

                // Restore plugin order
                var reorderFn = (window.__JUCE__ && window.__JUCE__.backend) ? window.__juceGetNativeFunction('reorderPlugins') : null;
                if (reorderFn) {
                    var ids = pluginBlocks.map(function (pb) { return pb.id; });
                    reorderFn(ids);
                }

                if (typeof setPluginLoading === 'function') setPluginLoading(false);

                // Restore routing mode (Sequential=0, Parallel=1, WrongEQ=2)
                if (data.routingMode != null && data.routingMode !== routingMode) {
                    routingMode = data.routingMode;
                    // Update C++ backend
                    if (window.__JUCE__ && window.__JUCE__.backend) {
                        var setRmFn = window.__juceGetNativeFunction('setRoutingMode');
                        setRmFn(routingMode);
                    }
                    // Update routing dropdown
                    document.getElementById('routingSelect').value = routingMode;
                    document.getElementById('routingSelect').classList.toggle('weq-active', routingMode === 2);
                    // Show/hide WrongEQ panel
                    if (typeof weqSetVisible === 'function') weqSetVisible(routingMode === 2);
                    // Sync EQ state when entering WrongEQ mode
                    if (routingMode === 2 && typeof weqSyncToHost === 'function') weqSyncToHost();
                }

                // Refresh targetBases from actual param values so arcs are correct
                blocks.forEach(function (b) {
                    b.targets.forEach(function (pid) {
                        var p = PMap[pid];
                        if (p) {
                            if (!b.targetBases) b.targetBases = {};
                            b.targetBases[pid] = p.v;
                            if (b.mode === 'shapes_range') {
                                if (!b.targetRangeBases) b.targetRangeBases = {};
                                b.targetRangeBases[pid] = p.v;
                            }
                        }
                    });
                });

                renderAllPlugins(); renderBlocks(); updCounts(); syncBlocksToHost(); saveUiStateToHost(); syncExpandedPlugins();
                clearGpDirty();
                closeGlobalPresetBrowser();

                // Show confirmation toast + report failures
                if (loadFailures.length > 0) {
                    showToast('Preset loaded with errors. Could not load: ' + loadFailures.join(', '), 'error', 6000);
                } else {
                    showToast('Preset loaded: ' + presetName, 'success', 3000);
                }
            });
        }
    }

    // Fire all plugin loads in parallel with name-based fallback
    // If exact path fails (different OS, different install location), retry by plugin name.
    // C++ findPluginDescription matches d.name == pluginPath, so passing just the name works.
    if (loadPluginFn) {
        for (var li = 0; li < pluginPaths.length; li++) {
            (function (idx) {
                loadPluginFn(pluginPaths[idx]).then(function (result) {
                    if (!result || result.error) {
                        // Path failed — try fallback by plugin name
                        var pluginName = data.plugins[idx] ? data.plugins[idx].name : '';
                        if (pluginName && pluginName !== pluginPaths[idx]) {
                            loadPluginFn(pluginName).then(function (result2) {
                                onPluginDone(idx, !result2 || result2.error);
                            }).catch(function () {
                                onPluginDone(idx, true);
                            });
                        } else {
                            onPluginDone(idx, true);
                        }
                    } else {
                        onPluginDone(idx, false);
                    }
                }).catch(function () {
                    // Path threw — try fallback by plugin name
                    var pluginName = data.plugins[idx] ? data.plugins[idx].name : '';
                    if (pluginName && pluginName !== pluginPaths[idx]) {
                        loadPluginFn(pluginName).then(function (result2) {
                            onPluginDone(idx, !result2 || result2.error);
                        }).catch(function () {
                            onPluginDone(idx, true);
                        });
                    } else {
                        onPluginDone(idx, true);
                    }
                });
            })(li);
        }
    } else {
        // No backend — just clean up placeholders
        for (var ni = 0; ni < placeholderIds.length; ni++) {
            removePlaceholderCard(placeholderIds[ni]);
        }
        gpLoadInProgress = false;
        if (typeof setPluginLoading === 'function') setPluginLoading(false);
    }
}
function deleteGlobalPreset(presetName) {
    var fn = window.__juceGetNativeFunction('deleteGlobalPreset');
    fn(presetName).then(function () {
        if (currentGlobalPresetName === presetName) {
            currentGlobalPresetName = null;
            updateGpNameDisplay();
        }
        refreshGlobalPresetList();
    });
}

// Dirty state tracking
var gpDirty = false;
function markGpDirty() {
    if (!gpDirty && currentGlobalPresetName) {
        gpDirty = true;
        var el = document.getElementById('gpDirty');
        if (el) el.classList.add('on');
    }
}
function clearGpDirty() {
    gpDirty = false;
    var el = document.getElementById('gpDirty');
    if (el) el.classList.remove('on');
}

// Wire header buttons
document.getElementById('gpBrowse').onclick = openGlobalPresetBrowser;
document.getElementById('gpSave').onclick = function () {
    // Quick save: if we have a current name, overwrite. Otherwise open browser.
    if (currentGlobalPresetName) {
        var data = buildGlobalPresetData();
        var fn = window.__juceGetNativeFunction('saveGlobalPreset');
        fn(currentGlobalPresetName, JSON.stringify(data));
        clearGpDirty();
        // Flash feedback
        var btn = document.getElementById('gpSave');
        btn.textContent = '\u2713';
        setTimeout(function () { btn.textContent = 'Save'; }, 800);
    } else {
        openGlobalPresetBrowser();
    }
};

// Nav arrows — cycle through global presets
document.getElementById('gpPrev').onclick = function () { navigateGlobalPreset(-1); };
document.getElementById('gpNext').onclick = function () { navigateGlobalPreset(1); };
function navigateGlobalPreset(dir) {
    if (!(window.__JUCE__ && window.__JUCE__.backend)) return;
    var fn = window.__juceGetNativeFunction('getGlobalPresets');
    fn().then(function (entries) {
        if (!entries || !entries.length) return;
        var sorted = entries.slice().sort(function (a, b) {
            var na = (typeof a === 'string') ? a : a.name;
            var nb = (typeof b === 'string') ? b : b.name;
            return na.localeCompare(nb);
        });
        var names = sorted.map(function (e) { return (typeof e === 'string') ? e : e.name; });
        var idx = names.indexOf(currentGlobalPresetName);
        if (idx < 0) {
            idx = dir > 0 ? 0 : names.length - 1;
        } else {
            idx = (idx + dir + names.length) % names.length;
        }
        loadGlobalPreset(names[idx]);
    });
}

document.getElementById('gpModalClose').onclick = closeGlobalPresetBrowser;
document.getElementById('globalPresetModal').onclick = function (e) {
    if (e.target === this) closeGlobalPresetBrowser();
};
document.getElementById('gpSaveBtn').onclick = function () {
    saveGlobalPresetFromInput();
    var btn = document.getElementById('gpSaveBtn');
    btn.textContent = '\u2713 Saved';
    btn.style.background = '#4a8';
    setTimeout(function () { btn.textContent = 'Save'; btn.style.background = ''; }, 1200);
};
document.getElementById('gpNameInput').onkeydown = function (e) {
    if (e.key === 'Enter') saveGlobalPresetFromInput();
};
// Global preset search
document.getElementById('gpSearch').oninput = function () {
    refreshGlobalPresetList();
};
// Open presets root folder
document.getElementById('gpOpenFolder').onclick = function () {
    var revealFn = window.__juceGetNativeFunction('revealPresetFile');
    if (revealFn) revealFn('root', '');
};
