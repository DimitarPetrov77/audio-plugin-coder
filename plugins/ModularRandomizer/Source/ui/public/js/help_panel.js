/**
 * Help & Reference Panel
 * Builds the ? modal dynamically with tabbed content:
 *   - Shortcuts (keyboard & mouse)
 *   - Logic Blocks reference
 *   - Lanes reference (incl. Morph Lanes)
 *   - WrongEQ reference
 *   - Expose to DAW
 *   - Tips & workflow
 */
(function () {
    var btn = document.getElementById('helpBtn');
    if (!btn) return;

    // ── Tab definitions ──
    var tabs = [
        { id: 'shortcuts', label: '\u2328 Shortcuts' },
        { id: 'blocks', label: '\u25A6 Blocks' },
        { id: 'lanes', label: '\u223F Lanes' },
        { id: 'weq', label: '\u2261 WrongEQ' },
        { id: 'expose', label: '\u2197 Expose' },
        { id: 'tips', label: '\u2605 Tips' }
    ];

    // ── Content builders ──
    function grid(rows) {
        return '<div class="sc-grid">' + rows.map(function (r) {
            return '<span class="sc-key">' + r[0] + '</span><span>' + r[1] + '</span>';
        }).join('') + '</div>';
    }
    function section(title, body) {
        return '<div class="sc-section"><div class="sc-title">' + title + '</div>' + body + '</div>';
    }
    function para(text) { return '<p>' + text + '</p>'; }
    function heading(text) { return '<div class="sc-title" style="margin-top:14px">' + text + '</div>'; }
    function bullet(items) {
        return '<ul>' +
            items.map(function (t) { return '<li>' + t + '</li>'; }).join('') + '</ul>';
    }
    function tag(label, color) {
        return '<span class="help-tag" style="' +
            '--tag-color:' + (color || 'var(--accent)') + '">' + label + '</span>';
    }

    var content = {};

    // ── SHORTCUTS TAB ──
    content.shortcuts =
        section('Global', grid([
            ['Ctrl+Z', 'Undo'],
            ['Ctrl+Shift+Z', 'Redo'],
            ['Ctrl+S', 'Save preset'],
            ['Space', 'Play / Pause'],
            ['Delete', 'Delete active block'],
            ['R', 'Randomize active block'],
            ['Ctrl+A', 'Select all blocks'],
            ['Escape', 'Close panel / blur input'],
            ['?', 'Toggle this help panel']
        ])) +
        section('Plugin Rack', grid([
            ['Click header', 'Expand / collapse plugin'],
            ['Right-click header', 'Plugin context menu'],
            ['Drag param grip', 'Drag parameter to block'],
            ['Click param name', 'Toggle assign to active block'],
            ['Ctrl+Click param', 'Multi-select parameters'],
            ['Scroll knob', 'Fine-adjust parameter value'],
            ['Double-click knob', 'Reset to default']
        ])) +
        section('Lane Editor \u2014 Mouse', grid([
            ['Click', 'Place point (Draw) / Select (Select)'],
            ['Ctrl+Click', 'Toggle point selection'],
            ['Shift+Drag', 'Constrain to H/V axis'],
            ['Right-Click', 'Context menu on point'],
            ['Double-Click', 'Add breakpoint'],
            ['Shift+Scroll', 'Adjust lane depth']
        ])) +
        section('Lane Editor \u2014 Keyboard', grid([
            ['S', 'Toggle Select / Draw tool'],
            ['Arrows', 'Nudge selected points 5%'],
            ['Shift+Arrows', 'Fine nudge 1%'],
            ['Ctrl+C', 'Copy shape'],
            ['Ctrl+V', 'Paste shape at next grid step'],
            ['Ctrl+D', 'Duplicate shape'],
            ['Ctrl+A', 'Select all points'],
            ['Delete', 'Delete selected points'],
            ['Escape', 'Cancel / deselect all']
        ])) +
        section('WrongEQ \u2014 Canvas', grid([
            ['Click', 'Add point at 0 dB / Select point'],
            ['Drag point', 'Move frequency and gain'],
            ['Double-Click point', 'Reset gain to 0 dB'],
            ['Double-Click empty', 'Add point at 0 dB'],
            ['Shift+Drag', 'Constrain to H or V axis'],
            ['Right-Click', 'Context menu (solo, mute, assign, etc.)'],
            ['\u2191 / \u2193', 'Nudge gain \u00b11 dB (Shift = \u00b16 dB)'],
            ['\u2190 / \u2192', 'Nudge freq \u00b11 semitone (Shift = \u00b1\u2153 oct)'],
            ['Ctrl+D', 'Duplicate selected point'],
            ['Delete', 'Delete selected point'],
            ['Ctrl+Shift+X', 'Clear all points'],
            ['Escape', 'Close WrongEQ popup']
        ])) +
        section('WrongEQ \u2014 Band Rows', grid([
            ['Drag Gain', 'Adjust band gain (vertical drag)'],
            ['Dbl-Click Gain', 'Reset to 0 dB'],
            ['Drag Q', 'Adjust Q factor 0.1\u201310 (vertical drag)'],
            ['Dbl-Click Q', 'Reset Q to 0.707'],
            ['Click Type', 'Cycle: Bell / LP / HP / Notch / LShf / HShf'],
            ['Drag Drift', 'Adjust drift 0\u2013100%'],
            ['Dbl-Click Drift', 'Reset drift to 0%'],
            ['S / M', 'Solo / Mute toggle']
        ]));

    // ── BLOCKS TAB ──
    content.blocks =
        heading('What are Logic Blocks?') +
        para('Logic blocks generate modulation signals that control your hosted plugin parameters in real time. ' +
            'Each block has <b>targets</b> (the parameters it controls) and a <b>mode</b> that determines how values are generated.') +

        section(tag('Randomize', '#ff6b6b') + ' Randomize',
            para('Generates random values for all assigned parameters on each trigger.') +
            '<div class="sc-grid">' +
            '<span class="sc-key">Trigger</span><span>Tempo beat, MIDI note, audio threshold</span>' +
            '<span class="sc-key">Range</span><span>Min/Max % \u2014 limits how far values can move</span>' +
            '<span class="sc-key">Range Mode</span><span><b>Absolute</b>: random within fixed range. <b>Relative</b>: offset from current value</span>' +
            '<span class="sc-key">Quantize</span><span>Snap to N equal steps (e.g. 12 = semitones)</span>' +
            '<span class="sc-key">Movement</span><span><b>Instant</b>: jump. <b>Glide</b>: smooth transition over time</span>' +
            '</div>'
        ) +

        section(tag('Envelope', '#10b981') + ' Envelope Follower',
            para('Tracks audio input level (main or sidechain) and converts it to modulation. ' +
                'Louder audio = higher modulation output. Great for ducking, pumping, and reactive effects.') +
            '<div class="sc-grid">' +
            '<span class="sc-key">Attack</span><span>How fast the follower responds to rising levels (0\u2013500ms)</span>' +
            '<span class="sc-key">Release</span><span>How fast it falls when audio drops (0\u20132000ms)</span>' +
            '<span class="sc-key">Sensitivity</span><span>Amplification of the input signal (0\u2013100%)</span>' +
            '<span class="sc-key">Invert</span><span>Flip the output \u2014 loud audio = low modulation</span>' +
            '<span class="sc-key">Audio Source</span><span><b>Main</b>: track input. <b>Sidechain</b>: external input</span>' +
            '<span class="sc-key">Band Filter</span><span>Optional bandpass to isolate a frequency range (e.g. kick drum only)</span>' +
            '</div>'
        ) +

        section(tag('Sample', '#4ecdc4') + ' Sample Modulator',
            para('Loads an audio file and uses its waveform as a modulation source. ' +
                'The waveform amplitude drives parameter values over time.') +
            '<div class="sc-grid">' +
            '<span class="sc-key">Loop Mode</span><span><b>Loop</b>: continuous. <b>One-shot</b>: fire once. <b>Ping-pong</b>: bounce</span>' +
            '<span class="sc-key">Speed</span><span>Playback rate multiplier (0.1x\u20134x via DAW, up to 32x in UI)</span>' +
            '<span class="sc-key">Reverse</span><span>Play waveform backwards</span>' +
            '<span class="sc-key">Jump Mode</span><span><b>Restart</b>: reset on trigger. <b>Continue</b>: keep position</span>' +
            '<span class="sc-key">Trigger</span><span>Tempo, MIDI, or audio threshold triggers playback</span>' +
            '</div>'
        ) +

        section(tag('Morph Pad', '#a78bfa') + ' Morph Pad',
            para('XY pad with up to 8 snapshots. Moving the cursor blends between stored parameter states using inverse distance weighting.') +
            '<div class="sc-grid">' +
            '<span class="sc-key">Snapshots</span><span>Right-click pad to add/capture. Each stores all target values</span>' +
            '<span class="sc-key">Manual</span><span>Drag the cursor yourself</span>' +
            '<span class="sc-key">Auto</span><span>Automated movement: <b>Wander</b> (random drift) or <b>Shapes</b> (geometric LFO path)</span>' +
            '<span class="sc-key">Trigger</span><span>Jump to snapshots in order (cycle/random) on MIDI/tempo/audio</span>' +
            '<span class="sc-key">Jitter</span><span>Random perturbation added to cursor position</span>' +
            '<span class="sc-key">Snap Radius</span><span>How close cursor must be to lock onto a snapshot</span>' +
            '<span class="sc-key">Glide</span><span>Smooth transition time between snapshot jumps (ms)</span>' +
            '</div>'
        ) +

        section(tag('Shapes', '#f59e0b') + ' Shapes / Shapes Range',
            para('Continuous LFO-style modulation using geometric shapes. The cursor traces a shape path, modulating parameters by its position.') +
            '<div class="sc-grid">' +
            '<span class="sc-key">Shape</span><span>Circle, Figure-8, Triangle, Square, Hexagon, Star, Spiral, Butterfly, Infinity + more</span>' +
            '<span class="sc-key">Tracking</span><span><b>Horizontal</b>: X position. <b>Vertical</b>: Y. <b>Distance</b>: from center</span>' +
            '<span class="sc-key">Speed</span><span>Rotation speed (free or tempo-synced)</span>' +
            '<span class="sc-key">Spin</span><span>Rotates the shape itself over time</span>' +
            '<span class="sc-key">Size</span><span>Scale of the shape path (depth of modulation)</span>' +
            '<span class="sc-key">Phase</span><span>Starting angle offset (0\u00B0\u2013360\u00B0)</span>' +
            '<span class="sc-key">Polarity</span><span><b>Bipolar</b>: up+down. <b>Unipolar</b>: positive only. <b>Up/Down</b>: one direction</span>' +
            '<span class="sc-key">Trigger</span><span><b>Free</b>: always runs. <b>MIDI</b>: reset phase on note-on</span>' +
            '</div>' +
            para('<b>Shapes Range</b>: each target gets its own depth slider, allowing fine per-parameter control of modulation amount.')
        ) +

        section(tag('Lane', '#38bdf8') + ' Automation Lanes',
            para('Draw custom curves that modulate parameters over time. Each lane block can contain multiple sub-lanes with independent timing. See the <b>Lanes</b> tab for details including <b>Morph Lanes</b>.')
        ) +

        heading('Shared Controls') +
        '<div class="sc-grid">' +
        '<span class="sc-key">Power \u26A1</span><span>Enable/disable the block without removing it</span>' +
        '<span class="sc-key">Clock Source</span><span>DAW tempo or internal BPM (set in Settings)</span>' +
        '<span class="sc-key">Polarity</span><span><b>Bipolar</b>: modulate up and down. <b>Up</b>: only above base. <b>Down</b>: only below</span>' +
        '<span class="sc-key">Stacking</span><span>Multiple blocks on the same param add together (additive modulation)</span>' +
        '</div>';

    // ── LANES TAB ──
    content.lanes =
        heading('Automation Lanes') +
        para('Lanes are drawable automation curves. Each lane targets one or more parameters, with its own loop length, ' +
            'interpolation mode, and timing settings. A single Lane block can contain multiple sub-lanes running independently.') +

        section('Drawing & Editing',
            '<div class="sc-grid">' +
            '<span class="sc-key">Draw tool</span><span>Click canvas to place points. They auto-connect with curves</span>' +
            '<span class="sc-key">Select tool</span><span>Click/drag to select points, then move them</span>' +
            '<span class="sc-key">Steps</span><span>0 = smooth curve. 4/8/16/32 = quantize to step grid</span>' +
            '<span class="sc-key">Depth</span><span>Overall modulation amount (Shift+Scroll to adjust)</span>' +
            '<span class="sc-key">Interp</span><span><b>Smooth</b>: spline curves. <b>Step</b>: hard jumps. <b>Linear</b>: straight lines</span>' +
            '</div>'
        ) +

        section('Timing',
            '<div class="sc-grid">' +
            '<span class="sc-key">Loop Length</span><span>Synced: 1/16 to 32 bars. Free: seconds (0.1 to 60)</span>' +
            '<span class="sc-key">Synced</span><span>Lock to DAW/internal tempo. Uncheck for free-running (seconds)</span>' +
            '<span class="sc-key">Play Mode</span><span><b>Forward</b>: normal loop. <b>Reverse</b>: backwards. <b>Ping-pong</b>: bounce. <b>Random</b>: random jumps</span>' +
            '</div>'
        ) +

        section('One-Shot / Trigger',
            para('Set a lane to <b>One-Shot</b> mode so it only plays when triggered, instead of looping continuously.') +
            '<div class="sc-grid">' +
            '<span class="sc-key">Loop / One-Shot</span><span>Loop: runs forever. One-Shot: plays once per trigger</span>' +
            '<span class="sc-key">Source</span><span><b>Manual</b>: Fire button. <b>MIDI</b>: note-on trigger. <b>Audio</b>: threshold trigger</span>' +
            '<span class="sc-key">MIDI Note</span><span>Any Note or a specific note (C-1 to G9)</span>' +
            '<span class="sc-key">MIDI Channel</span><span>Any or specific channel (1\u201316)</span>' +
            '<span class="sc-key">Hold</span><span>MIDI only \u2014 <b>Off</b>: trigger once. <b>On</b>: loop while note is held, stop on release</span>' +
            '<span class="sc-key">Audio Threshold</span><span>Level in dB that triggers the lane (-48 to 0)</span>' +
            '<span class="sc-key">Retrigger</span><span>Allow restart while already playing</span>' +
            '</div>'
        ) +

        section('Lane Header',
            '<div class="sc-grid">' +
            '<span class="sc-key">\u2298 Clear</span><span>Reset the lane curve back to a flat 50% line</span>' +
            '<span class="sc-key">OVL</span><span>Overlay another lane\u2019s shape for polyrhythmic modulation</span>' +
            '<span class="sc-key">\u25CF / \u25CB</span><span>Mute / unmute the lane</span>' +
            '<span class="sc-key">\u00D7</span><span>Delete the lane</span>' +
            '</div>'
        ) +

        section('Lane Footer \u2014 Core Effects',
            '<div class="sc-grid">' +
            '<span class="sc-key">Depth</span><span>Output modulation depth (0\u2013200%). Scales curve toward center. Drag vertical to adjust</span>' +
            '<span class="sc-key">Warp</span><span>Curve transfer function \u2014 negative = expand extremes, positive = compress to center</span>' +
            '<span class="sc-key">Steps</span><span>Quantize output to N equal levels (0 = off, 2\u201332)</span>' +
            '</div>'
        ) +

        section('Lane Footer \u2014 Drift',
            para('Drift adds deterministic organic variation to the curve. Think of it as "life" \u2014 gentle wandering or sharp jitter.') +
            '<div class="sc-grid">' +
            '<span class="sc-key">Drift</span><span>Speed \u0026 character: positive = slow wandering, negative = fast micro-jitter. Above \u00B170% = sharper texture</span>' +
            '<span class="sc-key">DftRng</span><span>Drift amplitude as % of full parameter range (0\u2013100%)</span>' +
            '<span class="sc-key">DriftScale</span><span>Musical period for one drift cycle. 1/16 = fast detail, 32 bars = glacial macro shifts. Decoupled from loop length</span>' +
            '</div>'
        ) +

        section('Overlays',
            para('A lane can overlay another lane of different length, creating polyrhythmic modulation. ' +
                'The overlay runs at its own speed and adds to the base lane\u2019s output.')
        ) +

        section('\u21CB Morph Lanes',
            para('Any lane can be toggled into <b>Morph Mode</b> by clicking the <b>\u21CB Morph</b> button in the lane header. ' +
                'Instead of drawing freehand curves, morph lanes blend between <b>snapshots</b> of parameter values over time.') +
            '<div class="sc-grid">' +
            '<span class="sc-key">\u21CB Morph</span><span>Toggle morph mode on/off for any lane</span>' +
            '<span class="sc-key">Add Snapshot</span><span>Capture current target param values as a new morph point</span>' +
            '<span class="sc-key">Browse Library</span><span>Load param snapshots from the snapshot library</span>' +
            '<span class="sc-key">Playhead</span><span>Sweeps through snapshots in sequence \u2014 params morph to each snapshot\'s values</span>' +
            '<span class="sc-key">Depth</span><span>Controls how strongly the morph affects parameters (0\u2013100%)</span>' +
            '<span class="sc-key">Timing</span><span>Uses the same loop length and sync settings as regular lanes</span>' +
            '</div>' +
            para('Morph lanes are especially powerful with tempo sync: the playhead sweeps through snapshots on beat, ' +
                'creating rhythmic parameter morphing. Each snapshot shows as a numbered badge in the sidebar and can be reordered or deleted.') +
            para('<b>Tip</b>: combine morph lanes with regular drawn lanes in the same block for layered modulation \u2014 ' +
                'morph lanes handle the broad preset sweeps while drawn lanes add fine detail.')
        );

    // ── WRONGEQ TAB ──
    content.weq =
        heading('WrongEQ \u2014 Mastering-Grade Drawable EQ') +
        para('WrongEQ is a fully parametric, drawable EQ with integrated multiband plugin routing, ' +
            'wave ripple modulation, and drift animation. Each EQ point creates a crossover frequency that splits the audio into independent bands.') +

        section('Architecture',
            para('<b>Exclusive multiband splitting</b> \u2014 Linkwitz-Riley crossovers divide the spectrum into non-overlapping frequency bands. ' +
                'Each Hz belongs to exactly one band. Bands sum back transparently with allpass phase compensation.') +
            bullet([
                '<b>Signal flow</b>: Input \u2192 Parametric EQ (biquads) \u2192 Crossover split \u2192 Per-band plugins \u2192 Sum \u2192 Output',
                '<b>Band count</b>: N points = N+1 bands (below first, between each pair, above last)',
                '<b>Phase coherent</b>: LR4 crossovers + allpass compensation \u2192 flat magnitude sum',
                '<b>Coefficient smoothing</b>: all biquads use 512-sample linear interpolation \u2192 no clicks on parameter changes'
            ])
        ) +

        section(tag('Important', '#ff6b6b') + ' Exclusive Band Splitting',
            para('Because bands are <b>exclusive frequency slices</b>, two bands at the same frequency do NOT both receive the same audio. ' +
                'The minimum spacing is 1/6 octave \u2014 if two points drift closer, the system enforces separation.') +
            bullet([
                'If two points overlap due to drift, one band gets almost all the energy and the other gets near-silence',
                'To process the same frequency with multiple effects, place them on the <b>same band</b> (sequential chain)',
                'For true parallel processing of the full signal, use <b>Parallel routing mode</b> instead'
            ])
        ) +

        section('Filter Types',
            '<div class="sc-grid">' +
            '<span class="sc-key">Bell</span><span>Classic parametric boost/cut. Gain + Q control shape</span>' +
            '<span class="sc-key">LP</span><span>Low-pass \u2014 unity gain, cuts above the frequency. Q controls steepness</span>' +
            '<span class="sc-key">HP</span><span>High-pass \u2014 unity gain, cuts below the frequency. Q controls steepness</span>' +
            '<span class="sc-key">Notch</span><span>Band-reject \u2014 unity gain, cuts at the frequency. Q controls width</span>' +
            '<span class="sc-key">LShf</span><span>Low shelf \u2014 boosts/cuts everything below. Q = slope (S). S=1 steepest monotonic, S>1 adds bump</span>' +
            '<span class="sc-key">HShf</span><span>High shelf \u2014 boosts/cuts everything above. Same slope behavior as LShf</span>' +
            '</div>' +
            para('<b>Note</b>: LP, HP, and Notch are <b>unity-gain</b> filters \u2014 the gain knob and depth control have no effect on them. ' +
                'They always cut at the set frequency regardless of depth setting.') +
            para('<b>Slope</b> (12 / 24 / 48 dB/oct): controls how many biquad stages are cascaded per band. ' +
                '12 dB/oct = gentle single-stage rolloff. 48 dB/oct = steep 4-stage brick-wall. ' +
                'The slope is visible on the canvas next to each point and the curve reflects the actual steepness.')
        ) +

        section('Per-Band Plugin Routing',
            para('Each EQ point acts as a <b>bus</b> for hosting plugins. Plugins assigned to a band process only that band\u2019s audio.') +
            '<div class="sc-grid">' +
            '<span class="sc-key">Assign</span><span>Use the bus dropdown on each plugin card to assign it to a band</span>' +
            '<span class="sc-key">Post-EQ</span><span>EQ biquad applied before splitting \u2192 band receives EQ-shaped audio + plugin processing</span>' +
            '<span class="sc-key">Split</span><span>EQ biquad skipped \u2192 pure frequency isolation, plugins process clean band audio</span>' +
            '<span class="sc-key">Solo / Mute</span><span>Per-band S/M buttons on the bus header \u2014 audition individual bands</span>' +
            '<span class="sc-key">M/S Mode</span><span>Per-band stereo mode: Stereo (default), Mid-only, or Side-only</span>' +
            '</div>' +
            para('Multiple plugins on the <b>same band</b> are processed sequentially (serial chain). ' +
                'Plugins on <b>different bands</b> process independent buffers (parallel by band).')
        ) +

        section('Side Panel \u2014 Curve',
            '<div class="sc-grid">' +
            '<span class="sc-key">Depth</span><span>Scales all band gains 0\u2013200%. At 0% all boosts/cuts are flat. LP/HP/Notch are unaffected</span>' +
            '<span class="sc-key">Warp</span><span>S-curve contrast. Positive = compress toward center, negative = expand extremes</span>' +
            '<span class="sc-key">Steps</span><span>Quantize gain to N equal levels. 0 = smooth, 12 = semitone-like steps</span>' +
            '<span class="sc-key">Tilt</span><span>Frequency-dependent gain offset. Positive tilts up toward highs, negative toward lows. Applied post-sum</span>' +
            '</div>'
        ) +

        section('Side Panel \u2014 Drift',
            para('Drift adds organic frequency and gain animation to EQ points.') +
            '<div class="sc-grid">' +
            '<span class="sc-key">Spd</span><span>Drift speed. Positive = smooth sine sweep, negative = jittery noise</span>' +
            '<span class="sc-key">Rng</span><span>Drift range \u2014 how far points wander (0\u20134 octaves)</span>' +
            '<span class="sc-key">Scl</span><span>Musical period for one drift cycle (1/16 note to 32 bars)</span>' +
            '<span class="sc-key">\u223F Cont</span><span>Continuous mode \u2014 also modulates gain with complex noise layering</span>' +
            '</div>'
        ) +

        section('Side Panel \u2014 Wave Ripple',
            para('Wave Ripple generates animated filter bands between user points. Creates spectral textures that move over time.') +
            '<div class="sc-grid">' +
            '<span class="sc-key">ON / OFF</span><span>Enable/disable the ripple engine</span>' +
            '<span class="sc-key">Lo / Hi</span><span>dB floor and ceiling for the ripple wave</span>' +
            '<span class="sc-key">Spd</span><span>Ripple animation rate in Hz</span>' +
            '<span class="sc-key">Mul</span><span>Ripple cycles per segment between points</span>' +
            '<span class="sc-key">Grav</span><span>Gravity \u2014 tapers ripple amplitude toward spectral edges</span>' +
            '<span class="sc-key">Offs</span><span>Phase offset \u2014 shifts the ripple starting position</span>' +
            '<span class="sc-key">Shp</span><span>Waveform: Sine, Pure, Triangle, Saw, Square, Pulse, Comb, Formant, Staircase, Chirp, Fractal, Shark, Spiral, DNA, Chaos, Noise</span>' +
            '<span class="sc-key">Sharp</span><span>Fixed resolution \u2014 multiply controls frequency only</span>' +
            '<span class="sc-key">Dense</span><span>Multiply adds more ripple points for thicker texture</span>' +
            '<span class="sc-key">\u27F3 Inv</span><span>Invert \u2014 flip ripple polarity</span>' +
            '</div>' +
            para('Ripple points are bell filters with auto-calculated Q and overlap compensation. ' +
                'The summed response stays within the Lo/Hi range. All coefficient changes are smoothed over 512 samples to prevent clicks.')
        ) +

        section('Side Panel \u2014 LFO',
            '<div class="sc-grid">' +
            '<span class="sc-key">Rate</span><span>Gain LFO speed in Hz (0 = off)</span>' +
            '<span class="sc-key">Dep</span><span>LFO depth in dB \u2014 how much gain oscillates</span>' +
            '</div>'
        ) +

        section('Side Panel \u2014 Range',
            '<div class="sc-grid">' +
            '<span class="sc-key">dB</span><span>Canvas range: \u00B16, \u00B112, \u00B118, \u00B124, \u00B136, or \u00B148 dB</span>' +
            '</div>'
        ) +

        section('Slope & Cascading',
            para('Each EQ point has a <b>slope selector</b> (12 / 24 / 48) that controls filter steepness by cascading identical biquad stages:') +
            '<div class="sc-grid">' +
            '<span class="sc-key">12 dB/oct</span><span>1 biquad stage \u2014 gentle, musical slope (default)</span>' +
            '<span class="sc-key">24 dB/oct</span><span>2 cascaded stages \u2014 steeper, tighter isolation</span>' +
            '<span class="sc-key">48 dB/oct</span><span>4 cascaded stages \u2014 near brick-wall, surgical cuts</span>' +
            '</div>' +
            para('Most useful for LP and HP filters where you need sharp cutoffs. For Bell/Shelf, higher slopes make the peak/shelf shape more aggressive. ' +
                'The canvas curve updates to reflect the actual cascaded response.')
        );

    // ── EXPOSE TAB ──
    content.expose =
        heading('Expose to DAW') +
        para('The <b>\u2197 Expose</b> button in the header opens the exposure panel. This controls which parameters appear in your DAW\'s automation dropdown. ' +
            'By default, hosted plugin params are exposed when loaded.') +

        section('How It Works',
            para('Hostesa has a <b>unified pool of 2048 proxy parameters</b> (AP_0001 to AP_2048). ' +
                'When you expose a plugin or block, its parameters are mapped to proxy slots. The DAW sees these slots as automatable parameters.') +
            '<div class="sc-grid">' +
            '<span class="sc-key">Block params</span><span>Assigned first \u2014 always appear at the top of the DAW\'s automation list</span>' +
            '<span class="sc-key">Plugin params</span><span>Assigned after blocks \u2014 appear below in the list</span>' +
            '<span class="sc-key">Slot naming</span><span>Each slot shows "BlockName - ParamLabel" or "PluginName: ParamName"</span>' +
            '</div>'
        ) +

        section('Plugin Exposure',
            '<div class="sc-grid">' +
            '<span class="sc-key">Expose toggle</span><span>Show/hide all params of a plugin in the DAW automation list</span>' +
            '<span class="sc-key">Exclude params</span><span>Expand to hide individual params you don\'t need</span>' +
            '</div>' +
            para('Useful for plugins with hundreds of parameters \u2014 expose only what you actually automate.')
        ) +

        section('Block Exposure',
            '<div class="sc-grid">' +
            '<span class="sc-key">Expose toggle</span><span>Show/hide a logic block\'s internal params in the DAW</span>' +
            '<span class="sc-key">Exposed params</span><span>Varies by block: Speed, Size, Phase, Shape type, Attack, Release, etc.</span>' +
            '<span class="sc-key">Lane params</span><span>Per-lane Depth, Drift, DftRng, Warp, and Steps are exposed individually</span>' +
            '<span class="sc-key">Discrete params</span><span>Shape type, tracking mode, polarity etc. appear as stepped values in the DAW</span>' +
            '</div>'
        ) +

        section('DAW Automation',
            para('Once exposed, parameters work <b>bidirectionally</b>:') +
            bullet([
                '<b>DAW \u2192 Plugin</b>: automation lanes in DAW directly control the parameter',
                '<b>Plugin \u2192 DAW</b>: when a hosted plugin\'s param changes, the DAW automation lane updates',
                '<b>Float params</b>: show proper ranges and units (e.g. 0\u2013360\u00B0 for Phase)',
                '<b>Discrete params</b>: show as stepped values with labels (e.g. "circle", "figure8")',
                '<b>Bool params</b>: show as Off/On toggle in the DAW'
            ])
        ) +

        heading('Tips') +
        bullet([
            'Unexpose plugins you\'re not automating to keep the DAW parameter list clean',
            'Block params always stay at the top of the list for easy access',
            'Expose state is saved with your DAW project and global presets',
            'Adding more blocks pushes plugin params further down \u2014 they stay organized automatically'
        ]);

    // ── TIPS TAB ──
    content.tips =
        heading('Workflow Tips') +
        bullet([
            '<b>Assign params fast</b>: click the \u27A4 assign button on a block, then click params in the plugin rack. Click assign again to finish.',
            '<b>Lock parameters</b>: right-click a param row \u2192 Lock. Locked params are excluded from all randomization and modulation.',
            '<b>Auto-lock</b>: right-click \u2192 Auto-Lock marks a param to be locked when randomizing but still controllable by blocks.',
            '<b>Drag & drop</b>: drag the \u2807 grip on a param row directly onto a block to assign it.',
            '<b>Context menus</b>: right-click almost anything \u2014 blocks, params, lane canvas, morph pad \u2014 for contextual actions.',
            '<b>Multiple blocks</b>: stack multiple blocks on the same parameters. Their modulations add together.',
            '<b>Shapes Range</b>: gives per-parameter depth control. Great for subtle, differentiated modulation across many params.',
            '<b>Copy lanes</b>: Ctrl+C/V in the lane editor copies the shape. Ctrl+D duplicates in place.',
            '<b>Presets per plugin</b>: right-click a plugin header to save/load presets for individual plugins.',
            '<b>Morph lanes</b>: toggle \u21CB Morph on any lane to switch from freehand curves to snapshot-based parameter morphing.',
            '<b>Open plugin UI</b>: click the \u25A3 button on a plugin card to open its native editor window.'
        ]) +

        heading('Performance') +
        bullet([
            'All modulation runs <b>per-buffer</b> (not per-sample), so CPU impact is minimal.',
            'Disable unused blocks with the power button \u26A1 to skip processing entirely.',
            'Mute individual lanes that you want to keep but not hear right now.',
            'Virtual scroll handles plugins with hundreds of parameters efficiently.',
            'Collapse plugins in the rack when not editing \u2014 saves polling CPU.'
        ]) +

        heading('Routing Modes') +
        para('Use the <b>Routing Mode</b> dropdown in the header bar to switch between plugin routing modes:') +
        bullet([
            '<b>Sequential</b>: all plugins process in series (one after another). Simple and familiar.',
            '<b>Parallel</b>: plugins are grouped into buses with independent volume, mute, and solo. Buses are mixed at the output.',
            '<b>WrongEQ</b>: multiband frequency-split routing \u2014 each EQ point acts as a crossover, splitting audio into independent bands with per-band plugin chains.'
        ]) +

        heading('DAW Integration') +
        bullet([
            '<b>State saving</b>: your entire setup (plugins, blocks, lanes, expose state, theme, routing) is saved with the DAW project automatically.',
            '<b>Auto-save</b>: UI state is saved every 3 seconds and on editor close, so nothing is lost.',
            '<b>Plugin crash protection</b>: if a hosted plugin crashes during audio processing, it is automatically disabled. Other plugins keep running.',
            '<b>Sidechain</b>: enable the sidechain input in your DAW to feed external audio to envelope followers and audio-triggered blocks.',
            '<b>Internal BPM</b>: set in Settings \u2014 use when your DAW isn\'t playing or for tempo-independent modulation.'
        ]);

    // ── Build the modal ──
    var modal = document.getElementById('shortcutsModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.id = 'shortcutsModal';
        document.body.appendChild(modal);
    }

    modal.innerHTML =
        '<div class="modal help-modal">' +
        '<div class="modal-head">' +
        '<span class="modal-title">Help & Reference</span>' +
        '<button class="modal-close" id="shortcutsClose">&times;</button>' +
        '</div>' +
        '<div class="help-tabs">' +
        tabs.map(function (t) {
            return '<button class="help-tab' + (t.id === 'shortcuts' ? ' active' : '') +
                '" data-tab="' + t.id + '">' + t.label + '</button>';
        }).join('') +
        '</div>' +
        '<div class="modal-body help-body" id="shortcutsBody">' +
        content.shortcuts +
        '</div>' +
        '</div>';

    // ── Tab switching ──
    modal.querySelectorAll('.help-tab').forEach(function (tab) {
        tab.onclick = function () {
            modal.querySelectorAll('.help-tab').forEach(function (t) {
                t.classList.remove('active');
            });
            tab.classList.add('active');
            var body = document.getElementById('shortcutsBody');
            if (body && content[tab.dataset.tab]) {
                body.innerHTML = content[tab.dataset.tab];
                body.scrollTop = 0;
            }
        };
    });

    // ── Open / close ──
    btn.onclick = function () { modal.classList.toggle('vis'); };
    document.getElementById('shortcutsClose').onclick = function () { modal.classList.remove('vis'); };
    modal.onclick = function (e) { if (e.target === modal) modal.classList.remove('vis'); };
})();
