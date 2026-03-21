// ============================================================
// LOGIC BLOCKS
// Block creation, rendering, wiring, randomize, sync to host
// ============================================================
var internalBpm = 120; // Internal tempo (set in Settings)
// Build SVG arc knob for logic block params. mode: 'rand','env','smp','morph','shapes'
function buildBlockKnob(val, min, max, size, mode, field, blockId, label, unit, fmtFn, disabled, laneIdx) {
    var norm = (val - min) / (max - min);
    var r = size / 2, cx = r, cy = r, ir = r - 3;
    var startAngle = 135 * Math.PI / 180, endAngle = 405 * Math.PI / 180;
    var span = endAngle - startAngle;
    var tPath = describeArc(cx, cy, ir, startAngle, endAngle);
    var va = startAngle + norm * span;
    var vPath = norm > 0.005 ? describeArc(cx, cy, ir, startAngle, va) : '';
    var dx = cx + ir * Math.cos(va), dy = cy + ir * Math.sin(va);
    var tVar = 'var(--lk-' + mode + '-track, var(--knob-track))';
    var vVar = 'var(--lk-' + mode + '-value, var(--knob-value))';
    var dVar = 'var(--lk-' + mode + '-dot, var(--knob-dot))';
    var svg = '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">';
    svg += '<path d="' + tPath + '" fill="none" stroke="' + tVar + '" stroke-width="2.5" stroke-linecap="round"/>';
    if (vPath) svg += '<path d="' + vPath + '" fill="none" stroke="' + vVar + '" stroke-width="2.5" stroke-linecap="round"/>';
    svg += '<circle cx="' + dx.toFixed(1) + '" cy="' + dy.toFixed(1) + '" r="2.5" fill="' + dVar + '"/>';
    svg += '</svg>';
    var dispVal = fmtFn ? fmtFn(val) : (unit === 'ms' ? Math.round(val) + 'ms' : unit === 'dB' ? Math.round(val) + 'dB' : unit === '%' ? Math.round(val) + '%' : unit === 'Â±%' ? 'Â±' + Math.round(val) + '%' : unit === 'Â±' ? (val > 0 ? '+' : '') + Math.round(val) + '%' : Math.round(val) + (unit || ''));
    var liAttr = (laneIdx != null) ? ' data-li="' + laneIdx + '"' : '';
    var h = '<div class="bk' + (disabled ? ' sync-disabled' : '') + '" data-b="' + blockId + '" data-f="' + field + '" data-min="' + min + '" data-max="' + max + '"' + liAttr + (disabled ? ' data-disabled="1"' : '') + '>';
    h += '<div class="bk-svg">' + svg + '</div>';
    h += '<div class="bk-val">' + dispVal + '</div>';
    h += '<div class="bk-lbl">' + label + '</div>';
    h += '</div>';
    return h;
}
function buildKnobRow(knobs) { return '<div class="knob-row">' + knobs + '</div>'; }

// Shared shape selector options — used by Shapes, Shapes Range, and Morph Pad
function buildShapeOptions(field, b) {
    var val = b[field] || 'circle';
    var sel = function (v) { return val === v ? ' selected' : ''; };
    var h = '<optgroup label="Basic">';
    h += '<option value="circle"' + sel('circle') + '>Circle</option>';
    h += '<option value="figure8"' + sel('figure8') + '>Figure 8</option>';
    h += '<option value="sweepX"' + sel('sweepX') + '>Sweep X</option>';
    h += '<option value="sweepY"' + sel('sweepY') + '>Sweep Y</option>';
    h += '</optgroup><optgroup label="Geometry">';
    h += '<option value="triangle"' + sel('triangle') + '>Triangle</option>';
    h += '<option value="square"' + sel('square') + '>Square</option>';
    h += '<option value="pentagram"' + sel('pentagram') + '>Pentagram</option>';
    h += '<option value="hexagon"' + sel('hexagon') + '>Hexagon</option>';
    h += '<option value="hexagram"' + sel('hexagram') + '>Hexagram</option>';
    h += '</optgroup><optgroup label="Curves">';
    h += '<option value="rose4"' + sel('rose4') + '>Rose</option>';
    h += '<option value="lissajous"' + sel('lissajous') + '>Lissajous</option>';
    h += '<option value="spiral"' + sel('spiral') + '>Spiral</option>';
    h += '</optgroup><optgroup label="Special">';
    h += '<option value="cat"' + sel('cat') + '>Cat</option>';
    h += '<option value="butterfly"' + sel('butterfly') + '>Butterfly</option>';
    h += '<option value="infinityKnot"' + sel('infinityKnot') + '>Infinity Knot</option>';
    h += '</optgroup>';
    return h;
}

function clampToCircle(x, y) {
    var dx = x - 0.5, dy = y - 0.5;
    var dist = Math.sqrt(dx * dx + dy * dy);
    var r = 0.45; // slightly inside the circle edge so dots don't overflow
    if (dist > r) { var s = r / dist; dx *= s; dy *= s; }
    return { x: 0.5 + dx, y: 0.5 + dy };
}
// Get the fixed sector position for a snapshot by index (12 sectors like a clock)
function getSnapSectorPos(index) {
    var angle = -Math.PI / 2 + (2 * Math.PI * index / 12); // 12 fixed sectors, start from top
    var radius = 0.35;
    return { x: 0.5 + radius * Math.cos(angle), y: 0.5 + radius * Math.sin(angle) };
}
// Find plugin name by hostId
function getPluginName(hostId) {
    for (var i = 0; i < pluginBlocks.length; i++) {
        if (pluginBlocks[i].hostId === hostId || pluginBlocks[i].id === hostId) return pluginBlocks[i].name;
    }
    return '';
}
// Shared beat division lists
var BEAT_DIVS = [
    { v: '1/1', label: '1/1' },
    { v: '1/2', label: '1/2' }, { v: '1/2.', label: '1/2.' }, { v: '1/2T', label: '1/2T' },
    { v: '1/4', label: '1/4' }, { v: '1/4.', label: '1/4.' }, { v: '1/4T', label: '1/4T' },
    { v: '1/8', label: '1/8' }, { v: '1/8.', label: '1/8.' }, { v: '1/8T', label: '1/8T' },
    { v: '1/16', label: '1/16' }, { v: '1/16.', label: '1/16.' }, { v: '1/16T', label: '1/16T' },
    { v: '1/32', label: '1/32' },
    { v: '1/64', label: '1/64' }
];
var LANE_LOOP_OPTS = [
    { v: '1/16', label: '1/16' }, { v: '1/16T', label: '1/16T' },
    { v: '1/8', label: '1/8' }, { v: '1/8.', label: '1/8.' }, { v: '1/8T', label: '1/8T' },
    { v: '1/4', label: '1/4' }, { v: '1/4.', label: '1/4.' }, { v: '1/4T', label: '1/4T' },
    { v: '1/2', label: '1/2' }, { v: '1/2.', label: '1/2.' }, { v: '1/2T', label: '1/2T' },
    { v: '1/1', label: '1 bar' }, { v: '2/1', label: '2 bars' },
    { v: '4/1', label: '4 bars' }, { v: '8/1', label: '8 bars' },
    { v: '16/1', label: '16 bars' }, { v: '32/1', label: '32 bars' },
    { v: 'free', label: 'Free' }
];
var LANE_COLORS = ['#6088CC', '#CC8050', '#50CC80', '#CC5078', '#70BBCC', '#CCB850', '#A070CC', '#50CCB0'];
var MORPH_DIVS = [
    { v: '8', label: '8 Bars' }, { v: '4', label: '4 Bars' }, { v: '2', label: '2 Bars' }
].concat(BEAT_DIVS);
// Render a <select> with beat divisions
function renderBeatDivSelect(blockId, field, currentVal, divList) {
    if (!divList) divList = BEAT_DIVS;
    var h = '<select class="sub-sel" data-b="' + blockId + '" data-f="' + field + '">';
    divList.forEach(function (d) {
        h += '<option value="' + d.v + '"' + (currentVal === d.v ? ' selected' : '') + '>' + d.label + '</option>';
    });
    h += '</select>';
    return h;
}
// Convert morphSpeed (0-100) to display string
function morphSpeedDisplay(sp) {
    return Math.round(sp) + '%';
}
// Logic blocks
function addBlock(mode) {
    if (!mode) mode = 'randomize'; var id = ++bc;
    var blk = {
        id: id, mode: mode, enabled: true, targets: new Set(), targetBases: {}, targetRanges: {}, targetRangeBases: {}, colorIdx: bc - 1, trigger: 'manual', beatDiv: '1/4', midiMode: 'any_note', midiNote: 60, midiCC: 1, midiCh: 0, velScale: false, threshold: -12, audioSrc: 'main', rMin: 0, rMax: 100, rangeMode: 'relative', polarity: 'bipolar', quantize: false, qSteps: 12, movement: 'instant', glideMs: 200, envAtk: 10, envRel: 100, envSens: 50, envInvert: false, envFilterMode: 'flat', envFilterFreq: 50, envFilterBW: 5, loopMode: 'loop', sampleSpeed: 1.0, sampleReverse: false, jumpMode: 'restart', sampleName: '', sampleWaveform: null, expanded: true, clockSource: 'daw',
        snapshots: [], playheadX: 0.5, playheadY: 0.5, morphMode: 'manual', exploreMode: 'wander', lfoShape: 'circle', lfoDepth: 80, lfoRotation: 0, morphSpeed: 50, morphAction: 'jump', stepOrder: 'cycle', morphSource: 'midi', jitter: 0, morphGlide: 200, morphTempoSync: false, morphSyncDiv: '1/4', snapRadius: 100,
        shapeType: 'circle', shapeTracking: 'horizontal', shapeSize: 80, shapeSpin: 0, shapeSpeed: 50, shapePhaseOffset: 0, shapeRange: 'relative', shapePolarity: 'bipolar', shapeTempoSync: false, shapeSyncDiv: '1/4', shapeTrigger: 'free',
        laneTool: 'draw', laneGrid: '1/8', lanes: [],
        linkSources: [], linkMin: {}, linkMax: {}, linkBases: {}, linkSmoothMs: 0
    };
    blocks.push(blk);
    // shapes_range defaults to unipolar (drag direction) â€” most intuitive for per-param ranges
    if (mode === 'shapes_range') blk.shapePolarity = 'unipolar';
    actId = id; assignMode = null; renderBlocks(); renderAllPlugins(); updCounts(); syncBlocksToHost();
}
// Assign a param to a block, capturing its current value as the relative base
function assignTarget(block, pid) {
    if (!block || !pid) return;
    var p = PMap[pid];
    if (!p || p.lk) return;
    block.targets.add(pid);
    if (block.mode === 'shapes' || block.mode === 'shapes_range') {
        if (!block.targetBases) block.targetBases = {};
        if (block.targetBases[pid] === undefined) block.targetBases[pid] = p.v;
        if (block.mode === 'shapes_range') {
            if (!block.targetRanges) block.targetRanges = {};
            if (!block.targetRangeBases) block.targetRangeBases = {};
            if (block.targetRanges[pid] === undefined) {
                block.targetRanges[pid] = 0;
                block.targetRangeBases[pid] = p.v;
            }
        }
    } else if (block.mode === 'link') {
        if (!block.linkBases) block.linkBases = {};
        if (block.linkBases[pid] === undefined) block.linkBases[pid] = p.v;
    }
}
// Build a single logic block card DOM element
function buildBlockCard(b, bi) {
    var col = bColor(b.colorIdx), isAct = b.id === actId, isAs = assignMode === b.id;
    var card = document.createElement('div');
    var modeClass = b.mode === 'randomize' ? ' mode-rand' : (b.mode === 'envelope' ? ' mode-env' : (b.mode === 'morph_pad' ? ' mode-morph' : (b.mode === 'shapes' || b.mode === 'shapes_range' ? ' mode-shapes' : (b.mode === 'lane' ? ' mode-lane' : (b.mode === 'link' ? ' mode-link' : ' mode-smp')))));
    card.className = 'lcard' + modeClass + (isAct ? ' active' : '') + (b.mode === 'envelope' && isAct ? ' env-active' : '') + (b.mode === 'sample' && isAct ? ' smp-active' : '') + (b.mode === 'morph_pad' && isAct ? ' morph-active' : '') + ((b.mode === 'shapes' || b.mode === 'shapes_range') && isAct ? ' shapes-active' : '') + (b.mode === 'lane' && isAct ? ' lane-active' : '') + (b.mode === 'link' && isAct ? ' link-active' : '') + (!b.enabled ? ' disabled' : '');
    card.setAttribute('data-blockid', b.id);
    var tc = b.targets.size, tH = '';
    var sum = ''; if (b.mode === 'envelope') sum = 'Atk ' + b.envAtk + 'ms / Rel ' + b.envRel + 'ms';
    else if (b.mode === 'sample') sum = (b.sampleName || 'No sample') + ' / ' + b.loopMode;
    else if (b.mode === 'morph_pad') { var ml = { manual: 'Manual', auto: 'Auto', trigger: 'Trigger' }[b.morphMode] || 'Manual'; sum = 'Morph / ' + ml + ' / ' + (b.snapshots ? b.snapshots.length : 0) + ' snaps'; }
    else if (b.mode === 'shapes') { sum = (b.shapeType || 'circle') + ' / ' + (b.shapeTracking || 'horizontal'); }
    else if (b.mode === 'shapes_range') { var rc = 0; if (b.targetRanges) { for (var k in b.targetRanges) rc++; } sum = (b.shapeType || 'circle') + ' / ' + (b.shapeTracking || 'horizontal') + ' / ' + rc + ' ranges'; }
    else if (b.mode === 'lane') { var lc = b.lanes ? b.lanes.length : 0; sum = 'Lane / ' + lc + ' lane' + (lc !== 1 ? 's' : '') + ' / ' + (b.laneGrid || '1/8'); }
    else if (b.mode === 'link') { var lsc = b.linkSources ? b.linkSources.length : 0; var lmc = 0; if (b.linkSources) { for (var lsi = 0; lsi < b.linkSources.length; lsi++) { if (b.linkSources[lsi].pluginId === -2) lmc++; } } sum = 'Link / ' + lsc + ' src' + (lmc > 0 ? ' (' + lmc + ' macro)' : '') + ' → ' + tc + ' tgt'; }
    else { sum = ({ manual: 'Manual', tempo: 'Tempo', midi: 'MIDI', audio: 'Audio' }[b.trigger]) + ' / ' + (b.movement === 'instant' ? 'Instant' : 'Smooth'); }
    // Build pid → lane color + label map for lane-mode blocks
    var pidLaneMap = {};
    var laneOrderedPids = [];
    if (tc > 0 && b.mode === 'lane' && b.lanes) {
        for (var li = 0; li < b.lanes.length; li++) {
            var ln = b.lanes[li];
            for (var pi = 0; pi < ln.pids.length; pi++) {
                pidLaneMap[ln.pids[pi]] = { color: ln.color, label: 'L' + (li + 1) };
                laneOrderedPids.push(ln.pids[pi]);
            }
        }
        b.targets.forEach(function (pid) {
            if (!pidLaneMap[pid]) laneOrderedPids.push(pid);
        });
    }
    // Cache ordered target array for virtual scroll
    b._tgtArray = (b.mode === 'lane' && laneOrderedPids.length > 0) ? laneOrderedPids : Array.from(b.targets);
    b._pidLaneMap = pidLaneMap;
    if (tc === 0) tH = '<span class="tg-empty">No params assigned</span>';
    else {
        if (tc > 6) tH += '<input class="tgt-search" data-b="' + b.id + '" placeholder="Search targets\u2026" spellcheck="false">';
        tH += '<div class="tgt-list" data-b="' + b.id + '"></div>';
    }
    var abS = isAs ? 'background:' + col + ';color:white;border-color:' + col : '', abT = isAs ? 'Done' : 'Assign';
    var pwrCls = b.enabled ? 'pwr-btn on' : 'pwr-btn';
    var bH = '';
    // â”€â”€ MODE â€” top section â”€â”€
    // ── MODE — top section (hidden for Link) ──
    if (b.mode !== 'link') {
    bH += '<div class="block-section"><span class="block-section-label">Mode</span><div class="seg" data-b="' + b.id + '" data-f="mode"><button class="' + (b.mode === 'randomize' ? 'on' : '') + '" data-v="randomize">Randomize</button><button class="' + (b.mode === 'envelope' ? 'on' : '') + '" data-v="envelope">Envelope</button><button class="' + (b.mode === 'sample' ? 'on' : '') + '" data-v="sample">Sample</button><button class="' + (b.mode === 'morph_pad' ? 'on' : '') + '" data-v="morph_pad">Morph Pad</button><button class="' + (b.mode === 'shapes' ? 'on' : '') + '" data-v="shapes">Shapes</button><button class="' + (b.mode === 'shapes_range' ? 'on' : '') + '" data-v="shapes_range">Shapes Range</button><button class="' + (b.mode === 'lane' ? 'on' : '') + '" data-v="lane">Lane</button></div></div>';
    }
    if (b.mode === 'randomize') bH += renderRndBody(b); else if (b.mode === 'sample') bH += renderSampleBody(b); else if (b.mode === 'morph_pad') bH += renderMorphBody(b); else if (b.mode === 'shapes') bH += renderShapesBody(b); else if (b.mode === 'shapes_range') bH += renderShapesRangeBody(b); else if (b.mode === 'lane') bH += renderLaneBody(b); else if (b.mode === 'link') bH += renderLinkBody(b); else bH += renderEnvBody(b);
    // ── TARGETS (hidden for Link — targets shown inside link body) ──
    if (b.mode !== 'link') {
    bH += '<div class="block-section"><span class="block-section-label">Targets (' + tc + ')</span><div class="tgt-box">' + tH + '</div></div>';
    }
    // FIRE (randomize only)
    if (b.mode === 'randomize') bH += '<div class="block-section" style="border-bottom:none;padding-bottom:0"><button class="fire" data-b="' + b.id + '">FIRE</button></div>';
    var ch = '<span class="lchev ' + (b.expanded ? 'open' : '') + '">&#9654;</span>';
    card.innerHTML = '<div class="lhead" data-id="' + b.id + '"><div style="display:flex;align-items:center">' + ch + '<span class="block-color" style="background:' + col + '"></span><span class="ltitle">Block ' + (bi + 1) + '</span><span class="lsum">' + sum + ' / ' + tc + ' params</span></div><div style="display:flex;gap:4px;align-items:center"><div class="' + pwrCls + '" data-pwr="' + b.id + '"></div><button class="sm-btn assign-btn" data-id="' + b.id + '" style="' + abS + '">' + abT + '</button><button class="lclose" data-id="' + b.id + '">x</button></div></div><div class="lbody ' + (b.expanded ? '' : 'hide') + '">' + bH + '</div>';
    // Populate target list with virtual scrolling for large target counts
    if (tc > 0) {
        var tgtList = card.querySelector('.tgt-list[data-b="' + b.id + '"]');
        if (tgtList) _fillTargetList(tgtList, b, col);
    }
    return card;
}

// ── Target list virtual scrolling ──
var TGT_ROW_H = 22;
var TGT_VIRTUAL_THRESHOLD = 100;

function _buildTargetRow(pid, b, col) {
    var tp = PMap[pid]; if (!tp) return null;
    var pn = paramPluginName(pid);
    var rowCol = (b._pidLaneMap && b._pidLaneMap[pid]) ? b._pidLaneMap[pid].color : col;
    var laneTag = (b._pidLaneMap && b._pidLaneMap[pid])
        ? '<span class="tgt-lane-tag" style="background:' + rowCol + '22;color:' + rowCol + '">' + b._pidLaneMap[pid].label + '</span>' : '';
    var row = document.createElement('div');
    row.className = 'tgt-row';
    row.setAttribute('data-pid', pid);
    row.style.borderLeft = '3px solid ' + rowCol;
    row.innerHTML = laneTag + '<span class="tgt-name" data-pid="' + pid + '" title="Click to locate">' + pn + ': ' + tp.name + '</span>' +
        '<span class="tx" data-b="' + b.id + '" data-p="' + pid + '" title="Remove">x</span>';
    // Wire handlers inline — critical for virtual-scroll rows created after wireBlocks()
    var nameSpan = row.querySelector('.tgt-name');
    if (nameSpan) {
        nameSpan.onclick = function (e) {
            e.stopPropagation();
            var pp = PMap[pid]; if (!pp) return;
            // Expand the plugin card if collapsed
            for (var pbi = 0; pbi < pluginBlocks.length; pbi++) {
                var pb = pluginBlocks[pbi];
                if (pb.id === pp.hostId && !pb.expanded) { pb.expanded = true; dirtyPluginParams(pp.hostId); renderAllPlugins(); break; }
            }
            // Retry until virtual scroll reveals the param row
            var attempts = 0;
            (function tryLocate() {
                attempts++;
                if (typeof scrollVirtualToParam === 'function') scrollVirtualToParam(pid);
                var paramRow = document.querySelector('.pr[data-pid="' + pid + '"]');
                if (paramRow) {
                    paramRow.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                    paramRow.classList.remove('touched'); void paramRow.offsetWidth;
                    paramRow.classList.add('touched');
                } else if (attempts < 15) {
                    requestAnimationFrame(tryLocate);
                }
            })();
        };
    }
    var xBtn = row.querySelector('.tx');
    if (xBtn) {
        xBtn.onclick = function (e) {
            e.stopPropagation();
            b.targets.delete(pid);
            if (typeof cleanBlockAfterUnassign === 'function') cleanBlockAfterUnassign(b, pid);
            renderSingleBlock(b.id); renderAllPlugins(); syncBlocksToHost();
        };
    }
    return row;
}

function _fillTargetList(container, b, col) {
    var ta = b._tgtArray || Array.from(b.targets);
    var filter = (b._tgtFilter || '').toLowerCase();
    var filtered = [];
    for (var i = 0; i < ta.length; i++) {
        if (!PMap[ta[i]]) continue;
        if (filter) {
            var fullName = (paramPluginName(ta[i]) + ': ' + PMap[ta[i]].name).toLowerCase();
            if (fullName.indexOf(filter) < 0) continue;
        }
        filtered.push(ta[i]);
    }
    if (filtered.length <= TGT_VIRTUAL_THRESHOLD) {
        container._vScroll = false;
        container.style.position = '';
        container.innerHTML = '';
        for (var i = 0; i < filtered.length; i++) {
            var row = _buildTargetRow(filtered[i], b, col);
            if (row) container.appendChild(row);
        }
        container.onscroll = null;
        return;
    }
    var savedScroll = container.scrollTop || 0;
    container._vScroll = true;
    container._vItems = filtered;
    container._vBlock = b;
    container._vCol = col;
    container._vRendered = {};
    container._vStart = -1;
    container._vEnd = -1;
    container.style.position = 'relative';
    container.innerHTML = '';
    var sentinel = document.createElement('div');
    sentinel.style.height = (filtered.length * TGT_ROW_H) + 'px';
    sentinel.style.pointerEvents = 'none';
    container.appendChild(sentinel);
    container.scrollTop = savedScroll;
    _updateVirtualTargetRows(container);
    container.onscroll = function () {
        if (!container._vRaf) {
            container._vRaf = requestAnimationFrame(function () {
                container._vRaf = null;
                _updateVirtualTargetRows(container);
            });
        }
    };
}

function _updateVirtualTargetRows(container) {
    var items = container._vItems;
    if (!items) return;
    var scrollTop = container.scrollTop;
    var viewH = container.clientHeight;
    if (viewH <= 0) {
        if (!container._vRetry) {
            container._vRetry = requestAnimationFrame(function () {
                container._vRetry = null;
                _updateVirtualTargetRows(container);
            });
        }
        return;
    }
    var BUFFER = 5;
    var startIdx = Math.max(0, Math.floor(scrollTop / TGT_ROW_H) - BUFFER);
    var endIdx = Math.min(items.length - 1, Math.ceil((scrollTop + viewH) / TGT_ROW_H) + BUFFER);
    if (startIdx === container._vStart && endIdx === container._vEnd) return;
    var rendered = container._vRendered;
    for (var pid in rendered) {
        var entry = rendered[pid];
        if (entry.idx < startIdx || entry.idx > endIdx) {
            entry.row.remove();
            delete rendered[pid];
        }
    }
    for (var i = startIdx; i <= endIdx; i++) {
        var pid = items[i];
        if (rendered[pid]) continue;
        var row = _buildTargetRow(pid, container._vBlock, container._vCol);
        if (!row) continue;
        row.style.position = 'absolute';
        row.style.top = (i * TGT_ROW_H) + 'px';
        row.style.left = '0';
        row.style.right = '0';
        row.style.height = TGT_ROW_H + 'px';
        row.style.boxSizing = 'border-box';
        container.appendChild(row);
        rendered[pid] = { row: row, idx: i };
    }
    container._vStart = startIdx;
    container._vEnd = endIdx;
}
// Stamp for detecting structural changes in blocks (add/remove)
var _blockStamp = '';
function getBlockStamp() { return blocks.map(function (b) { return b.id; }).join(','); }

function renderBlocks() {
    var c = document.getElementById('lpScroll');
    var newStamp = getBlockStamp();

    // STRUCTURAL CHANGE: different blocks â€” full rebuild
    if (newStamp !== _blockStamp || c.children.length !== blocks.length) {
        _blockStamp = newStamp;
        c.innerHTML = '';
        for (var bi = 0; bi < blocks.length; bi++) {
            c.appendChild(buildBlockCard(blocks[bi], bi));
        }
        wireBlocks(); wireBlockDropTargets(); updateAssignBanner();
        return;
    }

    // PATCH: same structure â€” rebuild each card in-place
    for (var bi = 0; bi < blocks.length; bi++) {
        var b = blocks[bi];
        var oldCard = c.children[bi];
        if (!oldCard) continue;
        var newCard = buildBlockCard(b, bi);
        c.replaceChild(newCard, oldCard);
    }
    wireBlocks(); wireBlockDropTargets(); updateAssignBanner();
}
// Wire block cards as drop targets for param drag
function wireBlockDropTargets() {
    document.querySelectorAll('.lcard[data-blockid]').forEach(function (card) {
        var bid = parseInt(card.getAttribute('data-blockid'));
        var bl = findBlock(bid);

        // ── Link mode: wire separate drop zones for source (left) and target (right) ──
        if (bl && bl.mode === 'link') {
            var srcZone = card.querySelector('.link-col-source');
            var tgtZone = card.querySelector('.link-col-targets');

            // Helper to wire a drop zone
            function wireLinkDrop(zone, role) {
                if (!zone) return;
                zone.addEventListener('dragover', function (e) {
                    if (e.dataTransfer.types.indexOf('text/plain') === -1) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'copy';
                    zone.classList.add('link-drop-hover');
                    zone.classList.add('link-drop-' + role);
                });
                zone.addEventListener('dragleave', function (ev) {
                    // Only remove if we truly left the zone (not entering a child)
                    if (zone.contains(ev.relatedTarget)) return;
                    zone.classList.remove('link-drop-hover', 'link-drop-source', 'link-drop-target');
                });
                zone.addEventListener('drop', function (e) {
                    e.preventDefault();
                    e.stopPropagation(); // prevent card-level handler
                    zone.classList.remove('link-drop-hover', 'link-drop-source', 'link-drop-target');
                    var data = e.dataTransfer.getData('text/plain');
                    if (!data || data.indexOf('params:') !== 0) return;
                    var pids = data.replace('params:', '').split(',');
                    pushUndoSnapshot();
                    pids.forEach(function (pid) {
                        var pp = PMap[pid];
                        if (!pp || pp.lk) return;
                        if (role === 'source') {
                            // Add as link source
                            if (!bl.linkSources) bl.linkSources = [];
                            // Prevent duplicate source (same plugin+param)
                            var dup = false;
                            for (var si = 0; si < bl.linkSources.length; si++) {
                                if (bl.linkSources[si].pluginId === pp.hostId && bl.linkSources[si].paramIndex === pp.realIndex) { dup = true; break; }
                            }
                            if (!dup) {
                                var plugName = '';
                                for (var pi = 0; pi < pluginBlocks.length; pi++) { if (pluginBlocks[pi].hostId === pp.hostId) { plugName = pluginBlocks[pi].name; break; } }
                                bl.linkSources.push({ pluginId: pp.hostId, paramIndex: pp.realIndex, pluginName: plugName, paramName: pp.name });
                            }
                        } else {
                            // Add as link target
                            assignTarget(bl, pid);
                            // Capture link base
                            if (!bl.linkBases) bl.linkBases = {};
                            if (bl.linkBases[pid] === undefined) bl.linkBases[pid] = pp.v;
                        }
                    });
                    selectedParams.clear();
                    renderSingleBlock(bid); renderAllPlugins(); syncBlocksToHost();
                    if (typeof showToast === 'function') {
                        showToast(pids.length + ' param' + (pids.length > 1 ? 's' : '') + ' added as ' + role, 'success', 1500);
                    }
                });
            }
            wireLinkDrop(srcZone, 'source');
            wireLinkDrop(tgtZone, 'target');

            // Also wire the card level as fallback → targets
            card.addEventListener('dragover', function (e) {
                if (e.dataTransfer.types.indexOf('text/plain') === -1) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
            });
            card.addEventListener('drop', function (e) {
                e.preventDefault();
                var data = e.dataTransfer.getData('text/plain');
                if (!data || data.indexOf('params:') !== 0) return;
                var pids = data.replace('params:', '').split(',');
                pushUndoSnapshot();
                pids.forEach(function (pid) {
                    var pp = PMap[pid];
                    if (pp && !pp.lk) {
                        assignTarget(bl, pid);
                        if (!bl.linkBases) bl.linkBases = {};
                        if (bl.linkBases[pid] === undefined) bl.linkBases[pid] = pp.v;
                    }
                });
                selectedParams.clear();
                renderSingleBlock(bid); renderAllPlugins(); syncBlocksToHost();
            });
            return; // skip default handler for this card
        }

        // ── Default: drop → assignTarget ──
        card.addEventListener('dragover', function (e) {
            if (e.dataTransfer.types.indexOf('text/plain') === -1) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            if (bl) {
                var col = bColor(bl.colorIdx);
                card.style.setProperty('--drag-color', col);
            }
            card.classList.add('drag-hover');
        });
        card.addEventListener('dragleave', function () {
            card.classList.remove('drag-hover');
            card.style.removeProperty('--drag-color');
        });
        card.addEventListener('drop', function (e) {
            e.preventDefault();
            card.classList.remove('drag-hover');
            card.style.removeProperty('--drag-color');
            var data = e.dataTransfer.getData('text/plain');
            if (!data || data.indexOf('params:') !== 0) return;
            var pids = data.replace('params:', '').split(',');
            if (!bl) return;
            pids.forEach(function (pid) {
                var pp = PMap[pid];
                if (pp && !pp.lk) assignTarget(bl, pid);
            });
            selectedParams.clear();
            renderAllPlugins(); renderBlocks(); syncBlocksToHost();
        });
    });
}
// Targeted single-block update (avoids rebuilding all blocks)
function renderSingleBlock(blockId) {
    var c = document.getElementById('lpScroll');
    for (var bi = 0; bi < blocks.length; bi++) {
        if (blocks[bi].id === blockId) {
            var oldCard = c.children[bi];
            if (!oldCard) { renderBlocks(); return; }
            var newCard = buildBlockCard(blocks[bi], bi);
            c.replaceChild(newCard, oldCard);
            wireBlocks(); wireBlockDropTargets(); updateAssignBanner();
            return;
        }
    }
}
function renderRndBody(b) {
    var h = '';

    // â”€â”€ 1. BEHAVIOUR â€” trigger + movement combined in one row â”€â”€
    h += '<div class="block-section"><span class="block-section-label">Behaviour</span>';
    h += '<div class="behaviour-row">';
    h += '<div class="seg" data-b="' + b.id + '" data-f="trigger">';
    ['manual', 'tempo', 'midi', 'audio'].forEach(function (t) { h += '<button class="' + (b.trigger === t ? 'on' : '') + '" data-v="' + t + '">' + { manual: 'Manual', tempo: 'Tempo', midi: 'MIDI', audio: 'Audio' }[t] + '</button>'; });
    h += '</div>';
    h += '<div class="divider-dot"></div>';
    h += '<div class="seg-inline" data-b="' + b.id + '" data-f="movement"><button class="' + (b.movement === 'instant' ? 'on' : '') + '" data-v="instant">Instant</button><button class="' + (b.movement === 'glide' ? 'on' : '') + '" data-v="glide">Smooth</button></div>';
    h += '</div>';
    // Sub-options for trigger types
    h += '<div class="sub ' + (b.trigger === 'tempo' ? 'vis' : '') + '"><div class="sub-row"><span class="sub-lbl">Division</span>' + renderBeatDivSelect(b.id, 'beatDiv', b.beatDiv) + '<div class="seg-inline" data-b="' + b.id + '" data-f="clockSource"><button class="' + ((b.clockSource || 'daw') === 'daw' ? 'on' : '') + '" data-v="daw">DAW</button><button class="' + (b.clockSource === 'internal' ? 'on' : '') + '" data-v="internal">Int</button></div></div></div>';
    h += '<div class="sub ' + (b.trigger === 'midi' ? 'vis' : '') + '"><div class="sub-row"><span class="sub-lbl">Mode</span><select class="sub-sel" data-b="' + b.id + '" data-f="midiMode"><option value="any_note"' + (b.midiMode === 'any_note' ? ' selected' : '') + '>Any Note</option><option value="specific_note"' + (b.midiMode === 'specific_note' ? ' selected' : '') + '>Note</option><option value="cc"' + (b.midiMode === 'cc' ? ' selected' : '') + '>CC</option></select></div>';
    h += '<div class="sub-row"><span class="sub-lbl">Channel</span><select class="sub-sel" data-b="' + b.id + '" data-f="midiCh"><option value="0"' + (b.midiCh === 0 ? ' selected' : '') + '>Any</option>';
    for (var ch = 1; ch <= 16; ch++) h += '<option value="' + ch + '"' + (b.midiCh === ch ? ' selected' : '') + '>' + ch + '</option>';
    h += '</select></div></div>';
    h += '<div class="sub ' + (b.trigger === 'audio' ? 'vis' : '') + '"><div class="sl-row"><span class="sl-lbl">Thresh</span><input type="range" min="-60" max="0" value="' + b.threshold + '" data-b="' + b.id + '" data-f="threshold"><span class="sl-val">' + b.threshold + ' dB</span></div><div class="sub-row"><span class="sub-lbl">Source</span><select class="sub-sel" data-b="' + b.id + '" data-f="audioSrc"><option value="main"' + (b.audioSrc === 'main' ? ' selected' : '') + '>Main Input</option><option value="sidechain"' + (b.audioSrc === 'sidechain' ? ' selected' : '') + '>Sidechain</option></select></div></div>';
    // Glide knob (shown when smooth is selected)
    if (b.movement === 'glide') h += buildKnobRow(buildBlockKnob(b.glideMs, 1, 2000, 36, 'rand', 'glideMs', b.id, 'Glide', 'ms'));
    h += '</div>';

    // â”€â”€ 2. CONSTRAINTS â€” range + quantize in inset box â”€â”€
    h += '<div class="block-section"><span class="block-section-label">Constraints</span>';
    h += '<div class="constraints-box">';
    h += '<div class="constraints-header"><div class="seg-inline" data-b="' + b.id + '" data-f="rangeMode"><button class="' + (b.rangeMode === 'absolute' ? 'on' : '') + '" data-v="absolute">Absolute</button><button class="' + (b.rangeMode === 'relative' ? 'on' : '') + '" data-v="relative">Relative</button></div></div>';
    // Range sliders
    if (b.rangeMode === 'absolute') {
        h += '<div class="sl-row"><span class="sl-lbl">Min</span><input type="range" min="0" max="100" value="' + b.rMin + '" data-b="' + b.id + '" data-f="rMin"><span class="sl-val">' + b.rMin + '%</span></div>';
        h += '<div class="sl-row"><span class="sl-lbl">Max</span><input type="range" min="0" max="100" value="' + b.rMax + '" data-b="' + b.id + '" data-f="rMax"><span class="sl-val">' + b.rMax + '%</span></div>';
    } else {
        h += '<div class="sl-row"><span class="sl-lbl">\u00b1</span><input type="range" min="1" max="100" value="' + b.rMax + '" data-b="' + b.id + '" data-f="rMax"><span class="sl-val">' + b.rMax + '%</span></div>';
    }
    // Quantize
    h += '<div class="tgl-row"><div class="tgl ' + (b.quantize ? 'on' : '') + '" data-b="' + b.id + '" data-f="quantize"></div><span class="tgl-lbl">Quantize</span><input class="sub-input" type="number" value="' + b.qSteps + '" min="2" max="128" data-b="' + b.id + '" data-f="qSteps"' + (b.quantize ? '' : ' disabled') + '><span class="sub-lbl" style="min-width:auto">steps</span></div>';
    h += '</div></div>';

    return h;
}
// Convert envelope filter dial position (0-100) to Hz (log scale 20-20000)
var ENV_BW_STEPS = [0.1, 0.33, 0.67, 1, 1.5, 2, 3, 5];
var ENV_BW_LABELS = ['1/10', '1/3', '2/3', '1', '1.5', '2', '3', '5'];
function envDialToHz(dp) { return 20 * Math.pow(10, (dp != null ? dp : 50) * 0.03); }
function envFmtHz(dp) { var hz = envDialToHz(dp); return hz >= 1000 ? (hz / 1000).toFixed(1) + 'k' : Math.round(hz) + 'Hz'; }
function envBwIdxToOct(idx) { return ENV_BW_STEPS[Math.round(Math.max(0, Math.min(7, idx)))] || 2; }
function envFmtBw(idx) { return ENV_BW_LABELS[Math.round(Math.max(0, Math.min(7, idx)))] + ' oct'; }
// Build SVG frequency response visualization for envelope filter
function buildEnvFilterSvg(b) {
    var w = 200, h = 42, pt = 3, pb = 10, plotH = h - pt - pb;
    var mode = b.envFilterMode || 'flat';
    var freq = envDialToHz(b.envFilterFreq);
    var bwOct = envBwIdxToOct(b.envFilterBW);
    function fToX(f) { return (Math.log10(Math.max(20, f)) - Math.log10(20)) / 3 * w; }
    function lpM(f, fc) { var r = f / fc; return 1 / Math.sqrt(1 + r * r * r * r); }
    function hpM(f, fc) { var r = fc / f; return 1 / Math.sqrt(1 + r * r * r * r); }
    function mag(f) {
        if (mode === 'flat') return 1;
        if (mode === 'lp') return lpM(f, freq);
        if (mode === 'hp') return hpM(f, freq);
        if (mode === 'bp') { return hpM(f, freq / Math.pow(2, bwOct / 2)) * lpM(f, freq * Math.pow(2, bwOct / 2)); }
        return 1;
    }
    var pts = [];
    for (var i = 0; i <= 60; i++) {
        var f = 20 * Math.pow(1000, i / 60);
        pts.push(fToX(f).toFixed(1) + ',' + (pt + plotH * (1 - mag(f))).toFixed(1));
    }
    var svg = '<svg viewBox="0 0 ' + w + ' ' + h + '" class="env-filter-svg" preserveAspectRatio="none">';
    svg += '<rect x="0" y="0" width="' + w + '" height="' + h + '" rx="3" fill="var(--bg-inset)" />';
    var gf = [50, 200, 500, 2000, 5000];
    for (var gi = 0; gi < gf.length; gi++) { var gx = fToX(gf[gi]); svg += '<line x1="' + gx.toFixed(1) + '" y1="' + pt + '" x2="' + gx.toFixed(1) + '" y2="' + (h - pb) + '" stroke="var(--border)" stroke-opacity="0.3" stroke-width="0.5" />'; }
    svg += '<path d="M 0,' + (h - pb) + ' L ' + pts.join(' L ') + ' L ' + w + ',' + (h - pb) + ' Z" fill="var(--accent)" fill-opacity="0.15" stroke="var(--accent)" stroke-opacity="0.7" stroke-width="1.2" />';
    var lbs = [{ f: 20, l: '20' }, { f: 50, l: '50' }, { f: 200, l: '200' }, { f: 500, l: '500' }, { f: 2000, l: '2k' }, { f: 5000, l: '5k' }, { f: 20000, l: '20k' }];
    for (var li = 0; li < lbs.length; li++) { svg += '<text x="' + fToX(lbs[li].f).toFixed(1) + '" y="' + (h - 1) + '" font-size="6.5" fill="var(--text-muted)" text-anchor="middle" font-family="system-ui">' + lbs[li].l + '</text>'; }
    if (mode !== 'flat') { var fx = fToX(freq); svg += '<line x1="' + fx.toFixed(1) + '" y1="' + pt + '" x2="' + fx.toFixed(1) + '" y2="' + (h - pb) + '" stroke="var(--accent)" stroke-opacity="0.5" stroke-width="1" stroke-dasharray="2,2" />'; }
    svg += '</svg>';
    return svg;
}
// Reusable Detection Band section â€” call from any block that uses audio analysis
function buildDetectionBandSection(b, knobMode) {
    var fm = b.envFilterMode || 'flat';
    var isFlat = (fm === 'flat');
    var h = '<div class="block-section"><span class="block-section-label">Detection Band</span>';
    h += '<div class="env-input-box">';
    h += '<div class="seg" data-b="' + b.id + '" data-f="envFilterMode">';
    h += '<button class="' + (fm === 'flat' ? 'on' : '') + '" data-v="flat">&#8734; Full</button>';
    h += '<button class="' + (fm === 'lp' ? 'on' : '') + '" data-v="lp">&#9586; LP</button>';
    h += '<button class="' + (fm === 'hp' ? 'on' : '') + '" data-v="hp">&#9585; HP</button>';
    h += '<button class="' + (fm === 'bp' ? 'on' : '') + '" data-v="bp">&#8745; Band</button>';
    h += '</div>';
    h += '<div class="env-filter-viz" id="envViz-' + b.id + '">' + buildEnvFilterSvg(b) + '</div>';
    if (!isFlat) {
        var freqVal = b.envFilterFreq != null ? b.envFilterFreq : 50;
        if (fm === 'bp') {
            var bwIdx = b.envFilterBW != null ? b.envFilterBW : 5;
            h += buildKnobRow(
                buildBlockKnob(freqVal, 0, 100, 36, knobMode, 'envFilterFreq', b.id, 'Frequency', 'Hz', envFmtHz) +
                buildBlockKnob(bwIdx, 0, 7, 36, knobMode, 'envFilterBW', b.id, 'Width', 'oct', envFmtBw)
            );
        } else {
            h += buildKnobRow(
                buildBlockKnob(freqVal, 0, 100, 36, knobMode, 'envFilterFreq', b.id, 'Frequency', 'Hz', envFmtHz)
            );
        }
    }
    h += '</div></div>';
    return h;
}
function renderEnvBody(b) {
    // Envelope follower always operates in relative mode, no invert
    b.rangeMode = 'relative';
    b.envInvert = false;
    var h = '';

    // â”€â”€ 1. INPUT â€” meter + source in contained inset box â”€â”€
    h += '<div class="block-section"><span class="block-section-label">Source</span>';
    h += '<div class="env-input-box">';
    h += '<div class="brow"><span class="blbl"><span class="env-active-dot" id="envDot-' + b.id + '"></span>Envelope Follower</span><div class="env-meter" id="envMeter-' + b.id + '"><div class="env-meter-fill" id="envFill-' + b.id + '" style="height:0%"></div><div class="env-peak-line" id="envPeak-' + b.id + '" style="bottom:0%"></div><span class="env-label" id="envLbl-' + b.id + '">0%</span></div></div>';
    h += '<div class="brow-inline"><span class="blbl">Source</span><div class="seg-inline" data-b="' + b.id + '" data-f="audioSrc"><button class="' + (b.audioSrc === 'main' ? 'on' : '') + '" data-v="main">Main</button><button class="' + (b.audioSrc === 'sidechain' ? 'on' : '') + '" data-v="sidechain">Sidechain</button></div></div>';
    h += '</div></div>';

    // â”€â”€ 2. DETECTION BAND â”€â”€
    h += buildDetectionBandSection(b, 'env');

    // â”€â”€ 3. ENVELOPE & DEPTH â€” polarity + attack/release/depth â”€â”€
    b.rMax = 100;
    h += '<div class="block-section"><span class="block-section-label">Envelope \u0026 Depth</span>';
    h += '<div class="env-input-box">';
    h += '<div class="seg" data-b="' + b.id + '" data-f="polarity">';
    h += '<button class="' + ((b.polarity || 'bipolar') === 'bipolar' ? 'on' : '') + '" data-v="bipolar">\u00b1 Bi</button>';
    h += '<button class="' + (b.polarity === 'up' ? 'on' : '') + '" data-v="up">\u2191 Up</button>';
    h += '<button class="' + (b.polarity === 'down' ? 'on' : '') + '" data-v="down">\u2193 Down</button>';
    h += '</div>';
    h += buildKnobRow(
        buildBlockKnob(b.envAtk, 1, 500, 36, 'env', 'envAtk', b.id, 'Attack', 'ms') +
        buildBlockKnob(b.envRel, 1, 2000, 36, 'env', 'envRel', b.id, 'Release', 'ms') +
        buildBlockKnob(b.envSens, 0, 200, 36, 'env', 'envSens', b.id, 'Depth', '%')
    );
    h += '</div></div>';

    return h;
}
function renderSampleBody(b) {
    var h = '';

    // â”€â”€ 1. SAMPLE PLAYBACK â€” waveform + loop/reverse/speed in inset box â”€â”€
    h += '<div class="block-section"><span class="block-section-label">Sample Playback</span>';
    h += '<div class="sample-zone" data-b="' + b.id + '">';
    if (b.sampleWaveform && b.sampleWaveform.length) {
        h += '<canvas class="waveform-cv" id="waveCv-' + b.id + '" width="260" height="48"></canvas>';
        h += '<div class="waveform-head" id="waveHead-' + b.id + '"></div>';
        h += '<div class="sample-name">' + (b.sampleName || 'Loaded') + '</div>';
    } else {
        h += '<div class="drop-label">No sample loaded</div>';
    }
    h += '<button class="sm-btn load-smp" data-b="' + b.id + '">Load</button></div>';
    h += '<div class="constraints-box">';
    h += '<div class="behaviour-row">';
    h += '<div class="seg-inline" data-b="' + b.id + '" data-f="loopMode">';
    h += '<button class="' + (b.loopMode === 'oneshot' ? 'on' : '') + '" data-v="oneshot">1-shot</button>';
    h += '<button class="' + (b.loopMode === 'loop' ? 'on' : '') + '" data-v="loop">Loop</button>';
    h += '<button class="' + (b.loopMode === 'pingpong' ? 'on' : '') + '" data-v="pingpong">P-pong</button>';
    h += '</div>';
    h += '<div class="tgl-row" style="margin-left:auto"><div class="tgl ' + (b.sampleReverse ? 'on' : '') + '" data-b="' + b.id + '" data-f="sampleReverse"></div><span class="tgl-lbl">Rev</span></div>';
    h += '</div>';
    h += '<div class="sl-row"><span class="sl-lbl">Speed</span>';
    h += '<input type="range" min="10" max="3200" value="' + Math.round(b.sampleSpeed * 100) + '" data-b="' + b.id + '" data-f="sampleSpeedPct">';
    h += '<span class="sl-val">' + b.sampleSpeed.toFixed(1) + 'x</span></div>';
    h += '</div></div>';

    // â”€â”€ Detection Band (reusable) â”€â”€
    h += buildDetectionBandSection(b, 'smp');

    // -- ENVELOPE & DEPTH -- polarity + attack/release/depth --
    b.rangeMode = 'relative';
    b.rMax = 100;
    h += '<div class="block-section"><span class="block-section-label">Envelope \u0026 Depth</span>';
    h += '<div class="env-input-box">';
    h += '<div class="seg" data-b="' + b.id + '" data-f="polarity">';
    h += '<button class="' + ((b.polarity || 'bipolar') === 'bipolar' ? 'on' : '') + '" data-v="bipolar">\u00b1 Bi</button>';
    h += '<button class="' + (b.polarity === 'up' ? 'on' : '') + '" data-v="up">\u2191 Up</button>';
    h += '<button class="' + (b.polarity === 'down' ? 'on' : '') + '" data-v="down">\u2193 Down</button>';
    h += '</div>';
    h += buildKnobRow(
        buildBlockKnob(b.envAtk, 1, 500, 36, 'smp', 'envAtk', b.id, 'Attack', 'ms') +
        buildBlockKnob(b.envRel, 1, 2000, 36, 'smp', 'envRel', b.id, 'Release', 'ms') +
        buildBlockKnob(b.envSens, 0, 200, 36, 'smp', 'envSens', b.id, 'Depth', '%')
    );
    h += '</div></div>';

    // â”€â”€ 4. JUMP TRIGGER â€” trigger + sub-options + on jump in inset box â”€â”€
    h += '<div class="block-section"><span class="block-section-label">Jump Trigger</span>';
    h += '<div class="constraints-box">';
    h += '<div class="seg" data-b="' + b.id + '" data-f="trigger">';
    h += '<button class="' + (b.trigger === 'manual' ? 'on' : '') + '" data-v="manual">None</button>';
    h += '<button class="' + (b.trigger === 'tempo' ? 'on' : '') + '" data-v="tempo">Tempo</button>';
    h += '<button class="' + (b.trigger === 'midi' ? 'on' : '') + '" data-v="midi">MIDI</button>';
    h += '<button class="' + (b.trigger === 'audio' ? 'on' : '') + '" data-v="audio">Audio</button>';
    h += '</div>';
    // Trigger sub-options
    if (b.trigger === 'tempo') {
        h += '<div class="behaviour-row"><span class="sub-lbl">Div</span>' + renderBeatDivSelect(b.id, 'beatDiv', b.beatDiv);
        h += '<div class="seg-inline" data-b="' + b.id + '" data-f="clockSource"><button class="' + ((b.clockSource || 'daw') === 'daw' ? 'on' : '') + '" data-v="daw">DAW</button><button class="' + (b.clockSource === 'internal' ? 'on' : '') + '" data-v="internal">Int</button></div></div>';
        h += '<div class="behaviour-row"><span class="sub-lbl">On jump</span><div class="seg-inline" data-b="' + b.id + '" data-f="jumpMode"><button class="' + (b.jumpMode === 'restart' ? 'on' : '') + '" data-v="restart">Restart</button><button class="' + (b.jumpMode === 'random' ? 'on' : '') + '" data-v="random">Random</button></div></div>';
    } else if (b.trigger === 'midi') {
        h += '<div class="sub-row"><span class="sub-lbl">Mode</span><select class="sub-sel" data-b="' + b.id + '" data-f="midiMode">';
        h += '<option value="any_note"' + (b.midiMode === 'any_note' ? ' selected' : '') + '>Any Note</option>';
        h += '<option value="specific_note"' + (b.midiMode === 'specific_note' ? ' selected' : '') + '>Note</option>';
        h += '<option value="cc"' + (b.midiMode === 'cc' ? ' selected' : '') + '>CC</option></select>';
        if (b.midiMode === 'specific_note') h += '<input class="sub-input" type="number" min="0" max="127" value="' + b.midiNote + '" data-b="' + b.id + '" data-f="midiNote">';
        if (b.midiMode === 'cc') h += '<input class="sub-input" type="number" min="0" max="127" value="' + b.midiCC + '" data-b="' + b.id + '" data-f="midiCC">';
        h += '<span class="sub-lbl">Ch</span><select class="sub-sel" data-b="' + b.id + '" data-f="midiCh"><option value="0"' + (b.midiCh == 0 ? ' selected' : '') + '>Any</option>';
        for (var c = 1; c <= 16; c++) h += '<option value="' + c + '"' + (parseInt(b.midiCh) === c ? ' selected' : '') + '>' + c + '</option>';
        h += '</select></div>';
        h += '<div class="behaviour-row"><span class="sub-lbl">On jump</span><div class="seg-inline" data-b="' + b.id + '" data-f="jumpMode"><button class="' + (b.jumpMode === 'restart' ? 'on' : '') + '" data-v="restart">Restart</button><button class="' + (b.jumpMode === 'random' ? 'on' : '') + '" data-v="random">Random</button></div></div>';
    } else if (b.trigger === 'audio') {
        h += '<div class="sub-row"><span class="sub-lbl">Src</span><select class="sub-sel" data-b="' + b.id + '" data-f="audioSrc">';
        h += '<option value="main"' + (b.audioSrc === 'main' ? ' selected' : '') + '>Main</option>';
        h += '<option value="sidechain"' + (b.audioSrc === 'sidechain' ? ' selected' : '') + '>SC</option></select>';
        h += '<span class="sub-lbl">Thr</span><input class="sub-input" type="number" min="-60" max="0" value="' + b.threshold + '" data-b="' + b.id + '" data-f="threshold"><span class="sub-lbl">dB</span></div>';
        h += '<div class="behaviour-row"><span class="sub-lbl">On jump</span><div class="seg-inline" data-b="' + b.id + '" data-f="jumpMode"><button class="' + (b.jumpMode === 'restart' ? 'on' : '') + '" data-v="restart">Restart</button><button class="' + (b.jumpMode === 'random' ? 'on' : '') + '" data-v="random">Random</button></div></div>';
    } else {
        // None - still show on-jump inline
        h += '<div class="behaviour-row"><span class="sub-lbl">On jump</span><div class="seg-inline" data-b="' + b.id + '" data-f="jumpMode"><button class="' + (b.jumpMode === 'restart' ? 'on' : '') + '" data-v="restart">Restart</button><button class="' + (b.jumpMode === 'random' ? 'on' : '') + '" data-v="random">Random</button></div></div>';
    }
    h += '</div></div>';

    return h;
}
// Shared shape computation — matches C++ computeShapeXY exactly
// Returns {dx, dy} offsets from center for a given shape, phase t, and radius R
function computeShapeDxDy(shape, t, R) {
    var twoPi = Math.PI * 2;
    var halfPi = Math.PI / 2;
    var dx = 0, dy = 0;
    if (shape === 'circle') {
        dx = R * Math.cos(t); dy = R * Math.sin(t);
    } else if (shape === 'figure8') {
        dx = R * Math.sin(t); dy = R * Math.sin(t * 2);
    } else if (shape === 'sweepX') {
        dx = R * Math.sin(t); dy = 0;
    } else if (shape === 'sweepY') {
        dx = 0; dy = R * Math.sin(t);
    } else if (shape === 'triangle' || shape === 'square' || shape === 'hexagon') {
        var n = shape === 'triangle' ? 3 : (shape === 'square' ? 4 : 6);
        var segF = t * n / twoPi;
        var seg = Math.floor(segF) % n;
        var segT = segF - Math.floor(segF);
        var a0 = twoPi * seg / n - halfPi;
        var a1 = twoPi * ((seg + 1) % n) / n - halfPi;
        dx = R * (Math.cos(a0) + segT * (Math.cos(a1) - Math.cos(a0)));
        dy = R * (Math.sin(a0) + segT * (Math.sin(a1) - Math.sin(a0)));
    } else if (shape === 'pentagram') {
        var order = [0, 2, 4, 1, 3];
        var segF = t * 5 / twoPi;
        var seg = Math.floor(segF) % 5;
        var segT = segF - Math.floor(segF);
        var from = order[seg], to = order[(seg + 1) % 5];
        var a0 = twoPi * from / 5 - halfPi;
        var a1 = twoPi * to / 5 - halfPi;
        dx = R * (Math.cos(a0) + segT * (Math.cos(a1) - Math.cos(a0)));
        dy = R * (Math.sin(a0) + segT * (Math.sin(a1) - Math.sin(a0)));
    } else if (shape === 'hexagram') {
        // Star of David: trace two interlocked triangles (0,2,4,1,3,5)
        var starOrder = [0, 2, 4, 1, 3, 5];
        var segF = t * 6 / twoPi;
        var seg = Math.floor(segF) % 6;
        var segT = segF - Math.floor(segF);
        var fromIdx = starOrder[seg], toIdx = starOrder[(seg + 1) % 6];
        var aFrom = twoPi * fromIdx / 6 - halfPi;
        var aTo = twoPi * toIdx / 6 - halfPi;
        dx = R * (Math.cos(aFrom) + segT * (Math.cos(aTo) - Math.cos(aFrom)));
        dy = R * (Math.sin(aFrom) + segT * (Math.sin(aTo) - Math.sin(aFrom)));
    } else if (shape === 'rose4') {
        var r = R * Math.cos(2 * t);
        dx = r * Math.cos(t); dy = r * Math.sin(t);
    } else if (shape === 'lissajous') {
        dx = R * 0.7 * Math.sin(3 * t); dy = R * 0.7 * Math.sin(2 * t);
    } else if (shape === 'spiral') {
        var progress = t / twoPi;
        var rNorm = progress < 0.5 ? progress * 2 : (1 - progress) * 2;
        var sR = R * (0.05 + 0.95 * rNorm);
        var sA = t * 3;
        dx = sR * Math.cos(sA); dy = sR * Math.sin(sA);
    } else if (shape === 'cat') {
        // Cat face: polar contour with ears, eyes, nose, mouth
        var bodyR = R * 0.52;
        var pi = Math.PI;
        var angDist = function (a, b) {
            var d = Math.abs(a - b);
            return d > pi ? twoPi - d : d;
        };
        var bump = 0;
        var dE;
        // -- Ears: sharp triangular bumps at ~55deg and ~125deg --
        var earR = R * 0.42, earW = 0.32, earTipW = 0.09;
        dE = angDist(t, pi * 0.31); // right ear ~56deg
        if (dE < earW) {
            var x = 1 - dE / earW;
            bump += earR * x * x;
            if (dE < earTipW) bump += R * 0.18 * (1 - dE / earTipW);
        }
        dE = angDist(t, pi * 0.69); // left ear ~124deg
        if (dE < earW) {
            var x = 1 - dE / earW;
            bump += earR * x * x;
            if (dE < earTipW) bump += R * 0.18 * (1 - dE / earTipW);
        }
        // -- Eyes: small outward bumps at ~320deg and ~220deg --
        var eyeR = R * 0.08, eyeW = 0.18;
        dE = angDist(t, pi * 1.78); // right eye ~320deg
        if (dE < eyeW) bump += eyeR * Math.pow(1 - dE / eyeW, 2);
        dE = angDist(t, pi * 1.22); // left eye ~220deg
        if (dE < eyeW) bump += eyeR * Math.pow(1 - dE / eyeW, 2);
        // -- Nose: small inward dip at ~270deg --
        dE = angDist(t, pi * 1.5);
        if (dE < 0.12) bump -= R * 0.06 * (1 - dE / 0.12);
        // -- Mouth: W-shape at bottom (~255deg and ~285deg bumps, ~270deg dip) --
        dE = angDist(t, pi * 1.42); // left mouth corner ~255deg
        if (dE < 0.1) bump += R * 0.04 * (1 - dE / 0.1);
        dE = angDist(t, pi * 1.58); // right mouth corner ~285deg
        if (dE < 0.1) bump += R * 0.04 * (1 - dE / 0.1);
        // -- Chin: slight flat tuck --
        dE = angDist(t, pi * 1.5);
        if (dE < 0.35) bump -= R * 0.03 * Math.pow(1 - dE / 0.35, 2);
        var totalR = bodyR + bump;
        dx = totalR * Math.cos(t); dy = totalR * Math.sin(t);
    } else if (shape === 'butterfly') {
        // Butterfly curve: r = e^cos(t) - 2*cos(4t), closes in one 2pi cycle
        var r = Math.exp(Math.cos(t)) - 2 * Math.cos(4 * t);
        var scale = R * 0.21;
        dx = scale * r * Math.sin(t); dy = -scale * r * Math.cos(t);
    } else if (shape === 'infinityKnot') {
        dx = R * 0.7 * (Math.sin(t) + 2 * Math.sin(2 * t)) / 3;
        dy = R * 0.7 * (Math.cos(t) - 2 * Math.cos(2 * t)) / 3;
    } else {
        dx = R * Math.cos(t); dy = R * Math.sin(t);
    }
    return { dx: dx, dy: dy };
}
// Build SVG path visualizing the LFO shape on the morph pad
function buildLfoPathSvg(b) {
    var depth = (b.lfoDepth != null ? b.lfoDepth : 80) / 100;
    var R = depth * 0.48;
    var shape = b.lfoShape || 'circle';
    var twoPi = Math.PI * 2;
    var N = 200;
    var pts = [];
    for (var i = 0; i <= N; i++) {
        var t = (i / N) * twoPi;
        var s = computeShapeDxDy(shape, t, R);
        var px = (0.5 + s.dx) * 100;
        var py = (1 - (0.5 + s.dy)) * 100;
        pts.push(px.toFixed(1) + ',' + py.toFixed(1));
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" class="lfo-path-svg" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet"><polyline points="' + pts.join(' ') + '" fill="none" stroke-width="1" vector-effect="non-scaling-stroke"/></svg>';
}
// Build SVG for shapes block - independent from LFO path
function buildShapePathSvg(b, overrideSize) {
    var sz = overrideSize !== undefined ? overrideSize : (b.shapeSize != null ? b.shapeSize : 80);
    var R = (sz / 100) * 0.48; // size 100 = fills the pad circle with margin for dot
    var shape = b.shapeType || 'circle';
    var twoPi = Math.PI * 2;
    var N = 200;
    var pts = [];
    for (var i = 0; i <= N; i++) {
        var t = (i / N) * twoPi;
        var s = computeShapeDxDy(shape, t, R);
        var px = (0.5 + s.dx) * 100;
        var py = (1 - (0.5 + s.dy)) * 100;
        pts.push(px.toFixed(1) + ',' + py.toFixed(1));
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" class="lfo-path-svg" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet"><polyline points="' + pts.join(' ') + '" fill="none" stroke-width="1" vector-effect="non-scaling-stroke"/></svg>';
}
function renderShapesBody(b) {
    var h = '';

    // â”€â”€ 1. XY PAD â”€â”€
    h += '<div class="block-section"><span class="block-section-label">XY Pad</span>';
    h += '<div class="morph-pad shapes-pad" data-b="' + b.id + '">';
    h += buildShapePathSvg(b);
    var trackClass = 'shape-readout shape-readout-' + (b.shapeTracking || 'horizontal');
    h += '<div class="' + trackClass + '" id="shapeReadout-' + b.id + '"></div>';
    h += '<div class="playhead-dot" id="shapeHead-' + b.id + '" style="left:50%;top:50%"></div>';
    h += '</div></div>';

    // â”€â”€ 2. RANGE â€” always relative (offset source) + polarity + retrigger â”€â”€
    b.shapeRange = 'relative';
    h += '<div class="block-section"><span class="block-section-label">Range</span>';
    h += '<div class="constraints-box">';
    h += '<div class="seg" data-b="' + b.id + '" data-f="shapePolarity"><button class="' + (b.shapePolarity === 'up' ? 'on' : '') + '" data-v="up">\u2191 Up</button><button class="' + ((b.shapePolarity || 'bipolar') === 'bipolar' ? 'on' : '') + '" data-v="bipolar">\u2195 Bipolar</button><button class="' + (b.shapePolarity === 'down' ? 'on' : '') + '" data-v="down">\u2193 Down</button></div>';
    h += '<div class="behaviour-row"><span class="sl-lbl">Retrigger</span><div class="seg-inline" data-b="' + b.id + '" data-f="shapeTrigger"><button class="' + ((b.shapeTrigger || 'free') === 'free' ? 'on' : '') + '" data-v="free">Free</button><button class="' + (b.shapeTrigger === 'midi' ? 'on' : '') + '" data-v="midi">MIDI</button></div></div>';
    h += '</div></div>';

    // â”€â”€ 3. SHAPE & TRACKING â€” shape select + tracking + knobs + sliders + sync â”€â”€
    h += '<div class="block-section"><span class="block-section-label">Shape &amp; Tracking</span>';
    h += '<div class="constraints-box">';
    // Shape selector
    h += '<select class="sub-sel" data-b="' + b.id + '" data-f="shapeType">';
    h += buildShapeOptions('shapeType', b);
    h += '</select>';
    // Tracking axis
    h += '<div class="seg" data-b="' + b.id + '" data-f="shapeTracking">';
    h += '<button class="' + (b.shapeTracking === 'horizontal' ? 'on' : '') + '" data-v="horizontal">Horizontal</button>';
    h += '<button class="' + (b.shapeTracking === 'vertical' ? 'on' : '') + '" data-v="vertical">Vertical</button>';
    h += '<button class="' + (b.shapeTracking === 'distance' ? 'on' : '') + '" data-v="distance">Distance</button>';
    h += '</div>';
    // Speed + Spin + Size knobs
    var sizeVal = b.shapeSize != null ? b.shapeSize : 80;
    var speedVal = b.shapeSpeed || 50;
    var spinVal = b.shapeSpin || 0;
    var phaseVal = b.shapePhaseOffset || 0;
    h += buildKnobRow(
        buildBlockKnob(speedVal, 1, 100, 36, 'shapes', 'shapeSpeed', b.id, 'Speed', '%', null, b.shapeTempoSync) +
        buildBlockKnob(spinVal, -100, 100, 36, 'shapes', 'shapeSpin', b.id, 'Spin', 'Â±') +
        buildBlockKnob(sizeVal, 1, 100, 36, 'shapes', 'shapeSize', b.id, 'Size', '%') +
        buildBlockKnob(phaseVal, 0, 360, 36, 'shapes', 'shapePhaseOffset', b.id, 'Phase', 'Â°')
    );
    // Sync toggle
    h += '<div class="behaviour-row"><div class="tgl ' + (b.shapeTempoSync ? 'on' : '') + '" data-b="' + b.id + '" data-f="shapeTempoSync"></div><span class="tgl-lbl">Sync</span>';
    if (b.shapeTempoSync) {
        var divs = [{ v: '4/1', label: '4 Bars' }, { v: '2/1', label: '2 Bars' }].concat(BEAT_DIVS);
        h += renderBeatDivSelect(b.id, 'shapeSyncDiv', b.shapeSyncDiv, divs);
        h += '<div class="seg-inline" data-b="' + b.id + '" data-f="clockSource"><button class="' + ((b.clockSource || 'daw') === 'daw' ? 'on' : '') + '" data-v="daw">DAW</button><button class="' + (b.clockSource === 'internal' ? 'on' : '') + '" data-v="internal">Int</button></div>';
    }
    h += '</div>';
    h += '</div></div>';

    return h;
}
// â”€â”€ SHAPES RANGE: per-param range variant of Shapes â”€â”€
function renderShapesRangeBody(b) {
    var h = '';
    // â”€â”€ 1. XY PAD (same as Shapes) â”€â”€
    h += '<div class="block-section"><span class="block-section-label">XY Pad</span>';
    h += '<div class="morph-pad shapes-pad" data-b="' + b.id + '">';
    h += buildShapePathSvg(b, 100); // Always max size for shapes_range
    var trackClass = 'shape-readout shape-readout-' + (b.shapeTracking || 'horizontal');
    h += '<div class="' + trackClass + '" id="shapeReadout-' + b.id + '"></div>';
    h += '<div class="playhead-dot" id="shapeHead-' + b.id + '" style="left:50%;top:50%"></div>';
    h += '</div></div>';

    // â”€â”€ 2. POLARITY (no abs/rel â€” always relative) â”€â”€
    h += '<div class="block-section"><span class="block-section-label">Polarity</span>';
    h += '<div class="seg" data-b="' + b.id + '" data-f="shapePolarity"><button class="' + ((b.shapePolarity || 'bipolar') === 'bipolar' ? 'on' : '') + '" data-v="bipolar">\u2195 Bipolar</button><button class="' + (b.shapePolarity === 'unipolar' ? 'on' : '') + '" data-v="unipolar">\u2197 Unipolar (Drag Direction)</button></div>';
    h += '</div>';

    // â”€â”€ 3. PER-PARAM RANGES list â”€â”€
    h += '<div class="block-section"><span class="block-section-label">Per-Param Ranges</span>';
    h += '<div class="constraints-box sr-ranges" data-b="' + b.id + '">';
    var rangeCount = 0;
    if (b.targetRanges) {
        var tArr = Array.from(b.targets);
        for (var ri = 0; ri < tArr.length; ri++) {
            var pid = tArr[ri], p = PMap[pid];
            if (!p) continue;
            var range = b.targetRanges[pid] !== undefined ? b.targetRanges[pid] : 0;
            rangeCount++;
            var pct = Math.round(range * 100);
            var sign = pct > 0 ? '+' : '';
            var base = b.targetRangeBases && b.targetRangeBases[pid] !== undefined ? b.targetRangeBases[pid] : p.v;
            var basePct = Math.round(base * 100);
            var rangeClass = pct > 0 ? ' sr-pos' : (pct < 0 ? ' sr-neg' : '');
            h += '<div class="sr-range-row"><span class="sr-range-name">' + paramPluginName(pid) + ': ' + p.name + '</span><span class="sr-range-val' + rangeClass + '">' + sign + pct + '% @ ' + basePct + '%</span></div>';
        }
    }
    if (rangeCount === 0) h += '<div class="sr-range-empty">Click Assign, then drag knobs to set ranges</div>';
    h += '</div></div>';

    // â”€â”€ 4. SHAPE & TRACKING (same as Shapes but no depth/size knobs) â”€â”€
    h += '<div class="block-section"><span class="block-section-label">Shape &amp; Tracking</span>';
    h += '<div class="constraints-box">';
    // Shape selector
    h += '<select class="sub-sel" data-b="' + b.id + '" data-f="shapeType">';
    h += buildShapeOptions('shapeType', b);
    h += '</select>';
    // Tracking axis
    h += '<div class="seg" data-b="' + b.id + '" data-f="shapeTracking">';
    h += '<button class="' + (b.shapeTracking === 'horizontal' ? 'on' : '') + '" data-v="horizontal">Horizontal</button>';
    h += '<button class="' + (b.shapeTracking === 'vertical' ? 'on' : '') + '" data-v="vertical">Vertical</button>';
    h += '<button class="' + (b.shapeTracking === 'distance' ? 'on' : '') + '" data-v="distance">Distance</button>';
    h += '</div>';
    // Speed + Spin knobs (no Size knob â€” always max for shapes_range)
    var speedVal = b.shapeSpeed || 50;
    var spinVal = b.shapeSpin || 0;
    var phaseVal = b.shapePhaseOffset || 0;
    h += buildKnobRow(
        buildBlockKnob(speedVal, 1, 100, 36, 'shapes', 'shapeSpeed', b.id, 'Speed', '%', null, b.shapeTempoSync) +
        buildBlockKnob(spinVal, -100, 100, 36, 'shapes', 'shapeSpin', b.id, 'Spin', 'Â±') +
        buildBlockKnob(phaseVal, 0, 360, 36, 'shapes', 'shapePhaseOffset', b.id, 'Phase', 'Â°')
    );
    // Sync toggle
    h += '<div class="behaviour-row"><div class="tgl ' + (b.shapeTempoSync ? 'on' : '') + '" data-b="' + b.id + '" data-f="shapeTempoSync"></div><span class="tgl-lbl">Sync</span>';
    if (b.shapeTempoSync) {
        var divs = [{ v: '4/1', label: '4 Bars' }, { v: '2/1', label: '2 Bars' }].concat(BEAT_DIVS);
        h += renderBeatDivSelect(b.id, 'shapeSyncDiv', b.shapeSyncDiv, divs);
        h += '<div class="seg-inline" data-b="' + b.id + '" data-f="clockSource"><button class="' + ((b.clockSource || 'daw') === 'daw' ? 'on' : '') + '" data-v="daw">DAW</button><button class="' + (b.clockSource === 'internal' ? 'on' : '') + '" data-v="internal">Int</button></div>';
    }
    h += '</div>';
    h += '</div></div>';
    return h;
}



// ── Link Mode ──
function renderLinkBody(b) {
    var h = '';
    // Two-column layout: SOURCE (left) | TARGETS (right)
    h += '<div class="link-columns">';

    // ═══ LEFT COLUMN: SOURCES ═══
    h += '<div class="link-col-source">';
    var _srcCount = (b.linkSources || []).length;
    h += '<div class="link-src-section-hdr"><span class="link-section-title">Sources' + (_srcCount > 0 ? ' <span class="link-count">' + _srcCount + '</span>' : '') + '</span></div>';

    // ── Source entries ──
    if (!b.linkSources) b.linkSources = [];
    h += '<div class="link-col-source-scroll">';
    if (b.linkSources.length === 0) {
        h += '<div class="link-empty-msg">◆ Add a plugin param or macro below</div>';
    }
    for (var si = 0; si < b.linkSources.length; si++) {
        var src = b.linkSources[si];
        var isMacro = src.pluginId === -2;
        h += '<div class="link-src-row">';
        // Source label + value meter + remove
        h += '<div class="link-src-row-top">';
        if (isMacro) {
            h += '<span class="link-src-tag link-src-tag-macro">M</span>';
            h += '<span class="link-src-label">Macro ' + (si + 1) + '</span>';
        } else {
            h += '<span class="link-src-tag link-src-tag-plugin">\u25C6</span>';
            var srcLabel = '\u2014 Not set \u2014';
            var srcNavPid = '';
            if (src.pluginId >= 0 && src.paramIndex >= 0) {
                var srcPid = src.pluginId + ':' + src.paramIndex;
                var srcP = PMap[srcPid];
                srcLabel = srcP ? (getPluginName(src.pluginId) + ' \u203A ' + srcP.name) : (src.pluginName || 'Plugin') + ' \u203A ' + (src.paramName || 'Param');
                srcNavPid = srcPid;
            } else if (src.pluginId >= 0) {
                srcLabel = (src.pluginName || getPluginName(src.pluginId)) + ' \u203A \u2014';
            }
            h += '<span class="link-src-label' + (srcNavPid ? ' link-src-nav' : '') + '"' + (srcNavPid ? ' data-pid="' + srcNavPid + '"' : '') + ' title="' + srcLabel + '">' + srcLabel + '</span>';
        }
        h += '<button class="link-src-rm" data-b="' + b.id + '" data-si="' + si + '" title="Remove source">\u00d7</button>';
        h += '</div>';
        // Source value meter bar (shows real-time source value)
        h += '<div class="link-src-meter-wrap">';
        if (isMacro) {
            // Macro: draggable slider
            var macroVal = src.macroValue != null ? src.macroValue : 50;
            h += '<input type="range" class="link-macro-slider" min="0" max="100" value="' + macroVal + '" data-b="' + b.id + '" data-si="' + si + '">';
            h += '<span class="link-src-meter-val">' + Math.round(macroVal) + '%</span>';
        } else {
            // Plugin source: interactive slider that controls the actual parameter
            var srcVal = 0;
            var srcDispText = '0%';
            if (src.pluginId >= 0 && src.paramIndex >= 0) {
                var srcPid2 = src.pluginId + ':' + src.paramIndex;
                var srcP2 = PMap[srcPid2];
                srcVal = srcP2 ? Math.round((srcP2.v || 0) * 100) : 0;
                srcDispText = srcP2 && srcP2.disp ? srcP2.disp : srcVal + '%';
            }
            h += '<input type="range" class="link-src-slider" min="0" max="100" value="' + srcVal + '" data-b="' + b.id + '" data-si="' + si + '" data-pid="' + (src.pluginId >= 0 ? (src.pluginId + ':' + src.paramIndex) : '') + '" id="linkSrcSlider-' + b.id + '-' + si + '">';
            h += '<span class="link-src-meter-val" id="linkSrcVal-' + b.id + '-' + si + '">' + srcDispText + '</span>';
        }
        h += '</div>';
        h += '</div>'; // close link-src-row
    }

    // ── Add Source buttons ──
    h += '<div class="link-add-btns">';
    h += '<button class="link-add-src-btn link-add-src-plugin" data-b="' + b.id + '" title="Add a plugin parameter as source">\u25C6 Plugin</button>';
    h += '<button class="link-add-src-btn link-add-src-macro" data-b="' + b.id + '" title="Add a macro knob as source">M Macro</button>';
    h += '</div>';

    h += '</div>'; // close link-col-source-scroll

    // ── Smoothing — pinned at bottom of source column ──
    h += '<div class="link-smooth-row">';
    h += '<span class="link-smooth-lbl">Smooth</span>';
    h += '<input type="range" class="link-smooth-slider" min="0" max="500" value="' + (b.linkSmoothMs || 0) + '" data-b="' + b.id + '">';
    h += '<span class="link-smooth-val">' + Math.round(b.linkSmoothMs || 0) + 'ms</span>';
    h += '</div>'; // close link-smooth-row

    h += '</div>'; // close link-col-source

    // ═══ RIGHT COLUMN: TARGETS ═══
    h += '<div class="link-col-targets">';
    h += '<div class="link-targets-hdr">';
    var _tgtCount = b.targets ? b.targets.size : 0;
    h += '<span class="link-section-title">Targets' + (_tgtCount > 0 ? ' <span class="link-count">' + _tgtCount + '</span>' : '') + '</span>';
    if (_tgtCount >= 2) h += '<button class="sm-btn link-copy-all" data-b="' + b.id + '" title="Copy first target\u2019s range to all">Copy \u2192 All</button>';
    h += '<button class="sm-btn link-rnd-ranges" data-b="' + b.id + '" title="Randomize all ranges">\u2684 Rand</button>';
    h += '</div>';
    h += '<div class="link-targets-scroll" data-b="' + b.id + '">';
    var tArr = Array.from(b.targets);
    var rangeCount = 0;
    for (var ri = 0; ri < tArr.length; ri++) {
        var pid = tArr[ri], p = PMap[pid];
        if (!p) continue;
        var lo = b.linkMin && b.linkMin[pid] !== undefined ? b.linkMin[pid] : 0;
        var hi = b.linkMax && b.linkMax[pid] !== undefined ? b.linkMax[pid] : 100;
        rangeCount++;
        h += '<div class="link-tgt-row" data-pid="' + pid + '">';
        // Top: name + live value + remove
        h += '<div class="link-tgt-row-top">';
        h += '<span class="link-tgt-name-label" data-pid="' + pid + '" title="' + paramPluginName(pid) + ': ' + p.name + '">' + paramPluginName(pid) + ': ' + p.name + '</span>';
        var tgtDispText = p.disp || Math.round((p.v || 0) * 100) + '%';
        h += '<span class="link-tgt-live-val" id="linkTgtLive-' + b.id + '-' + pid.replace(':', '_') + '">' + tgtDispText + '</span>';
        h += '<button class="link-tgt-rm" data-b="' + b.id + '" data-pid="' + pid + '" title="Remove">\u00d7</button>';
        h += '</div>';
        // Sliders: Min and Max on one row
        h += '<div class="link-tgt-sliders">';
        h += '<div class="link-tgt-slider-group">';
        h += '<span class="link-tgt-slider-lbl">Min</span>';
        h += '<input type="range" class="link-tgt-slider link-tgt-min-slider" min="0" max="100" value="' + lo + '" data-b="' + b.id + '" data-pid="' + pid + '" data-which="min" data-hid="' + (p.hostId !== undefined ? p.hostId : '') + '" data-ri="' + (p.realIndex !== undefined ? p.realIndex : '') + '">';
        h += '<span class="link-tgt-slider-val" id="linkTgtVal-' + b.id + '-' + pid.replace(':', '_') + '-min" data-b="' + b.id + '" data-pid="' + pid + '" data-vwhich="min">' + Math.round(lo) + '%</span>';
        h += '</div>';
        h += '<div class="link-tgt-slider-group">';
        h += '<span class="link-tgt-slider-lbl">Max</span>';
        h += '<input type="range" class="link-tgt-slider link-tgt-max-slider" min="0" max="100" value="' + hi + '" data-b="' + b.id + '" data-pid="' + pid + '" data-which="max" data-hid="' + (p.hostId !== undefined ? p.hostId : '') + '" data-ri="' + (p.realIndex !== undefined ? p.realIndex : '') + '">';
        h += '<span class="link-tgt-slider-val" id="linkTgtVal-' + b.id + '-' + pid.replace(':', '_') + '-max" data-b="' + b.id + '" data-pid="' + pid + '" data-vwhich="max">' + Math.round(hi) + '%</span>';
        h += '</div>';
        h += '</div>';
        // Visual range indicator bar
        var _barLo = Math.min(lo, hi), _barHi = Math.max(lo, hi);
        h += '<div class="link-tgt-range-bar"><div class="link-tgt-range-fill" style="left:' + _barLo + '%;width:' + (_barHi - _barLo) + '%"></div></div>';
        // Invert button
        h += '<button class="link-tgt-invert" data-b="' + b.id + '" data-pid="' + pid + '" title="Invert range (swap Min/Max)">⇅</button>';
        h += '</div>'; // close link-tgt-row
    }
    if (rangeCount === 0) h += '<div class="link-empty-msg">← Click Assign, then select params in the rack</div>';
    h += '</div>'; // close link-targets-scroll
    h += '</div>'; // close link-col-targets

    h += '</div>'; // close link-columns

    // Deferred: resolve min/max value labels to real plugin text
    if (rangeCount > 0) {
        var _linkTgtPairs = [];
        for (var _ri = 0; _ri < tArr.length; _ri++) {
            var _pid = tArr[_ri], _p = PMap[_pid];
            if (!_p || _p.hostId === undefined) continue;
            var _lo = b.linkMin && b.linkMin[_pid] !== undefined ? b.linkMin[_pid] : 0;
            var _hi = b.linkMax && b.linkMax[_pid] !== undefined ? b.linkMax[_pid] : 100;
            _linkTgtPairs.push({ pid: _pid, hid: _p.hostId, ri: _p.realIndex, lo: _lo, hi: _hi, bId: b.id });
        }
        if (_linkTgtPairs.length > 0) {
            setTimeout(function () { _linkResolveDisplayText(_linkTgtPairs); }, 0);
        }
    }

    return h;
}

// Resolve link target min/max labels to real plugin display text
function _linkResolveDisplayText(pairs) {
    var fn = window.__juceGetNativeFunction ? window.__juceGetNativeFunction('getParamTextForValue') : null;
    if (!fn) return;
    for (var i = 0; i < pairs.length; i++) {
        (function (pair) {
            // Min label
            fn(pair.hid, pair.ri, pair.lo / 100).then(function (text) {
                if (text) {
                    var el = document.getElementById('linkTgtVal-' + pair.bId + '-' + pair.pid.replace(':', '_') + '-min');
                    if (el) el.textContent = text;
                }
            });
            // Max label
            fn(pair.hid, pair.ri, pair.hi / 100).then(function (text) {
                if (text) {
                    var el = document.getElementById('linkTgtVal-' + pair.bId + '-' + pair.pid.replace(':', '_') + '-max');
                    if (el) el.textContent = text;
                }
            });
        })(pairs[i]);
    }
}


// Lane Mode functions are defined in lane_module.js
// (renderLaneBody, laneCanvasSetup, laneDrawCanvas, laneSetupMouse, etc.)


function renderMorphBody(b) {
    var h = '';

    // â”€â”€ 1. XY PAD â€” pad + snap chips + add/library buttons â”€â”€
    h += '<div class="block-section"><span class="block-section-label">XY Pad</span>';
    h += '<div class="morph-pad' + (!b.snapshots || !b.snapshots.length ? ' empty' : '') + '" data-b="' + b.id + '">';
    // LFO shape path visualization
    if (b.morphMode === 'auto' && b.exploreMode === 'shapes') {
        h += buildLfoPathSvg(b);
    }
    if (!b.snapshots || !b.snapshots.length) {
        h += '<div class="empty-label">Add a snapshot to begin</div>';
    } else {
        for (var si = 0; si < b.snapshots.length; si++) {
            var s = b.snapshots[si];
            h += '<div class="snap-dot" data-b="' + b.id + '" data-si="' + si + '" style="left:' + (s.x * 100) + '%;top:' + ((1 - s.y) * 100) + '%"><span class="snap-label">' + (s.name || ('S' + (si + 1))) + '</span></div>';
        }
        var playManual = (b.morphMode === 'manual') ? ' manual' : '';
        h += '<div class="playhead-dot' + playManual + '" id="morphHead-' + b.id + '" style="left:' + (b.playheadX * 100) + '%;top:' + ((1 - b.playheadY) * 100) + '%"></div>';
    }
    h += '</div>';
    // Snapshot chips + add/library buttons
    h += '<div class="snap-chips">';
    if (b.snapshots) {
        for (var si = 0; si < b.snapshots.length; si++) {
            var chipLabel = (b.snapshots[si].name || ('S' + (si + 1)));
            if (b.snapshots[si].source) chipLabel += ' <span style="opacity:0.5;font-size:8px">(' + b.snapshots[si].source + ')</span>';
            h += '<span class="snap-chip" data-b="' + b.id + '" data-si="' + si + '">' + chipLabel + '<span class="snap-del" data-b="' + b.id + '" data-si="' + si + '">&times;</span></span>';
        }
    }
    var snapDisabled = (b.snapshots && b.snapshots.length >= 12) ? ' disabled' : '';
    h += '<button class="snap-add-btn" data-b="' + b.id + '"' + snapDisabled + '>+ Snap</button>';
    var libDisabled = (b.snapshots && b.snapshots.length >= 12) ? ' disabled' : '';
    h += '<button class="snap-lib-btn" data-b="' + b.id + '"' + libDisabled + '>\u{1F4C2} Library</button>';
    h += '</div></div>';

    // â”€â”€ 2. MOVEMENT â€” mode + explore/trigger + knobs + sync all in one inset box â”€â”€
    h += '<div class="block-section"><span class="block-section-label">Movement</span>';
    h += '<div class="constraints-box">';
    // Mode selector
    h += '<div class="seg" data-b="' + b.id + '" data-f="morphMode">';
    h += '<button class="' + (b.morphMode === 'manual' ? 'on' : '') + '" data-v="manual">Manual</button>';
    h += '<button class="' + (b.morphMode === 'auto' ? 'on' : '') + '" data-v="auto">Auto</button>';
    h += '<button class="' + (b.morphMode === 'trigger' ? 'on' : '') + '" data-v="trigger">Trigger</button>';
    h += '</div>';

    // Auto sub-panel
    if (b.morphMode === 'auto') {
        // Explore mode
        h += '<div class="seg" data-b="' + b.id + '" data-f="exploreMode">';
        h += '<button class="' + (b.exploreMode === 'wander' ? 'on' : '') + '" data-v="wander">Wander</button>';
        h += '<button class="' + (b.exploreMode === 'bounce' ? 'on' : '') + '" data-v="bounce">Bounce</button>';
        h += '<button class="' + (b.exploreMode === 'shapes' ? 'on' : '') + '" data-v="shapes">Shapes</button>';
        h += '<button class="' + (b.exploreMode === 'orbit' ? 'on' : '') + '" data-v="orbit">Orbit</button>';
        h += '<button class="' + (b.exploreMode === 'path' ? 'on' : '') + '" data-v="path">Path</button>';
        h += '</div>';
        // Shape selector (shapes explore only)
        var morphSynced = !!b.morphTempoSync;
        if (b.exploreMode === 'shapes') {
            h += '<select class="sub-sel" data-b="' + b.id + '" data-f="lfoShape">';
            h += buildShapeOptions('lfoShape', b);
            h += '</select>';
            // LFO knobs: Size, Spin, Speed
            h += buildKnobRow(
                buildBlockKnob(b.lfoDepth != null ? b.lfoDepth : 80, 0, 100, 36, 'morph', 'lfoDepth', b.id, 'Size', '%') +
                buildBlockKnob(b.lfoRotation || 0, -100, 100, 36, 'morph', 'lfoRotation', b.id, 'Spin', '\u00b1') +
                buildBlockKnob(b.morphSpeed, 0, 100, 36, 'morph', 'morphSpeed', b.id, 'Speed', '%', null, morphSynced)
            );
        }
        if (b.exploreMode !== 'shapes') {
            // Speed slider for non-shapes auto explore modes
            h += '<div class="sl-row' + (morphSynced ? ' sync-disabled' : '') + '"><span class="sl-lbl">Speed</span><input type="range" min="0" max="100" value="' + b.morphSpeed + '" data-b="' + b.id + '" data-f="morphSpeed"' + (morphSynced ? ' disabled' : '') + '><span class="sl-val">' + b.morphSpeed + '%</span></div>';
        }
        // Tempo Sync toggle + beat division
        h += '<div class="behaviour-row"><div class="tgl ' + (b.morphTempoSync ? 'on' : '') + '" data-b="' + b.id + '" data-f="morphTempoSync"></div><span class="tgl-lbl">Sync</span>';
        if (b.morphTempoSync) {
            h += renderBeatDivSelect(b.id, 'morphSyncDiv', b.morphSyncDiv, MORPH_DIVS);
            h += '<div class="seg-inline" data-b="' + b.id + '" data-f="clockSource"><button class="' + ((b.clockSource || 'daw') === 'daw' ? 'on' : '') + '" data-v="daw">DAW</button><button class="' + (b.clockSource === 'internal' ? 'on' : '') + '" data-v="internal">Int</button></div>';
        }
        h += '</div>';
    }

    // Trigger sub-panel
    if (b.morphMode === 'trigger') {
        h += '<div class="behaviour-row"><span class="blbl">Action</span><div class="seg-inline" data-b="' + b.id + '" data-f="morphAction">';
        h += '<button class="' + (b.morphAction === 'jump' ? 'on' : '') + '" data-v="jump">Jump</button>';
        h += '<button class="' + (b.morphAction === 'step' ? 'on' : '') + '" data-v="step">Step</button>';
        h += '</div>';
        if (b.morphAction === 'step') {
            h += '<div class="seg-inline" data-b="' + b.id + '" data-f="stepOrder">';
            h += '<button class="' + (b.stepOrder === 'cycle' ? 'on' : '') + '" data-v="cycle">Cycle</button>';
            h += '<button class="' + (b.stepOrder === 'random' ? 'on' : '') + '" data-v="random">Rand</button>';
            h += '</div>';
        }
        h += '</div>';
        h += '<div class="behaviour-row"><span class="blbl">Source</span><div class="seg-inline" data-b="' + b.id + '" data-f="morphSource">';
        h += '<button class="' + (b.morphSource === 'midi' ? 'on' : '') + '" data-v="midi">MIDI</button>';
        h += '<button class="' + (b.morphSource === 'tempo' ? 'on' : '') + '" data-v="tempo">Tempo</button>';
        h += '<button class="' + (b.morphSource === 'audio' ? 'on' : '') + '" data-v="audio">Audio</button>';
        h += '</div></div>';
        // Source sub-options
        if (b.morphSource === 'tempo') {
            h += '<div class="sub-row"><span class="sub-lbl">Div</span>' + renderBeatDivSelect(b.id, 'beatDiv', b.beatDiv) + '<div class="seg-inline" data-b="' + b.id + '" data-f="clockSource"><button class="' + ((b.clockSource || 'daw') === 'daw' ? 'on' : '') + '" data-v="daw">DAW</button><button class="' + (b.clockSource === 'internal' ? 'on' : '') + '" data-v="internal">Int</button></div></div>';
        } else if (b.morphSource === 'midi') {
            h += '<div class="sub-row"><span class="sub-lbl">Mode</span><select class="sub-sel" data-b="' + b.id + '" data-f="midiMode">';
            h += '<option value="any_note"' + (b.midiMode === 'any_note' ? ' selected' : '') + '>Any Note</option>';
            h += '<option value="specific_note"' + (b.midiMode === 'specific_note' ? ' selected' : '') + '>Note</option>';
            h += '<option value="cc"' + (b.midiMode === 'cc' ? ' selected' : '') + '>CC</option></select>';
            if (b.midiMode === 'specific_note') h += '<input class="sub-input" type="number" min="0" max="127" value="' + b.midiNote + '" data-b="' + b.id + '" data-f="midiNote">';
            if (b.midiMode === 'cc') h += '<input class="sub-input" type="number" min="0" max="127" value="' + b.midiCC + '" data-b="' + b.id + '" data-f="midiCC">';
            h += '<span class="sub-lbl">Ch</span><select class="sub-sel" data-b="' + b.id + '" data-f="midiCh"><option value="0"' + (b.midiCh == 0 ? ' selected' : '') + '>Any</option>';
            for (var c = 1; c <= 16; c++)h += '<option value="' + c + '"' + (parseInt(b.midiCh) === c ? ' selected' : '') + '>' + c + '</option>';
            h += '</select></div>';
        } else if (b.morphSource === 'audio') {
            h += '<div class="sub-row"><span class="sub-lbl">Src</span><select class="sub-sel" data-b="' + b.id + '" data-f="audioSrc">';
            h += '<option value="main"' + (b.audioSrc === 'main' ? ' selected' : '') + '>Main</option>';
            h += '<option value="sidechain"' + (b.audioSrc === 'sidechain' ? ' selected' : '') + '>SC</option></select>';
            h += '<span class="sub-lbl">Thr</span><input class="sub-input" type="number" min="-60" max="0" value="' + b.threshold + '" data-b="' + b.id + '" data-f="threshold"><span class="sub-lbl">dB</span></div>';
        }
    }
    h += '</div></div>';

    // â”€â”€ 3. MODIFIERS â€” two columns: movement (jitter+glide) | snapshots (radius) â”€â”€
    h += '<div class="block-section"><span class="block-section-label">Modifiers</span>';
    h += '<div class="constraints-box"><div class="mod-columns">';
    // Left: Movement modifiers
    h += '<div class="mod-col">';
    h += buildKnobRow(
        buildBlockKnob(b.jitter, 0, 100, 36, 'morph', 'jitter', b.id, 'Jitter', '%') +
        buildBlockKnob(b.morphGlide, 1, 2000, 36, 'morph', 'morphGlide', b.id, 'Glide', 'ms')
    );
    h += '</div>';
    // Divider
    h += '<div class="mod-divider"></div>';
    // Right: Snapshot radius
    h += '<div class="mod-col">';
    h += buildKnobRow(
        buildBlockKnob(b.snapRadius || 100, 5, 100, 36, 'morph', 'snapRadius', b.id, 'Radius', '%')
    );
    h += '</div>';
    h += '</div></div></div>';

    return h;
}

function wireBlocks() {
    var syncTimer = null;
    function debouncedSync() { if (syncTimer) cancelAnimationFrame(syncTimer); syncTimer = requestAnimationFrame(function () { syncTimer = null; syncBlocksToHost(); }); }
    document.querySelectorAll('.lbody').forEach(function (b) { b.onclick = function (e) { e.stopPropagation(); }; });
    document.querySelectorAll('.lhead').forEach(function (h) { h.onclick = function (e) { if (e.target.closest('.assign-btn') || e.target.closest('.lclose') || e.target.closest('[data-pwr]')) return; var id = parseInt(h.dataset.id); var b = findBlock(id); if (b) { b.expanded = !b.expanded; renderSingleBlock(id); } }; });
    // Right-click context menu on block header — Duplicate / Delete
    document.querySelectorAll('.lhead').forEach(function (h) {
        h.addEventListener('contextmenu', function (e) {
            e.preventDefault(); e.stopPropagation();
            var bId = parseInt(h.dataset.id);
            var b = findBlock(bId); if (!b) return;
            var old = document.querySelector('.block-ctx-menu');
            if (old) old.remove();
            var menu = document.createElement('div');
            menu.className = 'block-ctx-menu lane-add-menu';
            // Duplicate
            var dup = document.createElement('div');
            dup.className = 'lane-add-menu-item';
            dup.textContent = '\u2398 Duplicate Block';
            dup.onclick = function (ev) {
                ev.stopPropagation();
                menu.remove();
                pushUndoSnapshot();
                var newId = ++bc;
                // Deep clone: JSON round-trip, then restore Set for targets
                var clone = JSON.parse(JSON.stringify(b, function (key, val) {
                    if (val instanceof Set) return { __set: Array.from(val) };
                    return val;
                }));
                clone.id = newId;
                clone.colorIdx = newId - 1;
                clone.expanded = true;
                // Restore Sets
                if (clone.targets && clone.targets.__set) clone.targets = new Set(clone.targets.__set);
                else clone.targets = new Set();
                // Restore lane _sel Sets
                if (clone.lanes) {
                    clone.lanes.forEach(function (l) {
                        if (!l._sel) l._sel = new Set();
                        else if (l._sel.__set) l._sel = new Set(l._sel.__set);
                        else l._sel = new Set();
                    });
                }
                blocks.push(clone);
                actId = newId;
                renderBlocks(); renderAllPlugins(); updCounts(); syncBlocksToHost();
            };
            menu.appendChild(dup);
            // Separator
            var sep = document.createElement('div');
            sep.style.cssText = 'height:1px;background:var(--border);margin:3px 0;';
            menu.appendChild(sep);
            // Delete
            var del = document.createElement('div');
            del.className = 'lane-add-menu-item';
            del.textContent = '\u2716 Delete Block';
            del.style.color = '#e57373';
            del.onclick = function (ev) {
                ev.stopPropagation();
                menu.remove();
                pushUndoSnapshot();
                blocks = blocks.filter(function (bl) { return bl.id !== bId; });
                if (actId === bId) actId = blocks.length ? blocks[0].id : null;
                if (assignMode === bId) assignMode = null;
                renderBlocks(); renderAllPlugins(); updCounts(); syncBlocksToHost();
            };
            menu.appendChild(del);
            // Position with viewport clamp
            menu.style.cssText = 'position:fixed;z-index:9999;visibility:hidden;';
            document.body.appendChild(menu);
            var mw = menu.offsetWidth, mh = menu.offsetHeight;
            var vw = window.innerWidth, vh = window.innerHeight;
            var ml = e.clientX, mt = e.clientY;
            if (ml + mw > vw - 4) ml = vw - mw - 4;
            if (mt + mh > vh - 4) mt = Math.max(4, e.clientY - mh);
            menu.style.left = ml + 'px';
            menu.style.top = mt + 'px';
            menu.style.visibility = '';
            setTimeout(function () {
                var dismiss = function (de) {
                    if (menu.contains(de.target)) return;
                    menu.remove();
                    document.removeEventListener('mousedown', dismiss);
                };
                document.addEventListener('mousedown', dismiss);
            }, 50);
        });
    });
    document.querySelectorAll('.assign-btn').forEach(function (btn) { btn.onclick = function (e) { e.stopPropagation(); var id = parseInt(btn.dataset.id); if (assignMode === id) assignMode = null; else { assignMode = id; actId = id; var b = findBlock(id); if (b && !b.expanded) b.expanded = true; } renderBlocks(); renderAllPlugins(); }; });
    document.querySelectorAll('.lclose').forEach(function (btn) { btn.onclick = function (e) { e.stopPropagation(); var id = parseInt(btn.dataset.id); pushUndoSnapshot(); blocks = blocks.filter(function (b) { return b.id !== id; }); if (actId === id) actId = blocks.length ? blocks[0].id : null; if (assignMode === id) assignMode = null; renderBlocks(); renderAllPlugins(); updCounts(); syncBlocksToHost(); }; });
    document.querySelectorAll('[data-pwr]').forEach(function (btn) { btn.onclick = function (e) { e.stopPropagation(); var bId = parseInt(btn.dataset.pwr); var b = findBlock(bId); if (b) { b.enabled = !b.enabled; renderSingleBlock(bId); renderAllPlugins(); syncBlocksToHost(); } }; });
    document.querySelectorAll('.seg,.seg-inline').forEach(function (seg) { seg.querySelectorAll('button').forEach(function (btn) { btn.onclick = function (e) { e.stopPropagation(); var bId = parseInt(seg.dataset.b); var b = findBlock(bId); if (b) { var oldMode = b[seg.dataset.f]; b[seg.dataset.f] = btn.dataset.v; if (seg.dataset.f === 'mode' && oldMode !== btn.dataset.v) { /* Leaving shapes/shapes_range: restore params to stored bases */ if ((oldMode === 'shapes' || oldMode === 'shapes_range') && b.targets.size > 0) { var basesMap = oldMode === 'shapes_range' ? b.targetRangeBases : b.targetBases; var setFn = (window.__JUCE__ && window.__JUCE__.backend) ? window.__juceGetNativeFunction('setParam') : null; b.targets.forEach(function (pid) { var p = PMap[pid]; if (!p) return; var base = basesMap && basesMap[pid] !== undefined ? basesMap[pid] : p.v; p.v = base; if (setFn && p.hostId !== undefined) setFn(p.hostId, p.realIndex, base); }); } /* Leaving link: restore params to stored link bases */ if (oldMode === 'link' && b.targets.size > 0) { var setFn2 = (window.__JUCE__ && window.__JUCE__.backend) ? window.__juceGetNativeFunction('setParam') : null; b.targets.forEach(function (pid) { var p = PMap[pid]; if (!p) return; var base = b.linkBases && b.linkBases[pid] !== undefined ? b.linkBases[pid] : p.v; p.v = base; if (setFn2 && p.hostId !== undefined) setFn2(p.hostId, p.realIndex, base); }); } /* Entering shapes: capture current param values as bases for existing targets */ if (btn.dataset.v === 'shapes' && b.targets.size > 0) { if (!b.targetBases) b.targetBases = {}; b.targets.forEach(function (pid) { var p = PMap[pid]; if (p && b.targetBases[pid] === undefined) b.targetBases[pid] = p.v; }); } /* Entering link: capture current param values as link bases */ if (btn.dataset.v === 'link' && b.targets.size > 0) { if (!b.linkBases) b.linkBases = {}; b.targets.forEach(function (pid) { var p = PMap[pid]; if (p && b.linkBases[pid] === undefined) b.linkBases[pid] = p.v; }); } } renderSingleBlock(bId); if (seg.dataset.f === 'mode') renderAllPlugins(); syncBlocksToHost(); } }; }); });
    document.querySelectorAll('.tgl').forEach(function (t) { t.onclick = function (e) { e.stopPropagation(); var bId = parseInt(t.dataset.b); var b = findBlock(bId); if (b) { b[t.dataset.f] = !b[t.dataset.f]; renderSingleBlock(bId); syncBlocksToHost(); } }; });
    document.querySelectorAll('.sub-sel').forEach(function (s) { s.onchange = function () { var bId = parseInt(s.dataset.b); var b = findBlock(bId); if (b) { var val = s.value; if (s.dataset.f === 'midiCh') val = parseInt(val) || 0; else if (s.dataset.f === 'envFilterBW') val = parseFloat(val) || 2; b[s.dataset.f] = val; renderSingleBlock(bId); syncBlocksToHost(); } }; });
    // ── Link: add plugin source button — opens lane-style searchable dropdown ──
    document.querySelectorAll('.link-add-src-plugin').forEach(function (btn) {
        btn.onclick = function (e) {
            e.stopPropagation();
            var bId = parseInt(btn.dataset.b); var b = findBlock(bId); if (!b) return;
            // Close any existing link add-source menu
            var existing = document.querySelector('.link-src-menu');
            if (existing) { existing.remove(); return; }

            // Build popup menu — lane-style with search and plugin/param sections
            var menu = document.createElement('div');
            menu.className = 'lane-add-menu link-src-menu';
            menu.style.position = 'fixed';
            menu.style.zIndex = '999';

            // Search input
            var searchInput = document.createElement('input');
            searchInput.type = 'text';
            searchInput.className = 'lane-add-menu-search';
            searchInput.placeholder = 'Search params\u2026';
            searchInput.onclick = function (ev) { ev.stopPropagation(); };
            menu.appendChild(searchInput);

            var allItems = [];
            // Group by plugin
            pluginBlocks.forEach(function (pb) {
                if (!pb.hostId && pb.hostId !== 0) return;
                var hdr = document.createElement('div');
                hdr.className = 'lane-add-menu-hdr';
                hdr.textContent = pb.name;
                menu.appendChild(hdr);
                pb.params.forEach(function (p) {
                    var item = document.createElement('div');
                    item.className = 'lane-add-menu-item';
                    item.textContent = p.name;
                    item.dataset.search = (pb.name + ' ' + p.name).toLowerCase();
                    item.onclick = function (ev) {
                        ev.stopPropagation();
                        pushUndoSnapshot();
                        if (!b.linkSources) b.linkSources = [];
                        b.linkSources.push({
                            pluginId: pb.hostId, paramIndex: p.realIndex,
                            pluginName: pb.name, paramName: p.name
                        });
                        menu.remove();
                        renderSingleBlock(bId); renderAllPlugins(); syncBlocksToHost();
                    };
                    menu.appendChild(item);
                    allItems.push(item);
                });
            });
            if (allItems.length === 0) {
                var empty = document.createElement('div');
                empty.className = 'lane-add-menu-item';
                empty.textContent = 'No plugins loaded';
                empty.style.opacity = '0.5';
                menu.appendChild(empty);
            }

            // Wire search filtering
            searchInput.oninput = function () {
                var q = searchInput.value.toLowerCase();
                allItems.forEach(function (el) {
                    el.style.display = (el.dataset.search || '').indexOf(q) >= 0 ? '' : 'none';
                });
                // Hide section headers with no visible items
                menu.querySelectorAll('.lane-add-menu-hdr').forEach(function (hdr) {
                    var next = hdr.nextElementSibling;
                    var hasVisible = false;
                    while (next && !next.classList.contains('lane-add-menu-hdr')) {
                        if (next.style.display !== 'none') hasVisible = true;
                        next = next.nextElementSibling;
                    }
                    hdr.style.display = hasVisible ? '' : 'none';
                });
            };

            // Position and append
            menu.style.visibility = 'hidden';
            document.body.appendChild(menu);
            var realH = menu.offsetHeight, realW = menu.offsetWidth || 200;
            var rect = btn.getBoundingClientRect();
            var vw = window.innerWidth, vh = window.innerHeight;
            var fLeft = rect.left, fTop = rect.bottom + 2;
            if (fLeft + realW > vw - 4) fLeft = vw - realW - 4;
            if (fLeft < 4) fLeft = 4;
            if (fTop + realH > vh - 4) fTop = Math.max(4, rect.top - realH - 2);
            menu.style.left = fLeft + 'px'; menu.style.top = fTop + 'px';
            menu.style.visibility = '';
            searchInput.focus();
            // Close on outside click
            setTimeout(function () {
                var closer = function (ev) {
                    var m = document.querySelector('.link-src-menu');
                    if (!m || !m.contains(ev.target)) {
                        if (m) m.remove();
                        document.removeEventListener('mousedown', closer);
                    }
                };
                document.addEventListener('mousedown', closer);
            }, 10);
        };
    });
    // ── Link: add macro source ──
    document.querySelectorAll('.link-add-src-macro').forEach(function (btn) {
        btn.onclick = function (e) {
            e.stopPropagation();
            var bId = parseInt(btn.dataset.b); var b = findBlock(bId); if (!b) return;
            pushUndoSnapshot();
            if (!b.linkSources) b.linkSources = [];
            b.linkSources.push({ pluginId: -2, paramIndex: -1, macroValue: 50, pluginName: '', paramName: '' });
            renderSingleBlock(bId); renderAllPlugins(); syncBlocksToHost();
        };
    });
    // ── Link: macro slider ──
    document.querySelectorAll('.link-macro-slider').forEach(function (sl) {
        sl.oninput = function () {
            var bId = parseInt(sl.dataset.b); var b = findBlock(bId); if (!b) return;
            var si = parseInt(sl.dataset.si);
            if (!b.linkSources || !b.linkSources[si]) return;
            b.linkSources[si].macroValue = parseFloat(sl.value);
            var valSpan = sl.nextElementSibling;
            if (valSpan) valSpan.textContent = Math.round(sl.value) + '%';
            syncBlocksToHost(); // sync on every drag tick so macro controls targets in real-time
        };
        sl.onchange = function () { syncBlocksToHost(); };
        // Double-click to reset macro to 50%
        sl.ondblclick = function (e) {
            e.stopPropagation();
            var bId = parseInt(sl.dataset.b); var b = findBlock(bId); if (!b) return;
            var si = parseInt(sl.dataset.si);
            if (!b.linkSources || !b.linkSources[si]) return;
            sl.value = 50;
            b.linkSources[si].macroValue = 50;
            var valSpan = sl.nextElementSibling;
            if (valSpan) valSpan.textContent = '50%';
            syncBlocksToHost();
        };
    });
    // ── Link: plugin source slider (controls the actual param) ──
    document.querySelectorAll('.link-src-slider').forEach(function (sl) {
        sl.onmousedown = function () { sl._dragging = true; };
        sl.oninput = function () {
            var pid = sl.dataset.pid;
            var p = PMap[pid]; if (!p) return;
            var norm = parseFloat(sl.value) / 100;
            p.v = norm;
            // Send to host
            if (window.__JUCE__ && window.__JUCE__.backend) {
                var setFn = window.__juceGetNativeFunction('setParam');
                if (setFn && p.hostId !== undefined) setFn(p.hostId, p.realIndex, norm);
            }
            // Update value label — try real display text first
            var valSpan = sl.nextElementSibling;
            if (valSpan && p.hostId !== undefined && p.realIndex !== undefined) {
                var fn = window.__juceGetNativeFunction ? window.__juceGetNativeFunction('getParamTextForValue') : null;
                if (fn) {
                    fn(p.hostId, p.realIndex, norm).then(function (text) {
                        if (text && valSpan) valSpan.textContent = text;
                    });
                } else {
                    valSpan.textContent = p.disp || (Math.round(norm * 100) + '%');
                }
            } else if (valSpan) {
                valSpan.textContent = p.disp || (Math.round(norm * 100) + '%');
            }
        };
        sl.onchange = function () {
            sl._dragging = false;
            syncBlocksToHost();
        };
        sl.onmouseup = function () { sl._dragging = false; };
    });
    // ── Link: smoothing slider ──
    document.querySelectorAll('.link-smooth-slider').forEach(function (sl) {
        sl.oninput = function () {
            var bId = parseInt(sl.dataset.b); var b = findBlock(bId); if (!b) return;
            b.linkSmoothMs = parseFloat(sl.value);
            var valSpan = sl.nextElementSibling;
            if (valSpan) valSpan.textContent = Math.round(sl.value) + 'ms';
            syncBlocksToHost();
        };
        sl.onchange = function () { syncBlocksToHost(); };
        // Double-click to reset smooth to 0ms
        sl.ondblclick = function (e) {
            e.stopPropagation();
            var bId = parseInt(sl.dataset.b); var b = findBlock(bId); if (!b) return;
            sl.value = 0;
            b.linkSmoothMs = 0;
            var valSpan = sl.nextElementSibling;
            if (valSpan) valSpan.textContent = '0ms';
            syncBlocksToHost();
        };
    });
    // ── Link: remove source button ──
    document.querySelectorAll('.link-src-rm').forEach(function (btn) {
        btn.onclick = function (e) {
            e.stopPropagation();
            var bId = parseInt(btn.dataset.b); var b = findBlock(bId); if (!b) return;
            var si = parseInt(btn.dataset.si);
            pushUndoSnapshot();
            if (b.linkSources) b.linkSources.splice(si, 1);
            renderSingleBlock(bId); renderAllPlugins(); syncBlocksToHost();
        };
    });
    // ── Link: random ranges button ──
    document.querySelectorAll('.link-rnd-ranges').forEach(function (btn) {
        btn.onclick = function (e) {
            e.stopPropagation();
            var bId = parseInt(btn.dataset.b); var b = findBlock(bId); if (!b) return;
            pushUndoSnapshot();
            if (!b.linkMin) b.linkMin = {};
            if (!b.linkMax) b.linkMax = {};
            b.targets.forEach(function (pid) {
                var lo = Math.round(Math.random() * 100);
                var hi = Math.round(Math.random() * 100);
                if (lo > hi) { var t = lo; lo = hi; hi = t; }
                b.linkMin[pid] = lo;
                b.linkMax[pid] = hi;
            });
            renderSingleBlock(bId); renderAllPlugins(); syncBlocksToHost();
        };
    });
    // ── Link: invert range (swap min/max) ──
    document.querySelectorAll('.link-tgt-invert').forEach(function (btn) {
        btn.onclick = function (e) {
            e.stopPropagation();
            var bId = parseInt(btn.dataset.b); var b = findBlock(bId); if (!b) return;
            var pid = btn.dataset.pid;
            pushUndoSnapshot();
            if (!b.linkMin) b.linkMin = {};
            if (!b.linkMax) b.linkMax = {};
            var oldMin = b.linkMin[pid] !== undefined ? b.linkMin[pid] : 0;
            var oldMax = b.linkMax[pid] !== undefined ? b.linkMax[pid] : 100;
            b.linkMin[pid] = oldMax;
            b.linkMax[pid] = oldMin;
            renderSingleBlock(bId); renderAllPlugins(); syncBlocksToHost();
        };
    });
    // ── Link: copy first target's range to all ──
    document.querySelectorAll('.link-copy-all').forEach(function (btn) {
        btn.onclick = function (e) {
            e.stopPropagation();
            var bId = parseInt(btn.dataset.b); var b = findBlock(bId); if (!b) return;
            var tArr = Array.from(b.targets);
            if (tArr.length < 2) return;
            var firstPid = tArr[0];
            var firstLo = b.linkMin && b.linkMin[firstPid] !== undefined ? b.linkMin[firstPid] : 0;
            var firstHi = b.linkMax && b.linkMax[firstPid] !== undefined ? b.linkMax[firstPid] : 100;
            pushUndoSnapshot();
            if (!b.linkMin) b.linkMin = {};
            if (!b.linkMax) b.linkMax = {};
            for (var ci = 1; ci < tArr.length; ci++) {
                b.linkMin[tArr[ci]] = firstLo;
                b.linkMax[tArr[ci]] = firstHi;
            }
            renderSingleBlock(bId); renderAllPlugins(); syncBlocksToHost();
            if (typeof showToast === 'function') showToast('Range copied to ' + (tArr.length - 1) + ' targets', 'info', 1500);
        };
    });
    // ── Link: target min/max sliders ──
    document.querySelectorAll('.link-tgt-slider').forEach(function (sl) {
        var _tgtSliderSnap = null;
        var _tgtSliderStart = null;
        sl.addEventListener('mousedown', function () {
            _tgtSliderSnap = typeof captureFullSnapshot === 'function' ? captureFullSnapshot() : null;
            _tgtSliderStart = parseFloat(sl.value);
        });
        sl.oninput = function () {
            var bId = parseInt(sl.dataset.b); var b = findBlock(bId); if (!b) return;
            var pid = sl.dataset.pid, which = sl.dataset.which;
            if (which === 'min') {
                if (!b.linkMin) b.linkMin = {};
                b.linkMin[pid] = parseFloat(sl.value);
            } else {
                if (!b.linkMax) b.linkMax = {};
                b.linkMax[pid] = parseFloat(sl.value);
            }
            // Update the adjacent value label — try to use real plugin text
            var valSpan = sl.parentNode.querySelector('[data-vwhich="' + which + '"]');
            var normVal = parseFloat(sl.value) / 100;
            var hid = parseInt(sl.dataset.hid);
            var ri = parseInt(sl.dataset.ri);
            if (valSpan && !isNaN(hid) && !isNaN(ri)) {
                var fn = window.__juceGetNativeFunction ? window.__juceGetNativeFunction('getParamTextForValue') : null;
                if (fn) {
                    fn(hid, ri, normVal).then(function (text) {
                        if (text && valSpan) valSpan.textContent = text;
                    });
                } else {
                    valSpan.textContent = Math.round(sl.value) + '%';
                }
            } else if (valSpan) {
                valSpan.textContent = Math.round(sl.value) + '%';
            }
            syncBlocksToHost();
        };
        sl.onchange = function () {
            if (_tgtSliderSnap && _tgtSliderStart !== null && parseFloat(sl.value) !== _tgtSliderStart) {
                undoStack.push({ type: 'full', snapshot: _tgtSliderSnap });
                if (undoStack.length > maxUndo) undoStack.shift();
                redoStack = [];
                if (typeof updateUndoBadge === 'function') updateUndoBadge();
            }
            _tgtSliderSnap = null; _tgtSliderStart = null;
            renderAllPlugins(); syncBlocksToHost();
        };
        // Double-click to reset: min → 0, max → 100
        sl.ondblclick = function (e) {
            e.stopPropagation();
            var bId = parseInt(sl.dataset.b); var b = findBlock(bId); if (!b) return;
            var pid = sl.dataset.pid, which = sl.dataset.which;
            var defaultVal = which === 'min' ? 0 : 100;
            sl.value = defaultVal;
            if (which === 'min') {
                if (!b.linkMin) b.linkMin = {};
                b.linkMin[pid] = defaultVal;
            } else {
                if (!b.linkMax) b.linkMax = {};
                b.linkMax[pid] = defaultVal;
            }
            // Trigger the label update
            sl.dispatchEvent(new Event('input'));
            renderSingleBlock(bId); renderAllPlugins(); syncBlocksToHost();
        };
    });
    // ── Link: remove target button ──
    document.querySelectorAll('.link-tgt-rm').forEach(function (btn) {
        btn.onclick = function (e) {
            e.stopPropagation();
            var bId = parseInt(btn.dataset.b); var b = findBlock(bId); if (!b) return;
            var pid = btn.dataset.pid;
            pushUndoSnapshot();
            b.targets.delete(pid);
            if (b.linkMin) delete b.linkMin[pid];
            if (b.linkMax) delete b.linkMax[pid];
            if (b.linkBases) delete b.linkBases[pid];
            if (b.linkModOutputs) delete b.linkModOutputs[pid];
            renderSingleBlock(bId); renderAllPlugins(); syncBlocksToHost();
        };
    });
    // ── Link: click target name → navigate to param in rack ──
    document.querySelectorAll('.link-tgt-name-label').forEach(function (lbl) {
        lbl.onclick = function (e) {
            e.stopPropagation();
            var pid = lbl.dataset.pid;
            var pp = PMap[pid]; if (!pp) return;
            // Expand the plugin card if collapsed
            for (var pbi = 0; pbi < pluginBlocks.length; pbi++) {
                var pb = pluginBlocks[pbi];
                if (pb.id === pp.hostId && !pb.expanded) {
                    pb.expanded = true;
                    dirtyPluginParams(pp.hostId);
                    renderAllPlugins();
                    break;
                }
            }
            // Retry until virtual scroll reveals the param row
            var attempts = 0;
            (function tryLocate() {
                attempts++;
                if (typeof scrollVirtualToParam === 'function') scrollVirtualToParam(pid);
                var paramRow = document.querySelector('.pr[data-pid="' + pid + '"]');
                if (paramRow) {
                    paramRow.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                    paramRow.classList.remove('touched'); void paramRow.offsetWidth;
                    paramRow.classList.add('touched');
                } else if (attempts < 15) {
                    requestAnimationFrame(tryLocate);
                }
            })();
        };
    });
    // ── Link: click source name → navigate to param in rack ──
    document.querySelectorAll('.link-src-nav').forEach(function (lbl) {
        lbl.onclick = function (e) {
            e.stopPropagation();
            var pid = lbl.dataset.pid;
            var pp = PMap[pid]; if (!pp) return;
            // Expand the plugin card if collapsed
            for (var pbi = 0; pbi < pluginBlocks.length; pbi++) {
                var pb = pluginBlocks[pbi];
                if (pb.id === pp.hostId && !pb.expanded) {
                    pb.expanded = true;
                    dirtyPluginParams(pp.hostId);
                    renderAllPlugins();
                    break;
                }
            }
            // Retry until virtual scroll reveals the param row
            var attempts = 0;
            (function tryLocate() {
                attempts++;
                if (typeof scrollVirtualToParam === 'function') scrollVirtualToParam(pid);
                var paramRow = document.querySelector('.pr[data-pid="' + pid + '"]');
                if (paramRow) {
                    paramRow.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                    paramRow.classList.remove('touched'); void paramRow.offsetWidth;
                    paramRow.classList.add('touched');
                } else if (attempts < 15) {
                    requestAnimationFrame(tryLocate);
                }
            })();
        };
    });
    // Default values for double-click reset
    var knobDefaults = { rMin: 0, rMax: 100, threshold: -12, glideMs: 200, envAtk: 10, envRel: 100, envSens: 50, envFilterFreq: 50, envFilterBW: 5, morphSpeed: 50, morphGlide: 200, jitter: 0, snapRadius: 100, lfoDepth: 80, lfoRotation: 0, sampleSpeedPct: 100, qSteps: 12, shapeSize: 80, shapeSpin: 0, shapeSpeed: 50, shapePhaseOffset: 0, linkSmoothMs: 0 };
    document.querySelectorAll('.lbody input[type="range"]').forEach(function (sl) {
        if (!sl.dataset.b) return;
        // Skip link slider types — they have their own handlers
        if (sl.classList.contains('link-tgt-slider')) return;
        if (sl.classList.contains('link-macro-slider')) return;
        if (sl.classList.contains('link-smooth-slider')) return;
        if (sl.classList.contains('link-src-slider')) return;
        // Capture state before slider drag for undo
        var _sliderUndoSnap = null;
        var _sliderStartVal = null;
        sl.addEventListener('mousedown', function () {
            var b = findBlock(parseInt(sl.dataset.b));
            if (!b) return;
            _sliderUndoSnap = captureFullSnapshot();
            var f = sl.dataset.f;
            _sliderStartVal = (f === 'sampleSpeedPct') ? (b.sampleSpeed * 100) : (b[f] != null ? b[f] : parseFloat(sl.value));
        });
        sl.addEventListener('change', function () {
            var b = findBlock(parseInt(sl.dataset.b));
            if (!b || !_sliderUndoSnap) return;
            var f = sl.dataset.f;
            var curVal = (f === 'sampleSpeedPct') ? (b.sampleSpeed * 100) : b[f];
            if (_sliderStartVal !== null && curVal !== _sliderStartVal) {
                undoStack.push({ type: 'full', snapshot: _sliderUndoSnap });
                if (undoStack.length > maxUndo) undoStack.shift();
                redoStack = [];
                updateUndoBadge();
            }
            _sliderUndoSnap = null; _sliderStartVal = null;
        });
        // Continuous update while dragging
        sl.oninput = function () { var b = findBlock(parseInt(sl.dataset.b)); if (!b) return; var f = sl.dataset.f; if (f === 'sampleSpeedPct') { b.sampleSpeed = parseFloat(sl.value) / 100; } else { b[f] = parseFloat(sl.value); } var row = sl.closest('.sl-row,.sub-row'); if (row) { var v = row.querySelector('.sl-val'); if (v) { if (f === 'threshold') v.textContent = sl.value + ' dB'; else if (f === 'glideMs' || f === 'envAtk' || f === 'envRel' || f === 'morphGlide') v.textContent = sl.value + 'ms'; else if (f === 'sampleSpeedPct') v.textContent = b.sampleSpeed.toFixed(1) + 'x'; else if (f === 'morphSpeed') v.textContent = morphSpeedDisplay(parseFloat(sl.value)); else if (f === 'lfoRotation') { var rv = parseInt(sl.value); v.textContent = (rv > 0 ? '+' : '') + rv + '%'; } else v.textContent = sl.value + '%'; } } if (f === 'lfoDepth' || f === 'lfoRotation') { var pad = document.querySelector('.morph-pad[data-b="' + sl.dataset.b + '"]:not(.shapes-pad)'); if (pad) { var old = pad.querySelector('.lfo-path-svg'); if (old) old.remove(); pad.insertAdjacentHTML('afterbegin', buildLfoPathSvg(b)); } } if (f === 'shapeSize') { var pad = document.querySelector('.shapes-pad[data-b="' + sl.dataset.b + '"]'); if (pad) { var old = pad.querySelector('.lfo-path-svg'); if (old) old.remove(); pad.insertAdjacentHTML('afterbegin', buildShapePathSvg(b, b.mode === 'shapes_range' ? 100 : undefined)); } } debouncedSync(); };
        // Double-click to reset to default
        sl.ondblclick = function (e) { e.preventDefault(); var b = findBlock(parseInt(sl.dataset.b)); if (!b) return; var f = sl.dataset.f; var def = knobDefaults[f]; if (def !== undefined) { var snap = captureFullSnapshot(); sl.value = def; sl.dispatchEvent(new Event('input')); undoStack.push({ type: 'full', snapshot: snap }); if (undoStack.length > maxUndo) undoStack.shift(); redoStack = []; updateUndoBadge(); } };
    });
    // Block knob drag interaction
    // knobDefaults already declared above â€” reused for knob double-click reset
    document.querySelectorAll('.bk').forEach(function (bk) {
        if (!bk.dataset.b) return;
        var bId = parseInt(bk.dataset.b), f = bk.dataset.f;
        var mn = parseFloat(bk.dataset.min), mx = parseFloat(bk.dataset.max);
        bk.addEventListener('mousedown', function (e) {
            e.preventDefault(); e.stopPropagation();
            if (bk.dataset.disabled) return;
            var b = findBlock(bId); if (!b) return;
            var _knobUndoSnap = captureFullSnapshot();
            var startY = e.clientY;
            // Read current value — handle compound fields for link block
            var curVal;
            if (f === 'sampleSpeedPct') {
                curVal = b.sampleSpeed * 100;
            } else if (f.indexOf('linkMin__') === 0) {
                var _pid = f.substring(9);
                curVal = (b.linkMin && b.linkMin[_pid] != null) ? b.linkMin[_pid] : 0;
            } else if (f.indexOf('linkMax__') === 0) {
                var _pid = f.substring(9);
                curVal = (b.linkMax && b.linkMax[_pid] != null) ? b.linkMax[_pid] : 100;
            } else if (f.indexOf('linkMacro__') === 0) {
                var _si = parseInt(f.substring(11));
                curVal = (b.linkSources && b.linkSources[_si] && b.linkSources[_si].macroValue != null) ? b.linkSources[_si].macroValue : 50;
            } else if (f.indexOf('linkSrcDisp__') === 0) {
                return; // read-only display knob — no drag
            } else {
                curVal = (b[f] != null ? b[f] : mn);
            }
            var _knobStartVal = curVal;
            var range = mx - mn;
            var sensitivity = 150;
            function onMove(me) {
                var dy = startY - me.clientY;
                var nv = Math.max(mn, Math.min(mx, curVal + (dy / sensitivity) * range));
                nv = Math.round(nv);
                // Write value — handle compound fields for link block
                if (f === 'sampleSpeedPct') b.sampleSpeed = nv / 100;
                else if (f.indexOf('linkMin__') === 0) { var _pid = f.substring(9); if (!b.linkMin) b.linkMin = {}; b.linkMin[_pid] = nv; }
                else if (f.indexOf('linkMax__') === 0) { var _pid = f.substring(9); if (!b.linkMax) b.linkMax = {}; b.linkMax[_pid] = nv; }
                else if (f.indexOf('linkMacro__') === 0) { var _si = parseInt(f.substring(11)); if (b.linkSources && b.linkSources[_si]) b.linkSources[_si].macroValue = nv; }
                else b[f] = nv;
                // Get mode from closest card
                var card = bk.closest('.lcard');
                var mode = 'rand';
                if (card) {
                    if (card.classList.contains('mode-env')) mode = 'env';
                    else if (card.classList.contains('mode-smp')) mode = 'smp';
                    else if (card.classList.contains('mode-morph')) mode = 'morph';
                    else if (card.classList.contains('mode-shapes')) mode = 'shapes';
                    else if (card.classList.contains('mode-link')) mode = 'link';
                }
                // Rebuild SVG
                var norm = (nv - mn) / range;
                var size = 36, r = size / 2, cx = r, cy = r, ir = r - 3;
                var sa = 135 * Math.PI / 180, ea = 405 * Math.PI / 180, sp = ea - sa;
                var va = sa + norm * sp;
                var tPath = describeArc(cx, cy, ir, sa, ea);
                var vPath = norm > 0.005 ? describeArc(cx, cy, ir, sa, va) : '';
                var dx = cx + ir * Math.cos(va), dy2 = cy + ir * Math.sin(va);
                var tVar = 'var(--lk-' + mode + '-track, var(--knob-track))';
                var vVar = 'var(--lk-' + mode + '-value, var(--knob-value))';
                var dVar = 'var(--lk-' + mode + '-dot, var(--knob-dot))';
                var svg = '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">';
                svg += '<path d="' + tPath + '" fill="none" stroke="' + tVar + '" stroke-width="2.5" stroke-linecap="round"/>';
                if (vPath) svg += '<path d="' + vPath + '" fill="none" stroke="' + vVar + '" stroke-width="2.5" stroke-linecap="round"/>';
                svg += '<circle cx="' + dx.toFixed(1) + '" cy="' + dy2.toFixed(1) + '" r="2.5" fill="' + dVar + '"/>';
                svg += '</svg>';
                var svgEl = bk.querySelector('.bk-svg'); if (svgEl) svgEl.innerHTML = svg;
                // Update value display
                var valEl = bk.querySelector('.bk-val');
                if (valEl) {
                    var unit = '';
                    if (f === 'envAtk' || f === 'envRel' || f === 'glideMs' || f === 'morphGlide' || f === 'linkSmoothMs') valEl.textContent = nv + 'ms';
                    else if (f === 'threshold') valEl.textContent = nv + 'dB';
                    else if (f === 'shapeSpin' || f === 'lfoRotation') valEl.textContent = (nv > 0 ? '+' : '') + nv + '%';
                    else if (f === 'shapePhaseOffset') valEl.textContent = nv + 'Â°';
                    else if (f === 'envFilterFreq') valEl.textContent = envFmtHz(nv);
                    else if (f === 'envFilterBW') valEl.textContent = envFmtBw(nv);
                    else if (f === 'morphSpeed') valEl.textContent = morphSpeedDisplay(nv);
                    else if (f === 'sampleSpeedPct') valEl.textContent = b.sampleSpeed.toFixed(1) + 'x';
                    else valEl.textContent = nv + '%';
                }
                // Live update pad visualizations
                if (f === 'lfoDepth' || f === 'lfoRotation') {
                    var pad = document.querySelector('.morph-pad[data-b="' + bId + '"]:not(.shapes-pad)');
                    if (pad) { var o = pad.querySelector('.lfo-path-svg'); if (o) o.remove(); pad.insertAdjacentHTML('afterbegin', buildLfoPathSvg(b)); }
                }
                if (f === 'shapeSize') {
                    var pad = document.querySelector('.shapes-pad[data-b="' + bId + '"]');
                    if (pad) { var o = pad.querySelector('.lfo-path-svg'); if (o) o.remove(); pad.insertAdjacentHTML('afterbegin', buildShapePathSvg(b, b.mode === 'shapes_range' ? 100 : undefined)); }
                }
                // Live update filter visualization
                if (f === 'envFilterFreq' || f === 'envFilterBW') {
                    var vizWrap = document.getElementById('envViz-' + bId);
                    if (vizWrap) vizWrap.innerHTML = buildEnvFilterSvg(b);
                }
                if (f === 'snapRadius') {
                    var pad = document.querySelector('.morph-pad[data-b="' + bId + '"]:not(.shapes-pad)');
                    if (pad) {
                        pad.querySelectorAll('.radius-ring').forEach(function (r) { r.remove(); });
                        var ringDiameter = (b.snapRadius || 100) * 2;
                        if (b.snapshots) b.snapshots.forEach(function (s) {
                            var ring = document.createElement('div');
                            ring.className = 'radius-ring';
                            ring.style.cssText = 'width:' + ringDiameter + '%;height:' + ringDiameter + '%;left:' + (s.x * 100) + '%;top:' + ((1 - s.y) * 100) + '%;';
                            pad.appendChild(ring);
                        });
                    }
                }
                debouncedSync();
            }
            function onUp() {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                // Push undo if value changed
                var endVal = (f === 'sampleSpeedPct') ? (b.sampleSpeed * 100) : b[f];
                if (endVal !== _knobStartVal && _knobUndoSnap) {
                    undoStack.push({ type: 'full', snapshot: _knobUndoSnap });
                    if (undoStack.length > maxUndo) undoStack.shift();
                    redoStack = [];
                    updateUndoBadge();
                }
                // Fade out radius rings
                if (f === 'snapRadius') {
                    var pad = document.querySelector('.morph-pad[data-b="' + bId + '"]:not(.shapes-pad)');
                    if (pad) pad.querySelectorAll('.radius-ring').forEach(function (r) {
                        r.classList.add('fading');
                        setTimeout(function () { r.remove(); }, 400);
                    });
                }
            }
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
        // Double-click to reset
        bk.addEventListener('dblclick', function (e) {
            e.preventDefault();
            var b = findBlock(bId); if (!b) return;
            var def = knobDefaults[f];
            if (def !== undefined) {
                var snap = captureFullSnapshot();
                if (f === 'sampleSpeedPct') b.sampleSpeed = def / 100;
                else b[f] = def;
                undoStack.push({ type: 'full', snapshot: snap });
                if (undoStack.length > maxUndo) undoStack.shift();
                redoStack = [];
                updateUndoBadge();
                renderSingleBlock(bId); syncBlocksToHost();
            }
        });
        // Scroll wheel on block knobs
        bk.addEventListener('wheel', function (e) {
            e.preventDefault(); e.stopPropagation();
            if (bk.dataset.disabled) return;
            var b = findBlock(bId); if (!b) return;
            var range = mx - mn;
            var step = e.shiftKey ? range * 0.002 : range * 0.01;
            var delta = e.deltaY < 0 ? step : -step;
            var curVal = (f === 'sampleSpeedPct') ? (b.sampleSpeed * 100) : (b[f] != null ? b[f] : mn);
            var nv = Math.round(Math.max(mn, Math.min(mx, curVal + delta)));
            if (nv === Math.round(curVal)) return;
            if (f === 'sampleSpeedPct') b.sampleSpeed = nv / 100;
            else b[f] = nv;
            renderSingleBlock(bId); debouncedSync();
        }, { passive: false });
    });
    document.querySelectorAll('.sub-input').forEach(function (inp) { if (!inp.dataset.b) return; inp.onchange = function () { var b = findBlock(parseInt(inp.dataset.b)); if (b) { b[inp.dataset.f] = Math.max(0, Math.min(128, parseInt(inp.value) || 0)); syncBlocksToHost(); } }; });
    document.querySelectorAll('.fire').forEach(function (btn) { btn.onclick = function (e) { e.stopPropagation(); btn.classList.add('flash'); setTimeout(function () { btn.classList.remove('flash'); }, 250); var bId = parseInt(btn.dataset.b); var blk = findBlock(bId); if (blk) { var ov = []; blk.targets.forEach(function (pid) { var p = PMap[pid]; if (p && !p.lk && !p.alk) ov.push({ id: pid, val: p.v }); }); randomize(bId); if (ov.length) pushMultiParamUndo(ov); } flashDot('midiD'); }; });
    // .tx (remove) and .tgt-name (locate) handlers are wired inline in _buildTargetRow
    // Target search filter (compatible with virtual scroll)
    document.querySelectorAll('.tgt-search').forEach(function (inp) {
        inp.onclick = function (e) { e.stopPropagation(); };
        inp.onkeydown = function (e) { e.stopPropagation(); };
        inp.oninput = function () {
            var bId = parseInt(inp.dataset.b);
            var b = findBlock(bId); if (!b) return;
            b._tgtFilter = inp.value;
            var list = inp.parentElement.querySelector('.tgt-list[data-b="' + bId + '"]');
            if (!list) return;
            _fillTargetList(list, b, bColor(b.colorIdx));
        };
    });
    // Sample load buttons
    document.querySelectorAll('.load-smp').forEach(function (btn) {
        btn.onclick = function (e) {
            e.stopPropagation();
            var bId = parseInt(btn.dataset.b);
            if (!(window.__JUCE__ && window.__JUCE__.backend)) return;
            var fn = window.__juceGetNativeFunction('browseSample');
            fn(bId).then(function (result) {
                if (!result) return;
                var b = findBlock(bId);
                if (!b) return;
                b.sampleName = result.name || '';
                b.sampleWaveform = result.waveform || [];
                renderSingleBlock(bId);
                drawWaveform(bId);
            });
        };
    });
    // Draw waveforms for sample blocks that already have data
    blocks.forEach(function (b) { if (b.mode === 'sample' && b.sampleWaveform && b.sampleWaveform.length) drawWaveform(b.id); });
    // Morph pad wiring: snapshot add, delete, playhead drag, snapshot drag
    document.querySelectorAll('.snap-add-btn').forEach(function (btn) {
        btn.onclick = function (e) {
            e.stopPropagation();
            var bId = parseInt(btn.dataset.b);
            var b = findBlock(bId); if (!b) return;
            if (!b.snapshots) b.snapshots = [];
            if (b.snapshots.length >= 12) return;
            // Capture ALL plugin params â€” not just assigned targets.
            // This way snapshots work even if you assign params later.
            var vals = {};
            var sourceName = '';
            for (var pid in PMap) {
                var p = PMap[pid];
                if (p) {
                    vals[pid] = p.v;
                    if (!sourceName && p.hostId !== undefined) sourceName = getPluginName(p.hostId);
                }
            }
            var spos = getSnapSectorPos(b.snapshots.length);
            b.snapshots.push({ x: spos.x, y: spos.y, values: vals, name: 'S' + (b.snapshots.length + 1), source: sourceName });
            renderSingleBlock(bId); syncBlocksToHost();
            // Visual flash feedback on the pad
            var pad = document.querySelector('.morph-pad[data-b="' + bId + '"]');
            if (pad) { pad.classList.remove('snap-flash'); void pad.offsetWidth; pad.classList.add('snap-flash'); }
            // Glow on the newest chip
            var chips = document.querySelectorAll('.snap-chip[data-b="' + bId + '"]');
            if (chips.length) { var last = chips[chips.length - 1]; last.classList.add('just-added'); setTimeout(function () { last.classList.remove('just-added'); }, 600); }
        };
    });
    // Snapshot Library buttons (morph pad)
    document.querySelectorAll('.snap-lib-btn').forEach(function (btn) {
        btn.onclick = function (e) {
            e.stopPropagation();
            var bId = parseInt(btn.dataset.b);
            if (typeof openSnapshotLibrary === 'function') openSnapshotLibrary(bId);
        };
    });
    document.querySelectorAll('.snap-del').forEach(function (btn) {
        btn.onclick = function (e) {
            e.stopPropagation();
            var bId = parseInt(btn.dataset.b), si = parseInt(btn.dataset.si);
            var b = findBlock(bId); if (!b || !b.snapshots) return;
            b.snapshots.splice(si, 1);
            renderSingleBlock(bId); syncBlocksToHost();
        };
    });
    document.querySelectorAll('.snap-chip').forEach(function (chip) {
        chip.onclick = function (e) {
            if (e.target.classList.contains('snap-del')) return;
            e.stopPropagation();
            var bId = parseInt(chip.dataset.b), si = parseInt(chip.dataset.si);
            var b = findBlock(bId); if (!b || !b.snapshots || !b.snapshots[si]) return;
            b.playheadX = b.snapshots[si].x;
            b.playheadY = b.snapshots[si].y;
            renderSingleBlock(bId); syncBlocksToHost();
        };
    });
    // Lightweight playhead updater â€” sends only blockId + x,y to C++ (no full JSON reparse)
    var _morphPlayheadFn = null;
    function sendPlayhead(bId, x, y) {
        if (!_morphPlayheadFn) _morphPlayheadFn = window.__juceGetNativeFunction ? window.__juceGetNativeFunction('updateMorphPlayhead') : null;
        if (_morphPlayheadFn) _morphPlayheadFn(bId, x, y);
    }
    // Playhead drag (manual mode)
    document.querySelectorAll('.playhead-dot.manual').forEach(function (dot) {
        dot.onmousedown = function (e) {
            e.stopPropagation(); e.preventDefault();
            var pad = dot.closest('.morph-pad'); if (!pad) return;
            var bId = parseInt(pad.dataset.b);
            var b = findBlock(bId); if (!b) return;
            var onMove = function (ev) {
                var rect = pad.getBoundingClientRect();
                var rawX = (ev.clientX - rect.left) / rect.width;
                var rawY = 1 - (ev.clientY - rect.top) / rect.height;
                var c = clampToCircle(rawX, rawY);
                b.playheadX = c.x;
                b.playheadY = c.y;
                dot.style.left = (c.x * 100) + '%';
                dot.style.top = ((1 - c.y) * 100) + '%';
                sendPlayhead(bId, c.x, c.y); // lightweight update â€” C++ runs IDW interpolation
            };
            var onUp = function () {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                syncBlocksToHost(); // full sync on release for state persistence
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        };
    });
    // Pad click-to-jump + drag (manual mode) â€” clicking anywhere on the pad moves the playhead
    document.querySelectorAll('.morph-pad:not(.shapes-pad)').forEach(function (pad) {
        pad.onmousedown = function (e) {
            if (e.target.classList.contains('snap-dot') || e.target.classList.contains('snap-label')) return;
            if (e.target.classList.contains('playhead-dot')) return;
            var bId = parseInt(pad.dataset.b);
            var b = findBlock(bId); if (!b || b.morphMode !== 'manual') return;
            if (!b.snapshots || !b.snapshots.length) return;
            e.preventDefault();
            var dot = document.getElementById('morphHead-' + bId);
            if (!dot) return;
            // Jump to click position
            var rect = pad.getBoundingClientRect();
            var c = clampToCircle((e.clientX - rect.left) / rect.width, 1 - (e.clientY - rect.top) / rect.height);
            b.playheadX = c.x; b.playheadY = c.y;
            dot.style.left = (c.x * 100) + '%'; dot.style.top = ((1 - c.y) * 100) + '%';
            sendPlayhead(bId, c.x, c.y);
            // Enter drag mode
            var onMove = function (ev) {
                var r = pad.getBoundingClientRect();
                var mc = clampToCircle((ev.clientX - r.left) / r.width, 1 - (ev.clientY - r.top) / r.height);
                b.playheadX = mc.x; b.playheadY = mc.y;
                dot.style.left = (mc.x * 100) + '%'; dot.style.top = ((1 - mc.y) * 100) + '%';
                sendPlayhead(bId, mc.x, mc.y);
            };
            var onUp = function () { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); syncBlocksToHost(); };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        };
    });
    document.querySelectorAll('.snap-dot').forEach(function (dot) {
        dot.onmousedown = function (e) {
            e.stopPropagation(); e.preventDefault();
            var pad = dot.closest('.morph-pad'); if (!pad) return;
            var bId = parseInt(dot.dataset.b), si = parseInt(dot.dataset.si);
            var b = findBlock(bId); if (!b || !b.snapshots || !b.snapshots[si]) return;
            var onMove = function (ev) {
                var rect = pad.getBoundingClientRect();
                var rawX = (ev.clientX - rect.left) / rect.width;
                var rawY = 1 - (ev.clientY - rect.top) / rect.height;
                var c = clampToCircle(rawX, rawY);
                b.snapshots[si].x = c.x;
                b.snapshots[si].y = c.y;
                dot.style.left = (c.x * 100) + '%';
                dot.style.top = ((1 - c.y) * 100) + '%';
            };
            var onUp = function () {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                syncBlocksToHost();
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        };
    });
    // â”€â”€ Lane mode wiring â”€â”€
    // Tool buttons
    document.querySelectorAll('.lane-tbtn[data-lt]').forEach(function (btn) {
        btn.onclick = function (e) {
            e.stopPropagation();
            var bId = parseInt(btn.dataset.b), b = findBlock(bId);
            if (!b) return;
            if (btn.dataset.lt === 'clear') {
                b.lanes.forEach(function (l) {
                    var edgeY = (l.pts.length && l.pts[0].x < 0.01) ? l.pts[0].y : 0.5;
                    l.pts = [{ x: 0, y: edgeY }, { x: 1, y: edgeY }];
                    if (l._sel) l._sel.clear();
                });
                renderSingleBlock(bId); syncBlocksToHost(); return;
            }
            if (btn.dataset.lt === 'random') {
                b.lanes.forEach(function (l) {
                    laneRandomize(l, b.laneGrid);
                    if (l._sel) l._sel.clear();
                });
                renderSingleBlock(bId); syncBlocksToHost(); return;
            }
            b.laneTool = btn.dataset.lt;
            // Update button states without full rebuild
            btn.closest('.lane-toolbar').querySelectorAll('.lane-tbtn[data-lt]').forEach(function (t) {
                if (t.dataset.lt !== 'clear' && t.dataset.lt !== 'random') t.classList.toggle('on', t.dataset.lt === b.laneTool);
            });
        };
    });
    // Grid tabs
    document.querySelectorAll('.lane-itabs').forEach(function (tabs) {
        tabs.querySelectorAll('.lane-itab').forEach(function (tab) {
            tab.onclick = function (e) {
                e.stopPropagation();
                var bId = parseInt(tabs.dataset.b), b = findBlock(bId);
                if (!b) return;
                b.laneGrid = tab.dataset.v;
                tabs.querySelectorAll('.lane-itab').forEach(function (t) { t.classList.toggle('on', t.dataset.v === b.laneGrid); });
                // Grid is a snap aid â€” switching does NOT move existing points
                // Redraw all canvases with new grid
                if (b.lanes) b.lanes.forEach(function (l, li) { laneDrawCanvas(b, li); });
                debouncedSync();
            };
        });
    });
    // Lane collapse arrows
    document.querySelectorAll('.lane-hdr-arrow').forEach(function (arr) {
        arr.onclick = function (e) {
            e.stopPropagation();
            var bId = parseInt(arr.dataset.b), li = parseInt(arr.dataset.li);
            var b = findBlock(bId); if (!b || !b.lanes[li]) return;
            b.lanes[li].collapsed = !b.lanes[li].collapsed;
            renderSingleBlock(bId);
        };
    });

    // Lane footer text knob drag â€” mousedown + vertical drag + dblclick reset
    document.querySelectorAll('.lane-ft-knob').forEach(function (el) {
        var bId = parseInt(el.dataset.b), li = parseInt(el.dataset.li);
        var k = el.dataset.lk;
        var isMorphSnap = (k === 'morphHold' || k === 'morphDepth' || k === 'morphSlew' || k === 'morphDrift' || k === 'morphDriftRange' || k === 'morphWarp' || k === 'morphSteps');
        var isDepth = (k === 'depth' || k === 'morphDepth');
        var isSteps = (k === 'steps' || k === 'morphSteps');
        // Range: min/max per knob type
        var isDriftRange = (k === 'driftRange' || k === 'morphDriftRange');
        var mn, mx;
        if (k === 'morphHold' || k === 'morphDepth') { mn = 0; mx = 100; }
        else if (k === 'depth') { mn = 0; mx = 200; }
        else if (isSteps) { mn = 0; mx = 32; }
        else if (isDriftRange) { mn = 0; mx = 100; }
        else { mn = -50; mx = 50; }  // drift, warp, morphDrift, morphWarp
        var defaults = { depth: 100, drift: 0, driftRange: 5, warp: 0, steps: 0, morphHold: 50, morphDepth: 100, morphDrift: 0, morphDriftRange: 5, morphWarp: 0, morphSteps: 0 };
        var labels = { depth: 'Depth ', drift: 'Drift ', driftRange: 'DftRng ', warp: 'Warp ', steps: 'Steps ', morphHold: 'Hold ', morphDepth: 'Dpth ', morphDrift: 'Drift ', morphDriftRange: 'DftRng ', morphWarp: 'Warp ', morphSteps: 'Step ' };
        // Snapshot property key for morph knobs
        var snapKey = { morphHold: 'hold', morphDepth: 'depth', morphDrift: 'drift', morphDriftRange: 'driftRange', morphWarp: 'warp', morphSteps: 'steps' };
        function fmt(v) {
            if (k === 'depth' || k === 'morphHold' || k === 'morphDepth') return labels[k] + v + '%';
            if (isSteps) return labels[k] + (v || 'Off');
            if (isDriftRange) return labels[k] + v + '%';
            return labels[k] + (v >= 0 ? '+' : '') + v;
        }
        function getSnap(lane) {
            return (lane._selectedSnap != null && lane.morphSnapshots && lane.morphSnapshots[lane._selectedSnap]) ? lane.morphSnapshots[lane._selectedSnap] : null;
        }
        function readVal(lane) {
            if (isMorphSnap) {
                var s = getSnap(lane);
                if (!s) return defaults[k];
                var raw = s[snapKey[k]];
                if (k === 'morphHold' || k === 'morphDepth') return Math.round((raw != null ? raw : (k === 'morphHold' ? 0.5 : 1.0)) * 100);
                return raw != null ? raw : defaults[k];
            }
            return lane[k] != null ? lane[k] : defaults[k];
        }
        function writeVal(lane, nv) {
            if (isMorphSnap) {
                // Apply to all selected snapshots (multi-select)
                var indices = [];
                if (lane._selectedSnaps && lane._selectedSnaps.size > 0) {
                    lane._selectedSnaps.forEach(function (si) { indices.push(si); });
                }
                // Always include the primary selected snap
                if (lane._selectedSnap != null && indices.indexOf(lane._selectedSnap) < 0) {
                    indices.push(lane._selectedSnap);
                }
                for (var si = 0; si < indices.length; si++) {
                    var s = lane.morphSnapshots && lane.morphSnapshots[indices[si]];
                    if (!s) continue;
                    if (k === 'morphHold' || k === 'morphDepth') s[snapKey[k]] = nv / 100;
                    else s[snapKey[k]] = nv;
                }
            } else {
                lane[k] = nv;
            }
        }
        el.addEventListener('mousedown', function (e) {
            e.preventDefault(); e.stopPropagation();
            var b = findBlock(bId); if (!b || !b.lanes[li]) return;
            var lane = b.lanes[li];
            // Double-click detection
            if (!lane._knobClicks) lane._knobClicks = {};
            var now = Date.now();
            if (lane._knobClicks[k] && now - lane._knobClicks[k] < 350) {
                writeVal(lane, defaults[k]);
                el.textContent = fmt(defaults[k]);
                lane._knobClicks[k] = 0;
                laneDrawCanvas(b, li);
                renderSingleBlock(bId); debouncedSync();
                return;
            }
            lane._knobClicks[k] = now;
            var startY = e.clientY;
            var startVal = readVal(lane);
            var dragged = false;
            document.body.classList.add('knob-dragging');
            el.classList.add('dragging');
            function onMove(me) {
                dragged = true;
                var dy = startY - me.clientY;
                var nv = Math.round(Math.max(mn, Math.min(mx, startVal + dy * 0.5)));
                writeVal(lane, nv);
                el.textContent = fmt(nv);
                laneDrawCanvas(b, li);
                // Continuous sync to C++ during drag
                debouncedSync();
                // Cross-update: redraw any lane that has this lane as overlay
                for (var ci = 0; ci < b.lanes.length; ci++) {
                    if (ci === li) continue;
                    var cl = b.lanes[ci];
                    if (cl._overlayLanes && cl._overlayLanes.indexOf(li) >= 0) {
                        laneDrawCanvas(b, ci);
                    }
                }
            }
            function onUp() {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                document.body.classList.remove('knob-dragging');
                el.classList.remove('dragging');
                // Bake effect into selected dots for curve lanes (not morph)
                if (!isMorphSnap && dragged && lane._sel && lane._sel.size >= 2 &&
                    (k === 'depth' || k === 'warp' || k === 'steps')) {
                    var depthV = (lane.depth != null ? lane.depth : 100) / 100;
                    var warpV = (lane.warp || 0) / 50;
                    var stepsV = lane.steps || 0;
                    // Find selection X range
                    var sxMin = 1, sxMax = 0;
                    lane._sel.forEach(function (idx) {
                        if (lane.pts[idx]) {
                            if (lane.pts[idx].x < sxMin) sxMin = lane.pts[idx].x;
                            if (lane.pts[idx].x > sxMax) sxMax = lane.pts[idx].x;
                        }
                    });
                    // Apply processY to each point within selection range
                    for (var pi = 0; pi < lane.pts.length; pi++) {
                        if (lane.pts[pi].x >= sxMin && lane.pts[pi].x <= sxMax) {
                            var y = lane.pts[pi].y;
                            // Depth
                            var v = 0.5 + (y - 0.5) * depthV;
                            // Warp
                            if (Math.abs(warpV) > 0.001) {
                                var centered = (v - 0.5) * 2;
                                if (warpV > 0) {
                                    var wk = 1 + warpV * 8;
                                    v = Math.tanh(centered * wk) / Math.tanh(wk) * 0.5 + 0.5;
                                } else {
                                    var aw = Math.abs(warpV);
                                    var sign = centered >= 0 ? 1 : -1;
                                    v = Math.pow(Math.abs(centered), 1 / (1 + aw * 3)) * sign * 0.5 + 0.5;
                                }
                            }
                            // Steps
                            if (stepsV >= 2) v = Math.round(v * stepsV) / stepsV;
                            lane.pts[pi].y = Math.max(0, Math.min(1, v));
                        }
                    }
                    // Reset knobs to neutral
                    lane.depth = 100;
                    lane.warp = 0;
                    lane.steps = 0;
                }
                renderSingleBlock(bId); debouncedSync();
            }
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    });
    // Morph curve selector
    document.querySelectorAll('.lane-morph-curve-sel').forEach(function (sel) {
        sel.onchange = function () {
            var bId = parseInt(sel.dataset.b), li = parseInt(sel.dataset.li);
            var b = findBlock(bId); if (!b || !b.lanes[li]) return;
            var lane = b.lanes[li];
            var curveVal = parseInt(sel.value) || 0;
            // Apply to all selected snapshots
            var indices = [];
            if (lane._selectedSnaps && lane._selectedSnaps.size > 0) {
                lane._selectedSnaps.forEach(function (si) { indices.push(si); });
            }
            if (lane._selectedSnap != null && indices.indexOf(lane._selectedSnap) < 0) {
                indices.push(lane._selectedSnap);
            }
            for (var si = 0; si < indices.length; si++) {
                var snap = lane.morphSnapshots && lane.morphSnapshots[indices[si]];
                if (snap) snap.curve = curveVal;
            }
            laneDrawCanvas(b, li);
            syncBlocksToHost();
        };
    });
    // Lane mute toggle
    document.querySelectorAll('.lane-hdr-mute').forEach(function (sp) {
        sp.onclick = function (e) {
            e.stopPropagation();
            var bId = parseInt(sp.dataset.b), li = parseInt(sp.dataset.li);
            var b = findBlock(bId); if (!b || !b.lanes[li]) return;
            b.lanes[li].muted = !b.lanes[li].muted;
            renderSingleBlock(bId); debouncedSync();
        };
    });
    // Header clear button
    document.querySelectorAll('.lane-hdr-clear').forEach(function (sp) {
        sp.onclick = function (e) {
            e.stopPropagation();
            var bId = parseInt(sp.dataset.b), li = parseInt(sp.dataset.li);
            var b = findBlock(bId); if (!b || !b.lanes[li]) return;
            if (typeof pushUndoSnapshot === 'function') pushUndoSnapshot();
            b.lanes[li].pts = [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }];
            if (b.lanes[li]._sel) b.lanes[li]._sel.clear();
            laneDrawCanvas(b, li);
            syncBlocksToHost();
        };
    });
    document.querySelectorAll('.lane-del-btn').forEach(function (sp) {
        sp.onclick = function (e) {
            e.stopPropagation();
            var bId = parseInt(sp.dataset.b), li = parseInt(sp.dataset.li);
            var b = findBlock(bId); if (!b || !b.lanes || !b.lanes[li]) return;
            if (typeof pushUndoSnapshot === 'function') pushUndoSnapshot();
            var lane = b.lanes[li];
            // Remove the lane's assigned params from the block's target set
            if (lane.pids) {
                lane.pids.forEach(function (pid) {
                    // Only remove if no other lane also has this pid
                    var usedElsewhere = false;
                    for (var oi = 0; oi < b.lanes.length; oi++) {
                        if (oi !== li && b.lanes[oi].pids && b.lanes[oi].pids.indexOf(pid) >= 0) {
                            usedElsewhere = true; break;
                        }
                    }
                    if (!usedElsewhere) b.targets.delete(pid);
                });
            }
            b.lanes.splice(li, 1);
            renderSingleBlock(bId); renderAllPlugins(); syncBlocksToHost();
        };
    });
    // Right-click context menu on lane param chips — Move to lane
    document.querySelectorAll('.lane-param-chip[data-b][data-li][data-pid]').forEach(function (chip) {
        chip.oncontextmenu = function (e) {
            e.preventDefault();
            e.stopPropagation();
            var bId = parseInt(chip.dataset.b), li = parseInt(chip.dataset.li);
            var pid = chip.dataset.pid;
            var b = findBlock(bId); if (!b || !b.lanes[li]) return;
            // Remove existing menus
            var old = document.querySelector('.lane-ctx-menu');
            if (old) old.remove();
            var menu = document.createElement('div');
            menu.className = 'lane-ctx-menu lane-add-menu';
            // Build items
            var items = [];
            // Move to new Param Lane
            items.push({
                label: '\u2795 New Param Lane', action: function () {
                    if (typeof pushUndoSnapshot === 'function') pushUndoSnapshot();
                    // Remove from current lane
                    b.lanes[li].pids = b.lanes[li].pids.filter(function (p) { return p !== pid; });
                    if (b.lanes[li].pids.length === 0 && !b.lanes[li].morphMode) b.lanes.splice(li, 1);
                    // Create new curve lane
                    var col = typeof LANE_COLORS !== 'undefined' ? LANE_COLORS[b.lanes.length % LANE_COLORS.length] : '#64b4ff';
                    b.lanes.push({
                        pids: [pid], color: col,
                        pts: [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }],
                        loopLen: '1/1', freeSecs: 4, depth: 100,
                        drift: 0, driftRange: 5, driftScale: '1/1', warp: 0, steps: 0,
                        interp: 'smooth', playMode: 'forward',
                        synced: true, muted: false, collapsed: false,
                        trigMode: 'loop', trigSource: 'manual',
                        trigMidiNote: -1, trigMidiCh: 0, trigThreshold: -12, trigAudioSrc: 'main',
                        trigRetrigger: true, trigHold: false,
                        morphMode: false, morphSnapshots: [],
                        _overlayLanes: [], _userCreated: true
                    });
                    b.targets.add(pid);
                    renderSingleBlock(bId); syncBlocksToHost();
                }
            });
            // Move to new Morph Lane
            items.push({
                label: '\u21CB New Morph Lane', action: function () {
                    if (typeof pushUndoSnapshot === 'function') pushUndoSnapshot();
                    b.lanes[li].pids = b.lanes[li].pids.filter(function (p) { return p !== pid; });
                    if (b.lanes[li].pids.length === 0 && !b.lanes[li].morphMode) b.lanes.splice(li, 1);
                    var col = typeof LANE_COLORS !== 'undefined' ? LANE_COLORS[b.lanes.length % LANE_COLORS.length] : '#64b4ff';
                    b.lanes.push({
                        pids: [pid], color: col,
                        pts: [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }],
                        loopLen: '1/1', freeSecs: 4, depth: 100,
                        drift: 0, driftRange: 5, driftScale: '1/1', warp: 0, steps: 0,
                        interp: 'smooth', playMode: 'forward',
                        synced: true, muted: false, collapsed: false,
                        trigMode: 'loop', trigSource: 'manual',
                        trigMidiNote: -1, trigMidiCh: 0, trigThreshold: -12, trigAudioSrc: 'main',
                        trigRetrigger: true, trigHold: false,
                        morphMode: true, morphSnapshots: [],
                        _overlayLanes: [], _userCreated: true
                    });
                    b.targets.add(pid);
                    renderSingleBlock(bId); syncBlocksToHost();
                }
            });
            // Move to existing lanes
            for (var oi = 0; oi < b.lanes.length; oi++) {
                if (oi === li) continue;
                if (b.lanes[oi].pids.indexOf(pid) >= 0) continue; // already there
                var oLane = b.lanes[oi];
                var oName = oLane.pids[0] ? (PMap[oLane.pids[0]] ? PMap[oLane.pids[0]].name : oLane.pids[0]) : (oLane.morphMode ? 'Morph' : 'Lane');
                var typeLabel = oLane.morphMode ? '\u21CB' : '\u270F';
                items.push({
                    label: typeLabel + ' Lane ' + (oi + 1) + ': ' + oName, action: (function (targetLane) {
                        return function () {
                            if (typeof pushUndoSnapshot === 'function') pushUndoSnapshot();
                            b.lanes[li].pids = b.lanes[li].pids.filter(function (p) { return p !== pid; });
                            if (b.lanes[li].pids.length === 0 && !b.lanes[li].morphMode) b.lanes.splice(li, 1);
                            if (targetLane.pids.indexOf(pid) < 0) targetLane.pids.push(pid);
                            b.targets.add(pid);
                            renderSingleBlock(bId); syncBlocksToHost();
                        };
                    })(oLane)
                });
            }
            // Separator + Remove
            items.push({ sep: true });
            items.push({
                label: '\u2716 Remove from lane', danger: true, action: function () {
                    if (typeof pushUndoSnapshot === 'function') pushUndoSnapshot();
                    b.lanes[li].pids = b.lanes[li].pids.filter(function (p) { return p !== pid; });
                    if (b.lanes[li].morphMode) { b.targets.delete(pid); cleanBlockAfterUnassign(b, pid); }
                    if (b.lanes[li].pids.length === 0 && !b.lanes[li].morphMode) b.lanes.splice(li, 1);
                    renderSingleBlock(bId); renderAllPlugins(); debouncedSync();
                }
            });
            // Render menu items
            items.forEach(function (item) {
                if (item.sep) {
                    var sep = document.createElement('div');
                    sep.style.cssText = 'height:1px;background:var(--border);margin:3px 0;';
                    menu.appendChild(sep);
                    return;
                }
                var row = document.createElement('div');
                row.className = 'lane-add-menu-item';
                row.textContent = item.label;
                if (item.danger) row.style.color = '#e57373';
                row.onclick = function (ev) {
                    ev.stopPropagation();
                    menu.remove();
                    item.action();
                };
                menu.appendChild(row);
            });
            // Position with viewport clamping
            menu.style.cssText = 'position:fixed;z-index:9999;visibility:hidden;';
            document.body.appendChild(menu);
            var mw = menu.offsetWidth, mh = menu.offsetHeight;
            var vw = window.innerWidth, vh = window.innerHeight;
            var ml = e.clientX, mt = e.clientY;
            if (ml + mw > vw - 4) ml = vw - mw - 4;
            if (mt + mh > vh - 4) mt = Math.max(4, e.clientY - mh);
            menu.style.left = ml + 'px';
            menu.style.top = mt + 'px';
            menu.style.visibility = '';
            // Dismiss on outside click
            setTimeout(function () {
                var dismiss = function (de) {
                    if (menu.contains(de.target)) return;
                    menu.remove();
                    document.removeEventListener('mousedown', dismiss);
                };
                document.addEventListener('mousedown', dismiss);
            }, 50);
        };
    });
    // Lane overlay picker (multi-select toggle)
    document.querySelectorAll('.lane-hdr-overlay').forEach(function (sp) {
        sp.onclick = function (e) {
            e.stopPropagation();
            var bId = parseInt(sp.dataset.b), li = parseInt(sp.dataset.li);
            var b = findBlock(bId); if (!b || !b.lanes[li]) return;
            // Toggle existing menu
            var old = document.querySelector('.lane-overlay-menu');
            if (old) { old.remove(); return; }
            var lane = b.lanes[li];
            if (!lane._overlayLanes) lane._overlayLanes = [];

            function buildMenu() {
                var menu = document.createElement('div');
                menu.className = 'lane-overlay-menu lane-add-menu';
                var rect = sp.getBoundingClientRect();
                var menuW = 170, menuH = (b.lanes.length) * 28 + 30; // estimated height
                var vw = window.innerWidth, vh = window.innerHeight;
                var posLeft = rect.left;
                var posTop = rect.bottom + 2;
                // Clamp right edge
                if (posLeft + menuW > vw - 4) posLeft = vw - menuW - 4;
                if (posLeft < 4) posLeft = 4;
                // Flip upward if it overflows bottom
                if (posTop + menuH > vh - 4) posTop = rect.top - menuH - 2;
                menu.style.cssText = 'position:fixed;left:' + posLeft + 'px;top:' + posTop + 'px;z-index:9999;min-width:' + menuW + 'px;';

                // "Clear All" option
                var clr = document.createElement('div');
                clr.className = 'lane-add-menu-item';
                clr.style.opacity = lane._overlayLanes.length ? '1' : '0.4';
                clr.textContent = 'Clear All';
                clr.onclick = function () {
                    lane._overlayLanes = [];
                    menu.remove();
                    renderSingleBlock(bId);
                };
                menu.appendChild(clr);

                // Separator
                var sep = document.createElement('div');
                sep.style.cssText = 'height:1px;background:var(--border);margin:3px 0;';
                menu.appendChild(sep);

                // Other lanes as toggleable items
                for (var oi = 0; oi < b.lanes.length; oi++) {
                    if (oi === li) continue;
                    var ol = b.lanes[oi];
                    var oName = ol.pids[0] ? (PMap[ol.pids[0]] ? PMap[ol.pids[0]].name : ol.pids[0]) : 'Lane';
                    var isActive = lane._overlayLanes.indexOf(oi) >= 0;
                    var item = document.createElement('div');
                    item.className = 'lane-add-menu-item' + (isActive ? ' active' : '');
                    item.style.cssText = 'display:flex;align-items:center;gap:6px;';
                    item.innerHTML = '<span style="width:14px;text-align:center;font-size:10px">' + (isActive ? '\u2713' : '') + '</span>'
                        + '<span style="width:6px;height:6px;border-radius:50%;background:' + ol.color + ';flex-shrink:0"></span>'
                        + '<span>L' + (oi + 1) + ': ' + oName + '</span>'
                        + '<span style="opacity:0.4;font-size:8px;margin-left:auto">' + ol.loopLen + '</span>';
                    item.dataset.oi = oi;
                    item.onclick = function () {
                        var idx = parseInt(this.dataset.oi);
                        var pos = lane._overlayLanes.indexOf(idx);
                        if (pos >= 0) {
                            lane._overlayLanes.splice(pos, 1);
                        } else {
                            lane._overlayLanes.push(idx);
                        }
                        // Rebuild menu in-place to update checkmarks
                        var parent = menu.parentNode;
                        menu.remove();
                        var newMenu = buildMenu();
                        parent.appendChild(newMenu);
                        laneDrawCanvas(b, li);
                    };
                    menu.appendChild(item);
                }
                return menu;
            }

            var menu = buildMenu();
            document.body.appendChild(menu);
            // Close on outside click
            setTimeout(function () {
                var closer = function (ev) {
                    var m = document.querySelector('.lane-overlay-menu');
                    if (!m || !m.contains(ev.target)) {
                        if (m) m.remove();
                        document.removeEventListener('mousedown', closer);
                        renderSingleBlock(bId);
                    }
                };
                document.addEventListener('mousedown', closer);
            }, 0);
        };
    });
    // Lane param chip × remove
    document.querySelectorAll('.lane-param-chip-x').forEach(function (btn) {
        btn.onclick = function (e) {
            e.stopPropagation();
            var bId = parseInt(btn.dataset.b), li = parseInt(btn.dataset.li);
            var pid = btn.dataset.pid;
            var b = findBlock(bId); if (!b || !b.lanes[li]) return;
            pushUndoSnapshot();
            var lane = b.lanes[li];
            lane.pids = lane.pids.filter(function (p) { return p !== pid; });
            // For morph lanes: also remove from b.targets and clean snapshot values
            if (lane.morphMode) {
                b.targets.delete(pid);
                cleanBlockAfterUnassign(b, pid);
                if (lane.morphSnapshots) {
                    lane.morphSnapshots.forEach(function (s) {
                        if (s.values && s.values[pid] !== undefined) delete s.values[pid];
                    });
                }
            }
            if (lane.pids.length === 0 && !lane.morphMode) {
                b.lanes.splice(li, 1); // remove empty curve lane (morph lanes keep existing)
            }
            if (lane._highlightParam != null) lane._highlightParam = -1;
            renderSingleBlock(bId); renderAllPlugins(); debouncedSync();
        };
    });
    // Lane + Add param button
    document.querySelectorAll('.lane-add-param-btn').forEach(function (btn) {
        // Skip buttons that aren't actual add-param flows (capture, library, add-morph)
        if (btn.classList.contains('lane-sidebar-capture') || btn.classList.contains('lane-morph-lib-btn') || btn.classList.contains('lane-add-morph-btn')) return;
        btn.onclick = function (e) {
            e.stopPropagation();
            // Toggle: if menu already open for this button, close it
            var existingMenu = document.querySelector('.lane-add-menu[data-owner-b="' + btn.dataset.b + '"][data-owner-li="' + btn.dataset.li + '"]');
            if (existingMenu) { existingMenu.remove(); return; }
            // Close any other add-param menu
            var otherMenu = document.querySelector('.lane-add-menu[data-owner-b]');
            if (otherMenu) otherMenu.remove();
            var bId = parseInt(btn.dataset.b), li = parseInt(btn.dataset.li);
            var b = findBlock(bId); if (!b || !b.lanes[li]) return;
            var lane = b.lanes[li];

            function buildAddMenu() {
                var assignedHere = {};
                lane.pids.forEach(function (p) { assignedHere[p] = true; });

                // Build all assigned-in-any-lane set
                var allAssigned = {};
                b.lanes.forEach(function (l) { l.pids.forEach(function (p) { allAssigned[p] = true; }); });

                // Section 1: params in OTHER lanes (merge/move) — close on click
                var moveOpts = [];
                for (var oi = 0; oi < b.lanes.length; oi++) {
                    if (oi === li) continue;
                    b.lanes[oi].pids.forEach(function (pid) {
                        var pp = PMap[pid];
                        moveOpts.push({ pid: pid, label: pp ? pp.name : pid, srcLane: oi });
                    });
                }

                // Section 2: plugin params — toggleable (stays open)
                var pluginOpts = [];
                pluginBlocks.forEach(function (pb) {
                    pb.params.forEach(function (p) {
                        // Show all params not assigned to OTHER lanes (already-here ones show as checked)
                        if (allAssigned[p.id] && !assignedHere[p.id]) return;
                        pluginOpts.push({ pid: p.id, label: p.name, plugin: pb.name, added: !!assignedHere[p.id] });
                    });
                });

                if (moveOpts.length === 0 && pluginOpts.length === 0) return null;

                var menu = document.createElement('div');
                menu.className = 'lane-add-menu';
                menu.setAttribute('data-owner-b', bId);
                menu.setAttribute('data-owner-li', li);
                menu.style.position = 'fixed';
                menu.style.zIndex = '999';

                // Search input for filtering
                var totalOpts = moveOpts.length + pluginOpts.length;
                var searchInput = null;
                var allItems = [];
                if (totalOpts > 8) {
                    searchInput = document.createElement('input');
                    searchInput.type = 'text';
                    searchInput.className = 'lane-add-menu-search';
                    searchInput.placeholder = 'Search params\u2026';
                    searchInput.onclick = function (ev) { ev.stopPropagation(); };
                    menu.appendChild(searchInput);
                }

                // Move section (close on click)
                if (moveOpts.length > 0) {
                    var hdr = document.createElement('div');
                    hdr.className = 'lane-add-menu-hdr';
                    hdr.textContent = '\u21C4 MOVE FROM LANE';
                    menu.appendChild(hdr);
                    moveOpts.forEach(function (opt) {
                        var item = document.createElement('div');
                        item.className = 'lane-add-menu-item';
                        item.textContent = opt.label + ' \u2190 Lane ' + (opt.srcLane + 1);
                        item.dataset.search = item.textContent.toLowerCase();
                        item.onclick = function (ev) {
                            ev.stopPropagation();
                            lane.pids.push(opt.pid);
                            if (opt.srcLane >= 0 && b.lanes[opt.srcLane]) {
                                b.lanes[opt.srcLane].pids = b.lanes[opt.srcLane].pids.filter(function (p) { return p !== opt.pid; });
                                if (b.lanes[opt.srcLane].pids.length === 0) b.lanes.splice(opt.srcLane, 1);
                            }
                            menu.remove();
                            renderSingleBlock(bId); debouncedSync();
                            if (typeof renderAllPlugins === 'function') renderAllPlugins();
                        };
                        menu.appendChild(item);
                        allItems.push(item);
                    });
                }

                // Plugin params section (toggle, stays open)
                if (pluginOpts.length > 0) {
                    var hdr2 = document.createElement('div');
                    hdr2.className = 'lane-add-menu-hdr';
                    hdr2.textContent = '\u2795 PLUGIN PARAMS';
                    menu.appendChild(hdr2);
                    pluginOpts.forEach(function (opt) {
                        var item = document.createElement('div');
                        item.className = 'lane-add-menu-item' + (opt.added ? ' active' : '');
                        item.style.cssText = 'display:flex;align-items:center;gap:6px;';
                        item.innerHTML = '<span style="width:14px;text-align:center;font-size:10px">' + (opt.added ? '\u2713' : '') + '</span>'
                            + '<span>' + opt.plugin + ' / ' + opt.label + '</span>';
                        item.dataset.search = (opt.plugin + ' ' + opt.label).toLowerCase();
                        item.onclick = function (ev) {
                            ev.stopPropagation();
                            var idx = lane.pids.indexOf(opt.pid);
                            if (idx >= 0) {
                                // Remove
                                lane.pids.splice(idx, 1);
                            } else {
                                // Add
                                lane.pids.push(opt.pid);
                                b.targets.add(opt.pid);
                            }
                            // Rebuild menu in-place to update checkmarks
                            var parent = menu.parentNode;
                            var oldSearch = searchInput ? searchInput.value : '';
                            menu.remove();
                            var newMenu = buildAddMenu();
                            if (newMenu) {
                                var rect2 = btn.getBoundingClientRect();
                                newMenu.style.left = menu.style.left || (rect2.left + 'px');
                                newMenu.style.top = menu.style.top || (rect2.bottom + 2 + 'px');
                                parent.appendChild(newMenu);
                                // Restore search text
                                var newSearch = newMenu.querySelector('.lane-add-menu-search');
                                if (newSearch && oldSearch) {
                                    newSearch.value = oldSearch;
                                    newSearch.dispatchEvent(new Event('input'));
                                }
                            }
                            renderSingleBlock(bId); debouncedSync();
                            if (typeof renderAllPlugins === 'function') renderAllPlugins();
                        };
                        menu.appendChild(item);
                        allItems.push(item);
                    });
                }

                // Wire up search filtering
                if (searchInput) {
                    searchInput.oninput = function () {
                        var q = searchInput.value.toLowerCase();
                        allItems.forEach(function (el) {
                            el.style.display = (el.dataset.search || '').indexOf(q) >= 0 ? '' : 'none';
                        });
                    };
                }

                return menu;
            }

            var menu = buildAddMenu();
            if (!menu) return;

            // Position and append
            menu.style.visibility = 'hidden';
            document.body.appendChild(menu);
            var realH = menu.offsetHeight;
            var realW = menu.offsetWidth || 200;
            var rect = btn.getBoundingClientRect();
            var vw2 = window.innerWidth, vh2 = window.innerHeight;
            var fLeft = rect.left, fTop = rect.bottom + 2;
            if (fLeft + realW > vw2 - 4) fLeft = vw2 - realW - 4;
            if (fLeft < 4) fLeft = 4;
            if (fTop + realH > vh2 - 4) fTop = Math.max(4, rect.top - realH - 2);
            menu.style.left = fLeft + 'px';
            menu.style.top = fTop + 'px';
            menu.style.visibility = '';
            var searchEl = menu.querySelector('.lane-add-menu-search');
            if (searchEl) searchEl.focus();
            // Close on outside click (like overlay menu)
            setTimeout(function () {
                var closer = function (ev) {
                    var m = document.querySelector('.lane-add-menu[data-owner-b]');
                    if (!m || !m.contains(ev.target)) {
                        if (m) m.remove();
                        document.removeEventListener('mousedown', closer);
                    }
                };
                document.addEventListener('mousedown', closer);
            }, 10);
        };
    });
    // Lane interp buttons
    document.querySelectorAll('.lane-ibtn[data-linterp]').forEach(function (btn) {
        btn.onclick = function (e) {
            e.stopPropagation();
            var bId = parseInt(btn.dataset.b), li = parseInt(btn.dataset.li);
            var b = findBlock(bId); if (!b || !b.lanes[li]) return;
            b.lanes[li].interp = btn.dataset.linterp;
            // Update buttons without re-render
            var wrap = btn.closest('.lane-interp-stack');
            if (wrap) wrap.querySelectorAll('.lane-ibtn').forEach(function (t) { t.classList.toggle('on', t.dataset.linterp === b.lanes[li].interp); });
            laneDrawCanvas(b, li);
            debouncedSync();
        };
    });
    // Lane sync pills
    document.querySelectorAll('.lane-sync-pill').forEach(function (btn) {
        btn.onclick = function (e) {
            e.stopPropagation();
            var bId = parseInt(btn.dataset.b), li = parseInt(btn.dataset.li);
            var b = findBlock(bId); if (!b || !b.lanes[li]) return;
            b.lanes[li].synced = !b.lanes[li].synced;
            btn.classList.toggle('on', b.lanes[li].synced);
            btn.textContent = b.lanes[li].synced ? 'Host' : 'Int';
            debouncedSync();
        };
    });
    // Lane header selects (loop length, play mode, trigMode, trigSource, etc.)
    document.querySelectorAll('.lane-hdr-sel').forEach(function (sel) {
        sel.onchange = function () {
            var bId = parseInt(sel.dataset.b), li = parseInt(sel.dataset.li);
            var b = findBlock(bId); if (!b || !b.lanes[li]) return;
            var field = sel.dataset.lf;
            var val = sel.value;
            // Parse numeric fields
            if (field === 'trigMidiNote' || field === 'trigMidiCh') val = parseInt(val);
            b.lanes[li][field] = val;
            if (field === 'loopLen' || field === 'trigMode' || field === 'trigSource') renderSingleBlock(bId);
            debouncedSync();
            sel.blur();
        };
    });
    // Footer selects (drift scale etc.)
    document.querySelectorAll('.lane-ft-sel[data-lf]').forEach(function (sel) {
        sel.onchange = function () {
            var bId = parseInt(sel.dataset.b), li = parseInt(sel.dataset.li);
            var b = findBlock(bId); if (!b || !b.lanes[li]) return;
            b.lanes[li][sel.dataset.lf] = sel.value;
            laneDrawCanvas(b, li);
            debouncedSync();
            sel.blur();
        };
    });
    // Fire button (manual oneshot trigger)
    document.querySelectorAll('.lane-fire-btn').forEach(function (btn) {
        btn.onclick = function () {
            var bId = parseInt(btn.dataset.b), li = parseInt(btn.dataset.li);
            if (window.__JUCE__ && window.__JUCE__.backend) {
                var fn = window.__juceGetNativeFunction('fireLaneTrigger');
                if (fn) fn(bId, li);
            }
            btn.classList.add('fired');
            setTimeout(function () { btn.classList.remove('fired'); }, 200);
        };
    });
    // Trigger threshold slider
    document.querySelectorAll('.lane-trig-slider').forEach(function (sl) {
        sl.oninput = function () {
            var bId = parseInt(sl.dataset.b), li = parseInt(sl.dataset.li);
            var b = findBlock(bId); if (!b || !b.lanes[li]) return;
            b.lanes[li].trigThreshold = parseInt(sl.value);
            var dbLabel = sl.nextElementSibling;
            if (dbLabel) dbLabel.textContent = sl.value + ' dB';
            debouncedSync();
        };
    });
    // Trigger checkboxes (trigRetrigger, trigHold)
    document.querySelectorAll('.lane-trig-chk input[type="checkbox"]').forEach(function (chk) {
        chk.onchange = function () {
            var bId = parseInt(chk.dataset.b), li = parseInt(chk.dataset.li);
            var b = findBlock(bId); if (!b || !b.lanes[li]) return;
            var field = chk.dataset.lf;
            if (field) b.lanes[li][field] = chk.checked;
            debouncedSync();
        };
    });
    // Free seconds input
    document.querySelectorAll('.lane-hdr-fsec').forEach(function (inp) {
        inp.onchange = function () {
            var bId = parseInt(inp.dataset.b), li = parseInt(inp.dataset.li);
            var b = findBlock(bId); if (!b || !b.lanes[li]) return;
            b.lanes[li].freeSecs = parseFloat(inp.value) || 4;
            laneCanvasSetup(b); // redraw all lanes so overlays recalculate ratio
            debouncedSync();
        };
    });
    // Wire Add Lane buttons (these use .lane-add-btn, not .lane-add-param-btn)
    document.querySelectorAll('.lane-add-curve-btn').forEach(function (btn) {
        btn.onclick = function (e) {
            e.stopPropagation();
            var bId = parseInt(btn.dataset.b);
            var b = findBlock(bId); if (!b) return;
            if (typeof pushUndoSnapshot === 'function') pushUndoSnapshot();
            if (!b.lanes) b.lanes = [];
            b.lanes.push({
                pids: [], color: (typeof LANE_COLORS !== 'undefined' ? LANE_COLORS[b.lanes.length % LANE_COLORS.length] : '#64b4ff'),
                pts: [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }],
                loopLen: '1/1', freeSecs: 4, depth: 100,
                drift: 0, driftRange: 5, warp: 0, steps: 0,
                interp: 'smooth', playMode: 'forward',
                synced: true, muted: false, collapsed: false,
                trigMode: 'loop', trigSource: 'manual',
                trigMidiNote: -1, trigMidiCh: 0,
                trigThreshold: -12, trigAudioSrc: 'main',
                trigRetrigger: true, trigHold: false,
                morphMode: false, morphSnapshots: [],
                _overlayLanes: [], _userCreated: true
            });
            renderSingleBlock(bId); syncBlocksToHost();
        };
    });
    document.querySelectorAll('.lane-add-morph-btn').forEach(function (btn) {
        btn.onclick = function (e) {
            e.stopPropagation();
            var bId = parseInt(btn.dataset.b);
            var b = findBlock(bId); if (!b) return;
            if (typeof pushUndoSnapshot === 'function') pushUndoSnapshot();
            if (!b.lanes) b.lanes = [];
            b.lanes.push({
                pids: [], color: (typeof LANE_COLORS !== 'undefined' ? LANE_COLORS[b.lanes.length % LANE_COLORS.length] : '#64b4ff'),
                pts: [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }],
                loopLen: '1/1', freeSecs: 4, depth: 100,
                drift: 0, driftRange: 5, warp: 0, steps: 0,
                interp: 'smooth', playMode: 'forward',
                synced: true, muted: false, collapsed: false,
                trigMode: 'loop', trigSource: 'manual',
                trigMidiNote: -1, trigMidiCh: 0,
                trigThreshold: -12, trigAudioSrc: 'main',
                trigRetrigger: true, trigHold: false,
                morphMode: true, morphSnapshots: [],
                _overlayLanes: [], _userCreated: true
            });
            renderSingleBlock(bId); syncBlocksToHost();
        };
    });
    // Initialize lane canvases
    blocks.forEach(function (b) {
        if (b.mode === 'lane') laneCanvasSetup(b);
    });


}
function drawWaveform(blockId) {
    var b = findBlock(blockId);
    if (!b || !b.sampleWaveform || !b.sampleWaveform.length) return;
    var cv = document.getElementById('waveCv-' + blockId);
    if (!cv) return;
    var ctx = cv.getContext('2d');
    var w = cv.width, h = cv.height, peaks = b.sampleWaveform;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#AA44FF33';
    ctx.strokeStyle = '#AA44FF';
    ctx.lineWidth = 1;
    ctx.beginPath();
    var step = w / peaks.length;
    for (var i = 0; i < peaks.length; i++) {
        var x = i * step, p = Math.min(1, peaks[i]);
        var barH = p * h;
        ctx.rect(x, h - barH, Math.max(1, step - 0.5), barH);
    }
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (var i = 0; i < peaks.length; i++) {
        var x = i * step, p = Math.min(1, peaks[i]);
        ctx.lineTo(x + step / 2, h - p * h);
    }
    ctx.lineTo(w, h);
    ctx.stroke();
}
function updateAssignBanner() {
    var bn = document.getElementById('assignBanner'), lb = document.getElementById('assignTarget');
    if (assignMode) { var b = findBlock(assignMode); if (!b) { bn.classList.remove('vis'); return; } bn.classList.add('vis'); var col = bColor(b.colorIdx); bn.style.background = col + '22'; bn.style.borderColor = col + '66'; bn.style.color = col; lb.textContent = 'Block ' + (blocks.indexOf(b) + 1) + ' (' + b.mode + ')'; }
    else { bn.classList.remove('vis'); }
}
// ==========================================================
// RANDOMIZE â€” handles all range modes, quantize, smooth glide
// ==========================================================
function randomize(bId) {
    var b = findBlock(bId); if (!b) return;
    var mn = b.rMin / 100, mx = b.rMax / 100;
    // Guard: if Min > Max in absolute mode, swap so randomize stays valid
    if (mn > mx) { var t = mn; mn = mx; mx = t; }
    var isRelative = b.rangeMode === 'relative';
    var startGlideFn = (window.__JUCE__ && window.__JUCE__.backend) ? window.__juceGetNativeFunction('startGlide') : null;

    // Collect all instant param changes into a batch for single IPC call (C4 fix)
    var instantBatch = [];

    b.targets.forEach(function (id) {
        var p = PMap[id]; if (!p || p.lk) return;
        var newVal;
        if (isRelative) {
            // Relative: offset from current value by random amount between Â±[rMin..rMax]
            var offset = mn + Math.random() * (mx - mn); // magnitude in [rMin, rMax]
            var sign = Math.random() < 0.5 ? -1 : 1;
            newVal = p.v + sign * offset;
        } else {
            // Absolute: random between min and max
            newVal = mn + Math.random() * (mx - mn);
        }
        // Quantize
        if (b.quantize && b.qSteps > 1) {
            newVal = Math.round(newVal * (b.qSteps - 1)) / (b.qSteps - 1);
        }
        newVal = Math.max(0, Math.min(1, newVal));

        if (b.movement === 'glide' && b.glideMs > 0) {
            // Send glide to C++ for per-buffer interpolation (no zipper noise)
            if (startGlideFn && p.hostId !== undefined) {
                startGlideFn(p.hostId, p.realIndex, newVal, b.glideMs);
            }
            // Update JS state to target so undo captures correct values
            p.v = newVal;
            _modDirty = true;
        } else {
            // Instant â€” collect for batch
            p.v = newVal;
            _modDirty = true;
            if (p.hostId !== undefined) {
                instantBatch.push({ p: p.hostId, i: p.realIndex, v: newVal });
            }
        }
    });

    // Send all instant changes in a single IPC call (instead of N individual setParam calls)
    if (instantBatch.length > 0 && window.__JUCE__ && window.__JUCE__.backend) {
        var batchFn = window.__juceGetNativeFunction('applyParamBatch');
        if (batchFn) batchFn(JSON.stringify(instantBatch));
    }

    // Update modulation base anchors for any randomized params
    var needSync = false;
    b.targets.forEach(function (id) {
        var p = PMap[id]; if (!p || p.lk) return;
        updateModBases(id, p.v);
        needSync = true;
    });
    if (needSync) syncBlocksToHost();

    // Defer display refresh to next animation frame (L2 fix)
    requestAnimationFrame(function () { refreshParamDisplay(); });
}

// ==========================================================
// REAL-TIME DATA PROCESSING
// ==========================================================

// Clean up all stale data for a PID removed from a block's targets.
// Must be called AFTER b.targets.delete(pid) for every unassign path.
function cleanBlockAfterUnassign(b, pid) {
    // Lane mode: remove PID from all lane.pids and morph snapshot values
    if (b.lanes) {
        for (var li = 0; li < b.lanes.length; li++) {
            var lane = b.lanes[li];
            var idx = lane.pids ? lane.pids.indexOf(pid) : -1;
            if (idx >= 0) lane.pids.splice(idx, 1);
            if (lane.morphSnapshots) {
                for (var si = 0; si < lane.morphSnapshots.length; si++) {
                    delete lane.morphSnapshots[si].values[pid];
                }
            }
        }
    }
    // Clear stale readback so plugin_rack arcs stop showing modulation
    if (b.laneModOutputs) delete b.laneModOutputs[pid];
    // Clean shapes/envelope base caches
    if (b.targetBases) delete b.targetBases[pid];
    if (b.targetRanges) delete b.targetRanges[pid];
    if (b.targetRangeBases) delete b.targetRangeBases[pid];
    // Clean link data
    if (b.linkMin) delete b.linkMin[pid];
    if (b.linkMax) delete b.linkMax[pid];
    if (b.linkBases) delete b.linkBases[pid];
    if (b.linkModOutputs) delete b.linkModOutputs[pid];
    // Clean morph pad snapshot values
    if (b.snapshots) {
        for (var si = 0; si < b.snapshots.length; si++) {
            if (b.snapshots[si].values) delete b.snapshots[si].values[pid];
        }
    }
}
// â”€â”€â”€ Sync logic block state to C++ backend â”€â”€â”€
function syncBlocksToHost() {
    if (typeof markGpDirty === 'function') markGpDirty();
    if (typeof markStateDirty === 'function') markStateDirty();
    if (!(window.__JUCE__ && window.__JUCE__.backend)) return;
    var fn = window.__juceGetNativeFunction('updateBlocks');
    var data = blocks.map(function (b) {
        // Build consistent target lists â€” tList for C++, tIds for snapshot value lookup
        var tList = [], tIds = [];
        b.targets.forEach(function (id) {
            var p = PMap[id];
            if (!p || p.lk) return; // Skip locked params
            tList.push({ hostId: p.hostId, paramIndex: p.realIndex });
            tIds.push(id);
        });
        var obj = {
            id: b.id, mode: b.mode, targets: tList,
            trigger: b.trigger, beatDiv: b.beatDiv,
            midiMode: b.midiMode, midiNote: b.midiNote || 60, midiCC: b.midiCC || 1, midiCh: parseInt(b.midiCh) || 0,
            threshold: b.threshold || -12, audioSrc: b.audioSrc || 'main',
            rMin: b.rMin / 100, rMax: b.rMax / 100,
            rangeMode: (b.mode === 'randomize') ? (b.rangeMode || 'absolute') : 'relative', polarity: b.polarity || 'bipolar',
            quantize: !!b.quantize, qSteps: b.qSteps || 12,
            movement: b.movement || 'instant', glideMs: b.glideMs || 200,
            envAtk: b.envAtk || 10, envRel: b.envRel || 100, envSens: b.envSens || 50, envInvert: !!b.envInvert,
            envFilterMode: b.envFilterMode || 'flat', envFilterFreq: envDialToHz(b.envFilterFreq), envFilterBW: envBwIdxToOct(b.envFilterBW),
            loopMode: b.loopMode || 'loop', sampleSpeed: b.sampleSpeed || 1.0, sampleReverse: !!b.sampleReverse, jumpMode: b.jumpMode || 'restart',
            clockSource: b.clockSource || 'daw', internalBpm: internalBpm,
            enabled: b.enabled !== false
        };
        // Send base values for relative mode (captured at assignment time)
        var bases = [];
        for (var ti = 0; ti < tIds.length; ti++) {
            var base = (b.targetBases && b.targetBases[tIds[ti]] !== undefined)
                ? b.targetBases[tIds[ti]]
                : (PMap[tIds[ti]] ? PMap[tIds[ti]].v : 0.5);
            bases.push(base);
        }
        obj.targetBases = bases;
        if (b.mode === 'morph_pad') {
            obj.snapshots = (b.snapshots || []).map(function (s) {
                var vals = [];
                // Use tIds (same order as tList) so targets[i] aligns with targetValues[i]
                for (var ti = 0; ti < tIds.length; ti++) {
                    // If snapshot has a stored value for this param, use it.
                    // Otherwise fall back to the param's CURRENT value (not 0.5)
                    // so IDW doesn't overwrite newly assigned params with a meaningless default.
                    var fallback = PMap[tIds[ti]] ? PMap[tIds[ti]].v : 0.5;
                    vals.push(s.values && s.values[tIds[ti]] !== undefined ? s.values[tIds[ti]] : fallback);
                }
                return { x: s.x, y: s.y, targetValues: vals };
            });
            obj.playheadX = b.playheadX;
            obj.playheadY = b.playheadY;
            obj.morphMode = b.morphMode || 'manual';
            obj.exploreMode = b.exploreMode || 'wander';
            obj.lfoShape = b.lfoShape || 'circle';
            obj.lfoDepth = (b.lfoDepth != null ? b.lfoDepth : 80) / 100;
            obj.lfoRotation = (b.lfoRotation || 0) / 100;
            obj.morphSpeed = (b.morphSpeed || 50) / 100;
            obj.morphAction = b.morphAction || 'jump';
            obj.stepOrder = b.stepOrder || 'cycle';
            obj.morphSource = b.morphSource || 'midi';
            obj.jitter = (b.jitter || 0) / 100;
            obj.morphGlide = b.morphGlide || 200;
            obj.morphTempoSync = !!b.morphTempoSync;
            obj.morphSyncDiv = b.morphSyncDiv || '1/4';
            obj.snapRadius = (b.snapRadius || 100) / 100;
        }
        if (b.mode === 'shapes' || b.mode === 'shapes_range') {
            obj.shapeType = b.shapeType || 'circle';
            obj.shapeTracking = b.shapeTracking || 'horizontal';
            obj.shapeSize = b.mode === 'shapes_range' ? 1.0 : (b.shapeSize != null ? b.shapeSize : 80) / 100;
            obj.shapeSpin = (b.shapeSpin || 0) / 100;
            obj.shapeSpeed = (b.shapeSpeed || 50) / 100;
            obj.shapeDepth = b.mode === 'shapes_range' ? 1.0 : (b.shapeSize != null ? b.shapeSize : 80) / 200;
            obj.shapeRange = b.mode === 'shapes_range' ? 'relative' : (b.shapeRange || 'relative');
            obj.shapePolarity = b.shapePolarity || 'bipolar';
            obj.shapeTempoSync = !!b.shapeTempoSync;
            obj.shapeSyncDiv = b.shapeSyncDiv || '1/4';
            obj.shapeTrigger = b.shapeTrigger || 'free';
            obj.shapePhaseOffset = (b.shapePhaseOffset || 0) / 360;
        }
        if (b.mode === 'shapes_range') {
            // Send per-param ranges aligned with targets array
            obj.targetRanges = tIds.map(function (pid) {
                return b.targetRanges && b.targetRanges[pid] !== undefined ? b.targetRanges[pid] : 0;
            });
            // Send per-param base values (anchor positions) aligned with targets array
            // Use the JS-stored base (updated on knob drags) as the source of truth
            obj.targetRangeBases = tIds.map(function (pid) {
                return b.targetRangeBases && b.targetRangeBases[pid] !== undefined ? b.targetRangeBases[pid] : (PMap[pid] ? PMap[pid].v : 0.5);
            });
        }
        if (b.mode === 'lane') {
            // Build O(1) lookup from pid → target info (avoids O(n²) linear scan)
            var tIdMap = {};
            for (var ti = 0; ti < tIds.length; ti++) {
                tIdMap[tIds[ti]] = { pluginId: tList[ti].hostId, paramIndex: tList[ti].paramIndex };
            }
            obj.lanes = (b.lanes || []).map(function (lane, li) {
                // Resolve all pids → targets using O(1) map lookup
                var laneTargets = [];
                (lane.pids || []).forEach(function (pid) {
                    var t = tIdMap[pid];
                    if (t) laneTargets.push(t);
                });
                // Morph lanes don't require pids — their params are stored in snapshot values
                // Always send lane data to keep C++ lane indices aligned with JS indices
                // (C++ skips empty lanes in processBlock via hasCurveData/hasMorphData check)
                return {
                    targets: laneTargets,
                    pts: (lane.pts || []).map(function (p) { return { x: p.x, y: p.y }; }),
                    loopLen: lane.loopLen || '1/1',
                    steps: lane.steps || 0,
                    depth: (lane.depth != null ? lane.depth : 100) / 100.0,
                    drift: lane.drift || 0,
                    driftRange: lane.driftRange != null ? lane.driftRange : 5,
                    driftScale: lane.driftScale || '1/1',
                    warp: lane.warp || 0,

                    interp: lane.interp || 'smooth',
                    playMode: lane.playMode || 'forward',
                    freeSecs: lane.freeSecs || 4,
                    synced: lane.synced !== false,
                    muted: !!lane.muted,
                    trigMode: lane.trigMode || 'loop',
                    trigSource: lane.trigSource || 'manual',
                    trigMidiNote: lane.trigMidiNote != null ? lane.trigMidiNote : -1,
                    trigMidiCh: lane.trigMidiCh || 0,
                    trigThreshold: lane.trigThreshold != null ? lane.trigThreshold : -12,
                    trigAudioSrc: lane.trigAudioSrc || 'main',
                    trigRetrigger: lane.trigRetrigger !== false,
                    trigHold: !!lane.trigHold,
                    morphMode: !!lane.morphMode,
                    morphSnapshots: (lane.morphSnapshots || []).map(function (s) {
                        return { position: s.position || 0, hold: s.hold != null ? s.hold : 0.5, curve: s.curve || 0, depth: s.depth != null ? s.depth : 1.0, drift: s.drift || 0, driftRange: s.driftRange != null ? s.driftRange : 5, driftScale: s.driftScale || '', warp: s.warp || 0, steps: s.steps || 0, name: s.name || '', source: s.source || '', values: s.values || {} };
                    })
                };
            });
        }
        if (b.mode === 'link') {
            // Multi-source: send array of { pluginId, paramIndex }
            obj.linkSources = (b.linkSources || []).map(function (s) {
                var src = { pluginId: s.pluginId != null ? s.pluginId : -1, paramIndex: s.paramIndex != null ? s.paramIndex : -1 };
                if (s.pluginId === -2 && s.macroValue != null) src.macroValue = s.macroValue;
                return src;
            });
            obj.linkSmoothMs = b.linkSmoothMs || 0;
            // Send per-target min/max/bases aligned with targets array
            obj.linkMin = tIds.map(function (pid) {
                return b.linkMin && b.linkMin[pid] !== undefined ? b.linkMin[pid] : 0;
            });
            obj.linkMax = tIds.map(function (pid) {
                return b.linkMax && b.linkMax[pid] !== undefined ? b.linkMax[pid] : 100;
            });
            obj.linkBases = tIds.map(function (pid) {
                return b.linkBases && b.linkBases[pid] !== undefined ? b.linkBases[pid] : (PMap[pid] ? PMap[pid].v : 0.5);
            });
        }
        return obj;
    });
    fn(JSON.stringify(data));
    saveUiStateToHost();
}

// Get active morph pad blocks (for context menu submenu)
function getMorphBlocks() {
    var result = [];
    for (var i = 0; i < blocks.length; i++) {
        if (blocks[i].mode === 'morph_pad') result.push({ id: blocks[i].id, idx: i, colorIdx: blocks[i].colorIdx, snapCount: (blocks[i].snapshots || []).length });
    }
    return result;
}

// Add a snapshot to a morph block from a plugin's current param values
// pluginId: which plugin to capture values from (or null for all)
function addSnapshotToMorphBlock(blockId, pluginId) {
    var b = findBlock(blockId);
    if (!b || b.mode !== 'morph_pad') return;
    if (!b.snapshots) b.snapshots = [];
    if (b.snapshots.length >= 12) return;

    // Capture ALL plugin params â€” not just assigned targets.
    // Snapshots are full state captures. You can assign params later
    // and the snapshot will already have their values stored.
    var vals = {};
    for (var pid in PMap) {
        var p = PMap[pid];
        if (p) vals[pid] = p.v;
    }

    // Source label: use the triggering plugin's name
    var sourceName = getPluginName(pluginId) || 'Manual';

    var spos = getSnapSectorPos(b.snapshots.length);
    b.snapshots.push({ x: spos.x, y: spos.y, values: vals, name: 'S' + (b.snapshots.length + 1), source: sourceName });
    renderSingleBlock(blockId);
    syncBlocksToHost();

    // Flash feedback
    var pad = document.querySelector('.morph-pad[data-b="' + blockId + '"]');
    if (pad) { pad.classList.remove('snap-flash'); void pad.offsetWidth; pad.classList.add('snap-flash'); }
    var chips = document.querySelectorAll('.snap-chip[data-b="' + blockId + '"]');
    if (chips.length) { var last = chips[chips.length - 1]; last.classList.add('just-added'); setTimeout(function () { last.classList.remove('just-added'); }, 600); }
}

// Get all morph lanes across all lane blocks (for snap menu)
function getMorphLanes() {
    var result = [];
    for (var i = 0; i < blocks.length; i++) {
        var b = blocks[i];
        if (b.mode !== 'lane' || !b.lanes) continue;
        for (var li = 0; li < b.lanes.length; li++) {
            var lane = b.lanes[li];
            if (!lane.morphMode) continue;
            result.push({
                blockId: b.id, laneIdx: li, blockIdx: i,
                colorIdx: b.colorIdx, laneColor: lane.color,
                snapCount: (lane.morphSnapshots || []).length
            });
        }
    }
    return result;
}

// Add a snapshot to a morph lane from current plugin param values
function addSnapshotToMorphLane(blockId, laneIdx, pluginId) {
    var b = findBlock(blockId);
    if (!b || b.mode !== 'lane' || !b.lanes || !b.lanes[laneIdx]) return;
    var lane = b.lanes[laneIdx];
    if (!lane.morphMode) return;
    if (!lane.morphSnapshots) lane.morphSnapshots = [];

    // Capture param values — only for params assigned to the lane, or all if none assigned
    var vals = {};
    if (lane.pids && lane.pids.length > 0) {
        for (var pi = 0; pi < lane.pids.length; pi++) {
            var p = PMap[lane.pids[pi]];
            if (p) vals[lane.pids[pi]] = p.v;
        }
    } else {
        // No params assigned yet — capture all from this plugin
        for (var pid in PMap) {
            var p = PMap[pid];
            if (p && (pluginId == null || p.hostId === pluginId)) vals[pid] = p.v;
        }
    }

    var n = lane.morphSnapshots.length;
    var position = n === 0 ? 0 : 1; // first=0, rest=1 (will redistribute below)
    var sourceName = (typeof getPluginName === 'function' && pluginId != null) ? (getPluginName(pluginId) || 'Manual') : 'Capture';

    lane.morphSnapshots.push({
        position: position, hold: 0.5, curve: 0,
        name: 'S' + (n + 1), source: sourceName, values: vals
    });

    // Auto-distribute positions evenly
    var total = lane.morphSnapshots.length;
    if (total > 1) {
        for (var si = 0; si < total; si++) {
            lane.morphSnapshots[si].position = si / (total - 1);
        }
    }

    renderSingleBlock(blockId);
    syncBlocksToHost();
}
