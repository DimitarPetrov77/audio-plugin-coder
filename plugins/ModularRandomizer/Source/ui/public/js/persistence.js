// ============================================================
// STATE PERSISTENCE
// Save/restore UI state across editor close/reopen
// ============================================================
// ==========================================================
// STATE PERSISTENCE — save/restore across editor close/reopen
// ==========================================================

// Serialize full UI state to JSON and send to processor
function saveUiStateToHost() {
    _stateDirty = false; // clear so auto-save doesn't redundantly fire
    // Mark global preset as dirty (any state save implies a change was made)
    if (typeof markGpDirty === 'function') markGpDirty();
    if (!(window.__JUCE__ && window.__JUCE__.backend)) return;
    var fn = window.__juceGetNativeFunction('saveUiState');
    var state = {
        blocks: blocks.map(function (b) {
            return {
                id: b.id, mode: b.mode, colorIdx: b.colorIdx,
                targets: Array.from(b.targets), targetBases: b.targetBases || {}, targetRanges: b.targetRanges || {}, targetRangeBases: b.targetRangeBases || {},
                trigger: b.trigger, beatDiv: b.beatDiv,
                midiMode: b.midiMode, midiNote: b.midiNote, midiCC: b.midiCC, midiCh: b.midiCh,
                velScale: b.velScale, threshold: b.threshold, audioSrc: b.audioSrc,
                rMin: b.rMin, rMax: b.rMax, rangeMode: b.rangeMode,
                quantize: b.quantize, qSteps: b.qSteps,
                movement: b.movement, glideMs: b.glideMs,
                envAtk: b.envAtk, envRel: b.envRel, envSens: b.envSens, envInvert: b.envInvert,
                envFilterMode: b.envFilterMode || 'flat', envFilterFreq: b.envFilterFreq != null ? b.envFilterFreq : 50, envFilterBW: b.envFilterBW != null ? b.envFilterBW : 5,
                loopMode: b.loopMode, sampleSpeed: b.sampleSpeed, sampleReverse: b.sampleReverse, jumpMode: b.jumpMode,
                sampleName: b.sampleName || '', sampleWaveform: b.sampleWaveform || null,
                polarity: b.polarity || 'bipolar', clockSource: b.clockSource || 'daw',
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
                enabled: b.enabled !== false,
                expanded: b.expanded
            };
        }),
        bc: bc, actId: actId,
        locks: (function () {
            var lk = {};
            for (var id in PMap) { if (PMap[id].lk) lk[id] = true; }
            return lk;
        })(),
        pluginOrder: pluginBlocks.filter(function (pb) { return !pb.isVirtual; }).map(function (pb) { return pb.id; }),
        pluginExpanded: (function () {
            var exp = {};
            pluginBlocks.forEach(function (pb) { if (!pb.isVirtual) exp[pb.id] = pb.expanded; });
            return exp;
        })(),
        pluginBypassed: (function () {
            var byp = {};
            pluginBlocks.forEach(function (pb) { if (pb.bypassed && !pb.isVirtual) byp[pb.id] = true; });
            return byp;
        }()),
        uiScale: currentScale,
        uiTheme: currentTheme,
        autoLocate: autoLocate,
        internalBpm: internalBpm,
        routingMode: routingMode,
        pluginBuses: (function () {
            var buses = {};
            pluginBlocks.forEach(function (pb) { if (pb.busId && !pb.isVirtual) buses[pb.id] = pb.busId; });
            return buses;
        }()),
        busVolumes: busVolumes.slice(),
        busMutes: busMutes.slice(),
        busSolos: busSolos.slice(),
        busCollapsed: busCollapsed.slice(),
        scanPaths: scanPaths.slice(),
        exposeState: typeof getExposeStateForSave === 'function' ? getExposeStateForSave() : null,
        wrongEq: {
            points: wrongEqPoints.map(function (p, idx) {
                // During animation, save the stable base positions — not the animated jittering values
                var saveX = (typeof weqAnimRafId !== 'undefined' && weqAnimRafId && typeof weqAnimBaseX !== 'undefined' && weqAnimBaseX.length > idx) ? weqAnimBaseX[idx] : p.x;
                var saveY = (typeof weqAnimRafId !== 'undefined' && weqAnimRafId && typeof weqAnimBaseY !== 'undefined' && weqAnimBaseY.length > idx) ? weqAnimBaseY[idx] : p.y;
                return { uid: p.uid, x: saveX, y: saveY, pluginIds: p.pluginIds || [], seg: p.seg || null, solo: p.solo || false, mute: p.mute || false, q: p.q != null ? p.q : 0.707, type: p.type || 'Bell', drift: p.drift || 0, preEq: p.preEq !== false, stereoMode: p.stereoMode || 0, slope: p.slope || 1 };
            }),
            interp: typeof weqGlobalInterp !== 'undefined' ? weqGlobalInterp : 'smooth',
            depth: typeof weqGlobalDepth !== 'undefined' ? weqGlobalDepth : 100,
            warp: typeof weqGlobalWarp !== 'undefined' ? weqGlobalWarp : 0,
            steps: typeof weqGlobalSteps !== 'undefined' ? weqGlobalSteps : 0,
            tilt: typeof weqGlobalTilt !== 'undefined' ? weqGlobalTilt : 0,

            preEq: typeof weqPreEq !== 'undefined' ? weqPreEq : true,
            bypass: typeof weqGlobalBypass !== 'undefined' ? weqGlobalBypass : false,
            unassignedMode: typeof weqUnassignedMode !== 'undefined' ? weqUnassignedMode : 0,
            animSpeed: typeof weqAnimSpeed !== 'undefined' ? weqAnimSpeed : 0,
            animDepth: typeof weqAnimDepth !== 'undefined' ? weqAnimDepth : 6,
            animShape: typeof weqAnimShape !== 'undefined' ? weqAnimShape : 'sine',
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
            qLoCut: typeof weqQLoCut !== 'undefined' ? weqQLoCut : 20,
            qHiCut: typeof weqQHiCut !== 'undefined' ? weqQHiCut : 20000,

            dbRange: typeof weqDBRangeMax !== 'undefined' ? weqDBRangeMax : 24,
            splitMode: typeof weqSplitMode !== 'undefined' ? weqSplitMode : false,
            oversample: typeof weqOversample !== 'undefined' ? weqOversample : 1,
            splitSavedGains: typeof _weqSplitSavedGains !== 'undefined' ? _weqSplitSavedGains : null
        }
    };
    fn(JSON.stringify(state));
}

// Restore state from processor (called once on editor open)
function restoreFromHost() {
    if (!(window.__JUCE__ && window.__JUCE__.backend)) {
        // No JUCE backend, just start fresh
        addBlock('randomize');
        return;
    }
    var fn = window.__juceGetNativeFunction('getFullState');
    fn().then(function (result) {
        if (!result) { addBlock('randomize'); processRealTimeData(); return; }

        var hasPlugins = result.plugins && result.plugins.length > 0;
        var hasUiState = result.uiState && result.uiState.length > 0;

        if (!hasPlugins && !hasUiState) {
            // Fresh session — start with default block
            addBlock('randomize');
            processRealTimeData();
            return;
        }

        // Rebuild pluginBlocks and PMap from hosted plugins
        pluginBlocks = [];
        PMap = {};
        if (result.plugins) {
            result.plugins.forEach(function (plug) {
                var params = (plug.params || []).map(function (p) {
                    var fid = plug.id + ':' + p.index;
                    var param = { id: fid, name: p.name, v: p.value, disp: p.disp || '', lk: false, alk: false, realIndex: p.index, hostId: plug.id };
                    PMap[fid] = param;
                    return param;
                });
                pluginBlocks.push({ id: plug.id, hostId: plug.id, name: plug.name, path: plug.path || '', manufacturer: plug.manufacturer || '', params: params, expanded: true, searchFilter: '' });
            });
        }

        // Restore UI state (blocks, mappings, locks)
        if (hasUiState) {
            try {
                var saved = JSON.parse(result.uiState);

                // Restore locks
                if (saved.locks) {
                    for (var lid in saved.locks) {
                        if (PMap[lid]) PMap[lid].lk = true;
                    }
                }

                // Restore plugin expanded states
                if (saved.pluginExpanded) {
                    pluginBlocks.forEach(function (pb) {
                        if (saved.pluginExpanded[pb.id] !== undefined)
                            pb.expanded = saved.pluginExpanded[pb.id];
                    });
                }

                // Restore plugin order
                if (saved.pluginOrder && saved.pluginOrder.length > 0) {
                    var ordered = [];
                    saved.pluginOrder.forEach(function (pid) {
                        for (var i = 0; i < pluginBlocks.length; i++) {
                            if (pluginBlocks[i].id === pid) {
                                ordered.push(pluginBlocks[i]);
                                break;
                            }
                        }
                    });
                    // Add any plugins not in saved order (newly loaded)
                    pluginBlocks.forEach(function (pb) {
                        if (ordered.indexOf(pb) < 0) ordered.push(pb);
                    });
                    pluginBlocks = ordered;

                    // Sync restored order to C++ backend
                    var reorderFn = (window.__JUCE__ && window.__JUCE__.backend) ? window.__juceGetNativeFunction('reorderPlugins') : null;
                    if (reorderFn) {
                        var ids = pluginBlocks.map(function (pb) { return pb.id; });
                        reorderFn(ids);
                    }
                }

                // Restore bypass state
                if (saved.pluginBypassed) {
                    pluginBlocks.forEach(function (pb) {
                        if (saved.pluginBypassed[pb.id]) {
                            pb.bypassed = true;
                            if (window.__JUCE__ && window.__JUCE__.backend) {
                                var fn = window.__juceGetNativeFunction('setPluginBypass');
                                fn(pb.hostId, true);
                            }
                        }
                    });
                }
                // Restore blocks
                if (saved.blocks && saved.blocks.length > 0) {
                    blocks = saved.blocks.map(function (sb) {
                        // Convert targets array back to Set
                        var tSet = new Set();
                        if (sb.targets) sb.targets.forEach(function (t) {
                            // Only restore target if the param still exists
                            if (PMap[t]) tSet.add(t);
                        });
                        return {
                            id: sb.id, mode: sb.mode || 'randomize', targets: tSet, targetBases: sb.targetBases || {}, targetRanges: sb.targetRanges || {}, targetRangeBases: sb.targetRangeBases || {},
                            colorIdx: sb.colorIdx || 0,
                            trigger: sb.trigger || 'manual', beatDiv: sb.beatDiv || '1/4',
                            midiMode: sb.midiMode || 'any_note', midiNote: sb.midiNote != null ? sb.midiNote : 60,
                            midiCC: sb.midiCC != null ? sb.midiCC : 1, midiCh: sb.midiCh != null ? sb.midiCh : 0,
                            velScale: sb.velScale || false, threshold: sb.threshold != null ? sb.threshold : -12,
                            audioSrc: sb.audioSrc || 'main',
                            rMin: sb.rMin || 0, rMax: sb.rMax !== undefined ? sb.rMax : 100,
                            rangeMode: (sb.mode === 'randomize') ? (sb.rangeMode || 'absolute') : 'relative',
                            quantize: sb.quantize || false, qSteps: sb.qSteps != null ? sb.qSteps : 12,
                            movement: sb.movement || 'instant', glideMs: sb.glideMs != null ? sb.glideMs : 200,
                            envAtk: sb.envAtk != null ? sb.envAtk : 10, envRel: sb.envRel != null ? sb.envRel : 100,
                            envSens: sb.envSens != null ? sb.envSens : 50, envInvert: sb.envInvert || false,
                            envFilterMode: sb.envFilterMode || 'flat', envFilterFreq: sb.envFilterFreq != null ? sb.envFilterFreq : 50, envFilterBW: sb.envFilterBW != null ? sb.envFilterBW : 5,
                            loopMode: sb.loopMode || 'loop', sampleSpeed: sb.sampleSpeed != null ? sb.sampleSpeed : 1.0,
                            sampleReverse: sb.sampleReverse || false, jumpMode: sb.jumpMode || 'restart',
                            sampleName: sb.sampleName || '', sampleWaveform: sb.sampleWaveform || null,
                            polarity: sb.polarity || 'bipolar', clockSource: sb.clockSource || 'daw',
                            snapshots: (sb.snapshots || []).map(function (s) { return { x: s.x != null ? s.x : 0.5, y: s.y != null ? s.y : 0.5, name: s.name || '', source: s.source || '', values: s.values || {} }; }),
                            playheadX: (function () { var c = clampToCircle(sb.playheadX != null ? sb.playheadX : 0.5, sb.playheadY != null ? sb.playheadY : 0.5); return c.x; })(),
                            playheadY: (function () { var c = clampToCircle(sb.playheadX != null ? sb.playheadX : 0.5, sb.playheadY != null ? sb.playheadY : 0.5); return c.y; })(),
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
                            laneTool: sb.laneTool || 'draw', laneGrid: sb.laneGrid || '1/8',
                            lanes: (sb.lanes || []).map(function (lane) {
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
                                    _overlayLanes: lane.overlayLanes || []
                                };
                            }),
                            enabled: sb.enabled !== false,
                            expanded: sb.expanded !== undefined ? sb.expanded : true
                        };
                    });
                    bc = saved.bc || 0;
                    actId = saved.actId || (blocks.length > 0 ? blocks[0].id : null);
                } else {
                    // Has plugins but no blocks — create default
                    addBlock('randomize');
                }
            } catch (e) {
                console.log('UI state restore error:', e);
                addBlock('randomize');
            }
            // Restore UI scale (outside try/catch so it always applies)
            if (saved && saved.uiScale) {
                applyScale(saved.uiScale);
            }
            // Restore theme
            if (saved && saved.uiTheme && THEMES[saved.uiTheme]) {
                applyTheme(saved.uiTheme);
            }
            // Restore auto-locate setting
            if (saved && saved.autoLocate !== undefined) {
                autoLocate = saved.autoLocate;
                document.getElementById('autoLocateChk').checked = autoLocate;
            }
            if (saved && saved.internalBpm) {
                internalBpm = saved.internalBpm;
                document.getElementById('internalBpmInput').value = internalBpm;
            }
            // Restore routing mode
            if (saved && saved.routingMode !== undefined) {
                routingMode = saved.routingMode;
                document.querySelectorAll('.routing-btn').forEach(function (b) {
                    b.classList.toggle('on', parseInt(b.dataset.rmode) === routingMode);
                });
                if (window.__JUCE__ && window.__JUCE__.backend) {
                    var rmFn = window.__juceGetNativeFunction('setRoutingMode');
                    rmFn(routingMode);
                }
            }
            // Restore WrongEQ state
            if (saved && saved.wrongEq) {
                var weq = saved.wrongEq;
                if (weq.points) {
                    wrongEqPoints = weq.points.map(function (p) {
                        var pt = { x: p.x, y: p.y, pluginIds: p.pluginIds || [], seg: p.seg || null, solo: p.solo || false, mute: p.mute || false, q: p.q != null ? p.q : 0.707, type: p.type || 'Bell', drift: p.drift || 0, preEq: p.preEq !== undefined ? p.preEq : (weq.preEq !== undefined ? weq.preEq : true), stereoMode: p.stereoMode || 0, slope: p.slope || 1 };
                        if (p.uid) pt.uid = p.uid; // restore saved uid
                        return pt;
                    });
                    // Ensure all points have uids and sync the counter
                    var maxUid = 0;
                    wrongEqPoints.forEach(function (pt) {
                        _weqEnsureUid(pt);
                        if (pt.uid > maxUid) maxUid = pt.uid;
                    });
                    if (maxUid >= _weqNextUid) _weqNextUid = maxUid + 1;
                }
                if (typeof weqGlobalInterp !== 'undefined' && weq.interp) weqGlobalInterp = weq.interp;
                if (typeof weqGlobalDepth !== 'undefined' && weq.depth != null) weqGlobalDepth = weq.depth;
                if (typeof weqGlobalWarp !== 'undefined' && weq.warp != null) weqGlobalWarp = weq.warp;
                if (typeof weqGlobalSteps !== 'undefined' && weq.steps != null) weqGlobalSteps = weq.steps;
                if (typeof weqGlobalTilt !== 'undefined' && weq.tilt != null) weqGlobalTilt = weq.tilt;

                if (typeof weqPreEq !== 'undefined' && weq.preEq != null) weqPreEq = weq.preEq;
                if (typeof weqGlobalBypass !== 'undefined' && weq.bypass != null) weqGlobalBypass = weq.bypass;
                if (typeof weqUnassignedMode !== 'undefined' && weq.unassignedMode != null) weqUnassignedMode = weq.unassignedMode;
                if (typeof weqAnimSpeed !== 'undefined' && weq.animSpeed != null) weqAnimSpeed = weq.animSpeed;
                if (typeof weqAnimDepth !== 'undefined' && weq.animDepth != null) weqAnimDepth = weq.animDepth;
                if (typeof weqAnimShape !== 'undefined' && weq.animShape != null) weqAnimShape = weq.animShape;
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
                if (typeof weqQLoCut !== 'undefined' && weq.qLoCut != null) weqQLoCut = weq.qLoCut;
                if (typeof weqQHiCut !== 'undefined' && weq.qHiCut != null) weqQHiCut = weq.qHiCut;

                if (typeof weqDBRangeMax !== 'undefined' && weq.dbRange != null) weqDBRangeMax = weq.dbRange;
                if (typeof weqSplitMode !== 'undefined' && weq.splitMode != null) weqSplitMode = weq.splitMode;
                if (typeof weqOversample !== 'undefined' && weq.oversample != null) weqOversample = weq.oversample;
                if (typeof _weqSplitSavedGains !== 'undefined' && weq.splitSavedGains != null) _weqSplitSavedGains = weq.splitSavedGains;
            }
            // Show WrongEQ button if mode 2, sync restored state to C++
            if (typeof weqSetVisible === 'function') weqSetVisible(routingMode === 2);
            if (routingMode === 2 && typeof weqSyncToHost === 'function') {
                weqSyncToHost();
                // Retry sync after delay — the initial call may fire before the
                // JUCE backend is fully connected, silently dropping the EQ data.
                // Without this, the EQ curve shows visually but has no audio effect.
                setTimeout(function () {
                    if (typeof weqSyncToHost === 'function') weqSyncToHost();
                }, 500);
                setTimeout(function () {
                    if (typeof weqSyncToHost === 'function') weqSyncToHost();
                }, 1500);
            }
            // Auto-start animation if it was running (speed or drift active)
            var needsAnim = (weqAnimSpeed > 0) || (Math.abs(weqDrift) > 0 && weqDriftRange > 0) || (weqDriftContinuous && weqDriftRange > 0);
            if (routingMode === 2 && needsAnim && typeof weqAnimStart === 'function') weqAnimStart();
            // Restore also from getFullState response
            if (result.routingMode !== undefined && !(saved && saved.routingMode !== undefined)) {
                routingMode = result.routingMode;
                document.querySelectorAll('.routing-btn').forEach(function (b) {
                    b.classList.toggle('on', parseInt(b.dataset.rmode) === routingMode);
                });
            }
            // Restore bus assignments
            if (saved && saved.pluginBuses) {
                var buses = saved.pluginBuses;
                pluginBlocks.forEach(function (pb) {
                    if (buses[pb.id] !== undefined) {
                        pb.busId = buses[pb.id];
                        if (window.__JUCE__ && window.__JUCE__.backend) {
                            var busFn = window.__juceGetNativeFunction('setPluginBus');
                            busFn(pb.hostId || pb.id, pb.busId);
                        }
                    }
                });
            }
            // Restore bus mixer state
            if (saved && saved.busVolumes) {
                for (var bvi = 0; bvi < saved.busVolumes.length && bvi < busVolumes.length; bvi++) {
                    busVolumes[bvi] = saved.busVolumes[bvi];
                    if (window.__JUCE__ && window.__JUCE__.backend) {
                        var bvFn = window.__juceGetNativeFunction('setBusVolume');
                        bvFn(bvi, busVolumes[bvi]);
                    }
                }
            }
            if (saved && saved.busMutes) {
                for (var bmi = 0; bmi < saved.busMutes.length && bmi < busMutes.length; bmi++) {
                    busMutes[bmi] = saved.busMutes[bmi];
                    if (window.__JUCE__ && window.__JUCE__.backend) {
                        var bmFn = window.__juceGetNativeFunction('setBusMute');
                        bmFn(bmi, busMutes[bmi]);
                    }
                }
            }
            if (saved && saved.busSolos) {
                for (var bsi = 0; bsi < saved.busSolos.length && bsi < busSolos.length; bsi++) {
                    busSolos[bsi] = saved.busSolos[bsi];
                    if (window.__JUCE__ && window.__JUCE__.backend) {
                        var bsFn = window.__juceGetNativeFunction('setBusSolo');
                        bsFn(bsi, busSolos[bsi]);
                    }
                }
            }
            if (saved && saved.busCollapsed) {
                for (var bci = 0; bci < saved.busCollapsed.length && bci < busCollapsed.length; bci++) {
                    busCollapsed[bci] = saved.busCollapsed[bci];
                }
            }
            // Restore scan paths
            if (saved && saved.scanPaths && saved.scanPaths.length > 0) {
                scanPaths = saved.scanPaths.slice();
            }
            // Restore expose state
            if (saved && saved.exposeState && typeof restoreExposeState === 'function') {
                restoreExposeState(saved.exposeState);
            }
            // Also read busId from getFullState plugin data
            if (result.plugins) {
                result.plugins.forEach(function (dp) {
                    if (dp.busId) {
                        for (var i = 0; i < pluginBlocks.length; i++) {
                            if (pluginBlocks[i].id === dp.id) {
                                pluginBlocks[i].busId = dp.busId;
                                break;
                            }
                        }
                    }
                });
            }
        } else {
            // Has plugins but no saved UI state — create default block
            addBlock('randomize');
        }

        renderAllPlugins();
        renderBlocks();
        updCounts();
        syncBlocksToHost();
        syncExpandedPlugins();
        processRealTimeData();
    }).catch(function (e) {
        console.log('getFullState error:', e);
        addBlock('randomize');
        processRealTimeData();
    });
}

// ============================================================
// AUTO-SAVE: Periodic + on-close state persistence
// Ensures processor always has current UI state, even if the
// editor is destroyed without an explicit save action.
// ============================================================

// Auto-save every 3 seconds — but only if state actually changed
var _stateDirty = false;
function markStateDirty() {
    _stateDirty = true;
    // Also mark global preset as dirty so the user knows there are unsaved changes
    if (typeof markGpDirty === 'function') markGpDirty();
}
setInterval(function () {
    if (_stateDirty) {
        _stateDirty = false;
        saveUiStateToHost();
    }
}, 3000);

// Last-ditch save when WebView is about to be destroyed
window.addEventListener('beforeunload', function () {
    saveUiStateToHost();
});

// Save when page becomes hidden (tab switch, minimize, etc.)
// Restore virtual scroll + canvases when page becomes visible again
document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') {
        saveUiStateToHost();
    } else if (document.visibilityState === 'visible') {
        // Tell the readback handler to silently adopt values for a few frames
        // without marking params dirty. This prevents the catch-up burst after minimize.
        if (typeof _laneSkipDirty !== 'undefined') _laneSkipDirty = 3;

        // Re-render virtual scroll rows — containers may have had zero height while hidden
        document.querySelectorAll('.pcard-params').forEach(function (paramC) {
            if (paramC._vScroll && typeof _updateVirtualRows === 'function') {
                _updateVirtualRows(paramC);
            }
        });
        // Redraw lane canvases — they need a paint after being hidden
        if (typeof blocks !== 'undefined') {
            for (var bi = 0; bi < blocks.length; bi++) {
                var b = blocks[bi];
                if (b.mode === 'lane' && b.lanes && b.expanded && typeof laneDrawCanvas === 'function') {
                    for (var li = 0; li < b.lanes.length; li++) {
                        if (!b.lanes[li].collapsed) laneDrawCanvas(b, li);
                    }
                }
            }
        }
    }
});
