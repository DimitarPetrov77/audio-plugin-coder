// ============================================================
// MODULATION MAP — "what modulates what"
// ============================================================
// A patch is only legible one block at a time: each block lists its own targets, but
// nothing shows the whole routing at once. This view inverts the relationship — it lists
// every MODULATED PARAMETER and the blocks driving it, with each assignment's depth.
//
// The thing it shows that nothing else can: parameters driven by MORE THAN ONE block.
// Those fight each other (last writer wins for absolute modulators, offsets accumulate),
// and until now they were invisible.

var _modMapFilter = '';

// Collect every assignment as parameter → [{block, depth}]
function _modMapCollect() {
    var byParam = {};   // pid → { pid, plugName, paramName, drivers: [] }
    if (typeof blocks === 'undefined') return byParam;

    for (var bi = 0; bi < blocks.length; bi++) {
        var b = blocks[bi];
        if (!b.targets) continue;
        b.targets.forEach(function (pid) {
            var p = (typeof PMap !== 'undefined') ? PMap[pid] : null;
            if (!p) return;
            if (!byParam[pid]) {
                byParam[pid] = {
                    pid: pid,
                    plugName: (typeof paramPluginName === 'function') ? paramPluginName(pid) : '',
                    paramName: p.name || pid,
                    locked: !!p.lk,
                    drivers: []
                };
            }
            // Which lane (if any) inside a Lane block carries this param — useful detail
            var laneLabel = '';
            if (b.mode === 'lane' && b.lanes) {
                for (var li = 0; li < b.lanes.length; li++) {
                    if (b.lanes[li].pids && b.lanes[li].pids.indexOf(pid) >= 0) {
                        laneLabel = (b.lanes[li].morphMode ? 'M' : 'L') + (li + 1);
                        break;
                    }
                }
            }
            byParam[pid].drivers.push({
                blockId: b.id,
                blockNum: bi + 1,
                mode: b.mode,
                color: (typeof bColor === 'function') ? bColor(b.colorIdx) : '#888',
                enabled: b.enabled !== false,
                depth: (typeof targetDepthOf === 'function') ? targetDepthOf(b, pid) : 100,
                lane: laneLabel
            });
        });
    }
    return byParam;
}

function renderModMap() {
    var body = document.getElementById('modMapBody');
    var info = document.getElementById('modMapInfo');
    if (!body) return;

    var byParam = _modMapCollect();
    var pids = Object.keys(byParam);

    // Sort: conflicts first (most drivers), then plugin, then parameter name
    pids.sort(function (a, b) {
        var da = byParam[a].drivers.length, db = byParam[b].drivers.length;
        if (da !== db) return db - da;
        var pa = byParam[a].plugName, pb = byParam[b].plugName;
        if (pa !== pb) return pa < pb ? -1 : 1;
        return byParam[a].paramName < byParam[b].paramName ? -1 : 1;
    });

    var filter = _modMapFilter.toLowerCase();
    var conflicts = 0, shown = 0, html = '';

    for (var i = 0; i < pids.length; i++) {
        var e = byParam[pids[i]];
        if (e.drivers.length > 1) conflicts++;

        if (filter) {
            var hay = (e.plugName + ' ' + e.paramName + ' ' + e.drivers.map(function (d) {
                return d.mode + ' ' + d.blockNum;
            }).join(' ')).toLowerCase();
            if (hay.indexOf(filter) < 0) continue;
        }
        shown++;

        var chips = '';
        for (var di = 0; di < e.drivers.length; di++) {
            var d = e.drivers[di];
            var cls = 'mm-chip' + (d.enabled ? '' : ' off');
            chips += '<span class="' + cls + '" data-mmblock="' + d.blockId + '"'
                + ' style="border-color:' + d.color + ';color:' + d.color + '"'
                + ' title="Block ' + d.blockNum + ' (' + d.mode + ')' + (d.enabled ? '' : ' — disabled') + '">'
                + d.blockNum + (d.lane ? ':' + d.lane : '')
                + '<span class="mm-chip-d">' + (d.depth > 0 ? '+' : '') + Math.round(d.depth) + '%</span>'
                + '</span>';
        }

        html += '<div class="mm-row' + (e.drivers.length > 1 ? ' conflict' : '') + '" data-mmpid="' + e.pid + '">'
            + '<span class="mm-plug">' + e.plugName + '</span>'
            + '<span class="mm-param">' + e.paramName + (e.locked ? ' <span class="mm-lock">L</span>' : '') + '</span>'
            + '<span class="mm-chips">' + chips + '</span>'
            + '</div>';
    }

    if (pids.length === 0) {
        html = '<div class="mm-empty">Nothing is modulated yet. Assign parameters to a logic block and they\'ll appear here.</div>';
    } else if (shown === 0) {
        html = '<div class="mm-empty">No matches for "' + _modMapFilter + '".</div>';
    }
    body.innerHTML = html;

    if (info) {
        info.textContent = pids.length + ' param' + (pids.length === 1 ? '' : 's') + ' modulated'
            + (conflicts > 0 ? '  ·  ' + conflicts + ' driven by 2+ blocks' : '');
        info.className = 'modal-footer-info' + (conflicts > 0 ? ' mm-warn' : '');
    }

    // One delegated handler on the body — survives every re-render, and can't be lost
    // the way per-row handlers can if the rows are rebuilt.
    body.onclick = function (ev) {
        var chip = ev.target.closest ? ev.target.closest('.mm-chip') : null;
        if (chip) {
            // Chip → make that block active and reveal it
            ev.stopPropagation();
            var bId = parseInt(chip.getAttribute('data-mmblock'));
            var blk = (typeof findBlock === 'function') ? findBlock(bId) : null;
            if (!blk) return;
            actId = bId;
            blk.expanded = true;
            closeModMap();
            if (typeof renderBlocks === 'function') renderBlocks();
            var card = document.querySelector('.lcard[data-blockid="' + bId + '"]');
            if (card) card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            return;
        }
        var row = ev.target.closest ? ev.target.closest('.mm-row') : null;
        if (!row) return;
        // Row → locate that parameter in the rack
        var pid = row.getAttribute('data-mmpid');
        var pnm = (typeof PMap !== 'undefined' && PMap[pid]) ? PMap[pid].name : pid;
        closeModMap();
        _modMapLocate(pid);
        if (typeof showToast === 'function') showToast('Located "' + pnm + '"', 'info', 1600);
    };
}

// Reveal a parameter in the plugin rack (expand its card, scroll, flash)
function _modMapLocate(pid) {
    var p = (typeof PMap !== 'undefined') ? PMap[pid] : null;
    if (!p) return;
    if (typeof pluginBlocks !== 'undefined') {
        for (var i = 0; i < pluginBlocks.length; i++) {
            if (pluginBlocks[i].id === p.hostId && !pluginBlocks[i].expanded) {
                pluginBlocks[i].expanded = true;
                if (typeof renderAllPlugins === 'function') renderAllPlugins();
                break;
            }
        }
    }
    var attempts = 0;
    (function tryLocate() {
        attempts++;
        if (typeof scrollVirtualToParam === 'function') scrollVirtualToParam(pid);
        var row = document.querySelector('.pr[data-pid="' + pid + '"]');
        if (row) {
            row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            row.classList.remove('touched');
            void row.offsetWidth;
            row.classList.add('touched');
        } else if (attempts < 15) {
            requestAnimationFrame(tryLocate);
        }
    })();
}

function openModMap() {
    var m = document.getElementById('modMapModal');
    if (!m) return;
    _modMapFilter = '';
    var s = document.getElementById('modMapSearch');
    if (s) s.value = '';
    renderModMap();
    m.classList.add('vis');
    if (s) s.focus();
}
function closeModMap() {
    var m = document.getElementById('modMapModal');
    if (m) m.classList.remove('vis');
}

(function wireModMap() {
    function attach() {
        var btn = document.getElementById('modMapBtn');
        if (btn) btn.onclick = function () {
            var m = document.getElementById('modMapModal');
            if (m && m.classList.contains('vis')) closeModMap(); else openModMap();
        };
        var close = document.getElementById('modMapClose');
        if (close) close.onclick = closeModMap;
        var search = document.getElementById('modMapSearch');
        if (search) search.oninput = function () { _modMapFilter = search.value; renderModMap(); };
        var overlay = document.getElementById('modMapModal');
        if (overlay) overlay.onclick = function (e) { if (e.target === overlay) closeModMap(); };
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', attach);
    else attach();
})();
