# UI Specification v5 — Modular Randomizer

## Design Evolution (v4 → v5)

### Problems Solved
1. **Single plugin only** — v4 supported one loaded plugin. v5 supports **multiple plugin instances** as collapsible, reorderable cards
2. **No plugin discovery** — v4 used a dropdown. v5 has a **Plugin Browser modal** with search, category filtering, and scan path config
3. **No drag-and-drop** — Plugin cards can now be **dragged to reorder** within the left panel
4. **Range mode inflexible** — Added **Relative mode** (±% from current value) alongside Absolute mode
5. **Color consistency** — Block colors are now **persistent** via stored `colorIdx`, not positional

---

## Architecture: Multi-Plugin Two-Panel Rack

```
┌─────────────────────────────────────────────────────────────┐
│ HEADER                                       [⏻] [Mix ═●═] │  38px
├────────────────────┬────────────────────────────────────────┤
│  PLUGIN BLOCKS     │          LOGIC BLOCKS                  │
│  [+ Plugin]        │          (scrollable)                  │
│                    │                                        │
│  ┌─ Serum ───────┐ │  ┌─ Block 1 (Randomize) ────────────┐ │
│  │ ▶ 26 params   x│ │  │ ● Assign  Mode  Trigger  Range   │ │
│  │  [Filter...]   │ │  │   Abs/Rel  Quantize  Movement    │ │
│  │  Osc A Wave 25%│ │  │   Targets (3)  [FIRE]            │ │
│  │  Osc A Semi 50%│ │  └──────────────────────────────────┘ │
│  │  Filter Cut 65%│ │  ┌─ Block 2 (Envelope) ─────────────┐ │
│  │  ...           │ │  │ ○ Assign  Meter  Response         │ │
│  └────────────────┘ │  │   Mapping  Targets                │ │
│  ┌─ Vital ───────┐ │  └──────────────────────────────────┘ │
│  │ ▶ 25 params   x│ │                                      │
│  │  [Filter...]   │ │  [+ Randomizer]  [+ Envelope]        │
│  │  ...           │ │                                      │
│  └────────────────┘ │                                      │
│  (drag to reorder)  │                                      │
├────────────────────┴────────────────────────────────────────┤
│ STATUS: • Serum · 51 params · 2 locked · 2 blocks · MIDI ENV│  22px
└─────────────────────────────────────────────────────────────┘
```

---

## Window

- **Size**: 960 × 640px (fixed, not resizable)
- **Framework**: WebView2
- **Fonts**: Inter (UI), JetBrains Mono (values)

---

## Color System

### CSS Variables
| Variable | Value | Usage |
|:---|:---|:---|
| `--bg-app` | `#F0F0F0` | Background |
| `--bg-panel` | `#FAFAFA` | Panel backgrounds |
| `--bg-cell` | `#FFF` | Cards, rows |
| `--bg-cell-hover` | `#F5F5F5` | Hover states |
| `--bg-inset` | `#E8E8E8` | Recessed areas |
| `--border` | `#DEDEDE` | Default borders |
| `--border-strong` | `#C0C0C0` | Prominent borders |
| `--accent` | `#FF5500` | Primary accent (orange) |
| `--accent-light` | `#FFF0E6` | Hover highlight |
| `--env-color` | `#22AAFF` | Envelope accent (blue) |
| `--locked-bg` | `#FFF0F0` | Locked parameter bg |
| `--midi-dot` | `#33CC33` | MIDI activity |

### Block Colors (persistent per block)
```
#FF5500, #22AAFF, #33CC33, #CC33CC, #CCAA00, #CC5533, #3388CC, #88AA33
```
Stored on each block as `colorIdx`, not derived from array position.

---

## Header (38px)

```
[■ brand-mark] MODULAR RANDOMIZER  |  [⏻ bypass]  [Mix ═●═ 100%]
```

- **Brand mark**: 10×10px orange square
- **Brand name**: 11px, 700 weight, 1px letter-spacing
- **Bypass button**: Toggle, `.on` class adds orange border
- **Mix slider**: Range 0–100%, labeled

---

## Left Panel — Plugin Blocks (240px wide)

### Header Bar
- Title: "Plugin Blocks"
- Button: `+ Plugin` → opens Plugin Browser Modal

### Assign Banner
- Appears when assign mode is active
- Shows: "Assigning to Block N (mode)"
- Background/border/text in block's color

### Plugin Cards (`.pcard`)
Each loaded plugin renders as a collapsible card:

```
┌───────────────────────────┐
│ ▶  Serum   26 params [Ed][x]│  ← header (grab to drag)
├───────────────────────────┤
│ [Filter...                ]│  ← per-card search
├───────────────────────────┤
│ Osc A Wave    ●○    25%  ═│  ← parameter rows
│ Osc A Semi     ○    50%  ═│
│ Filter Cutoff  ●    65%  ═│
│ Master Volume  🔒   80%  ═│  ← auto-locked
│ ...                       │
└───────────────────────────┘
```

#### Card Header
- **Chevron**: `▶` collapsed, `▼` expanded (90° rotation)
- **Name**: Plugin name (e.g. "Serum"), 10px/600
- **Info**: Param count, 9px muted
- **Ed button**: Opens plugin editor (future)
- **Close (×)**: Removes plugin, deletes its params from all block targets
- **Drag handle**: Header is `cursor: grab`, card is `draggable="true"`

#### Card Body (collapsible)
- **Search input**: Filters parameter list by name
- **Parameter area**: `max-height: 180px`, scrollable
  - Custom 3px scrollbar

#### Parameter Rows (`.pr`)
| Element | Details |
|:---|:---|
| Name | 10px, flex: 1 |
| Color dots | One per connected block, uses block's persistent color |
| Value | Mono font, right-aligned, e.g. "65%" |
| Value bar | 3px height, orange fill |
| Lock icon | 🔒 for manual lock, ⚠ for auto-lock |

#### Parameter States
- **Default**: White bg, grey border
- **Hover (assign mode)**: `assign-highlight` class
- **Assigned (to active block)**: Block color bg at 10% opacity, border at 40%
- **Locked**: `.locked` class, muted text, no interaction

#### Parameter Interactions
- **Left-click** (during assign mode): Toggle param in active block's target set
- **Right-click**: Context menu → Lock / Unlock
- **Click during no assign mode**: No action (prevents accidental changes)

### Drag-and-Drop Reordering
- Cards are `draggable="true"` with `data-plugidx` for position
- **Drag feedback**: Source card at 40% opacity, 97% scale
- **Drop indicator**: 2px accent line at top or bottom of target card
- **Drop logic**: Uses mouse Y vs card midpoint to determine insertion direction
- Reorders the `pluginBlocks` array and re-renders

### Parameter ID Format
Parameters are scoped to their plugin: `"{pluginId}:{paramIndex}"` (e.g. `"1:5"`)

---

## Right Panel — Logic Blocks (flex: 1)

### Header Bar
- Title: "Logic Blocks"
- Info: "N blocks" count

### Block Cards (`.lcard`)
Each logic block renders as an expandable card:

```
┌─────────────────────────────────────────┐
│ ▶  ● Block 1   Manual / Instant / 3  [Assign] [×] │  ← header
├─────────────────────────────────────────┤
│ Mode:     [Randomize] [Envelope]        │
│ Trigger:  [Manual] [Tempo] [MIDI] [Audio]│
│ Range:    [Absolute] [Relative]         │
│   Min  ═══●══  25%                      │
│   Max  ══════●  80%                     │
│ Quantize: ○ off   steps: 12            │
│ Movement: [Instant] [Smooth]            │
│ Targets (3):                            │
│  [Serum: Osc A Wave ×] [Serum: Cutoff ×]│
│ [FIRE]                                  │
└─────────────────────────────────────────┘
```

#### Card Header
- Chevron (expand/collapse)
- Color indicator dot (using persistent `colorIdx`)
- Title: "Block N" (sequential, 1-indexed by position)
- Summary: `{trigger} / {movement} / {targetCount} params`
- **Assign button**: Enters/exits assign mode for this block
  - Active state: filled with block color
- **Close (×)**: Removes block

#### Mode Selector
- Segmented: **Randomize** | **Envelope**
- Randomize → orange active
- Envelope → blue active

### Randomize Block Body

#### Trigger Section
Segmented: **Manual** | **Tempo** | **MIDI** | **Audio**

Sub-controls per selection:
- **Manual**: No sub-controls
- **Tempo**: Division dropdown (1/1, 1/2, 1/4, 1/8, 1/16, 1/32)
- **MIDI**: Mode dropdown (Any Note, Specific Note, CC)
  - Specific Note → note display + slider (0–127)
  - CC → CC# input
  - Velocity scales toggle
- **Audio**: Threshold slider (-60 to 0 dB)

#### Range Section
Segmented mode toggle: **Absolute** | **Relative**

- **Absolute mode**:
  - Min slider: 0–100%
  - Max slider: 0–100%
- **Relative mode**:
  - ± slider: 1–100% (offset from current value)

#### Quantize
- Toggle + step count input (2–128)
- Input disabled when toggle is off

#### Movement
Segmented: **Instant** | **Smooth**
- Smooth → Glide time slider (1–2000ms)

#### Targets
- Tag box showing assigned parameters
- Each tag: `"{pluginName}: {paramName}" [×]` in block color
- Shows first 6, overflow counter for remainder
- Empty state: "No params assigned"

#### FIRE Button
- Full-width orange, uppercase
- Flash animation on click
- Flashes MIDI status dot

### Envelope Follower Block Body

#### Level Meter
- Vertical bar, blue fill from bottom
- Real-time percentage label
- Pulsing dot in header when active

#### Response
- Attack slider: 1–500ms
- Release slider: 1–2000ms

#### Mapping
- Gain slider: 0–100%
- Min/Max range sliders: 0–100%
- Invert toggle

#### Targets
- Same tag box as Randomize blocks

#### No FIRE button (always active)

---

## Plugin Browser Modal

Opens when "+ Plugin" is clicked. Centered overlay with dimmed background.

```
┌──────────────────────────────────────────────┐
│ Plugin Browser                           [×] │
├──────────────────────────────────────────────┤
│ [Search plugins...          ] [All][Syn][FX] │
│                               [Smp][Util]    │
├──────────────────────────────────────────────┤
│ ⚙ VST3 Scan Paths (collapsible)             │
│   [C:\Program Files\Common Files\VST3] [×]   │
│   [C:\Program Files\VSTPlugins        ] [×]   │
│   [+ Add Path]                               │
├──────────────────────────────────────────────┤
│ [Se] Serum                          [SYNTH]  │
│      Xfer Records · 26 params               │
│ [Vi] Vital                          [SYNTH]  │
│      Matt Tytel · 25 params                 │
│ [VR] Valhalla Room                  [FX]     │
│      Valhalla DSP · 10 params               │
│ [Ko] Kontakt 7                      [SAMPLER]│
│      Native Instruments · 12 params         │
│ ...                                          │
├──────────────────────────────────────────────┤
│ 21 plugins found               [⚙ Scan Paths]│
└──────────────────────────────────────────────┘
```

### Modal Components
- **Search**: Filters by plugin name or vendor
- **Category tabs**: All / Synths / FX / Samplers / Utility
  - Color-coded badges: blue (synth), purple (fx), green (sampler), orange (utility)
- **Plugin rows**: Icon (2-letter initials), name, vendor + param count, category badge
  - Click → loads plugin, closes modal
- **Scan Paths panel**: Toggled via ⚙ button in footer
  - Editable path list with add/remove
  - In production: triggers `juce::PluginDirectoryScanner`
- **Footer**: Result count + scan paths toggle
- **Close**: × button or click overlay backdrop

### Plugin Library Data Structure
```javascript
{
    name: 'Serum',
    vendor: 'Xfer Records',
    cat: 'synth',     // synth | fx | sampler | utility
    params: ['Osc A Wave', 'Osc A Semi', ...]
}
```

In production, this array is populated by scanning VST3 folders using `juce::KnownPluginList`.

---

## Context Menu

Right-click on any parameter → shows at cursor position:
- **Lock**: Locks param, removes from all block targets
- **Unlock**: Unlocks param (hidden if auto-locked)

---

## Status Bar (22px)

```
● Serum  ·  51 params  ·  2 locked  ·  2 blocks  ·  120 BPM  ·  ● MIDI  ·  ● ENV
```

| Element | Behavior |
|:---|:---|
| Plugin dot | Always green |
| Param count | Total across all loaded plugins |
| Lock count | Params with `lk` or `alk` true |
| Block count | Total logic blocks |
| BPM | From DAW host (static in mockup) |
| MIDI dot | Green flash on MIDI trigger |
| ENV dot | Blue when any envelope block is processing |

---

## Data Model

### Plugin Blocks Array
```javascript
pluginBlocks = [
    {
        id: 1,                    // Unique, incrementing
        name: 'Serum',            // Plugin name
        params: [                 // Parameter objects
            { id: '1:0', name: 'Osc A Wave', v: 0.25, lk: false, alk: false },
            { id: '1:1', name: 'Osc A Semi', v: 0.50, lk: false, alk: false },
            // ...
            { id: '1:24', name: 'Master Volume', v: 0.80, lk: true, alk: true }
        ],
        expanded: true,           // Collapse state
        searchFilter: ''          // Per-card filter string
    },
    // ... more plugin blocks
]
```

### Logic Blocks Array
```javascript
blocks = [
    {
        id: 1,                    // Unique, incrementing
        mode: 'randomize',        // 'randomize' | 'envelope'
        targets: new Set(),       // Set of param IDs (e.g. '1:5', '2:3')
        colorIdx: 0,              // Persistent color index into BCOLORS
        trigger: 'manual',        // 'manual' | 'tempo' | 'midi' | 'audio'
        beatDiv: '1/4',
        midiMode: 'any_note',
        midiNote: 60,
        midiCC: 1,
        velScale: false,
        threshold: -12,
        rMin: 0, rMax: 100,
        rangeMode: 'absolute',    // 'absolute' | 'relative'
        quantize: false,
        qSteps: 12,
        movement: 'instant',      // 'instant' | 'glide'
        glideMs: 200,
        envAtk: 10, envRel: 100,
        envSens: 50, envInvert: false,
        expanded: true
    }
]
```

### Parameter Map
```javascript
PMap = {
    '1:0': { id: '1:0', name: 'Osc A Wave', v: 0.25, lk: false, alk: false },
    '2:3': { id: '2:3', name: 'Osc 2 Position', v: 0.60, lk: false, alk: false },
    // flat lookup by scoped ID
}
```

---

## Randomization Logic

### Absolute Mode
```
value = rMin/100 + random() * (rMax/100 - rMin/100)
```

### Relative Mode
```
value = currentValue + (random() * 2 - 1) * rMax/100
value = clamp(0, 1, value)
```

### Quantize
```
step = 1 / qSteps
value = round(value / step) * step
```

---

## Envelope Follower Logic

- Simulates audio envelope following using attack/release smoothing
- Attack coefficient: `exp(-1 / (atk * 0.03))`
- Release coefficient: `exp(-1 / (rel * 0.03))`
- Maps envelope value to parameter range: `v = min + mapped * (max - min)`
- Invert: `mapped = 1 - envValue`
- **In-place DOM updates** for performance (no full re-render at 30fps)

---

## JUCE Implementation Map

### File Structure
```
plugins/ModularRandomizer/
├── Source/
│   ├── PluginProcessor.h/cpp     → AudioProcessor, plugin hosting, param relay
│   ├── PluginEditor.h/cpp        → WebBrowserComponent setup
│   └── PluginHost.h/cpp          → VST3 hosting via juce::AudioPluginFormatManager
├── ui/
│   ├── index.html                → Main UI (from v5-test.html)
│   ├── style.css                 → Extracted styles
│   └── app.js                    → Extracted logic
├── Design/
│   ├── v5-ui-spec.md             → This document
│   └── v5-test.html              → Working preview
└── status.json
```

### Critical JUCE Components

| Component | JUCE Class | Purpose |
|:---|:---|:---|
| Plugin hosting | `AudioPluginFormatManager` | Scan and load VST3 plugins |
| Plugin scanning | `PluginDirectoryScanner` | Populate plugin browser list |
| Plugin list | `KnownPluginList` | Store scanned plugin info |
| Plugin instances | `AudioPluginInstance` | Loaded plugin instances |
| Parameter relay | `WebSliderRelay` | Expose hosted plugin params to WebView |
| WebView UI | `WebBrowserComponent` | Render HTML/CSS/JS interface |
| Message bridge | `WebBrowserComponent::Options::addNativeFunction()` | JS ↔ C++ communication |

### WebView ↔ C++ Message Protocol

#### JS → C++ (native functions)
```javascript
// Scan for plugins
window.__JUCE__.scanPlugins({ paths: ['C:\\...\\VST3'] })

// Load a plugin
window.__JUCE__.loadPlugin({ pluginId: 'com.xferrecords.serum', 
                             instanceId: 1 })

// Remove a plugin  
window.__JUCE__.removePlugin({ instanceId: 1 })

// Fire randomization (all param updates sent in batch)
window.__JUCE__.setParams({ params: [
    { instanceId: 1, paramIdx: 5, value: 0.73 },
    { instanceId: 2, paramIdx: 2, value: 0.41 }
]})

// Open plugin editor window
window.__JUCE__.openEditor({ instanceId: 1 })
```

#### C++ → JS (eval)
```javascript
// Plugin scan results
onPluginsScanned([
    { id: 'com.xferrecords.serum', name: 'Serum', vendor: 'Xfer Records',
      category: 'synth', paramCount: 26 }
])

// Plugin loaded — send full param list
onPluginLoaded({
    instanceId: 1,
    name: 'Serum',
    params: [
        { index: 0, name: 'Osc A Wave', value: 0.25, automatable: true },
        // ...
    ]
})

// Real-time param update from DAW automation
onParamChanged({ instanceId: 1, paramIdx: 5, value: 0.68 })

// Audio envelope level (sent at ~30fps)
onEnvelopeLevel({ rms: 0.45 })

// MIDI event
onMidiEvent({ type: 'noteOn', note: 60, velocity: 100 })
```

### Member Declaration Order (Critical)
In `PluginEditor.h`, members MUST be declared in this order:
1. **Relays** (WebSliderRelay instances)
2. **WebView** (WebBrowserComponent)
3. **Attachments** (WebSliderParameterAttachment)

Violating this order causes crashes on plugin unload.

### Implementation Phases

#### Phase 1: Static UI
- Extract v5-test.html into `ui/index.html` + `style.css` + `app.js`
- Verify it loads in WebView with simulated data
- All interactions work with mock data

#### Phase 2: Plugin Hosting
- Implement `PluginHost` class using `AudioPluginFormatManager`
- Scan VST3 directories (user-configurable paths)
- Load/unload plugin instances
- Wire plugin browser modal to real scan results

#### Phase 3: Parameter Bridge
- Enumerate hosted plugin parameters
- Create `WebSliderRelay` for each hosted param
- Bridge parameter changes between WebView JS and hosted plugin
- Handle multi-instance parameter namespacing

#### Phase 4: Trigger Integration
- **Tempo sync**: Use `AudioPlayHead` for host BPM and beat position
- **MIDI trigger**: Process MIDI buffer in `processBlock`
- **Audio trigger**: RMS envelope detection in `processBlock`
- **Manual trigger**: Already works via FIRE button

#### Phase 5: Envelope Follower
- Real-time RMS computation in `processBlock`
- Send envelope level to WebView at ~30fps via timer
- Apply attack/release smoothing in C++
- Map envelope to parameter values

---

## Interactions Summary

| Action | Result |
|:---|:---|
| Click `+ Plugin` | Opens Plugin Browser modal |
| Click plugin in browser | Loads plugin as new card, closes modal |
| Drag plugin card header | Reorders within left panel |
| Click plugin card header | Expand/collapse parameter list |
| Click `×` on plugin card | Remove plugin, clean up all block targets |
| Type in card search | Filters parameter rows by name |
| Right-click parameter | Context menu: Lock/Unlock |
| Click `Assign` on block | Enters assign mode, banner appears |
| Click parameter (assign mode) | Toggles param in block's target set |
| Click `Assign` again / `Done` | Exits assign mode |
| Click `FIRE` | Randomizes all targeted params |
| Change Mode segmented | Switches block between Randomize/Envelope |
| Change Range mode | Toggles Absolute ↔ Relative |
| Drag slider | Updates block setting in real-time |
| Click `×` on target tag | Removes param from block |
| Click `⏻` bypass | Toggles plugin bypass |
| Click `⚙ Scan Paths` | Shows/hides scan path config |
