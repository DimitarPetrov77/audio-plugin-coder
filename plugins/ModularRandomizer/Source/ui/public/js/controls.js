// ============================================================
// UI CONTROLS
// Bypass, mix, scale, auto-locate, add buttons, plugin browser
// ============================================================
// Bypass button — connected to JUCE BYPASS toggle relay
document.getElementById('bypassBtn').onclick = function () {
    this.classList.toggle('on');
    var isOn = this.classList.contains('on');
    document.querySelector('.app').classList.toggle('bypassed', isOn);
    // Send to JUCE backend if available
    if (window.__JUCE__ && window.__JUCE__.getToggleState) {
        try {
            var state = window.__JUCE__.getToggleState('BYPASS');
            if (state) state.setValue(!state.getValue());
        } catch (e) { console.log('Bypass relay not ready'); }
    }
};
// Mix slider — connected to JUCE MIX slider relay
document.getElementById('mixSlider').oninput = function () {
    document.getElementById('mixVal').textContent = this.value + '%';
    // Send to JUCE backend if available
    if (window.__JUCE__ && window.__JUCE__.getSliderState) {
        try {
            var state = window.__JUCE__.getSliderState('MIX');
            if (state) state.setNormalisedValue(this.value / 100.0);
        } catch (e) { console.log('Mix relay not ready'); }
    }
};
// UI Scale — professional: resize JUCE editor window, CSS fills it
var currentScale = 1;
var autoLocate = true;
document.getElementById('scaleSelect').onchange = function () {
    var scale = parseFloat(this.value);
    if (isNaN(scale) || scale < 0.25) scale = 1;
    currentScale = scale;
    if (window.__JUCE__ && window.__JUCE__.backend) {
        var fn = window.__juceGetNativeFunction('setEditorScale');
        fn(scale);
    }
    saveUiStateToHost();
};
function applyScale(scale) {
    currentScale = scale;
    var sel = document.getElementById('scaleSelect');
    for (var i = 0; i < sel.options.length; i++) {
        if (parseFloat(sel.options[i].value) === scale) { sel.selectedIndex = i; break; }
    }
    if (window.__JUCE__ && window.__JUCE__.backend) {
        var fn = window.__juceGetNativeFunction('setEditorScale');
        fn(scale);
    }
}
// Auto-Locate toggle
document.getElementById('autoLocateChk').onchange = function () {
    autoLocate = this.checked;
    saveUiStateToHost();
};
// Internal Tempo BPM input
document.getElementById('internalBpmInput').onchange = function () {
    var v = Math.max(20, Math.min(300, parseInt(this.value) || 120));
    this.value = v;
    internalBpm = v;
    syncBlocksToHost();
    saveUiStateToHost();
};
// Plugin Routing mode toggle (dropdown)
document.getElementById('routingSelect').onchange = function () {
    var mode = parseInt(this.value);
    routingMode = mode;
    this.classList.toggle('weq-active', mode === 2);
    if (window.__JUCE__ && window.__JUCE__.backend) {
        var fn = window.__juceGetNativeFunction('setRoutingMode');
        fn(mode);
    }
    // Show/hide WrongEQ button
    if (typeof weqSetVisible === 'function') weqSetVisible(mode === 2);
    // Sync EQ state to C++ when entering WrongEQ mode
    if (mode === 2 && typeof weqSyncToHost === 'function') weqSyncToHost();
    renderAllPlugins(); saveUiStateToHost();
};
document.getElementById('addRnd').onclick = function () { addBlock('randomize'); };
document.getElementById('addEnv').onclick = function () { addBlock('envelope'); };
document.getElementById('addSmp').onclick = function () { addBlock('sample'); };
document.getElementById('addMorph').onclick = function () { addBlock('morph_pad'); };
document.getElementById('addShapes').onclick = function () { addBlock('shapes'); };
document.getElementById('addShapesRange').onclick = function () { addBlock('shapes_range'); };
document.getElementById('addLane').onclick = function () { addBlock('lane'); };
document.getElementById('addPluginBtn').onclick = function () { openPluginBrowser(); };
document.getElementById('undoBtn').onclick = function () { performUndo(); };
document.getElementById('redoBtn').onclick = function () { performRedo(); };

// Collapse / Expand All Plugins
document.getElementById('collapseAllBtn').onclick = function () {
    pluginBlocks.forEach(function (pb) { pb.expanded = false; });
    renderAllPlugins(); saveUiStateToHost();
};
document.getElementById('expandAllBtn').onclick = function () {
    pluginBlocks.forEach(function (pb) { pb.expanded = true; });
    renderAllPlugins(); saveUiStateToHost();
};

// Plugin loading state — prevent double-clicks
var pluginLoading = false;
function setPluginLoading(isLoading, name) {
    pluginLoading = isLoading;
    var btn = document.getElementById('addPluginBtn');
    if (isLoading) {
        btn.disabled = true;
        btn.textContent = 'Loading...';
        btn.title = 'Loading ' + (name || 'plugin') + '...';
    } else {
        btn.disabled = false;
        btn.textContent = '+ Plugin';
        btn.title = '';
    }
}

// ── Toast notification system ──
// Types: 'success' (green), 'error' (red), 'info' (blue)
// Colors driven by CSS variables for theme support
function showToast(message, type, durationMs) {
    type = type || 'info';
    durationMs = durationMs || 3500;
    var container = document.getElementById('crash-toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'crash-toast-container';
        container.style.cssText = 'position:fixed;top:12px;right:12px;z-index:99999;display:flex;flex-direction:column;gap:8px;pointer-events:none;';
        document.body.appendChild(container);
    }
    var rs = getComputedStyle(document.documentElement);
    var colors = {
        success: {
            bg: rs.getPropertyValue('--toast-success-bg').trim() || 'linear-gradient(135deg,#0a3a1a,#082a10)',
            border: rs.getPropertyValue('--toast-success-border').trim() || '#4a8',
            icon: '✓'
        },
        error: {
            bg: rs.getPropertyValue('--toast-error-bg').trim() || 'linear-gradient(135deg,#4a1010,#2a0808)',
            border: rs.getPropertyValue('--toast-error-border').trim() || '#ff3333',
            icon: '✕'
        },
        info: {
            bg: rs.getPropertyValue('--toast-info-bg').trim() || 'linear-gradient(135deg,#102040,#081828)',
            border: rs.getPropertyValue('--toast-info-border').trim() || '#4a8cff',
            icon: 'ℹ'
        }
    };
    var textColor = rs.getPropertyValue('--toast-text').trim() || '#fff';
    var c = colors[type] || colors.info;
    var toast = document.createElement('div');
    toast.style.cssText = 'pointer-events:auto;background:' + c.bg + ';border:1px solid ' + c.border + ';border-radius:8px;padding:10px 14px;color:' + textColor + ';font-size:12px;font-family:inherit;box-shadow:0 4px 24px rgba(0,0,0,0.4);display:flex;align-items:center;gap:8px;animation:crashSlideIn 0.3s ease-out;max-width:380px;cursor:pointer;';
    toast.innerHTML = '<span style="font-size:16px;opacity:0.9">' + c.icon + '</span><span>' + message + '</span>';
    toast.onclick = function () { dismiss(); };
    container.appendChild(toast);
    function dismiss() {
        toast.style.animation = 'crashSlideOut 0.2s ease-in forwards';
        setTimeout(function () { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 200);
    }
    setTimeout(dismiss, durationMs);
}

// ── Placeholder card for plugin loading ──
function appendPlaceholderCard(placeholderId, plugName) {
    var c = document.getElementById('pluginScroll');
    var card = document.createElement('div');
    card.className = 'pcard pcard-loading';
    card.id = placeholderId;
    card.innerHTML = '<div class="pcard-head"><span class="pcard-name">' + escHtml(plugName) + '</span><span class="pcard-info loading-dots">Loading</span></div>' +
        '<div class="pcard-body"><div class="pcard-loading-bar"><div class="pcard-loading-fill"></div></div></div>';
    c.appendChild(card);
}
function removePlaceholderCard(placeholderId) {
    var el = document.getElementById(placeholderId);
    if (el) el.remove();
}
function showLoadError(plugName, error) {
    showToast('Failed to load ' + plugName + ': ' + (error || 'Unknown error'), 'error', 5000);
}

// ── Keyboard Shortcuts ──
// Use CAPTURE phase so we intercept before WebView2's native handlers
document.addEventListener('keydown', function (e) {
    var tag = e.target.tagName;
    var inInput = (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT');
    var code = e.code || '';
    var key = (e.key || '').toLowerCase();

    // Ctrl+Z — Undo (works even in inputs)
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (key === 'z' || code === 'KeyZ')) {
        e.preventDefault();
        e.stopPropagation();
        // Route to EQ undo when WrongEQ overlay is visible
        var weqOverlay = document.getElementById('weqOverlay');
        if (weqOverlay && weqOverlay.classList.contains('visible') && typeof _weqPerformUndo === 'function') {
            _weqPerformUndo();
        } else {
            performUndo();
        }
        return;
    }
    // Ctrl+Shift+Z — Redo (works even in inputs)
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (key === 'z' || code === 'KeyZ')) {
        e.preventDefault();
        e.stopPropagation();
        var weqOverlay2 = document.getElementById('weqOverlay');
        if (weqOverlay2 && weqOverlay2.classList.contains('visible') && typeof _weqPerformRedo === 'function') {
            _weqPerformRedo();
        } else {
            performRedo();
        }
        return;
    }
    // Ctrl+Y — Redo (alternative, works even in inputs)
    if ((e.ctrlKey || e.metaKey) && (key === 'y' || code === 'KeyY')) {
        e.preventDefault();
        e.stopPropagation();
        var weqOverlay3 = document.getElementById('weqOverlay');
        if (weqOverlay3 && weqOverlay3.classList.contains('visible') && typeof _weqPerformRedo === 'function') {
            _weqPerformRedo();
        } else {
            performRedo();
        }
        return;
    }
    // Ctrl+S — Quick-save global preset (works even in inputs)
    if ((e.ctrlKey || e.metaKey) && (key === 's' || code === 'KeyS')) {
        e.preventDefault();
        e.stopPropagation();
        if (typeof currentGlobalPresetName !== 'undefined' && currentGlobalPresetName) {
            document.getElementById('gpSave').click();
        } else {
            openGlobalPresetBrowser();
        }
        return;
    }

    // Skip remaining shortcuts when typing in inputs
    if (inInput) {
        if (e.key === 'Escape') { e.target.blur(); return; }
        return;
    }
    // Escape — close modals / exit assign mode
    if (e.key === 'Escape') {
        // Close any open modal
        var modals = document.querySelectorAll('.modal-overlay.vis');
        if (modals.length > 0) {
            modals.forEach(function (m) { m.classList.remove('vis'); });
            return;
        }
        // Close context menus
        document.getElementById('ctx').classList.remove('vis');
        document.getElementById('plugCtx').classList.remove('vis');
        // Exit assign mode
        if (assignMode) {
            assignMode = null;
            renderBlocks(); renderAllPlugins();
            return;
        }
        // Clear selection
        if (selectedParams.size > 0) {
            selectedParams.clear();
            renderAllPlugins();
        }
        return;
    }
    // Space — trigger active randomizer block
    if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        if (typeof actId !== 'undefined' && actId !== null) {
            var b = findBlock(actId);
            if (b && b.mode === 'randomize' && b.enabled !== false) {
                var ov = []; b.targets.forEach(function (pid) { var p = PMap[pid]; if (p && !p.lk && !p.alk) ov.push({ id: pid, val: p.v }); });
                randomize(actId);
                if (ov.length) pushMultiParamUndo(ov);
                flashDot('midiD');
            }
        }
        return;
    }
    // Delete -- remove selected params from active block (skip lane mode - handled by lane_module.js)
    if (e.key === 'Delete' || e.key === 'Backspace') {
        if (typeof actId !== 'undefined' && actId !== null) {
            var b = findBlock(actId);
            if (b && b.mode === 'lane') return; // let lane_module.js handle it
        }
        if (selectedParams.size > 0 && typeof actId !== 'undefined' && actId !== null) {
            var b = findBlock(actId);
            if (b) {
                selectedParams.forEach(function (pid) { b.targets.delete(pid); cleanBlockAfterUnassign(b, pid); });
                selectedParams.clear();
                renderAllPlugins(); renderBlocks(); syncBlocksToHost();
            }
        }
        return;
    }
    // Ctrl+A — select all params in assign mode
    if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        if (assignMode) {
            // Select all visible (non-locked) params
            selectedParams.clear();
            pluginBlocks.forEach(function (pb) {
                pb.params.forEach(function (p) {
                    if (!p.lk && !p.alk) selectedParams.add(p.id);
                });
            });
            renderAllPlugins();
        }
        return;
    }
    // R — apply range (existing shortcut, keep it)
    if (e.key === 'r' || e.key === 'R') {
        if (!assignMode) return;
        var b = findBlock(assignMode);
        if (!b || b.mode !== 'shapes_range') return;
        if (selectedParams.size === 0) return;
        e.preventDefault();
        if (!b.targetRanges) b.targetRanges = {};
        if (!b.targetRangeBases) b.targetRangeBases = {};
        selectedParams.forEach(function (pid) {
            var p = PMap[pid];
            if (!p || p.lk) return;
            assignTarget(b, pid);
            b.targetRanges[pid] = 0;
            b.targetRangeBases[pid] = p.v;
        });
        renderAllPlugins(); renderBlocks(); syncBlocksToHost();
    }
}, true); // CAPTURE phase — intercept before WebView2 native handlers
// Plugin browser modal logic
var modalCat = 'all', modalQuery = '';
var _scanPollId = 0;
function doScanPlugins(forceRescan) {
    if (!window.__JUCE__ || !window.__JUCE__.backend || scanInProgress) return;
    scanInProgress = true;

    // Update modal immediately to show scanning state
    renderModalScanningState('', 0);

    // Show scanning indicator in plugin scroll area (for startup scan)
    var ps = document.getElementById('pluginScroll');
    if (ps && pluginBlocks.length === 0 && !document.getElementById('pluginModal').classList.contains('vis')) {
        var scanCard = document.createElement('div');
        scanCard.className = 'pcard pcard-loading';
        scanCard.id = 'startup-scan-indicator';
        scanCard.innerHTML = '<div class="pcard-head"><span class="pcard-name">Scanning Plugins</span>' +
            '<span class="pcard-info loading-dots">Locating</span></div>' +
            '<div class="pcard-body"><div class="pcard-loading-bar"><div class="pcard-loading-fill"></div></div>' +
            '<div id="startup-scan-name" style="padding:4px 10px;font-size:10px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' +
            scanPaths.join(', ') + '</div></div>';
        ps.appendChild(scanCard);
    }

    // Poll for per-plugin progress every 250ms
    if (_scanPollId) clearInterval(_scanPollId);
    var progressFn = window.__juceGetNativeFunction('getScanProgress');
    _scanPollId = setInterval(function () {
        if (!scanInProgress) { clearInterval(_scanPollId); _scanPollId = 0; return; }
        progressFn().then(function (p) {
            if (!p || !scanInProgress) return;
            var name = p.name || '';
            var pct = Math.round((p.progress || 0) * 100);
            // Update modal if visible
            if (document.getElementById('pluginModal').classList.contains('vis')) {
                renderModalScanningState(name, pct);
            }
            // Update startup card if present
            var sn = document.getElementById('startup-scan-name');
            if (sn) sn.textContent = name || 'Scanning...';
            var sf = document.querySelector('#startup-scan-indicator .pcard-loading-fill');
            if (sf) sf.style.width = pct + '%';
        });
    }, 250);

    var scanFn = window.__juceGetNativeFunction('scanPlugins');
    scanFn(scanPaths, !!forceRescan).then(function (result) {
        scanInProgress = false;
        if (_scanPollId) { clearInterval(_scanPollId); _scanPollId = 0; }
        // Remove startup scan indicator
        var si = document.getElementById('startup-scan-indicator');
        if (si) si.remove();

        if (result && result.length) {
            scannedPlugins = result.map(function (p) {
                return { name: p.name || 'Unknown', vendor: p.vendor || '', cat: p.category || 'fx', path: p.path || '', fmt: p.format || 'VST3' };
            });
        } else {
            scannedPlugins = [];
        }
        // Update modal list if browser is open
        if (document.getElementById('pluginModal').classList.contains('vis')) {
            renderModalList();
        }
    });
}
function renderModalScanningState(pluginName, pct) {
    var mInfo = document.getElementById('modalInfo');
    var mBody = document.getElementById('modalBody');
    pct = pct || 0;
    pluginName = pluginName || '';
    // Shorten long paths to just the filename
    if (pluginName.indexOf('/') >= 0 || pluginName.indexOf('\\') >= 0) {
        var parts = pluginName.replace(/\\/g, '/').split('/');
        pluginName = parts[parts.length - 1] || parts[parts.length - 2] || pluginName;
    }
    if (mInfo) mInfo.innerHTML = '<span class="scan-pulse">\u25CF</span> Scanning ' +
        (pct > 0 ? '(' + pct + '%) ' : '') +
        (pluginName ? '<b>' + pluginName + '</b>' : 'plugin directories\u2026');
    if (mBody) mBody.innerHTML = '<div class="scan-indicator">' +
        '<div class="scan-bar"><div class="scan-bar-fill" style="width:' + pct + '%"></div></div>' +
        '<div class="scan-label">' +
        (pluginName ? pluginName : 'Scanning ' + scanPaths.length + ' director' + (scanPaths.length === 1 ? 'y' : 'ies') + '\u2026') +
        '</div>' +
        '<div class="scan-paths">' + scanPaths.map(function (p) {
            var parts = p.replace(/\\/g, '/').split('/');
            return parts[parts.length - 1] || parts[parts.length - 2] || p;
        }).join(' \u00B7 ') + '</div></div>';
}
function openPluginBrowser() {
    modalCat = 'all'; modalQuery = '';
    document.getElementById('modalSearch').value = '';
    document.getElementById('scanPaths').classList.remove('vis');
    renderModalTabs();
    // If scanning, show scanning state; else render list (auto-scan if empty)
    if (scanInProgress) {
        renderModalScanningState();
    } else if (scannedPlugins.length === 0) {
        doScanPlugins();
    } else {
        renderModalList();
    }
    document.getElementById('pluginModal').classList.add('vis');
    document.getElementById('modalSearch').focus();
}
function closePluginBrowser() { document.getElementById('pluginModal').classList.remove('vis'); }
document.getElementById('modalClose').onclick = closePluginBrowser;
document.getElementById('pluginModal').onclick = function (e) { if (e.target === this) closePluginBrowser(); };
document.getElementById('modalSearch').oninput = function () { modalQuery = this.value; if (!scanInProgress) renderModalList(); };
document.getElementById('modalTabs').onclick = function (e) {
    var tab = e.target.closest('.modal-tab'); if (!tab) return;
    modalCat = tab.dataset.cat; renderModalTabs();
    if (scanInProgress) { renderModalScanningState(); } else { renderModalList(); }
};
function renderModalTabs() {
    document.querySelectorAll('.modal-tab').forEach(function (t) {
        t.className = 'modal-tab' + (t.dataset.cat === modalCat ? ' on' : '');
    });
}
function renderModalList() {
    var body = document.getElementById('modalBody');
    // If still scanning, show scanning state
    if (scanInProgress) { renderModalScanningState(); return; }
    var q = modalQuery.toLowerCase();
    var filtered = scannedPlugins.filter(function (p) {
        if (modalCat !== 'all' && p.cat !== modalCat) return false;
        if (q && p.name.toLowerCase().indexOf(q) === -1 && p.vendor.toLowerCase().indexOf(q) === -1) return false;
        return true;
    });
    document.getElementById('modalInfo').textContent = filtered.length + ' plugin' + (filtered.length !== 1 ? 's' : '') + ' found';
    if (filtered.length === 0) { body.innerHTML = '<div class="no-results">No plugins found. Click \u2699 Scan Paths to configure.</div>'; return; }
    var catLabels = { synth: 'Instrument', fx: 'Effect', sampler: 'Sampler', utility: 'Utility' };
    var h = '';
    filtered.forEach(function (p) {
        var initials = p.name.split(' ').map(function (w) { return w[0]; }).join('').substring(0, 2);
        var vendorLine = (p.vendor || '') + (p.fmt && p.fmt !== 'VST3' ? (p.vendor ? ' \u00B7 ' : '') + p.fmt : '');
        h += '<div class="plug-row" data-ppath="' + (p.path || p.name).replace(/"/g, '&quot;') + '">';
        h += '<div class="plug-icon">' + initials + '</div>';
        h += '<div class="plug-info"><div class="plug-name">' + p.name + '</div><div class="plug-meta">' + vendorLine + '</div></div>';
        h += '<span class="plug-type ' + p.cat + '">' + (catLabels[p.cat] || p.cat) + '</span>';
        h += '</div>';
    });
    body.innerHTML = h;
    body.querySelectorAll('.plug-row').forEach(function (row) {
        row.onclick = function () {
            addPlugin(row.dataset.ppath);
            closePluginBrowser();
        };
    });
}
// Scan paths toggle
document.getElementById('scanToggle').onclick = function () {
    var sp = document.getElementById('scanPaths');
    sp.classList.toggle('vis'); renderScanPaths();
    // Also trigger a fresh scan with updated paths
    if (!sp.classList.contains('vis')) {
        scannedPlugins = []; // Clear so next open triggers re-scan
        doScanPlugins();
        saveUiStateToHost();
    }
};
document.getElementById('addScanPath').onclick = function () {
    scanPaths.push(''); renderScanPaths();
};
function renderScanPaths() {
    var c = document.getElementById('scanPathList'); c.innerHTML = '';
    scanPaths.forEach(function (p, i) {
        var row = document.createElement('div'); row.className = 'scan-path-row';
        row.innerHTML = '<input type="text" value="' + p + '" data-spi="' + i + '"><button class="scan-path-rm" data-sprm="' + i + '">&times;</button>';
        c.appendChild(row);
    });
    c.querySelectorAll('input').forEach(function (inp) {
        inp.onchange = function () {
            scanPaths[parseInt(inp.dataset.spi)] = inp.value;
            saveUiStateToHost();
        };
    });
    c.querySelectorAll('[data-sprm]').forEach(function (btn) {
        btn.onclick = function () {
            scanPaths.splice(parseInt(btn.dataset.sprm), 1);
            renderScanPaths();
            saveUiStateToHost();
        };
    });
    // Also render in settings dropdown
    renderSettingsScanPaths();
}
function renderSettingsScanPaths() {
    var c = document.getElementById('settingsScanPathList');
    if (!c) return;
    c.innerHTML = '';
    scanPaths.forEach(function (p, i) {
        var row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:3px;margin-bottom:2px;align-items:center;';
        row.innerHTML = '<input type="text" value="' + escHtml(p) + '" data-sspi="' + i + '" style="flex:1;font-size:10px;padding:2px 4px;' +
            'border:1px solid var(--border);border-radius:3px;background:var(--bg-inset);color:var(--text-primary);min-width:0">' +
            '<button data-ssprm="' + i + '" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:12px;padding:0 2px">&times;</button>';
        c.appendChild(row);
    });
    c.querySelectorAll('input[data-sspi]').forEach(function (inp) {
        inp.onchange = function () {
            scanPaths[parseInt(inp.dataset.sspi)] = inp.value;
            renderScanPaths();
            saveUiStateToHost();
        };
    });
    c.querySelectorAll('[data-ssprm]').forEach(function (btn) {
        btn.onclick = function () {
            scanPaths.splice(parseInt(btn.dataset.ssprm), 1);
            renderScanPaths();
            saveUiStateToHost();
        };
    });
}
document.getElementById('settingsAddPath').onclick = function () {
    scanPaths.push('');
    renderScanPaths();
};
document.getElementById('settingsRescan').onclick = function () {
    scannedPlugins = [];
    doScanPlugins(true); // force=true → clears cache, does full deep scan
    saveUiStateToHost();
    showToast('Rescanning plugin directories (cache cleared)...', 'info', 2000);
};
function flashDot(id) { var d = document.getElementById(id); d.classList.add('on'); setTimeout(function () { d.classList.remove('on'); }, 150); }
function updCounts() { var ap = allParams(); document.getElementById('stP').textContent = ap.length; document.getElementById('stL').textContent = ap.filter(function (p) { return p.lk || p.alk; }).length; document.getElementById('stB').textContent = blocks.length; document.getElementById('blockInfo').textContent = blocks.length + ' blocks'; }
