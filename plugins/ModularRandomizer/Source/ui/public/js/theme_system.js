// ============================================================
// THEME SYSTEM
// Theme definitions and switching logic
// ============================================================

var THEMES = {
    studio_midnight: {
        name: 'Studio Midnight',
        vars: {
            // ── BACKGROUNDS ──────────────────────────────────────────
            // Deep blue-grey — like a dimmed control room.
            '--bg-app': '#0C0E14',
            '--bg-panel': '#141822',
            '--bg-cell': '#1A1F2C',
            '--bg-cell-hover': '#232938',
            '--bg-inset': '#080A10',

            // ── BORDERS ───────────────────────────────────────────────
            '--border': '#2A3040',
            '--border-strong': '#3A4258',
            '--border-focus': '#7CA8D9',  // soft steel-blue focus — visible but not harsh

            // ── TEXT ──────────────────────────────────────────────────
            '--text-primary': '#E8ECF2',  // warm white — less eye strain than pure #FFF
            '--text-secondary': '#8A94A8',
            '--text-muted': '#6B7488',
            '--input-text': '#E8ECF2',

            // ── ACCENT ────────────────────────────────────────────────
            // Warm amber — like a lit VU meter needle or channel strip LED.
            '--accent': '#E8A840',
            '--accent-hover': '#F0BC60',
            '--accent-light': 'rgba(232,168,64,0.10)',
            '--accent-border': 'rgba(232,168,64,0.30)',

            // ── STATUS ────────────────────────────────────────────────
            '--midi-dot': '#44DD88',

            '--locked-bg': 'rgba(220,60,80,0.12)',
            '--locked-border': 'rgba(220,60,80,0.35)',
            '--locked-icon': '#DC3C50',

            '--auto-lock-bg': 'rgba(232,168,64,0.10)',
            '--auto-lock-border': 'rgba(232,168,64,0.28)',

            // ── MODE COLORS ───────────────────────────────────────────
            // Slightly desaturated vs Pitch Black — sit better on blue-grey.
            '--rand-color': '#4A9EE0',   // steel blue
            '--env-color': '#E08840',    // warm amber-orange
            '--sample-color': '#44BB70', // studio green (think SSL meters)
            '--morph-color': '#40B8A0',  // teal
            '--shapes-color': '#D85040', // muted red — like a clip LED

            '--thumb-color': '#8A94A8',

            // ── KNOBS ─────────────────────────────────────────────────
            '--knob-track': '#1A1F2C',
            '--knob-value': '#E8A840',   // amber sweep — classic VU aesthetic
            '--knob-dot': '#E8ECF2',

            // ── PLUGIN CARD ───────────────────────────────────────────
            '--pf-bg': '#0C0E14',
            '--pf-border': '#2A3040',
            '--pf-text': '#6B7488',

            '--ph-bg': '#0C0E14',
            '--ph-border': '#2A3040',
            '--ph-text': '#E8ECF2',

            // ── LINKED KNOBS (mode-tinted dark bg) ───────────────────
            '--lk-rand-track': '#0E1620', '--lk-rand-value': '#4A9EE0', '--lk-rand-dot': '#6CB4EA',
            '--lk-env-track': '#1C1208', '--lk-env-value': '#E08840', '--lk-env-dot': '#E8A060',
            '--lk-smp-track': '#0C1A10', '--lk-smp-value': '#44BB70', '--lk-smp-dot': '#66CC8C',
            '--lk-morph-track': '#0C1C18', '--lk-morph-value': '#40B8A0', '--lk-morph-dot': '#60CCBB',
            '--lk-shapes-track': '#1C0C0A', '--lk-shapes-value': '#D85040', '--lk-shapes-dot': '#E07060',

            // ── SOURCE INDICATORS ─────────────────────────────────────
            '--si-rand-bg': 'rgba(74,158,224,0.12)',
            '--si-env-bg': 'rgba(224,136,64,0.12)',
            '--si-smp-bg': 'rgba(68,187,112,0.12)',
            '--si-morph-bg': 'rgba(64,184,160,0.12)',
            '--si-shapes-bg': 'rgba(216,80,64,0.12)',

            // ── FIRE BUTTON ───────────────────────────────────────────
            '--fire-text': '#0C0E14',
            '--fire-active-bg': '#E8A840',  // amber fire — unmistakable

            // ── ARC / RANGE ───────────────────────────────────────────


            // ── SLIDER ────────────────────────────────────────────────
            '--slider-track': '#2A3040',
            '--slider-thumb': '#E8A840',

            // ── PARAM BAR ─────────────────────────────────────────────
            '--bar-track': '#0C0E14',
            '--bar-fill': '#E8A840',

            // ── CARD BUTTONS ──────────────────────────────────────────
            '--card-btn-bg': '#0C0E14',
            '--card-btn-border': '#2A3040',
            '--card-btn-text': '#6B7488',
            '--card-btn-hover': '#141822',

            // ── SNAP RING ─────────────────────────────────────────────
            '--snap-ring-color': '#E8A840',
            '--snap-ring-opacity': '0.55',

            // ── LANE / AUTOMATION ─────────────────────────────────────
            '--lane-color': '#E8A840',                   // amber curve — reads like an envelope on a console
            '--lane-grid': 'rgba(200,210,230,0.05)',
            '--lane-grid-label': 'rgba(200,210,230,0.20)',
            '--lane-playhead': 'rgba(232,236,242,0.90)',
            '--lane-active': '#44BB70',

            // ── RANGE ARC ─────────────────────────────────────────────
            '--range-arc': '#4A9EE0',

            // ── SCROLLBAR ─────────────────────────────────────────────
            '--scrollbar-thumb': '#3A4258',
            '--scrollbar-track': 'transparent',

            // ── BUS CONTROLS ──────────────────────────────────────────
            '--bus-mute-bg': '#C03030', '--bus-mute-text': '#FFFFFF',
            '--bus-solo-bg': '#D4A820', '--bus-solo-text': '#000000',
            '--bus-group-tint': '12%',
            '--bus-header-tint': '20%',
            '--bus-badge-text': '#000000',

            // ── TOASTS ────────────────────────────────────────────────
            '--toast-success-bg': 'linear-gradient(135deg,#0A1A10,#060E08)',
            '--toast-success-border': '#44BB70',
            '--toast-error-bg': 'linear-gradient(135deg,#200C0A,#140606)',
            '--toast-error-border': '#D85040',
            '--toast-info-bg': 'linear-gradient(135deg,#10141C,#080A10)',
            '--toast-info-border': '#4A9EE0',
            '--toast-text': '#E8ECF2',

            '--preset-flash-color': '#E8A840',
            '--preset-flash-glow': 'rgba(232,168,64,0.40)',
        },

        bcolors: [
            '#E8ECF2',  // warm white — primary
            '#4A9EE0',  // steel blue — rand
            '#E08840',  // amber — env
            '#44BB70',  // green — sample
            '#40B8A0',  // teal — morph
            '#D85040',  // red — shapes
            '#6B7488',  // muted grey
            '#3A4258',  // dark slate
        ],

        busColors: [
            '#3A4258',
            '#E8ECF2',
            '#4A9EE0',
            '#E08840',
            '#44BB70',
            '#40B8A0',
            '#D85040',
            '#6B7488',
        ],

        swatches: ['#0C0E14', '#1A1F2C', '#E8A840', '#4A9EE0', '#D85040'],
    },
    // ═══════════════════════════════════════════════════════════
    // MODULAR RANDOMIZER — DAW HIERARCHY THEME
    //
    // LAYER MODEL (darkest → brightest):
    //   L0 #0C1416  app chrome / background — recedes completely
    //   L1 #182022  panel surfaces — plugin blocks, block headers
    //   L2 #1E2A2C  content areas — lane canvas bg, param lists
    //   L3 #263436  interactive cells — hovered rows, active cells
    //   L4 #0A1214  inset / sunken — dark wells, below-surface
    //
    // COLOR ROLES (one meaning per color):
    //   #00C8B4  teal    → primary action / brand / rand mode
    //   #E8A030  amber   → envelope mode / time-based / warm
    //   #4AC8E8  sky     → sample mode / digital / cool
    //   #A0D860  lime    → morph mode / organic transition
    //   #E87040  coral   → shapes mode / geometric
    //   #44DD66  green   → status good / running / active handle
    //   #EE5555  red     → error / locked / mute
    //   #C8A000  yellow  → solo / warning
    //   #FFFFFF  white   → playhead (highest-contrast element when playing)
    // ═══════════════════════════════════════════════════════════

    daw_teal: {
        name: 'DAW Teal',
        vars: {
            // BACKGROUNDS
            '--bg-app': '#0C1416',
            '--bg-panel': '#182022',
            '--bg-cell': '#1E2A2C',
            '--bg-cell-hover': '#263436',
            '--bg-inset': '#0A1214',

            // BORDERS
            '--border': '#627476',
            '--border-strong': '#748E90',
            '--border-focus': '#00C8B4',

            // TEXT
            '--text-primary': '#E8F4F4',
            '--text-secondary': '#8ABCBE',
            '--text-muted': '#7A9496',
            '--input-text': '#E8F4F4',

            // ACCENT
            '--accent': '#00C8B4',
            '--accent-hover': '#00E8D0',
            '--accent-light': 'rgba(0,200,180,0.10)',
            '--accent-border': 'rgba(0,200,180,0.35)',

            // STATUS
            '--midi-dot': '#44DD66',
            '--locked-bg': 'rgba(238,85,85,0.12)',
            '--locked-border': 'rgba(238,85,85,0.35)',
            '--locked-icon': '#EE5555',
            '--auto-lock-bg': 'rgba(232,160,48,0.12)',
            '--auto-lock-border': 'rgba(232,160,48,0.35)',

            // MODE COLORS
            '--rand-color': '#00C8B4',
            '--env-color': '#E8A030',
            '--sample-color': '#4AC8E8',
            '--morph-color': '#A0D860',
            '--shapes-color': '#E87040',

            '--thumb-color': '#B8D0D0',

            // KNOBS
            '--knob-track': '#1A2C2E',
            '--knob-value': '#00C8B4',
            '--knob-dot': '#80EEE0',

            // PLUGIN CARD
            '--pf-bg': '#0E1A1C',
            '--pf-border': '#627476',
            '--pf-text': '#8ABCBE',
            '--ph-bg': '#0E1A1C',
            '--ph-border': '#627476',
            '--ph-text': '#E8F4F4',

            // PER-MODE LINKED KNOBS
            '--lk-rand-track': '#0E1E1C', '--lk-rand-value': '#00C8B4', '--lk-rand-dot': '#60EED8',
            '--lk-env-track': '#1E1808', '--lk-env-value': '#E8A030', '--lk-env-dot': '#FFCC70',
            '--lk-smp-track': '#0C1820', '--lk-smp-value': '#4AC8E8', '--lk-smp-dot': '#90E4F8',
            '--lk-morph-track': '#141C08', '--lk-morph-value': '#A0D860', '--lk-morph-dot': '#C8F080',
            '--lk-shapes-track': '#1C1008', '--lk-shapes-value': '#E87040', '--lk-shapes-dot': '#FFA070',

            // SOURCE INDICATORS
            '--si-rand-bg': 'rgba(0,200,180,0.12)',
            '--si-env-bg': 'rgba(232,160,48,0.12)',
            '--si-smp-bg': 'rgba(74,200,232,0.12)',
            '--si-morph-bg': 'rgba(160,216,96,0.12)',
            '--si-shapes-bg': 'rgba(232,112,64,0.12)',

            // FIRE BUTTON
            '--fire-text': '#0A1414',
            '--fire-active-bg': '#00C8B4',

            // ARC / RANGE


            // SLIDER
            '--slider-track': '#3A5C60',
            '--slider-thumb': '#D0E8E8',

            // PARAM BAR
            '--bar-track': '#0E1E20',
            '--bar-fill': '#00A898',

            // CARD BUTTONS
            '--card-btn-bg': '#0E1A1C',
            '--card-btn-border': '#627476',
            '--card-btn-text': '#8ABCBE',
            '--card-btn-hover': '#182428',

            // SNAP RING
            '--snap-ring-color': '#00C8B4',
            '--snap-ring-opacity': '0.55',

            // LANE / AUTOMATION
            '--lane-color': '#4AC8E8',
            '--lane-grid': 'rgba(232,244,244,0.06)',
            '--lane-grid-label': 'rgba(232,244,244,0.18)',
            '--lane-playhead': 'rgba(255,255,255,0.80)',
            '--lane-active': '#44DD66',

            // RANGE ARC
            '--range-arc': '#E8A040',

            // SCROLLBAR
            '--scrollbar-thumb': '#627476',
            '--scrollbar-track': 'transparent',

            // BUS CONTROLS
            '--bus-mute-bg': '#CC2222',
            '--bus-mute-text': '#FFFFFF',
            '--bus-solo-bg': '#C8A000',
            '--bus-solo-text': '#000000',
            '--bus-group-tint': '12%',
            '--bus-header-tint': '22%',
            '--bus-badge-text': '#0A1414',

            // TOAST / FLASH
            '--toast-success-bg': 'linear-gradient(135deg,#0A2018,#061410)',
            '--toast-success-border': '#44DD66',
            '--toast-error-bg': 'linear-gradient(135deg,#2A0808,#1A0404)',
            '--toast-error-border': '#EE5555',
            '--toast-info-bg': 'linear-gradient(135deg,#081820,#041014)',
            '--toast-info-border': '#00C8B4',
            '--toast-text': '#E8F4F4',
            '--preset-flash-color': '#44DD66',
            '--preset-flash-glow': 'rgba(68,221,102,0.45)',
            '--drag-highlight': '#00C8B4',
        },

        bcolors: [
            '#00C8B4',
            '#E8A030',
            '#4AC8E8',
            '#A0D860',
            '#E87040',
            '#44DD66',
            '#8ABCBE',
            '#C8D8D8',
        ],

        busColors: [
            '#627476',
            '#00C8B4',
            '#E87040',
            '#4AC8E8',
            '#E8A030',
            '#A0D860',
            '#D06CC0',
        ],

        swatches: ['#0C1416', '#1E2A2C', '#E8F4F4', '#00C8B4', '#E8A030']
    },

    // ─────────────────────────────────────────────────────────────────
    // GREY
    // Flat light theme. Steel blue as the single accent color.
    // No purple, no pink. Every mode gets a distinct muted hue.
    // ─────────────────────────────────────────────────────────────────
    grey: {
        name: 'Grey',
        vars: {
            '--bg-app': '#C8C8C8',
            '--bg-panel': '#E8E8E8',
            '--bg-cell': '#F4F4F4',
            '--bg-cell-hover': '#EEEEEE',
            '--bg-inset': '#DEDEDE',

            '--border': '#AAAAAA',
            '--border-strong': '#787878',
            '--border-focus': '#1A1A1A',

            '--text-primary': '#0A0A0A',
            '--text-secondary': '#3A3A3A',
            // FIX: was #787878 — fails on both panel (3.60) and cell (4.01). Now #606060 = 5.13/5.72 ✅
            '--text-muted': '#606060',
            '--input-text': '#0A0A0A',

            '--accent': '#1F5FA6',
            '--accent-hover': '#174E8C',
            '--accent-light': 'rgba(31,95,166,0.10)',
            '--accent-border': 'rgba(31,95,166,0.35)',

            '--locked-bg': 'rgba(160,20,20,0.10)',
            '--locked-border': 'rgba(160,20,20,0.30)',
            '--locked-icon': '#991212',

            '--auto-lock-bg': 'rgba(140,100,0,0.10)',
            '--auto-lock-border': 'rgba(140,100,0,0.28)',

            '--midi-dot': '#1F5FA6',
            '--rand-color': '#1F5FA6',

            // Mode colors — all distinct hues, all 4.5:1+ on bg-panel #E8E8E8
            '--env-color': '#1A6E5A',   // deep teal-green       5.01:1 ✅
            // FIX: was #C05000 — fails at 3.91:1. Now #A04000 = 5.31:1 ✅
            '--sample-color': '#A04000', // burnt sienna          5.31:1 ✅
            // FIX: was #1F5FA6 — same as rand/accent, no distinction. Now olive = 6.42:1 ✅
            '--morph-color': '#425830',  // muted olive           6.42:1 ✅
            '--shapes-color': '#2A2A2A', // near-black            11.71:1 ✅

            '--thumb-color': '#F4F4F4',

            '--knob-track': '#AAAAAA',
            '--knob-value': '#1F5FA6',
            '--knob-dot': '#3A7CC4',

            '--pf-bg': '#DEDEDE',
            '--pf-border': '#AAAAAA',
            // FIX: was #646464 — fails at 4.40:1 on #DEDEDE. Now #505050 = 5.99:1 ✅
            '--pf-text': '#505050',

            '--ph-bg': '#E8E8E8',
            '--ph-border': '#AAAAAA',
            '--ph-text': '#0A0A0A',

            '--lk-rand-track': '#AAAAAA', '--lk-rand-value': '#1F5FA6', '--lk-rand-dot': '#3A7CC4',
            '--lk-env-track': '#8AB0A8', '--lk-env-value': '#1A6E5A', '--lk-env-dot': '#2A8870',
            // FIX: was #7A48A0 (purple) — inconsistent with sample-color orange. Now matches #A04000
            '--lk-smp-track': '#B88858', '--lk-smp-value': '#A04000', '--lk-smp-dot': '#C86820',
            // FIX: was #1F5FA6 — same blue as rand. Now olive to match morph-color
            '--lk-morph-track': '#8A9870', '--lk-morph-value': '#425830', '--lk-morph-dot': '#5A7040',
            '--lk-shapes-track': '#AAAAAA', '--lk-shapes-value': '#2A2A2A', '--lk-shapes-dot': '#3A3A3A',

            '--si-rand-bg': 'rgba(31,95,166,0.14)',
            '--si-env-bg': 'rgba(26,110,90,0.14)',
            // FIX: was rgba(192,80,0,0.12) but sample was still old value — updated to match #A04000
            '--si-smp-bg': 'rgba(160,64,0,0.12)',
            // FIX: was rgba(31,95,166,0.14) — same as rand. Now olive
            '--si-morph-bg': 'rgba(66,88,48,0.14)',
            '--si-shapes-bg': 'rgba(10,10,10,0.10)',

            '--fire-text': '#F4F4F4',
            '--fire-active-bg': '#1A4F8A',



            '--slider-track': '#909090',
            '--slider-thumb': '#F0F0F0',
            '--bar-track': '#C8C8C8',
            '--bar-fill': '#2A5A8A',

            '--card-btn-bg': '#E8E8E8',
            '--card-btn-border': '#AAAAAA',
            '--card-btn-text': '#3A3A3A',
            '--card-btn-hover': '#F0F0F0',

            '--snap-ring-color': '#1F5FA6',
            '--snap-ring-opacity': '0.45',

            '--lane-color': '#1A6E5A',
            '--lane-grid': 'rgba(10,10,10,0.08)',
            '--lane-grid-label': 'rgba(10,10,10,0.20)',
            '--lane-playhead': 'rgba(10,10,10,0.60)',
            '--lane-active': '#1F5FA6',

            '--range-arc': '#E87040',

            '--scrollbar-thumb': '#AAAAAA',
            '--scrollbar-track': '#D8D8D8',

            '--bus-mute-bg': '#AA1818', '--bus-mute-text': '#fff',
            // FIX: was #fff — fails at 3.30:1 on #B08800. Black text = 6.37:1 ✅
            '--bus-solo-bg': '#B08800', '--bus-solo-text': '#000000',
            '--bus-group-tint': '8%', '--bus-header-tint': '14%',
            '--bus-badge-text': '#0A0A0A',
            '--toast-success-bg': 'linear-gradient(135deg,#E0F0E0,#D0E8D0)', '--toast-success-border': '#1F5FA6',
            '--toast-error-bg': 'linear-gradient(135deg,#F4E0E0,#E8D0D0)', '--toast-error-border': '#991212',
            '--toast-info-bg': 'linear-gradient(135deg,#E0E8F4,#D4DCE8)', '--toast-info-border': '#1F5FA6',
            '--toast-text': '#0A0A0A',
            '--preset-flash-color': '#1F5FA6', '--preset-flash-glow': 'rgba(31,95,166,0.4)',
            '--drag-highlight': '#1F5FA6'
        },
        bcolors: [
            '#1F5FA6',  // steel blue — rand
            '#1A6E5A',  // deep teal  — env
            '#A04000',  // burnt sienna — sample (fixed from #C05000)
            '#2A2A2A',  // near black — shapes
            '#4A8AB0',  // sky steel
            '#425830',  // olive — morph (fixed from duplicate steel blue)
            '#8A6030',  // bronze
            '#0A4A7A',  // deep navy
        ],
        busColors: ['#787878', '#1F5FA6', '#A04000', '#1A6E5A', '#4A8AB0', '#B08800', '#8A6030', '#425830'],
        swatches: ['#C8C8C8', '#E8E8E8', '#0A0A0A', '#1F5FA6', '#1A6E5A']
    },

    earth_tone: {
        name: 'Earth Tone',
        vars: {
            // ── BACKGROUNDS ──────────────────────────────────────────
            // Warm dark brown — like stained walnut or a dimmed tube amp chassis.
            '--bg-app': '#12100C',
            '--bg-panel': '#1C1814',
            '--bg-cell': '#252019',
            '--bg-cell-hover': '#302A22',
            '--bg-inset': '#0A0908',

            // ── BORDERS ───────────────────────────────────────────────
            '--border': '#3A3228',
            '--border-strong': '#504538',
            '--border-focus': '#C8A870',  // warm gold focus ring

            // ── TEXT ──────────────────────────────────────────────────
            '--text-primary': '#E8E0D4',  // parchment white — warm, easy on the eyes
            '--text-secondary': '#A0947E',
            '--text-muted': '#887A66',
            '--input-text': '#E8E0D4',

            // ── ACCENT ────────────────────────────────────────────────
            // Warm ochre gold — like aged brass hardware or a lit filament.
            '--accent': '#C8A050',
            '--accent-hover': '#D8B468',
            '--accent-light': 'rgba(200,160,80,0.10)',
            '--accent-border': 'rgba(200,160,80,0.30)',

            // ── STATUS ────────────────────────────────────────────────
            '--midi-dot': '#6AAD5C',  // muted organic green

            '--locked-bg': 'rgba(180,60,50,0.12)',
            '--locked-border': 'rgba(180,60,50,0.35)',
            '--locked-icon': '#B43C32',

            '--auto-lock-bg': 'rgba(200,160,80,0.10)',
            '--auto-lock-border': 'rgba(200,160,80,0.28)',

            // ── MODE COLORS ───────────────────────────────────────────
            // Natural palette — clay, moss, copper, rust. Every color could
            // come from pigment or mineral.
            '--rand-color': '#5C98B8',   // slate blue — like weathered copper patina
            '--env-color': '#C87830',    // burnt sienna
            '--sample-color': '#6AAD5C', // moss green
            '--morph-color': '#5CA888',  // sage / eucalyptus
            '--shapes-color': '#B85040', // terracotta red

            '--thumb-color': '#A0947E',

            // ── KNOBS ─────────────────────────────────────────────────
            '--knob-track': '#252019',
            '--knob-value': '#C8A050',   // ochre sweep
            '--knob-dot': '#E8E0D4',

            // ── PLUGIN CARD ───────────────────────────────────────────
            '--pf-bg': '#12100C',
            '--pf-border': '#3A3228',
            '--pf-text': '#887A66',

            '--ph-bg': '#12100C',
            '--ph-border': '#3A3228',
            '--ph-text': '#E8E0D4',

            // ── LINKED KNOBS (mode-tinted dark bg) ───────────────────
            '--lk-rand-track': '#101820', '--lk-rand-value': '#5C98B8', '--lk-rand-dot': '#78ACC8',
            '--lk-env-track': '#1E1208', '--lk-env-value': '#C87830', '--lk-env-dot': '#D89450',
            '--lk-smp-track': '#101A0E', '--lk-smp-value': '#6AAD5C', '--lk-smp-dot': '#84BE76',
            '--lk-morph-track': '#0E1C18', '--lk-morph-value': '#5CA888', '--lk-morph-dot': '#78BCA0',
            '--lk-shapes-track': '#1E0E0C', '--lk-shapes-value': '#B85040', '--lk-shapes-dot': '#CC6858',

            // ── SOURCE INDICATORS ─────────────────────────────────────
            '--si-rand-bg': 'rgba(92,152,184,0.12)',
            '--si-env-bg': 'rgba(200,120,48,0.12)',
            '--si-smp-bg': 'rgba(106,173,92,0.12)',
            '--si-morph-bg': 'rgba(92,168,136,0.12)',
            '--si-shapes-bg': 'rgba(184,80,64,0.12)',

            // ── FIRE BUTTON ───────────────────────────────────────────
            '--fire-text': '#12100C',
            '--fire-active-bg': '#C8A050',

            // ── ARC / RANGE ───────────────────────────────────────────


            // ── SLIDER ────────────────────────────────────────────────
            '--slider-track': '#3A3228',
            '--slider-thumb': '#C8A050',

            // ── PARAM BAR ─────────────────────────────────────────────
            '--bar-track': '#12100C',
            '--bar-fill': '#C8A050',

            // ── CARD BUTTONS ──────────────────────────────────────────
            '--card-btn-bg': '#12100C',
            '--card-btn-border': '#3A3228',
            '--card-btn-text': '#887A66',
            '--card-btn-hover': '#1C1814',

            // ── SNAP RING ─────────────────────────────────────────────
            '--snap-ring-color': '#C8A050',
            '--snap-ring-opacity': '0.55',

            // ── LANE / AUTOMATION ─────────────────────────────────────
            '--lane-color': '#C8A050',                   // ochre curve
            '--lane-grid': 'rgba(232,224,212,0.05)',
            '--lane-grid-label': 'rgba(232,224,212,0.18)',
            '--lane-playhead': 'rgba(232,224,212,0.88)',
            '--lane-active': '#6AAD5C',

            // ── RANGE ARC ─────────────────────────────────────────────
            '--range-arc': '#5C98B8',

            // ── SCROLLBAR ─────────────────────────────────────────────
            '--scrollbar-thumb': '#504538',
            '--scrollbar-track': 'transparent',

            // ── BUS CONTROLS ──────────────────────────────────────────
            '--bus-mute-bg': '#A83830', '--bus-mute-text': '#E8E0D4',
            '--bus-solo-bg': '#C8A050', '--bus-solo-text': '#12100C',
            '--bus-group-tint': '12%',
            '--bus-header-tint': '20%',
            '--bus-badge-text': '#12100C',

            // ── TOASTS ────────────────────────────────────────────────
            '--toast-success-bg': 'linear-gradient(135deg,#10180C,#080E06)',
            '--toast-success-border': '#6AAD5C',
            '--toast-error-bg': 'linear-gradient(135deg,#1E0E0C,#140806)',
            '--toast-error-border': '#B85040',
            '--toast-info-bg': 'linear-gradient(135deg,#141210,#0C0A08)',
            '--toast-info-border': '#C8A050',
            '--toast-text': '#E8E0D4',

            '--preset-flash-color': '#6AAD5C',
            '--preset-flash-glow': 'rgba(106,173,92,0.40)',
        },

        bcolors: [
            '#E8E0D4',  // parchment — primary
            '#5C98B8',  // patina blue — rand
            '#C87830',  // burnt sienna — env
            '#6AAD5C',  // moss — sample
            '#5CA888',  // sage — morph
            '#B85040',  // terracotta — shapes
            '#887A66',  // warm grey
            '#504538',  // dark umber
        ],

        busColors: [
            '#504538',
            '#E8E0D4',
            '#5C98B8',
            '#C87830',
            '#6AAD5C',
            '#5CA888',
            '#B85040',
            '#887A66',
        ],

        swatches: ['#12100C', '#252019', '#C8A050', '#6AAD5C', '#B85040'],
    },

    medical_vintage: {
        name: 'Medical Vintage',
        vars: {
            '--bg-app': '#1E1E1C', '--bg-panel': '#2C2C2A', '--bg-cell': '#383835',
            '--bg-cell-hover': '#424240', '--bg-inset': '#181816',
            '--border': '#505050', '--border-strong': '#787870', '--border-focus': '#C8B890',

            '--text-primary': '#F0E8D0',
            '--text-secondary': '#C0B090',
            // FIX: was #8A8070 — fails on panel (3.60) and cell (3.03). Now #A8A090 = 5.39/4.54 ✅
            '--text-muted': '#A8A090',
            '--input-text': '#F0E8D0',

            '--accent': '#B8C840', '--accent-hover': '#A0B030',
            '--accent-light': 'rgba(184,200,64,0.14)', '--accent-border': '#8A9A30',

            '--locked-bg': '#38201E', '--locked-border': '#783030',
            '--locked-icon': '#DD6644',
            '--auto-lock-bg': '#38280E', '--auto-lock-border': '#785020',

            '--midi-dot': '#88CC44',
            '--rand-color': '#B8C840',
            '--env-color': '#D4943A',
            '--sample-color': '#7ABCCC',
            // FIX: was #C8785A — identical to shapes-color, no visual distinction between modes.
            // Now phosphor green — thematically correct (CRT oscilloscope trace on vintage instruments)
            '--morph-color': '#88CC44',
            '--shapes-color': '#C8785A',

            '--thumb-color': '#D8D0B8',
            '--knob-track': '#202020', '--knob-value': '#B8C840', '--knob-dot': '#D4E050',

            '--pf-bg': '#141412',
            '--pf-border': '#505050',
            '--pf-text': '#B0A888',
            '--ph-bg': '#141412', '--ph-border': '#505050', '--ph-text': '#F0E8D0',

            '--lk-rand-track': '#383A24', '--lk-rand-value': '#B8C840', '--lk-rand-dot': '#D4E050',
            '--lk-env-track': '#382E18', '--lk-env-value': '#D4943A', '--lk-env-dot': '#EAB060',
            '--lk-smp-track': '#1E2E38', '--lk-smp-value': '#7ABCCC', '--lk-smp-dot': '#A0D4E0',
            // FIX: was #C8785A / #E09878 — same coral as shapes. Now phosphor green to match morph-color
            '--lk-morph-track': '#283818', '--lk-morph-value': '#88CC44', '--lk-morph-dot': '#AAEE66',
            '--lk-shapes-track': '#362420', '--lk-shapes-value': '#C8785A', '--lk-shapes-dot': '#E09878',

            '--si-rand-bg': 'rgba(184,200,64,0.14)',
            '--si-env-bg': 'rgba(212,148,58,0.14)',
            '--si-smp-bg': 'rgba(122,188,204,0.14)',
            // FIX: was rgba(200,120,90,0.14) — same coral as shapes. Now green to match morph-color
            '--si-morph-bg': 'rgba(136,204,68,0.14)',
            '--si-shapes-bg': 'rgba(200,120,90,0.14)',

            '--fire-text': '#1A1A18', '--fire-active-bg': '#A0B030',

            '--slider-track': '#444438', '--slider-thumb': '#E0D8C0',
            '--bar-track': '#1A1A18', '--bar-fill': '#A0B830',
            '--card-btn-bg': '#141412', '--card-btn-border': '#505050', '--card-btn-text': '#B0A888', '--card-btn-hover': '#242420',
            '--snap-ring-color': '#C8785A', '--snap-ring-opacity': '0.6',
            '--lane-color': '#7ABCCC', '--lane-grid': 'rgba(240,232,208,0.07)', '--lane-grid-label': 'rgba(240,232,208,0.14)',
            '--lane-playhead': 'rgba(240,232,208,0.6)', '--lane-active': '#88CC44',
            '--range-arc': '#60C0E0', '--scrollbar-thumb': '#505050', '--scrollbar-track': 'transparent',
            '--bus-mute-bg': '#AA3322', '--bus-mute-text': '#F0E8D0',
            '--bus-solo-bg': '#B8A020', '--bus-solo-text': '#1A1A18',
            '--bus-group-tint': '10%', '--bus-header-tint': '18%',
            '--bus-badge-text': '#1A1A18',
            '--toast-success-bg': 'linear-gradient(135deg,#1A2810,#0E1808)', '--toast-success-border': '#88CC44',
            '--toast-error-bg': 'linear-gradient(135deg,#3A1810,#2A0808)', '--toast-error-border': '#DD6644',
            '--toast-info-bg': 'linear-gradient(135deg,#1C1A0C,#100E06)', '--toast-info-border': '#B8C840',
            '--toast-text': '#F0E8D0',
            '--preset-flash-color': '#88CC44', '--preset-flash-glow': 'rgba(136,204,68,0.45)',
            '--drag-highlight': '#B8C840'
        },
        // FIX: bcolors updated — morph slot was #C8785A (same as shapes). Now phosphor green
        bcolors: ['#B8C840', '#D4943A', '#7ABCCC', '#CC6644', '#C8785A', '#88CC44', '#C0B090', '#D8D0B8'],
        busColors: ['#686858', '#B8C840', '#D4943A', '#7ABCCC', '#CC6644', '#88CC44', '#C8785A', '#88AA80'],
        swatches: ['#1E1E1C', '#383835', '#F0E8D0', '#B8C840', '#D4943A']
    },

    slate_studio: {
        name: 'Slate Studio',
        vars: {
            '--bg-app': '#111116',
            '--bg-panel': '#1A1A1E',
            '--bg-cell': '#222228',
            '--bg-cell-hover': '#2A2A32',
            '--bg-inset': '#0E0E12',

            '--border': '#7A7A90',
            '--border-strong': '#909098',
            '--border-focus': '#D4A840',

            '--text-primary': '#F0EEF8',
            '--text-secondary': '#9090A8',
            '--text-muted': '#888898',
            '--input-text': '#F0EEF8',

            '--accent': '#D4A840',
            '--accent-hover': '#F0C050',
            '--accent-light': 'rgba(212,168,64,0.10)',
            '--accent-border': 'rgba(212,168,64,0.35)',

            '--midi-dot': '#44DD66',

            '--locked-bg': 'rgba(220,60,60,0.12)',
            '--locked-border': 'rgba(220,60,60,0.35)',
            '--locked-icon': '#EE5050',

            '--auto-lock-bg': 'rgba(220,160,40,0.12)',
            '--auto-lock-border': 'rgba(220,160,40,0.35)',

            '--rand-color': '#D4A840',
            '--env-color': '#E85A30',
            '--sample-color': '#3AAAE0',
            '--morph-color': '#50D890',
            '--shapes-color': '#E05A40',

            '--thumb-color': '#B0B0C8',

            '--knob-track': '#1E1E24',
            '--knob-value': '#D4A840',
            '--knob-dot': '#F0CC70',

            '--pf-bg': '#111116',
            '--pf-border': '#7A7A90',
            '--pf-text': '#9090A8',

            '--ph-bg': '#111116',
            '--ph-border': '#7A7A90',
            '--ph-text': '#F0EEF8',

            '--lk-rand-track': '#201C08', '--lk-rand-value': '#D4A840', '--lk-rand-dot': '#F0CC70',
            '--lk-env-track': '#201008', '--lk-env-value': '#E85A30', '--lk-env-dot': '#FF8860',
            '--lk-smp-track': '#081820', '--lk-smp-value': '#3AAAE0', '--lk-smp-dot': '#70CCF8',
            '--lk-morph-track': '#0C201A', '--lk-morph-value': '#50D890', '--lk-morph-dot': '#88F8B8',
            '--lk-shapes-track': '#201008', '--lk-shapes-value': '#E05A40', '--lk-shapes-dot': '#F08868',

            '--si-rand-bg': 'rgba(212,168,64,0.12)',
            '--si-env-bg': 'rgba(232,90,48,0.12)',
            '--si-smp-bg': 'rgba(58,170,224,0.12)',
            '--si-morph-bg': 'rgba(80,216,144,0.12)', '--si-shapes-bg': 'rgba(224,90,64,0.12)',

            '--fire-text': '#111110',
            '--fire-active-bg': '#D4A840',



            '--slider-track': '#3A3A48',
            '--slider-thumb': '#C8C8E0',
            '--bar-track': '#141418',
            '--bar-fill': '#B89030',

            '--card-btn-bg': '#111116',
            '--card-btn-border': '#7A7A90',
            '--card-btn-text': '#9090A8',
            '--card-btn-hover': '#1A1A22',

            '--snap-ring-color': '#D4A840',
            '--snap-ring-opacity': '0.55',

            '--lane-color': '#3AAAE0',
            '--lane-grid': 'rgba(240,238,248,0.05)',
            '--lane-grid-label': 'rgba(240,238,248,0.16)',
            '--lane-playhead': 'rgba(255,255,255,0.82)',
            '--lane-active': '#44DD66',

            '--range-arc': '#60A0D4',
            '--scrollbar-thumb': '#7A7A90',
            '--scrollbar-track': 'transparent',

            '--bus-mute-bg': '#CC2222', '--bus-mute-text': '#FFFFFF',
            '--bus-solo-bg': '#C8A000', '--bus-solo-text': '#000000',
            '--bus-group-tint': '12%', '--bus-header-tint': '20%',
            '--bus-badge-text': '#111110',
            '--toast-success-bg': 'linear-gradient(135deg,#0C1C10,#061008)', '--toast-success-border': '#44DD66',
            '--toast-error-bg': 'linear-gradient(135deg,#2A0808,#1A0404)', '--toast-error-border': '#EE5050',
            '--toast-info-bg': 'linear-gradient(135deg,#181410,#0E0A04)', '--toast-info-border': '#D4A840',
            '--toast-text': '#F0EEF8',
            '--preset-flash-color': '#44DD66', '--preset-flash-glow': 'rgba(68,221,102,0.45)',
            '--drag-highlight': '#D4A840',
        },
        bcolors: ['#D4A840', '#E85A30', '#3AAAE0', '#50D890', '#E05A40', '#44DD66', '#9090A8', '#E0E0F0'],
        busColors: ['#3A3A48', '#D4A840', '#E85A30', '#3AAAE0', '#50D890', '#E05A40', '#44DD66', '#9090A8'],
        swatches: ['#111116', '#222228', '#F0EEF8', '#D4A840', '#E85A30'],
    },

    // ─────────────────────────────────────────────────────────────────
    // VINTAGE CONSOLE
    // 1970s broadcast console — Neve 8078, SSL 4000.
    // Warm ivory on dark walnut. Amber VU needle as accent.
    // ─────────────────────────────────────────────────────────────────
    vintage_console: {
        name: 'Vintage Console',
        vars: {
            '--bg-app': '#120E08',
            '--bg-panel': '#1C1810',
            '--bg-cell': '#252018',
            '--bg-cell-hover': '#2E2820',
            '--bg-inset': '#0E0A06',

            '--border': '#787060',
            '--border-strong': '#908070',
            '--border-focus': '#C8781E',

            '--text-primary': '#F0E8C8',
            '--text-secondary': '#B8A878',
            '--text-muted': '#9A8A60',
            '--input-text': '#F0E8C8',

            '--accent': '#C8781E',
            '--accent-hover': '#E89030',
            '--accent-light': 'rgba(200,120,30,0.12)',
            '--accent-border': 'rgba(200,120,30,0.38)',

            '--midi-dot': '#88CC44',

            '--locked-bg': 'rgba(200,40,40,0.12)',
            '--locked-border': 'rgba(200,40,40,0.35)',
            '--locked-icon': '#EE5544',

            '--auto-lock-bg': 'rgba(200,160,40,0.10)',
            '--auto-lock-border': 'rgba(200,160,40,0.30)',

            '--rand-color': '#C8781E',
            '--env-color': '#D4A030',
            '--sample-color': '#78BCCC',
            '--morph-color': '#A0C840',
            '--shapes-color': '#D46050',

            '--thumb-color': '#C8B888',

            '--knob-track': '#201808',
            '--knob-value': '#C8781E',
            '--knob-dot': '#F0A050',

            '--pf-bg': '#100C06',
            '--pf-border': '#787060',
            '--pf-text': '#9A8A60',

            '--ph-bg': '#100C06',
            '--ph-border': '#787060',
            '--ph-text': '#F0E8C8',

            '--lk-rand-track': '#201408', '--lk-rand-value': '#C8781E', '--lk-rand-dot': '#F0A050',
            '--lk-env-track': '#201808', '--lk-env-value': '#D4A030', '--lk-env-dot': '#F0C860',
            '--lk-smp-track': '#0C1820', '--lk-smp-value': '#78BCCC', '--lk-smp-dot': '#A8D8E8',
            '--lk-morph-track': '#141C06', '--lk-morph-value': '#A0C840', '--lk-morph-dot': '#C8EE60',
            '--lk-shapes-track': '#1C100A', '--lk-shapes-value': '#D46050', '--lk-shapes-dot': '#F09078',

            '--si-rand-bg': 'rgba(200,120,30,0.12)',
            '--si-env-bg': 'rgba(212,160,48,0.12)',
            '--si-smp-bg': 'rgba(120,188,204,0.12)',
            '--si-morph-bg': 'rgba(160,200,64,0.12)',
            '--si-shapes-bg': 'rgba(212,96,80,0.12)',

            '--fire-text': '#100C06',
            '--fire-active-bg': '#C8781E',



            '--slider-track': '#4A3820',
            '--slider-thumb': '#D8C898',
            '--bar-track': '#181008',
            '--bar-fill': '#B06818',

            '--card-btn-bg': '#100C06',
            '--card-btn-border': '#787060',
            '--card-btn-text': '#9A8A60',
            '--card-btn-hover': '#1C1810',

            '--snap-ring-color': '#C8781E',
            '--snap-ring-opacity': '0.55',

            '--lane-color': '#78BCCC',
            '--lane-grid': 'rgba(240,232,200,0.06)',
            '--lane-grid-label': 'rgba(240,232,200,0.18)',
            '--lane-playhead': 'rgba(255,248,220,0.82)',
            '--lane-active': '#88CC44',

            '--range-arc': '#4A9EC8',
            '--scrollbar-thumb': '#787060',
            '--scrollbar-track': 'transparent',

            '--bus-mute-bg': '#BB2222', '--bus-mute-text': '#FFFFFF',
            '--bus-solo-bg': '#B89000', '--bus-solo-text': '#000000',
            '--bus-group-tint': '12%', '--bus-header-tint': '20%',
            '--bus-badge-text': '#100C06',
            '--toast-success-bg': 'linear-gradient(135deg,#0E1C08,#060E04)', '--toast-success-border': '#88CC44',
            '--toast-error-bg': 'linear-gradient(135deg,#3A1008,#2A0804)', '--toast-error-border': '#EE5544',
            '--toast-info-bg': 'linear-gradient(135deg,#1A1408,#0E0A04)', '--toast-info-border': '#C8781E',
            '--toast-text': '#F0E8C8',
            '--preset-flash-color': '#88CC44', '--preset-flash-glow': 'rgba(136,204,68,0.45)',
            '--drag-highlight': '#C8781E',
        },
        bcolors: ['#C8781E', '#D4A030', '#78BCCC', '#A0C840', '#D46050', '#88CC44', '#B8A878', '#F0E8C8'],
        busColors: ['#584838', '#C8781E', '#D46050', '#78BCCC', '#D4A030', '#A0C840', '#88CC44', '#B8A878'],
        swatches: ['#120E08', '#252018', '#F0E8C8', '#C8781E', '#D4A030'],
    },

    win98: {
        name: 'Win 98',
        vars: {
            // ── BACKGROUNDS ──────────────────────────────────────────
            // The classic silver-grey desktop and raised panel look.
            '--bg-app': '#C0C0C0',
            '--bg-panel': '#D4D0C8',
            '--bg-cell': '#FFFFFF',
            '--bg-cell-hover': '#E8E8E0',
            '--bg-inset': '#808080',

            // ── BORDERS ───────────────────────────────────────────────
            // The iconic beveled 3D look — dark bottom-right, light top-left.
            '--border': '#808080',
            '--border-strong': '#404040',
            '--border-focus': '#000080',  // navy focus — just like a selected title bar

            // ── TEXT ──────────────────────────────────────────────────
            '--text-primary': '#000000',
            '--text-secondary': '#404040',
            '--text-muted': '#808080',
            '--input-text': '#000000',

            // ── ACCENT ────────────────────────────────────────────────
            // The unmistakable navy-blue of a selected title bar / highlighted menu item.
            '--accent': '#000080',
            '--accent-hover': '#0000AA',
            '--accent-light': 'rgba(0,0,128,0.10)',
            '--accent-border': 'rgba(0,0,128,0.40)',

            // ── STATUS ────────────────────────────────────────────────
            '--midi-dot': '#008000',  // classic Windows green

            '--locked-bg': 'rgba(192,0,0,0.12)',
            '--locked-border': 'rgba(192,0,0,0.40)',
            '--locked-icon': '#C00000',

            '--auto-lock-bg': 'rgba(128,128,0,0.12)',
            '--auto-lock-border': 'rgba(128,128,0,0.30)',

            // ── MODE COLORS ───────────────────────────────────────────
            // The Windows 16-color palette — unapologetically 4-bit.
            '--rand-color': '#0000FF',   // blue
            '--env-color': '#FF8000',    // orange (dark yellow + red)
            '--sample-color': '#008000', // green
            '--morph-color': '#008080',  // teal
            '--shapes-color': '#C00000', // dark red

            '--thumb-color': '#808080',

            // ── KNOBS ─────────────────────────────────────────────────
            '--knob-track': '#C0C0C0',
            '--knob-value': '#000080',   // navy sweep
            '--knob-dot': '#000000',

            // ── PLUGIN CARD ───────────────────────────────────────────
            '--pf-bg': '#D4D0C8',
            '--pf-border': '#808080',
            '--pf-text': '#404040',

            '--ph-bg': '#000080',        // title bar blue
            '--ph-border': '#404040',
            '--ph-text': '#FFFFFF',      // white text on blue title bar

            // ── LINKED KNOBS (mode-tinted light bg) ──────────────────
            '--lk-rand-track': '#D0D0E8', '--lk-rand-value': '#0000FF', '--lk-rand-dot': '#0000CC',
            '--lk-env-track': '#E8DCC8', '--lk-env-value': '#FF8000', '--lk-env-dot': '#CC6600',
            '--lk-smp-track': '#C8E0C8', '--lk-smp-value': '#008000', '--lk-smp-dot': '#006600',
            '--lk-morph-track': '#C8E0DC', '--lk-morph-value': '#008080', '--lk-morph-dot': '#006666',
            '--lk-shapes-track': '#E0C8C8', '--lk-shapes-value': '#C00000', '--lk-shapes-dot': '#990000',

            // ── SOURCE INDICATORS ─────────────────────────────────────
            '--si-rand-bg': 'rgba(0,0,255,0.10)',
            '--si-env-bg': 'rgba(255,128,0,0.10)',
            '--si-smp-bg': 'rgba(0,128,0,0.10)',
            '--si-morph-bg': 'rgba(0,128,128,0.10)',
            '--si-shapes-bg': 'rgba(192,0,0,0.10)',

            // ── FIRE BUTTON ───────────────────────────────────────────
            '--fire-text': '#FFFFFF',
            '--fire-active-bg': '#000080',

            // ── ARC / RANGE ───────────────────────────────────────────


            // ── SLIDER ────────────────────────────────────────────────
            '--slider-track': '#808080',
            '--slider-thumb': '#D4D0C8',  // raised button look

            // ── PARAM BAR ─────────────────────────────────────────────
            '--bar-track': '#C0C0C0',
            '--bar-fill': '#000080',

            // ── CARD BUTTONS ──────────────────────────────────────────
            '--card-btn-bg': '#D4D0C8',
            '--card-btn-border': '#808080',
            '--card-btn-text': '#000000',
            '--card-btn-hover': '#E8E8E0',

            // ── SNAP RING ─────────────────────────────────────────────
            '--snap-ring-color': '#000080',
            '--snap-ring-opacity': '0.60',

            // ── LANE / AUTOMATION ─────────────────────────────────────
            '--lane-color': '#000080',
            '--lane-grid': 'rgba(0,0,0,0.08)',
            '--lane-grid-label': 'rgba(0,0,0,0.30)',
            '--lane-playhead': 'rgba(0,0,0,0.80)',
            '--lane-active': '#008000',

            // ── RANGE ARC ─────────────────────────────────────────────
            '--range-arc': '#0000FF',

            // ── SCROLLBAR ─────────────────────────────────────────────
            '--scrollbar-thumb': '#D4D0C8',
            '--scrollbar-track': '#C0C0C0',

            // ── BUS CONTROLS ──────────────────────────────────────────
            '--bus-mute-bg': '#C00000', '--bus-mute-text': '#FFFFFF',
            '--bus-solo-bg': '#C0C000', '--bus-solo-text': '#000000',
            '--bus-group-tint': '8%',
            '--bus-header-tint': '15%',
            '--bus-badge-text': '#FFFFFF',

            // ── TOASTS ────────────────────────────────────────────────
            '--toast-success-bg': 'linear-gradient(135deg,#D4E8D4,#C8DCC8)',
            '--toast-success-border': '#008000',
            '--toast-error-bg': 'linear-gradient(135deg,#E8D0D0,#DCC4C4)',
            '--toast-error-border': '#C00000',
            '--toast-info-bg': 'linear-gradient(135deg,#D4D0C8,#C8C4BC)',
            '--toast-info-border': '#000080',
            '--toast-text': '#000000',

            '--preset-flash-color': '#000080',
            '--preset-flash-glow': 'rgba(0,0,128,0.35)',
        },

        bcolors: [
            '#000000',  // black — primary
            '#0000FF',  // blue — rand
            '#FF8000',  // orange — env
            '#008000',  // green — sample
            '#008080',  // teal — morph
            '#C00000',  // red — shapes
            '#808080',  // grey
            '#C0C0C0',  // silver
        ],

        busColors: [
            '#808080',
            '#000000',
            '#0000FF',
            '#FF8000',
            '#008000',
            '#008080',
            '#C00000',
            '#C0C0C0',
        ],

        swatches: ['#C0C0C0', '#D4D0C8', '#000080', '#008000', '#C00000'],
    },

    // ─────────────────────────────────────────────────────────────────
    // WARM TAPE
    // Analog tape / Neve / SSL mastering suite.
    // Dark mahogany panels, warm ivory text, VU yellow accent.
    // ─────────────────────────────────────────────────────────────────
    warm_tape: {
        name: 'Warm Tape',
        vars: {
            '--bg-app': '#160E06',
            '--bg-panel': '#211B12',
            '--bg-cell': '#2C2418',
            '--bg-cell-hover': '#363020',
            '--bg-inset': '#120A04',

            '--border': '#887860',
            '--border-strong': '#A89070',
            '--border-focus': '#E8C040',

            '--text-primary': '#F4ECD8',
            '--text-secondary': '#C0A870',
            '--text-muted': '#B09060',
            '--input-text': '#F4ECD8',

            '--accent': '#E8C040',
            '--accent-hover': '#FFD850',
            '--accent-light': 'rgba(232,192,64,0.10)',
            '--accent-border': 'rgba(232,192,64,0.35)',

            '--midi-dot': '#88CC44',

            '--locked-bg': 'rgba(196,32,32,0.12)',
            '--locked-border': 'rgba(196,32,32,0.35)',
            '--locked-icon': '#E84040',

            '--auto-lock-bg': 'rgba(200,160,40,0.10)',
            '--auto-lock-border': 'rgba(200,160,40,0.30)',

            '--rand-color': '#E8C040',
            '--env-color': '#E06828',
            '--sample-color': '#60B8D8',
            '--morph-color': '#98D058',
            '--shapes-color': '#D86848',

            '--thumb-color': '#C0A870',

            '--knob-track': '#1C1408',
            '--knob-value': '#E8C040',
            '--knob-dot': '#FFE880',

            '--pf-bg': '#140C04',
            '--pf-border': '#887860',
            '--pf-text': '#B09060',

            '--ph-bg': '#140C04',
            '--ph-border': '#887860',
            '--ph-text': '#F4ECD8',

            '--lk-rand-track': '#201808', '--lk-rand-value': '#E8C040', '--lk-rand-dot': '#FFE880',
            '--lk-env-track': '#1C1008', '--lk-env-value': '#E06828', '--lk-env-dot': '#FF9858',
            '--lk-smp-track': '#0C1820', '--lk-smp-value': '#60B8D8', '--lk-smp-dot': '#98D8F0',
            '--lk-morph-track': '#141C08', '--lk-morph-value': '#98D058', '--lk-morph-dot': '#C8F078',
            '--lk-shapes-track': '#1C1008', '--lk-shapes-value': '#D86848', '--lk-shapes-dot': '#F89878',

            '--si-rand-bg': 'rgba(232,192,64,0.12)',
            '--si-env-bg': 'rgba(224,104,40,0.12)',
            '--si-smp-bg': 'rgba(96,184,216,0.12)',
            '--si-morph-bg': 'rgba(152,208,88,0.12)',
            '--si-shapes-bg': 'rgba(216,104,72,0.12)',

            '--fire-text': '#120A04',
            '--fire-active-bg': '#E8C040',



            '--slider-track': '#4A3818',
            '--slider-thumb': '#D8C090',
            '--bar-track': '#140C04',
            '--bar-fill': '#D0A830',

            '--card-btn-bg': '#140C04',
            '--card-btn-border': '#887860',
            '--card-btn-text': '#B09060',
            '--card-btn-hover': '#201810',

            '--snap-ring-color': '#E8C040',
            '--snap-ring-opacity': '0.55',

            '--lane-color': '#60B8D8',
            '--lane-grid': 'rgba(244,236,216,0.06)',
            '--lane-grid-label': 'rgba(244,236,216,0.18)',
            '--lane-playhead': 'rgba(255,248,220,0.85)',
            '--lane-active': '#88CC44',

            '--range-arc': '#60B0E8',
            '--scrollbar-thumb': '#887860',
            '--scrollbar-track': 'transparent',

            '--bus-mute-bg': '#C42020', '--bus-mute-text': '#FFFFFF',
            '--bus-solo-bg': '#C8A000', '--bus-solo-text': '#000000',
            '--bus-group-tint': '12%', '--bus-header-tint': '20%',
            '--bus-badge-text': '#120A04',
            '--toast-success-bg': 'linear-gradient(135deg,#102008,#081004)', '--toast-success-border': '#88CC44',
            '--toast-error-bg': 'linear-gradient(135deg,#380808,#200404)', '--toast-error-border': '#E84040',
            '--toast-info-bg': 'linear-gradient(135deg,#1A1808,#100C04)', '--toast-info-border': '#E8C040',
            '--toast-text': '#F4ECD8',
            '--preset-flash-color': '#88CC44', '--preset-flash-glow': 'rgba(136,204,68,0.45)',
            '--drag-highlight': '#D0A838',
        },
        bcolors: ['#E8C040', '#E06828', '#60B8D8', '#98D058', '#D86848', '#88CC44', '#C0A870', '#F4ECD8'],
        busColors: ['#40341A', '#E8C040', '#E06828', '#60B8D8', '#98D058', '#D86848', '#88CC44', '#C0A870'],
        swatches: ['#160E06', '#2C2418', '#F4ECD8', '#E8C040', '#E06828'],
    },
    // ─────────────────────────────────────────────────────────────────
    // DEEP SPACE
    //
    // Concept: the inside of a precision scientific instrument.
    // Particle physics control room. Telescope array ops.
    // The kind of screen where the data IS the aesthetic.
    //
    // Design principles:
    //   1. Chrome recedes. Content comes forward.
    //   2. One warm color in a cold environment commands attention.
    //   3. Structure comes from elevation, not borders.
    //   4. Mode colors are a language — five distinct hue families,
    //      one meaning each, nothing shared.
    //   5. The playhead is the brightest thing on screen when playing.
    //
    // Layer model:
    //   L0  #0D1117  outer shell — nearly black, slight blue cast
    //   L1  #161B22  panel surfaces — plugin blocks, section headers
    //   L2  #1C2333  content areas — canvas, param lists, inset cards
    //   L3  #222D3F  interactive rows — hovered cells, active states
    //   L4  #090D12  sunken wells — inset boxes, below-surface
    //
    // Color language:
    //   #E8D9A0  desaturated gold  → accent / primary action / transport
    //   #00B4D8  ice blue          → rand / probability / cold chance
    //   #E06C1A  burn orange       → envelope / attack / energy
    //   #2CB67D  terminal green    → sample / playback / data stream
    //   #40B8CC  bright teal       → morph / transformation / spectrum
    //   #E8553A  warm vermilion    → shapes / geometric / precision
    //   #3DD68C  signal green      → status ok / running / active handle
    //   #F85149  alert red         → error / locked / danger
    //   #D4A500  caution amber     → solo / warning
    // ─────────────────────────────────────────────────────────────────

    deep_space: {
        name: 'Deep Space',
        vars: {
            // ── BACKGROUNDS ──────────────────────────────────────────
            '--bg-app': '#0D1117',  // L0
            '--bg-panel': '#161B22',  // L1 — 14.64:1 text contrast ✅
            '--bg-cell': '#1C2333',  // L2
            '--bg-cell-hover': '#222D3F',  // L3
            '--bg-inset': '#090D12',  // L4

            // ── BORDERS ───────────────────────────────────────────────
            // Structure comes from bg elevation differences, not drawn lines.
            // These borders appear only on explicit frames and input outlines.
            '--border': '#21262D',  // subtle structural edge
            '--border-strong': '#404858',  // emphasized separators
            '--border-focus': '#E8D9A0',  // gold focus ring — unmissable

            // ── TEXT ──────────────────────────────────────────────────
            '--text-primary': '#E6EDF3',  // 14.64:1 on panel ✅
            '--text-secondary': '#8B949E',  //  5.62:1 on panel ✅
            '--text-muted': '#848E9C',  //  5.21:1 panel, 4.73:1 cell ✅
            '--input-text': '#E6EDF3',

            // ── ACCENT ────────────────────────────────────────────────
            // Desaturated gold. The only warm thing on screen.
            // Used for: active controls, knob arcs, transport, focus rings.
            '--accent': '#E8D9A0',  // 12.24:1 on panel ✅
            '--accent-hover': '#F4ECC4',
            '--accent-light': 'rgba(232,217,160,0.10)',
            '--accent-border': 'rgba(232,217,160,0.30)',

            // ── STATUS ────────────────────────────────────────────────
            '--midi-dot': '#3DD68C',  // signal green = running

            '--locked-bg': 'rgba(248,81,73,0.10)',
            '--locked-border': 'rgba(248,81,73,0.30)',
            '--locked-icon': '#F85149',  // 4.71:1 on panel ✅

            '--auto-lock-bg': 'rgba(212,165,0,0.10)',
            '--auto-lock-border': 'rgba(212,165,0,0.28)',

            // ── MODE COLORS ───────────────────────────────────────────
            // Five maximally distinct hues. One meaning each.
            '--rand-color': '#00B4D8',  // 7.02:1 — ice blue, cold randomness
            '--env-color': '#E06C1A',  // 5.21:1 — burn orange, attack heat
            '--sample-color': '#2CB67D',  // 6.67:1 — terminal green, data stream
            '--morph-color': '#40B8CC',  // 8.35:1 — bright teal, transformation
            '--shapes-color': '#E8553A',  // 5.62:1 — warm vermilion, geometric

            '--thumb-color': '#8B949E',

            // ── KNOBS ─────────────────────────────────────────────────
            '--knob-track': '#1C2333',  // matches bg_cell — sunken appearance
            '--knob-value': '#E8D9A0',  // gold arc
            '--knob-dot': '#F4ECC4',  // bright tip

            // ── PLUGIN CARD ───────────────────────────────────────────
            '--pf-bg': '#0D1117',  // card footer = bg_app — recedes maximally
            '--pf-border': '#21262D',
            '--pf-text': '#848E9C',  // 5.70:1 on pf-bg ✅

            '--ph-bg': '#0D1117',  // card header = same dark shell
            '--ph-border': '#21262D',
            '--ph-text': '#E6EDF3',  // 15.18:1 ✅

            // ── LINKED KNOBS (per-mode tinted) ────────────────────────
            '--lk-rand-track': '#0B2933', '--lk-rand-value': '#00B4D8', '--lk-rand-dot': '#3FC6E1',
            '--lk-env-track': '#2C1E17', '--lk-env-value': '#E06C1A', '--lk-env-dot': '#E79053',
            '--lk-smp-track': '#112926', '--lk-smp-value': '#2CB67D', '--lk-smp-dot': '#60C89D',
            '--lk-morph-track': '#132430', '--lk-morph-value': '#40B8CC', '--lk-morph-dot': '#6CD0E0',
            '--lk-shapes-track': '#2E1810', '--lk-shapes-value': '#E8553A', '--lk-shapes-dot': '#F07858',

            // ── SOURCE INDICATORS ─────────────────────────────────────
            '--si-rand-bg': 'rgba(0,180,216,0.12)',
            '--si-env-bg': 'rgba(224,108,26,0.12)',
            '--si-smp-bg': 'rgba(44,182,125,0.12)',
            '--si-morph-bg': 'rgba(64,184,204,0.12)',
            '--si-shapes-bg': 'rgba(255,107,157,0.12)',

            // ── FIRE BUTTON ───────────────────────────────────────────
            '--fire-text': '#0D1117',  // 13.39:1 on gold ✅
            '--fire-active-bg': '#E8D9A0',

            // ── ARC / RANGE ───────────────────────────────────────────


            // ── SLIDER ────────────────────────────────────────────────
            '--slider-track': '#222D3F',
            '--slider-thumb': '#8B949E',

            // ── PARAM BAR ─────────────────────────────────────────────
            '--bar-track': '#0D1117',
            '--bar-fill': '#C8BB80',  // slightly less saturated than accent

            // ── CARD BUTTONS ──────────────────────────────────────────
            '--card-btn-bg': '#0D1117',
            '--card-btn-border': '#21262D',
            '--card-btn-text': '#848E9C',
            '--card-btn-hover': '#161B22',

            // ── SNAP RING ─────────────────────────────────────────────
            '--snap-ring-color': '#E8D9A0',
            '--snap-ring-opacity': '0.50',

            // ── LANE / AUTOMATION ─────────────────────────────────────
            // Canvas is bg_cell — content area, slightly lighter than panel.
            // Curve is ice blue: distinct from gold accent, reads as data.
            // Playhead is near-white — the brightest moving element on screen.
            '--lane-color': '#00B4D8',              // ice blue curve — data visualization
            '--lane-grid': 'rgba(230,237,243,0.04)', // barely visible, doesn't compete
            '--lane-grid-label': 'rgba(230,237,243,0.18)', // bar numbers legible but subordinate
            '--lane-playhead': 'rgba(255,255,255,0.90)', // near-white — unmissable when playing
            '--lane-active': '#3DD68C',               // signal green control point

            // ── RANGE ARC ─────────────────────────────────────────────
            '--range-arc': '#7AB0E8',

            // ── SCROLLBAR ─────────────────────────────────────────────
            '--scrollbar-thumb': '#404858',
            '--scrollbar-track': 'transparent',

            // ── BUS CONTROLS ──────────────────────────────────────────
            '--bus-mute-bg': '#C62828',  // red — universal mute convention
            '--bus-mute-text': '#FFFFFF',  // 5.62:1 ✅
            '--bus-solo-bg': '#D4A500',  // amber — universal solo convention
            '--bus-solo-text': '#000000',  // 9.18:1 ✅
            '--bus-group-tint': '12%',
            '--bus-header-tint': '20%',
            '--bus-badge-text': '#0D1117',

            // ── TOASTS ────────────────────────────────────────────────
            '--toast-success-bg': 'linear-gradient(135deg,#0C2018,#071410)',
            '--toast-success-border': '#3DD68C',
            '--toast-error-bg': 'linear-gradient(135deg,#280A08,#1A0404)',
            '--toast-error-border': '#F85149',
            '--toast-info-bg': 'linear-gradient(135deg,#0E1624,#090D18)',
            '--toast-info-border': '#E8D9A0',
            '--toast-text': '#E6EDF3',

            '--preset-flash-color': '#3DD68C',
            '--preset-flash-glow': 'rgba(61,214,140,0.40)',
            '--drag-highlight': '#E8D9A0',
        },

        bcolors: [
            '#E8D9A0',  // gold   — primary accent
            '#00B4D8',  // ice    — rand
            '#E06C1A',  // orange — env
            '#2CB67D',  // green  — sample
            '#40B8CC',  // teal   — morph
            '#E8553A',  // red    — shapes
            '#3DD68C',  // lime   — active/status
            '#8B949E',  // steel  — neutral
        ],

        busColors: [
            '#404858',  // neutral
            '#E8D9A0',  // gold
            '#00B4D8',  // ice blue
            '#E06C1A',  // orange
            '#2CB67D',  // green
            '#40B8CC',  // teal
            '#E8553A',  // red
            '#3DD68C',  // signal green
        ],

        swatches: ['#0D1117', '#1C2333', '#E6EDF3', '#E8D9A0', '#00B4D8'],
    },
    pitch_black: {
        name: 'Pitch Black',
        vars: {
            // ── BACKGROUNDS ──────────────────────────────────────────
            '--bg-app': '#000000',
            '--bg-panel': '#111111',
            '--bg-cell': '#1A1A1A',
            '--bg-cell-hover': '#252525',
            '--bg-inset': '#080808',

            // ── BORDERS ───────────────────────────────────────────────
            // Pure greyscale. Structure comes from bg elevation.
            '--border': '#2A2A2A',
            '--border-strong': '#3D3D3D',
            '--border-focus': '#FFFFFF',  // white focus ring — unmissable on black

            // ── TEXT ──────────────────────────────────────────────────
            '--text-primary': '#FFFFFF',  // 18.88:1 ✅
            '--text-secondary': '#999999',  //  6.63:1 ✅
            '--text-muted': '#888888',  //  5.33:1 panel, 4.91:1 cell ✅
            '--input-text': '#FFFFFF',

            // ── ACCENT ────────────────────────────────────────────────
            // White is the accent. In an all-black UI, white commands attention.
            '--accent': '#FFFFFF',
            '--accent-hover': '#DDDDDD',
            '--accent-light': 'rgba(255,255,255,0.08)',
            '--accent-border': 'rgba(255,255,255,0.25)',

            // ── STATUS ────────────────────────────────────────────────
            '--midi-dot': '#00CC66',  // green — signal present (functional color)

            '--locked-bg': 'rgba(255,34,102,0.12)',
            '--locked-border': 'rgba(255,34,102,0.35)',
            '--locked-icon': '#FF4400',

            '--auto-lock-bg': 'rgba(255,180,0,0.10)',
            '--auto-lock-border': 'rgba(255,180,0,0.28)',

            // ── MODE COLORS ───────────────────────────────────────────
            // Pure saturated hues — maximum pop against black.
            '--rand-color': '#00AAFF',  // 7.37:1 electric blue
            '--env-color': '#FF6600',  // 6.43:1 pure orange
            '--sample-color': '#00CC66',  // 8.84:1 pure green
            '--morph-color': '#00CCAA',  // 8.89:1 mint
            '--shapes-color': '#FF4400',  // 5.24:1 electric red-orange

            '--thumb-color': '#999999',

            // ── KNOBS ─────────────────────────────────────────────────
            '--knob-track': '#1A1A1A',
            '--knob-value': '#FFFFFF',
            '--knob-dot': '#FFFFFF',

            // ── PLUGIN CARD ───────────────────────────────────────────
            '--pf-bg': '#000000',
            '--pf-border': '#2A2A2A',
            '--pf-text': '#888888',  // 5.92:1 on #000000 ✅

            '--ph-bg': '#000000',
            '--ph-border': '#2A2A2A',
            '--ph-text': '#FFFFFF',

            // ── LINKED KNOBS (mode-tinted dark bg) ───────────────────
            '--lk-rand-track': '#001723', '--lk-rand-value': '#00AAFF', '--lk-rand-dot': '#38BCFF',
            '--lk-env-track': '#230E00', '--lk-env-value': '#FF6600', '--lk-env-dot': '#FF8738',
            '--lk-smp-track': '#001C0E', '--lk-smp-value': '#00CC66', '--lk-smp-dot': '#38D787',
            '--lk-morph-track': '#002820', '--lk-morph-value': '#00CCAA', '--lk-morph-dot': '#33DDBB',
            '--lk-shapes-track': '#230800', '--lk-shapes-value': '#FF4400', '--lk-shapes-dot': '#FF6633',

            // ── SOURCE INDICATORS ─────────────────────────────────────
            '--si-rand-bg': 'rgba(0,170,255,0.12)',
            '--si-env-bg': 'rgba(255,102,0,0.12)',
            '--si-smp-bg': 'rgba(0,204,102,0.12)',
            '--si-morph-bg': 'rgba(0,204,170,0.12)',
            '--si-shapes-bg': 'rgba(255,34,102,0.12)',

            // ── FIRE BUTTON ───────────────────────────────────────────
            '--fire-text': '#000000',
            '--fire-active-bg': '#FFFFFF',

            // ── ARC / RANGE ───────────────────────────────────────────


            // ── SLIDER ────────────────────────────────────────────────
            '--slider-track': '#2A2A2A',
            '--slider-thumb': '#FFFFFF',

            // ── PARAM BAR ─────────────────────────────────────────────
            '--bar-track': '#000000',
            '--bar-fill': '#FFFFFF',

            // ── CARD BUTTONS ──────────────────────────────────────────
            '--card-btn-bg': '#000000',
            '--card-btn-border': '#2A2A2A',
            '--card-btn-text': '#888888',
            '--card-btn-hover': '#111111',

            // ── SNAP RING ─────────────────────────────────────────────
            '--snap-ring-color': '#FFFFFF',
            '--snap-ring-opacity': '0.50',

            // ── LANE / AUTOMATION ─────────────────────────────────────
            '--lane-color': '#FFFFFF',               // white curve on black canvas
            '--lane-grid': 'rgba(255,255,255,0.05)',
            '--lane-grid-label': 'rgba(255,255,255,0.22)',
            '--lane-playhead': 'rgba(255,255,255,0.95)', // maximum brightness when playing
            '--lane-active': '#00CC66',                // green handle — functional color

            // ── RANGE ARC ─────────────────────────────────────────────
            '--range-arc': '#00AAFF',

            // ── SCROLLBAR ─────────────────────────────────────────────
            '--scrollbar-thumb': '#3D3D3D',
            '--scrollbar-track': 'transparent',

            // ── BUS CONTROLS ──────────────────────────────────────────
            '--bus-mute-bg': '#CC0000', '--bus-mute-text': '#FFFFFF',  // 5.89:1 ✅
            '--bus-solo-bg': '#DDAA00', '--bus-solo-text': '#000000',  // 9.82:1 ✅
            '--bus-group-tint': '12%',
            '--bus-header-tint': '20%',
            '--bus-badge-text': '#000000',

            // ── TOASTS ────────────────────────────────────────────────
            '--toast-success-bg': 'linear-gradient(135deg,#0A1F0A,#040C04)',
            '--toast-success-border': '#00CC66',
            '--toast-error-bg': 'linear-gradient(135deg,#230408,#130204)',
            '--toast-error-border': '#FF4400',
            '--toast-info-bg': 'linear-gradient(135deg,#0A0A0A,#030303)',
            '--toast-info-border': '#FFFFFF',
            '--toast-text': '#FFFFFF',

            '--preset-flash-color': '#00CC66',
            '--preset-flash-glow': 'rgba(0,204,102,0.40)',

            // ── DRAG HIGHLIGHT ───────────────────────────────────────
            '--drag-highlight': '#FFFFFF',  // white dashes on black — maximum contrast
        },

        bcolors: [
            '#FFFFFF',  // white  — primary
            '#00AAFF',  // blue   — rand
            '#FF6600',  // orange — env
            '#00CC66',  // green  — sample
            '#00CCAA',  // mint   — morph
            '#FF4400',  // red    — shapes
            '#888888',  // grey
            '#444444',  // dark grey
        ],

        busColors: [
            '#3D3D3D',
            '#FFFFFF',
            '#00AAFF',
            '#FF6600',
            '#00CC66',
            '#00CCAA',
            '#FF4400',
            '#888888',
        ],

        swatches: ['#000000', '#1A1A1A', '#FFFFFF', '#00AAFF', '#FF4400'],
    },
    obsidian: {
        name: 'Obsidian',
        vars: {
            // ── BACKGROUNDS ──────────────────────────────────────────
            // Ultra-dark with the faintest violet undertone — reads as premium
            // without looking "themed". Think iZotope, FabFilter, Arturia.
            '--bg-app': '#0A0A10',
            '--bg-panel': '#121218',
            '--bg-cell': '#1A1A22',
            '--bg-cell-hover': '#22222C',
            '--bg-inset': '#06060A',

            // ── BORDERS ───────────────────────────────────────────────
            // Barely-there edges — structure comes from elevation, not lines.
            '--border': '#28283A',
            '--border-strong': '#383850',
            '--border-focus': '#8070FF',  // violet focus ring — instant premium signal

            // ── TEXT ──────────────────────────────────────────────────
            '--text-primary': '#ECEAF4',  // cool white with a hint of lavender
            '--text-secondary': '#8884A0',
            '--text-muted': '#6A6680',
            '--input-text': '#ECEAF4',

            // ── ACCENT ────────────────────────────────────────────────
            // Electric violet — the color that screams "this plugin costs $200".
            // Sits between FabFilter's orange and iZotope's blue — owns its lane.
            '--accent': '#8070FF',
            '--accent-hover': '#9688FF',
            '--accent-light': 'rgba(128,112,255,0.08)',
            '--accent-border': 'rgba(128,112,255,0.28)',

            // ── STATUS ────────────────────────────────────────────────
            '--midi-dot': '#50E880',  // clean bright green — unmistakable signal

            '--locked-bg': 'rgba(255,56,80,0.10)',
            '--locked-border': 'rgba(255,56,80,0.30)',
            '--locked-icon': '#FF3850',

            '--auto-lock-bg': 'rgba(255,190,40,0.08)',
            '--auto-lock-border': 'rgba(255,190,40,0.24)',

            // ── MODE COLORS ───────────────────────────────────────────
            // Luminous, slightly neon — pop hard on the dark base but stay
            // refined because the base is near-black, not mid-grey.
            '--rand-color': '#4CB0FF',   // crisp sky blue
            '--env-color': '#FF9030',    // warm amber-orange
            '--sample-color': '#50E880', // vivid green
            '--morph-color': '#30D8C0',  // electric cyan-mint
            '--shapes-color': '#FF4060', // hot pink-red — the "danger" color

            '--thumb-color': '#8884A0',

            // ── KNOBS ─────────────────────────────────────────────────
            '--knob-track': '#1A1A22',
            '--knob-value': '#8070FF',   // violet arc — the hero element
            '--knob-dot': '#ECEAF4',

            // ── PLUGIN CARD ───────────────────────────────────────────
            '--pf-bg': '#0A0A10',
            '--pf-border': '#28283A',
            '--pf-text': '#6A6680',

            '--ph-bg': '#0A0A10',
            '--ph-border': '#28283A',
            '--ph-text': '#ECEAF4',

            // ── LINKED KNOBS (mode-tinted dark bg) ───────────────────
            '--lk-rand-track': '#0C1420', '--lk-rand-value': '#4CB0FF', '--lk-rand-dot': '#70C2FF',
            '--lk-env-track': '#1C1208', '--lk-env-value': '#FF9030', '--lk-env-dot': '#FFA858',
            '--lk-smp-track': '#0A1C10', '--lk-smp-value': '#50E880', '--lk-smp-dot': '#70F098',
            '--lk-morph-track': '#081C1A', '--lk-morph-value': '#30D8C0', '--lk-morph-dot': '#58E4D0',
            '--lk-shapes-track': '#1C0810', '--lk-shapes-value': '#FF4060', '--lk-shapes-dot': '#FF6880',

            // ── SOURCE INDICATORS ─────────────────────────────────────
            '--si-rand-bg': 'rgba(76,176,255,0.10)',
            '--si-env-bg': 'rgba(255,144,48,0.10)',
            '--si-smp-bg': 'rgba(80,232,128,0.10)',
            '--si-morph-bg': 'rgba(48,216,192,0.10)',
            '--si-shapes-bg': 'rgba(255,64,96,0.10)',

            // ── FIRE BUTTON ───────────────────────────────────────────
            '--fire-text': '#FFFFFF',
            '--fire-active-bg': '#8070FF',

            // ── ARC / RANGE ───────────────────────────────────────────


            // ── SLIDER ────────────────────────────────────────────────
            '--slider-track': '#28283A',
            '--slider-thumb': '#8070FF',

            // ── PARAM BAR ─────────────────────────────────────────────
            '--bar-track': '#0A0A10',
            '--bar-fill': '#8070FF',

            // ── CARD BUTTONS ──────────────────────────────────────────
            '--card-btn-bg': '#0A0A10',
            '--card-btn-border': '#28283A',
            '--card-btn-text': '#6A6680',
            '--card-btn-hover': '#121218',

            // ── SNAP RING ─────────────────────────────────────────────
            '--snap-ring-color': '#8070FF',
            '--snap-ring-opacity': '0.55',

            // ── LANE / AUTOMATION ─────────────────────────────────────
            '--lane-color': '#8070FF',                    // violet curve — looks incredible on dark bg
            '--lane-grid': 'rgba(236,234,244,0.04)',
            '--lane-grid-label': 'rgba(236,234,244,0.16)',
            '--lane-playhead': 'rgba(236,234,244,0.85)',
            '--lane-active': '#50E880',                   // green handle pops against violet

            // ── RANGE ARC ─────────────────────────────────────────────
            '--range-arc': '#4CB0FF',

            // ── SCROLLBAR ─────────────────────────────────────────────
            '--scrollbar-thumb': '#383850',
            '--scrollbar-track': 'transparent',

            // ── BUS CONTROLS ──────────────────────────────────────────
            '--bus-mute-bg': '#D02040', '--bus-mute-text': '#FFFFFF',
            '--bus-solo-bg': '#D8AE20', '--bus-solo-text': '#000000',
            '--bus-group-tint': '10%',
            '--bus-header-tint': '18%',
            '--bus-badge-text': '#000000',

            // ── TOASTS ────────────────────────────────────────────────
            '--toast-success-bg': 'linear-gradient(135deg,#081C10,#040E08)',
            '--toast-success-border': '#50E880',
            '--toast-error-bg': 'linear-gradient(135deg,#1C080C,#100406)',
            '--toast-error-border': '#FF4060',
            '--toast-info-bg': 'linear-gradient(135deg,#0E0E18,#08080E)',
            '--toast-info-border': '#8070FF',
            '--toast-text': '#ECEAF4',

            '--preset-flash-color': '#8070FF',
            '--preset-flash-glow': 'rgba(128,112,255,0.45)',
        },

        bcolors: [
            '#ECEAF4',  // cool white — primary
            '#4CB0FF',  // sky blue — rand
            '#FF9030',  // amber — env
            '#50E880',  // vivid green — sample
            '#30D8C0',  // cyan-mint — morph
            '#FF4060',  // hot pink-red — shapes
            '#6A6680',  // muted lavender-grey
            '#383850',  // deep slate
        ],

        busColors: [
            '#383850',
            '#ECEAF4',
            '#4CB0FF',
            '#FF9030',
            '#50E880',
            '#30D8C0',
            '#FF4060',
            '#6A6680',
        ],

        swatches: ['#0A0A10', '#1A1A22', '#8070FF', '#50E880', '#FF4060'],
    },
    deep_forest: {
        name: 'Deep Forest',
        vars: {
            // ── BACKGROUNDS ──────────────────────────────────────────
            '--bg-app': '#080F0A',  // L0 — near black, strong green cast
            '--bg-panel': '#101A12',  // L1 — first visible green
            '--bg-cell': '#162214',  // L2 — clearly dark green
            '--bg-cell-hover': '#1C2C1E',  // L3 — perceptibly lighter
            '--bg-inset': '#050A06',  // L4 — deepest well

            // ── BORDERS ───────────────────────────────────────────────
            // Structure comes from elevation, not drawn lines.
            '--border': '#1A2A1C',  // subtle green-tinted edge
            '--border-strong': '#2E4830',  // emphasized separators
            '--border-focus': '#D4B86A',  // gold focus ring

            // ── TEXT ──────────────────────────────────────────────────
            '--text-primary': '#E8F0E8',  // 15.32:1 on panel ✅ — slightly green-white
            '--text-secondary': '#7A9E7E',  //  5.96:1 on panel ✅ — muted forest green
            '--text-muted': '#6E9472',  //  5.21:1 panel, 4.82:1 cell ✅
            '--input-text': '#E8F0E8',

            // ── ACCENT ────────────────────────────────────────────────
            // Warm gold — the only warm color on a cold green surface.
            // Draws the eye exactly as a VU needle does on a dark panel.
            '--accent': '#D4B86A',  // 9.22:1 ✅
            '--accent-hover': '#E8CC88',
            '--accent-light': 'rgba(212,184,106,0.12)',
            '--accent-border': 'rgba(212,184,106,0.32)',

            // ── STATUS ────────────────────────────────────────────────
            '--midi-dot': '#44DD88',  // bright signal green — 10.13:1 ✅

            '--locked-bg': 'rgba(255,68,68,0.12)',
            '--locked-border': 'rgba(255,68,68,0.32)',
            '--locked-icon': '#FF4444',  // 5.23:1 ✅

            '--auto-lock-bg': 'rgba(212,165,0,0.10)',
            '--auto-lock-border': 'rgba(212,165,0,0.28)',

            // ── MODE COLORS ───────────────────────────────────────────
            // Five hues chosen to be distinct from each other AND
            // from the dark green surfaces. No green mode color —
            // the entire UI is green.
            '--rand-color': '#44AAFF',  // 7.16:1 — electric blue (clearly non-green)
            '--env-color': '#E87020',  // 5.74:1 — burn orange
            '--sample-color': '#2ECCAA',  // 8.77:1 — seafoam (green-shifted, data family)
            '--morph-color': '#44CCAA',  // 8.77:1 — seafoam teal
            '--shapes-color': '#E85030',  // 5.54:1 — warm red

            '--thumb-color': '#7A9E7E',

            // ── KNOBS ─────────────────────────────────────────────────
            '--knob-track': '#162214',  // matches bg_cell — sunken
            '--knob-value': '#D4B86A',  // gold arc
            '--knob-dot': '#E8CC88',  // bright gold tip

            // ── PLUGIN CARD ───────────────────────────────────────────
            '--pf-bg': '#080F0A',  // card chrome = L0, recedes maximally
            '--pf-border': '#1A2A1C',
            '--pf-text': '#7A9E7E',  // 6.48:1 on pf-bg ✅

            '--ph-bg': '#080F0A',
            '--ph-border': '#1A2A1C',
            '--ph-text': '#E8F0E8',  // 16.59:1 ✅

            // ── LINKED KNOBS (mode-tinted dark green bg) ─────────────
            '--lk-rand-track': '#10242C', '--lk-rand-value': '#44AAFF', '--lk-rand-dot': '#6DBCFF',
            '--lk-env-track': '#271C0D', '--lk-env-value': '#E87020', '--lk-env-dot': '#ED8F51',
            '--lk-smp-track': '#0D2920', '--lk-smp-value': '#2ECCAA', '--lk-smp-dot': '#5BD7BC',
            '--lk-morph-track': '#0D2920', '--lk-morph-value': '#44CCAA', '--lk-morph-dot': '#66DDBB',
            '--lk-shapes-track': '#2A1008', '--lk-shapes-value': '#E85030', '--lk-shapes-dot': '#F07850',

            // ── SOURCE INDICATORS ─────────────────────────────────────
            '--si-rand-bg': 'rgba(68,170,255,0.14)',
            '--si-env-bg': 'rgba(232,112,32,0.14)',
            '--si-smp-bg': 'rgba(46,204,170,0.14)',
            '--si-morph-bg': 'rgba(68,204,170,0.14)',
            '--si-shapes-bg': 'rgba(255,85,128,0.14)',

            // ── FIRE BUTTON ───────────────────────────────────────────
            '--fire-text': '#080F0A',  // 10.03:1 on gold ✅
            '--fire-active-bg': '#D4B86A',

            // ── ARC / RANGE ───────────────────────────────────────────


            // ── SLIDER ────────────────────────────────────────────────
            '--slider-track': '#1C2C1E',
            '--slider-thumb': '#7A9E7E',

            // ── PARAM BAR ─────────────────────────────────────────────
            '--bar-track': '#080F0A',
            '--bar-fill': '#B89A50',  // slightly deeper gold

            // ── CARD BUTTONS ──────────────────────────────────────────
            '--card-btn-bg': '#080F0A',
            '--card-btn-border': '#1A2A1C',
            '--card-btn-text': '#6E9472',
            '--card-btn-hover': '#101A12',

            // ── SNAP RING ─────────────────────────────────────────────
            '--snap-ring-color': '#D4B86A',
            '--snap-ring-opacity': '0.50',

            // ── LANE / AUTOMATION ─────────────────────────────────────
            // Canvas bg is bg_cell — dark green content area.
            // Lane curve: warm gold so it reads as the actively drawn data,
            // distinct from the green surface. Playhead: near-white max brightness.
            '--lane-color': '#D4B86A',               // gold curve — data on green
            '--lane-grid': 'rgba(232,240,232,0.05)',
            '--lane-grid-label': 'rgba(232,240,232,0.20)',
            '--lane-playhead': 'rgba(255,255,255,0.88)', // brightest element when playing
            '--lane-active': '#44DD88',                // bright green handle — status color

            // ── RANGE ARC ─────────────────────────────────────────────
            '--range-arc': '#44AAFF',

            // ── SCROLLBAR ─────────────────────────────────────────────
            '--scrollbar-thumb': '#2E4830',
            '--scrollbar-track': 'transparent',

            // ── BUS CONTROLS ──────────────────────────────────────────
            '--bus-mute-bg': '#C62828', '--bus-mute-text': '#FFFFFF',  // 5.62:1 ✅
            '--bus-solo-bg': '#D4A500', '--bus-solo-text': '#000000',  // 9.18:1 ✅
            '--bus-group-tint': '12%',
            '--bus-header-tint': '20%',
            '--bus-badge-text': '#080F0A',

            // ── TOASTS ────────────────────────────────────────────────
            '--toast-success-bg': 'linear-gradient(135deg,#0A1E0E,#060E08)',
            '--toast-success-border': '#44DD88',
            '--toast-error-bg': 'linear-gradient(135deg,#240808,#140404)',
            '--toast-error-border': '#FF4444',
            '--toast-info-bg': 'linear-gradient(135deg,#0E1A10,#080F0A)',
            '--toast-info-border': '#D4B86A',
            '--toast-text': '#E8F0E8',

            '--preset-flash-color': '#44DD88',
            '--preset-flash-glow': 'rgba(68,221,136,0.40)',
            '--drag-highlight': '#44DD88',
        },

        bcolors: [
            '#D4B86A',  // gold    — accent
            '#44AAFF',  // blue    — rand
            '#E87020',  // orange  — env
            '#2ECCAA',  // mint    — sample
            '#44CCAA',  // teal   — morph
            '#E85030',  // red    — shapes
            '#44DD88',  // green   — active/status
            '#7A9E7E',  // muted   — neutral
        ],

        busColors: [
            '#2E4830',  // dark green neutral
            '#D4B86A',  // gold
            '#44AAFF',  // blue
            '#E87020',  // orange
            '#2ECCAA',  // mint
            '#44CCAA',  // teal
            '#E85030',  // red
            '#44DD88',  // bright green
        ],

        swatches: ['#080F0A', '#162214', '#E8F0E8', '#D4B86A', '#44AAFF'],
    }
};

var currentTheme = 'medical_vintage';

function applyTheme(themeId) {
    var t = THEMES[themeId];
    if (!t) return;
    currentTheme = themeId;
    var root = document.documentElement;
    for (var k in t.vars) { root.style.setProperty(k, t.vars[k]); }
    BCOLORS = t.bcolors;
    if (t.busColors) BUS_COLORS = t.busColors;

    // Inject dynamic slider styles — WebView2 pseudo-elements don't reliably
    // inherit CSS custom properties, so we write hardcoded color values.
    // This is now the SOLE source of slider track/thumb styling.
    var sTrack = t.vars['--slider-track'] || t.vars['--border'] || '#555';
    var sThumb = t.vars['--slider-thumb'] || t.vars['--thumb-color'] || '#ccc';
    var sAccent = t.vars['--accent'] || '#E8A244';
    var sAccentL = t.vars['--accent-light'] || 'rgba(232,162,68,0.20)';
    var dynEl = document.getElementById('dyn-slider');
    if (!dynEl) {
        dynEl = document.createElement('style');
        dynEl.id = 'dyn-slider';
        document.head.appendChild(dynEl);
    }
    dynEl.textContent =
        // Track — 4px for visibility
        'input[type="range"]::-webkit-slider-runnable-track{' +
        'height:4px;background:' + sTrack + ';border-radius:2px}' +
        // Thumb — 14px circle with shadow for visibility
        'input[type="range"]::-webkit-slider-thumb{' +
        '-webkit-appearance:none;width:14px;height:14px;' +
        'background:' + sThumb + ';' +
        'border:2px solid ' + sTrack + ';' +
        'border-radius:50%;cursor:pointer;margin-top:-5px;' +
        'box-shadow:0 1px 3px rgba(0,0,0,0.3);' +
        'transition:border-color 80ms,box-shadow 80ms}' +
        // Hover — accent border + glow
        'input[type="range"]::-webkit-slider-thumb:hover{' +
        'border-color:' + sAccent + ';' +
        'box-shadow:0 1px 3px rgba(0,0,0,0.3),0 0 0 2px ' + sAccentL + '}' +
        // Active — stronger glow
        'input[type="range"]:active::-webkit-slider-thumb{' +
        'border-color:' + sAccent + ';' +
        'box-shadow:0 1px 3px rgba(0,0,0,0.3),0 0 0 3px ' + sAccentL + '}';

    // Update rendered blocks/plugins with new colors
    if (typeof renderBlocks === 'function') renderBlocks();
    if (typeof renderAllPlugins === 'function') renderAllPlugins();
    // Render theme cards to update active state
    renderThemeGrid();
    if (typeof saveUiStateToHost === 'function') saveUiStateToHost();
}

function renderThemeGrid() {
    var grid = document.getElementById('themeGrid');
    if (!grid) return;
    var defTheme = null;
    try { defTheme = localStorage.getItem('mrDefaultTheme'); } catch (e) { }
    var h = '';
    for (var id in THEMES) {
        var t = THEMES[id];
        h += '<div class="theme-card' + (currentTheme === id ? ' active' : '') + '" data-theme="' + id + '">';
        h += '<div class="theme-swatch">';
        for (var si = 0; si < t.swatches.length; si++) {
            h += '<span style="background:' + t.swatches[si] + '"></span>';
        }
        h += '</div>';
        h += '<span class="theme-name">' + t.name + '</span>';
        if (id === defTheme) {
            h += '<span class="theme-default-badge" title="Default theme">★</span>';
        }
        h += '</div>';
    }
    grid.innerHTML = h;
    grid.querySelectorAll('.theme-card').forEach(function (card) {
        card.onclick = function () {
            applyTheme(this.getAttribute('data-theme'));
        };
    });
}

// Load default theme from localStorage (used for new instances before restoreFromHost runs)
(function () {
    var def = null;
    try { def = localStorage.getItem('mrDefaultTheme'); } catch (e) { }
    if (def && THEMES[def]) currentTheme = def;
})();

// Settings panel toggle
(function () {
    var btn = document.getElementById('settingsBtn');
    var drop = document.getElementById('settingsDrop');
    btn.onclick = function (e) {
        e.stopPropagation();
        drop.classList.toggle('vis');
        if (drop.classList.contains('vis') && typeof renderSettingsScanPaths === 'function') {
            renderSettingsScanPaths();
        }
    };
    document.addEventListener('click', function (e) {
        if (!drop.contains(e.target) && e.target !== btn) {
            drop.classList.remove('vis');
        }
    });

    // Make Default button
    var defBtn = document.getElementById('themeDefaultBtn');
    if (defBtn) {
        defBtn.onclick = function (e) {
            e.stopPropagation();
            try { localStorage.setItem('mrDefaultTheme', currentTheme); } catch (ex) { }
            renderThemeGrid();
            if (typeof showToast === 'function') {
                showToast(THEMES[currentTheme].name + ' set as default theme', 'success');
            }
        };
    }

    renderThemeGrid();
    // Apply the default theme CSS vars on load — without this, variables.css defaults show (Earthy)
    // Only inject vars; skip renderBlocks/renderAllPlugins/save — those aren't ready yet
    // and restoreFromHost will call applyTheme() again with the user's saved preference
    var _initTheme = THEMES[currentTheme];
    if (_initTheme) {
        var root = document.documentElement;
        for (var k in _initTheme.vars) root.style.setProperty(k, _initTheme.vars[k]);
        BCOLORS = _initTheme.bcolors;
        if (_initTheme.busColors) BUS_COLORS = _initTheme.busColors;

        // Inject dynamic slider styles immediately — WebView2 pseudo-elements
        // don't resolve CSS custom properties, so we must write hardcoded colors.
        // Without this, sliders appear unstyled until the user clicks a theme.
        var sTrack = _initTheme.vars['--slider-track'] || _initTheme.vars['--border'] || '#555';
        var sThumb = _initTheme.vars['--slider-thumb'] || _initTheme.vars['--thumb-color'] || '#ccc';
        var sAccent = _initTheme.vars['--accent'] || '#E8A244';
        var sAccentL = _initTheme.vars['--accent-light'] || 'rgba(232,162,68,0.20)';
        var dynEl = document.getElementById('dyn-slider');
        if (!dynEl) {
            dynEl = document.createElement('style');
            dynEl.id = 'dyn-slider';
            document.head.appendChild(dynEl);
        }
        dynEl.textContent =
            'input[type="range"]::-webkit-slider-runnable-track{' +
            'height:4px;background:' + sTrack + ';border-radius:2px}' +
            'input[type="range"]::-webkit-slider-thumb{' +
            '-webkit-appearance:none;width:14px;height:14px;' +
            'background:' + sThumb + ';' +
            'border:2px solid ' + sTrack + ';' +
            'border-radius:50%;cursor:pointer;margin-top:-5px;' +
            'box-shadow:0 1px 3px rgba(0,0,0,0.3);' +
            'transition:border-color 80ms,box-shadow 80ms}' +
            'input[type="range"]::-webkit-slider-thumb:hover{' +
            'border-color:' + sAccent + ';' +
            'box-shadow:0 1px 3px rgba(0,0,0,0.3),0 0 0 2px ' + sAccentL + '}' +
            'input[type="range"]:active::-webkit-slider-thumb{' +
            'border-color:' + sAccent + ';' +
            'box-shadow:0 1px 3px rgba(0,0,0,0.3),0 0 0 3px ' + sAccentL + '}';
    }
})();

// Help panel moved to help_panel.js

// Expose button toggle
(function () {
    var btn = document.getElementById('exposeBtn');
    if (btn) {
        btn.onclick = function (e) {
            e.stopPropagation();
            // Close settings dropdown if open
            var sd = document.getElementById('settingsDrop');
            if (sd) sd.classList.remove('vis');
            // Toggle expose dropdown
            var existing = document.getElementById('exposeDrop');
            if (existing) {
                closeExposeDropdown();
            } else {
                openExposeDropdown(btn);
            }
        };
    }
})();
