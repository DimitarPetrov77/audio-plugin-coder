/*
 * Expose System — Selective parameter exposure to DAW automation
 * Manages which hosted plugin params and logic block params are visible
 * to the DAW's automation dropdown via the proxy parameter pool.
 *
 * State: window._exposeState = {
 *   plugins: { [pluginId]: { exposed: bool, excludedParams: Set<paramIndex> } },
 *   blocks:  { [blockId]:  { exposed: bool, excludedParams: Set<paramKey> } }
 * }
 */

// ── State ──
if (!window._exposeState) {
    window._exposeState = { plugins: {}, blocks: {} };
}

// ── Block param definitions: what each block type can expose ──
var BLOCK_EXPOSABLE_PARAMS = {
    shapes: [
        { key: 'shapeSpeed', label: 'Speed', type: 'float', min: 0, max: 100, suffix: '%' },
        { key: 'shapeSize', label: 'Size', type: 'float', min: 0, max: 100, suffix: '%' },
        { key: 'shapeSpin', label: 'Spin', type: 'float', min: 0, max: 100, suffix: '%' },
        { key: 'shapePhaseOffset', label: 'Phase', type: 'float', min: 0, max: 360, suffix: '\u00b0' },
        { key: 'shapeType', label: 'Shape', type: 'discrete', options: ['circle', 'figure8', 'sweepX', 'sweepY', 'triangle', 'square', 'hexagon', 'pentagram', 'hexagram', 'rose4', 'lissajous', 'spiral', 'cat', 'butterfly', 'infinityKnot'] },
        { key: 'shapeTracking', label: 'Tracking', type: 'discrete', options: ['horizontal', 'vertical', 'distance'] },
        { key: 'shapePolarity', label: 'Polarity', type: 'discrete', options: ['bipolar', 'unipolar', 'up', 'down'] },
        { key: 'shapeTrigger', label: 'Trigger', type: 'discrete', options: ['free', 'midi'] },
        { key: 'enabled', label: 'Enabled', type: 'bool' }
    ],
    shapes_range: [
        { key: 'shapeSpeed', label: 'Speed', type: 'float', min: 0, max: 100, suffix: '%' },
        { key: 'shapeSize', label: 'Size', type: 'float', min: 0, max: 100, suffix: '%' },
        { key: 'shapeSpin', label: 'Spin', type: 'float', min: 0, max: 100, suffix: '%' },
        { key: 'shapePhaseOffset', label: 'Phase', type: 'float', min: 0, max: 360, suffix: '\u00b0' },
        { key: 'shapeType', label: 'Shape', type: 'discrete', options: ['circle', 'figure8', 'sweepX', 'sweepY', 'triangle', 'square', 'hexagon', 'pentagram', 'hexagram', 'rose4', 'lissajous', 'spiral', 'cat', 'butterfly', 'infinityKnot'] },
        { key: 'shapeTracking', label: 'Tracking', type: 'discrete', options: ['horizontal', 'vertical', 'distance'] },
        { key: 'shapePolarity', label: 'Polarity', type: 'discrete', options: ['bipolar', 'unipolar', 'up', 'down'] },
        { key: 'enabled', label: 'Enabled', type: 'bool' }
    ],
    randomize: [
        { key: 'rMin', label: 'Range Min', type: 'float', min: 0, max: 100, suffix: '%' },
        { key: 'rMax', label: 'Range Max', type: 'float', min: 0, max: 100, suffix: '%' },
        { key: 'glideMs', label: 'Glide', type: 'float', min: 0, max: 2000, suffix: 'ms' },
        { key: 'enabled', label: 'Enabled', type: 'bool' }
    ],
    envelope: [
        { key: 'envAtk', label: 'Attack', type: 'float', min: 0, max: 500, suffix: 'ms' },
        { key: 'envRel', label: 'Release', type: 'float', min: 0, max: 2000, suffix: 'ms' },
        { key: 'envSens', label: 'Sensitivity', type: 'float', min: 0, max: 100, suffix: '%' },
        { key: 'envInvert', label: 'Invert', type: 'bool' },
        { key: 'enabled', label: 'Enabled', type: 'bool' }
    ],
    sample: [
        { key: 'sampleSpeed', label: 'Speed', type: 'float', min: 0.1, max: 4, suffix: 'x' },
        { key: 'sampleReverse', label: 'Reverse', type: 'bool' },
        { key: 'enabled', label: 'Enabled', type: 'bool' }
    ],
    morph_pad: [
        { key: 'playheadX', label: 'Pad X', type: 'float', min: 0, max: 1, suffix: '' },
        { key: 'playheadY', label: 'Pad Y', type: 'float', min: 0, max: 1, suffix: '' },
        { key: 'morphSpeed', label: 'Speed', type: 'float', min: 0, max: 100, suffix: '%' },
        { key: 'lfoDepth', label: 'LFO Depth', type: 'float', min: 0, max: 100, suffix: '%' },
        { key: 'jitter', label: 'Jitter', type: 'float', min: 0, max: 100, suffix: '%' },
        { key: 'enabled', label: 'Enabled', type: 'bool' }
    ],
    lane: [
        { key: 'enabled', label: 'Enabled', type: 'bool' }
        // Per-lane params (depth, speed) are added dynamically based on lane count
    ]
};

// Get exposable params for a block, including dynamic per-lane params
function getExposableParamsForBlock(b) {
    var base = BLOCK_EXPOSABLE_PARAMS[b.mode] || [];
    var params = base.slice(); // copy

    // Lane blocks get per-lane depth/speed
    if (b.mode === 'lane' && b.lanes) {
        for (var li = 0; li < b.lanes.length; li++) {
            var laneLabel = b.lanes[li].morphMode ? 'Morph ' + (li + 1) : 'Lane ' + (li + 1);
            params.push({ key: 'lane.' + li + '.depth', label: laneLabel + ' Depth', type: 'float', min: 0, max: 100, suffix: '%' });
            if (b.lanes[li].morphMode) {
                // Morph lanes don't have speed in the traditional sense
            } else {
                params.push({ key: 'lane.' + li + '.speed', label: laneLabel + ' Speed', type: 'float', min: 0, max: 100, suffix: '%' });
            }
        }
    }
    return params;
}

// ── Dropdown Rendering ──

function openExposeDropdown(anchorEl) {
    closeExposeDropdown();

    var drop = document.createElement('div');
    drop.id = 'exposeDrop';
    drop.className = 'expose-dropdown';

    var html = '';
    html += '<div class="expose-title">Expose to DAW</div>';

    // Section: Hosted Plugins
    var pluginList = typeof pluginBlocks !== 'undefined' ? pluginBlocks : [];
    if (pluginList.length > 0) {
        html += '<div class="expose-section-label">Plugins</div>';
        for (var pi = 0; pi < pluginList.length; pi++) {
            var plug = pluginList[pi];
            var pState = window._exposeState.plugins[plug.id];
            var isExposed = pState ? pState.exposed : true; // default: exposed (backwards compat)
            var excludeCount = pState && pState.excludedParams ? pState.excludedParams.size : 0;
            var paramCount = plug.params ? plug.params.length : 0;
            var activeCount = paramCount - excludeCount;

            html += '<div class="expose-item expose-plugin" data-plugid="' + plug.id + '">';
            html += '<label class="expose-check">';
            html += '<input type="checkbox"' + (isExposed ? ' checked' : '') + ' data-action="toggle-plugin" data-plugid="' + plug.id + '">';
            html += '<span class="expose-name">' + (plug.name || 'Plugin ' + plug.id) + '</span>';
            html += '</label>';
            if (isExposed && paramCount > 0) {
                html += '<span class="expose-count">' + activeCount + '/' + paramCount + '</span>';
                html += '<button class="expose-expand-btn" data-action="expand-plugin" data-plugid="' + plug.id + '">&rsaquo;</button>';
            }
            html += '</div>';
        }
    }

    // Section: Logic Blocks
    if (typeof blocks !== 'undefined' && blocks.length > 0) {
        html += '<div class="expose-section-label">Logic Blocks</div>';
        for (var bi = 0; bi < blocks.length; bi++) {
            var b = blocks[bi];
            var bState = window._exposeState.blocks[b.id];
            var isExposed = bState ? bState.exposed : false; // default: not exposed (new feature)
            var allParams = getExposableParamsForBlock(b);
            var excludeCount = bState && bState.excludedParams ? bState.excludedParams.size : 0;
            var activeCount = allParams.length - excludeCount;
            var blockName = b.name || (b.mode + ' #' + b.id);

            html += '<div class="expose-item expose-block" data-bid="' + b.id + '">';
            html += '<label class="expose-check">';
            html += '<input type="checkbox"' + (isExposed ? ' checked' : '') + ' data-action="toggle-block" data-bid="' + b.id + '">';
            html += '<span class="expose-name">' + blockName + '</span>';
            html += '</label>';
            if (isExposed && allParams.length > 0) {
                html += '<span class="expose-count">' + activeCount + '/' + allParams.length + '</span>';
                html += '<button class="expose-expand-btn" data-action="expand-block" data-bid="' + b.id + '">&rsaquo;</button>';
            }
            html += '</div>';
        }
    }

    if (pluginList.length === 0 && (typeof blocks === 'undefined' || blocks.length === 0)) {
        html += '<div class="expose-empty">No plugins or blocks loaded</div>';
    }

    drop.innerHTML = html;

    // Position below the anchor button
    var rect = anchorEl.getBoundingClientRect();
    drop.style.position = 'fixed';
    drop.style.top = (rect.bottom + 2) + 'px';
    drop.style.right = (window.innerWidth - rect.right) + 'px';
    drop.style.zIndex = '9999';

    document.body.appendChild(drop);

    // Wire events
    drop.addEventListener('change', function (e) {
        var inp = e.target;
        if (!inp || inp.tagName !== 'INPUT') return;
        var action = inp.dataset.action;
        if (action === 'toggle-plugin') {
            togglePluginExpose(parseInt(inp.dataset.plugid), inp.checked);
        } else if (action === 'toggle-block') {
            toggleBlockExpose(parseInt(inp.dataset.bid), inp.checked);
        } else if (action === 'toggle-plugin-param') {
            togglePluginParamExpose(parseInt(inp.dataset.plugid), parseInt(inp.dataset.pidx), inp.checked);
        } else if (action === 'toggle-block-param') {
            toggleBlockParamExpose(parseInt(inp.dataset.bid), inp.dataset.pkey, inp.checked);
        }
        // Refresh dropdown to update counts
        openExposeDropdown(anchorEl);
    });

    drop.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-action]');
        if (!btn) return;
        var action = btn.dataset.action;
        if (action === 'expand-plugin') {
            e.stopPropagation();
            showPluginParamSubmenu(drop, btn, parseInt(btn.dataset.plugid));
        } else if (action === 'expand-block') {
            e.stopPropagation();
            showBlockParamSubmenu(drop, btn, parseInt(btn.dataset.bid));
        }
    });

    // Dismiss on outside click
    setTimeout(function () {
        document.addEventListener('mousedown', _exposeDismiss);
    }, 50);
}

function _exposeDismiss(e) {
    var drop = document.getElementById('exposeDrop');
    var sub = document.getElementById('exposeSubmenu');
    if (drop && !drop.contains(e.target) && (!sub || !sub.contains(e.target))) {
        closeExposeDropdown();
    }
}

function closeExposeDropdown() {
    var drop = document.getElementById('exposeDrop');
    if (drop) drop.remove();
    var sub = document.getElementById('exposeSubmenu');
    if (sub) sub.remove();
    document.removeEventListener('mousedown', _exposeDismiss);
}

// ── Submenu shared state for shift-click range selection ──
var _exposeSubLastIdx = -1;

// ── Submenu: Plugin Params ──
function showPluginParamSubmenu(drop, anchorBtn, pluginId) {
    var existing = document.getElementById('exposeSubmenu');
    // Toggle: if submenu is already showing for this plugin, close it
    if (existing && existing._exposePluginId === pluginId) {
        existing.remove();
        return;
    }
    if (existing) existing.remove();

    var plug = null;
    if (typeof pluginBlocks !== 'undefined') {
        for (var i = 0; i < pluginBlocks.length; i++) {
            if (pluginBlocks[i].id === pluginId) { plug = pluginBlocks[i]; break; }
        }
    }
    if (!plug || !plug.params) return;

    var pState = window._exposeState.plugins[pluginId] || { exposed: true, excludedParams: new Set() };
    var sub = document.createElement('div');
    sub.id = 'exposeSubmenu';
    sub.className = 'expose-submenu';
    sub._exposePluginId = pluginId;

    var html = '<div class="expose-sub-title">' + (plug.name || 'Plugin') + ' Params';
    html += '<span class="expose-sub-actions">';
    html += '<button class="expose-sub-btn" data-action="select-all-plugin" data-plugid="' + pluginId + '">All</button>';
    html += '<button class="expose-sub-btn" data-action="deselect-all-plugin" data-plugid="' + pluginId + '">None</button>';
    html += '</span></div>';
    html += '<div class="expose-sub-search"><input type="text" placeholder="Filter params..." class="expose-search-input"></div>';
    html += '<div class="expose-sub-scroll">';
    for (var i = 0; i < plug.params.length; i++) {
        var p = plug.params[i];
        var isIncluded = !pState.excludedParams.has(i);
        html += '<label class="expose-check expose-sub-item" data-eidx="' + i + '">';
        html += '<input type="checkbox"' + (isIncluded ? ' checked' : '') + ' data-action="toggle-plugin-param" data-plugid="' + pluginId + '" data-pidx="' + i + '">';
        html += '<span>' + (p.name || 'Param ' + i) + '</span>';
        html += '</label>';
    }
    html += '</div>';
    sub.innerHTML = html;

    // Position to the right of the dropdown
    var dropRect = drop.getBoundingClientRect();
    sub.style.position = 'fixed';
    sub.style.top = dropRect.top + 'px';
    sub.style.left = (dropRect.right + 2) + 'px';
    sub.style.zIndex = '10000';
    sub.style.maxHeight = '400px';

    document.body.appendChild(sub);
    _exposeSubLastIdx = -1;

    // Wire search filter
    var searchInp = sub.querySelector('.expose-search-input');
    if (searchInp) {
        searchInp.addEventListener('input', function () {
            var q = searchInp.value.toLowerCase();
            sub.querySelectorAll('.expose-sub-item').forEach(function (item) {
                var name = item.textContent.toLowerCase();
                item.style.display = name.indexOf(q) >= 0 ? '' : 'none';
            });
        });
        // Prevent dropdown dismiss when clicking in search
        searchInp.addEventListener('mousedown', function (e) { e.stopPropagation(); });
    }

    // Wire change events with shift-click range selection
    sub.addEventListener('click', function (e) {
        var inp = e.target.closest('input[type="checkbox"]');
        if (inp && inp.dataset.action === 'toggle-plugin-param') {
            var idx = parseInt(inp.dataset.pidx);
            if (e.shiftKey && _exposeSubLastIdx >= 0 && _exposeSubLastIdx !== idx) {
                // Range select: toggle all between last and current to same state
                var lo = Math.min(_exposeSubLastIdx, idx);
                var hi = Math.max(_exposeSubLastIdx, idx);
                var checked = inp.checked;
                var allBoxes = sub.querySelectorAll('input[data-action="toggle-plugin-param"]');
                allBoxes.forEach(function (cb) {
                    var ci = parseInt(cb.dataset.pidx);
                    if (ci >= lo && ci <= hi) {
                        cb.checked = checked;
                        togglePluginParamExpose(pluginId, ci, checked);
                    }
                });
            } else {
                togglePluginParamExpose(pluginId, idx, inp.checked);
            }
            _exposeSubLastIdx = idx;
            // Update count in main dropdown
            _updateExposeCount(drop, pluginId, 'plugin');
            e.stopPropagation();
            return;
        }
        // Select All / Deselect All buttons
        var btn = e.target.closest('[data-action]');
        if (!btn) return;
        if (btn.dataset.action === 'select-all-plugin' || btn.dataset.action === 'deselect-all-plugin') {
            var setTo = btn.dataset.action === 'select-all-plugin';
            var allBoxes = sub.querySelectorAll('input[data-action="toggle-plugin-param"]');
            allBoxes.forEach(function (cb) {
                cb.checked = setTo;
                togglePluginParamExpose(pluginId, parseInt(cb.dataset.pidx), setTo);
            });
            _updateExposeCount(drop, pluginId, 'plugin');
        }
    });
}

// ── Submenu: Block Params ──
function showBlockParamSubmenu(drop, anchorBtn, blockId) {
    var existing = document.getElementById('exposeSubmenu');
    // Toggle: if submenu is already showing for this block, close it
    if (existing && existing._exposeBlockId === blockId) {
        existing.remove();
        return;
    }
    if (existing) existing.remove();

    var b = findBlock(blockId);
    if (!b) return;

    var bState = window._exposeState.blocks[blockId] || { exposed: true, excludedParams: new Set() };
    var allParams = getExposableParamsForBlock(b);

    var sub = document.createElement('div');
    sub.id = 'exposeSubmenu';
    sub.className = 'expose-submenu';
    sub._exposeBlockId = blockId;

    var html = '<div class="expose-sub-title">' + (b.name || b.mode) + ' Params';
    html += '<span class="expose-sub-actions">';
    html += '<button class="expose-sub-btn" data-action="select-all-block" data-bid="' + blockId + '">All</button>';
    html += '<button class="expose-sub-btn" data-action="deselect-all-block" data-bid="' + blockId + '">None</button>';
    html += '</span></div>';
    html += '<div class="expose-sub-search"><input type="text" placeholder="Filter params..." class="expose-search-input"></div>';
    html += '<div class="expose-sub-scroll">';
    for (var i = 0; i < allParams.length; i++) {
        var p = allParams[i];
        var isIncluded = !bState.excludedParams.has(p.key);
        var typeTag = p.type === 'discrete' ? ' <span class="expose-type-tag">list</span>' : (p.type === 'bool' ? ' <span class="expose-type-tag">on/off</span>' : '');
        html += '<label class="expose-check expose-sub-item" data-eidx="' + i + '">';
        html += '<input type="checkbox"' + (isIncluded ? ' checked' : '') + ' data-action="toggle-block-param" data-bid="' + blockId + '" data-pkey="' + p.key + '">';
        html += '<span>' + p.label + typeTag + '</span>';
        html += '</label>';
    }
    html += '</div>';
    sub.innerHTML = html;

    var dropRect = drop.getBoundingClientRect();
    sub.style.position = 'fixed';
    sub.style.top = dropRect.top + 'px';
    sub.style.left = (dropRect.right + 2) + 'px';
    sub.style.zIndex = '10000';
    sub.style.maxHeight = '400px';

    document.body.appendChild(sub);
    _exposeSubLastIdx = -1;

    // Wire search filter
    var searchInp = sub.querySelector('.expose-search-input');
    if (searchInp) {
        searchInp.addEventListener('input', function () {
            var q = searchInp.value.toLowerCase();
            sub.querySelectorAll('.expose-sub-item').forEach(function (item) {
                var name = item.textContent.toLowerCase();
                item.style.display = name.indexOf(q) >= 0 ? '' : 'none';
            });
        });
        searchInp.addEventListener('mousedown', function (e) { e.stopPropagation(); });
    }

    // Wire events with shift-click range selection
    sub.addEventListener('click', function (e) {
        var inp = e.target.closest('input[type="checkbox"]');
        if (inp && inp.dataset.action === 'toggle-block-param') {
            var label = inp.closest('[data-eidx]');
            var idx = label ? parseInt(label.dataset.eidx) : -1;
            if (e.shiftKey && _exposeSubLastIdx >= 0 && idx >= 0 && _exposeSubLastIdx !== idx) {
                var lo = Math.min(_exposeSubLastIdx, idx);
                var hi = Math.max(_exposeSubLastIdx, idx);
                var checked = inp.checked;
                var allLabels = sub.querySelectorAll('[data-eidx]');
                allLabels.forEach(function (lbl) {
                    var ci = parseInt(lbl.dataset.eidx);
                    if (ci >= lo && ci <= hi) {
                        var cb = lbl.querySelector('input[type="checkbox"]');
                        if (cb) {
                            cb.checked = checked;
                            toggleBlockParamExpose(blockId, cb.dataset.pkey, checked);
                        }
                    }
                });
            } else {
                toggleBlockParamExpose(blockId, inp.dataset.pkey, inp.checked);
            }
            _exposeSubLastIdx = idx;
            _updateExposeCount(drop, blockId, 'block');
            e.stopPropagation();
            return;
        }
        // Select All / Deselect All buttons
        var btn = e.target.closest('[data-action]');
        if (!btn) return;
        if (btn.dataset.action === 'select-all-block' || btn.dataset.action === 'deselect-all-block') {
            var setTo = btn.dataset.action === 'select-all-block';
            var allBoxes = sub.querySelectorAll('input[data-action="toggle-block-param"]');
            allBoxes.forEach(function (cb) {
                cb.checked = setTo;
                toggleBlockParamExpose(blockId, cb.dataset.pkey, setTo);
            });
            _updateExposeCount(drop, blockId, 'block');
        }
    });
}

// ── Helper: update count badge in main dropdown after submenu changes ──
function _updateExposeCount(drop, id, type) {
    if (!drop) return;
    var selector = type === 'plugin' ? '[data-plugid="' + id + '"]' : '[data-bid="' + id + '"]';
    var item = drop.querySelector('.expose-item' + selector);
    if (!item) return;
    var countEl = item.querySelector('.expose-count');
    if (!countEl) return;
    if (type === 'plugin') {
        var plug = null;
        for (var i = 0; i < pluginBlocks.length; i++) {
            if (pluginBlocks[i].id === id) { plug = pluginBlocks[i]; break; }
        }
        if (!plug) return;
        var pState = window._exposeState.plugins[id] || { excludedParams: new Set() };
        var total = plug.params ? plug.params.length : 0;
        countEl.textContent = (total - pState.excludedParams.size) + '/' + total;
    } else {
        var b = findBlock(id);
        if (!b) return;
        var bState = window._exposeState.blocks[id] || { excludedParams: new Set() };
        var allP = getExposableParamsForBlock(b);
        countEl.textContent = (allP.length - bState.excludedParams.size) + '/' + allP.length;
    }
}

// ── Toggle Actions ──

function togglePluginExpose(pluginId, exposed) {
    if (!window._exposeState.plugins[pluginId]) {
        window._exposeState.plugins[pluginId] = { exposed: exposed, excludedParams: new Set() };
    } else {
        window._exposeState.plugins[pluginId].exposed = exposed;
    }
    // Notify C++
    _syncExposeStateToHost();
}

function togglePluginParamExpose(pluginId, paramIdx, included) {
    var pState = window._exposeState.plugins[pluginId];
    if (!pState) {
        pState = { exposed: true, excludedParams: new Set() };
        window._exposeState.plugins[pluginId] = pState;
    }
    if (included) {
        pState.excludedParams.delete(paramIdx);
    } else {
        pState.excludedParams.add(paramIdx);
    }
    _syncExposeStateToHost();
}

function toggleBlockExpose(blockId, exposed) {
    if (!window._exposeState.blocks[blockId]) {
        window._exposeState.blocks[blockId] = { exposed: exposed, excludedParams: new Set() };
    } else {
        window._exposeState.blocks[blockId].exposed = exposed;
    }
    _syncExposeStateToHost();
}

function toggleBlockParamExpose(blockId, paramKey, included) {
    var bState = window._exposeState.blocks[blockId];
    if (!bState) {
        bState = { exposed: true, excludedParams: new Set() };
        window._exposeState.blocks[blockId] = bState;
    }
    if (included) {
        bState.excludedParams.delete(paramKey);
    } else {
        bState.excludedParams.add(paramKey);
    }
    _syncExposeStateToHost();
}

// ── Sync to C++ ──
// Sends the full expose state to C++ which manages proxy slot assignment/release

function _syncExposeStateToHost() {
    var fn = window.__juceGetNativeFunction ? window.__juceGetNativeFunction('updateExposeState') : null;
    if (!fn) return;

    // Serialize: plugins as { id: { exposed, excluded: [indices] } }
    var payload = { plugins: {}, blocks: {} };

    for (var pid in window._exposeState.plugins) {
        var ps = window._exposeState.plugins[pid];
        payload.plugins[pid] = {
            exposed: ps.exposed,
            excluded: Array.from(ps.excludedParams || [])
        };
    }

    for (var bid in window._exposeState.blocks) {
        var bs = window._exposeState.blocks[bid];
        // Include block name and param definitions so C++ can name the BX_ slots
        var b = typeof findBlock === 'function' ? findBlock(parseInt(bid)) : null;
        var blockName = b ? (b.name || (b.mode + ' #' + b.id)) : ('Block ' + bid);
        var paramDefs = b ? getExposableParamsForBlock(b).map(function (p) {
            var def = { key: p.key, label: p.label, type: p.type || 'float' };
            if (p.options) def.options = p.options;
            if (p.min !== undefined) def.min = p.min;
            if (p.max !== undefined) def.max = p.max;
            if (p.suffix !== undefined) def.suffix = p.suffix;
            return def;
        }) : [];

        payload.blocks[bid] = {
            exposed: bs.exposed,
            excluded: Array.from(bs.excludedParams || []),
            name: blockName,
            params: paramDefs
        };
    }

    fn(JSON.stringify(payload));
    // Mark state dirty so auto-save picks up the change
    if (typeof markStateDirty === 'function') markStateDirty();
}

// ── Persistence helpers (called by persistence.js) ──

function getExposeStateForSave() {
    var out = { plugins: {}, blocks: {} };
    for (var pid in window._exposeState.plugins) {
        var ps = window._exposeState.plugins[pid];
        out.plugins[pid] = { exposed: ps.exposed, excluded: Array.from(ps.excludedParams || []) };
    }
    for (var bid in window._exposeState.blocks) {
        var bs = window._exposeState.blocks[bid];
        out.blocks[bid] = { exposed: bs.exposed, excluded: Array.from(bs.excludedParams || []) };
    }
    return out;
}

function restoreExposeState(data) {
    if (!data) return;
    window._exposeState = { plugins: {}, blocks: {} };
    if (data.plugins) {
        for (var pid in data.plugins) {
            var ps = data.plugins[pid];
            window._exposeState.plugins[pid] = {
                exposed: ps.exposed !== false,
                excludedParams: new Set(ps.excluded || [])
            };
        }
    }
    if (data.blocks) {
        for (var bid in data.blocks) {
            var bs = data.blocks[bid];
            window._exposeState.blocks[bid] = {
                exposed: bs.exposed !== false,
                excludedParams: new Set(bs.excluded || [])
            };
        }
    }
    _syncExposeStateToHost();
}

// ── DAW → Block param sync ──
// Called from C++ evaluateScript when DAW automates an AP_ slot mapped to a block
function setBlockParamFromDAW(blockId, paramKey, value) {
    var b = typeof findBlock === 'function' ? findBlock(blockId) : null;
    if (!b) return;

    // Look up param definition — use getExposableParamsForBlock for full list including dynamic lanes
    var paramDefs = typeof getExposableParamsForBlock === 'function' ? getExposableParamsForBlock(b) : (BLOCK_EXPOSABLE_PARAMS[b.mode] || []);
    var pDef = null;
    for (var i = 0; i < paramDefs.length; i++) {
        if (paramDefs[i].key === paramKey) { pDef = paramDefs[i]; break; }
    }

    // Handle lane dynamic params (e.g. "lane.0.depth")
    var laneMatch = paramKey.match(/^lane\.(\d+)\.(\w+)$/);
    if (laneMatch) {
        var laneIdx = parseInt(laneMatch[1]);
        var laneProp = laneMatch[2];
        if (b.lanes && b.lanes[laneIdx]) {
            // Use pDef range if available
            var lMin = pDef ? (pDef.min || 0) : 0;
            var lMax = pDef ? (pDef.max || 100) : 100;
            b.lanes[laneIdx][laneProp] = value * (lMax - lMin) + lMin;
        }
        if (typeof syncBlocksToHost === 'function') syncBlocksToHost();
        if (typeof renderBlocks === 'function') renderBlocks();
        return;
    }

    if (!pDef) {
        // Unknown param, set raw
        b[paramKey] = value;
    } else if (pDef.type === 'bool') {
        b[paramKey] = value >= 0.5;
    } else if (pDef.type === 'discrete' && pDef.options) {
        var idx = Math.round(value * (pDef.options.length - 1));
        idx = Math.max(0, Math.min(pDef.options.length - 1, idx));
        b[paramKey] = pDef.options[idx];
    } else {
        // Float — use min/max from param definition
        var fMin = pDef.min !== undefined ? pDef.min : 0;
        var fMax = pDef.max !== undefined ? pDef.max : 100;
        b[paramKey] = value * (fMax - fMin) + fMin;
    }

    if (typeof syncBlocksToHost === 'function') syncBlocksToHost();
    if (typeof renderBlocks === 'function') renderBlocks();
}

