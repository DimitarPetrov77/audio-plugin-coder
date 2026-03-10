/*
 * Lane Mode Module - per-param automation lanes
 * Extracted from logic_blocks.js for maintainability
 * All functions here operate on the shared global state (blocks, PMap, etc.)
 * Depends on: state.js, undo_system.js (pushUndoSnapshot, syncBlocksToHost)
 */
// -*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-
// LANE MODE - per-param automation lanes
// -*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-*-
var LANE_CANVAS_H = 130; // default expanded px per lane
var LANE_Y_PAD = 8; // px padding top/bottom so dots at 0%/100% are fully visible
function laneYtoCanvas(y, H) { return LANE_Y_PAD + y * (H - 2 * LANE_Y_PAD); }
function laneCanvasToY(py, H) { return Math.max(0, Math.min(1, (py - LANE_Y_PAD) / (H - 2 * LANE_Y_PAD))); }

function ensureLanes(b) {
    // Lanes support multiple params (pids array).
    // Each assigned target can live in its own lane OR share a lane.
    if (!b.lanes) b.lanes = [];
    var tArr = Array.from(b.targets);

    // Migrate old single-pid lanes to pids array
    for (var i = 0; i < b.lanes.length; i++) {
        if (b.lanes[i].pid && !b.lanes[i].pids) {
            b.lanes[i].pids = [b.lanes[i].pid];
            delete b.lanes[i].pid;
        }
        if (!b.lanes[i].pids) b.lanes[i].pids = [];
    }

    // Build set of all PIDs in targets
    var targetSet = {};
    tArr.forEach(function (pid) { targetSet[pid] = true; });

    // Remove PIDs from lanes that are no longer in targets
    for (var i = 0; i < b.lanes.length; i++) {
        b.lanes[i].pids = b.lanes[i].pids.filter(function (pid) { return targetSet[pid]; });
    }
    // Remove empty lanes that were auto-generated (lost all params)
    // Keep: morph lanes, lanes the user explicitly created (they'll add params later)
    // An auto-generated lane has default points and no explicit user creation marker
    // Simple heuristic: keep lanes that have _userCreated flag or morphMode
    b.lanes = b.lanes.filter(function (l) { return l.pids.length > 0 || l.morphMode || l._userCreated; });

    // Init overlay state for existing lanes (transient, not persisted)
    for (var i = 0; i < b.lanes.length; i++) {
        if (!b.lanes[i]._overlayLanes) b.lanes[i]._overlayLanes = [];
    }

    // Find PIDs not yet in any lane — batch into ONE auto-lane (not one per PID!)
    var assignedPids = {};
    b.lanes.forEach(function (l) {
        l.pids.forEach(function (pid) { assignedPids[pid] = true; });
    });
    var unassigned = tArr.filter(function (pid) { return !assignedPids[pid]; });
    if (unassigned.length > 0) {
        b.lanes.push({
            pids: unassigned,
            color: LANE_COLORS[b.lanes.length % LANE_COLORS.length],
            pts: [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }],
            loopLen: '1/1',
            freeSecs: 4,
            depth: 100,
            drift: 0,
            driftRange: 5,
            driftScale: '1/1',
            warp: 0,
            steps: 0,

            interp: 'smooth',
            playMode: 'forward',
            synced: true,
            muted: false,
            collapsed: false,
            trigMode: 'loop',
            trigSource: 'manual',
            trigMidiNote: -1,
            trigMidiCh: 0,
            trigThreshold: -12,
            trigAudioSrc: 'main',
            trigRetrigger: true,
            trigHold: false,
            _overlayLanes: []
        });
    }
}

// Overlay helpers: loop length in beats for ratio calculation
function laneLoopBeats(lane) {
    if (lane.loopLen === 'free') return lane.freeSecs || 4;
    var BEAT_MAP = {
        '1/16': 0.25, '1/16T': 0.25 * 2 / 3,
        '1/8': 0.5, '1/8.': 0.75, '1/8T': 0.5 * 2 / 3,
        '1/4': 1, '1/4.': 1.5, '1/4T': 1 * 2 / 3,
        '1/2': 2, '1/2.': 3, '1/2T': 2 * 2 / 3,
        '1/1': 4, '2/1': 8, '4/1': 16, '8/1': 32, '16/1': 64, '32/1': 128
    };
    return BEAT_MAP[lane.loopLen] || 4;
}

// Scale overlay points for different loop lengths (tile or crop)
// ratio = laneLoopBeats(currentLane) / laneLoopBeats(overlayLane)
//   ratio > 1 => overlay is shorter, tile it
//   ratio < 1 => overlay is longer, show the segment matching the current playback position
function getOverlayPoints(olane, ratio) {
    var pts = olane.pts;
    if (!pts || pts.length < 2) return [];
    var scaled = [];
    if (ratio >= 1) {
        // Tile: repeat the overlay shape to fill the current lane's duration
        var tiles = Math.ceil(ratio);
        for (var t = 0; t < tiles; t++) {
            for (var i = 0; i < pts.length; i++) {
                // Skip first point of subsequent tiles (duplicate of prev tile's last)
                if (t > 0 && i === 0) continue;
                var nx = (t + pts[i].x) / ratio;
                if (nx > 1.001) break;
                scaled.push({ x: Math.min(1, nx), y: pts[i].y });
            }
        }
    } else {
        // Dynamic crop: show the segment of the overlay that matches current playback.
        // The overlayed lane's playhead tells us which segment is active.
        var ph = olane._phPos || 0;
        var segCount = Math.round(1 / ratio);
        var segIdx = Math.min(Math.floor(ph / ratio), segCount - 1);
        var cropStart = segIdx * ratio;
        var cropEnd = cropStart + ratio;

        // Interpolate start point
        var startY = interpolateAtX(pts, cropStart);
        scaled.push({ x: 0, y: startY });

        // Add points within the window
        for (var i = 0; i < pts.length; i++) {
            if (pts[i].x <= cropStart) continue;
            if (pts[i].x >= cropEnd) break;
            scaled.push({ x: (pts[i].x - cropStart) / ratio, y: pts[i].y });
        }

        // Interpolate end point
        var endY = interpolateAtX(pts, Math.min(cropEnd, 1));
        scaled.push({ x: 1, y: endY });
    }
    return scaled;
}

// Helper: interpolate y value at a given x position in a point array
function interpolateAtX(pts, x) {
    if (!pts || pts.length === 0) return 0.5;
    if (x <= pts[0].x) return pts[0].y;
    if (x >= pts[pts.length - 1].x) return pts[pts.length - 1].y;
    for (var i = 0; i < pts.length - 1; i++) {
        if (x >= pts[i].x && x < pts[i + 1].x) {
            var t = (x - pts[i].x) / (pts[i + 1].x - pts[i].x);
            return pts[i].y + (pts[i + 1].y - pts[i].y) * t;
        }
    }
    return pts[pts.length - 1].y;
}

function renderLaneBody(b) {
    ensureLanes(b);
    var h = '';

    // -"-"- TOOLBAR -"-"-
    h += '<div class="block-section lane-section">';
    h += '<div class="lane-toolbar">';
    // Tools
    h += '<button class="lane-tbtn' + (b.laneTool === 'draw' ? ' on' : '') + '" data-b="' + b.id + '" data-lt="draw">\u270F Draw</button>';
    h += '<button class="lane-tbtn' + (b.laneTool === 'select' ? ' on' : '') + '" data-b="' + b.id + '" data-lt="select">\u2196 Select</button>';
    h += '<button class="lane-tbtn' + (b.laneTool === 'erase' ? ' on' : '') + '" data-b="' + b.id + '" data-lt="erase">\u232B Erase</button>';
    h += '<div class="lane-tsep"></div>';
    // Grid
    h += '<span class="lane-tlbl">Grid</span>';
    h += '<div class="lane-itabs" data-b="' + b.id + '" data-f="laneGrid">';
    ['free', '1/16', '1/8', '1/4', '1/2', '1/1', '2/1', '4/1'].forEach(function (g) {
        h += '<button class="lane-itab' + (b.laneGrid === g ? ' on' : '') + '" data-v="' + g + '">' + (g === 'free' ? 'Free' : g) + '</button>';
    });
    h += '</div>';
    h += '<div class="lane-tsep"></div>';
    // Clear + Random
    h += '<button class="lane-tbtn" data-b="' + b.id + '" data-lt="clear">\u2298 Clear</button>';
    h += '<button class="lane-tbtn" data-b="' + b.id + '" data-lt="random">\u2684 Random</button>';
    // Right side: sync
    h += '<div class="lane-toolbar-right">';
    h += '<div class="seg-inline" data-b="' + b.id + '" data-f="clockSource"><button class="' + ((b.clockSource || 'daw') === 'daw' ? 'on' : '') + '" data-v="daw">DAW</button><button class="' + (b.clockSource === 'internal' ? 'on' : '') + '" data-v="internal">Int</button></div>';
    h += '</div>';
    h += '</div>'; // toolbar end

    // -"-"- LANES -"-"-
    if (b.lanes.length === 0) {
        h += '<div class="lane-empty">Assign parameters to create lanes</div>';
    } else {
        h += '<div class="lane-stack" data-b="' + b.id + '">';
        for (var li = 0; li < b.lanes.length; li++) {
            var lane = b.lanes[li];
            // Build header name from pids array
            var firstName = '', extraCount = 0;
            if (lane.pids && lane.pids.length > 0) {
                var fp = PMap[lane.pids[0]];
                firstName = fp ? (paramPluginName(lane.pids[0]) + ' / ' + fp.name) : lane.pids[0];
                extraCount = lane.pids.length - 1;
            } else if (lane.morphMode) {
                firstName = 'Morph Lane';
            }
            var pNameHtml = firstName + (extraCount > 0 ? ' <span class="lane-hdr-badge">+' + extraCount + '</span>' : '');
            // Lane header
            h += '<div class="lane-item" data-b="' + b.id + '" data-li="' + li + '">';
            h += '<div class="lane-hdr">';
            h += '<div class="lane-hdr-arrow" data-b="' + b.id + '" data-li="' + li + '">' + (lane.collapsed ? '\u25B6' : '\u25BC') + '</div>';
            h += '<div class="lane-hdr-color" style="background:' + lane.color + '"></div>';
            h += '<div class="lane-hdr-name">' + pNameHtml + '</div>';
            // Right controls
            h += '<div class="lane-hdr-ctrls">';
            h += '<select class="lane-hdr-sel" data-b="' + b.id + '" data-li="' + li + '" data-lf="loopLen">';
            LANE_LOOP_OPTS.forEach(function (o) {
                h += '<option value="' + o.v + '"' + (lane.loopLen === o.v ? ' selected' : '') + '>' + o.label + '</option>';
            });
            h += '</select>';
            // Free seconds input (only visible when loopLen is "free")
            if (lane.loopLen === 'free') {
                h += '<input type="number" class="lane-hdr-fsec" data-b="' + b.id + '" data-li="' + li + '" value="' + (lane.freeSecs || 4) + '" min="0.1" max="60" step="0.1" title="Loop duration in seconds">';
                h += '<span class="lane-hdr-unit">s</span>';
            }
            // Play mode selector
            h += '<select class="lane-hdr-sel lane-hdr-pm" data-b="' + b.id + '" data-li="' + li + '" data-lf="playMode" title="Playhead mode">';
            [{ v: 'forward', l: '\u25B6 Fwd' }, { v: 'reverse', l: '\u25C0 Rev' }, { v: 'pingpong', l: '\u21D4 PP' }, { v: 'random', l: '\u26A1 Rnd' }].forEach(function (m) {
                h += '<option value="' + m.v + '"' + ((lane.playMode || 'forward') === m.v ? ' selected' : '') + '>' + m.l + '</option>';
            });
            h += '</select>';
            // Loop / One-Shot mode selector
            h += '<select class="lane-hdr-sel" data-b="' + b.id + '" data-li="' + li + '" data-lf="trigMode" title="Loop or One-Shot mode">';
            h += '<option value="loop"' + ((lane.trigMode || 'loop') === 'loop' ? ' selected' : '') + '>Loop</option>';
            h += '<option value="oneshot"' + (lane.trigMode === 'oneshot' ? ' selected' : '') + '>One-Shot</option>';
            h += '</select>';
            h += '<span class="lane-hdr-clear" data-b="' + b.id + '" data-li="' + li + '" data-act="clear" title="Clear this lane">\u2298 Clear</span>';
            h += '<span class="lane-hdr-overlay' + (lane._overlayLanes && lane._overlayLanes.length ? ' active' : '') + '" data-b="' + b.id + '" data-li="' + li + '" title="Overlay another lane\'s shape">OVL</span>';
            if (lane.morphMode) {
                h += '<button class="lane-sync-pill' + (lane.synced ? ' on' : '') + '" data-b="' + b.id + '" data-li="' + li + '" style="margin-left:2px;font-size:8px;padding:1px 4px">' + (lane.synced ? 'Host' : 'Int') + '</button>';
            }
            h += '<span class="lane-hdr-mute' + (lane.muted ? '' : ' lit') + '" data-b="' + b.id + '" data-li="' + li + '">' + (lane.muted ? '\u25CB' : '\u25CF') + '</span>';
            h += '<span class="lane-del-btn" data-b="' + b.id + '" data-li="' + li + '" title="Delete this lane">\u00D7</span>';
            h += '</div>'; // ctrls
            h += '</div>'; // hdr

            // Trigger controls row (only visible in oneshot mode)
            if (lane.trigMode === 'oneshot') {
                h += '<div class="lane-trig-row" data-b="' + b.id + '" data-li="' + li + '">';
                h += '<span class="lane-trig-label">Trigger:</span>';
                h += '<select class="lane-hdr-sel" data-b="' + b.id + '" data-li="' + li + '" data-lf="trigSource">';
                h += '<option value="manual"' + ((lane.trigSource || 'manual') === 'manual' ? ' selected' : '') + '>Manual</option>';
                h += '<option value="midi"' + (lane.trigSource === 'midi' ? ' selected' : '') + '>MIDI</option>';
                h += '<option value="audio"' + (lane.trigSource === 'audio' ? ' selected' : '') + '>Audio</option>';
                h += '</select>';
                if (lane.trigSource === 'manual' || !lane.trigSource) {
                    h += '<button class="lane-fire-btn" data-b="' + b.id + '" data-li="' + li + '">\u25B6 Fire</button>';
                }
                if (lane.trigSource === 'midi') {
                    h += '<select class="lane-hdr-sel" data-b="' + b.id + '" data-li="' + li + '" data-lf="trigMidiNote">';
                    h += '<option value="-1"' + ((lane.trigMidiNote == null || lane.trigMidiNote < 0) ? ' selected' : '') + '>Any Note</option>';
                    var noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
                    for (var ni = 0; ni < 128; ni++) {
                        var oct = Math.floor(ni / 12) - 1;
                        h += '<option value="' + ni + '"' + (lane.trigMidiNote === ni ? ' selected' : '') + '>' + noteNames[ni % 12] + oct + '</option>';
                    }
                    h += '</select>';
                    h += '<select class="lane-hdr-sel" data-b="' + b.id + '" data-li="' + li + '" data-lf="trigMidiCh">';
                    h += '<option value="0"' + (!lane.trigMidiCh ? ' selected' : '') + '>Any Ch</option>';
                    for (var ci = 1; ci <= 16; ci++) {
                        h += '<option value="' + ci + '"' + (lane.trigMidiCh === ci ? ' selected' : '') + '>Ch ' + ci + '</option>';
                    }
                    h += '</select>';
                    h += '<label class="lane-trig-chk"><input type="checkbox"' + (lane.trigHold ? ' checked' : '') + ' data-b="' + b.id + '" data-li="' + li + '" data-lf="trigHold"> Hold</label>';
                }
                if (lane.trigSource === 'audio') {
                    var thVal = lane.trigThreshold != null ? lane.trigThreshold : -12;
                    h += '<input type="range" class="lane-trig-slider" min="-48" max="0" value="' + thVal + '" data-b="' + b.id + '" data-li="' + li + '" data-lf="trigThreshold">';
                    h += '<span class="lane-trig-db">' + thVal + ' dB</span>';
                    h += '<select class="lane-hdr-sel" data-b="' + b.id + '" data-li="' + li + '" data-lf="trigAudioSrc">';
                    h += '<option value="main"' + ((lane.trigAudioSrc || 'main') === 'main' ? ' selected' : '') + '>Main</option>';
                    h += '<option value="sidechain"' + (lane.trigAudioSrc === 'sidechain' ? ' selected' : '') + '>SC</option>';
                    h += '</select>';
                }
                h += '<label class="lane-trig-chk"><input type="checkbox"' + (lane.trigRetrigger !== false ? ' checked' : '') + ' data-b="' + b.id + '" data-li="' + li + '" data-lf="trigRetrigger"> Retrig</label>';
                h += '</div>';
            }

            // Lane body (canvas + sidebars)
            if (!lane.collapsed) {
                h += '<div class="lane-body" data-b="' + b.id + '" data-li="' + li + '" style="height:' + LANE_CANVAS_H + 'px">';
                // Left sidebar — mode-dependent
                h += '<div class="lane-lb-left">';
                if (lane.morphMode) {
                    // Auto-select first snapshot if none selected (e.g. after loading from preset)
                    if (lane._selectedSnap == null && lane.morphSnapshots && lane.morphSnapshots.length > 0) {
                        lane._selectedSnap = 0;
                    }
                    // ── MORPH: Per-snapshot drift controls in left sidebar ──
                    var selSnapL = (lane._selectedSnap != null && lane.morphSnapshots && lane.morphSnapshots[lane._selectedSnap]) ? lane.morphSnapshots[lane._selectedSnap] : null;
                    if (selSnapL) {
                        h += '<span class="lane-rb-label">DRIFT</span>';
                        var mDriftVal = selSnapL.drift || 0;
                        var mDriftRng = selSnapL.driftRange != null ? selSnapL.driftRange : 5;
                        h += '<span class="lane-ft-knob lane-morph-knob" data-b="' + b.id + '" data-li="' + li + '" data-lk="morphDrift" title="Drift \u2014 speed & character">Drift ' + (mDriftVal >= 0 ? '+' : '') + mDriftVal + '</span>';
                        h += '<span class="lane-ft-knob lane-morph-knob" data-b="' + b.id + '" data-li="' + li + '" data-lk="morphDriftRange" title="Drift Range \u2014 amplitude %">DftRng ' + mDriftRng + '%</span>';
                        var mDriftSc = selSnapL.driftScale || lane.driftScale || '1/1';
                        var DS_M_OPTS = ['1/16', '1/8', '1/4', '1/2', '1/1', '2/1', '4/1', '8/1', '16/1', '32/1'];
                        h += '<select class="lane-ft-sel lane-morph-knob lane-morph-ds" data-b="' + b.id + '" data-li="' + li + '" data-lf="snapDriftScale" title="Drift Scale (per-snapshot)" style="cursor:pointer">';
                        DS_M_OPTS.forEach(function (dv) {
                            var dLabel = dv;
                            if (dv === '1/1') dLabel = '1 bar';
                            else if (dv === '2/1') dLabel = '2 bars';
                            else if (dv === '4/1') dLabel = '4 bars';
                            else if (dv === '8/1') dLabel = '8 bars';
                            else if (dv === '16/1') dLabel = '16 bars';
                            else if (dv === '32/1') dLabel = '32 bars';
                            h += '<option value="' + dv + '"' + (mDriftSc === dv ? ' selected' : '') + '>' + dLabel + '</option>';
                        });
                        h += '</select>';
                    } else {
                        h += '<span class="lane-rb-label">DRIFT</span>';
                    }
                } else {
                    // ── CURVE: Param list ──
                    h += '<span class="lane-rb-label">PARAMS</span>';
                    h += '<div class="lane-param-list" id="curve-params-' + b.id + '-' + li + '">';
                    for (var pi = 0; pi < lane.pids.length; pi++) {
                        var pp = PMap[lane.pids[pi]];
                        var shortName = pp ? pp.name : lane.pids[pi];
                        if (shortName.length > 8) shortName = shortName.substring(0, 7) + '\u2026';
                        // Auto-select first param if none selected
                        if (lane._selectedParamIdx == null && pi === 0) lane._selectedParamIdx = 0;
                        var isCurveSel = (lane._selectedParamIdx === pi);
                        h += '<div class="lane-param-chip' + (isCurveSel ? ' lane-param-sel' : '') + '" data-b="' + b.id + '" data-li="' + li + '" data-pidx="' + pi + '" data-pid="' + lane.pids[pi] + '" title="' + (pp ? pp.name : lane.pids[pi]) + '" style="cursor:pointer">';
                        h += '<span class="lane-param-chip-name">' + shortName + '</span>';
                        if (isCurveSel) {
                            // Selected param: live value badge (updated by realtime)
                            var valText = pp && pp.disp ? pp.disp : (pp ? (pp.v * 100).toFixed(0) + '%' : '');
                            h += '<span class="lane-param-val-badge" id="cpvb-' + b.id + '-' + li + '">' + valText + '</span>';
                        } else {
                            // Non-selected: static range badge (populated async by C++)
                            h += '<span class="lane-param-val-badge lane-param-range" id="cprng-' + b.id + '-' + li + '-' + pi + '"></span>';
                        }
                        h += '<span class="lane-param-chip-x" data-b="' + b.id + '" data-li="' + li + '" data-pid="' + lane.pids[pi] + '">\u00D7</span>';
                        h += '</div>';
                    }
                    h += '</div>';
                    h += '<button class="lane-add-param-btn" data-b="' + b.id + '" data-li="' + li + '" title="Add parameter to this lane">+ Add</button>';
                }
                h += '</div>'; // lb-left
                // Canvas
                // Hide playhead for empty morph lanes (< 2 snaps) or empty curve lanes (no points + no targets)
                var laneHasData = lane.morphMode
                    ? (lane.morphSnapshots && lane.morphSnapshots.length >= 2)
                    : (lane.pts && lane.pts.length > 0) || (lane.pids && lane.pids.length > 0);
                h += '<div class="lane-canvas-wrap" id="lcw-' + b.id + '-' + li + '" style="position:relative">';
                h += '<canvas class="lane-canvas" id="lcv-' + b.id + '-' + li + '"></canvas>';
                h += '<div class="lane-playhead" id="lph-' + b.id + '-' + li + '"' + (laneHasData ? '' : ' style="display:none"') + '></div>';
                h += '<div class="lane-val-indicator" id="lvi-' + b.id + '-' + li + '"' + (laneHasData ? '' : ' style="display:none"') + '></div>';
                h += '</div>';
                // Right sidebar — mode-dependent
                h += '<div class="lane-lb-right">';
                if (lane.morphMode) {
                    // ── MORPH: per-snapshot effect knobs ──
                    var selSnap2 = (lane._selectedSnap != null && lane.morphSnapshots && lane.morphSnapshots[lane._selectedSnap]) ? lane.morphSnapshots[lane._selectedSnap] : null;
                    if (selSnap2) {
                        h += '<span class="lane-rb-label">EFFECTS</span>';
                        var sDepth = selSnap2.depth != null ? Math.round(selSnap2.depth * 100) : 100;
                        var sWarp = selSnap2.warp || 0;
                        var sSteps = selSnap2.steps || 0;
                        h += '<span class="lane-ft-knob lane-morph-knob" data-b="' + b.id + '" data-li="' + li + '" data-lk="morphDepth" title="Depth \u2014 drag vertical">Dpth ' + sDepth + '%</span>';
                        h += '<span class="lane-ft-knob lane-morph-knob" data-b="' + b.id + '" data-li="' + li + '" data-lk="morphWarp" title="Warp \u2014 drag vertical">Warp ' + (sWarp >= 0 ? '+' : '') + sWarp + '</span>';
                        h += '<span class="lane-ft-knob lane-morph-knob" data-b="' + b.id + '" data-li="' + li + '" data-lk="morphSteps" title="Steps \u2014 quantize">Step ' + (sSteps || 'Off') + '</span>';
                    }
                } else {
                    h += '<span class="lane-rb-label">INTERP</span>';
                    h += '<div class="lane-interp-stack">';
                    h += '<button class="lane-ibtn' + (lane.interp === 'smooth' ? ' on' : '') + '" data-b="' + b.id + '" data-li="' + li + '" data-linterp="smooth">Smooth</button>';
                    h += '<button class="lane-ibtn' + (lane.interp === 'step' ? ' on' : '') + '" data-b="' + b.id + '" data-li="' + li + '" data-linterp="step">Step</button>';
                    h += '<button class="lane-ibtn' + (lane.interp === 'linear' ? ' on' : '') + '" data-b="' + b.id + '" data-li="' + li + '" data-linterp="linear">Linear</button>';
                    h += '</div>';
                    h += '<span class="lane-rb-label" style="margin-top:4px">SYNC</span>';
                    h += '<button class="lane-sync-pill' + (lane.synced ? ' on' : '') + '" data-b="' + b.id + '" data-li="' + li + '">' + (lane.synced ? 'Host' : 'Int') + '</button>';
                }
                h += '</div>'; // lb-right
                h += '</div>'; // lane-body

                // Lane footer — mode-dependent controls
                h += '<div class="lane-footer" data-b="' + b.id + '" data-li="' + li + '">';
                if (lane.morphMode) {
                    // ── MORPH FOOTER — Capture + Library left, per-snapshot controls right ──
                    var capSrc = lane._captureSource;
                    var capName = '';
                    if (capSrc && capSrc !== 'all' && typeof pluginBlocks !== 'undefined') {
                        for (var ci = 0; ci < pluginBlocks.length; ci++) {
                            if (String(pluginBlocks[ci].id) === String(capSrc)) { capName = pluginBlocks[ci].name || capSrc; break; }
                        }
                    }
                    if (capSrc && capName) {
                        var capShort = capName.length > 10 ? capName.substring(0, 9) + '\u2026' : capName;
                        h += '<button class="lane-ft-btn lane-sidebar-capture lane-cap-direct" data-b="' + b.id + '" data-li="' + li + '" data-act="capture-direct" title="Capture from ' + capName + '">Capture ' + capShort + '</button>';
                        h += '<span class="lane-cap-reset" data-b="' + b.id + '" data-li="' + li + '" title="Pick different source">\u00D7</span>';
                    } else {
                        h += '<button class="lane-ft-btn lane-sidebar-capture" data-b="' + b.id + '" data-li="' + li + '" data-act="capture-assigned" title="Capture snapshots">Capture \u25BE</button>';
                    }
                    h += '<button class="lane-ft-btn lane-morph-lib-btn" data-b="' + b.id + '" data-li="' + li + '" title="Load from library">Library</button>';
                    h += '<div class="lane-ft-spacer"></div>';
                    var selSnap = (lane._selectedSnap != null && lane.morphSnapshots && lane.morphSnapshots[lane._selectedSnap]) ? lane.morphSnapshots[lane._selectedSnap] : null;
                    if (selSnap) {
                        h += '<span class="lane-ft-sel-label">' + (selSnap.name || 'S' + (lane._selectedSnap + 1)) + '</span>';
                        h += '<span class="lane-ft-knob" data-b="' + b.id + '" data-li="' + li + '" data-lk="morphHold" title="Hold zone \u2014 drag vertical">Hold ' + Math.round((selSnap.hold != null ? selSnap.hold : 0.5) * 100) + '%</span>';
                        h += '<select class="lane-hdr-sel lane-morph-curve-sel" data-b="' + b.id + '" data-li="' + li + '" title="Transition curve">';
                        [{ v: 0, l: 'Smooth' }, { v: 1, l: 'Linear' }, { v: 2, l: 'Sharp' }, { v: 3, l: 'Late' }].forEach(function (c) {
                            h += '<option value="' + c.v + '"' + ((selSnap.curve || 0) === c.v ? ' selected' : '') + '>' + c.l + '</option>';
                        });
                        h += '</select>';
                        h += '<span class="lane-ft-info">' + Object.keys(selSnap.values).length + 'p</span>';
                        h += '<button class="lane-ft-btn lane-ft-del" data-b="' + b.id + '" data-li="' + li + '" data-act="delete-snap" title="Delete selected snapshot">\u2716</button>';
                    } else {
                        h += '<span class="lane-ft-info" style="opacity:0.5">Select a snapshot</span>';
                    }
                } else {
                    // ── CURVE FOOTER ──
                    var depthVal = lane.depth != null ? lane.depth : 100;
                    var warpVal = lane.warp || 0, stepsVal = lane.steps || 0;
                    var driftVal = lane.drift || 0, driftRng = lane.driftRange != null ? lane.driftRange : 5;
                    var driftSc = lane.driftScale || '1/1';
                    // Group 1: Depth, Warp, Steps
                    h += '<span class="lane-ft-knob" data-b="' + b.id + '" data-li="' + li + '" data-lk="depth" title="Depth \u2014 drag vertical to adjust">Depth ' + depthVal + '%</span>';
                    h += '<span class="lane-ft-knob" data-b="' + b.id + '" data-li="' + li + '" data-lk="warp" title="Warp \u2014 drag vertical to adjust">Warp ' + (warpVal >= 0 ? '+' : '') + warpVal + '</span>';
                    h += '<span class="lane-ft-knob" data-b="' + b.id + '" data-li="' + li + '" data-lk="steps" title="Steps \u2014 quantize output to N levels">Steps ' + (stepsVal || 'Off') + '</span>';
                    // Separator
                    h += '<span class="lane-ft-sep">|</span>';
                    // Group 2: Drift, DftRng, DriftScale
                    h += '<span class="lane-ft-knob" data-b="' + b.id + '" data-li="' + li + '" data-lk="drift" title="Drift \u2014 speed & character (+slow / -jitter, >70% = sharp)">Drift ' + (driftVal >= 0 ? '+' : '') + driftVal + '</span>';
                    h += '<span class="lane-ft-knob" data-b="' + b.id + '" data-li="' + li + '" data-lk="driftRange" title="Drift Range \u2014 amplitude as % of full parameter range">DftRng ' + driftRng + '%</span>';
                    // Drift Scale dropdown
                    var DS_OPTS = ['1/16', '1/8', '1/4', '1/2', '1/1', '2/1', '4/1', '8/1', '16/1', '32/1'];
                    h += '<select class="lane-ft-sel" data-b="' + b.id + '" data-li="' + li + '" data-lf="driftScale" title="Drift Scale \u2014 musical period for one drift cycle">';
                    DS_OPTS.forEach(function (dv) {
                        var dLabel = dv;
                        if (dv === '1/1') dLabel = '1 bar';
                        else if (dv === '2/1') dLabel = '2 bars';
                        else if (dv === '4/1') dLabel = '4 bars';
                        else if (dv === '8/1') dLabel = '8 bars';
                        else if (dv === '16/1') dLabel = '16 bars';
                        else if (dv === '32/1') dLabel = '32 bars';
                        h += '<option value="' + dv + '"' + (driftSc === dv ? ' selected' : '') + '>' + dLabel + '</option>';
                    });
                    h += '</select>';
                    h += '<div class="lane-ft-spacer"></div>';
                    h += '<button class="lane-ft-btn" data-b="' + b.id + '" data-li="' + li + '" data-act="random" title="Randomize this lane">\u2684 Random</button>';
                    h += '<button class="lane-ft-btn" data-b="' + b.id + '" data-li="' + li + '" data-act="invert" title="Invert curve vertically">\u2195 Invert</button>';
                    h += '<div class="lane-ft-shapes" style="position:relative;display:inline-block">';
                    h += '<button class="lane-ft-btn" data-b="' + b.id + '" data-li="' + li + '" data-act="shapes" title="Preset shapes">\u223F Shape \u25BE</button>';
                    h += '</div>';
                }
                h += '</div>'; // lane-footer

                // ── MORPH: Snapshot + Param lists below footer ──
                if (lane.morphMode) {
                    var MP_COLS = ['#ff6464', '#64b4ff', '#64dc8c', '#ffc850', '#c882ff', '#ff8cb4', '#50dcdc', '#dca064', '#a0ffa0', '#b48cdc', '#ffb478', '#78c8c8'];
                    h += '<div class="lane-morph-lists" data-b="' + b.id + '" data-li="' + li + '">';
                    // Left half: Snapshots
                    h += '<div class="lane-morph-col">';
                    h += '<div class="lane-morph-col-head"><span class="lane-morph-col-label">SNAPSHOTS</span></div>';
                    h += '<div class="lane-snap-list lane-morph-scroll">';
                    var snaps = lane.morphSnapshots || [];
                    for (var si = 0; si < snaps.length; si++) {
                        var isSel = (lane._selectedSnaps && lane._selectedSnaps.has(si)) || lane._selectedSnap === si;
                        var holdPct = Math.round((snaps[si].hold != null ? snaps[si].hold : 0.5) * 100);
                        var pCnt = Object.keys(snaps[si].values).length;
                        h += '<div class="lane-snap-item' + (isSel ? ' sel' : '') + '" data-b="' + b.id + '" data-li="' + li + '" data-si="' + si + '">';
                        h += '<span class="lane-snap-num" style="color:' + lane.color + '">' + (si + 1) + '</span>';
                        h += '<span class="lane-snap-name">' + (snaps[si].name || 'S' + (si + 1)) + '</span>';
                        h += '<span class="lane-snap-hold">' + pCnt + 'p ' + holdPct + '%</span>';
                        h += '<span class="lane-snap-del" data-b="' + b.id + '" data-li="' + li + '" data-si="' + si + '">\u00D7</span>';
                        h += '</div>';
                    }
                    if (snaps.length === 0) {
                        h += '<span class="lane-morph-empty">No snapshots \u2014 use Capture</span>';
                    }
                    h += '</div>';
                    h += '</div>';
                    // Right half: Params
                    h += '<div class="lane-morph-col">';
                    h += '<div class="lane-morph-col-head"><span class="lane-morph-col-label">PARAMETERS</span>';
                    h += '<input class="lane-morph-search" data-b="' + b.id + '" data-li="' + li + '" type="text" placeholder="Search…" spellcheck="false"></div>';
                    h += '<div class="lane-param-list lane-morph-scroll" id="morph-params-' + b.id + '-' + li + '">';
                    if (lane.pids && lane.pids.length > 0) {
                        for (var mpi = 0; mpi < lane.pids.length; mpi++) {
                            var mpp = PMap[lane.pids[mpi]];
                            var mpName = mpp ? mpp.name : lane.pids[mpi];
                            var dotCol = MP_COLS[mpi % MP_COLS.length];
                            var isMorphSel = (lane._selectedParamIdx === mpi);
                            h += '<div class="lane-param-chip lane-morph-param' + (isMorphSel ? ' lane-param-sel' : '') + '" data-b="' + b.id + '" data-li="' + li + '" data-pidx="' + mpi + '" data-pid="' + lane.pids[mpi] + '" title="' + (mpp ? mpp.name : lane.pids[mpi]) + '" style="cursor:pointer">';
                            h += '<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:' + dotCol + ';margin-right:4px;flex-shrink:0"></span>';
                            h += '<span class="lane-param-chip-name">' + mpName + '</span>';
                            if (isMorphSel) {
                                var mValText = mpp && mpp.disp ? mpp.disp : (mpp ? (mpp.v * 100).toFixed(0) + '%' : '');
                                h += '<span class="lane-param-val-badge" id="mpvb-' + b.id + '-' + li + '">' + mValText + '</span>';
                            } else {
                                h += '<span class="lane-param-val-badge lane-param-range" id="mprng-' + b.id + '-' + li + '-' + mpi + '"></span>';
                            }
                            h += '<span class="lane-param-chip-x" data-b="' + b.id + '" data-li="' + li + '" data-pid="' + lane.pids[mpi] + '">&times;</span>';
                            h += '</div>';
                        }
                    }
                    h += '</div>';
                    h += '<button class="lane-add-param-btn" data-b="' + b.id + '" data-li="' + li + '" title="Add parameter">+ Add</button>';
                    h += '</div>';
                    h += '</div>'; // lane-morph-lists
                }
            }
            h += '</div>'; // lane-item
        }
        h += '</div>'; // lane-stack
    }
    // Add Lane buttons — always visible at bottom of lane section
    h += '<div class="lane-add-btns">';
    h += '<button class="lane-add-btn lane-add-curve-btn" data-b="' + b.id + '">+ Param Lane</button>';
    h += '<button class="lane-add-btn lane-add-morph-btn" data-b="' + b.id + '">+ Morph Lane</button>';
    h += '</div>';
    h += '</div>'; // block-section
    return h;
}

// -"-"- Lane canvas drawing engine -"-"-
function laneCanvasSetup(b) {
    if (!b.lanes) return;
    var dpr = window.devicePixelRatio || 1;
    for (var li = 0; li < b.lanes.length; li++) {
        var lane = b.lanes[li];
        if (lane.collapsed) continue;
        var cvs = document.getElementById('lcv-' + b.id + '-' + li);
        var wrap = document.getElementById('lcw-' + b.id + '-' + li);
        if (!cvs || !wrap) continue;
        // HiDPI: scale canvas buffer for crisp rendering
        var cssW = wrap.clientWidth || 300;
        var cssH = wrap.clientHeight || LANE_CANVAS_H;
        cvs.width = cssW * dpr;
        cvs.height = cssH * dpr;
        cvs.style.width = cssW + 'px';
        cvs.style.height = cssH + 'px';
        var ctx = cvs.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        laneDrawCanvas(b, li);
        laneSetupMouse(b, li);
        laneSetupFooter(b, li);
        if (lane.morphMode) laneSetupMorphSidebar(b, li);
    }
    // (Add Lane buttons are wired in wireBlocks — logic_blocks.js)
    // Drop params onto lanes — drag from plugin rack onto a lane header or body
    document.querySelectorAll('.lane-item[data-b="' + b.id + '"]').forEach(function (laneEl) {
        laneEl.addEventListener('dragover', function (e) {
            if (e.dataTransfer.types.indexOf('text/plain') === -1) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            // Use this lane's color for the highlight
            var li = parseInt(laneEl.dataset.li);
            var lane = b.lanes && b.lanes[li];
            var col = lane ? lane.color : 'var(--drag-highlight, var(--accent))';
            laneEl.style.outline = '2px dashed ' + col;
            laneEl.style.outlineOffset = '-2px';
            laneEl.style.background = col + '12'; // subtle 7% tint via hex alpha
        });
        laneEl.addEventListener('dragleave', function () {
            laneEl.style.outline = '';
            laneEl.style.outlineOffset = '';
            laneEl.style.background = '';
        });
        laneEl.addEventListener('drop', function (e) {
            e.preventDefault();
            e.stopPropagation();
            laneEl.style.outline = '';
            laneEl.style.outlineOffset = '';
            laneEl.style.background = '';
            var data = e.dataTransfer.getData('text/plain');
            if (!data || data.indexOf('params:') !== 0) return;
            var pids = data.replace('params:', '').split(',');
            var li = parseInt(laneEl.dataset.li);
            var lane = b.lanes[li];
            if (!lane) return;
            pids.forEach(function (pid) {
                var pp = PMap[pid];
                if (pp && !pp.lk) {
                    assignTarget(b, pid);
                    if (lane.pids.indexOf(pid) < 0) lane.pids.push(pid);
                }
            });
            selectedParams.clear();
            renderSingleBlock(b.id);
            renderAllPlugins();
            syncBlocksToHost();
        });
    });
}

// Morph lane sidebar wiring — snapshot list clicks, delete, library
var morphLaneLibTarget = null; // { blockId, laneIdx } — set when library is opened for a morph lane

function laneSetupMorphSidebar(b, li) {
    var lane = b.lanes[li];
    if (!lane || !lane.morphMode) return;

    // Snapshot items — click to select, double-click to rename
    document.querySelectorAll('.lane-snap-item[data-b="' + b.id + '"][data-li="' + li + '"]').forEach(function (el) {
        el.onclick = function (e) {
            if (e.target.classList.contains('lane-snap-del') || e.target.classList.contains('lane-snap-hold')) return;
            var si = parseInt(el.dataset.si);
            // Initialize multi-select set if needed
            if (!lane._selectedSnaps) lane._selectedSnaps = new Set();
            if (e.ctrlKey || e.metaKey) {
                // Toggle this snapshot in multi-select
                if (lane._selectedSnaps.has(si)) {
                    lane._selectedSnaps.delete(si);
                    // Update primary to another selected, or -1
                    if (lane._selectedSnaps.size > 0) {
                        var arr = Array.from(lane._selectedSnaps);
                        lane._selectedSnap = arr[arr.length - 1];
                    } else {
                        lane._selectedSnap = -1;
                    }
                } else {
                    lane._selectedSnaps.add(si);
                    lane._selectedSnap = si;
                }
            } else if (e.shiftKey && lane._selectedSnap != null && lane._selectedSnap >= 0) {
                // Shift+click: range select from last primary to this
                var from = lane._selectedSnap;
                var to = si;
                var lo = Math.min(from, to), hi = Math.max(from, to);
                for (var ri = lo; ri <= hi; ri++) {
                    lane._selectedSnaps.add(ri);
                }
                lane._selectedSnap = si;
            } else {
                // Regular click → single select
                lane._selectedSnaps.clear();
                lane._selectedSnaps.add(si);
                lane._selectedSnap = si;
            }
            // Update visual highlights
            document.querySelectorAll('.lane-snap-item[data-b="' + b.id + '"][data-li="' + li + '"]').forEach(function (item) {
                item.classList.toggle('sel', lane._selectedSnaps.has(parseInt(item.dataset.si)));
            });
            // Apply primary snapshot values to hosted plugin (audition)
            var snap = lane.morphSnapshots && lane.morphSnapshots[lane._selectedSnap];
            if (snap && snap.values && window.__JUCE__ && window.__JUCE__.backend) {
                var batch = [];
                var keys = Object.keys(snap.values);
                for (var ki = 0; ki < keys.length; ki++) {
                    var pp = PMap[keys[ki]];
                    if (pp && pp.hostId !== undefined && pp.realIndex !== undefined) {
                        pp.v = snap.values[keys[ki]];
                        batch.push({ p: pp.hostId, i: pp.realIndex, v: pp.v });
                    }
                }
                if (batch.length > 0) {
                    var batchFn = window.__juceGetNativeFunction('applyParamBatch');
                    if (batchFn) batchFn(JSON.stringify(batch));
                }
            }
            laneDrawCanvas(b, li);
            renderSingleBlock(b.id);
        };
        el.ondblclick = function (e) {
            e.stopPropagation();
            var si = parseInt(el.dataset.si);
            var snap = lane.morphSnapshots[si];
            if (!snap) return;
            var nameEl = el.querySelector('.lane-snap-name');
            if (!nameEl) return;
            var inp = document.createElement('input');
            inp.type = 'text';
            inp.value = snap.name || '';
            inp.className = 'morph-inline-edit';
            inp.style.cssText = 'width:100%;position:static;margin:0;';
            nameEl.replaceWith(inp);
            inp.focus();
            inp.select();
            function commit() {
                snap.name = inp.value || snap.name;
                laneDrawCanvas(b, li);
                renderSingleBlock(b.id);
                syncBlocksToHost();
            }
            inp.onkeydown = function (ke) { if (ke.key === 'Enter') commit(); if (ke.key === 'Escape') { renderSingleBlock(b.id); } };
            inp.onblur = commit;
        };
        // Right-click context menu on snapshot list items
        el.oncontextmenu = function (e) {
            e.preventDefault();
            e.stopPropagation();
            var si = parseInt(el.dataset.si);
            var snap = lane.morphSnapshots[si];
            if (!snap) return;
            if (!lane._selectedSnaps) lane._selectedSnaps = new Set();
            // If right-clicking outside current selection, make it the sole selection
            if (!lane._selectedSnaps.has(si)) {
                lane._selectedSnaps.clear();
                lane._selectedSnaps.add(si);
            }
            lane._selectedSnap = si;
            laneDrawCanvas(b, li);
            // Update selection visuals
            document.querySelectorAll('.lane-snap-item[data-b="' + b.id + '"][data-li="' + li + '"]').forEach(function (item) {
                item.classList.toggle('sel', lane._selectedSnaps.has(parseInt(item.dataset.si)));
            });
            // Remove existing menus
            var old = document.querySelector('.morph-ctx-menu');
            if (old) old.remove();
            var menu = document.createElement('div');
            menu.className = 'morph-ctx-menu lane-add-menu';
            menu.style.cssText = 'position:fixed;left:' + e.clientX + 'px;top:' + e.clientY + 'px;z-index:9999;min-width:130px;';
            var selCount = lane._selectedSnaps.size;
            var batchSuffix = selCount > 1 ? ' (' + selCount + ')' : '';
            var items = [
                {
                    label: 'Duplicate' + batchSuffix, key: selCount <= 1 ? 'Ctrl+D' : '', action: function () {
                        pushUndoSnapshot();
                        var idxs = Array.from(lane._selectedSnaps).sort(function (a, c) { return a - c; });
                        for (var di = idxs.length - 1; di >= 0; di--) { _morphSnapDuplicate(b, li, lane, idxs[di]); }
                    }
                },
                {
                    label: 'Recapture' + batchSuffix, action: function () {
                        pushUndoSnapshot();
                        lane._selectedSnaps.forEach(function (idx) {
                            var s = lane.morphSnapshots[idx]; if (!s) return;
                            (lane.pids || []).forEach(function (pid) { var pp = PMap[pid]; if (pp && !pp.lk) s.values[pid] = pp.v; });
                        });
                        laneDrawCanvas(b, li); syncBlocksToHost();
                    }
                }
            ];
            // Only show Rename for single selection
            if (selCount <= 1) {
                items.splice(1, 0, { label: 'Rename', action: function () { var nameEl2 = el.querySelector('.lane-snap-name'); if (nameEl2) { el.ondblclick(e); } } });
            }
            items.push({ label: '---' });
            // Curve options — apply to all selected
            var curveLabels = ['Smooth', 'Linear', 'Sharp', 'Late'];
            for (var ci = 0; ci < curveLabels.length; ci++) {
                (function (cIdx) {
                    var allMatch = true;
                    lane._selectedSnaps.forEach(function (idx) { var s = lane.morphSnapshots[idx]; if (s && (s.curve || 0) !== cIdx) allMatch = false; });
                    items.push({
                        label: curveLabels[cIdx] + (allMatch ? ' \u2713' : '') + batchSuffix, action: function () {
                            lane._selectedSnaps.forEach(function (idx) { var s = lane.morphSnapshots[idx]; if (s) s.curve = cIdx; });
                            laneDrawCanvas(b, li); renderSingleBlock(b.id); syncBlocksToHost();
                        }
                    });
                })(ci);
            }
            items.push({ label: '---' });
            items.push({
                label: 'Delete' + batchSuffix, action: function () {
                    pushUndoSnapshot();
                    var idxs = Array.from(lane._selectedSnaps).sort(function (a, c) { return c - a; }); // reverse order
                    for (var di = 0; di < idxs.length; di++) { lane.morphSnapshots.splice(idxs[di], 1); }
                    if (lane.morphSnapshots.length > 1) { lane.morphSnapshots[0].position = 0; lane.morphSnapshots[lane.morphSnapshots.length - 1].position = 1; }
                    else if (lane.morphSnapshots.length === 1) { lane.morphSnapshots[0].position = 0; }
                    lane._selectedSnap = -1; lane._selectedSnaps.clear();
                    laneDrawCanvas(b, li); renderSingleBlock(b.id); syncBlocksToHost();
                }
            });
            items.forEach(function (item) {
                if (item.label === '---') {
                    var sep = document.createElement('div');
                    sep.style.cssText = 'height:1px;background:var(--border);margin:3px 0;';
                    menu.appendChild(sep);
                    return;
                }
                var row = document.createElement('div');
                row.className = 'lane-add-menu-item';
                row.textContent = item.label;
                if (item.key) {
                    var kbd = document.createElement('span');
                    kbd.style.cssText = 'float:right;opacity:0.4;font-size:9px;margin-left:12px;';
                    kbd.textContent = item.key;
                    row.appendChild(kbd);
                }
                row.onclick = function (me) { me.stopPropagation(); menu.remove(); item.action(); };
                menu.appendChild(row);
            });
            document.body.appendChild(menu);
            setTimeout(function () {
                function dismiss(de) { if (menu.contains(de.target)) return; if (menu.parentNode) menu.remove(); document.removeEventListener('mousedown', dismiss); }
                document.addEventListener('mousedown', dismiss);
            }, 50);
        };
    });

    // Snapshot delete buttons
    document.querySelectorAll('.lane-snap-del[data-b="' + b.id + '"][data-li="' + li + '"]').forEach(function (el) {
        el.onclick = function (e) {
            e.stopPropagation();
            var si = parseInt(el.dataset.si);
            if (!lane.morphSnapshots || !lane.morphSnapshots[si]) return;
            pushUndoSnapshot();
            lane.morphSnapshots.splice(si, 1);
            // Fix edge positions
            if (lane.morphSnapshots.length > 1) {
                lane.morphSnapshots[0].position = 0;
                lane.morphSnapshots[lane.morphSnapshots.length - 1].position = 1;
            } else if (lane.morphSnapshots.length === 1) {
                lane.morphSnapshots[0].position = 0;
            }
            lane._selectedSnap = -1;
            laneDrawCanvas(b, li);
            renderSingleBlock(b.id);
            syncBlocksToHost();
        };
    });

    // Ctrl+A to select all snapshots
    var snapList = document.querySelector('.lane-snap-list');
    if (snapList) {
        // Make focusable so keydown fires
        if (!snapList.getAttribute('tabindex')) snapList.setAttribute('tabindex', '-1');
        snapList.onkeydown = function (e) {
            if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
                e.preventDefault();
                if (!lane._selectedSnaps) lane._selectedSnaps = new Set();
                var snaps = lane.morphSnapshots || [];
                for (var ai = 0; ai < snaps.length; ai++) lane._selectedSnaps.add(ai);
                if (snaps.length > 0) lane._selectedSnap = snaps.length - 1;
                // Update visual highlights
                document.querySelectorAll('.lane-snap-item[data-b="' + b.id + '"][data-li="' + li + '"]').forEach(function (item) {
                    item.classList.toggle('sel', lane._selectedSnaps.has(parseInt(item.dataset.si)));
                });
                laneDrawCanvas(b, li);
                renderSingleBlock(b.id);
            }
        };
    }

    // Snapshot drag reorder in sidebar
    var snapItems = document.querySelectorAll('.lane-snap-item[data-b="' + b.id + '"][data-li="' + li + '"]');
    function clearSnapDragIndicators() {
        snapItems.forEach(function (s) { s.style.borderTop = ''; s.style.borderBottom = ''; s.style.opacity = ''; });
    }
    snapItems.forEach(function (el) {
        el.draggable = true;
        el.ondragstart = function (e) {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/snap-reorder', el.dataset.si);
            // Dim all selected items if dragging from a batch
            var si = parseInt(el.dataset.si);
            var selSet = lane._selectedSnaps;
            if (selSet && selSet.size > 1 && selSet.has(si)) {
                snapItems.forEach(function (s) {
                    if (selSet.has(parseInt(s.dataset.si))) s.style.opacity = '0.3';
                });
            } else {
                el.style.opacity = '0.3';
            }
        };
        el.ondragend = function () { clearSnapDragIndicators(); };
        el.ondragover = function (e) {
            if (!e.dataTransfer.types.some(function (t) { return t === 'text/snap-reorder'; })) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            // Clear indicators on all items, then set on this one
            snapItems.forEach(function (s) { s.style.borderTop = ''; s.style.borderBottom = ''; });
            var rect = el.getBoundingClientRect();
            var above = e.clientY < rect.top + rect.height / 2;
            el.style.borderTop = above ? '2px solid var(--accent)' : '';
            el.style.borderBottom = above ? '' : '2px solid var(--accent)';
        };
        el.ondragleave = function () { el.style.borderTop = ''; el.style.borderBottom = ''; };
        el.ondrop = function (e) {
            e.preventDefault();
            clearSnapDragIndicators();
            try {
                var fromStr = e.dataTransfer.getData('text/snap-reorder');
                if (!fromStr && fromStr !== '0') return;
                var from = parseInt(fromStr);
                var dropTarget = parseInt(el.dataset.si);
                if (isNaN(from) || isNaN(dropTarget)) return;
                var snaps = lane.morphSnapshots;
                if (!snaps || from < 0 || from >= snaps.length) return;
                if (dropTarget < 0 || dropTarget >= snaps.length) return;

                // Determine insertion point
                var rect = el.getBoundingClientRect();
                var insertBefore = e.clientY < rect.top + rect.height / 2;

                // Collect indices to move: if dragged item is in selection, move all selected; else just the one
                var selSet = lane._selectedSnaps;
                var dragIsSelected = selSet && selSet.size > 1 && selSet.has(from);
                var moveIndices;
                if (dragIsSelected) {
                    moveIndices = Array.from(selSet).sort(function (a, c) { return a - c; });
                } else {
                    moveIndices = [from];
                }

                // If drop target is within the selection, nothing to do
                if (dragIsSelected && selSet.has(dropTarget)) return;

                pushUndoSnapshot();

                // Extract the selected snapshots (in order), keeping track
                var movedSnaps = [];
                for (var mi = moveIndices.length - 1; mi >= 0; mi--) {
                    movedSnaps.unshift(snaps.splice(moveIndices[mi], 1)[0]);
                }

                // Recalculate insertion index in the now-shortened array
                // Find where the drop target ended up after removals
                var newDropIdx;
                if (insertBefore) {
                    // Insert before the drop target's new position
                    // Count how many selected items were before dropTarget
                    var removedBefore = 0;
                    for (var ri = 0; ri < moveIndices.length; ri++) {
                        if (moveIndices[ri] < dropTarget) removedBefore++;
                    }
                    newDropIdx = dropTarget - removedBefore;
                } else {
                    // Insert after the drop target's new position
                    var removedBefore2 = 0;
                    for (var ri2 = 0; ri2 < moveIndices.length; ri2++) {
                        if (moveIndices[ri2] < dropTarget) removedBefore2++;
                    }
                    newDropIdx = dropTarget - removedBefore2 + 1;
                }
                if (newDropIdx < 0) newDropIdx = 0;
                if (newDropIdx > snaps.length) newDropIdx = snaps.length;

                // Re-insert the batch at the computed position
                for (var ii = 0; ii < movedSnaps.length; ii++) {
                    snaps.splice(newDropIdx + ii, 0, movedSnaps[ii]);
                }

                // Redistribute positions evenly
                if (snaps.length > 1) {
                    for (var si = 0; si < snaps.length; si++)
                        snaps[si].position = si / (snaps.length - 1);
                } else if (snaps.length === 1) {
                    snaps[0].position = 0;
                }

                // Update selection to new indices
                if (selSet) {
                    selSet.clear();
                    for (var ni = 0; ni < movedSnaps.length; ni++) {
                        selSet.add(newDropIdx + ni);
                    }
                }
                lane._selectedSnap = newDropIdx;

                laneDrawCanvas(b, li);
                renderSingleBlock(b.id);
                syncBlocksToHost();
            } catch (err) {
                console.error('[MorphLane] Snapshot reorder failed:', err);
            }
        };
    });

    // Morph params search filter
    document.querySelectorAll('.lane-morph-search[data-b="' + b.id + '"][data-li="' + li + '"]').forEach(function (inp) {
        inp.oninput = function () {
            var q = inp.value.toLowerCase();
            var container = document.getElementById('morph-params-' + b.id + '-' + li);
            if (!container) return;
            container.querySelectorAll('.lane-morph-param').forEach(function (chip) {
                var nameEl = chip.querySelector('.lane-param-chip-name');
                var name = nameEl ? nameEl.textContent.toLowerCase() : '';
                chip.style.display = (q === '' || name.indexOf(q) >= 0) ? '' : 'none';
            });
        };
        // Prevent keyboard shortcuts from firing while typing
        inp.onkeydown = function (e) { e.stopPropagation(); };
    });

    // Library button — opens snapshot library targeting this morph lane
    document.querySelectorAll('.lane-morph-lib-btn[data-b="' + b.id + '"][data-li="' + li + '"]').forEach(function (btn) {
        btn.onclick = function (e) {
            e.stopPropagation();
            morphLaneLibTarget = { blockId: b.id, laneIdx: li };
            if (typeof openSnapshotLibrary === 'function') openSnapshotLibrary(b.id);
        };
    });

    // Shared capture helper
    function _morphDoCapture(b, lane, li, filterFn) {
        pushUndoSnapshot();
        if (!lane.morphSnapshots) lane.morphSnapshots = [];
        var vals = {};
        var hadPids = lane.pids && lane.pids.length > 0;
        if (hadPids) {
            // Lane already has assigned params — only capture values for those pids
            lane.pids.forEach(function (pid) {
                var p = PMap[pid];
                if (p && !p.lk) vals[pid] = p.v;
            });
        } else if (typeof pluginBlocks !== 'undefined') {
            // Lane is empty — add the filtered plugin's params as new pids
            pluginBlocks.forEach(function (pb) {
                if (!filterFn(pb)) return;
                pb.params.forEach(function (p) {
                    if (!p.lk && !p.alk) {
                        vals[p.id] = p.v;
                        if (lane.pids.indexOf(p.id) < 0) lane.pids.push(p.id);
                        assignTarget(b, p.id);
                    }
                });
            });
        }
        var snap = { position: 0, hold: 0.5, curve: 0, name: 'S' + (lane.morphSnapshots.length + 1), source: '', values: vals };
        lane.morphSnapshots.push(snap);
        if (lane.morphSnapshots.length > 1) {
            for (var si = 0; si < lane.morphSnapshots.length; si++)
                lane.morphSnapshots[si].position = si / (lane.morphSnapshots.length - 1);
        } else { lane.morphSnapshots[0].position = 0; }
        lane._selectedSnap = lane.morphSnapshots.length - 1;
        if (typeof selectedParams !== 'undefined') selectedParams.clear();
        laneDrawCanvas(b, li);
        renderSingleBlock(b.id);
        if (typeof renderAllPlugins === 'function') renderAllPlugins();
        syncBlocksToHost();
    }

    // Capture reset button (✕) — clears remembered source
    document.querySelectorAll('.lane-cap-reset[data-b="' + b.id + '"][data-li="' + li + '"]').forEach(function (el) {
        el.onclick = function (e) {
            e.stopPropagation();
            lane._captureSource = null;
            renderSingleBlock(b.id);
        };
    });

    // Capture button — direct mode (plugin already selected) or dropdown picker
    document.querySelectorAll('.lane-sidebar-capture[data-b="' + b.id + '"][data-li="' + li + '"]').forEach(function (btn) {
        btn.onclick = function (e) {
            e.stopPropagation();

            // Direct capture mode — plugin already chosen
            if (btn.classList.contains('lane-cap-direct') && lane._captureSource) {
                var srcId = String(lane._captureSource);
                _morphDoCapture(b, lane, li, function (pb) { return String(pb.id) === srcId; });
                return;
            }

            // Dropdown picker mode
            var old = document.querySelector('.morph-capture-menu');
            if (old) old.remove();

            var menu = document.createElement('div');
            menu.className = 'morph-capture-menu lane-add-menu';
            menu.style.position = 'fixed';
            menu.style.zIndex = '999';
            var rect = btn.getBoundingClientRect();
            menu.style.left = rect.left + 'px';
            menu.style.bottom = (window.innerHeight - rect.top + 2) + 'px';

            // "Selected Params" option if any are selected
            if (typeof selectedParams !== 'undefined' && selectedParams.size > 0) {
                var selItem = document.createElement('div');
                selItem.className = 'lane-add-menu-item';
                selItem.textContent = 'Selected Params (' + selectedParams.size + ')';
                selItem.onclick = function (ev) {
                    ev.stopPropagation(); menu.remove();
                    pushUndoSnapshot();
                    if (!lane.morphSnapshots) lane.morphSnapshots = [];
                    var vals = {};
                    selectedParams.forEach(function (pid) {
                        var p = PMap[pid];
                        if (p && !p.lk) {
                            vals[pid] = p.v;
                            if (lane.pids.indexOf(pid) < 0) lane.pids.push(pid);
                            assignTarget(b, pid);
                        }
                    });
                    var snap = { position: 0, hold: 0.5, curve: 0, name: 'S' + (lane.morphSnapshots.length + 1), source: '', values: vals };
                    lane.morphSnapshots.push(snap);
                    if (lane.morphSnapshots.length > 1) {
                        for (var si = 0; si < lane.morphSnapshots.length; si++)
                            lane.morphSnapshots[si].position = si / (lane.morphSnapshots.length - 1);
                    } else { lane.morphSnapshots[0].position = 0; }
                    lane._selectedSnap = lane.morphSnapshots.length - 1;
                    selectedParams.clear();
                    laneDrawCanvas(b, li); renderSingleBlock(b.id);
                    if (typeof renderAllPlugins === 'function') renderAllPlugins();
                    syncBlocksToHost();
                };
                menu.appendChild(selItem);
            }

            // "Assigned Params" if lane already has pids
            if (lane.pids && lane.pids.length > 0) {
                var assItem = document.createElement('div');
                assItem.className = 'lane-add-menu-item';
                assItem.textContent = 'Assigned Params (' + lane.pids.length + ')';
                assItem.onclick = function (ev) {
                    ev.stopPropagation(); menu.remove();
                    pushUndoSnapshot();
                    if (!lane.morphSnapshots) lane.morphSnapshots = [];
                    var vals = {};
                    lane.pids.forEach(function (pid) { var p = PMap[pid]; if (p && !p.lk) vals[pid] = p.v; });
                    var snap = { position: 0, hold: 0.5, curve: 0, name: 'S' + (lane.morphSnapshots.length + 1), source: '', values: vals };
                    lane.morphSnapshots.push(snap);
                    if (lane.morphSnapshots.length > 1) {
                        for (var si = 0; si < lane.morphSnapshots.length; si++)
                            lane.morphSnapshots[si].position = si / (lane.morphSnapshots.length - 1);
                    } else { lane.morphSnapshots[0].position = 0; }
                    lane._selectedSnap = lane.morphSnapshots.length - 1;
                    laneDrawCanvas(b, li); renderSingleBlock(b.id); syncBlocksToHost();
                };
                menu.appendChild(assItem);
            }

            // Separator before plugin list
            if (menu.children.length > 0) {
                var sep = document.createElement('div');
                sep.style.cssText = 'height:1px;background:var(--border);margin:3px 0;';
                menu.appendChild(sep);
            }

            // Per-plugin items — picking one remembers it for direct capture
            if (typeof pluginBlocks !== 'undefined') {
                pluginBlocks.forEach(function (pb) {
                    if (!pb.params || pb.params.length === 0) return;
                    var item = document.createElement('div');
                    item.className = 'lane-add-menu-item';
                    item.textContent = pb.name || pb.id;
                    item.onclick = function (ev) {
                        ev.stopPropagation(); menu.remove();
                        // Remember this plugin for direct capture
                        lane._captureSource = pb.id;
                        // Do the capture immediately
                        _morphDoCapture(b, lane, li, function (p) { return p.id === pb.id; });
                    };
                    menu.appendChild(item);
                });
            }

            document.body.appendChild(menu);
            setTimeout(function () {
                var dismiss = function (de) { if (!menu.contains(de.target)) { menu.remove(); document.removeEventListener('mousedown', dismiss); } };
                document.addEventListener('mousedown', dismiss);
            }, 10);
        };
    });
}

// Setup footer action button handlers for a lane
function laneSetupFooter(b, li) {
    var lane = b.lanes[li];
    if (!lane || lane.collapsed) return;

    // Default values if missing
    if (lane.depth == null) lane.depth = 100;
    if (lane.drift == null) lane.drift = 0;
    if (lane.driftRange == null) lane.driftRange = 5;
    if (lane.warp == null) lane.warp = 0;
    if (lane.steps == null) lane.steps = 0;



    // Footer action buttons
    document.querySelectorAll('.lane-ft-btn[data-b="' + b.id + '"][data-li="' + li + '"]').forEach(function (btn) {
        btn.onclick = function (e) {
            e.stopPropagation();
            var act = btn.dataset.act;
            if (act === 'random') {
                pushUndoSnapshot();
                laneRandomize(lane, b.laneGrid);
                if (lane._sel) lane._sel.clear();
                laneDrawCanvas(b, li);
                syncBlocksToHost();
            } else if (act === 'invert') {
                pushUndoSnapshot();
                for (var i = 0; i < lane.pts.length; i++) {
                    lane.pts[i].y = 1 - lane.pts[i].y;
                }
                laneDrawCanvas(b, li);
                syncBlocksToHost();
            } else if (act === 'clear') {
                pushUndoSnapshot();
                var edgeY = (lane.pts.length && lane.pts[0]) ? lane.pts[0].y : 0.5;
                lane.pts = [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }];
                if (lane._sel) lane._sel.clear();
                laneDrawCanvas(b, li);
                syncBlocksToHost();
            } else if (act === 'shapes') {
                laneShowShapesMenu(b, li, btn);
            } else if (act === 'capture-assigned' || act === 'capture-all') {
                pushUndoSnapshot();
                if (!lane.morphSnapshots) lane.morphSnapshots = [];
                var vals = {};
                if (act === 'capture-all') {
                    for (var pi = 0; pi < pluginBlocks.length; pi++) {
                        var pb = pluginBlocks[pi];
                        if (!pb || !pb.params) continue;
                        for (var pj = 0; pj < pb.params.length; pj++) {
                            var p = pb.params[pj];
                            if (!p.lk) vals[p.id] = p.v;
                        }
                    }
                } else {
                    (lane.pids || []).forEach(function (pid) {
                        var p = PMap[pid];
                        if (p && !p.lk) vals[pid] = p.v;
                    });
                }
                var snap = {
                    position: 0,
                    hold: 0.5,
                    curve: 0,
                    name: 'S' + (lane.morphSnapshots.length + 1),
                    source: '',
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
                // Auto-select the new snapshot
                lane._selectedSnap = lane.morphSnapshots.length - 1;
                laneDrawCanvas(b, li);
                renderSingleBlock(b.id);
                syncBlocksToHost();
            } else if (act === 'delete-snap') {
                var si = lane._selectedSnap;
                if (si != null && lane.morphSnapshots && lane.morphSnapshots[si]) {
                    pushUndoSnapshot();
                    lane.morphSnapshots.splice(si, 1);
                    // Fix positions
                    if (lane.morphSnapshots.length > 1) {
                        lane.morphSnapshots[0].position = 0;
                        lane.morphSnapshots[lane.morphSnapshots.length - 1].position = 1;
                    } else if (lane.morphSnapshots.length === 1) {
                        lane.morphSnapshots[0].position = 0;
                    }
                    lane._selectedSnap = -1;
                    laneDrawCanvas(b, li);
                    renderSingleBlock(b.id);
                    syncBlocksToHost();
                }
            }
        };
    });
    // Morph curve dropdown
    document.querySelectorAll('.lane-morph-curve-sel[data-b="' + b.id + '"][data-li="' + li + '"]').forEach(function (sel) {
        sel.onchange = function () {
            var cVal = parseInt(sel.value);
            if (lane._selectedSnap != null && lane.morphSnapshots && lane.morphSnapshots[lane._selectedSnap]) {
                lane.morphSnapshots[lane._selectedSnap].curve = cVal;
                laneDrawCanvas(b, li);
                syncBlocksToHost();
            }
        };
    });
    // Per-snapshot DriftScale dropdown
    document.querySelectorAll('.lane-morph-ds[data-b="' + b.id + '"][data-li="' + li + '"]').forEach(function (sel) {
        sel.onchange = function () {
            var dsVal = sel.value;
            // Apply to all selected snapshots
            var indices = [];
            if (lane._selectedSnaps && lane._selectedSnaps.size > 0) {
                lane._selectedSnaps.forEach(function (si) { indices.push(si); });
            }
            if (indices.length === 0 && lane._selectedSnap != null && lane._selectedSnap >= 0) {
                indices.push(lane._selectedSnap);
            }
            for (var si = 0; si < indices.length; si++) {
                var snap = lane.morphSnapshots && lane.morphSnapshots[indices[si]];
                if (snap) snap.driftScale = dsVal;
            }
            laneDrawCanvas(b, li);
            syncBlocksToHost();
        };
    });
    // Morph param chip multi-select (Ctrl+click, Shift+click) + highlight + right-click batch menu
    var morphParamContainer = document.getElementById('morph-params-' + b.id + '-' + li);
    var morphParamChips = document.querySelectorAll('.lane-morph-param[data-b="' + b.id + '"][data-li="' + li + '"]');
    if (!lane._selectedParamIndices) lane._selectedParamIndices = new Set();

    function _updateParamChipVisuals() {
        var allChips = document.querySelectorAll('.lane-morph-param[data-b="' + b.id + '"][data-li="' + li + '"]');
        var hasSel = lane._selectedParamIndices && lane._selectedParamIndices.size > 0;
        allChips.forEach(function (c) {
            var ci = parseInt(c.dataset.pidx);
            var isSel = hasSel && lane._selectedParamIndices.has(ci);
            c.style.outline = isSel ? '1px solid var(--accent)' : '';
            c.style.opacity = hasSel ? (isSel ? '1' : '0.4') : '';
        });
    }

    if (morphParamContainer && lane.morphMode && morphParamChips.length > 0) {
        var delegateRoot = morphParamChips[0].parentNode;
        if (delegateRoot) {
            // Click handler: single/multi-select
            delegateRoot.addEventListener('click', function (e) {
                if (e.target.classList.contains('lane-param-chip-x')) return;
                var chip = e.target.closest('.lane-morph-param[data-b="' + b.id + '"][data-li="' + li + '"]');
                if (!chip) return;
                e.stopPropagation();
                var pidx = parseInt(chip.dataset.pidx);
                if (isNaN(pidx)) return;
                if (!lane._selectedParamIndices) lane._selectedParamIndices = new Set();

                if (e.ctrlKey || e.metaKey) {
                    // Ctrl+click: toggle
                    if (lane._selectedParamIndices.has(pidx)) {
                        lane._selectedParamIndices.delete(pidx);
                        if (lane._selectedParamIndices.size > 0) {
                            var arr = Array.from(lane._selectedParamIndices);
                            lane._selectedParamIdx = arr[arr.length - 1];
                            lane._highlightParam = lane._selectedParamIdx;
                        } else {
                            lane._selectedParamIdx = -1;
                            lane._highlightParam = -1;
                        }
                    } else {
                        lane._selectedParamIndices.add(pidx);
                        lane._selectedParamIdx = pidx;
                        lane._highlightParam = pidx;
                    }
                } else if (e.shiftKey && lane._selectedParamIdx != null && lane._selectedParamIdx >= 0) {
                    // Shift+click: range
                    var from = lane._selectedParamIdx;
                    var lo = Math.min(from, pidx), hi = Math.max(from, pidx);
                    for (var ri = lo; ri <= hi; ri++) lane._selectedParamIndices.add(ri);
                    lane._selectedParamIdx = pidx;
                    lane._highlightParam = pidx;
                } else {
                    // Regular click: single select (toggle if same)
                    if (lane._selectedParamIndices.size <= 1 && lane._selectedParamIndices.has(pidx)) {
                        lane._selectedParamIndices.clear();
                        lane._selectedParamIdx = -1;
                        lane._highlightParam = -1;
                    } else {
                        lane._selectedParamIndices.clear();
                        lane._selectedParamIndices.add(pidx);
                        lane._selectedParamIdx = pidx;
                        lane._highlightParam = pidx;
                    }
                }
                _updateParamChipVisuals();
                laneDrawCanvas(b, li);
            });

            // Right-click context menu for batch actions
            delegateRoot.addEventListener('contextmenu', function (e) {
                var chip = e.target.closest('.lane-morph-param[data-b="' + b.id + '"][data-li="' + li + '"]');
                if (!chip) return;
                e.preventDefault();
                e.stopPropagation();
                var pidx = parseInt(chip.dataset.pidx);
                if (isNaN(pidx)) return;

                // If right-clicking outside current selection, make it the sole selection
                if (!lane._selectedParamIndices) lane._selectedParamIndices = new Set();
                if (!lane._selectedParamIndices.has(pidx)) {
                    lane._selectedParamIndices.clear();
                    lane._selectedParamIndices.add(pidx);
                    lane._selectedParamIdx = pidx;
                    lane._highlightParam = pidx;
                    _updateParamChipVisuals();
                    laneDrawCanvas(b, li);
                }

                var selIndices = Array.from(lane._selectedParamIndices).sort(function (a, c) { return a - c; });
                var selCount = selIndices.length;
                var selPids = selIndices.map(function (i) { return lane.pids[i]; }).filter(Boolean);

                // Remove existing menus
                var old = document.querySelector('.morph-param-ctx-menu');
                if (old) old.remove();

                var menu = document.createElement('div');
                menu.className = 'morph-param-ctx-menu lane-add-menu';
                menu.style.position = 'fixed';
                menu.style.zIndex = '9999';
                menu.style.left = e.clientX + 'px';
                menu.style.top = e.clientY + 'px';

                // Header
                var hdr = document.createElement('div');
                hdr.className = 'lane-add-menu-hdr';
                hdr.textContent = selCount + ' param' + (selCount > 1 ? 's' : '') + ' selected';
                menu.appendChild(hdr);

                // Delete selected
                var delItem = document.createElement('div');
                delItem.className = 'lane-add-menu-item';
                delItem.textContent = '\u2716 Delete Selected';
                delItem.onclick = function (ev) {
                    ev.stopPropagation();
                    menu.remove();
                    pushUndoSnapshot();
                    // Remove pids in reverse order to avoid index shifts
                    var toRemove = selIndices.slice().sort(function (a, c) { return c - a; });
                    toRemove.forEach(function (idx) {
                        if (idx >= 0 && idx < lane.pids.length) {
                            // Also remove from all snapshot values
                            var removedPid = lane.pids[idx];
                            lane.pids.splice(idx, 1);
                            if (lane.morphSnapshots) {
                                lane.morphSnapshots.forEach(function (s) {
                                    if (s.values && s.values[removedPid] !== undefined) delete s.values[removedPid];
                                });
                            }
                        }
                    });
                    lane._selectedParamIndices.clear();
                    lane._selectedParamIdx = -1;
                    lane._highlightParam = -1;
                    laneDrawCanvas(b, li);
                    renderSingleBlock(b.id);
                    syncBlocksToHost();
                };
                menu.appendChild(delItem);

                // Move to lane (if other lanes exist)
                if (b.lanes.length > 1) {
                    var sep = document.createElement('div');
                    sep.style.cssText = 'height:1px;background:var(--border);margin:3px 0;';
                    menu.appendChild(sep);

                    var moveHdr = document.createElement('div');
                    moveHdr.className = 'lane-add-menu-hdr';
                    moveHdr.textContent = '\u21C4 MOVE TO LANE';
                    menu.appendChild(moveHdr);

                    for (var oi = 0; oi < b.lanes.length; oi++) {
                        if (oi === li) continue;
                        var ol = b.lanes[oi];
                        var oName = ol.morphMode ? 'Morph' : (ol.pids[0] ? (PMap[ol.pids[0]] ? PMap[ol.pids[0]].name : 'Lane') : 'Lane');
                        var moveItem = document.createElement('div');
                        moveItem.className = 'lane-add-menu-item';
                        moveItem.textContent = 'L' + (oi + 1) + ': ' + oName;
                        moveItem.dataset.targetLane = oi;
                        moveItem.onclick = function (ev) {
                            ev.stopPropagation();
                            menu.remove();
                            pushUndoSnapshot();
                            var tli = parseInt(this.dataset.targetLane);
                            var tLane = b.lanes[tli];
                            if (!tLane) return;
                            selPids.forEach(function (pid) {
                                // Move pid to target lane
                                var idx = lane.pids.indexOf(pid);
                                if (idx >= 0) lane.pids.splice(idx, 1);
                                if (tLane.pids.indexOf(pid) < 0) tLane.pids.push(pid);
                            });
                            lane._selectedParamIndices.clear();
                            lane._selectedParamIdx = -1;
                            lane._highlightParam = -1;
                            laneDrawCanvas(b, li);
                            laneDrawCanvas(b, tli);
                            renderSingleBlock(b.id);
                            syncBlocksToHost();
                        };
                        menu.appendChild(moveItem);
                    }
                }

                document.body.appendChild(menu);
                // Clamp position
                var mRect = menu.getBoundingClientRect();
                if (mRect.right > window.innerWidth - 4) menu.style.left = (window.innerWidth - mRect.width - 4) + 'px';
                if (mRect.bottom > window.innerHeight - 4) menu.style.top = (window.innerHeight - mRect.height - 4) + 'px';

                setTimeout(function () {
                    document.addEventListener('mousedown', function closer(ev) {
                        if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('mousedown', closer); }
                    });
                }, 10);
            });

            // Ctrl+A to select all params
            if (!delegateRoot.getAttribute('tabindex')) delegateRoot.setAttribute('tabindex', '-1');
            delegateRoot.onkeydown = function (e) {
                if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
                    e.preventDefault();
                    if (!lane._selectedParamIndices) lane._selectedParamIndices = new Set();
                    for (var ai = 0; ai < lane.pids.length; ai++) lane._selectedParamIndices.add(ai);
                    if (lane.pids.length > 0) {
                        lane._selectedParamIdx = lane.pids.length - 1;
                        lane._highlightParam = lane._selectedParamIdx;
                    }
                    _updateParamChipVisuals();
                    laneDrawCanvas(b, li);
                }
            };
        }
    }

    // Curve lane param chip click — select param for value readout
    var curveParamContainer = document.getElementById('curve-params-' + b.id + '-' + li);
    if (curveParamContainer && !lane.morphMode) {
        curveParamContainer.addEventListener('click', function (e) {
            if (e.target.classList.contains('lane-param-chip-x')) return; // don't intercept delete
            var chip = e.target.closest('.lane-param-chip[data-pidx]');
            if (!chip) return;
            e.stopPropagation();
            var pidx = parseInt(chip.dataset.pidx);
            if (isNaN(pidx)) return;
            // Toggle selection
            if (lane._selectedParamIdx === pidx) {
                lane._selectedParamIdx = -1;
            } else {
                lane._selectedParamIdx = pidx;
            }
            laneDrawCanvas(b, li);
            renderSingleBlock(b.id);
        });
    }

    // Populate static range badges for non-selected params (curve + morph)
    if (lane.pids) {
        var fn = _ensureParamTextFn();
        if (fn) {
            var rngPrefix = lane.morphMode ? 'mprng-' : 'cprng-';
            for (var ri = 0; ri < lane.pids.length; ri++) {
                if (lane._selectedParamIdx === ri) continue;
                var rngEl = document.getElementById(rngPrefix + b.id + '-' + li + '-' + ri);
                if (!rngEl) continue;
                var parts = lane.pids[ri].split(':');
                if (parts.length !== 2) continue;
                (function (el, pId, pIdx) {
                    var minP = fn(pId, pIdx, 0.0);
                    var maxP = fn(pId, pIdx, 1.0);
                    Promise.all([minP, maxP]).then(function (vals) {
                        var minT = vals[0] || '0%', maxT = vals[1] || '100%';
                        if (el) el.textContent = minT + '\u2026' + maxT;
                    });
                })(rngEl, parseInt(parts[0]), parseInt(parts[1]));
            }
        }
    }
}

// -"-"- Preset shapes menu -"-"-
// Each shape defines minimal control points directly (y: 0=bottom, 1=top in canvas coords inverted below)
var LANE_SHAPES = [
    {
        name: 'Sine', pts: function () {
            var p = []; for (var i = 0; i <= 16; i++) { var t = i / 16; p.push({ x: t, y: 0.5 + 0.5 * Math.sin(t * Math.PI * 2 - Math.PI / 2) }); } return p;
        }
    },
    {
        name: 'Cosine', pts: function () {
            var p = []; for (var i = 0; i <= 16; i++) { var t = i / 16; p.push({ x: t, y: 0.5 + 0.5 * Math.cos(t * Math.PI * 2) }); } return p;
        }
    },
    {
        name: 'Triangle', pts: function () {
            return [{ x: 0, y: 0 }, { x: 0.25, y: 1 }, { x: 0.75, y: 0 }, { x: 1, y: 0 }];
        }
    },
    {
        name: 'Saw Up', pts: function () {
            return [{ x: 0, y: 0 }, { x: 1, y: 1 }];
        }
    },
    {
        name: 'Saw Down', pts: function () {
            return [{ x: 0, y: 1 }, { x: 1, y: 0 }];
        }
    },
    {
        name: 'Square', pts: function () {
            return [{ x: 0, y: 1 }, { x: 0.499, y: 1 }, { x: 0.5, y: 0 }, { x: 0.999, y: 0 }, { x: 1, y: 1 }];
        }
    },
    {
        name: 'Stairs Up', pts: function () {
            return [{ x: 0, y: 0 }, { x: 0.249, y: 0 }, { x: 0.25, y: 0.33 }, { x: 0.499, y: 0.33 },
            { x: 0.5, y: 0.66 }, { x: 0.749, y: 0.66 }, { x: 0.75, y: 1 }, { x: 1, y: 1 }];
        }
    },
    {
        name: 'Stairs Down', pts: function () {
            return [{ x: 0, y: 1 }, { x: 0.249, y: 1 }, { x: 0.25, y: 0.66 }, { x: 0.499, y: 0.66 },
            { x: 0.5, y: 0.33 }, { x: 0.749, y: 0.33 }, { x: 0.75, y: 0 }, { x: 1, y: 0 }];
        }
    },
    {
        name: 'Exp Rise', pts: function () {
            var p = []; for (var i = 0; i <= 8; i++) { var t = i / 8; p.push({ x: t, y: Math.pow(t, 2.5) }); } return p;
        }
    },
    {
        name: 'Exp Decay', pts: function () {
            var p = []; for (var i = 0; i <= 8; i++) { var t = i / 8; p.push({ x: t, y: Math.pow(1 - t, 2.5) }); } return p;
        }
    },
    {
        name: 'S-Curve', pts: function () {
            var p = []; for (var i = 0; i <= 10; i++) { var t = i / 10; var s = t * 2 - 1; p.push({ x: t, y: 0.5 + 0.5 * Math.tanh(s * 3) / Math.tanh(3) }); } return p;
        }
    },
    {
        name: 'Pulse', pts: function () {
            return [{ x: 0, y: 0 }, { x: 0.15, y: 0 }, { x: 0.151, y: 1 }, { x: 0.35, y: 1 }, { x: 0.351, y: 0 },
            { x: 0.65, y: 0 }, { x: 0.651, y: 1 }, { x: 0.85, y: 1 }, { x: 0.851, y: 0 }, { x: 1, y: 0 }];
        }
    }
];

function laneShowShapesMenu(b, li, anchorBtn) {
    // Remove any existing shapes menu
    var old = document.querySelector('.lane-shapes-menu');
    if (old) { old.remove(); return; }

    var lane = b.lanes[li];
    var gridDiv = { 'free': 32, '1/16': 16, '1/16T': 16, '1/8': 8, '1/8.': 12, '1/8T': 12, '1/4': 4, '1/4.': 6, '1/4T': 6, '1/2': 2, '1/2.': 3, '1/2T': 3, '1/1': 1, '2/1': 2, '4/1': 4 };
    var divs = gridDiv[b.laneGrid] || 8;
    var numPts = Math.max(divs * 2, 16); // enough points for smooth shapes

    var menu = document.createElement('div');
    menu.className = 'lane-shapes-menu lane-add-menu';
    menu.style.position = 'absolute';
    menu.style.bottom = '100%';
    menu.style.right = '0';
    menu.style.zIndex = '200';
    menu.style.marginBottom = '2px';
    menu.style.minWidth = '120px';

    LANE_SHAPES.forEach(function (shape) {
        var item = document.createElement('div');
        item.className = 'lane-add-menu-item';
        item.textContent = shape.name;
        item.onclick = function (e) {
            e.stopPropagation();
            pushUndoSnapshot();
            // Invert y (canvas 0=top) and clone points
            var raw = shape.pts();
            lane.pts = raw.map(function (p) { return { x: p.x, y: 1 - p.y }; });
            if (lane._sel) lane._sel.clear();
            laneDrawCanvas(b, li);
            syncBlocksToHost();
            menu.remove();
        };
        menu.appendChild(item);
    });

    // Position relative to the shapes button wrapper
    var wrapper = anchorBtn.closest('.lane-ft-shapes') || anchorBtn.parentElement;
    wrapper.appendChild(menu);

    // Close on outside click
    setTimeout(function () {
        document.addEventListener('mousedown', function closer(ev) {
            if (!menu.contains(ev.target)) {
                menu.remove();
                document.removeEventListener('mousedown', closer);
            }
        });
    }, 10);
}
function laneDrawCanvas(b, li, selSet) {
    var lane = b.lanes[li];
    var cvs = document.getElementById('lcv-' + b.id + '-' + li);
    if (!cvs || !lane) return;
    var ctx = cvs.getContext('2d');
    // Use CSS dimensions for drawing (HiDPI transform already applied)
    var dpr = window.devicePixelRatio || 1;
    var W = cvs.width / dpr, H = cvs.height / dpr;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // Read theme colors for canvas drawing
    var cs = getComputedStyle(document.documentElement);
    var gridColor = cs.getPropertyValue('--lane-grid').trim() || 'rgba(255,255,255,0.18)';
    var gridLabel = cs.getPropertyValue('--lane-grid-label').trim() || 'rgba(255,255,255,0.28)';

    // -"-"- Grid: bar/beat structure -"-"-
    var gridDiv = { 'free': 16, '1/16': 16, '1/16T': 16, '1/8': 8, '1/8.': 12, '1/8T': 12, '1/4': 4, '1/4.': 6, '1/4T': 6, '1/2': 2, '1/2.': 3, '1/2T': 3, '1/1': 1, '2/1': 2, '4/1': 4 };
    var divs = gridDiv[b.laneGrid] || 8;
    ctx.lineWidth = 1;

    // Horizontal percentage lines (0%, 25%, 50%, 75%, 100%)
    // If a curve lane has a selected param, show that param's value labels instead
    var _selParamDisp = null; // holds display info when a curve param is selected
    var _selPid = null;
    if (!lane.morphMode && lane._selectedParamIdx != null && lane._selectedParamIdx >= 0 && lane.pids && lane.pids[lane._selectedParamIdx]) {
        _selPid = lane.pids[lane._selectedParamIdx];
        var _sp = PMap[_selPid];
        if (_sp) _selParamDisp = _sp;
    }
    var percLabels = ['100%', '75%', '50%', '25%', '0%'];
    if (_selParamDisp && _selPid) {
        // Use cached axis labels if available (populated asynchronously by C++)
        if (lane._cachedAxisPid === _selPid && lane._cachedAxisLabels) {
            percLabels = lane._cachedAxisLabels;
        } else {
            // Show param name as placeholder while fetching
            var dispName = _selParamDisp.name || '';
            if (dispName.length > 12) dispName = dispName.substring(0, 11) + '\u2026';
            percLabels = [dispName, '75%', '50%', '25%', '0%'];
            // Fire async queries to C++ for real values at each grid position
            var fn = _ensureParamTextFn();
            if (fn) {
                var parts = _selPid.split(':');
                if (parts.length === 2) {
                    var pId = parseInt(parts[0]);
                    var pIdx = parseInt(parts[1]);
                    var queryPid = _selPid; // capture for closure
                    // Canvas Y: index 0=top=1.0, 1=0.75, 2=0.5, 3=0.25, 4=0.0
                    var normVals = [1.0, 0.75, 0.5, 0.25, 0.0];
                    var results = new Array(5);
                    var count = { done: 0 };
                    for (var qi = 0; qi < 5; qi++) {
                        (function (idx, nv) {
                            fn(pId, pIdx, nv).then(function (txt) {
                                results[idx] = txt || (Math.round(nv * 100) + '%');
                                count.done++;
                                if (count.done === 5 && lane._selectedParamIdx != null && lane.pids && lane.pids[lane._selectedParamIdx] === queryPid) {
                                    lane._cachedAxisPid = queryPid;
                                    lane._cachedAxisLabels = results;
                                    laneDrawCanvas(b, li); // redraw with real labels
                                }
                            });
                        })(qi, normVals[qi]);
                    }
                }
            }
        }
    } else {
        // Clear cache when no param is selected
        lane._cachedAxisPid = null;
        lane._cachedAxisLabels = null;
    }
    ctx.font = '8px Inter, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (var yi = 0; yi <= 4; yi++) {
        var yp = yi / 4;
        var yy = laneYtoCanvas(yp, H);
        ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(W, yy);
        ctx.strokeStyle = gridColor;
        if (yp === 0.5) ctx.globalAlpha = 1.0;
        else if (yp === 0 || yp === 1) ctx.globalAlpha = 0.9;
        else ctx.globalAlpha = 0.7;
        ctx.stroke();
        ctx.globalAlpha = 1.0;
        // Percentage labels on left edge
        ctx.fillStyle = _selParamDisp ? 'rgba(120,180,255,0.5)' : gridLabel;
        ctx.globalAlpha = 1.0;
        ctx.fillText(percLabels[yi], 2, yy + (yi === 0 ? 6 : yi === 4 ? -4 : 0));
    }

    // Vertical beat/bar grid lines
    var beatsPerLoop = divs;
    for (var i = 0; i <= divs; i++) {
        var x = (i / divs) * W;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H);
        var isBoundary = (i === 0 || i === divs);
        var isBar = (divs >= 4 && i % 4 === 0) || divs <= 2;
        ctx.strokeStyle = gridColor;
        if (isBoundary) {
            ctx.globalAlpha = 1.0;
            ctx.lineWidth = 2;
        } else if (isBar) {
            ctx.globalAlpha = 1.0;
            ctx.lineWidth = 1.5;
        } else {
            ctx.globalAlpha = 0.7;
            ctx.lineWidth = 1;
        }
        ctx.stroke();
        ctx.globalAlpha = 1.0;
        ctx.lineWidth = 1;
        // Beat number labels at top
        if (i < divs && divs <= 16) {
            ctx.fillStyle = gridLabel;
            ctx.textAlign = 'left';
            ctx.font = '7px Inter, sans-serif';
            ctx.fillText(String(i + 1), x + 2, 8);
        }
    }

    // ═══════════ MORPH LANE — draw snapshot columns ═══════════
    if (lane.morphMode) {
        var snaps = lane.morphSnapshots || [];
        var col = lane.color;
        var r = parseInt(col.slice(1, 3), 16), g = parseInt(col.slice(3, 5), 16), bl = parseInt(col.slice(5, 7), 16);
        var selIdx = lane._selectedSnap != null ? lane._selectedSnap : -1;
        var selSet = lane._selectedSnaps || null;
        var CURVE_LABELS = ['S', 'L', '/', ')'];
        // Color palette for per-param lines — 12 distinct hues
        var MORPH_PARAM_COLORS = [
            '255,100,100', '100,180,255', '100,220,140', '255,200,80',
            '200,130,255', '255,140,180', '80,220,220', '220,160,100',
            '160,255,160', '180,140,220', '255,180,120', '120,200,200'
        ];

        if (snaps.length === 0) {
            ctx.fillStyle = 'rgba(255,255,255,0.25)';
            ctx.font = '11px Inter, sans-serif';
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText('Double-click canvas or hit Capture', W / 2, H / 2 - 8);
            ctx.fillStyle = 'rgba(255,255,255,0.15)';
            ctx.font = '9px Inter, sans-serif';
            ctx.fillText('Select params first, or capture all', W / 2, H / 2 + 8);
            ctx.restore();
            return;
        }

        // Draw hold zones and morph gradients between snapshots
        for (var si = 0; si < snaps.length; si++) {
            var snap = snaps[si];
            var xSnap = snap.position * W;
            var isSel = si === selIdx || (selSet && selSet.has(si));

            // Calculate hold zone width for this snapshot
            var holdFraction = snap.hold != null ? snap.hold : 0.5;
            var leftGap = si > 0 ? (snap.position - snaps[si - 1].position) * W : snap.position * W;
            var rightGap = si < snaps.length - 1 ? (snaps[si + 1].position - snap.position) * W : (1 - snap.position) * W;
            var holdLeft = leftGap * holdFraction * 0.5;
            var holdRight = rightGap * holdFraction * 0.5;

            // Hold zone fill
            var holdAlpha = isSel ? 0.35 : 0.22;
            ctx.fillStyle = 'rgba(' + r + ',' + g + ',' + bl + ', ' + holdAlpha + ')';
            ctx.fillRect(xSnap - holdLeft, 0, holdLeft + holdRight, H);

            // Hold zone edge lines (draggable handles)
            if (holdLeft > 2) {
                ctx.beginPath();
                ctx.moveTo(xSnap - holdLeft, 0); ctx.lineTo(xSnap - holdLeft, H);
                ctx.strokeStyle = 'rgba(' + r + ',' + g + ',' + bl + ', ' + (isSel ? 0.6 : 0.35) + ')';
                ctx.lineWidth = isSel ? 2 : 1;
                ctx.setLineDash([2, 3]);
                ctx.stroke();
                ctx.setLineDash([]);
                // Handle grip lines (3 short horizontal lines)
                ctx.strokeStyle = 'rgba(' + r + ',' + g + ',' + bl + ', ' + (isSel ? 0.7 : 0.4) + ')';
                ctx.lineWidth = 1;
                for (var gi = -1; gi <= 1; gi++) {
                    ctx.beginPath();
                    ctx.moveTo(xSnap - holdLeft - 2, H / 2 + gi * 4);
                    ctx.lineTo(xSnap - holdLeft + 2, H / 2 + gi * 4);
                    ctx.stroke();
                }
            }
            if (holdRight > 2) {
                ctx.beginPath();
                ctx.moveTo(xSnap + holdRight, 0); ctx.lineTo(xSnap + holdRight, H);
                ctx.strokeStyle = 'rgba(' + r + ',' + g + ',' + bl + ', ' + (isSel ? 0.6 : 0.35) + ')';
                ctx.lineWidth = isSel ? 2 : 1;
                ctx.setLineDash([2, 3]);
                ctx.stroke();
                ctx.setLineDash([]);
                // Handle grip lines
                ctx.strokeStyle = 'rgba(' + r + ',' + g + ',' + bl + ', ' + (isSel ? 0.7 : 0.4) + ')';
                ctx.lineWidth = 1;
                for (var gi = -1; gi <= 1; gi++) {
                    ctx.beginPath();
                    ctx.moveTo(xSnap + holdRight - 2, H / 2 + gi * 4);
                    ctx.lineTo(xSnap + holdRight + 2, H / 2 + gi * 4);
                    ctx.stroke();
                }
            }

            // Hold % text (inside hold zone, near bottom)
            if (holdLeft + holdRight > 18) {
                ctx.fillStyle = 'rgba(' + r + ',' + g + ',' + bl + ', ' + (isSel ? 0.55 : 0.3) + ')';
                ctx.font = '8px Inter, sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(Math.round(holdFraction * 100) + '%', xSnap, H - 14);
            }

            // Snapshot column line
            ctx.beginPath();
            ctx.moveTo(xSnap, 0); ctx.lineTo(xSnap, H);
            ctx.strokeStyle = 'rgba(' + r + ',' + g + ',' + bl + ', ' + (isSel ? 1.0 : 0.75) + ')';
            ctx.lineWidth = isSel ? 3 : 2;
            ctx.stroke();
            ctx.lineWidth = 1;

            // Selected glow
            if (isSel) {
                ctx.beginPath();
                ctx.moveTo(xSnap, 0); ctx.lineTo(xSnap, H);
                ctx.strokeStyle = 'rgba(' + r + ',' + g + ',' + bl + ', 0.2)';
                ctx.lineWidth = 8;
                ctx.stroke();
                ctx.lineWidth = 1;
            }

            // Name at top — larger, clearer
            ctx.fillStyle = 'rgba(' + r + ',' + g + ',' + bl + ', ' + (isSel ? 1.0 : 0.85) + ')';
            ctx.font = (isSel ? 'bold ' : '') + '10px Inter, sans-serif';
            ctx.textAlign = 'center';
            var label = snap.name || ('S' + (si + 1));
            ctx.fillText(label, xSnap, 12);
            // Param count
            var pCount = Object.keys(snap.values).length;
            if (pCount > 0) {
                ctx.fillStyle = 'rgba(' + r + ',' + g + ',' + bl + ', 0.45)';
                ctx.font = '7px Inter, sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(pCount + 'p', xSnap, 22);
            }

            // Per-snapshot settings indicator (D/W/S)
            var sIndicators = '';
            if (snap.depth != null && snap.depth < 0.99) sIndicators += 'D';
            if (snap.warp && Math.abs(snap.warp) > 0) sIndicators += 'W';
            if (snap.steps && snap.steps >= 2) sIndicators += 'S';
            if (sIndicators) {
                ctx.fillStyle = 'rgba(' + r + ',' + g + ',' + bl + ', 0.35)';
                ctx.font = '7px Inter, sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(sIndicators, xSnap, H - 14);
            }

            // Curve type indicator at bottom
            var curveLabel = CURVE_LABELS[snap.curve || 0];
            ctx.fillStyle = 'rgba(' + r + ',' + g + ',' + bl + ', 0.4)';
            ctx.font = '8px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(curveLabel, xSnap, H - 4);

            // Per-param value dots — cap at 16, always include selected
            var paramKeys = Object.keys(snap.values);
            var pCount = paramKeys.length;
            var DOT_CAP = 16;
            // Build visible key set: first 16, but swap in selected if needed
            var selPidIdx = lane._selectedParamIdx;
            var selPid = (selPidIdx != null && selPidIdx >= 0 && lane.pids) ? lane.pids[selPidIdx] : null;
            var visKeys = pCount <= DOT_CAP ? paramKeys.slice() : paramKeys.slice(0, DOT_CAP);
            if (selPid && visKeys.indexOf(selPid) < 0 && paramKeys.indexOf(selPid) >= 0) {
                visKeys[DOT_CAP - 1] = selPid; // swap in selected
            }
            for (var pi = 0; pi < visKeys.length; pi++) {
                var keyIdx = paramKeys.indexOf(visKeys[pi]);
                var val = snap.values[visKeys[pi]];
                if (val == null) continue;
                var yp = (1 - val) * H;
                var pCol = MORPH_PARAM_COLORS[(keyIdx >= 0 ? keyIdx : pi) % MORPH_PARAM_COLORS.length];
                var isHi = selPid && visKeys[pi] === selPid;
                var isDimmed = selPid && !isHi;
                ctx.fillStyle = 'rgba(' + pCol + ', ' + (isDimmed ? 0.15 : (isSel ? 0.9 : 0.6)) + ')';
                ctx.beginPath();
                ctx.arc(xSnap, yp, isHi ? 4 : (isSel ? 3.5 : 2.5), 0, Math.PI * 2);
                ctx.fill();
            }

            // Morph zone to next snapshot — with curve-shaped interpolation
            if (si < snaps.length - 1) {
                var nextSnap = snaps[si + 1];
                var nextHoldLeft = (nextSnap.position - snap.position) * W * ((nextSnap.hold != null ? nextSnap.hold : 0.5) * 0.5);
                var morphStart = xSnap + holdRight;
                var morphEnd = nextSnap.position * W - nextHoldLeft;
                if (morphEnd > morphStart + 1) {
                    var morphW = morphEnd - morphStart;
                    // Background gradient
                    var grad = ctx.createLinearGradient(morphStart, 0, morphEnd, 0);
                    grad.addColorStop(0, 'rgba(' + r + ',' + g + ',' + bl + ', 0.06)');
                    grad.addColorStop(0.5, 'rgba(' + r + ',' + g + ',' + bl + ', 0.015)');
                    grad.addColorStop(1, 'rgba(' + r + ',' + g + ',' + bl + ', 0.06)');
                    ctx.fillStyle = grad;
                    ctx.fillRect(morphStart, 0, morphW, H);

                    // Transition curve shape (visual feedback for destination's curve type)
                    var curveType = nextSnap.curve || 0;
                    ctx.beginPath();
                    ctx.moveTo(morphStart, H * 0.8);
                    var STEPS = 30;
                    for (var st = 0; st <= STEPS; st++) {
                        var t = st / STEPS;
                        var cVal;
                        if (curveType === 0) cVal = 0.5 - 0.5 * Math.cos(t * Math.PI);  // Smooth (cosine S-curve, matches C++)
                        else if (curveType === 1) cVal = t;                               // Linear
                        else if (curveType === 2) cVal = t * t;                           // Sharp (ease-in, matches C++)
                        else cVal = 1 - (1 - t) * (1 - t);                               // Late (ease-out, matches C++)
                        var cx = morphStart + t * morphW;
                        var cy = H * 0.8 - cVal * H * 0.6; // draw in middle area
                        ctx.lineTo(cx, cy);
                    }
                    ctx.strokeStyle = 'rgba(' + r + ',' + g + ',' + bl + ', 0.4)';
                    ctx.lineWidth = 2;
                    ctx.stroke();

                    // Drift noise helpers — per-snapshot (matches C++ which uses snapB)
                    var snapDrift = (nextSnap.drift || 0) / 50; // -1..+1
                    var snapDriftRng = (nextSnap.driftRange != null ? nextSnap.driftRange : 5) / 100; // 0..1
                    var driftAmt = Math.abs(snapDrift);
                    var hasDrift = driftAmt > 0.001 && snapDriftRng > 0.001;
                    // Hash + hermite noise (matches C++ smoothNoise)
                    function _hashI(n) {
                        var h = (n | 0) >>> 0;
                        h ^= h >>> 16; h = Math.imul(h, 0x45d9f3b) >>> 0; h ^= h >>> 16; h = Math.imul(h, 0x45d9f3b) >>> 0; h ^= h >>> 16;
                        return ((h & 0xFFFF) / 32768.0) - 1.0;
                    }
                    function _smoothNoise(phase) {
                        var i0 = Math.floor(phase);
                        var frac = phase - i0;
                        var v0 = _hashI(i0 - 1), v1 = _hashI(i0), v2 = _hashI(i0 + 1), v3 = _hashI(i0 + 2);
                        var a = -0.5 * v0 + 1.5 * v1 - 1.5 * v2 + 0.5 * v3;
                        var b2 = v0 - 2.5 * v1 + 2.0 * v2 - 0.5 * v3;
                        var c2 = -0.5 * v0 + 0.5 * v2;
                        return ((a * frac + b2) * frac + c2) * frac + v1;
                    }
                    // Drift freq calculation (matches C++)
                    var driftBaseFreq = snapDrift > 0 ? (1 + driftAmt * 2) : (4 + driftAmt * 10);
                    var driftSharpness = Math.max(0, (driftAmt - 0.7) / 0.3);
                    // Parse drift scale beats (per-snapshot, fallback to lane-level)
                    var DS_BEAT_MAP_VIS = { '1/16': 0.25, '1/8': 0.5, '1/4': 1, '1/2': 2, '1/1': 4, '2/1': 8, '4/1': 16, '8/1': 32, '16/1': 64, '32/1': 128 };
                    var driftScaleBeats = DS_BEAT_MAP_VIS[nextSnap.driftScale || lane.driftScale || '1/1'] || 4;
                    // Parse loop len beats
                    var LL_BEAT_MAP_VIS = { '1/16': 0.25, '1/8': 0.5, '1/4': 1, '1/2': 2, '1/1': 4, '2/1': 8, '4/1': 16, '8/1': 32, '16/1': 64, '32/1': 128, 'free': 4 };
                    var loopBeatsVis = LL_BEAT_MAP_VIS[lane.loopLen || '1/1'] || 4;
                    var driftPhaseScale = loopBeatsVis / Math.max(0.25, driftScaleBeats);
                    var driftFreq = driftBaseFreq * (1 + driftSharpness * 2) * driftPhaseScale;

                    // Per-snapshot destination effects
                    var dstDepth = nextSnap.depth != null ? nextSnap.depth : 1.0;
                    var dstWarp = nextSnap.warp || 0;
                    var dstSteps = nextSnap.steps || 0;
                    // Use the same capped visKeys set as dot rendering
                    var showKeys = visKeys.filter(function (k) { return nextSnap.values[k] !== undefined && snap.values[k] !== undefined; });
                    for (var ki = 0; ki < showKeys.length; ki++) {
                        var vA = snap.values[showKeys[ki]];
                        var vB = nextSnap.values[showKeys[ki]];
                        var keyIdx = paramKeys.indexOf(showKeys[ki]);
                        var pCol = MORPH_PARAM_COLORS[(keyIdx >= 0 ? keyIdx : ki) % MORPH_PARAM_COLORS.length];
                        var isHi = selPid && showKeys[ki] === selPid;
                        var isDimmed = selPid && !isHi;
                        // Per-param drift seed — must match C++: hashI(pluginId * 1000 + paramIndex) * 100
                        var driftSeed = 0;
                        if (hasDrift) {
                            var pidParts = showKeys[ki].split(':');
                            var pidId = parseInt(pidParts[0]) || 0;
                            var pidIdx = parseInt(pidParts[1]) || 0;
                            driftSeed = _hashI(pidId * 1000 + pidIdx) * 100;
                        }
                        ctx.beginPath();
                        ctx.moveTo(morphStart, (1 - vA) * H);
                        for (var st = 1; st <= 20; st++) {
                            var t = st / 20;
                            var cVal;
                            if (curveType === 0) cVal = 0.5 - 0.5 * Math.cos(t * Math.PI);
                            else if (curveType === 1) cVal = t;
                            else if (curveType === 2) cVal = t * t;
                            else cVal = 1 - (1 - t) * (1 - t);
                            var interp = vA + (vB - vA) * cVal;
                            // Apply depth
                            interp = 0.5 + (interp - 0.5) * dstDepth;
                            // Apply warp
                            if (Math.abs(dstWarp) > 0.5) {
                                var w = dstWarp * 0.01;
                                if (w > 0) {
                                    var tt = Math.tanh(w * 3 * (interp * 2 - 1));
                                    interp = 0.5 + 0.5 * tt / Math.tanh(w * 3);
                                } else {
                                    var aw = -w;
                                    var cen = interp * 2 - 1;
                                    var sgn = cen >= 0 ? 1 : -1;
                                    interp = 0.5 + 0.5 * sgn * Math.pow(Math.abs(cen), 1 / (1 + aw * 3));
                                }
                            }
                            // Apply steps
                            if (dstSteps >= 2) {
                                interp = Math.round(interp * (dstSteps - 1)) / (dstSteps - 1);
                            }
                            // Apply drift noise (per-param seeded)
                            if (hasDrift) {
                                // Position in morph region mapped to playhead 0..1
                                var driftPos = (snap.position + (nextSnap.position - snap.position) * t);
                                var dp1 = driftPos * driftFreq + driftSeed;
                                var dp2 = driftPos * driftFreq * 2.37 + 7.13 + driftSeed;
                                var dNoise = _smoothNoise(dp1) * 0.7 + _smoothNoise(dp2) * 0.3;
                                if (driftSharpness > 0.01) {
                                    var dp3 = driftPos * driftFreq * 5.19 + 13.7 + driftSeed;
                                    dNoise = dNoise * (1 - driftSharpness * 0.3) + _smoothNoise(dp3) * driftSharpness * 0.3;
                                }
                                interp = Math.max(0, Math.min(1, interp + dNoise * snapDriftRng));
                            }
                            ctx.lineTo(morphStart + t * morphW, (1 - interp) * H);
                        }
                        ctx.strokeStyle = 'rgba(' + pCol + ', ' + (isDimmed ? 0.08 : (isHi ? 1.0 : 0.7)) + ')';
                        ctx.lineWidth = isHi ? 2.5 : 1.5;
                        ctx.stroke();
                    }
                    ctx.lineWidth = 1;
                }
            }
        }

        // Curve label in morph mode
        ctx.fillStyle = 'rgba(' + r + ',' + g + ',' + bl + ', 0.3)';
        ctx.font = '8px Inter, sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText('MORPH', W - 4, H - 4);

        ctx.restore();
        return;
    }

    // ═══════════ CURVE LANE — existing drawing code ═══════════
    var pts = lane.pts;
    if (!pts || !pts.length) {
        ctx.fillStyle = gridLabel;
        ctx.font = '10px Inter, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('draw to shape automation curve', W / 2, H / 2);
        ctx.restore();
        return;
    }

    var depth = (lane.depth != null ? lane.depth : 100) / 100;
    var warp = (lane.warp || 0) / 50; // -1..+1 range (from -50..+50)
    var drift = (lane.drift || 0) / 50; // -1..+1 range (from -50..+50)
    var driftRange = (lane.driftRange != null ? lane.driftRange : 5) / 100; // 0..0.5
    var stepsN = lane.steps || 0;
    var col = lane.color;
    var r = parseInt(col.slice(1, 3), 16), g = parseInt(col.slice(3, 5), 16), bl = parseInt(col.slice(5, 7), 16);
    var hasEffect = (depth !== 1.0 || Math.abs(warp) > 0.001 || (Math.abs(drift) > 0.001 && driftRange > 0.001) || stepsN >= 2);

    // Center line reference when effects active
    if (hasEffect) {
        var midY = H * 0.5;
        ctx.beginPath();
        ctx.moveTo(0, midY); ctx.lineTo(W, midY);
        ctx.strokeStyle = 'rgba(' + r + ',' + g + ',' + bl + ', 0.4)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.lineWidth = 1;
    }

    // Evaluate raw curve y at any x (with wrapping)
    function evalRawY(xPos) {
        var sx = xPos - Math.floor(xPos);
        if (pts.length <= 1) return pts[0].y;
        if (sx <= pts[0].x) return pts[0].y;
        if (sx >= pts[pts.length - 1].x) return pts[pts.length - 1].y;
        for (var seg = 0; seg < pts.length - 1; seg++) {
            if (sx >= pts[seg].x && sx < pts[seg + 1].x) {
                var x0 = pts[seg].x, x1 = pts[seg + 1].x;
                var y0 = pts[seg].y, y1 = pts[seg + 1].y;
                var t = (x1 > x0) ? (sx - x0) / (x1 - x0) : 0;
                if (lane.interp === 'step') return y0;
                if (lane.interp === 'smooth') { var ts = t * t * (3 - 2 * t); return y0 + (y1 - y0) * ts; }
                return y0 + (y1 - y0) * t;
            }
        }
        return pts[pts.length - 1].y;
    }

    // Apply depth + warp + steps to a y value
    function processY(y) {
        var v = 0.5 + (y - 0.5) * depth; // Depth: scale toward center
        // Warp: S-curve contrast (tanh waveshaping), bipolar
        if (Math.abs(warp) > 0.001) {
            var centered = (v - 0.5) * 2; // -1..+1
            if (warp > 0) {
                // Positive warp: compress (S-curve via tanh)
                var k = 1 + warp * 8;
                var shaped = Math.tanh(centered * k) / Math.tanh(k);
                v = shaped * 0.5 + 0.5;
            } else {
                // Negative warp: expand (inverse S-curve — push extremes)
                var aw = Math.abs(warp);
                var sign = centered >= 0 ? 1 : -1;
                var ac = Math.abs(centered);
                var expanded = Math.pow(ac, 1 / (1 + aw * 3)) * sign;
                v = expanded * 0.5 + 0.5;
            }
        }
        // Steps: output quantization
        if (stepsN >= 2) {
            v = Math.round(v * stepsN) / stepsN;
        }
        return Math.max(0, Math.min(1, v));
    }

    // Determine effect X range from selection (2+ points selected → restrict effects to that range)
    var selXMin = 0, selXMax = 1, hasSelRange = false;
    if (lane._sel && lane._sel.size >= 2) {
        selXMin = 1; selXMax = 0;
        lane._sel.forEach(function (idx) {
            if (pts[idx]) {
                if (pts[idx].x < selXMin) selXMin = pts[idx].x;
                if (pts[idx].x > selXMax) selXMax = pts[idx].x;
            }
        });
        if (selXMax > selXMin) hasSelRange = true;
        else { selXMin = 0; selXMax = 1; }
    }

    // Draw selection range highlight
    if (hasSelRange) {
        ctx.fillStyle = 'rgba(' + r + ',' + g + ',' + bl + ',0.07)';
        ctx.fillRect(selXMin * W, 0, (selXMax - selXMin) * W, H);
        // Edge lines
        ctx.strokeStyle = 'rgba(' + r + ',' + g + ',' + bl + ',0.3)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(selXMin * W, 0); ctx.lineTo(selXMin * W, H);
        ctx.moveTo(selXMax * W, 0); ctx.lineTo(selXMax * W, H);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    // Build processed curve (resampled polyline)
    var processedPts;
    if (hasEffect) {
        var STEPS = 256;
        processedPts = [];
        for (var si = 0; si <= STEPS; si++) {
            var sx = si / STEPS;
            var rawY = evalRawY(sx);
            // If selection range active, only apply effects within that range
            var py;
            if (hasSelRange && (sx < selXMin || sx > selXMax)) {
                py = rawY; // outside selection → no effects
            } else {
                py = processY(rawY);
            }
            processedPts.push({ x: sx, y: py });
        }
        // Drift = WYSIWYG organic variation (hermite noise only)
        // Sharpness above 70% = higher frequency, not discontinuous hash
        // driftScale: musical period for one noise cycle (independent of loop length)
        var driftAmt = Math.abs(drift);
        if (driftAmt > 0.001 && driftRange > 0.001) {
            // Phase scaling: drift operates on driftScale time, not loop time
            var loopBeats = laneLoopBeats(lane);
            var DS_BEAT_MAP = { '1/16': 0.25, '1/8': 0.5, '1/4': 1, '1/2': 2, '1/1': 4, '2/1': 8, '4/1': 16, '8/1': 32, '16/1': 64, '32/1': 128 };
            var driftScaleBeats = DS_BEAT_MAP[lane.driftScale || '1/1'] || 4;
            var phaseScale = loopBeats / driftScaleBeats; // how much of the noise pattern fits in one loop
            // Hash: integer → -1..+1
            var hashI = function (n) {
                var h = n | 0;
                h = ((h >>> 16) ^ h) | 0; h = Math.imul(h, 0x45d9f3b) | 0;
                h = ((h >>> 16) ^ h) | 0; h = Math.imul(h, 0x45d9f3b) | 0;
                h = ((h >>> 16) ^ h) | 0;
                return ((h & 0xFFFF) / 32768.0) - 1.0;
            };
            // Hermite-interpolated value noise (smooth & continuous)
            var smoothNoise = function (phase) {
                var i0 = Math.floor(phase);
                var frac = phase - i0;
                var v0 = hashI(i0 - 1), v1 = hashI(i0), v2 = hashI(i0 + 1), v3 = hashI(i0 + 2);
                var a = -0.5 * v0 + 1.5 * v1 - 1.5 * v2 + 0.5 * v3;
                var b2 = v0 - 2.5 * v1 + 2.0 * v2 - 0.5 * v3;
                var c = -0.5 * v0 + 0.5 * v2;
                return ((a * frac + b2) * frac + c) * frac + v1;
            };
            // Base frequency: positive=very slow, negative=moderate jitter
            var baseFreq = drift > 0
                ? (1.0 + driftAmt * 2.0)   // slow: 1-3 cycles per scale period
                : (4.0 + driftAmt * 10.0); // jitter: 4-14 cycles per scale period
            // Above 70%: boost frequency for sharper character (up to 3x)
            var sharpness = Math.max(0, (driftAmt - 0.7) / 0.3); // 0 at 70%, 1 at 100%
            var freq = baseFreq * (1.0 + sharpness * 2.0) * phaseScale;
            // Amplitude from driftRange
            var amp = driftRange;
            for (var fi = 0; fi < processedPts.length; fi++) {
                if (hasSelRange && (processedPts[fi].x < selXMin || processedPts[fi].x > selXMax)) continue;
                var p1 = processedPts[fi].x * freq;
                var p2 = processedPts[fi].x * freq * 2.37 + 7.13;
                var noise = smoothNoise(p1) * 0.7 + smoothNoise(p2) * 0.3;
                // Add 3rd octave at high sharpness for extra texture
                if (sharpness > 0.01) {
                    var p3 = processedPts[fi].x * freq * 5.19 + 13.7;
                    noise = noise * (1.0 - sharpness * 0.3) + smoothNoise(p3) * sharpness * 0.3;
                }
                processedPts[fi].y = Math.max(0, Math.min(1, processedPts[fi].y - noise * amp));
            }
        }
    }

    // --- Overlay: ghost of other lanes' shapes (multi-select) ---
    var overlayList = lane._overlayLanes || [];
    var labelY = 12;
    for (var ovi = 0; ovi < overlayList.length; ovi++) {
        var overlayIdx = overlayList[ovi];
        if (overlayIdx < 0 || overlayIdx >= b.lanes.length || overlayIdx === li) continue;
        var olane = b.lanes[overlayIdx];

        // Morph lane overlay: draw snapshot position markers
        if (olane.morphMode) {
            var oSnaps = olane.morphSnapshots || [];
            if (oSnaps.length === 0) continue;
            var oCol = olane.color;
            var or_ = parseInt(oCol.slice(1, 3), 16);
            var og = parseInt(oCol.slice(3, 5), 16);
            var ob = parseInt(oCol.slice(5, 7), 16);
            // Ratio for loop length scaling
            var mRatio = laneLoopBeats(lane) / laneLoopBeats(olane);
            for (var msi = 0; msi < oSnaps.length; msi++) {
                var sPos = oSnaps[msi].position;
                // Scale position by loop ratio (tile within 0..1)
                var sx = sPos / mRatio;
                if (sx > 1) continue;
                var xPx = sx * W;
                // Vertical dashed line
                ctx.beginPath();
                ctx.moveTo(xPx, 0); ctx.lineTo(xPx, H);
                ctx.strokeStyle = 'rgba(' + or_ + ',' + og + ',' + ob + ',0.3)';
                ctx.lineWidth = 1;
                ctx.setLineDash([3, 4]);
                ctx.stroke();
                ctx.setLineDash([]);
                // Hold zone hint
                var holdFrac = oSnaps[msi].hold != null ? oSnaps[msi].hold : 0.5;
                var leftGap = msi > 0 ? (sPos - oSnaps[msi - 1].position) / mRatio * W : sPos / mRatio * W;
                var rightGap = msi < oSnaps.length - 1 ? (oSnaps[msi + 1].position - sPos) / mRatio * W : (1 - sPos / mRatio) * W;
                var hL = leftGap * holdFrac * 0.5;
                var hR = rightGap * holdFrac * 0.5;
                ctx.fillStyle = 'rgba(' + or_ + ',' + og + ',' + ob + ',0.04)';
                ctx.fillRect(xPx - hL, 0, hL + hR, H);
                // Snapshot name label
                ctx.font = '7px Inter, sans-serif';
                ctx.fillStyle = 'rgba(' + or_ + ',' + og + ',' + ob + ',0.45)';
                ctx.textAlign = 'center';
                ctx.fillText(oSnaps[msi].name || ('S' + (msi + 1)), xPx, H - 4);
            }
            // Overlay label
            ctx.font = '8px Inter, sans-serif';
            ctx.fillStyle = 'rgba(' + or_ + ',' + og + ',' + ob + ',0.4)';
            ctx.textAlign = 'right';
            ctx.fillText('L' + (overlayIdx + 1) + ' morph (' + oSnaps.length + 's)', W - 4, labelY);
            labelY += 10;
            continue;
        }

        if (!olane.pts || olane.pts.length < 2) continue;

        var oCol = olane.color;
        var or_ = parseInt(oCol.slice(1, 3), 16);
        var og = parseInt(oCol.slice(3, 5), 16);
        var ob = parseInt(oCol.slice(5, 7), 16);

        // Scale points for different loop lengths
        var ratio = laneLoopBeats(lane) / laneLoopBeats(olane);
        var oPts = getOverlayPoints(olane, ratio);
        var oInterp = olane.interp;

        if (oPts.length < 2) continue;

        // Apply overlayed lane's depth + warp + steps + drift to the ghost points
        var oDepth = (olane.depth != null ? olane.depth : 100) / 100;
        var oWarp = (olane.warp || 0) / 50;
        var oSteps = olane.steps || 0;
        var oDrift = (olane.drift || 0) / 50;  // -1..+1
        var oDriftRange = (olane.driftRange != null ? olane.driftRange : 5) / 100; // 0..0.5
        var drawInterp = oInterp; // interpolation used for drawing

        var hasOverlayEffect = (oDepth !== 1.0 || Math.abs(oWarp) > 0.001 || oSteps >= 2 || (Math.abs(oDrift) > 0.001 && oDriftRange > 0.001));
        if (hasOverlayEffect) {
            // Resample into a dense polyline so steps/depth/warp/drift are properly visible
            var res = 200;
            var resampled = [];
            for (var ri = 0; ri <= res; ri++) {
                var rx = ri / res;
                // Evaluate raw curve at rx using overlay points + interpolation
                var ry = oPts[0].y;
                if (oPts.length > 1) {
                    if (rx <= oPts[0].x) { ry = oPts[0].y; }
                    else if (rx >= oPts[oPts.length - 1].x) { ry = oPts[oPts.length - 1].y; }
                    else {
                        for (var si = 0; si < oPts.length - 1; si++) {
                            if (rx >= oPts[si].x && rx < oPts[si + 1].x) {
                                var x0 = oPts[si].x, x1 = oPts[si + 1].x;
                                var y0p = oPts[si].y, y1p = oPts[si + 1].y;
                                var tp = (x1 > x0) ? (rx - x0) / (x1 - x0) : 0;
                                if (oInterp === 'step') { ry = y0p; }
                                else if (oInterp === 'smooth') { var tsp = tp * tp * (3 - 2 * tp); ry = y0p + (y1p - y0p) * tsp; }
                                else { ry = y0p + (y1p - y0p) * tp; }
                                break;
                            }
                        }
                    }
                }
                // Apply depth
                var vy = 0.5 + (ry - 0.5) * oDepth;
                // Apply warp
                if (Math.abs(oWarp) > 0.001) {
                    var c = (vy - 0.5) * 2;
                    if (oWarp > 0) {
                        var kw = 1 + oWarp * 8;
                        vy = Math.tanh(c * kw) / Math.tanh(kw) * 0.5 + 0.5;
                    } else {
                        var aw = Math.abs(oWarp);
                        var sw = c >= 0 ? 1 : -1;
                        vy = sw * Math.pow(Math.abs(c), 1 / (1 + aw * 4)) * 0.5 + 0.5;
                    }
                }
                // Apply steps
                if (oSteps >= 2) {
                    vy = Math.round(vy * oSteps) / oSteps;
                }
                resampled.push({ x: rx, y: Math.max(0, Math.min(1, vy)) });
            }
            // Apply drift: smooth→sharp noise with driftRange amplitude
            var oDriftAmt = Math.abs(oDrift);
            if (oDriftAmt > 0.001 && oDriftRange > 0.001) {
                var oHashI = function (n) {
                    var h = n | 0;
                    h = ((h >>> 16) ^ h) | 0; h = Math.imul(h, 0x45d9f3b) | 0;
                    h = ((h >>> 16) ^ h) | 0; h = Math.imul(h, 0x45d9f3b) | 0;
                    h = ((h >>> 16) ^ h) | 0;
                    return ((h & 0xFFFF) / 32768.0) - 1.0;
                };
                var oSmoothNoise = function (phase) {
                    var i0 = Math.floor(phase);
                    var frac = phase - i0;
                    var v0 = oHashI(i0 - 1), v1 = oHashI(i0), v2 = oHashI(i0 + 1), v3 = oHashI(i0 + 2);
                    var a = -0.5 * v0 + 1.5 * v1 - 1.5 * v2 + 0.5 * v3;
                    var b2 = v0 - 2.5 * v1 + 2.0 * v2 - 0.5 * v3;
                    var c = -0.5 * v0 + 0.5 * v2;
                    return ((a * frac + b2) * frac + c) * frac + v1;
                };
                var oBaseFreq = oDrift > 0 ? (1.0 + oDriftAmt * 2.0) : (4.0 + oDriftAmt * 10.0);
                var oSharpness = Math.max(0, (oDriftAmt - 0.7) / 0.3);
                var oFreq = oBaseFreq * (1.0 + oSharpness * 2.0);
                for (var fi = 0; fi < resampled.length; fi++) {
                    var op1 = resampled[fi].x * oFreq;
                    var op2 = resampled[fi].x * oFreq * 2.37 + 7.13;
                    var oNoise = oSmoothNoise(op1) * 0.7 + oSmoothNoise(op2) * 0.3;
                    if (oSharpness > 0.01) {
                        var op3 = resampled[fi].x * oFreq * 5.19 + 13.7;
                        oNoise = oNoise * (1.0 - oSharpness * 0.3) + oSmoothNoise(op3) * oSharpness * 0.3;
                    }
                    resampled[fi].y = Math.max(0, Math.min(1, resampled[fi].y - oNoise * oDriftRange));
                }
            }
            oPts = resampled;
            drawInterp = 'linear'; // resampled polyline — always linear
        }

        // Filled ghost
        ctx.beginPath();
        ctx.moveTo(oPts[0].x * W, H);
        ctx.lineTo(oPts[0].x * W, laneYtoCanvas(oPts[0].y, H));
        laneTracePath(ctx, oPts, W, H, drawInterp);
        ctx.lineTo(oPts[oPts.length - 1].x * W, H);
        ctx.closePath();
        ctx.fillStyle = 'rgba(' + or_ + ',' + og + ',' + ob + ',0.06)';
        ctx.fill();

        // Dashed stroke
        ctx.beginPath();
        ctx.moveTo(oPts[0].x * W, laneYtoCanvas(oPts[0].y, H));
        laneTracePath(ctx, oPts, W, H, drawInterp);
        ctx.strokeStyle = 'rgba(' + or_ + ',' + og + ',' + ob + ',0.25)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.setLineDash([]);

        // Label with ratio info
        ctx.font = '8px Inter, sans-serif';
        ctx.fillStyle = 'rgba(' + or_ + ',' + og + ',' + ob + ',0.4)';
        ctx.textAlign = 'right';
        var oName = olane.pids[0] ? (PMap[olane.pids[0]] ? PMap[olane.pids[0]].name : '') : '';
        var ratioLabel = '';
        if (ratio > 1) {
            ratioLabel = ' (' + olane.loopLen + ')';
        } else if (ratio < 1) {
            var segCount = Math.round(1 / ratio);
            var ph = olane._phPos || 0;
            var segIdx = Math.min(Math.floor(ph / ratio), segCount - 1) + 1;
            ratioLabel = ' (' + olane.loopLen + ' ' + segIdx + '/' + segCount + ')';
        }
        ctx.fillText('L' + (overlayIdx + 1) + (oName ? ': ' + oName : '') + ratioLabel, W - 4, labelY);
        labelY += 10;

        // Draw tile boundary markers when tiling
        if (ratio > 1) {
            var tiles = Math.ceil(ratio);
            ctx.strokeStyle = 'rgba(' + or_ + ',' + og + ',' + ob + ',0.15)';
            ctx.lineWidth = 1;
            ctx.setLineDash([2, 4]);
            for (var t = 1; t < tiles; t++) {
                var tx = (t / ratio) * W;
                ctx.beginPath(); ctx.moveTo(tx, 0); ctx.lineTo(tx, H); ctx.stroke();
            }
            ctx.setLineDash([]);
        }
    }

    // Filled shape
    var drawPts = processedPts || pts;
    ctx.beginPath();
    ctx.moveTo(drawPts[0].x * W, H);
    ctx.lineTo(drawPts[0].x * W, laneYtoCanvas(drawPts[0].y, H));
    if (processedPts) {
        for (var di = 1; di < drawPts.length; di++) ctx.lineTo(drawPts[di].x * W, laneYtoCanvas(drawPts[di].y, H));
    } else {
        laneTracePath(ctx, drawPts, W, H, lane.interp);
    }
    ctx.lineTo(drawPts[drawPts.length - 1].x * W, H);
    ctx.closePath();
    var grd = ctx.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, 'rgba(' + r + ',' + g + ',' + bl + ',0.18)');
    grd.addColorStop(1, 'rgba(' + r + ',' + g + ',' + bl + ',0.02)');
    ctx.fillStyle = grd;
    ctx.fill();

    // Ghost of raw shape
    if (hasEffect) {
        ctx.beginPath();
        ctx.moveTo(pts[0].x * W, laneYtoCanvas(pts[0].y, H));
        laneTracePath(ctx, pts, W, H, lane.interp);
        ctx.strokeStyle = 'rgba(' + r + ',' + g + ',' + bl + ',0.2)';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    // Main stroke (processed curve)
    ctx.beginPath();
    if (processedPts) {
        ctx.moveTo(processedPts[0].x * W, laneYtoCanvas(processedPts[0].y, H));
        for (var di = 1; di < processedPts.length; di++) ctx.lineTo(processedPts[di].x * W, laneYtoCanvas(processedPts[di].y, H));
    } else {
        ctx.moveTo(pts[0].x * W, laneYtoCanvas(pts[0].y, H));
        laneTracePath(ctx, pts, W, H, lane.interp);
    }
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.stroke();


    // Breakpoints -" edge points (first/last) drawn as bigger squares, others as circles
    var sel = selSet || lane._sel;
    for (var i = 0; i < pts.length; i++) {
        var isSel = sel && sel.has(i);
        var ppx = pts[i].x * W, ppy = laneYtoCanvas(pts[i].y, H);
        var isEdgePt = (i === 0 || i === pts.length - 1);
        if (isSel) {
            ctx.beginPath(); ctx.arc(ppx, ppy, isEdgePt ? 12 : 8, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(' + r + ',' + g + ',' + bl + ',0.18)';
            ctx.fill();
        }
        if (isEdgePt) {
            // Bigger square for edge points (loop start/end)
            var es = isSel ? 8 : 7;
            ctx.fillStyle = isSel ? '#fff' : col;
            ctx.fillRect(ppx - es, ppy - es, es * 2, es * 2);
            ctx.strokeStyle = 'rgba(255,255,255,0.5)';
            ctx.lineWidth = 1.5;
            ctx.strokeRect(ppx - es, ppy - es, es * 2, es * 2);
        } else {
            var rad = isSel ? 5 : 3;
            ctx.beginPath(); ctx.arc(ppx, ppy, rad, 0, Math.PI * 2);
            ctx.fillStyle = isSel ? '#fff' : col;
            ctx.fill();
            ctx.strokeStyle = isSel ? col : 'rgba(0,0,0,0.4)';
            ctx.lineWidth = isSel ? 1.5 : 0.8;
            ctx.stroke();
        }
    }
    ctx.restore();

    // Cross-update: if other lanes are overlaying THIS lane, redraw them too
    if (!laneDrawCanvas._redrawing) {
        laneDrawCanvas._redrawing = true;
        for (var oi = 0; oi < b.lanes.length; oi++) {
            if (oi !== li && !b.lanes[oi].collapsed && b.lanes[oi]._overlayLanes && b.lanes[oi]._overlayLanes.indexOf(li) >= 0) {
                laneDrawCanvas(b, oi);
            }
        }
        laneDrawCanvas._redrawing = false;
    }
}

function laneTracePath(ctx, pts, W, H, interp) {
    if (interp === 'smooth') {
        for (var i = 0; i < pts.length - 1; i++) {
            var cx = (pts[i].x * W + pts[i + 1].x * W) / 2;
            ctx.bezierCurveTo(cx, laneYtoCanvas(pts[i].y, H), cx, laneYtoCanvas(pts[i + 1].y, H), pts[i + 1].x * W, laneYtoCanvas(pts[i + 1].y, H));
        }
    } else if (interp === 'step') {
        for (var i = 1; i < pts.length; i++) {
            ctx.lineTo(pts[i].x * W, laneYtoCanvas(pts[i - 1].y, H));
            ctx.lineTo(pts[i].x * W, laneYtoCanvas(pts[i].y, H));
        }
    } else {
        for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x * W, laneYtoCanvas(pts[i].y, H));
    }
}

// Rubber-band overlay
function laneDrawSelRect(b, li, x0, y0, x1, y1) {
    var cvs = document.getElementById('lcv-' + b.id + '-' + li);
    if (!cvs) return;
    var ctx = cvs.getContext('2d');
    var dpr = window.devicePixelRatio || 1;
    var W = cvs.width / dpr, H = cvs.height / dpr;
    laneDrawCanvas(b, li);
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var rx = Math.min(x0, x1) * W, ry = laneYtoCanvas(Math.min(y0, y1), H);
    var rw = Math.abs(x1 - x0) * W, rh = Math.abs(y1 - y0) * (H - 2 * LANE_Y_PAD);
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.strokeRect(rx, ry, rw, rh);
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    ctx.fillRect(rx, ry, rw, rh);
    ctx.restore();
}

// ---- Value tooltip for curve lane breakpoints ----
// Shows real plugin parameter values near hovered/dragged points.
var _getParamTextFn = null; // lazy ref to native function
function _ensureParamTextFn() {
    if (!_getParamTextFn && window.__JUCE__ && window.__JUCE__.backend) {
        _getParamTextFn = window.__juceGetNativeFunction('getParamTextForValue');
    }
    return _getParamTextFn;
}

function _laneShowTip(wrapId, xPx, yPx, text) {
    var wrap = document.getElementById(wrapId);
    if (!wrap) return;
    var tip = wrap.querySelector('.lane-value-tip');
    if (!tip) {
        tip = document.createElement('div');
        tip.className = 'lane-value-tip';
        wrap.appendChild(tip);
    }
    tip.textContent = text;
    // Measure tooltip size for proper clamping
    var tipW = tip.offsetWidth || 60;
    var tipH = tip.offsetHeight || 18;
    var wW = wrap.clientWidth, wH = wrap.clientHeight;
    // X: keep fully inside the wrapper
    var tx = Math.max(2, Math.min(xPx - tipW / 2, wW - tipW - 2));
    // Y: prefer above the dot, but shift below if near top edge
    var ty = yPx - tipH - 4;
    if (ty < 2) ty = yPx + 8;
    if (ty + tipH > wH - 2) ty = wH - tipH - 2;
    tip.style.left = tx + 'px';
    tip.style.top = ty + 'px';
    tip.style.display = '';
}
function _laneHideTip(wrapId) {
    var wrap = document.getElementById(wrapId);
    if (!wrap) return;
    var tip = wrap.querySelector('.lane-value-tip');
    if (tip) tip.style.display = 'none';
}

// Show tooltip with real plugin value. Never blinks during drag:
// if tooltip is already visible and we miss cache, keep current text
// and only update position; update text when C++ responds.
var _tipTextCache = {}; // key: "pid:quantizedNormVal" → display text
function _laneShowTipWithValue(wrapId, xPx, yPx, lane, yNorm) {
    var rawVal = 1 - yNorm; // canvas y: 0=top=100%, 1=bottom=0%
    // Apply depth + warp processing so tooltip matches actual output
    var depth = (lane.depth != null ? lane.depth : 100) / 100;
    var warp = (lane.warp || 0) / 50; // -1..+1
    var normVal = 0.5 + (rawVal - 0.5) * depth;
    if (Math.abs(warp) > 0.001) {
        var centered = (normVal - 0.5) * 2;
        if (warp > 0) {
            var wk = 1 + warp * 8;
            normVal = Math.tanh(centered * wk) / Math.tanh(wk) * 0.5 + 0.5;
        } else {
            var aw = Math.abs(warp);
            var sign = centered >= 0 ? 1 : -1;
            normVal = Math.pow(Math.abs(centered), 1 / (1 + aw * 3)) * sign * 0.5 + 0.5;
        }
    }
    normVal = Math.max(0, Math.min(1, normVal));
    var paramName = '';
    var pid = null;

    // Determine which param to query
    if (lane._selectedParamIdx != null && lane._selectedParamIdx >= 0 && lane.pids && lane.pids[lane._selectedParamIdx]) {
        pid = lane.pids[lane._selectedParamIdx];
    } else if (lane.pids && lane.pids.length === 1) {
        pid = lane.pids[0];
    }

    if (pid) {
        var sp = PMap[pid];
        if (sp) {
            paramName = sp.name || '';
            if (paramName.length > 12) paramName = paramName.substring(0, 11) + '\u2026';
        }
    }

    // Quantize to 0.5% steps for cache key (200 unique values per param)
    var qVal = Math.round(normVal * 200) / 200;
    var cacheKey = pid ? pid + ':' + qVal.toFixed(3) : '';
    var cachedText = cacheKey ? _tipTextCache[cacheKey] : null;

    // Build display text: prefer cache, else percentage
    var pctText = Math.round(normVal * 100) + '%';
    var displayText = cachedText
        ? (paramName ? paramName + ': ' + cachedText : cachedText)
        : (paramName ? paramName + ': ' + pctText : pctText);

    // Always use _laneShowTip for consistent positioning (no flicker)
    _laneShowTip(wrapId, xPx, yPx, displayText);

    // Fire async request to C++ for real display text (populates cache for next frame)
    if (pid && !cachedText) {
        var fn = _ensureParamTextFn();
        if (fn) {
            var parts = pid.split(':');
            if (parts.length === 2) {
                var pluginId = parseInt(parts[0]);
                var paramIndex = parseInt(parts[1]);
                var _ck = cacheKey;
                var _wrapId = wrapId;
                var _pName = paramName;
                fn(pluginId, paramIndex, normVal).then(function (realText) {
                    if (realText) {
                        _tipTextCache[_ck] = realText;
                        // Update tip if still visible
                        var w = document.getElementById(_wrapId);
                        if (w) {
                            var t = w.querySelector('.lane-value-tip');
                            if (t && t.style.display !== 'none') {
                                t.textContent = _pName ? _pName + ': ' + realText : realText;
                            }
                        }
                    }
                });
            }
        }
    }
}

function laneSetupMouse(b, li) {
    var cvs = document.getElementById('lcv-' + b.id + '-' + li);
    if (!cvs) return;
    var lane = b.lanes[li];
    if (!lane) return;
    if (lane.morphMode) {
        // ═══════════ MORPH LANE MOUSE ═══════════
        var dpr = window.devicePixelRatio || 1;
        var SNAP_HIT = 12;

        function morphPos(e) {
            var rect = cvs.getBoundingClientRect();
            return { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height };
        }

        function findSnapAt(xNorm) {
            var snaps = lane.morphSnapshots || [];
            var W = cvs.width / dpr;
            for (var i = 0; i < snaps.length; i++) {
                if (Math.abs(snaps[i].position * W - xNorm * W) < SNAP_HIT) return i;
            }
            return -1;
        }

        // Inline label editing
        function startInlineEdit(sIdx) {
            var snap = lane.morphSnapshots[sIdx];
            if (!snap) return;
            var wrap = cvs.parentElement;
            var xPx = snap.position * wrap.clientWidth;
            var inp = document.createElement('input');
            inp.type = 'text';
            inp.value = snap.name || '';
            inp.className = 'morph-inline-edit';
            inp.style.cssText = 'position:absolute;left:' + Math.max(0, xPx - 30) + 'px;top:2px;width:60px;';
            wrap.appendChild(inp);
            inp.focus();
            inp.select();
            function commit() {
                snap.name = inp.value || snap.name;
                if (inp.parentElement) inp.remove();
                laneDrawCanvas(b, li);
                renderSingleBlock(b.id);
                syncBlocksToHost();
            }
            inp.onkeydown = function (ke) { if (ke.key === 'Enter') commit(); if (ke.key === 'Escape') { inp.remove(); } };
            inp.onblur = commit;
        }

        // Drag state
        var dragSnap = -1, dragHoldSnap = -1, didDrag = false;
        var HOLD_HIT = 6;

        // Find if click is near a hold zone edge \u2014 returns { snapIdx, side } or null
        function findHoldHandleAt(xNorm) {
            var snaps = lane.morphSnapshots || [];
            var W = cvs.width / dpr;
            var xPx = xNorm * W;
            for (var i = 0; i < snaps.length; i++) {
                var snap = snaps[i];
                var xSnap = snap.position * W;
                var hold = snap.hold != null ? snap.hold : 0.5;
                var leftGap = i > 0 ? (snap.position - snaps[i - 1].position) * W : snap.position * W;
                var rightGap = i < snaps.length - 1 ? (snaps[i + 1].position - snap.position) * W : (1 - snap.position) * W;
                var holdLeftEdge = xSnap - leftGap * hold * 0.5;
                var holdRightEdge = xSnap + rightGap * hold * 0.5;
                if (Math.abs(xPx - holdLeftEdge) < HOLD_HIT && leftGap > 4) return { snapIdx: i, side: 'left' };
                if (Math.abs(xPx - holdRightEdge) < HOLD_HIT && rightGap > 4) return { snapIdx: i, side: 'right' };
            }
            return null;
        }

        cvs.onmousedown = function (e) {
            if (e.button === 2) return;
            e.preventDefault();
            var p = morphPos(e);
            didDrag = false;

            // Priority 1: Hold handle drag
            var holdHit = findHoldHandleAt(p.x);
            if (holdHit) {
                dragHoldSnap = holdHit.snapIdx;
                // If the hold handle is on a selected snapshot, keep multi-select; otherwise select just this one
                if (!lane._selectedSnaps) lane._selectedSnaps = new Set();
                if (!lane._selectedSnaps.has(holdHit.snapIdx)) {
                    lane._selectedSnaps.clear();
                    lane._selectedSnaps.add(holdHit.snapIdx);
                }
                lane._selectedSnap = holdHit.snapIdx;
                pushUndoSnapshot();
                laneDrawCanvas(b, li);
                var holdSide = holdHit.side;

                var onMoveHold = function (ev) {
                    didDrag = true;
                    var rect = cvs.getBoundingClientRect();
                    var W = cvs.width / dpr;
                    var mx = (ev.clientX - rect.left) / rect.width;
                    var snap = lane.morphSnapshots[dragHoldSnap];
                    if (!snap) return;
                    var xSnap = snap.position;
                    var leftGap = dragHoldSnap > 0 ? (xSnap - lane.morphSnapshots[dragHoldSnap - 1].position) : xSnap;
                    var rightGap = dragHoldSnap < lane.morphSnapshots.length - 1 ? (lane.morphSnapshots[dragHoldSnap + 1].position - xSnap) : (1 - xSnap);
                    // Calculate new hold from edge position
                    var newHold;
                    if (holdSide === 'left' && leftGap > 0.001) {
                        var edgeDist = (xSnap - mx);
                        newHold = Math.max(0, Math.min(1, (edgeDist / (leftGap * 0.5))));
                    } else if (holdSide === 'right' && rightGap > 0.001) {
                        var edgeDist = (mx - xSnap);
                        newHold = Math.max(0, Math.min(1, (edgeDist / (rightGap * 0.5))));
                    }
                    if (newHold !== undefined) {
                        // Apply to ALL selected snapshots
                        if (lane._selectedSnaps && lane._selectedSnaps.size > 0) {
                            lane._selectedSnaps.forEach(function (si) {
                                if (lane.morphSnapshots[si]) lane.morphSnapshots[si].hold = newHold;
                            });
                        } else {
                            snap.hold = newHold;
                        }
                        laneDrawCanvas(b, li);
                    }
                };
                var onUpHold = function () {
                    document.removeEventListener('mousemove', onMoveHold);
                    document.removeEventListener('mouseup', onUpHold);
                    dragHoldSnap = -1;
                    if (didDrag) syncBlocksToHost();
                    renderSingleBlock(b.id);
                };
                document.addEventListener('mousemove', onMoveHold);
                document.addEventListener('mouseup', onUpHold);
                return;
            }

            // Priority 2: Snap column drag
            var sIdx = findSnapAt(p.x);
            if (sIdx >= 0) {
                dragSnap = sIdx;
                if (!lane._selectedSnaps) lane._selectedSnaps = new Set();
                if (e.ctrlKey || e.metaKey) {
                    if (lane._selectedSnaps.has(sIdx)) {
                        lane._selectedSnaps.delete(sIdx);
                        if (lane._selectedSnaps.size > 0) {
                            var arr = Array.from(lane._selectedSnaps);
                            lane._selectedSnap = arr[arr.length - 1];
                        } else {
                            lane._selectedSnap = -1;
                        }
                    } else {
                        lane._selectedSnaps.add(sIdx);
                        lane._selectedSnap = sIdx;
                    }
                } else {
                    lane._selectedSnaps.clear();
                    lane._selectedSnaps.add(sIdx);
                    lane._selectedSnap = sIdx;
                }
                pushUndoSnapshot();
                laneDrawCanvas(b, li);
                // NOTE: do NOT call renderSingleBlock here — it destroys the
                // canvas and kills our drag closure. Sidebar/footer update on mouseup.
            } else {
                lane._selectedSnap = -1;
                if (lane._selectedSnaps) lane._selectedSnaps.clear();
                laneDrawCanvas(b, li);
                renderSingleBlock(b.id);
                return;
            }

            var onMove = function (ev) {
                didDrag = true;
                var rect = cvs.getBoundingClientRect();
                var mx = (ev.clientX - rect.left) / rect.width;
                var snaps = lane.morphSnapshots;
                var newPos = Math.max(0, Math.min(1, mx));
                if (snaps.length > 1) {
                    if (dragSnap === 0) newPos = 0;
                    else if (dragSnap === snaps.length - 1) newPos = 1;
                    else newPos = Math.max(snaps[dragSnap - 1].position + 0.01, Math.min(snaps[dragSnap + 1].position - 0.01, newPos));
                }
                snaps[dragSnap].position = newPos;
                laneDrawCanvas(b, li);
            };
            var onUp = function () {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                if (didDrag) syncBlocksToHost();
                dragSnap = -1;
                renderSingleBlock(b.id);
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        };

        // Cursor
        cvs.onmousemove = function (e) {
            if (dragSnap >= 0) { cvs.style.cursor = 'grabbing'; return; }
            if (dragHoldSnap >= 0) { cvs.style.cursor = 'ew-resize'; return; }
            var p = morphPos(e);
            if (findHoldHandleAt(p.x)) { cvs.style.cursor = 'ew-resize'; }
            else if (findSnapAt(p.x) >= 0) { cvs.style.cursor = 'grab'; }
            else { cvs.style.cursor = 'crosshair'; }
        };

        // Double-click: edit label on snap, or add snapshot on empty
        cvs.ondblclick = function (e) {
            e.preventDefault();
            var p = morphPos(e);
            var sIdx = findSnapAt(p.x);
            if (sIdx >= 0) {
                startInlineEdit(sIdx);
            } else {
                // Add snapshot at click position
                pushUndoSnapshot();
                if (!lane.morphSnapshots) lane.morphSnapshots = [];
                var vals = {};
                (lane.pids || []).forEach(function (pid) {
                    var pp = PMap[pid];
                    if (pp && !pp.lk) vals[pid] = pp.v;
                });
                var newSnap = { position: p.x, hold: 0.5, curve: 0, name: 'S' + (lane.morphSnapshots.length + 1), source: '', values: vals };
                lane.morphSnapshots.push(newSnap);
                lane.morphSnapshots.sort(function (a, bb) { return a.position - bb.position; });
                for (var ni = 0; ni < lane.morphSnapshots.length; ni++) {
                    if (lane.morphSnapshots[ni] === newSnap) { lane._selectedSnap = ni; break; }
                }
                laneDrawCanvas(b, li);
                renderSingleBlock(b.id);
                syncBlocksToHost();
            }
        };

        // Right-click context menu
        cvs.oncontextmenu = function (e) {
            e.preventDefault();
            e.stopPropagation();
            var p = morphPos(e);
            var sIdx = findSnapAt(p.x);
            var old = document.querySelector('.morph-ctx-menu');
            if (old) old.remove();
            if (sIdx < 0) return;
            var snap = lane.morphSnapshots[sIdx];
            lane._selectedSnap = sIdx;
            laneDrawCanvas(b, li);

            var menu = document.createElement('div');
            menu.className = 'morph-ctx-menu lane-add-menu';
            menu.style.cssText = 'position:fixed;left:' + e.clientX + 'px;top:' + e.clientY + 'px;z-index:9999;min-width:130px;';

            var items = [
                { label: 'Duplicate', key: 'Ctrl+D', action: function () { _morphSnapDuplicate(b, li, lane, sIdx); } },
                { label: 'Rename', action: function () { startInlineEdit(sIdx); } },
                { label: 'Recapture', action: function () { pushUndoSnapshot(); (lane.pids || []).forEach(function (pid) { var pp = PMap[pid]; if (pp && !pp.lk) snap.values[pid] = pp.v; }); laneDrawCanvas(b, li); syncBlocksToHost(); } },
                { label: '---' },
                { label: 'Smooth' + (snap.curve === 0 ? ' \u2713' : ''), action: function () { snap.curve = 0; laneDrawCanvas(b, li); renderSingleBlock(b.id); syncBlocksToHost(); } },
                { label: 'Linear' + (snap.curve === 1 ? ' \u2713' : ''), action: function () { snap.curve = 1; laneDrawCanvas(b, li); renderSingleBlock(b.id); syncBlocksToHost(); } },
                { label: 'Sharp' + (snap.curve === 2 ? ' \u2713' : ''), action: function () { snap.curve = 2; laneDrawCanvas(b, li); renderSingleBlock(b.id); syncBlocksToHost(); } },
                { label: 'Late' + (snap.curve === 3 ? ' \u2713' : ''), action: function () { snap.curve = 3; laneDrawCanvas(b, li); renderSingleBlock(b.id); syncBlocksToHost(); } },
                { label: '---' },
                { label: 'Delete', action: function () { pushUndoSnapshot(); lane.morphSnapshots.splice(sIdx, 1); if (lane.morphSnapshots.length > 1) { lane.morphSnapshots[0].position = 0; lane.morphSnapshots[lane.morphSnapshots.length - 1].position = 1; } else if (lane.morphSnapshots.length === 1) { lane.morphSnapshots[0].position = 0; } lane._selectedSnap = -1; laneDrawCanvas(b, li); renderSingleBlock(b.id); syncBlocksToHost(); } }
            ];

            items.forEach(function (item) {
                if (item.label === '---') {
                    var sep = document.createElement('div');
                    sep.style.cssText = 'height:1px;background:var(--border);margin:3px 0;';
                    menu.appendChild(sep);
                    return;
                }
                var el = document.createElement('div');
                el.className = 'lane-add-menu-item';
                el.textContent = item.label;
                el.onclick = function (ev) { ev.stopPropagation(); menu.remove(); item.action(); };
                menu.appendChild(el);
            });

            document.body.appendChild(menu);
            setTimeout(function () {
                var dismiss = function (de) { if (!menu.contains(de.target)) { menu.remove(); document.removeEventListener('mousedown', dismiss); } };
                document.addEventListener('mousedown', dismiss);
            }, 10);
        };

        return;
    }
    // ═══════════ CURVE LANE MOUSE (existing) ═══════════
    if (!lane._sel) lane._sel = new Set();
    var active = false, rafPending = false;
    var selDrag = null;
    var _tipWrapId = 'lcw-' + b.id + '-' + li;

    // Edge points: first and last in the sorted array -" cannot be deleted or moved horizontally
    function isEdge(idx) {
        if (!lane.pts[idx]) return false;
        return idx === 0 || idx === lane.pts.length - 1;
    }

    function posRaw(e) {
        var r = cvs.getBoundingClientRect();
        var pyPx = e.clientY - r.top;
        var H = r.height;
        return {
            x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
            y: laneCanvasToY(pyPx, H)
        };
    }
    function getStep() {
        if (b.laneGrid === 'free') return 0;
        var parts = b.laneGrid.split('/');
        return parts.length === 2 ? Number(parts[0]) / Number(parts[1]) : 1;
    }
    function snap(p) {
        var step = getStep();
        if (!step) return p;
        return { x: Math.max(0, Math.min(1, Math.round(p.x / step) * step)), y: p.y };
    }
    // Hard snap: lock x to nearest grid line
    function softSnap(x) {
        var step = getStep();
        if (!step) return x; // Free mode: no snap
        return Math.round(x / step) * step;
    }
    function schedDraw() {
        if (rafPending) return;
        rafPending = true;
        requestAnimationFrame(function () { rafPending = false; laneDrawCanvas(b, li); });
    }
    function findNearest(p, radius) {
        var best = -1, bestD = radius * radius;
        for (var i = 0; i < lane.pts.length; i++) {
            // Edge points (first/last) get 3x larger hit area for easy grabbing
            var r2 = isEdge(i) ? (radius * 3) * (radius * 3) : radius * radius;
            var dx = lane.pts[i].x - p.x, dy = lane.pts[i].y - p.y;
            var d = dx * dx + dy * dy;
            if (d < r2 && d < bestD) { bestD = d; best = i; }
        }
        return best;
    }

    cvs.onmousedown = function (e) {
        if (e.button === 2) return; // right-click handled by contextmenu
        e.preventDefault(); e.stopPropagation();
        active = true;
        pushUndoSnapshot();
        var pr = posRaw(e), ps = snap(pr);

        // Bind drag handlers to DOCUMENT so dragging outside canvas still works
        document.addEventListener('mousemove', docMoveHandler);
        document.addEventListener('mouseup', docUpHandler);

        if (b.laneTool === 'draw') {
            var hit = findNearest(pr, 0.035);
            if (hit >= 0) {
                // capture before modifying _sel
                var wasAlready = lane._sel.has(hit);
                // Ctrl+click: toggle selection without clearing others
                if (e.ctrlKey || e.metaKey) {
                    if (lane._sel.has(hit)) lane._sel.delete(hit); else lane._sel.add(hit);
                } else if (!lane._sel.has(hit)) {
                    lane._sel.clear(); lane._sel.add(hit);
                }
                var anch = [];
                lane._sel.forEach(function (idx) {
                    if (lane.pts[idx]) anch.push({ idx: idx, ox: lane.pts[idx].x, oy: lane.pts[idx].y });
                });
                selDrag = {
                    mode: 'grab', startX: pr.x, startY: pr.y, anchors: anch, hitIdx: hit, moved: false,
                    clickedHit: hit, wasAlreadySel: wasAlready
                };
            } else {
                lanePutPt(lane, ps, getStep());
                selDrag = { mode: 'draw', lastX: ps.x };
            }
            schedDraw();
        } else if (b.laneTool === 'erase') {
            lane.pts = lane.pts.filter(function (pt, i) {
                if (isEdge(i)) return true;
                return Math.abs(pt.x - pr.x) > 0.04 || Math.abs(pt.y - pr.y) > 0.15;
            });
            lane._sel.clear();
            schedDraw();
            selDrag = { mode: 'erase' };
        } else if (b.laneTool === 'select') {
            var hit = findNearest(pr, 0.035);
            if (hit >= 0) {
                var wasAlready = lane._sel.has(hit);
                if (e.ctrlKey || e.metaKey) {
                    if (lane._sel.has(hit)) lane._sel.delete(hit); else lane._sel.add(hit);
                } else if (!lane._sel.has(hit)) {
                    lane._sel.clear(); lane._sel.add(hit);
                }
                var anchors = [];
                lane._sel.forEach(function (idx) {
                    if (lane.pts[idx]) anchors.push({ idx: idx, ox: lane.pts[idx].x, oy: lane.pts[idx].y });
                });
                selDrag = { mode: 'move', startX: pr.x, startY: pr.y, anchors: anchors, moved: false, clickedHit: hit, wasAlreadySel: wasAlready };
            } else {
                if (!e.ctrlKey && !e.metaKey) lane._sel.clear();
                selDrag = { mode: 'box', x0: pr.x, y0: pr.y };
            }
            schedDraw();
        }
    };

    // --- Document-level drag handlers (fix: drag outside canvas no longer drops) ---
    function docMoveHandler(e) {
        if (!active || !selDrag) return;
        var pr = posRaw(e), ps = snap(pr);

        if (selDrag.mode === 'draw') {
            var minD = b.laneGrid === 'free' ? 0.004 : 0.001;
            if (Math.abs(ps.x - selDrag.lastX) >= minD) {
                lanePutPt(lane, ps, getStep());
                selDrag.lastX = ps.x;
                schedDraw();
            }
        } else if (selDrag.mode === 'grab' || selDrag.mode === 'move') {
            var dx = pr.x - selDrag.startX, dy = pr.y - selDrag.startY;
            if (Math.abs(dx) > 0.002 || Math.abs(dy) > 0.002) selDrag.moved = true;
            // Shift-constrain: lock to dominant axis
            if (e.shiftKey && selDrag.moved) {
                if (Math.abs(dx) > Math.abs(dy)) { dy = 0; } else { dx = 0; }
            }
            for (var i = 0; i < selDrag.anchors.length; i++) {
                var a = selDrag.anchors[i];
                if (lane.pts[a.idx]) {
                    if (isEdge(a.idx)) {
                        lane.pts[a.idx].y = Math.max(0, Math.min(1, a.oy + dy));
                    } else {
                        var rawX = Math.max(0, Math.min(1, a.ox + dx));
                        // Clamp X between neighboring non-selected points
                        var prevX = 0, nextX = 1;
                        for (var pi = a.idx - 1; pi >= 0; pi--) {
                            if (!lane._sel.has(pi)) { prevX = lane.pts[pi].x + 0.001; break; }
                        }
                        for (var ni = a.idx + 1; ni < lane.pts.length; ni++) {
                            if (!lane._sel.has(ni)) { nextX = lane.pts[ni].x - 0.001; break; }
                        }
                        rawX = Math.max(prevX, Math.min(nextX, rawX));
                        lane.pts[a.idx].x = softSnap(rawX);
                        lane.pts[a.idx].y = Math.max(0, Math.min(1, a.oy + dy));
                    }
                }
            }
            // Show value tooltip on the first dragged point
            if (selDrag.anchors.length > 0) {
                var _da = selDrag.anchors[0];
                var _dp = lane.pts[_da.idx];
                if (_dp) {
                    var _wrap = document.getElementById(_tipWrapId);
                    if (_wrap) {
                        _laneShowTipWithValue(_tipWrapId, _dp.x * _wrap.clientWidth, laneYtoCanvas(_dp.y, _wrap.clientHeight || LANE_CANVAS_H), lane, _dp.y);
                    }
                }
            }
            schedDraw();
        } else if (selDrag.mode === 'erase') {
            lane.pts = lane.pts.filter(function (pt, i) {
                if (isEdge(i)) return true;
                return Math.abs(pt.x - pr.x) > 0.04 || Math.abs(pt.y - pr.y) > 0.15;
            });
            lane._sel.clear();
            schedDraw();
        } else if (selDrag.mode === 'box') {
            if (!rafPending) {
                rafPending = true;
                var x0 = selDrag.x0, y0 = selDrag.y0, x1 = pr.x, y1 = pr.y;
                requestAnimationFrame(function () {
                    rafPending = false;
                    var minX = Math.min(x0, x1), maxX = Math.max(x0, x1);
                    var minY = Math.min(y0, y1), maxY = Math.max(y0, y1);
                    lane._sel.clear();
                    for (var i = 0; i < lane.pts.length; i++) {
                        if (lane.pts[i].x >= minX && lane.pts[i].x <= maxX && lane.pts[i].y >= minY && lane.pts[i].y <= maxY) {
                            lane._sel.add(i);
                        }
                    }
                    laneDrawSelRect(b, li, x0, y0, x1, y1);
                });
            }
        }
    }

    function mouseUp() {
        if (!active) return;
        active = false;
        _laneHideTip(_tipWrapId);
        document.removeEventListener('mousemove', docMoveHandler);
        document.removeEventListener('mouseup', docUpHandler);
        if (selDrag && (selDrag.mode === 'move' || selDrag.mode === 'grab') && selDrag.moved) {
            laneResortWithSel(lane);
        }
        // Deselect dot if it was already selected and we didn't drag (toggle behavior)
        if (selDrag && (selDrag.mode === 'move' || selDrag.mode === 'grab') && !selDrag.moved && selDrag.clickedHit >= 0) {
            if (selDrag.wasAlreadySel && lane._sel.size > 0) {
                lane._sel.delete(selDrag.clickedHit);
            }
        }
        selDrag = null;
        schedDraw();
        if (laneSetupMouse._syncTimer) cancelAnimationFrame(laneSetupMouse._syncTimer);
        laneSetupMouse._syncTimer = requestAnimationFrame(function () { laneSetupMouse._syncTimer = null; syncBlocksToHost(); });
    }
    function docUpHandler() { mouseUp(); }

    cvs.onmouseup = mouseUp;
    cvs.onmouseleave = function (e) {
        // Don't drop the drag - document-level handlers keep working
        if (!active) {
            cvs.style.cursor = 'crosshair';
            _laneHideTip(_tipWrapId);
        }
    };

    // Hover cursor: indicate grabbable dots + show value tooltip
    var hoverHandler = function (e) {
        if (active) return;
        if (b.laneTool === 'erase') { cvs.style.cursor = 'crosshair'; _laneHideTip(_tipWrapId); return; }
        var pr = posRaw(e);
        var hit = findNearest(pr, 0.025);
        if (hit >= 0) {
            cvs.style.cursor = isEdge(hit) ? 'ns-resize' : 'grab';
            // Show value tooltip near the point
            var pt = lane.pts[hit];
            if (pt) {
                var _wrap = document.getElementById(_tipWrapId);
                if (_wrap) {
                    _laneShowTipWithValue(_tipWrapId, pt.x * _wrap.clientWidth, laneYtoCanvas(pt.y, _wrap.clientHeight || LANE_CANVAS_H), lane, pt.y);
                }
            }
        } else {
            cvs.style.cursor = 'crosshair';
            _laneHideTip(_tipWrapId);
        }
    };
    cvs.addEventListener('mousemove', hoverHandler);

    // Double-click: add single breakpoint
    cvs.ondblclick = function (e) {
        e.preventDefault(); e.stopPropagation();
        var ps = snap(posRaw(e));
        pushUndoSnapshot();
        lanePutPt(lane, ps, getStep());
        lane._sel.clear();
        schedDraw();
    };

    // Right-click context menu on points
    cvs.oncontextmenu = function (e) {
        e.preventDefault(); e.stopPropagation();
        var pr = posRaw(e);
        var hit = findNearest(pr, 0.025);
        if (hit < 0) return;
        // Select the right-clicked point if not already selected
        if (!lane._sel.has(hit)) { lane._sel.clear(); lane._sel.add(hit); }
        schedDraw();
        laneShowCtxMenu(b, li, lane, e.clientX, e.clientY);
    };

    // Shift + scroll wheel: adjust depth (plain scroll passes through for page scrolling)
    // Use the wrapper div (not canvas) so events fire without needing prior click focus
    var wrapEl = cvs.parentElement;
    if (wrapEl) wrapEl.addEventListener('wheel', function (e) {
        if (!e.shiftKey) return; // let normal scroll pass through
        e.preventDefault();
        var delta = e.deltaY > 0 ? -5 : 5;
        lane.depth = Math.max(0, Math.min(200, (lane.depth != null ? lane.depth : 100) + delta));
        schedDraw();
        // Cross-update overlaying lanes
        for (var ci = 0; ci < b.lanes.length; ci++) {
            if (ci === li) continue;
            var cl = b.lanes[ci];
            if (cl._overlayLanes && cl._overlayLanes.indexOf(li) >= 0) {
                laneDrawCanvas(b, ci);
            }
        }
        // Update footer knob display if present
        var ftEl = cvs.closest('.lane-item');
        if (ftEl) {
            var depthKnob = ftEl.querySelector('[data-lk="depth"]');
            if (depthKnob) depthKnob.textContent = 'Depth ' + Math.round(lane.depth) + '%';
        }

        syncBlocksToHost();
    }, { passive: false });
}
laneSetupMouse._syncTimer = null;

// Re-sort points and remap _sel indices after a move
function laneResortWithSel(lane) {
    var tagged = lane.pts.map(function (p, i) { return { x: p.x, y: p.y, wasSel: lane._sel.has(i), isEdge: (p.x < 0.01 || p.x > 0.99) }; });
    tagged.sort(function (a, bb) { return a.x - bb.x; });
    lane._sel.clear();
    lane.pts = [];
    for (var i = 0; i < tagged.length; i++) {
        var px = tagged[i].isEdge ? tagged[i].x : tagged[i].x; // edge points keep their x
        lane.pts.push({ x: px, y: tagged[i].y });
        if (tagged[i].wasSel) lane._sel.add(i);
    }
}

// Generate a random automation shape for a lane
function laneRandomize(lane, gridMode) {
    var pts = [];
    var startY = Math.random();
    var endY = Math.random();
    pts.push({ x: 0, y: startY });

    if (gridMode === 'free') {
        // Free mode: 6-12 random breakpoints
        var count = 6 + Math.floor(Math.random() * 7);
        for (var i = 0; i < count; i++) {
            var x = 0.05 + Math.random() * 0.9; // avoid edges
            pts.push({ x: x, y: Math.random() });
        }
    } else {
        // Grid mode: place breakpoints at grid positions
        var parts = gridMode.split('/');
        var step = parts.length === 2 ? Number(parts[0]) / Number(parts[1]) : 1;
        var divisions = Math.round(1 / step);
        for (var i = 1; i < divisions; i++) {
            var x = i * step;
            // Skip some positions for variety (30% chance to skip)
            if (divisions > 4 && Math.random() < 0.3) continue;
            pts.push({ x: x, y: Math.random() });
        }
    }

    pts.push({ x: 1, y: endY });
    pts.sort(function (a, bb) { return a.x - bb.x; });
    lane.pts = pts;
}

function lanePutPt(lane, pt, gridStep) {
    // Drawing near an edge point updates its y value directly
    if (pt.x < 0.02 && lane.pts.length && lane.pts[0].x < 0.01) {
        lane.pts[0].y = pt.y;
        return;
    }
    var last = lane.pts.length - 1;
    if (pt.x > 0.98 && last >= 0 && lane.pts[last].x > 0.99) {
        lane.pts[last].y = pt.y;
        return;
    }
    // Grid-aware removal: half the grid step, or 0.004 for free
    var clearRadius = gridStep ? gridStep * 0.49 : 0.004;
    // Protect edge points, remove points within the clear zone
    lane.pts = lane.pts.filter(function (p) {
        if (p.x < 0.01 || p.x > 0.99) return true; // never remove edge points
        return Math.abs(p.x - pt.x) > clearRadius;
    });
    lane.pts.push({ x: pt.x, y: pt.y });
    lane.pts.sort(function (a, bb) { return a.x - bb.x; });
}

// Right-click context menu for lane points
function laneShowCtxMenu(b, li, lane, cx, cy) {
    // Remove any existing context menu
    var old = document.querySelector('.lane-ctx-menu');
    if (old) old.remove();

    var menu = document.createElement('div');
    menu.className = 'lane-ctx-menu lane-add-menu';
    var menuW = 140, menuH = 200; // estimated
    var vw = window.innerWidth, vh = window.innerHeight;
    var posLeft = cx, posTop = cy;
    if (posLeft + menuW > vw - 4) posLeft = vw - menuW - 4;
    if (posLeft < 4) posLeft = 4;
    if (posTop + menuH > vh - 4) posTop = Math.max(4, cy - menuH);
    menu.style.cssText = 'position:fixed;left:' + posLeft + 'px;top:' + posTop + 'px;z-index:9999;min-width:' + menuW + 'px;';

    var items = [
        {
            label: 'Delete', key: 'Del', action: function () {
                pushUndoSnapshot();
                lane.pts = lane.pts.filter(function (p, i) {
                    if (p.x < 0.01 || p.x > 0.99) return true;
                    return !lane._sel.has(i);
                });
                lane._sel.clear();
            }
        },
        {
            label: 'Duplicate', key: 'Ctrl+D', action: function () {
                pushUndoSnapshot();
                _laneShapeDuplicate(b, li, lane);
            }
        },
        { label: '---' },
        {
            label: 'Snap to Grid', action: function () {
                pushUndoSnapshot();
                var gridParts = b.laneGrid === 'free' ? null : b.laneGrid.split('/');
                var step = gridParts && gridParts.length === 2 ? Number(gridParts[0]) / Number(gridParts[1]) : 0;
                if (!step) return;
                lane._sel.forEach(function (idx) {
                    if (lane.pts[idx] && idx > 0 && idx < lane.pts.length - 1) {
                        lane.pts[idx].x = Math.round(lane.pts[idx].x / step) * step;
                    }
                });
                laneResortWithSel(lane);
            }
        },
        {
            label: 'Set to 100%', action: function () {
                pushUndoSnapshot();
                lane._sel.forEach(function (idx) { if (lane.pts[idx]) lane.pts[idx].y = 0; });
            }
        },
        {
            label: 'Set to 50%', action: function () {
                pushUndoSnapshot();
                lane._sel.forEach(function (idx) { if (lane.pts[idx]) lane.pts[idx].y = 0.5; });
            }
        },
        {
            label: 'Set to 0%', action: function () {
                pushUndoSnapshot();
                lane._sel.forEach(function (idx) { if (lane.pts[idx]) lane.pts[idx].y = 1; });
            }
        }
    ];

    items.forEach(function (it) {
        if (it.label === '---') {
            var sep = document.createElement('div');
            sep.style.cssText = 'height:1px;background:var(--border);margin:3px 0;';
            menu.appendChild(sep);
            return;
        }
        var row = document.createElement('div');
        row.className = 'lane-add-menu-item';
        row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;';
        row.innerHTML = '<span>' + it.label + '</span>' + (it.key ? '<span style="opacity:0.4;font-size:9px;margin-left:12px">' + it.key + '</span>' : '');
        row.onclick = function () {
            it.action();
            laneDrawCanvas(b, li);
            syncBlocksToHost();
            menu.remove();
        };
        menu.appendChild(row);
    });

    document.body.appendChild(menu);

    // Close on outside click (next tick to avoid immediate close)
    setTimeout(function () {
        var closer = function (e) {
            if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('mousedown', closer); }
        };
        document.addEventListener('mousedown', closer);
    }, 0);
}

// Shape-preserving duplicate helper (used by Ctrl+D and context menu)
function _laneShapeDuplicate(b, li, lane) {
    if (!lane._sel || !lane._sel.size) return;
    var selected = [];
    lane._sel.forEach(function (idx) {
        if (lane.pts[idx]) selected.push({ x: lane.pts[idx].x, y: lane.pts[idx].y });
    });
    if (!selected.length) return;
    selected.sort(function (a, c) { return a.x - c.x; });
    var baseX = selected[0].x;
    var offsets = selected.map(function (p) { return { dx: p.x - baseX, y: p.y }; });

    // Find grid step
    var gridParts = b.laneGrid === 'free' ? null : b.laneGrid.split('/');
    var gridStep = gridParts && gridParts.length === 2 ? Number(gridParts[0]) / Number(gridParts[1]) : 0.0625;

    // Anchor first duplicate point at the last selected point's position
    // so the duplicate continues seamlessly from where the selection ends
    var maxSelX = selected[selected.length - 1].x;
    var pasteX = maxSelX;

    var pastedPts = [];
    offsets.forEach(function (p) {
        var nx = pasteX + p.dx;
        if (nx > 0.99) return;
        var np = { x: nx, y: p.y };
        lanePutPt(lane, np, gridStep);
        pastedPts.push(np);
    });

    // Select the new points
    lane._sel.clear();
    for (var i = 0; i < lane.pts.length; i++) {
        for (var j = 0; j < pastedPts.length; j++) {
            if (Math.abs(lane.pts[i].x - pastedPts[j].x) < 0.003 && Math.abs(lane.pts[i].y - pastedPts[j].y) < 0.003) {
                lane._sel.add(i); break;
            }
        }
    }
    laneDrawCanvas(b, li);
}

// Morph snapshot duplicate helper (used by Ctrl+D and context menu)
function _morphSnapDuplicate(b, li, lane, snapIdx) {
    if (!lane.morphSnapshots || !lane.morphSnapshots[snapIdx]) return;
    var src = lane.morphSnapshots[snapIdx];
    // Deep copy values
    var valsCopy = {};
    for (var k in src.values) valsCopy[k] = src.values[k];
    var newSnap = {
        position: src.position,
        hold: src.hold != null ? src.hold : 0.5,
        curve: src.curve || 0,
        depth: src.depth != null ? src.depth : 1.0,
        drift: src.drift || 0,
        warp: src.warp || 0,
        steps: src.steps || 0,
        name: (src.name || 'S') + ' (copy)',
        source: src.source || '',
        values: valsCopy
    };
    // Insert right after the source
    lane.morphSnapshots.splice(snapIdx + 1, 0, newSnap);
    // Redistribute positions evenly
    var total = lane.morphSnapshots.length;
    if (total > 1) {
        for (var si = 0; si < total; si++) {
            lane.morphSnapshots[si].position = si / (total - 1);
        }
    }
    // Select the new snapshot
    lane._selectedSnap = snapIdx + 1;
    laneDrawCanvas(b, li);
    renderSingleBlock(b.id);
}

// Global keyboard handler for lane operations
var _laneCopiedPts = null; // module-level shape clipboard

// Click outside lane → deselect all points
document.addEventListener('click', function (e) {
    // Don't deselect when clicking inside the lane area, toolbar, footer, or context menus
    if (e.target.closest('.lane-canvas-wrap') || e.target.closest('.lane-lb-left') || e.target.closest('.lane-lb-right') ||
        e.target.closest('.lane-toolbar') || e.target.closest('.lane-footer') || e.target.closest('.lane-ctx-menu') ||
        e.target.closest('.lane-add-menu') || e.target.closest('.lane-hdr') || e.target.closest('.lane-morph-sidebar')) return;
    var ab = actId ? findBlock(actId) : null;
    if (!ab || ab.mode !== 'lane') return;
    var didClear = false;
    ab.lanes.forEach(function (lane, li) {
        if (lane._sel && lane._sel.size > 0) { lane._sel.clear(); didClear = true; laneDrawCanvas(ab, li); }
    });
    if (didClear) renderSingleBlock(ab.id);
});

(function () {
    document.addEventListener('keydown', function (e) {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        // Find active lane block
        var ab = actId ? findBlock(actId) : null;
        if (!ab || ab.mode !== 'lane') return;

        // Escape - deselect all points, or cancel active drag (undo)
        if (e.key === 'Escape') {
            var hadSel = false;
            ab.lanes.forEach(function (lane, li) {
                if (lane._sel && lane._sel.size > 0) { lane._sel.clear(); hadSel = true; laneDrawCanvas(ab, li); }
                if (lane._selectedSnaps && lane._selectedSnaps.size > 0) { lane._selectedSnaps.clear(); hadSel = true; }
                if (lane._selectedSnap != null && lane._selectedSnap >= 0) { lane._selectedSnap = -1; hadSel = true; }
            });
            if (hadSel) { renderSingleBlock(ab.id); return; }
            if (typeof undo === 'function') undo();
            return;
        }

        // S - toggle select mode
        if (e.key === 's' || e.key === 'S') {
            if (e.ctrlKey || e.metaKey) return; // don't intercept Ctrl+S
            e.preventDefault();
            ab.laneTool = ab.laneTool === 'select' ? 'draw' : 'select';
            // Update toolbar buttons visually (find buttons by data-b inside any lane-toolbar)
            document.querySelectorAll('.lane-tbtn[data-b="' + ab.id + '"][data-lt]').forEach(function (t) {
                if (t.dataset.lt !== 'clear' && t.dataset.lt !== 'random') t.classList.toggle('on', t.dataset.lt === ab.laneTool);
            });
            return;
        }

        // Delete - remove selected points (curve) or selected snapshot (morph)
        if (e.key === 'Delete' || e.key === 'Backspace') {
            var changed = false;
            pushUndoSnapshot();
            ab.lanes.forEach(function (lane, li) {
                if (lane.morphMode) {
                    // Morph: delete selected snapshot
                    var si = lane._selectedSnap;
                    if (si != null && si >= 0 && lane.morphSnapshots && lane.morphSnapshots[si]) {
                        lane.morphSnapshots.splice(si, 1);
                        if (lane.morphSnapshots.length > 1) {
                            lane.morphSnapshots[0].position = 0;
                            lane.morphSnapshots[lane.morphSnapshots.length - 1].position = 1;
                        } else if (lane.morphSnapshots.length === 1) {
                            lane.morphSnapshots[0].position = 0;
                        }
                        lane._selectedSnap = -1;
                        laneDrawCanvas(ab, li);
                        renderSingleBlock(ab.id);
                        changed = true;
                    }
                } else {
                    // Curve: delete selected points
                    if (!lane._sel || !lane._sel.size) return;
                    lane.pts = lane.pts.filter(function (p, i) {
                        if (p.x < 0.01 || p.x > 0.99) return true;
                        return !lane._sel.has(i);
                    });
                    lane._sel.clear();
                    laneDrawCanvas(ab, li);
                    changed = true;
                }
            });
            if (changed) syncBlocksToHost();
            return;
        }

        // Arrow keys - nudge selected points
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault();
            var step = e.shiftKey ? 0.01 : 0.05;
            var dx = 0, dy = 0;
            if (e.key === 'ArrowUp') dy = -step;
            if (e.key === 'ArrowDown') dy = step;
            if (e.key === 'ArrowLeft') dx = -step;
            if (e.key === 'ArrowRight') dx = step;

            var nudged = false;
            pushUndoSnapshot();
            ab.lanes.forEach(function (lane, li) {
                if (!lane._sel || !lane._sel.size) return;
                lane._sel.forEach(function (idx) {
                    if (!lane.pts[idx]) return;
                    var isE = (idx === 0 || idx === lane.pts.length - 1);
                    if (!isE) lane.pts[idx].x = Math.max(0, Math.min(1, lane.pts[idx].x + dx));
                    lane.pts[idx].y = Math.max(0, Math.min(1, lane.pts[idx].y + dy));
                });
                laneResortWithSel(lane);
                laneDrawCanvas(ab, li);
                nudged = true;
            });
            if (nudged) syncBlocksToHost();
            return;
        }

        // Ctrl+C - copy selected points as relative shape
        if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
            ab.lanes.forEach(function (lane) {
                if (!lane._sel || !lane._sel.size) return;
                var selected = [];
                lane._sel.forEach(function (idx) {
                    if (lane.pts[idx]) selected.push({ x: lane.pts[idx].x, y: lane.pts[idx].y });
                });
                if (!selected.length) return;
                selected.sort(function (a, c) { return a.x - c.x; });
                var baseX = selected[0].x;
                _laneCopiedPts = selected.map(function (p) {
                    return { dx: p.x - baseX, y: p.y };
                });
            });
            return;
        }

        // Ctrl+V - paste shape at next grid position
        if ((e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'V')) {
            if (!_laneCopiedPts || !_laneCopiedPts.length) return;
            e.preventDefault();
            pushUndoSnapshot();
            ab.lanes.forEach(function (lane, li) {
                // Find paste anchor
                var anchorX = 0;
                if (lane._sel && lane._sel.size) {
                    lane._sel.forEach(function (idx) {
                        if (lane.pts[idx] && lane.pts[idx].x > anchorX) anchorX = lane.pts[idx].x;
                    });
                } else {
                    for (var i = 0; i < lane.pts.length; i++) {
                        if (lane.pts[i].x > anchorX && lane.pts[i].x < 0.99) anchorX = lane.pts[i].x;
                    }
                }

                // Grid step
                var gridParts = ab.laneGrid === 'free' ? null : ab.laneGrid.split('/');
                var gridStep = gridParts && gridParts.length === 2 ? Number(gridParts[0]) / Number(gridParts[1]) : 0.0625;
                var pasteX = Math.ceil((anchorX + 0.001) / gridStep) * gridStep;

                // Stamp the shape — batch all points to avoid clear-radius removing earlier pasted dots
                var pastedPts = [];
                _laneCopiedPts.forEach(function (p) {
                    var nx = pasteX + p.dx;
                    if (nx > 0.99 || nx < 0.01) return;
                    pastedPts.push({ x: nx, y: p.y });
                });
                if (pastedPts.length) {
                    // Single bulk clear: remove existing points near any paste position
                    var clearRadius = gridStep ? gridStep * 0.49 : 0.004;
                    lane.pts = lane.pts.filter(function (p) {
                        if (p.x < 0.01 || p.x > 0.99) return true;
                        for (var k = 0; k < pastedPts.length; k++) {
                            if (Math.abs(p.x - pastedPts[k].x) <= clearRadius) return false;
                        }
                        return true;
                    });
                    // Insert all pasted points
                    for (var pi = 0; pi < pastedPts.length; pi++) {
                        lane.pts.push({ x: pastedPts[pi].x, y: pastedPts[pi].y });
                    }
                    lane.pts.sort(function (a, c) { return a.x - c.x; });
                }

                // Select the pasted points
                lane._sel.clear();
                for (var i = 0; i < lane.pts.length; i++) {
                    for (var j = 0; j < pastedPts.length; j++) {
                        if (Math.abs(lane.pts[i].x - pastedPts[j].x) < 0.003 &&
                            Math.abs(lane.pts[i].y - pastedPts[j].y) < 0.003) {
                            lane._sel.add(i); break;
                        }
                    }
                }
                laneDrawCanvas(ab, li);
            });
            syncBlocksToHost();
            return;
        }

        // Ctrl+D - shape-preserving duplicate (curve lanes) / snapshot duplicate (morph lanes)
        if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D')) {
            e.preventDefault();
            pushUndoSnapshot();
            var hasMorph = false;
            ab.lanes.forEach(function (lane, li) {
                if (lane.morphMode && lane._selectedSnap != null && lane._selectedSnap >= 0 && lane.morphSnapshots && lane.morphSnapshots[lane._selectedSnap]) {
                    _morphSnapDuplicate(ab, li, lane, lane._selectedSnap);
                    hasMorph = true;
                } else if (!lane.morphMode) {
                    _laneShapeDuplicate(ab, li, lane);
                }
            });
            syncBlocksToHost();
            return;
        }

        // Ctrl+A - select all points in all lanes
        if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
            e.preventDefault();
            ab.lanes.forEach(function (lane, li) {
                if (!lane._sel) lane._sel = new Set();
                lane._sel.clear();
                for (var i = 0; i < lane.pts.length; i++) lane._sel.add(i);
                laneDrawCanvas(ab, li);
            });
            return;
        }
    });
})();
