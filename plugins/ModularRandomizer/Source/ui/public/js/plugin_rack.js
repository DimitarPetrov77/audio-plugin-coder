// ============================================================
// PLUGIN RACK
// Plugin loading, rendering, param display, drag & context menu
// ============================================================

// Visibility culling: tell C++ which plugin IDs are currently expanded.
// C++ skips polling params from collapsed plugins.
function syncExpandedPlugins() {
    if (!(window.__JUCE__ && window.__JUCE__.backend)) return;
    var fn = window.__juceGetNativeFunction('setExpandedPlugins');
    var ids = [];
    for (var i = 0; i < pluginBlocks.length; i++) {
        if (pluginBlocks[i].expanded && !pluginBlocks[i].isVirtual) ids.push(pluginBlocks[i].id);
    }
    fn(ids);
}

// Force-dirty all params for a plugin so refreshParamDisplay repaints them.
// Called when a card is expanded or when scroll reveals new rows.
function dirtyPluginParams(pluginId) {
    // Don't iterate 2000+ params — just mark modDirty + invalidate visPids cache.
    // refreshParamDisplay will check all visible params on next frame.
    _modDirty = true;
    _visPidsDirty = true;
}

// Load a REAL VST3 plugin via native function
function addPlugin(pluginPath) {
    if (!window.__JUCE__ || !window.__JUCE__.backend) {
        console.log('JUCE backend not available');
        return;
    }
    if (typeof pluginLoading !== 'undefined' && pluginLoading) return; // prevent double-click
    var plugName = pluginPath.split(/[\\/]/).pop().replace(/\.vst3$/i, '');
    if (typeof setPluginLoading === 'function') setPluginLoading(true, plugName);

    // Show placeholder card immediately (visual feedback while loading)
    var placeholderId = 'loading-' + Date.now();
    appendPlaceholderCard(placeholderId, plugName);

    console.log('Loading plugin: ' + pluginPath);
    var loadFn = window.__juceGetNativeFunction('loadPlugin');
    loadFn(pluginPath).then(function (result) {
        removePlaceholderCard(placeholderId);
        if (typeof setPluginLoading === 'function') setPluginLoading(false);
        if (!result || result.error) {
            showLoadError(plugName, result ? result.error : 'Load failed');
            return;
        }
        // Plugin loaded successfully — build param map and card
        try {
            var hostedId = result.id;
            var params = (result.params || []).map(function (p, i) {
                var fid = hostedId + ':' + p.index;
                var param = { id: fid, name: p.name, v: p.value, disp: p.disp || '', lk: false, alk: false, realIndex: p.index, hostId: hostedId };
                PMap[fid] = param;
                return param;
            });
            pluginBlocks.push({ id: hostedId, hostId: hostedId, name: result.name, path: pluginPath, manufacturer: result.manufacturer || '', params: params, expanded: true, searchFilter: '' });
            console.log('Loaded: ' + result.name + ' (' + params.length + ' params)');
            showToast(result.name + ' loaded (' + params.length + ' params)', 'success', 2500);
            renderAllPlugins(); updCounts(); saveUiStateToHost(); syncExpandedPlugins();
            // Update WrongEQ routing panel so unassigned plugins appear in the global section
            if (routingMode === 2 && typeof weqRenderPanel === 'function') weqRenderPanel();

            // Auto-assign to WrongEQ band if load was triggered from a band card
            if (typeof window._weqLoadTargetBand === 'number' && window._weqLoadTargetBand >= 0) {
                var bandIdx = window._weqLoadTargetBand;
                window._weqLoadTargetBand = -1; // consume
                if (typeof wrongEqPoints !== 'undefined' && wrongEqPoints[bandIdx]) {
                    var ept = wrongEqPoints[bandIdx];
                    if (!ept.pluginIds) ept.pluginIds = [];
                    if (typeof _weqEnsureUid === 'function') _weqEnsureUid(ept);
                    // Remove this plugin from any other band first
                    for (var oi = 0; oi < wrongEqPoints.length; oi++) {
                        if (!wrongEqPoints[oi].pluginIds) continue;
                        var oidx = wrongEqPoints[oi].pluginIds.indexOf(hostedId);
                        if (oidx >= 0) wrongEqPoints[oi].pluginIds.splice(oidx, 1);
                    }
                    ept.pluginIds.push(hostedId);
                    // Find the block we just pushed
                    var newBlock = pluginBlocks[pluginBlocks.length - 1];
                    if (newBlock && newBlock.id === hostedId) {
                        newBlock.busId = ept.uid || 0;
                    }
                    // Tell C++ about the bus routing
                    if (window.__JUCE__ && window.__JUCE__.backend) {
                        var busFn = window.__juceGetNativeFunction('setPluginBus');
                        busFn(hostedId, ept.uid || 0);
                    }
                    if (typeof weqSyncToHost === 'function') weqSyncToHost();
                    if (typeof weqRenderPanel === 'function') weqRenderPanel();
                    if (typeof markStateDirty === 'function') markStateDirty();
                    showToast(result.name + ' assigned to Band ' + (bandIdx + 1), 'success', 2000);
                }
            }
        } catch (uiErr) {
            // Plugin IS loaded in C++ — UI error shouldn't hide that
            console.error('Plugin loaded but UI update failed:', uiErr);
            showToast(plugName + ' loaded (UI refresh error — reopen plugin)', 'info', 4000);
        }
    }).catch(function (err) {
        removePlaceholderCard(placeholderId);
        if (typeof setPluginLoading === 'function') setPluginLoading(false);
        showLoadError(plugName, err);
    });
}
function removePlugin(pid) {
    var pb; for (var i = 0; i < pluginBlocks.length; i++) { if (pluginBlocks[i].id === pid) { pb = pluginBlocks[i]; break; } }
    if (!pb) return;
    if (pb.isVirtual) return; // cannot remove virtual blocks
    pushUndoSnapshot();
    // Call native removePlugin
    if (window.__JUCE__ && window.__JUCE__.backend) {
        var removeFn = window.__juceGetNativeFunction('removePlugin');
        removeFn(pb.hostId !== undefined ? pb.hostId : pid);
    }
    pb.params.forEach(function (p) { delete PMap[p.id]; blocks.forEach(function (b) { b.targets.delete(p.id); cleanBlockAfterUnassign(b, p.id); }); });
    // Clean up lane data referencing this plugin's params
    var pidPrefix = pb.hostId + ':';
    blocks.forEach(function (b) {
        if (!b.lanes) return;
        for (var li = b.lanes.length - 1; li >= 0; li--) {
            var lane = b.lanes[li];
            if (!lane.pids) continue;
            var before = lane.pids.length;
            lane.pids = lane.pids.filter(function (p) { return p.indexOf(pidPrefix) !== 0; });
            if (lane.pids.length < before) {
                // Also clean snapshot values
                if (lane.morphSnapshots) {
                    lane.morphSnapshots.forEach(function (snap) {
                        if (!snap.values) return;
                        Object.keys(snap.values).forEach(function (k) {
                            if (k.indexOf(pidPrefix) === 0) delete snap.values[k];
                        });
                    });
                }
                // Remove empty curve lanes (morph lanes kept — may have other plugin snapshots)
                if (lane.pids.length === 0 && !lane.morphMode) {
                    b.lanes.splice(li, 1);
                }
            }
        }
    });
    // Clean up stale link sources referencing this plugin's hostId
    var rmHostId = pb.hostId !== undefined ? pb.hostId : pid;
    blocks.forEach(function (b) {
        if (b.mode !== 'link' || !b.linkSources) return;
        b.linkSources = b.linkSources.filter(function (src) {
            return src.pluginId !== rmHostId;
        });
    });
    pluginBlocks = pluginBlocks.filter(function (p) { return p.id !== pid; });
    renderAllPlugins(); renderBlocks(); updCounts(); syncBlocksToHost(); syncExpandedPlugins();
    // Update WrongEQ routing panel (plugin may have been in a band or global)
    if (routingMode === 2 && typeof weqRenderPanel === 'function') weqRenderPanel();
}
// Full build of a single plugin card DOM element
var plugCtxPluginId = null;  // which plugin the context menu is targeting
function buildPluginCard(pb, pi, isA, aBlk, aCol) {
    var card = document.createElement('div'); card.className = 'pcard' + (pb.bypassed ? ' bypassed' : '') + (pb.isVirtual ? ' pcard-virtual' : '');
    card.setAttribute('data-plugidx', pi);
    card.setAttribute('data-plugid', pb.id);

    // Virtual blocks: not draggable, no close/bypass/open/preset
    if (pb.isVirtual) {
        var bulkBtns = isA ? '<button class="sm-btn bulk-all" style="font-size:9px;padding:2px 6px;margin-left:4px" data-plugbulk="' + pb.id + '" data-bulkmode="all">All</button><button class="sm-btn bulk-none" style="font-size:9px;padding:2px 6px" data-plugbulk="' + pb.id + '" data-bulkmode="none">None</button>' : '';
        card.innerHTML = '<div class="pcard-head pcard-head-virtual" data-plugid="' + pb.id + '"><span class="lchev ' + (pb.expanded ? 'open' : '') + '">&#9654;</span><span class="pcard-name" style="color:var(--accent)">' + pb.name + '</span><span class="pcard-info">' + pb.params.length + ' params</span>' + bulkBtns + '</div><div class="pcard-body ' + (pb.expanded ? '' : 'hide') + '"><div class="pcard-search"><input type="text" placeholder="Filter..." data-plugsearch="' + pb.id + '" value="' + (pb.searchFilter || '') + '"></div><div class="pcard-params" data-plugparams="' + pb.id + '"></div></div>';
        fillPluginParams(card.querySelector('[data-plugparams="' + pb.id + '"]'), pb, isA, aBlk, aCol);
        return card;
    }

    card.setAttribute('draggable', 'true');
    var bulkBtns = isA ? '<button class="sm-btn bulk-all" style="font-size:9px;padding:2px 6px;margin-left:4px" data-plugbulk="' + pb.id + '" data-bulkmode="all">All</button><button class="sm-btn bulk-none" style="font-size:9px;padding:2px 6px" data-plugbulk="' + pb.id + '" data-bulkmode="none">None</button>' : '';
    // Bus dropdown (parallel mode and WrongEQ mode)
    var busBadge = '';
    if (routingMode === 1) {
        var busIdx = pb.busId || 0;
        var busCol = BUS_COLORS[busIdx % BUS_COLORS.length];
        var opts = '';
        for (var bi = 0; bi < 7; bi++) {
            opts += '<option value="' + bi + '"' + (bi === busIdx ? ' selected' : '') + '>Bus ' + (bi + 1) + '</option>';
        }
        busBadge = '<span class="pcard-bus-wrap" style="background:' + busCol + '"><select class="pcard-bus-sel" data-plugbus="' + pb.id + '">' + opts + '</select></span>';
    } else if (routingMode === 2 && typeof wrongEqPoints !== 'undefined' && wrongEqPoints.length > 0) {
        var busIdx2 = pb.busId != null ? pb.busId : 0;
        var weqCol = typeof WEQ_BAND_COLORS !== 'undefined' ? WEQ_BAND_COLORS[Math.max(0, busIdx2) % WEQ_BAND_COLORS.length] : '#888';
        var opts2 = '<option value="0"' + (busIdx2 <= 0 ? ' selected' : '') + '>No Band</option>';
        for (var ei = 0; ei < wrongEqPoints.length; ei++) {
            var ePt = wrongEqPoints[ei];
            var eBusId = ePt.uid || (ei + 1);
            // Show Q-based frequency range instead of filter type
            var eRange = typeof weqBandRange === 'function' ? weqBandRange(ePt) : null;
            var eLabel = eRange
                ? 'B' + (ei + 1) + ' ' + weqFmtFreq(eRange.lo) + '–' + weqFmtFreq(eRange.hi)
                : 'B' + (ei + 1) + ' ' + (ePt.type || 'Bell');
            opts2 += '<option value="' + eBusId + '"' + (eBusId === busIdx2 ? ' selected' : '') + '>' + eLabel + '</option>';
        }
        busBadge = '<span class="pcard-bus-wrap" style="background:' + weqCol + '"><select class="pcard-bus-sel" data-plugbus="' + pb.id + '">' + opts2 + '</select></span>';
    }
    // Footer toolbar
    var footer = '<div class="pcard-foot">';
    footer += '<button class="pf-btn" data-pfrand="' + pb.id + '">Rand</button>';
    footer += '<div class="pf-snap-wrap"><button class="pf-btn" data-pfsnap="' + pb.id + '">Snap &#9662;</button>';
    footer += '<div class="pf-snap-menu" data-pfsnapmenu="' + pb.id + '"></div></div>';
    footer += '<div class="pf-snap-wrap"><button class="pf-btn" data-pfassign="' + pb.id + '">Assign &#9662;</button>';
    footer += '<div class="pf-snap-menu" data-pfassignmenu="' + pb.id + '"></div></div>';
    footer += '<div class="pf-snap-wrap"><button class="pf-btn" data-pfunassign="' + pb.id + '">Unassign &#9662;</button>';
    footer += '<div class="pf-snap-menu" data-pfunassignmenu="' + pb.id + '"></div></div>';
    // Bypass icon pushed to the right
    footer += '<button class="pf-bypass' + (pb.bypassed ? ' pf-active' : '') + '" data-pfbypass="' + pb.id + '" title="' + (pb.bypassed ? 'Unbypass' : 'Bypass') + '">&#9211;</button>';
    footer += '</div>';
    card.innerHTML = '<div class="pcard-head" data-plugid="' + pb.id + '">' + busBadge + '<span class="lchev ' + (pb.expanded ? 'open' : '') + '">&#9654;</span><span class="pcard-name">' + pb.name + '</span><span class="pcard-info">' + pb.params.length + ' params</span>' + bulkBtns + '<button class="pcard-preset" data-plugpreset="' + pb.id + '" title="Presets">&#128203;</button><button class="sm-btn" style="font-size:9px;padding:2px 6px" data-pluged="' + pb.id + '">Open</button><button class="pcard-close" data-plugrm="' + pb.id + '">x</button></div><div class="pcard-body ' + (pb.expanded ? '' : 'hide') + '"><div class="pcard-search"><input type="text" placeholder="Filter..." data-plugsearch="' + pb.id + '" value="' + (pb.searchFilter || '') + '"></div><div class="pcard-params" data-plugparams="' + pb.id + '"></div></div>' + footer;
    fillPluginParams(card.querySelector('[data-plugparams="' + pb.id + '"]'), pb, isA, aBlk, aCol);
    return card;
}
// Fill param rows into a container element (used by both full build and patch)
function fillPluginParams(paramC, pb, isA, aBlk, aCol) {
    var filter = (pb.searchFilter || '').toLowerCase();
    var srBlock = (isA && aBlk && aBlk.mode === 'shapes_range') ? aBlk : null;

    // Build filtered param list
    var filteredParams = [];
    for (var i = 0; i < pb.params.length; i++) {
        var p = pb.params[i];
        if (filter && p.name.toLowerCase().indexOf(filter) === -1) continue;
        filteredParams.push(p);
    }

    // For small param counts, render all rows directly (no virtual scroll overhead)
    var VIRTUAL_THRESHOLD = 100;
    if (filteredParams.length <= VIRTUAL_THRESHOLD) {
        paramC._vScroll = false;
        paramC.innerHTML = '';
        for (var i = 0; i < filteredParams.length; i++) {
            paramC.appendChild(_buildParamRow(filteredParams[i], isA, aBlk, aCol, srBlock));
        }
        paramC.onscroll = null;
        return;
    }

    // Virtual scrolling for large param counts
    var ROW_H = 36; // matches CSS .pr { height: 36px }
    var savedScroll = paramC.scrollTop || 0;

    paramC._vScroll = true;
    paramC._vParams = filteredParams;
    paramC._vRowH = ROW_H;
    paramC._vIsA = isA;
    paramC._vABlk = aBlk;
    paramC._vACol = aCol;
    paramC._vSrBlock = srBlock;
    paramC._vRendered = {}; // pid → { row, idx }
    paramC._vStart = -1;
    paramC._vEnd = -1;
    paramC.innerHTML = '';

    // Sentinel div provides scroll height
    var sentinel = document.createElement('div');
    sentinel.style.height = (filteredParams.length * ROW_H) + 'px';
    sentinel.style.pointerEvents = 'none';
    paramC.appendChild(sentinel);

    // Restore scroll position (survives re-render from assign-mode toggle etc.)
    paramC.scrollTop = savedScroll;

    // Render visible rows
    _updateVirtualRows(paramC);

    // Scroll handler — debounced via rAF
    paramC.onscroll = function () {
        if (!paramC._vRaf) {
            paramC._vRaf = requestAnimationFrame(function () {
                paramC._vRaf = null;
                _updateVirtualRows(paramC);
            });
        }
    };
}

// Build a single absolute-positioned or flow-positioned param row
function _buildParamRow(p, isA, aBlk, aCol, srBlock) {
    var isTgt = isA && aBlk && aBlk.targets.has(p.id);
    var row = document.createElement('div');
    row.className = 'pr' + (p.lk ? ' locked' : '') + (isA && !p.lk ? ' assign-highlight' : '') + (selectedParams.has(p.id) ? ' selected' : '');
    row.setAttribute('data-pid', p.id);
    if (!p.lk) row.setAttribute('draggable', 'true');
    if (isTgt) { row.style.background = aCol + '18'; row.style.borderColor = aCol + '66'; }
    var dots = ''; for (var bi = 0; bi < blocks.length; bi++) { if (blocks[bi].targets.has(p.id)) dots += '<span class="pr-dot" style="background:' + bColor(blocks[bi].colorIdx) + '"></span>'; }
    // SVG rotary knob — arc from assign-mode block (priority) or getModArcInfo
    var rangeInfo = null;
    if (srBlock && isTgt) {
        var rng = srBlock.targetRanges && srBlock.targetRanges[p.id] !== undefined ? srBlock.targetRanges[p.id] : 0;
        var base = srBlock.targetRangeBases && srBlock.targetRangeBases[p.id] !== undefined ? srBlock.targetRangeBases[p.id] : p.v;
        rangeInfo = { range: rng, base: base, color: aCol, polarity: srBlock.shapePolarity || 'bipolar' };
    } else if (!srBlock) {
        rangeInfo = getModArcInfo(p.id);
        if (rangeInfo) {
            var cur = computeModCurrent(rangeInfo, p.v);
            if (cur !== null) rangeInfo.current = cur;
        }
    }
    var knobVal = (rangeInfo && rangeInfo.base !== undefined) ? rangeInfo.base : p.v;
    var knobSvg = buildParamKnob(knobVal, 30, rangeInfo);
    var grip = p.lk ? '' : '<span class="pr-grip" title="Drag to logic block">⠿</span>';
    // Check if this param is a link source — O(1) via pre-built lookup table
    var linkSrcIndicator = '';
    if (_linkSrcLookup) {
        var lsKey = p.hostId + ':' + p.realIndex;
        var lsEntry = _linkSrcLookup[lsKey];
        if (lsEntry) {
            linkSrcIndicator = '<span class="pr-link-src" style="color:' + lsEntry.color + '" title="Link source (Block ' + lsEntry.blockNum + ')">&#9670;</span>';
        }
    }
    row.innerHTML = grip + '<div class="pr-knob" data-pid="' + p.id + '" data-hid="' + (p.hostId !== undefined ? p.hostId : '') + '" data-ri="' + (p.realIndex !== undefined ? p.realIndex : '') + '">' + knobSvg + '</div><span class="pr-name">' + p.name + '</span>' + linkSrcIndicator + '<div class="pr-dots">' + dots + '</div><span class="pr-val">' + (p.disp || ((p.v * 100).toFixed(0) + '%')) + '</span><div class="pr-bar"><div class="pr-bar-f" style="width:' + (p.v * 100) + '%"></div></div>' + (p.lk ? '<span class="pr-lock">' + (p.alk ? '&#9888;' : '&#128274;') + '</span>' : '');
    return row;
}

// Update which rows are in the DOM for a virtual-scroll param container
function _updateVirtualRows(paramC) {
    var params = paramC._vParams;
    if (!params) return;
    var ROW_H = paramC._vRowH;
    var scrollTop = paramC.scrollTop;
    var viewH = paramC.clientHeight;
    if (viewH <= 0) {
        // Container not laid out yet — retry after next paint
        if (!paramC._vRetry) {
            paramC._vRetry = requestAnimationFrame(function () {
                paramC._vRetry = null;
                _updateVirtualRows(paramC);
            });
        }
        return;
    }

    var BUFFER = 5; // extra rows above/below viewport
    var startIdx = Math.max(0, Math.floor(scrollTop / ROW_H) - BUFFER);
    var endIdx = Math.min(params.length - 1, Math.ceil((scrollTop + viewH) / ROW_H) + BUFFER);

    if (startIdx === paramC._vStart && endIdx === paramC._vEnd) return;

    var rendered = paramC._vRendered;

    // Remove rows that scrolled out of range
    for (var pid in rendered) {
        var entry = rendered[pid];
        if (entry.idx < startIdx || entry.idx > endIdx) {
            entry.row.remove();
            delete rendered[pid];
        }
    }

    // Add rows that scrolled into range
    for (var i = startIdx; i <= endIdx; i++) {
        var p = params[i];
        if (rendered[p.id]) continue;
        var row = _buildParamRow(p, paramC._vIsA, paramC._vABlk, paramC._vACol, paramC._vSrBlock);
        row.style.position = 'absolute';
        row.style.top = (i * ROW_H) + 'px';
        row.style.left = '0';
        row.style.right = '0';
        row.style.height = ROW_H + 'px';
        row.style.boxSizing = 'border-box';
        paramC.appendChild(row);
        rendered[p.id] = { row: row, idx: i };
    }

    paramC._vStart = startIdx;
    paramC._vEnd = endIdx;
}

// Scroll a virtual-scroll container to reveal a specific param ID
function scrollVirtualToParam(pid) {
    var containers = document.querySelectorAll('.pcard-params');
    for (var ci = 0; ci < containers.length; ci++) {
        var paramC = containers[ci];
        if (!paramC._vScroll || !paramC._vParams) continue;
        for (var i = 0; i < paramC._vParams.length; i++) {
            if (paramC._vParams[i].id === pid) {
                paramC.scrollTop = i * paramC._vRowH;
                _updateVirtualRows(paramC);
                return true;
            }
        }
    }
    return false;
}
// Build a small SVG arc knob for value 0..1, with optional modulation arc
// rangeInfo: { range, color, polarity, base, current? }
// When current is provided: dot at base, live fill from base→current, faint range band
// When current is absent: dot at val, static range band only
function buildParamKnob(val, size, rangeInfo) {
    var r = size / 2, cx = r, cy = r;
    var ir = r - 3; // inner radius for arc
    var startAngle = 135 * Math.PI / 180; // 7 o'clock
    var endAngle = 405 * Math.PI / 180;   // 5 o'clock
    var span = endAngle - startAngle;      // 270°
    // Background track arc
    var tPath = describeArc(cx, cy, ir, startAngle, endAngle);
    // Determine knob dot position: base if modulating live, else val
    var dotVal = (rangeInfo && rangeInfo.current !== undefined && rangeInfo.base !== undefined) ? rangeInfo.base : val;
    var va = startAngle + dotVal * span;
    // Value arc (white): from min to dot position
    var vPath = dotVal > 0.005 ? describeArc(cx, cy, ir, startAngle, va) : '';
    // Indicator dot position
    var dx = cx + ir * Math.cos(va), dy = cy + ir * Math.sin(va);
    var svg = '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">';
    svg += '<path d="' + tPath + '" fill="none" stroke="var(--knob-track)" stroke-width="2.5" stroke-linecap="round"/>';
    if (vPath) svg += '<path d="' + vPath + '" fill="none" stroke="var(--knob-value)" stroke-width="2.5" stroke-linecap="round"/>';
    // Modulation arc rendering
    if (rangeInfo && Math.abs(rangeInfo.range) > 0.001) {
        var rng = rangeInfo.range;
        var absRng = Math.abs(rng);
        var base = rangeInfo.base !== undefined ? rangeInfo.base : val;
        var pol = rangeInfo.polarity || 'bipolar';
        var arcCol = rangeInfo.color || 'var(--range-arc, #ff8c42)';
        var rInner = ir - 0.5;
        var rOuter = ir + 3;
        // 1) Static range band (faint) — shows where modulation CAN go
        var rStart, rEnd;
        if (pol === 'bipolar') {
            rStart = Math.max(base - absRng, 0);
            rEnd = Math.min(base + absRng, 1);
        } else if (pol === 'up') {
            rStart = base;
            rEnd = Math.min(base + absRng, 1);
        } else if (pol === 'down') {
            rStart = Math.max(base - absRng, 0);
            rEnd = base;
        } else {
            if (rng > 0) { rStart = base; rEnd = Math.min(base + rng, 1); }
            else { rStart = Math.max(base + rng, 0); rEnd = base; }
        }
        var raStart = startAngle + rStart * span;
        var raEnd = startAngle + rEnd * span;
        if (raEnd > raStart + 0.01) {
            var bandPath = describeArcBand(cx, cy, rInner, rOuter, raStart, raEnd);
            svg += '<path d="' + bandPath + '" fill="' + arcCol + '" opacity="0.15"/>';
            var outerArc = describeArc(cx, cy, rOuter, raStart, raEnd);
            svg += '<path d="' + outerArc + '" fill="none" stroke="' + arcCol + '" stroke-width="0.5" stroke-linecap="round" opacity="0.4"/>';
        }
        // 2) Dynamic fill arc (bright) — shows where modulation IS right now
        // Fills from base to current modulated position
        if (rangeInfo.current !== undefined) {
            var cur = Math.max(0, Math.min(1, rangeInfo.current));
            var fStart, fEnd;
            if (cur >= base) {
                fStart = base;
                fEnd = cur;
            } else {
                fStart = cur;
                fEnd = base;
            }
            var faStart = startAngle + fStart * span;
            var faEnd = startAngle + fEnd * span;
            if (faEnd > faStart + 0.005) {
                var fillPath = describeArcBand(cx, cy, rInner, rOuter, faStart, faEnd);
                svg += '<path d="' + fillPath + '" fill="' + arcCol + '" opacity="0.55"/>';
                var fillEdge = describeArc(cx, cy, rOuter, faStart, faEnd);
                svg += '<path d="' + fillEdge + '" fill="none" stroke="' + arcCol + '" stroke-width="1" stroke-linecap="round" opacity="0.9"/>';
            }
        }
        // 3) Base marker tick
        var baseAngle = startAngle + base * span;
        var bx1 = cx + (ir - 2) * Math.cos(baseAngle);
        var by1 = cy + (ir - 2) * Math.sin(baseAngle);
        var bx2 = cx + (rOuter + 1) * Math.cos(baseAngle);
        var by2 = cy + (rOuter + 1) * Math.sin(baseAngle);
        svg += '<line x1="' + bx1.toFixed(1) + '" y1="' + by1.toFixed(1) + '" x2="' + bx2.toFixed(1) + '" y2="' + by2.toFixed(1) + '" stroke="' + arcCol + '" stroke-width="1.2" opacity="0.7"/>';
    }
    svg += '<circle cx="' + dx.toFixed(1) + '" cy="' + dy.toFixed(1) + '" r="2.5" fill="var(--knob-dot)"/>';
    svg += '</svg>';
    return svg;
}
// Filled arc band between two radii (annular sector)
function describeArcBand(cx, cy, rInner, rOuter, start, end) {
    var osx = cx + rOuter * Math.cos(start), osy = cy + rOuter * Math.sin(start);
    var oex = cx + rOuter * Math.cos(end), oey = cy + rOuter * Math.sin(end);
    var isx = cx + rInner * Math.cos(end), isy = cy + rInner * Math.sin(end);
    var iex = cx + rInner * Math.cos(start), iey = cy + rInner * Math.sin(start);
    var large = (end - start > Math.PI) ? 1 : 0;
    return 'M ' + osx.toFixed(2) + ' ' + osy.toFixed(2) +
        ' A ' + rOuter + ' ' + rOuter + ' 0 ' + large + ' 1 ' + oex.toFixed(2) + ' ' + oey.toFixed(2) +
        ' L ' + isx.toFixed(2) + ' ' + isy.toFixed(2) +
        ' A ' + rInner + ' ' + rInner + ' 0 ' + large + ' 0 ' + iex.toFixed(2) + ' ' + iey.toFixed(2) +
        ' Z';
}
function describeArc(cx, cy, r, start, end) {
    var sx = cx + r * Math.cos(start), sy = cy + r * Math.sin(start);
    var ex = cx + r * Math.cos(end), ey = cy + r * Math.sin(end);
    var large = (end - start > Math.PI) ? 1 : 0;
    return 'M ' + sx.toFixed(2) + ' ' + sy.toFixed(2) + ' A ' + r + ' ' + r + ' 0 ' + large + ' 1 ' + ex.toFixed(2) + ' ' + ey.toFixed(2);
}
// ── Modulation Arc Registry ──
// Each continuous block type registers a descriptor:
//   getDepth(block, pid) → number (0..1 range band for arc)
//   getPolarity(block)   → 'bipolar'|'up'|'down'|'unipolar'
//   getOutput(block, pid) → number|null (readback value for fill animation)
// To add a new block type: add ONE entry here. Everything else is generic.
var MOD_ARC_REGISTRY = {
    shapes: {
        getDepth: function (b) { return (b.shapeSize != null ? b.shapeSize : 80) / 200; },
        getPolarity: function (b) { return b.shapePolarity || 'bipolar'; },
        // Readback: bipolar output -1..1 from morphHeads
        getOutput: function (b) { return b.shapeModOutput || 0; },
        outputType: 'bipolar' // -1..1
    },
    shapes_range: {
        getDepth: function (b, pid) { return Math.abs(b.targetRanges && b.targetRanges[pid] !== undefined ? b.targetRanges[pid] : 0); },
        getPolarity: function (b) { return b.shapePolarity || 'bipolar'; },
        getOutput: function (b) { return b.shapeModOutput || 0; },
        outputType: 'bipolar'
    },
    envelope: {
        getDepth: function (b) { return (b.rMax != null ? b.rMax : 100) / 100; },
        getPolarity: function (b) { return b.polarity || 'bipolar'; },
        // Readback: unipolar output 0..1 from envLevels
        getOutput: function (b) { return b.envModOutput || 0; },
        outputType: 'unipolar' // 0..1
    },
    sample: {
        getDepth: function (b) { return (b.rMax != null ? b.rMax : 100) / 100; },
        getPolarity: function (b) { return b.polarity || 'bipolar'; },
        getOutput: function (b) { return null; }, // No readback yet — falls back to p.v
        outputType: 'unipolar'
    },
    lane: {
        // Lane: absolute mode — scan drawn points (curve) or morph snapshots to find min/max
        getDepth: function (b, pid) {
            var minVal = 1, maxVal = 0, found = false;
            if (!b.lanes) return 0;
            for (var li = 0; li < b.lanes.length; li++) {
                var lane = b.lanes[li];
                if (lane.muted) continue;
                // O(1) set lookup instead of O(n) array scan for pid membership
                if (lane.pids) {
                    if (!lane._pidsSet || lane._pidsSet._ver !== lane.pids.length) {
                        lane._pidsSet = new Set(lane.pids);
                        lane._pidsSet._ver = lane.pids.length;
                    }
                    if (!lane._pidsSet.has(pid)) continue;
                } else { continue; }
                var ld = (lane.depth != null ? lane.depth : 100) / 100.0;

                if (lane.morphMode && lane.morphSnapshots && lane.morphSnapshots.length > 0) {
                    // Morph lane: scan all snapshot values for this param
                    for (var si = 0; si < lane.morphSnapshots.length; si++) {
                        var sv = lane.morphSnapshots[si].values[pid];
                        if (sv === undefined) continue;
                        var paramVal = 0.5 + (sv - 0.5) * ld;
                        paramVal = Math.max(0, Math.min(1, paramVal));
                        if (!found) { minVal = paramVal; maxVal = paramVal; found = true; }
                        else { if (paramVal < minVal) minVal = paramVal; if (paramVal > maxVal) maxVal = paramVal; }
                    }
                } else if (lane.pts && lane.pts.length > 0) {
                    // Curve lane: scan drawn points
                    for (var pi = 0; pi < lane.pts.length; pi++) {
                        var paramVal = 1.0 - lane.pts[pi].y;
                        paramVal = 0.5 + (paramVal - 0.5) * ld;
                        paramVal = Math.max(0, Math.min(1, paramVal));
                        if (!found) { minVal = paramVal; maxVal = paramVal; found = true; }
                        else { if (paramVal < minVal) minVal = paramVal; if (paramVal > maxVal) maxVal = paramVal; }
                    }
                }
                if (found) {
                    // Expand range to account for drift amplitude
                    var driftAmt = Math.abs(lane.drift || 0);
                    var driftRangeNorm = (lane.driftRange != null ? lane.driftRange : 5) / 100;
                    if (driftAmt > 0.001 && driftRangeNorm > 0.001) {
                        minVal = Math.max(0, minVal - driftRangeNorm);
                        maxVal = Math.min(1, maxVal + driftRangeNorm);
                    }
                    b._laneArcMin = minVal;
                    b._laneArcMax = maxVal;
                }
            }
            if (!found) return 0;
            return (maxVal - minVal) / 2;
        },
        getPolarity: function (b) { return 'bipolar'; },
        // Readback: absolute 0..1 value — morph lanes compute per-param interpolation
        getOutput: function (b, pid) {
            if (!b.laneModOutputs || !pid) return undefined;
            var rawVal = b.laneModOutputs[pid];
            if (rawVal === undefined) return undefined;
            return rawVal;
        },
        outputType: 'absolute' // 0..1 direct parameter value
    },
    morph_pad: {
        // Depth: scan all snapshot values for this param to find the modulation range
        getDepth: function (b, pid) {
            if (!b.snapshots || b.snapshots.length < 2) return 0;
            var minVal = 1, maxVal = 0, found = false;
            for (var si = 0; si < b.snapshots.length; si++) {
                var sv = b.snapshots[si].values && b.snapshots[si].values[pid];
                if (sv === undefined) continue;
                if (!found) { minVal = sv; maxVal = sv; found = true; }
                else { if (sv < minVal) minVal = sv; if (sv > maxVal) maxVal = sv; }
            }
            if (!found) return 0;
            b._morphPadArcMin = minVal;
            b._morphPadArcMax = maxVal;
            return (maxVal - minVal) / 2;
        },
        getPolarity: function (b) { return 'bipolar'; },
        // Readback: absolute 0..1 value — IDW interpolation computed in realtime.js
        getOutput: function (b, pid) {
            if (!b.morphPadOutputs || !pid) return undefined;
            var rawVal = b.morphPadOutputs[pid];
            if (rawVal === undefined) return undefined;
            return rawVal;
        },
        outputType: 'absolute' // 0..1 direct parameter value
    },
    link: {
        // Link: absolute direct mapping (Bitwig macro style)
        // Arc shows the min→max range on the knob
        getDepth: function (b, pid) {
            var lo = b.linkMin && b.linkMin[pid] !== undefined ? b.linkMin[pid] : 0;
            var hi = b.linkMax && b.linkMax[pid] !== undefined ? b.linkMax[pid] : 100;
            // Store min/max for arc rendering (0..1 scale)
            b._linkArcMin = lo / 100;
            b._linkArcMax = hi / 100;
            // Half-range for arc width
            return Math.abs(hi - lo) / 200;
        },
        getPolarity: function (b) { return 'bipolar'; },
        getOutput: function (b, pid) {
            // Return the current parameter value directly — C++ uses writeModBase
            var p = PMap[pid];
            if (!p) return undefined;
            return p.v;
        },
        outputType: 'absolute' // 0..1 direct parameter value
    }
};

// Convert a readback output + polarity to a signed offset for the arc fill
function modOutputToOffset(output, depth, polarity, outputType) {
    if (output === null || output === undefined) return null;
    if (outputType === 'bipolar') {
        // -1..1 → signed offset
        if (polarity === 'bipolar') return output * depth;
        if (polarity === 'up') return Math.abs(output) * depth;
        if (polarity === 'down') return -Math.abs(output) * depth;
        return ((output + 1) * 0.5) * depth; // unipolar
    }
    if (outputType === 'unipolar') {
        // 0..1 → signed offset
        if (polarity === 'bipolar') return (output * 2 - 1) * depth;
        if (polarity === 'up') return output * depth;
        if (polarity === 'down') return -output * depth;
        return output * depth;
    }
    if (outputType === 'centered') {
        // 0..1 centered at 0.5 → signed offset
        return (output - 0.5) * 2 * depth;
    }
    if (outputType === 'absolute') {
        // 0..1 direct value — return as-is (caller handles positioning)
        return output;
    }
    return null;
}

// ── getModArcInfo(pid) ──
// Returns { range, base, color, polarity, sources, pid } or null.
function getModArcInfo(pid) {
    // Special case: shapes_range as sole modulator uses per-param range
    for (var bi = 0; bi < blocks.length; bi++) {
        var b = blocks[bi];
        if (b.enabled === false || !b.targets.has(pid) || b.mode !== 'shapes_range') continue;
        var reg = MOD_ARC_REGISTRY.shapes_range;
        var d = reg.getDepth(b, pid);
        if (d < 0.001) continue;
        // Check if it's the only modulator
        var alone = true;
        for (var bi2 = 0; bi2 < blocks.length; bi2++) {
            if (bi2 === bi) continue;
            var b2 = blocks[bi2];
            if (b2.enabled !== false && b2.targets.has(pid) && b2.mode !== 'randomize') { alone = false; break; }
        }
        if (alone) {
            var rng = b.targetRanges && b.targetRanges[pid] !== undefined ? b.targetRanges[pid] : 0;
            var base = b.targetRangeBases && b.targetRangeBases[pid] !== undefined ? b.targetRangeBases[pid] : 0.5;
            var pol = reg.getPolarity(b);
            var sign = rng < 0 ? -1 : 1;
            return { range: rng, base: base, color: bColor(b.colorIdx), polarity: pol, sources: [{ block: b, depth: d, polarity: pol, reg: reg, rangeSign: sign }], pid: pid };
        }
    }

    // General pass: collect all continuous blocks targeting this param
    var totalDepth = 0, firstBase = null, firstColor = null;
    var sources = [];
    for (var bi = 0; bi < blocks.length; bi++) {
        var b = blocks[bi];
        if (b.enabled === false || !b.targets.has(pid)) continue;
        var reg = MOD_ARC_REGISTRY[b.mode];
        if (!reg) continue; // Skip non-continuous blocks (randomize, morph_pad, unknown)
        var d = reg.getDepth(b, pid);
        if (d < 0.001) continue;
        var pol = reg.getPolarity(b);
        totalDepth += d;
        var srcEntry = { block: b, depth: d, polarity: pol, reg: reg };
        // shapes_range: carry per-param range sign so fill arc flips for negative ranges
        if (b.mode === 'shapes_range' && b.targetRanges && b.targetRanges[pid] !== undefined && b.targetRanges[pid] < 0) {
            srcEntry.rangeSign = -1;
        }
        sources.push(srcEntry);
        if (!firstColor) {
            firstColor = bColor(b.colorIdx);
            // For absolute (lane/morph_pad/link) blocks, use the midpoint of the value range as base
            if (reg.outputType === 'absolute' && b._laneArcMin !== undefined) {
                firstBase = (b._laneArcMin + b._laneArcMax) / 2;
            } else if (reg.outputType === 'absolute' && b._morphPadArcMin !== undefined) {
                firstBase = (b._morphPadArcMin + b._morphPadArcMax) / 2;
            } else if (b.mode === 'link' && b._linkArcMin !== undefined) {
                // Link: arc centered on midpoint of min/max range
                firstBase = (b._linkArcMin + b._linkArcMax) / 2;
            } else {
                firstBase = b.targetBases && b.targetBases[pid] !== undefined ? b.targetBases[pid] : 0.5;
            }
        }
    }
    if (sources.length === 0 || totalDepth < 0.001) return null;
    return {
        range: totalDepth, base: firstBase, color: firstColor,
        polarity: sources.length === 1 ? sources[0].polarity : 'bipolar',
        sources: sources, pid: pid
    };
}

// ── computeModCurrent(ri, paramVal) ──
// Sums all source readback offsets to get the combined fill position.
function computeModCurrent(ri, paramVal) {
    if (!ri || !ri.sources || ri.sources.length === 0) return null;
    var totalOffset = 0, hasReadback = false, hasAbsolute = false, absoluteVal = 0;
    for (var si = 0; si < ri.sources.length; si++) {
        var src = ri.sources[si];
        var out = src.reg.getOutput(src.block, ri.pid);
        if (src.reg.outputType === 'absolute') {
            // Absolute sources: readback IS the parameter position
            if (out !== null && out !== undefined) {
                absoluteVal = out;
                hasAbsolute = true;
                hasReadback = true;
            }
        } else {
            var off = modOutputToOffset(out, src.depth, src.polarity, src.reg.outputType);
            if (off !== null) {
                // shapes_range: flip offset direction when per-param range is negative
                if (src.rangeSign && src.rangeSign < 0) off = -off;
                totalOffset += off;
                hasReadback = true;
            }
        }
    }
    if (hasAbsolute) return Math.max(0, Math.min(1, absoluteVal + totalOffset));
    if (hasReadback) return Math.max(0, Math.min(1, ri.base + totalOffset));
    if (paramVal !== undefined) return paramVal;
    return null;
}

// ── updateModBases(pid, newVal) ──
// Update stored base for all modulation blocks targeting a param (called on user knob drag).
function updateModBases(pid, newVal) {
    for (var bi = 0; bi < blocks.length; bi++) {
        var b = blocks[bi];
        if (!b.targets.has(pid)) continue;
        if (b.mode === 'shapes_range') {
            if (!b.targetRangeBases) b.targetRangeBases = {};
            b.targetRangeBases[pid] = newVal;
        }
        if (b.mode === 'link') {
            if (!b.linkBases) b.linkBases = {};
            b.linkBases[pid] = newVal;
        }
        if (!b.targetBases) b.targetBases = {};
        b.targetBases[pid] = newVal;
    }
}
// Stamp for detecting structural changes (plugin add/remove/reorder)
var _pluginStamp = '';
var _expectedChildCount = 0;
function getPluginStamp() { return pluginBlocks.map(function (pb) { return pb.id + ':' + (pb.busId || 0); }).join(',') + '|' + (assignMode !== null ? assignMode : '') + '|' + routingMode + '|' + busMutes.join(',') + '|' + busSolos.join(',') + '|' + busCollapsed.join(',') + '|weq' + wrongEqPoints.map(function (p) { return (p.mute ? 'm' : '') + (p.solo ? 's' : '') + (p.preEq !== false ? 'e' : ''); }).join(''); }
// dB <-> linear helpers for bus volume
function linToDb(lin) { return lin <= 0.001 ? -60 : 20 * Math.log10(lin); }
function dbToLin(db) { return db <= -59.9 ? 0 : Math.pow(10, db / 20); }
function fmtDb(db) { return db <= -59.9 ? '-\u221E' : (db >= 0 ? '+' : '') + db.toFixed(1); }

// Pre-computed link-source lookup table: pluginId:paramIndex → {color, blockNum}
// Built once per render pass, consumed by _buildParamRow for O(1) diamond indicators.
var _linkSrcLookup = null;
function _rebuildLinkSrcLookup() {
    _linkSrcLookup = {};
    for (var lbi = 0; lbi < blocks.length; lbi++) {
        var lb = blocks[lbi];
        if (lb.mode !== 'link' || !lb.linkSources || !lb.enabled) continue;
        var col = bColor(lb.colorIdx);
        for (var lsi = 0; lsi < lb.linkSources.length; lsi++) {
            var ls = lb.linkSources[lsi];
            var key = ls.pluginId + ':' + ls.paramIndex;
            if (!_linkSrcLookup[key]) {
                _linkSrcLookup[key] = { color: col, blockNum: lbi + 1 };
            }
        }
    }
}

function renderAllPlugins() {
    // Don't rebuild during preset loading — would destroy placeholder cards
    if (typeof gpLoadInProgress !== 'undefined' && gpLoadInProgress) return;

    // Rebuild link-source lookup table (used by _buildParamRow for diamond indicators)
    _rebuildLinkSrcLookup();

    var c = document.getElementById('pluginScroll');
    var isA = assignMode !== null, aBlk = isA ? findBlock(assignMode) : null, aCol = isA && aBlk ? bColor(aBlk.colorIdx) : '';
    var newStamp = getPluginStamp();

    // Detach any loading placeholder cards so they survive the rebuild
    var placeholders = Array.from(c.querySelectorAll('.pcard-loading'));
    placeholders.forEach(function (ph) { ph.remove(); });

    // Exclude placeholders from child count comparison
    var realChildCount = c.childElementCount;

    // STRUCTURAL CHANGE: different plugins or order — full rebuild
    if (newStamp !== _pluginStamp || realChildCount !== _expectedChildCount) {
        _pluginStamp = newStamp;
        var savedPlugScroll = c.scrollTop;
        c.innerHTML = '';

        if (routingMode === 1) {
            // PARALLEL MODE: group plugins by bus, add bus header before each group
            var busGroups = {};
            for (var pi = 0; pi < pluginBlocks.length; pi++) {
                var bid = pluginBlocks[pi].busId || 0;
                if (!busGroups[bid]) busGroups[bid] = [];
                busGroups[bid].push(pi);
            }
            var sortedBuses = Object.keys(busGroups).map(Number).sort();
            for (var bi = 0; bi < sortedBuses.length; bi++) {
                var bus = sortedBuses[bi];
                var col = BUS_COLORS[bus % BUS_COLORS.length];
                var linVol = busVolumes[bus] != null ? busVolumes[bus] : 1;
                var dbVal = linToDb(linVol);
                var muted = busMutes[bus] || false;
                var soloed = busSolos[bus] || false;
                var collapsed = busCollapsed[bus] || false;
                var plugCount = busGroups[bus].length;
                // Bus group container
                var grp = document.createElement('div');
                grp.className = 'bus-group' + (muted ? ' bus-muted' : '');
                grp.style.setProperty('--bus-tint', col);
                // Bus header strip
                var hdr = document.createElement('div');
                hdr.className = 'bus-header' + (soloed ? ' bus-soloed' : '');
                hdr.dataset.bus = bus;
                hdr.innerHTML = '<span class="bus-chev' + (collapsed ? '' : ' open') + '">&#9654;</span>' +
                    '<span class="bus-color-dot" style="background:' + col + '"></span>' +
                    '<span class="bus-name">Bus ' + (bus + 1) + (collapsed ? ' <span class="bus-count">(' + plugCount + ')</span>' : '') + '</span>' +
                    '<input type="range" class="bus-vol-slider" min="-60" max="6" step="0.1" value="' + dbVal.toFixed(1) + '" data-busvol="' + bus + '" title="' + fmtDb(dbVal) + ' dB">' +
                    '<span class="bus-vol-label" data-busvolval="' + bus + '">' + fmtDb(dbVal) + '</span>' +
                    '<button class="bus-mute-btn' + (muted ? ' on' : '') + '" data-busmute="' + bus + '">M</button>' +
                    '<button class="bus-solo-btn' + (soloed ? ' on' : '') + '" data-bussolo="' + bus + '">S</button>';
                grp.appendChild(hdr);
                // Plugins in this bus (hidden when collapsed)
                for (var gi = 0; gi < busGroups[bus].length; gi++) {
                    var idx = busGroups[bus][gi];
                    var card = buildPluginCard(pluginBlocks[idx], idx, isA, aBlk, aCol);
                    if (collapsed) card.style.display = 'none';
                    grp.appendChild(card);
                }
                c.appendChild(grp);
            }
        } else if (routingMode === 2 && typeof wrongEqPoints !== 'undefined' && wrongEqPoints.length > 0) {
            // WRONGEQ MODE: group plugins by EQ band bus (UID-based)
            // Bus IDs: 0 = unassigned, pt.uid = assigned to that EQ point
            var weqBusGroups = { 0: [] }; // always have unassigned group
            for (var pi = 0; pi < pluginBlocks.length; pi++) {
                var bid = pluginBlocks[pi].busId || 0;
                if (!weqBusGroups[bid]) weqBusGroups[bid] = [];
                weqBusGroups[bid].push(pi);
            }
            // Ensure all EQ points have a group even if empty (by UID, not index)
            for (var ei = 0; ei < wrongEqPoints.length; ei++) {
                _weqEnsureUid(wrongEqPoints[ei]);
                var ebid = wrongEqPoints[ei].uid;
                if (!weqBusGroups[ebid]) weqBusGroups[ebid] = [];
            }
            var weqSorted = Object.keys(weqBusGroups).map(Number).sort();
            var wBandColors = typeof WEQ_BAND_COLORS !== 'undefined' ? WEQ_BAND_COLORS : ['#ff6464', '#64b4ff', '#64dc8c', '#ffc850', '#c882ff', '#ff8cb4', '#50dcdc'];
            for (var wbi = 0; wbi < weqSorted.length; wbi++) {
                var wbus = weqSorted[wbi];
                // Find the EQ point by UID (not by index)
                var wPt = null;
                var wPtIdx = -1;
                for (var fpi = 0; fpi < wrongEqPoints.length; fpi++) {
                    if (wrongEqPoints[fpi].uid === wbus) {
                        wPt = wrongEqPoints[fpi];
                        wPtIdx = fpi;
                        break;
                    }
                }
                var wCol = wPt ? _weqPointColor(wPt) : '#555';
                var wPlugs = weqBusGroups[wbus];
                var wCollapsed = busCollapsed[wbus] || false;
                var wMuted = wPt ? (wPt.mute || false) : false;
                var wSoloed = wPt ? (wPt.solo || false) : false;
                var wPreEq = wPt ? (wPt.preEq !== false) : true;
                // Band label
                var wLabel;
                if (!wPt) {
                    wLabel = 'Unassigned';
                } else {
                    // Label with Q-derived range: "B1 Bell 1kHz [500Hz–2kHz]"
                    var wFreq = typeof weqXToFreq === 'function' ? weqXToFreq(wPt.x) : 0;
                    var wFreqStr = wFreq >= 1000 ? (wFreq / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : Math.round(wFreq) + '';
                    var wType = wPt.type || 'Bell';
                    var wRangeStr = typeof weqFmtRange === 'function' ? ' [' + weqFmtRange(wPt) + ']' : '';
                    wLabel = 'B' + (wPtIdx + 1) + ' ' + wType + ' ' + wFreqStr + wRangeStr;
                }
                // Bus group container
                var wGrp = document.createElement('div');
                wGrp.className = 'bus-group weq-bus-group' + (wMuted ? ' bus-muted' : '');
                wGrp.style.setProperty('--bus-tint', wCol);
                // Bus header
                var wHdr = document.createElement('div');
                wHdr.className = 'bus-header weq-bus-header' + (wSoloed ? ' bus-soloed' : '');
                wHdr.dataset.bus = wbus;
                wHdr.dataset.weqbus = wbus;
                var wHdrHtml = '<span class="bus-chev' + (wCollapsed ? '' : ' open') + '">&#9654;</span>' +
                    '<span class="bus-color-dot" style="background:' + wCol + '"></span>' +
                    '<span class="bus-name">' + wLabel + (wCollapsed ? ' <span class="bus-count">(' + wPlugs.length + ')</span>' : '') + '</span>';
                // Per-bus Pre/Post EQ toggle (only for real bands)
                if (wPt) {
                    wHdrHtml += '<button class="bus-preq-btn' + (wPreEq ? ' on' : '') + '" data-weqbusprq="' + wbus + '" title="Post-EQ: apply EQ before plugins. Off = split only">' + (wPreEq ? 'Post-EQ' : 'Split') + '</button>';
                    wHdrHtml += '<button class="bus-mute-btn' + (wMuted ? ' on' : '') + '" data-weqbusmute="' + wbus + '">M</button>';
                    wHdrHtml += '<button class="bus-solo-btn' + (wSoloed ? ' on' : '') + '" data-weqbussolo="' + wbus + '">S</button>';
                }
                wHdr.innerHTML = wHdrHtml;
                wGrp.appendChild(wHdr);
                // Plugin cards
                for (var wgi = 0; wgi < wPlugs.length; wgi++) {
                    var wIdx = wPlugs[wgi];
                    var wCard = buildPluginCard(pluginBlocks[wIdx], wIdx, isA, aBlk, aCol);
                    if (wCollapsed) wCard.style.display = 'none';
                    wGrp.appendChild(wCard);
                }
                c.appendChild(wGrp);
            }
        } else {
            // SEQUENTIAL MODE: flat list
            for (var pi = 0; pi < pluginBlocks.length; pi++) {
                c.appendChild(buildPluginCard(pluginBlocks[pi], pi, isA, aBlk, aCol));
            }
        }

        _expectedChildCount = c.childElementCount;
        wirePluginCards(); wireBusHeaders(); updateAssignBanner();
        // Restore bypass visual
        for (var bpi = 0; bpi < pluginBlocks.length; bpi++) {
            if (pluginBlocks[bpi].bypassed) {
                var bc2 = c.querySelector('[data-plugid="' + pluginBlocks[bpi].id + '"]');
                if (bc2) bc2.closest('.pcard').classList.add('bypassed');
            }
        }
        // Re-attach loading placeholders at the end
        placeholders.forEach(function (ph) { c.appendChild(ph); });
        // Restore scroll position after full rebuild
        if (savedPlugScroll > 0) c.scrollTop = savedPlugScroll;
        return;
    }

    // PATCH: same structure — update each card in-place
    for (var pi = 0; pi < pluginBlocks.length; pi++) {
        var pb = pluginBlocks[pi];
        var card = c.querySelector('.pcard[data-plugid="' + pb.id + '"]');
        if (!card) continue;

        // Update data-plugidx (may shift after drag reorder)
        card.setAttribute('data-plugidx', pi);

        // Patch expand/collapse state
        var chev = card.querySelector('.lchev');
        var body = card.querySelector('.pcard-body');
        if (chev) { if (pb.expanded) chev.classList.add('open'); else chev.classList.remove('open'); }
        if (body) { if (pb.expanded) body.classList.remove('hide'); else body.classList.add('hide'); }

        // Reset any lingering browser drag styling
        card.style.opacity = '';
        card.classList.remove('dragging', 'drag-over-top', 'drag-over-bottom');

        // Patch bypass visual
        if (pb.bypassed) card.classList.add('bypassed'); else card.classList.remove('bypassed');

        // Patch param rows (search filter or assign state change)
        var paramC = card.querySelector('[data-plugparams="' + pb.id + '"]');
        if (paramC) fillPluginParams(paramC, pb, isA, aBlk, aCol);

        // Restore search input value (fillPluginParams doesn't touch it)
        var searchInp = card.querySelector('[data-plugsearch="' + pb.id + '"]');
        if (searchInp && searchInp.value !== (pb.searchFilter || '')) searchInp.value = pb.searchFilter || '';
    }
    // Re-wire only needs to update assign highlights and event listeners
    wirePluginCards(); wireBusHeaders(); updateAssignBanner();
    // Re-attach loading placeholders at the end
    placeholders.forEach(function (ph) { c.appendChild(ph); });
}
function wirePluginCards() {
    document.querySelectorAll('.pcard-head').forEach(function (h) {
        h.onclick = function (e) {
            if (e.target.closest('[data-plugrm]') || e.target.closest('[data-pluged]') || e.target.closest('[data-plugbulk]') || e.target.closest('[data-plugpreset]') || e.target.closest('.pcard-bus-sel')) return;
            var id = parseInt(h.dataset.plugid);
            var pb = null;
            for (var i = 0; i < pluginBlocks.length; i++) {
                if (pluginBlocks[i].id === id) { pb = pluginBlocks[i]; pb.expanded = !pb.expanded; break; }
            }
            // When expanding, force-dirty all params so visible rows repaint with current values
            if (pb && pb.expanded) dirtyPluginParams(id);
            renderAllPlugins();
            syncExpandedPlugins();
        };
        h.addEventListener('contextmenu', function (e) {
            e.preventDefault(); e.stopPropagation();
            var id = parseInt(h.dataset.plugid);
            plugCtxPluginId = id;
            showPlugCtx(e.clientX, e.clientY, id);
        });
    });
    // Bus dropdown — change bus assignment
    document.querySelectorAll('.pcard-bus-sel').forEach(function (sel) {
        sel.onchange = function (e) {
            e.stopPropagation();
            var pid = parseInt(sel.dataset.plugbus);
            var pb; for (var i = 0; i < pluginBlocks.length; i++) { if (pluginBlocks[i].id === pid) { pb = pluginBlocks[i]; break; } }
            if (!pb) return;
            var next = parseInt(sel.value);
            var prev = pb.busId || 0;
            pb.busId = next;
            if (window.__JUCE__ && window.__JUCE__.backend) {
                var fn = window.__juceGetNativeFunction('setPluginBus');
                fn(pb.hostId !== undefined ? pb.hostId : pid, next);
            }
            // ── Sync EQ pluginIds with bus change ──
            if (routingMode === 2 && typeof wrongEqPoints !== 'undefined') {
                // Remove from old band's pluginIds
                for (var ri = 0; ri < wrongEqPoints.length; ri++) {
                    var ids = wrongEqPoints[ri].pluginIds;
                    if (ids) {
                        var idx = ids.indexOf(pid);
                        if (idx >= 0) ids.splice(idx, 1);
                    }
                }
                // Add to new band's pluginIds (if assigning to a real band, not "No Band")
                if (next > 0) {
                    for (var ri2 = 0; ri2 < wrongEqPoints.length; ri2++) {
                        if (wrongEqPoints[ri2].uid === next) {
                            if (!wrongEqPoints[ri2].pluginIds) wrongEqPoints[ri2].pluginIds = [];
                            if (wrongEqPoints[ri2].pluginIds.indexOf(pid) < 0) {
                                wrongEqPoints[ri2].pluginIds.push(pid);
                            }
                            break;
                        }
                    }
                }
                if (typeof weqSyncToHost === 'function') weqSyncToHost();
                if (typeof weqRenderPanel === 'function') weqRenderPanel();
            }
            renderAllPlugins(); saveUiStateToHost();
        };
        // Prevent header collapse when clicking the select
        sel.onclick = function (e) { e.stopPropagation(); };
    });
    document.querySelectorAll('[data-plugrm]').forEach(function (b) { b.onclick = function (e) { e.stopPropagation(); removePlugin(parseInt(b.dataset.plugrm)); }; });
    document.querySelectorAll('[data-pluged]').forEach(function (b) {
        b.onclick = function (e) {
            e.stopPropagation();
            var id = parseInt(b.dataset.pluged);
            if (window.__JUCE__ && window.__JUCE__.backend) {
                var fn = window.__juceGetNativeFunction('openPluginEditor');
                fn(id);
            }
        };
    });
    document.querySelectorAll('[data-plugpreset]').forEach(function (b) {
        b.onclick = function (e) {
            e.stopPropagation();
            openPresetBrowser(parseInt(b.dataset.plugpreset));
        };
    });
    document.querySelectorAll('[data-plugsearch]').forEach(function (inp) {
        inp.onclick = function (e) { e.stopPropagation(); };
        inp.oninput = function () {
            var id = parseInt(inp.dataset.plugsearch);
            for (var i = 0; i < pluginBlocks.length; i++) { if (pluginBlocks[i].id === id) { pluginBlocks[i].searchFilter = inp.value; break; } }
            renderAllPlugins();
            var ni = document.querySelector('[data-plugsearch="' + id + '"]');
            if (ni) { ni.focus(); ni.selectionStart = ni.selectionEnd = ni.value.length; }
        };
    });
    // Scroll listener on param containers — repaint newly visible rows
    document.querySelectorAll('.pcard-params').forEach(function (container) {
        var scrollTimer = null;
        container.addEventListener('scroll', function () {
            if (scrollTimer) return; // debounce ~60ms
            scrollTimer = setTimeout(function () {
                scrollTimer = null;
                var plugId = parseInt(container.getAttribute('data-plugparams'));
                dirtyPluginParams(plugId);
                requestAnimationFrame(refreshParamDisplay);
            }, 60);
        }, { passive: true });
    });
    // Drag and drop reordering
    var dragSrcIdx = null;
    var _dragHighlight = null; // tracks the currently highlighted card during drag (avoids querySelectorAll)
    document.querySelectorAll('.pcard').forEach(function (card) {
        card.addEventListener('dragstart', function (e) {
            // If the drag originates from a param row (.pr), skip plugin reorder drag
            if (e.target.closest('.pr')) return;
            dragSrcIdx = parseInt(card.dataset.plugidx);
            card.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', dragSrcIdx);
        });
        card.addEventListener('dragend', function () {
            card.classList.remove('dragging');
            dragSrcIdx = null;
            if (_dragHighlight) {
                _dragHighlight.classList.remove('drag-over-top', 'drag-over-bottom');
                _dragHighlight = null;
            }
        });
        card.addEventListener('dragover', function (e) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            var rect = card.getBoundingClientRect();
            var midY = rect.top + rect.height / 2;
            // Clear previous highlight (O(1) instead of querySelectorAll)
            if (_dragHighlight && _dragHighlight !== card) {
                _dragHighlight.classList.remove('drag-over-top', 'drag-over-bottom');
            }
            _dragHighlight = card;
            card.classList.remove('drag-over-top', 'drag-over-bottom');
            if (e.clientY < midY) card.classList.add('drag-over-top');
            else card.classList.add('drag-over-bottom');
        });
        card.addEventListener('dragleave', function () {
            card.classList.remove('drag-over-top', 'drag-over-bottom');
        });
        card.addEventListener('drop', function (e) {
            e.preventDefault();
            var fromIdx = parseInt(e.dataTransfer.getData('text/plain'));
            var toIdx = parseInt(card.dataset.plugidx);
            if (isNaN(fromIdx) || isNaN(toIdx) || fromIdx === toIdx) return;
            var rect = card.getBoundingClientRect();
            var midY = rect.top + rect.height / 2;
            if (e.clientY > midY && toIdx < fromIdx) toIdx++;
            if (e.clientY < midY && toIdx > fromIdx) toIdx--;
            var moved = pluginBlocks.splice(fromIdx, 1)[0];
            pluginBlocks.splice(toIdx, 0, moved);
            // In parallel/WrongEQ mode: adopt target's bus assignment if different
            if (routingMode === 1 || routingMode === 2) {
                var targetPb = pluginBlocks[toIdx === 0 ? 1 : toIdx - 1] || pluginBlocks[toIdx + 1];
                if (targetPb && !targetPb.isVirtual && (moved.busId || 0) !== (targetPb.busId || 0)) {
                    moved.busId = targetPb.busId || 0;
                    if (window.__JUCE__ && window.__JUCE__.backend) {
                        var busFn = window.__juceGetNativeFunction('setPluginBus');
                        busFn(moved.hostId !== undefined ? moved.hostId : moved.id, moved.busId);
                    }
                }
            }
            // Sync new order to C++ so audio processing matches visual order
            var reorderFn = (window.__JUCE__ && window.__JUCE__.backend) ? window.__juceGetNativeFunction('reorderPlugins') : null;
            if (reorderFn) {
                var ids = pluginBlocks.map(function (pb) { return pb.id; });
                reorderFn(ids);
            }
            // Sync EQ pluginIds when bus changed via drag in WrongEQ mode
            if (routingMode === 2 && typeof wrongEqPoints !== 'undefined') {
                // Remove from all bands' pluginIds first
                for (var ri = 0; ri < wrongEqPoints.length; ri++) {
                    var ids2 = wrongEqPoints[ri].pluginIds;
                    if (ids2) {
                        var rmIdx = ids2.indexOf(moved.id);
                        if (rmIdx >= 0) ids2.splice(rmIdx, 1);
                    }
                }
                // Add to the new band if assigned
                if (moved.busId > 0) {
                    for (var ri2 = 0; ri2 < wrongEqPoints.length; ri2++) {
                        if (wrongEqPoints[ri2].uid === moved.busId) {
                            if (!wrongEqPoints[ri2].pluginIds) wrongEqPoints[ri2].pluginIds = [];
                            if (wrongEqPoints[ri2].pluginIds.indexOf(moved.id) < 0) {
                                wrongEqPoints[ri2].pluginIds.push(moved.id);
                            }
                            break;
                        }
                    }
                }
                if (typeof weqSyncToHost === 'function') weqSyncToHost();
                if (typeof weqRenderPanel === 'function') weqRenderPanel();
            }
            renderAllPlugins();
            saveUiStateToHost();
        });
    });
}
// Wire bus header controls (volume, mute, solo)
function wireBusHeaders() {
    // Volume sliders
    document.querySelectorAll('[data-busvol]').forEach(function (sl) {
        sl.oninput = function () {
            var bus = parseInt(sl.dataset.busvol);
            var db = parseFloat(sl.value);
            var lin = dbToLin(db);
            busVolumes[bus] = lin;
            var lbl = document.querySelector('[data-busvolval="' + bus + '"]');
            if (lbl) lbl.textContent = fmtDb(db);
            sl.title = fmtDb(db) + ' dB';
            if (window.__JUCE__ && window.__JUCE__.backend) {
                var fn = window.__juceGetNativeFunction('setBusVolume');
                fn(bus, lin);
            }
        };
        sl.onclick = function (e) { e.stopPropagation(); };
        sl.onchange = function () { saveUiStateToHost(); };
        // Double-click to reset to 0 dB
        sl.ondblclick = function (e) {
            e.stopPropagation();
            sl.value = '0';
            sl.oninput();
            saveUiStateToHost();
        };
    });
    // Mute buttons
    document.querySelectorAll('[data-busmute]').forEach(function (btn) {
        btn.onclick = function (e) {
            e.stopPropagation();
            var bus = parseInt(btn.dataset.busmute);
            busMutes[bus] = !busMutes[bus];
            if (window.__JUCE__ && window.__JUCE__.backend) {
                var fn = window.__juceGetNativeFunction('setBusMute');
                fn(bus, busMutes[bus]);
            }
            renderAllPlugins(); saveUiStateToHost();
        };
    });
    // Solo buttons
    document.querySelectorAll('[data-bussolo]').forEach(function (btn) {
        btn.onclick = function (e) {
            e.stopPropagation();
            var bus = parseInt(btn.dataset.bussolo);
            busSolos[bus] = !busSolos[bus];
            if (window.__JUCE__ && window.__JUCE__.backend) {
                var fn = window.__juceGetNativeFunction('setBusSolo');
                fn(bus, busSolos[bus]);
            }
            renderAllPlugins(); saveUiStateToHost();
        };
    });
    // Bus header click — toggle collapse
    document.querySelectorAll('.bus-header').forEach(function (hdr) {
        hdr.onclick = function (e) {
            if (e.target.closest('[data-busvol]') || e.target.closest('[data-busmute]') || e.target.closest('[data-bussolo]') || e.target.closest('[data-weqbusprq]') || e.target.closest('[data-weqbusmute]') || e.target.closest('[data-weqbussolo]')) return;
            e.stopPropagation();
            var bus = parseInt(hdr.dataset.bus);
            busCollapsed[bus] = !busCollapsed[bus];
            renderAllPlugins(); saveUiStateToHost();
        };
    });
    // Helper: find EQ point by UID
    function _weqFindByUid(uid) {
        if (typeof wrongEqPoints === 'undefined') return null;
        for (var fi = 0; fi < wrongEqPoints.length; fi++) {
            if (wrongEqPoints[fi].uid === uid) return wrongEqPoints[fi];
        }
        return null;
    }
    // ── WrongEQ bus header: per-band preEq toggle ──
    document.querySelectorAll('[data-weqbusprq]').forEach(function (btn) {
        btn.onclick = function (e) {
            e.stopPropagation();
            var busUid = parseInt(btn.dataset.weqbusprq);
            var pt = _weqFindByUid(busUid);
            if (pt) {
                pt.preEq = !(pt.preEq !== false);
                if (typeof weqSyncToHost === 'function') weqSyncToHost();
                if (typeof weqRenderPanel === 'function') weqRenderPanel();
                if (typeof markStateDirty === 'function') markStateDirty();
                renderAllPlugins(); saveUiStateToHost();
            }
        };
    });
    // ── WrongEQ bus header: per-band mute ──
    document.querySelectorAll('[data-weqbusmute]').forEach(function (btn) {
        btn.onclick = function (e) {
            e.stopPropagation();
            var busUid = parseInt(btn.dataset.weqbusmute);
            var pt = _weqFindByUid(busUid);
            if (pt) {
                pt.mute = !pt.mute;
                if (typeof weqSyncToHost === 'function') weqSyncToHost();
                if (typeof weqRenderPanel === 'function') weqRenderPanel();
                if (typeof weqDrawCanvas === 'function') weqDrawCanvas();
                if (typeof markStateDirty === 'function') markStateDirty();
                renderAllPlugins(); saveUiStateToHost();
            }
        };
    });
    // ── WrongEQ bus header: per-band solo (exclusive) ──
    document.querySelectorAll('[data-weqbussolo]').forEach(function (btn) {
        btn.onclick = function (e) {
            e.stopPropagation();
            var busUid = parseInt(btn.dataset.weqbussolo);
            var pt = _weqFindByUid(busUid);
            if (pt) {
                var wasSoloed = pt.solo;
                for (var si = 0; si < wrongEqPoints.length; si++) wrongEqPoints[si].solo = false;
                pt.solo = !wasSoloed;
                if (typeof weqSyncToHost === 'function') weqSyncToHost();
                if (typeof weqRenderPanel === 'function') weqRenderPanel();
                if (typeof weqDrawCanvas === 'function') weqDrawCanvas();
                if (typeof markStateDirty === 'function') markStateDirty();
                renderAllPlugins(); saveUiStateToHost();
            }
        };
    });
}
// Param click delegation
var pse = document.getElementById('pluginScroll');
var lastClickedPid = null; // track for Shift+Click range selection
var lastClickedAction = 'add'; // 'add' or 'remove' — Shift+Click mirrors this
pse.addEventListener('click', function (e) {
    // Bulk All/None buttons
    var bulkBtn = e.target.closest('[data-plugbulk]');
    if (bulkBtn && assignMode) {
        e.stopPropagation();
        var plugId = parseInt(bulkBtn.dataset.plugbulk);
        var mode = bulkBtn.dataset.bulkmode; // 'all' or 'none'
        var b = findBlock(assignMode);
        var pb = null;
        for (var i = 0; i < pluginBlocks.length; i++) { if (pluginBlocks[i].id === plugId) { pb = pluginBlocks[i]; break; } }
        if (b && pb) {
            pb.params.forEach(function (p) {
                if (p.lk) return; // skip locked
                if (mode === 'all') {
                    assignTarget(b, p.id);
                    // For shapes_range, set default range = current param value
                    if (b.mode === 'shapes_range') {
                        if (!b.targetRanges) b.targetRanges = {};
                        if (!b.targetRangeBases) b.targetRangeBases = {};
                        if (b.targetRanges[p.id] === undefined) { b.targetRanges[p.id] = 0; b.targetRangeBases[p.id] = p.v; }
                    }
                } else {
                    b.targets.delete(p.id);
                    cleanBlockAfterUnassign(b, p.id);
                    if (b.mode === 'shapes_range') { if (b.targetRanges) delete b.targetRanges[p.id]; if (b.targetRangeBases) delete b.targetRangeBases[p.id]; }
                }
            });
            renderAllPlugins(); renderBlocks(); syncBlocksToHost();
        }
        return;
    }
    var row = e.target.closest('.pr'); if (!row) return;
    var pid = row.getAttribute('data-pid'); if (!pid) return;
    var pp = PMap[pid]; if (!pp) return;

    if (assignMode) {
        // === ASSIGN MODE: toggle targets on active block ===
        if (pp.lk) return; // locked params can't be assigned
        var b = findBlock(assignMode);
        if (!b) return;

        // Shapes Range: assign with range=0 (no arc until dragged)
        if (b.mode === 'shapes_range') {
            if (b.targets.has(pid)) {
                b.targets.delete(pid);
                cleanBlockAfterUnassign(b, pid);
                lastClickedAction = 'remove';
            } else {
                assignTarget(b, pid);
                if (!b.targetRanges) b.targetRanges = {};
                if (!b.targetRangeBases) b.targetRangeBases = {};
                b.targetRanges[pid] = 0;
                b.targetRangeBases[pid] = pp.v; // anchor = current position
                lastClickedAction = 'add';
            }
        } else if (e.shiftKey && lastClickedPid) {
            var allRows = Array.prototype.slice.call(pse.querySelectorAll('.pr[data-pid]'));
            var startIdx = -1, endIdx = -1;
            for (var ri = 0; ri < allRows.length; ri++) {
                var rpid = allRows[ri].getAttribute('data-pid');
                if (rpid === lastClickedPid) startIdx = ri;
                if (rpid === pid) endIdx = ri;
            }
            if (startIdx !== -1 && endIdx !== -1) {
                var lo = Math.min(startIdx, endIdx), hi = Math.max(startIdx, endIdx);
                for (var ri = lo; ri <= hi; ri++) {
                    var rpid = allRows[ri].getAttribute('data-pid');
                    var rp = PMap[rpid];
                    if (rp && !rp.lk) {
                        if (lastClickedAction === 'add') {
                            assignTarget(b, rpid);
                            if (b.mode === 'shapes_range') {
                                if (!b.targetRanges) b.targetRanges = {};
                                if (!b.targetRangeBases) b.targetRangeBases = {};
                                if (b.targetRanges[rpid] === undefined) { b.targetRanges[rpid] = 0; b.targetRangeBases[rpid] = rp.v; }
                            }
                        } else {
                            b.targets.delete(rpid);
                            cleanBlockAfterUnassign(b, rpid);
                        }
                    }
                }
            }
        } else if (e.ctrlKey || e.metaKey) {
            if (b.targets.has(pid)) { b.targets.delete(pid); cleanBlockAfterUnassign(b, pid); lastClickedAction = 'remove'; }
            else { assignTarget(b, pid); if (b.mode === 'shapes_range') { if (!b.targetRanges) b.targetRanges = {}; if (!b.targetRangeBases) b.targetRangeBases = {}; if (b.targetRanges[pid] === undefined) { b.targetRanges[pid] = 0; b.targetRangeBases[pid] = pp.v; } } if (b.mode === 'link') { if (!b.linkBases) b.linkBases = {}; b.linkBases[pid] = pp.v; } if (b.mode === 'shapes') { if (!b.targetBases) b.targetBases = {}; b.targetBases[pid] = pp.v; } lastClickedAction = 'add'; }
        } else {
            if (b.targets.has(pid)) { b.targets.delete(pid); cleanBlockAfterUnassign(b, pid); lastClickedAction = 'remove'; }
            else { assignTarget(b, pid); if (b.mode === 'shapes_range') { if (!b.targetRanges) b.targetRanges = {}; if (!b.targetRangeBases) b.targetRangeBases = {}; if (b.targetRanges[pid] === undefined) { b.targetRanges[pid] = 0; b.targetRangeBases[pid] = pp.v; } } if (b.mode === 'link') { if (!b.linkBases) b.linkBases = {}; b.linkBases[pid] = pp.v; } if (b.mode === 'shapes') { if (!b.targetBases) b.targetBases = {}; b.targetBases[pid] = pp.v; } lastClickedAction = 'add'; }
        }
        lastClickedPid = pid;
        renderAllPlugins();
        clearTimeout(renderAllPlugins._bt);
        renderAllPlugins._bt = setTimeout(function () { renderBlocks(); syncBlocksToHost(); }, 80);
    } else {
        // === SELECTION MODE: select params for drag/right-click assign ===
        // Locked params CAN be selected here (for batch unlock via context menu)
        if (e.shiftKey && lastClickedPid) {
            var allRows = Array.prototype.slice.call(pse.querySelectorAll('.pr[data-pid]'));
            var startIdx = -1, endIdx = -1;
            for (var ri = 0; ri < allRows.length; ri++) {
                var rpid = allRows[ri].getAttribute('data-pid');
                if (rpid === lastClickedPid) startIdx = ri;
                if (rpid === pid) endIdx = ri;
            }
            if (startIdx !== -1 && endIdx !== -1) {
                var lo = Math.min(startIdx, endIdx), hi = Math.max(startIdx, endIdx);
                for (var ri = lo; ri <= hi; ri++) {
                    var rpid = allRows[ri].getAttribute('data-pid');
                    var rp = PMap[rpid];
                    if (rp) {
                        if (lastClickedAction === 'add') selectedParams.add(rpid);
                        else selectedParams.delete(rpid);
                    }
                }
            }
        } else if (e.ctrlKey || e.metaKey) {
            if (selectedParams.has(pid)) { selectedParams.delete(pid); lastClickedAction = 'remove'; }
            else { selectedParams.add(pid); lastClickedAction = 'add'; }
        } else {
            // Plain click: clear selection and select just this one
            selectedParams.clear();
            selectedParams.add(pid);
            lastClickedAction = 'add';
        }
        lastClickedPid = pid;
        renderAllPlugins();
    }
});
// Drag from selected params
pse.addEventListener('dragstart', function (e) {
    var row = e.target.closest('.pr'); if (!row) return;
    var pid = row.getAttribute('data-pid'); if (!pid) return;
    // If dragging a non-selected param, select just that one
    if (!selectedParams.has(pid)) {
        selectedParams.clear();
        selectedParams.add(pid);
        // Don't call renderAllPlugins() here — it destroys the drag source mid-drag.
        // Instead, just toggle class directly on the row:
        pse.querySelectorAll('.pr.selected').forEach(function (r) { r.classList.remove('selected'); });
        row.classList.add('selected');
    }
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('text/plain', 'params:' + Array.from(selectedParams).join(','));
});
pse.addEventListener('dragend', function () {
    // Re-render after drag completes to sync visual state
    renderAllPlugins();
});
pse.addEventListener('contextmenu', function (e) {
    var row = e.target.closest('.pr'); if (!row) return;
    var pid = row.getAttribute('data-pid'); if (!pid) return;
    var pp = PMap[pid]; if (!pp) return; e.preventDefault();
    // If right-clicking on a non-selected param, select just it
    if (!selectedParams.has(pid)) {
        selectedParams.clear();
        selectedParams.add(pid);
        renderAllPlugins();
    }
    ctxP = pp; showCtx(e.clientX, e.clientY, pp);
});

// ── Knob drag interaction ──
(function () {
    var _setParamFn = null;
    function getSetParam() {
        if (!_setParamFn && window.__JUCE__ && window.__JUCE__.backend)
            _setParamFn = window.__juceGetNativeFunction('setParam');
        return _setParamFn;
    }
    var _touchParamFn = null, _untouchParamFn = null;
    function getTouchParam() {
        if (!_touchParamFn && window.__juceGetNativeFunction)
            _touchParamFn = window.__juceGetNativeFunction('touchParam');
        return _touchParamFn;
    }
    function getUntouchParam() {
        if (!_untouchParamFn && window.__juceGetNativeFunction)
            _untouchParamFn = window.__juceGetNativeFunction('untouchParam');
        return _untouchParamFn;
    }
    document.addEventListener('mousedown', function (e) {
        var knob = e.target.closest('.pr-knob');
        if (!knob) return;
        e.preventDefault();
        e.stopPropagation();
        var pid = knob.getAttribute('data-pid');
        var hid = parseInt(knob.getAttribute('data-hid'));
        var ri = parseInt(knob.getAttribute('data-ri'));
        var p = PMap[pid];
        if (!p || isNaN(hid) || isNaN(ri)) return;

        // ── SHAPES RANGE: drag to set range instead of value ──
        if (assignMode) {
            var srBlk = findBlock(assignMode);
            if (srBlk && srBlk.mode === 'shapes_range') {
                // Auto-assign if not yet assigned
                if (!srBlk.targets.has(pid)) {
                    assignTarget(srBlk, pid);
                    if (!srBlk.targetRanges) srBlk.targetRanges = {};
                    if (!srBlk.targetRangeBases) srBlk.targetRangeBases = {};
                    srBlk.targetRanges[pid] = 0;
                    srBlk.targetRangeBases[pid] = p.v; // capture base position
                }
                // Ensure base exists
                if (!srBlk.targetRangeBases) srBlk.targetRangeBases = {};
                if (srBlk.targetRangeBases[pid] === undefined) srBlk.targetRangeBases[pid] = p.v;
                var baseVal = srBlk.targetRangeBases[pid];
                var startY = e.clientY;
                var startRange = srBlk.targetRanges[pid] !== undefined ? srBlk.targetRanges[pid] : 0;
                var aCol = bColor(srBlk.colorIdx);
                _touchedByUI.add(pid);  // block realtime from fighting our range-drag rebuild
                function onMoveRange(me) {
                    var dy = startY - me.clientY; // positive = drag up = positive range
                    var newRange = startRange + dy / 200;
                    // Clamp so base + range stays within 0..1
                    if (newRange > 0) {
                        newRange = Math.min(newRange, 1 - baseVal);
                    } else {
                        newRange = Math.max(newRange, -baseVal);
                    }
                    srBlk.targetRanges[pid] = newRange;
                    var ri2 = { range: newRange, base: baseVal, color: aCol, polarity: srBlk.shapePolarity || 'bipolar' };
                    knob.innerHTML = buildParamKnob(p.v, 30, ri2);
                }
                function onUpRange() {
                    document.removeEventListener('mousemove', onMoveRange);
                    document.removeEventListener('mouseup', onUpRange);
                    _touchedByUI.delete(pid);
                    renderAllPlugins(); renderBlocks(); syncBlocksToHost();
                }
                document.addEventListener('mousemove', onMoveRange);
                document.addEventListener('mouseup', onUpRange);
                return;
            }
        }

        // ── Normal knob drag (value adjustment) ──
        var isVirtual = (hid === -100); // WEQ_VIRTUAL_ID
        var tfn = isVirtual ? null : getTouchParam();
        if (tfn) tfn(hid, ri);
        // Check if param has ACTIVE modulation (non-zero depth/range)
        // Use getModArcInfo which already checks for non-zero values
        var _arcInfo = getModArcInfo(pid);
        var _hasModBlocks = _arcInfo !== null;
        var startVal = (_hasModBlocks && _arcInfo.base !== undefined) ? _arcInfo.base : p.v;
        // Non-modulated params: block realtime (drag handler renders them)
        // Modulated params: let realtime.js render (it uses computeModCurrent — one path)
        if (!_hasModBlocks) _touchedByUI.add(pid);
        var startY = e.clientY;
        var sensitivity = 200;
        var _lastDragVal = startVal;
        function onMove(me) {
            var dy = startY - me.clientY;
            var newVal = Math.max(0, Math.min(1, startVal + dy / sensitivity));
            _lastDragVal = newVal;

            if (isVirtual) {
                // Virtual param: always apply to EQ state + redraw canvas
                if (typeof weqApplyVirtualParam === 'function') weqApplyVirtualParam(pid, newVal);
                if (_hasModBlocks) {
                    // Modulated virtual: update bases, let realtime.js render knob+arc
                    updateModBases(pid, newVal);
                    // Update value text only — knob SVG is rendered by realtime.js
                    var row = knob.closest('.pr');
                    if (row) {
                        var ve = row.querySelector('.pr-val');
                        if (ve) ve.textContent = (newVal * 100).toFixed(0) + '%';
                    }
                } else {
                    // Unmodulated virtual: direct render
                    p.v = newVal;
                    knob.innerHTML = buildParamKnob(newVal, 30, null);
                    var row = knob.closest('.pr');
                    if (row) {
                        var ve = row.querySelector('.pr-val');
                        if (ve) ve.textContent = p.disp || ((newVal * 100).toFixed(0) + '%');
                        var bf = row.querySelector('.pr-bar-f');
                        if (bf) bf.style.width = (newVal * 100) + '%';
                    }
                }
                // Redraw canvas + sync to host
                if (typeof weqDrawCanvas === 'function') weqDrawCanvas();
                if (typeof weqSyncToHost === 'function') weqSyncToHost();
            } else {
                var fn = getSetParam();
                if (fn) fn(hid, ri, newVal);
                if (_hasModBlocks) {
                    // Update stored bases — realtime.js reads these for knob position + fill arc
                    updateModBases(pid, newVal);
                    // Only update value text — knob SVG is rendered by realtime.js
                    var row = knob.closest('.pr');
                    if (row) {
                        var ve = row.querySelector('.pr-val');
                        if (ve) ve.textContent = (newVal * 100).toFixed(0) + '%';
                    }
                } else {
                    p.v = newVal;
                    knob.innerHTML = buildParamKnob(newVal, 30, null);
                    var row = knob.closest('.pr');
                    if (row) {
                        var ve = row.querySelector('.pr-val');
                        if (ve) ve.textContent = p.disp || ((newVal * 100).toFixed(0) + '%');
                        var bf = row.querySelector('.pr-bar-f');
                        if (bf) bf.style.width = (newVal * 100) + '%';
                    }
                }
            }
        }
        function onUp() {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            if (!_hasModBlocks) _touchedByUI.delete(pid);
            if (_lastDragVal !== startVal) {
                pushParamUndo(pid, startVal);
            }
            if (!isVirtual) {
                var ufn = getUntouchParam();
                if (ufn) ufn(hid, ri);
            }
            if (_lastDragVal !== startVal && _hasModBlocks) {
                syncBlocksToHost();
                renderAllPlugins();
            }
            if (isVirtual && _lastDragVal !== startVal) {
                if (typeof markStateDirty === 'function') markStateDirty();
            }
        }
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    }, true); // capture phase to beat row click

    // ── Scroll wheel on param knobs ──
    document.addEventListener('wheel', function (e) {
        var knob = e.target.closest('.pr-knob');
        if (!knob) return;
        e.preventDefault();
        var pid = knob.getAttribute('data-pid');
        var hid = parseInt(knob.getAttribute('data-hid'));
        var ri = parseInt(knob.getAttribute('data-ri'));
        var p = PMap[pid];
        if (!p || p.lk || isNaN(hid) || isNaN(ri)) return;
        // Skip when in shapes_range assign mode (knob drag sets range, not value)
        if (assignMode) {
            var srBlk = findBlock(assignMode);
            if (srBlk && srBlk.mode === 'shapes_range') return;
        }
        var step = e.shiftKey ? 0.002 : 0.01; // Shift = fine control
        var delta = e.deltaY < 0 ? step : -step;
        // For modulated params, scroll adjusts the BASE, not the modulated value
        var _sri = getModArcInfo(pid);
        var baseVal = (_sri && _sri.base !== undefined) ? _sri.base : p.v;
        var oldVal = baseVal;
        var newVal = Math.max(0, Math.min(1, baseVal + delta));
        if (newVal === oldVal) return;
        p.v = newVal;
        var isVW = (hid === -100);
        if (isVW) {
            if (typeof weqApplyVirtualParam === 'function') weqApplyVirtualParam(pid, newVal);
            if (typeof weqDrawCanvas === 'function') weqDrawCanvas();
            if (typeof weqSyncToHost === 'function') weqSyncToHost();
        } else {
            var fn = getSetParam();
            if (fn) fn(hid, ri, newVal);
        }
        // Update stored bases and rebuild knob
        if (_sri) {
            updateModBases(pid, newVal);
            _sri = getModArcInfo(pid);
            if (_sri) _sri.current = p.v;
        }
        var knobVal = (_sri && _sri.current !== undefined && _sri.base !== undefined) ? _sri.base : newVal;
        knob.innerHTML = buildParamKnob(knobVal, 30, _sri);
        var row = knob.closest('.pr');
        if (row) {
            var ve = row.querySelector('.pr-val');
            if (ve) ve.textContent = p.disp || ((newVal * 100).toFixed(0) + '%');
            var bf = row.querySelector('.pr-bar-f');
            if (bf) bf.style.width = (newVal * 100) + '%';
        }
        // Debounced undo push — collect scroll ticks into one undo entry
        if (!knob._wheelUndoTimer) {
            knob._wheelOldVal = oldVal;
        } else {
            clearTimeout(knob._wheelUndoTimer);
        }
        knob._wheelUndoTimer = setTimeout(function () {
            if (p.v !== knob._wheelOldVal) pushParamUndo(pid, knob._wheelOldVal);
            knob._wheelUndoTimer = null;
        }, 400);
    }, { passive: false });

    // ── Double-click to reset param knob to default (0.5) ──
    document.addEventListener('dblclick', function (e) {
        var knob = e.target.closest('.pr-knob');
        if (!knob) return;
        e.preventDefault(); e.stopPropagation();
        var pid = knob.getAttribute('data-pid');
        var hid = parseInt(knob.getAttribute('data-hid'));
        var ri = parseInt(knob.getAttribute('data-ri'));
        var p = PMap[pid];
        if (!p || p.lk || isNaN(hid) || isNaN(ri)) return;
        var oldVal = p.v;
        var defaultVal = 0.5; // center position — universal default
        if (oldVal === defaultVal) return;
        p.v = defaultVal;
        var isVW2 = (hid === -100);
        if (isVW2) {
            if (typeof weqApplyVirtualParam === 'function') weqApplyVirtualParam(pid, defaultVal);
            if (typeof weqDrawCanvas === 'function') weqDrawCanvas();
            if (typeof weqSyncToHost === 'function') weqSyncToHost();
        } else {
            var fn = getSetParam();
            if (fn) fn(hid, ri, defaultVal);
        }
        pushParamUndo(pid, oldVal);
        // Update visuals
        knob.innerHTML = buildParamKnob(defaultVal, 30, null);
        var row = knob.closest('.pr');
        if (row) {
            var ve = row.querySelector('.pr-val');
            if (ve) ve.textContent = p.disp || ((defaultVal * 100).toFixed(0) + '%');
            var bf = row.querySelector('.pr-bar-f');
            if (bf) bf.style.width = '50%';
        }
    }, true);
})();

// ── Plugin card footer toolbar handlers ──
document.addEventListener('click', function (e) {
    // Randomize All
    var randBtn = e.target.closest('[data-pfrand]');
    if (randBtn) {
        e.stopPropagation();
        var pid = parseInt(randBtn.dataset.pfrand);
        var pb = null;
        for (var i = 0; i < pluginBlocks.length; i++) { if (pluginBlocks[i].id === pid) { pb = pluginBlocks[i]; break; } }
        if (!pb) return;
        var oldVals = [];
        pb.params.forEach(function (p) { if (!p.lk && !p.alk) oldVals.push({ id: p.id, val: p.v }); });
        var setFn = (window.__JUCE__ && window.__JUCE__.backend) ? window.__juceGetNativeFunction('setParam') : null;
        var isVirtRand = pb.isVirtual;
        pb.params.forEach(function (p) {
            if (p.lk || p.alk) return;
            var nv = Math.random();
            p.v = nv;
            if (isVirtRand) {
                if (typeof weqApplyVirtualParam === 'function') weqApplyVirtualParam(p.id, nv);
            } else {
                if (setFn && p.hostId !== undefined) setFn(p.hostId, p.realIndex, nv);
            }
            // Update base anchor in all modulation blocks targeting this param
            updateModBases(p.id, nv);
        });
        if (isVirtRand) {
            if (typeof weqDrawCanvas === 'function') weqDrawCanvas();
            if (typeof weqSyncToHost === 'function') weqSyncToHost();
            if (typeof markStateDirty === 'function') markStateDirty();
        }
        pushMultiParamUndo(oldVals);
        renderAllPlugins();
        syncBlocksToHost();
        return;
    }
    // Bypass toggle
    var bypBtn = e.target.closest('[data-pfbypass]');
    if (bypBtn) {
        e.stopPropagation();
        var pid = parseInt(bypBtn.dataset.pfbypass);
        var pb = null;
        for (var i = 0; i < pluginBlocks.length; i++) { if (pluginBlocks[i].id === pid) { pb = pluginBlocks[i]; break; } }
        if (!pb) return;
        pb.bypassed = !pb.bypassed;
        if (window.__JUCE__ && window.__JUCE__.backend) {
            var fn = window.__juceGetNativeFunction('setPluginBypass');
            fn(pb.hostId, pb.bypassed);
        }
        renderAllPlugins(); saveUiStateToHost();
        return;
    }
    // Snapshot dropdown toggle — build menu dynamically
    var snapBtn = e.target.closest('[data-pfsnap]');
    if (snapBtn) {
        e.stopPropagation();
        document.querySelectorAll('.pf-snap-menu.vis').forEach(function (m) { m.classList.remove('vis'); });
        var plugId = snapBtn.dataset.pfsnap;
        var menu = snapBtn.parentElement.querySelector('.pf-snap-menu');
        if (!menu) return;
        // Build menu content from morph pads AND morph lanes
        var morphBlocks = (typeof getMorphBlocks === 'function') ? getMorphBlocks() : [];
        var morphLanes = (typeof getMorphLanes === 'function') ? getMorphLanes() : [];
        var mh = '';
        if (morphBlocks.length === 0 && morphLanes.length === 0) {
            mh = '<div class="pf-snap-item disabled">No morph pads or lanes</div>';
        } else {
            if (morphBlocks.length > 0) {
                mh += '<div class="pf-snap-item disabled" style="font-size:9px;opacity:0.5;padding:2px 8px">Morph Pads</div>';
                for (var mi = 0; mi < morphBlocks.length; mi++) {
                    var mb = morphBlocks[mi];
                    var full = mb.snapCount >= 12;
                    mh += '<div class="pf-snap-item' + (full ? ' disabled' : '') + '" data-pfsnapblock="' + mb.id + '" data-pfsnappid="' + plugId + '"><span class="pf-dot" style="background:' + bColor(mb.colorIdx) + '"></span>Pad ' + (mb.idx + 1) + ' (' + mb.snapCount + '/12)' + (full ? ' Full' : '') + '</div>';
                }
            }
            if (morphLanes.length > 0) {
                mh += '<div class="pf-snap-item disabled" style="font-size:9px;opacity:0.5;padding:2px 8px">Morph Lanes</div>';
                for (var mi = 0; mi < morphLanes.length; mi++) {
                    var ml = morphLanes[mi];
                    mh += '<div class="pf-snap-item" data-pfsnaplaneblk="' + ml.blockId + '" data-pfsnaplaneli="' + ml.laneIdx + '" data-pfsnappid="' + plugId + '"><span class="pf-dot" style="background:' + (ml.laneColor || bColor(ml.colorIdx)) + '"></span>Lane ' + (ml.laneIdx + 1) + ' (' + ml.snapCount + ' snaps)</div>';
                }
            }
        }
        menu.innerHTML = mh;
        // Position and show
        var rect = snapBtn.getBoundingClientRect();
        var posLeft = rect.left;
        var vw = window.innerWidth;
        var menuW = menu.offsetWidth || 130;
        if (posLeft + menuW > vw - 4) posLeft = vw - menuW - 4;
        if (posLeft < 4) posLeft = 4;
        menu.style.left = posLeft + 'px';
        menu.classList.add('vis');
        var menuH = menu.offsetHeight;
        if (rect.top - menuH - 4 > 0) {
            menu.style.top = (rect.top - menuH - 4) + 'px';
        } else {
            menu.style.top = (rect.bottom + 4) + 'px';
        }
        return;
    }
    // Morph lane snapshot select
    var snapLaneItem = e.target.closest('[data-pfsnaplaneblk]');
    if (snapLaneItem) {
        e.stopPropagation();
        var bid = parseInt(snapLaneItem.dataset.pfsnaplaneblk);
        var li = parseInt(snapLaneItem.dataset.pfsnaplaneli);
        var pid = parseInt(snapLaneItem.dataset.pfsnappid);
        if (typeof addSnapshotToMorphLane === 'function') addSnapshotToMorphLane(bid, li, pid);
        var menu = snapLaneItem.closest('.pf-snap-menu');
        if (menu) menu.classList.remove('vis');
        renderAllPlugins();
        return;
    }
    // Snapshot select (morph pad)
    var snapItem = e.target.closest('[data-pfsnapblock]');
    if (snapItem && !snapItem.classList.contains('disabled')) {
        e.stopPropagation();
        var bid = parseInt(snapItem.dataset.pfsnapblock);
        var pid = parseInt(snapItem.dataset.pfsnappid);
        if (typeof addSnapshotToMorphBlock === 'function') addSnapshotToMorphBlock(bid, pid);
        var menu = snapItem.closest('.pf-snap-menu');
        if (menu) menu.classList.remove('vis');
        renderAllPlugins();
        return;
    }
    // Assign dropdown
    var assignBtn = e.target.closest('[data-pfassign]');
    if (assignBtn) {
        e.stopPropagation();
        document.querySelectorAll('.pf-snap-menu.vis').forEach(function (m) { m.classList.remove('vis'); });
        var plugId = assignBtn.dataset.pfassign;
        var menu = assignBtn.parentElement.querySelector('[data-pfassignmenu]');
        if (!menu || blocks.length === 0) return;
        var mh = '';
        for (var bi = 0; bi < blocks.length; bi++) {
            var bl = blocks[bi];
            mh += '<div class="pf-snap-item" data-pfassignblk="' + bl.id + '" data-pfassignplug="' + plugId + '"><span class="pf-dot" style="background:' + bColor(bl.colorIdx) + '"></span>Block ' + (bi + 1) + ' (' + bl.mode + ')</div>';
        }
        menu.innerHTML = mh;
        var rect = assignBtn.getBoundingClientRect();
        var posLeft = rect.left, vw = window.innerWidth, menuW2 = menu.offsetWidth || 130;
        if (posLeft + menuW2 > vw - 4) posLeft = vw - menuW2 - 4;
        if (posLeft < 4) posLeft = 4;
        menu.style.left = posLeft + 'px';
        menu.classList.add('vis');
        var menuH = menu.offsetHeight;
        menu.style.top = (rect.top - menuH - 4 > 0) ? (rect.top - menuH - 4) + 'px' : (rect.bottom + 4) + 'px';
        return;
    }
    // Assign select
    var assignItem = e.target.closest('[data-pfassignblk]');
    if (assignItem) {
        e.stopPropagation();
        var bid = parseInt(assignItem.dataset.pfassignblk);
        var plugId = parseInt(assignItem.dataset.pfassignplug);
        var bl = findBlock(bid);
        var pb = null;
        for (var i = 0; i < pluginBlocks.length; i++) { if (pluginBlocks[i].id === plugId) { pb = pluginBlocks[i]; break; } }
        if (bl && pb) {
            var pids = selectedParams.size > 0 ? Array.from(selectedParams) : pb.params.filter(function (p) { return !p.lk; }).map(function (p) { return p.id; });
            pids.forEach(function (pid) { var pp = PMap[pid]; if (pp && !pp.lk) assignTarget(bl, pid); });
            selectedParams.clear();
            renderAllPlugins(); renderBlocks(); syncBlocksToHost();
        }
        var menu = assignItem.closest('.pf-snap-menu');
        if (menu) menu.classList.remove('vis');
        return;
    }
    // Unassign dropdown
    var unassignBtn = e.target.closest('[data-pfunassign]');
    if (unassignBtn) {
        e.stopPropagation();
        document.querySelectorAll('.pf-snap-menu.vis').forEach(function (m) { m.classList.remove('vis'); });
        var plugId = unassignBtn.dataset.pfunassign;
        var menu = unassignBtn.parentElement.querySelector('[data-pfunassignmenu]');
        if (!menu || blocks.length === 0) return;
        var mh = '';
        for (var bi = 0; bi < blocks.length; bi++) {
            var bl = blocks[bi];
            mh += '<div class="pf-snap-item" data-pfunassignblk="' + bl.id + '" data-pfunassignplug="' + plugId + '"><span class="pf-dot" style="background:' + bColor(bl.colorIdx) + '"></span>Block ' + (bi + 1) + ' (' + bl.mode + ')</div>';
        }
        menu.innerHTML = mh;
        var rect = unassignBtn.getBoundingClientRect();
        var posLeft = rect.left, vw = window.innerWidth, menuW2 = menu.offsetWidth || 130;
        if (posLeft + menuW2 > vw - 4) posLeft = vw - menuW2 - 4;
        if (posLeft < 4) posLeft = 4;
        menu.style.left = posLeft + 'px';
        menu.classList.add('vis');
        var menuH = menu.offsetHeight;
        menu.style.top = (rect.top - menuH - 4 > 0) ? (rect.top - menuH - 4) + 'px' : (rect.bottom + 4) + 'px';
        return;
    }
    // Unassign select
    var unassignItem = e.target.closest('[data-pfunassignblk]');
    if (unassignItem) {
        e.stopPropagation();
        var bid = parseInt(unassignItem.dataset.pfunassignblk);
        var plugId = parseInt(unassignItem.dataset.pfunassignplug);
        var bl = findBlock(bid);
        var pb = null;
        for (var i = 0; i < pluginBlocks.length; i++) { if (pluginBlocks[i].id === plugId) { pb = pluginBlocks[i]; break; } }
        if (bl && pb) {
            var pids = selectedParams.size > 0 ? Array.from(selectedParams) : pb.params.map(function (p) { return p.id; });
            pids.forEach(function (pid) { bl.targets.delete(pid); cleanBlockAfterUnassign(bl, pid); });
            selectedParams.clear();
            renderAllPlugins(); renderBlocks(); syncBlocksToHost();
        }
        var menu = unassignItem.closest('.pf-snap-menu');
        if (menu) menu.classList.remove('vis');
        return;
    }
    // Close any open dropdown menus
    document.querySelectorAll('.pf-snap-menu.vis').forEach(function (m) { m.classList.remove('vis'); });
});
