var _lastBpmDisplay = 0, _bpmThrottle = 0, _lastLocateTime = 0;
var _laneSkipDirty = 0; // frames to silently adopt lane values after visibility restore
var _rtTick = 0; // frame counter for throttling (badge updates etc.)
function processRealTimeData() {
    // Clear consumed MIDI events
    rtData.midi = [];

    // Update live BPM display (~4 Hz throttle)
    if (++_bpmThrottle >= 15) {
        _bpmThrottle = 0;
        var bpm = Math.round(rtData.bpm || 0);
        if (bpm !== _lastBpmDisplay) {
            _lastBpmDisplay = bpm;
            var el = document.getElementById('bpmDisplay');
            if (el) el.textContent = (bpm > 0 ? bpm : '\u2014') + ' BPM';
        }
    }

    // Decrement skip-dirty counter (set by visibilitychange handler)
    if (_laneSkipDirty > 0) _laneSkipDirty--;
    _rtTick++;

    // Update lane param value badges (selected-only for curve, sliding for morph)
    // Curve: only the selected param has a live badge → O(1) per lane
    // Morph: sliding window max 20 per tick for 2000-param safety
    if ((_rtTick % 3) === 0 && typeof blocks !== 'undefined') {
        for (var bi = 0; bi < blocks.length; bi++) {
            var blk = blocks[bi];
            if (!blk || blk.mode !== 'lane' || !blk.lanes) continue;
            for (var lii = 0; lii < blk.lanes.length; lii++) {
                var ln = blk.lanes[lii];
                if (!ln || !ln.pids || ln.collapsed) continue;
                if (ln._selectedParamIdx == null || ln._selectedParamIdx < 0) continue;
                var selPid = ln.pids[ln._selectedParamIdx];
                if (!selPid) continue;
                var cp = PMap[selPid];
                var ctxt = cp && cp.disp ? cp.disp : (cp ? (cp.v * 100).toFixed(0) + '%' : '');
                var prefix = ln.morphMode ? 'mpvb-' : 'cpvb-';
                var cbdg = document.getElementById(prefix + blk.id + '-' + lii);
                if (cbdg && cbdg.textContent !== ctxt) cbdg.textContent = ctxt;
            }
        }
        // Link block source sliders: sync slider position from PMap
        for (var lbi = 0; lbi < blocks.length; lbi++) {
            var lb = blocks[lbi];
            if (!lb || lb.mode !== 'link' || !lb.expanded) continue;
            // Source sliders
            if (lb.linkSources) {
                for (var lsi = 0; lsi < lb.linkSources.length; lsi++) {
                    var ls = lb.linkSources[lsi];
                    if (ls.pluginId < 0) continue; // skip macro sources
                    var lsPid = ls.pluginId + ':' + ls.paramIndex;
                    var lsP = PMap[lsPid];
                    if (!lsP) continue;
                    var lsSl = document.getElementById('linkSrcSlider-' + lb.id + '-' + lsi);
                    if (lsSl && !lsSl._dragging) {
                        var newPct = Math.round(lsP.v * 100);
                        if (parseInt(lsSl.value) !== newPct) lsSl.value = newPct;
                    }
                    var lsVl = document.getElementById('linkSrcVal-' + lb.id + '-' + lsi);
                    if (lsVl) {
                        var lsTxt = lsP.disp || (Math.round(lsP.v * 100) + '%');
                        if (lsVl.textContent !== lsTxt) lsVl.textContent = lsTxt;
                    }
                }
            }
            // Target live value badges
            if (lb.targets) {
                lb.targets.forEach(function (ltPid) {
                    var ltP = PMap[ltPid];
                    if (!ltP) return;
                    var ltEl = document.getElementById('linkTgtLive-' + lb.id + '-' + ltPid.replace(':', '_'));
                    if (ltEl) {
                        var ltTxt = ltP.disp || Math.round((ltP.v || 0) * 100) + '%';
                        if (ltEl.textContent !== ltTxt) ltEl.textContent = ltTxt;
                    }
                });
            }
        }
    }

    requestAnimationFrame(processRealTimeData);
}

// _modDirty: boolean flag for continuous modulation (avoids O(n) Set.add loops)
var _modDirty = false;
// Params currently being dragged via our UI knobs — skip polling updates
var _touchedByUI = new Set();
// Cached visible PIDs — rebuilt at most every 100ms to avoid layout reflows
var _visPidsCache = null, _visPidsTime = 0, _visPidsDirty = true;
var _setVisFn = null; // lazy ref to setVisibleParams native function

// Shared visible-pids-cache rebuild — called by both refreshParamDisplay and lane processing
function _rebuildVisPids() {
    var now = Date.now();
    if (_visPidsCache && !_visPidsDirty && now - _visPidsTime <= 100) return;
    _visPidsDirty = false;
    _visPidsTime = now;
    _visPidsCache = new Set();
    if (typeof pluginBlocks !== 'undefined') {
        for (var pi = 0; pi < pluginBlocks.length; pi++) {
            var pb = pluginBlocks[pi];
            if (!pb.expanded) continue;
            var container = document.querySelector('[data-plugparams="' + pb.id + '"]');
            if (!container) continue;
            if (container._vScroll) {
                for (var ci = 0; ci < container.children.length; ci++) {
                    var cpid = container.children[ci].getAttribute('data-pid');
                    if (cpid) _visPidsCache.add(cpid);
                }
            } else {
                var st = container.scrollTop, ch = container.clientHeight;
                if (ch > 0) {
                    for (var ci = 0; ci < container.children.length; ci++) {
                        var child = container.children[ci];
                        if (child.offsetHeight === 0) continue;
                        var ot = child.offsetTop;
                        if (ot + child.offsetHeight < st) continue;
                        if (ot > st + ch) break;
                        var cpid = child.getAttribute('data-pid');
                        if (cpid) _visPidsCache.add(cpid);
                    }
                }
            }
        }
    }
    // Notify C++ about visible PIDs so Tier 1 only polls params on screen
    if (_visPidsCache.size > 0 && window.__JUCE__ && window.__JUCE__.backend) {
        if (!_setVisFn) _setVisFn = window.__juceGetNativeFunction('setVisibleParams');
        if (_setVisFn) _setVisFn(Array.from(_visPidsCache));
    }
}

function refreshParamDisplay() {
    // Always update ALL visible params — unconditionally.
    // With ~8 visible params this costs <0.5ms. No micro-optimizations.
    // Any conditional gating here causes modulated params to silently stop updating.
    _modDirty = false;

    // Pre-compute shapes_range info for arc display (assign-mode only)
    var srBlk = null, srCol = '';
    if (assignMode) {
        var ab = findBlock(assignMode);
        if (ab && ab.mode === 'shapes_range') {
            srBlk = ab;
            srCol = bColor(ab.colorIdx);
        }
    }

    // ── Build the set of PIDs that are actually visible on screen ──
    _rebuildVisPids();
    var _visPids = _visPidsCache;

    // ── Update only visible dirty params ──
    // Iterate the VISIBLE set (tiny, ~8 params) and check if dirty,
    // not the dirty set (potentially 2000+) checking if visible.
    // For non-visible PIDs: PMap is already updated, so when they scroll into
    // view or card expands, dirtyPluginParams() will repaint them.
    _visPids.forEach(function (pid) {

        var p = PMap[pid];
        if (!p) return;

        var row = document.querySelector('.pr[data-pid="' + pid + '"]');
        if (!row) return;

        // Determine if this param is modulated
        var ri = null;
        var isModulated = false;
        if (srBlk && srBlk.targets.has(pid)) {
            var rng = srBlk.targetRanges && srBlk.targetRanges[pid] !== undefined ? srBlk.targetRanges[pid] : 0;
            var base = srBlk.targetRangeBases && srBlk.targetRangeBases[pid] !== undefined ? srBlk.targetRangeBases[pid] : p.v;
            ri = { range: rng, base: base, color: srCol, polarity: srBlk.shapePolarity || 'bipolar' };
        } else if (!srBlk) {
            ri = getModArcInfo(pid);
            if (ri) {
                isModulated = true;
                var cur = computeModCurrent(ri, p.v);
                if (cur !== null) ri.current = cur;
            }
        }

        // For non-modulated params being dragged, skip visual updates entirely
        if (_touchedByUI.has(pid) && !isModulated) return;

        // Update value text (skip for modulated params being dragged — drag handler does it)
        if (!_touchedByUI.has(pid)) {
            var ve = row.querySelector('.pr-val');
            if (ve) ve.textContent = p.disp || ((p.v * 100).toFixed(0) + '%');
        }

        // Update knob SVG — skip if nothing visual changed (cache key check)
        var knobEl = row.querySelector('.pr-knob');
        if (knobEl && typeof buildParamKnob === 'function') {
            var knobVal = (ri && ri.base !== undefined) ? ri.base : p.v;
            // Build a cheap cache key from ALL values that affect the SVG output
            var knobKey = knobVal.toFixed(4) + '|' + p.v.toFixed(4);
            if (ri) {
                knobKey += '|' + (ri.range || 0).toFixed(3)
                         + '|' + (ri.current !== undefined ? ri.current.toFixed(3) : 'x')
                         + '|' + (ri.color || '')
                         + '|' + (ri.polarity || '');
            }
            if (knobEl._knobKey !== knobKey) {
                knobEl._knobKey = knobKey;
                knobEl.innerHTML = buildParamKnob(knobVal, 30, ri);
            }
        }

        // Update bar (skip for modulated during drag)
        if (!_touchedByUI.has(pid)) {
            var be = row.querySelector('.pr-bar-f');
            if (be) be.style.width = (p.v * 100) + '%';
        }
    });
}

// Listen for real-time data from C++ backend
function setupRtDataListener() {
    if (window.__JUCE__ && window.__JUCE__.backend) {
        window.__JUCE__.backend.addEventListener('__rt_data__', function (data) {
            if (data) {
                rtData.rms = data.rms || 0;
                rtData.scRms = data.scRms || 0;
                rtData.bpm = data.bpm || 120;
                rtData.playing = data.playing || false;
                rtData.ppq = data.ppq || 0;
                // Sync actual sample rate from C++ for EQ curve accuracy
                if (data.sr && data.sr > 0 && typeof _WEQ_REF_FS !== 'undefined')
                    _WEQ_REF_FS = data.sr;
                if (data.spectrum && data.spectrum.length && typeof weqSetSpectrum === 'function') {
                    weqSetSpectrum(data.spectrum);
                }
                if (data.midi && data.midi.length) {
                    rtData.midi = rtData.midi.concat(data.midi);
                }

                // Envelope follower levels from C++ (visual display)
                if (data.envLevels && data.envLevels.length) {
                    for (var ei = 0; ei < data.envLevels.length; ei++) {
                        var en = data.envLevels[ei];
                        var cl = Math.max(0, Math.min(1, en.level));
                        var pct = (cl * 100);
                        // Store readback on block for arc animation (like shapeModOutput)
                        var eb = findBlock(en.id);
                        if (eb && eb.mode === 'envelope') {
                            eb.envModOutput = cl;
                            // Mark targets dirty so arcs keep animating
                            if (eb.targets && eb.targets.size > 0) _modDirty = true;
                        }
                        // Link blocks also report via envLevels — store source value for arc animation
                        if (eb && eb.mode === 'link') {
                            eb.linkSourceValue = cl;
                            if (!eb.linkModOutputs) eb.linkModOutputs = {};
                            if (eb.targets && eb.targets.size > 0) {
                                // Store the source value per target (unipolar 0..1)
                                // The arc system uses this + depth (half-range) to draw offset from base
                                eb.targets.forEach(function (pid) {
                                    eb.linkModOutputs[pid] = cl;
                                });
                                _modDirty = true;
                            }
                        }
                        // Fill bar — direct set, no CSS transition
                        var fl = document.getElementById('envFill-' + en.id);
                        if (fl) fl.style.height = pct + '%';
                        // Label
                        var lb = document.getElementById('envLbl-' + en.id);
                        if (lb) lb.textContent = pct.toFixed(0) + '%';
                        // Peak hold line — jumps up instantly, decays slowly via CSS transition
                        var pk = document.getElementById('envPeak-' + en.id);
                        if (pk) {
                            var curPeak = parseFloat(pk._peak || 0);
                            if (pct >= curPeak) {
                                // New peak — snap up instantly (disable transition momentarily)
                                pk.style.transition = 'none';
                                pk.style.bottom = pct + '%';
                                pk.style.opacity = '0.9';
                                pk._peak = pct;
                                pk._peakTime = Date.now();
                                // Force reflow then re-enable transition for decay
                                void pk.offsetWidth;
                                pk.style.transition = 'bottom 1.2s ease-out, opacity 1.5s ease-out';
                            } else if (Date.now() - (pk._peakTime || 0) > 300) {
                                // Hold for 300ms then start decay
                                pk._peak = pct;
                                pk.style.bottom = pct + '%';
                                pk.style.opacity = '0.3';
                            }
                        }
                        // Active dot — brightness driven by actual level
                        var dot = document.getElementById('envDot-' + en.id);
                        if (dot) dot.style.opacity = (0.3 + cl * 0.7).toFixed(2);
                    }
                }

                // Sample playhead positions from C++
                if (data.sampleHeads && data.sampleHeads.length) {
                    for (var si = 0; si < data.sampleHeads.length; si++) {
                        var sh = data.sampleHeads[si];
                        var head = document.getElementById('waveHead-' + sh.id);
                        if (head) {
                            // Use cached parent width to avoid layout reflow every frame
                            if (!head._pw) {
                                var cv = document.getElementById('waveCv-' + sh.id);
                                head._pw = cv ? cv.width : 260;
                            }
                            head.style.transform = 'translateX(' + (sh.pos * head._pw).toFixed(1) + 'px)';
                        }
                    }
                }

                // Trigger fire events from C++ (visual flash + undo snapshot)
                if (data.trigFired && data.trigFired.length) {
                    // Capture old values of affected params before they're updated
                    var oldVals = [];
                    data.trigFired.forEach(function (tf) {
                        var blk = findBlock(tf.id || tf);
                        if (blk && blk.targets) {
                            blk.targets.forEach(function (pid) {
                                var p = PMap[pid];
                                if (p && !p.lk && !p.alk) oldVals.push({ id: pid, val: p.v });
                            });
                        }
                    });
                    if (oldVals.length) pushMultiParamUndo(oldVals);
                    data.trigFired.forEach(function () { flashDot('midiD'); });

                    // ── WrongEQ trigger randomization is now handled by C++ ──
                    // C++ setParamDirect(-100, ...) writes directly to eqPoints atomics.
                    // weqReadback pushes updated values back to JS for canvas sync.
                }

                // Sync hosted plugin parameter values into PMap
                // C++ is the single source of truth for all param values
                if (data.params && data.params.length) {
                    for (var i = 0; i < data.params.length; i++) {
                        var up = data.params[i];
                        var p = PMap[up.id];
                        if (!p) continue;
                        var isTouched = _touchedByUI.has(up.id);
                        // Skip VALUE update for params being dragged (prevents snapping)
                        // but always accept display text so we show real values during drag
                        if (!isTouched && Math.abs(p.v - up.v) > 0.001) {
                            p.v = up.v;
                            _modDirty = true;
                        }
                        // Always sync display text from C++ (plugin is source of truth)
                        if (up.disp !== undefined && up.disp !== p.disp) {
                            p.disp = up.disp;
                            _modDirty = true;
                        }
                    }
                    // Do NOT call refreshParamDisplay here — lane/morph processing
                    // below also sets _modDirty. One refresh at end of tick.
                }

                // Auto-locate: scroll to and flash the touched param
                if (autoLocate && data.touchedParam && !assignMode) {
                    var pid = data.touchedParam;
                    var now = Date.now();
                    if (now - _lastLocateTime > 200) {
                        _lastLocateTime = now;
                        // Ensure the plugin card containing this param is expanded
                        var pp = PMap[pid];
                        if (pp) {
                            for (var pbi = 0; pbi < pluginBlocks.length; pbi++) {
                                var pb = pluginBlocks[pbi];
                                if (pb.id === pp.hostId && !pb.expanded) {
                                    pb.expanded = true;
                                    renderAllPlugins();
                                    break;
                                }
                            }
                        }
                        // Find the row and scroll + flash
                        var row = document.querySelector('.pr[data-pid="' + pid + '"]');
                        if (!row && typeof scrollVirtualToParam === 'function') {
                            // Row not in DOM — virtual scroll; scroll to it first
                            scrollVirtualToParam(pid);
                            row = document.querySelector('.pr[data-pid="' + pid + '"]');
                        }
                        if (row) {
                            row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                            row.classList.remove('touched');
                            void row.offsetWidth; // force reflow to restart animation
                            row.classList.add('touched');
                        }
                    }
                }
                // Morph pad playhead readback
                if (data.morphHeads) {
                    for (var mi = 0; mi < data.morphHeads.length; mi++) {
                        var mh = data.morphHeads[mi];
                        var mb = findBlock(mh.id);
                        if (mb && mb.mode === 'morph_pad' && mb.morphMode !== 'manual') {
                            mb.playheadX = mh.x;
                            mb.playheadY = mh.y;
                            var dot = document.getElementById('morphHead-' + mh.id);
                            if (dot) {
                                dot.style.left = (mh.x * 100) + '%';
                                dot.style.top = ((1 - mh.y) * 100) + '%';
                            }
                            // Sync SVG rotation with actual C++ rotation angle
                            if (mh.rot !== undefined) {
                                var svg = document.querySelector('.morph-pad[data-b="' + mh.id + '"]:not(.shapes-pad) .lfo-path-svg');
                                if (svg) {
                                    var deg = (mh.rot * 180 / Math.PI) * -1;
                                    svg.style.transform = 'rotate(' + deg.toFixed(1) + 'deg)';
                                }
                            }
                            // ── IDW interpolation for arc animation (VISIBLE params only) ──
                            // Skip if playhead hasn't moved
                            var lastMpX = mb._lastMorphPadX, lastMpY = mb._lastMorphPadY;
                            if (lastMpX === undefined || Math.abs(mh.x - lastMpX) > 0.0001 || Math.abs(mh.y - lastMpY) > 0.0001) {
                                mb._lastMorphPadX = mh.x;
                                mb._lastMorphPadY = mh.y;
                                if (mb.snapshots && mb.snapshots.length > 0 && mb.targets && mb.targets.size > 0) {
                                    if (!mb.morphPadOutputs) mb.morphPadOutputs = {};
                                    // Compute IDW weights (same algorithm as C++)
                                    var radius = (mb.snapRadius != null ? mb.snapRadius : 100) / 100.0 * 0.48;
                                    var numSnaps = Math.min(mb.snapshots.length, 12);
                                    var mpWeights = [];
                                    var mpTotalW = 0;
                                    for (var si = 0; si < numSnaps; si++) {
                                        var sdx = mh.x - mb.snapshots[si].x;
                                        var sdy = mh.y - mb.snapshots[si].y;
                                        var dist = Math.sqrt(sdx * sdx + sdy * sdy);
                                        var w = 0;
                                        if (dist < radius) {
                                            var t = 1.0 - dist / radius;
                                            w = t * t;
                                        }
                                        mpWeights.push(w);
                                        mpTotalW += w;
                                    }
                                    if (mpTotalW > 0) {
                                        for (var si = 0; si < numSnaps; si++) mpWeights[si] /= mpTotalW;
                                        // Only compute for VISIBLE params
                                        _rebuildVisPids();
                                        if (_visPidsCache && _visPidsCache.size > 0) {
                                            _visPidsCache.forEach(function (pid) {
                                                if (!mb.targets.has(pid)) return;
                                                var mixed = 0;
                                                for (var si = 0; si < numSnaps; si++) {
                                                    var sv = mb.snapshots[si].values && mb.snapshots[si].values[pid];
                                                    if (sv !== undefined) mixed += mpWeights[si] * sv;
                                                }
                                                mb.morphPadOutputs[pid] = Math.max(0, Math.min(1, mixed));
                                            });
                                            _modDirty = true;
                                        }
                                    }
                                }
                            }
                        }
                        // Shapes block dot + SVG rotation + readout line
                        if (mb && (mb.mode === 'shapes' || mb.mode === 'shapes_range')) {
                            if (mh.out !== undefined) {
                                mb.shapeModOutput = mh.out;
                                // Mark all targets dirty so fill arc updates every frame
                                // (refreshParamDisplay filters by visibility internally)
                                if (mb.targets && mb.targets.size > 0) _modDirty = true;
                            }
                            var dot = document.getElementById('shapeHead-' + mh.id);
                            if (dot) {
                                dot.style.left = (mh.x * 100) + '%';
                                dot.style.top = ((1 - mh.y) * 100) + '%';
                            }
                            if (mh.rot !== undefined) {
                                var svg = document.querySelector('.shapes-pad[data-b="' + mh.id + '"] .lfo-path-svg');
                                if (svg) {
                                    var deg = (mh.rot * 180 / Math.PI) * -1;
                                    svg.style.transform = 'rotate(' + deg.toFixed(1) + 'deg)';
                                }
                            }
                            // Update readout line position
                            var readout = document.getElementById('shapeReadout-' + mh.id);
                            if (readout) {
                                var tracking = mb.shapeTracking || 'horizontal';
                                if (tracking === 'horizontal') {
                                    readout.style.left = (mh.x * 100) + '%';
                                } else if (tracking === 'vertical') {
                                    readout.style.top = ((1 - mh.y) * 100) + '%';
                                } else {
                                    // Distance: circle radius = distance from center
                                    var ddx = mh.x - 0.5, ddy = mh.y - 0.5;
                                    var dist = Math.sqrt(ddx * ddx + ddy * ddy) * 2; // diameter as fraction
                                    var pxSize = dist * 200; // pad is 200px
                                    readout.style.width = pxSize + 'px';
                                    readout.style.height = pxSize + 'px';
                                }
                            }
                        }
                    }
                }
                if (data.laneHeads) {
                    // Ensure visible-pids cache is fresh for lane interpolation
                    _rebuildVisPids();
                    for (var li = 0; li < data.laneHeads.length; li++) {
                        var lh = data.laneHeads[li];
                        var ph = document.getElementById('lph-' + lh.id + '-' + lh.li);
                        if (ph) {
                            // Cache parent width to avoid layout reflow every frame
                            if (!ph._wPx) {
                                var wrap = ph.parentElement;
                                ph._wPx = wrap ? wrap.clientWidth : 300;
                            }
                            ph.style.transform = 'translateX(' + (lh.ph * ph._wPx) + 'px)';
                        }
                        var vi = document.getElementById('lvi-' + lh.id + '-' + lh.li);
                        if (vi) vi.style.height = (lh.val * 100) + '%';
                        // Oneshot idle state: dim canvas when not active
                        var cwrap = document.getElementById('lcw-' + lh.id + '-' + lh.li);
                        if (cwrap) {
                            var isActive = lh.act !== false;
                            var lnbChk = findBlock(lh.id);
                            var isOneshot = lnbChk && lnbChk.lanes && lnbChk.lanes[lh.li] && lnbChk.lanes[lh.li].trigMode === 'oneshot';
                            if (isOneshot) {
                                cwrap.style.opacity = isActive ? '1' : '0.4';
                                if (ph) ph.style.opacity = isActive ? '1' : '0.3';
                            } else if (cwrap.style.opacity !== '') {
                                cwrap.style.opacity = '';
                                if (ph) ph.style.opacity = '';
                            }
                        }
                        // Store readback on block for arc animation (per-PID)
                        var lnb = lnbChk || findBlock(lh.id);
                        if (lnb && lnb.mode === 'lane' && lnb.lanes && lnb.lanes[lh.li]) {
                            var lane = lnb.lanes[lh.li];
                            // Store playhead position for overlay dynamic window
                            lane._phPos = lh.ph;
                            if (!lnb.laneModOutputs) lnb.laneModOutputs = {};
                            if (lane.pids) {
                                if (lane.morphMode && lane.morphSnapshots && lane.morphSnapshots.length >= 2) {
                                    // Skip if playhead hasn't moved (hold zone / static)
                                    var lastPh = lane._lastMorphPh;
                                    if (lastPh !== undefined && Math.abs(lh.ph - lastPh) < 0.0001) {
                                        // No movement — skip the full 2000-param interpolation loop
                                    } else {
                                        lane._lastMorphPh = lh.ph;
                                        // MORPH LANE: compute per-param interpolated values
                                        var snaps = lane.morphSnapshots;
                                        var pos = lh.ph;
                                        var ld = (lane.depth != null ? lane.depth : 100) / 100.0;
                                        // Find bracketing snapshots
                                        var idx = snaps.length - 2;
                                        for (var si = 0; si < snaps.length - 1; si++) {
                                            if (pos <= snaps[si + 1].position) { idx = si; break; }
                                        }
                                        var snapA = snaps[idx], snapB = snaps[idx + 1];
                                        var gap = snapB.position - snapA.position;
                                        var blend = 0.0;
                                        if (gap > 0.0001) {
                                            var holdA = gap * ((snapA.hold != null ? snapA.hold : 0.5) * 0.5);
                                            var holdB = gap * ((snapB.hold != null ? snapB.hold : 0.5) * 0.5);
                                            var morphZone = gap - holdA - holdB;
                                            if (morphZone < 0) { holdA = gap * 0.5; holdB = gap * 0.5; morphZone = 0; }
                                            var localPh = pos - snapA.position;
                                            if (localPh <= holdA) blend = 0.0;
                                            else if (localPh >= gap - holdB) blend = 1.0;
                                            else {
                                                blend = (localPh - holdA) / Math.max(0.0001, morphZone);
                                                // Apply per-snapshot transition curve (destination defines arrival shape)
                                                var curve = snapB.curve || 0;
                                                if (curve === 0) blend = 0.5 - 0.5 * Math.cos(blend * Math.PI); // smooth
                                                else if (curve === 2) blend = blend * blend; // sharp (ease-in)
                                                else if (curve === 3) blend = 1 - (1 - blend) * (1 - blend); // late (ease-out)
                                                // curve 1 = linear, no change
                                            }
                                        }
                                        // Only interpolate VISIBLE pids — the rest are handled by C++ audio thread.
                                        // laneModOutputs is only read by getModArcInfo() for visible params.
                                        var _anyChanged = false;
                                        if (_visPidsCache && _visPidsCache.size > 0) {
                                            _visPidsCache.forEach(function (pid) {
                                                // Skip pids not in this lane
                                                var vA = snapA.values[pid], vB = snapB.values[pid];
                                                if (vA === undefined) return;
                                                if (vB !== undefined) {
                                                    var morphed = vA + (vB - vA) * blend;
                                                    var sDepth = snapB.depth != null ? snapB.depth : 1.0;
                                                    morphed = 0.5 + (morphed - 0.5) * sDepth;
                                                    var sWarp = snapB.warp || 0;
                                                    if (Math.abs(sWarp) > 0.5) {
                                                        var w = sWarp * 0.01;
                                                        if (w > 0) {
                                                            var t = Math.tanh(w * 3 * (morphed * 2 - 1));
                                                            morphed = 0.5 + 0.5 * t / Math.tanh(w * 3);
                                                        } else {
                                                            var aw = -w;
                                                            var centered = morphed * 2 - 1;
                                                            var sign = centered >= 0 ? 1 : -1;
                                                            morphed = 0.5 + 0.5 * sign * Math.pow(Math.abs(centered), 1 / (1 + aw * 3));
                                                        }
                                                    }
                                                    var sSteps = snapB.steps || 0;
                                                    if (sSteps >= 2) {
                                                        morphed = Math.round(morphed * (sSteps - 1)) / (sSteps - 1);
                                                    }
                                                    lnb.laneModOutputs[pid] = Math.max(0, Math.min(1, morphed));
                                                    _anyChanged = true;
                                                } else {
                                                    lnb.laneModOutputs[pid] = Math.max(0, Math.min(1, 0.5 + (vA - 0.5) * ld));
                                                    _anyChanged = true;
                                                }
                                            });
                                        }
                                        if (_anyChanged && !_laneSkipDirty) _modDirty = true;
                                    } // end else (playhead moved)
                                } else {
                                    // CURVE LANE: only update visible params
                                    var _curveChanged = false;
                                    if (_visPidsCache && _visPidsCache.size > 0) {
                                        _visPidsCache.forEach(function (cpid) {
                                            if (lnb.laneModOutputs[cpid] !== lh.val) {
                                                lnb.laneModOutputs[cpid] = lh.val;
                                                _curveChanged = true;
                                            }
                                        });
                                    }
                                    if (_curveChanged && !_laneSkipDirty) _modDirty = true;
                                }
                            }
                            // Dynamic overlay: if any other lane overlays this one
                            // and ratio < 1, check if we entered a new segment
                            for (var oi = 0; oi < lnb.lanes.length; oi++) {
                                if (oi === lh.li) continue;
                                var ol = lnb.lanes[oi];
                                if (!ol._overlayLanes || ol._overlayLanes.indexOf(lh.li) < 0) continue;
                                var ratio = laneLoopBeats(ol) / laneLoopBeats(lane);
                                if (ratio >= 1) continue; // tiling doesn't need dynamic update
                                // Check if segment changed
                                var seg = Math.floor(lh.ph / ratio);
                                if (seg !== (lane._lastOverlaySeg || 0)) {
                                    lane._lastOverlaySeg = seg;
                                    if (!ol.collapsed) laneDrawCanvas(lnb, oi);
                                }
                            }
                        }
                    }
                }
                // ── WrongEQ modulation is now handled at audio rate by C++ ──
                // C++ setParamDirect(-100, band*4+field, normValue) writes directly to eqPoints atomics.
                // The weqReadback mechanism below syncs C++ values back to JS for canvas display.

                // ── WrongEQ readback: sync C++ eqPoints to JS wrongEqPoints ──
                if (data.weqReadback && data.weqReadback.length && typeof wrongEqPoints !== 'undefined') {
                    var _weqRbChanged = false;
                    for (var wi = 0; wi < data.weqReadback.length && wi < wrongEqPoints.length; wi++) {
                        var rb = data.weqReadback[wi];
                        var pt = wrongEqPoints[wi];
                        // Update JS point position from C++ freq/gain
                        if (typeof weqFreqToX === 'function') {
                            var newX = weqFreqToX(rb.freq);
                            if (Math.abs(pt.x - newX) > 0.0001) {
                                pt.x = newX;
                                _weqRbChanged = true;
                            }
                        }
                        if (typeof weqDBtoY === 'function') {
                            var newY = weqDBtoY(rb.gain);
                            if (Math.abs(pt.y - newY) > 0.001) {
                                pt.y = newY;
                                _weqRbChanged = true;
                            }
                        }
                        if (rb.q !== undefined && Math.abs((pt.q || 0.707) - rb.q) > 0.001) {
                            pt.q = rb.q;
                            _weqRbChanged = true;
                        }
                        if (rb.drift !== undefined && Math.abs((pt.drift || 0) - rb.drift) > 0.5) {
                            pt.drift = rb.drift;
                            _weqRbChanged = true;
                        }
                    }
                    if (_weqRbChanged) {
                        // Update virtual param displays
                        if (typeof weqSyncVirtualParams === 'function') weqSyncVirtualParams();
                        // Redraw canvas if visible
                        if (typeof weqDrawCanvas === 'function') {
                            var _rbOverlay = document.getElementById('weqOverlay');
                            if (_rbOverlay && _rbOverlay.classList.contains('visible')) weqDrawCanvas();
                        }
                    }
                }

                // ── WrongEQ global param readback (depth, warp, steps, tilt from C++ modulation) ──
                if (data.weqGlobals && typeof weqGlobalDepth !== 'undefined') {
                    var g = data.weqGlobals;
                    var _gChanged = false;
                    if (g.depth !== undefined && Math.abs(weqGlobalDepth - g.depth) > 0.5) {
                        weqGlobalDepth = Math.round(g.depth);
                        _gChanged = true;
                    }
                    if (g.warp !== undefined && Math.abs(weqGlobalWarp - g.warp) > 0.5) {
                        weqGlobalWarp = Math.round(g.warp);
                        _gChanged = true;
                    }
                    if (g.steps !== undefined && weqGlobalSteps !== g.steps) {
                        weqGlobalSteps = g.steps;
                        _gChanged = true;
                    }
                    if (g.tilt !== undefined && Math.abs(weqGlobalTilt - g.tilt) > 0.5) {
                        weqGlobalTilt = Math.round(g.tilt);
                        _gChanged = true;
                    }
                    if (_gChanged) {
                        if (typeof weqSyncVirtualParams === 'function') weqSyncVirtualParams();
                        if (typeof weqDrawCanvas === 'function') {
                            var _gOverlay = document.getElementById('weqOverlay');
                            if (_gOverlay && _gOverlay.classList.contains('visible')) weqDrawCanvas();
                        }
                    }
                }

                // SINGLE refresh per tick — unconditional.
                // Modulated params need continuous arc updates even when
                // nothing "changed" (C++ moves values the JS side must display).
                refreshParamDisplay();
            }
        });
        return true;
    }
    return false;
}
if (!setupRtDataListener()) {
    var rtRetry = setInterval(function () { if (setupRtDataListener()) clearInterval(rtRetry); }, 100);
}

// ============================================================
// CRASH NOTIFICATION LISTENER
// Shows a toast when a hosted plugin crashes during audio processing
// ============================================================
function setupCrashListener() {
    if (window.__JUCE__ && window.__JUCE__.backend) {
        window.__JUCE__.backend.addEventListener('__plugin_crashed__', function (data) {
            if (!data) return;
            showCrashToast(data.pluginId, data.pluginName, data.reason);
        });
        return true;
    }
    return false;
}

function showCrashToast(pluginId, pluginName, reason) {
    // Create toast container if it doesn't exist
    var container = document.getElementById('crash-toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'crash-toast-container';
        container.style.cssText = 'position:fixed;top:12px;right:12px;z-index:99999;display:flex;flex-direction:column;gap:8px;pointer-events:none;';
        document.body.appendChild(container);
    }

    var toast = document.createElement('div');
    toast.className = 'crash-toast';
    toast.style.cssText = 'pointer-events:auto;background:linear-gradient(135deg,#4a1010,#2a0808);border:1px solid #ff3333;border-radius:8px;padding:12px 16px;color:#fff;font-size:12px;font-family:inherit;box-shadow:0 4px 24px rgba(255,0,0,0.3);display:flex;align-items:center;gap:10px;animation:crashSlideIn 0.3s ease-out;max-width:380px;';

    var icon = document.createElement('span');
    icon.textContent = '\u26A0';
    icon.style.cssText = 'font-size:20px;color:#ff4444;flex-shrink:0;';

    var textDiv = document.createElement('div');
    textDiv.style.cssText = 'flex:1;';

    var title = document.createElement('div');
    title.style.cssText = 'font-weight:600;font-size:13px;color:#ff6666;margin-bottom:3px;';
    title.textContent = pluginName + ' crashed';

    var body = document.createElement('div');
    body.style.cssText = 'font-size:11px;color:#ccc;line-height:1.3;';
    body.textContent = 'Auto-bypassed to protect your session.';

    textDiv.appendChild(title);
    textDiv.appendChild(body);

    var btnWrap = document.createElement('div');
    btnWrap.style.cssText = 'display:flex;gap:6px;flex-shrink:0;';

    var reEnBtn = document.createElement('button');
    reEnBtn.textContent = 'Re-enable';
    reEnBtn.style.cssText = 'background:#333;border:1px solid #ff6666;color:#ff8888;border-radius:4px;padding:4px 10px;cursor:pointer;font-size:11px;font-family:inherit;';
    reEnBtn.onmouseenter = function () { reEnBtn.style.background = '#4a1515'; };
    reEnBtn.onmouseleave = function () { reEnBtn.style.background = '#333'; };
    reEnBtn.onclick = function () {
        var fn = window.__juceGetNativeFunction('resetPluginCrash');
        if (fn) fn(pluginId);
        toast.style.animation = 'crashSlideOut 0.2s ease-in forwards';
        setTimeout(function () { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 200);
    };

    var dismissBtn = document.createElement('button');
    dismissBtn.textContent = '\u2715';
    dismissBtn.style.cssText = 'background:none;border:none;color:#888;cursor:pointer;font-size:16px;padding:0 4px;line-height:1;';
    dismissBtn.onclick = function () {
        toast.style.animation = 'crashSlideOut 0.2s ease-in forwards';
        setTimeout(function () { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 200);
    };

    btnWrap.appendChild(reEnBtn);
    btnWrap.appendChild(dismissBtn);

    toast.appendChild(icon);
    toast.appendChild(textDiv);
    toast.appendChild(btnWrap);
    container.appendChild(toast);

    // Auto-dismiss after 10s
    setTimeout(function () {
        if (toast.parentNode) {
            toast.style.animation = 'crashSlideOut 0.2s ease-in forwards';
            setTimeout(function () { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 200);
        }
    }, 10000);
}

// Inject crash toast animation keyframes
(function () {
    var style = document.createElement('style');
    style.textContent = '@keyframes crashSlideIn{from{transform:translateX(100%);opacity:0}to{transform:translateX(0);opacity:1}}@keyframes crashSlideOut{from{transform:translateX(0);opacity:1}to{transform:translateX(100%);opacity:0}}';
    document.head.appendChild(style);
})();

if (!setupCrashListener()) {
    var crashRetry = setInterval(function () { if (setupCrashListener()) clearInterval(crashRetry); }, 100);
}
