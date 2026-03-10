# UI Specification v3 — Modular Randomizer

## Design Direction (v2 → v3)
- **Fixed slider styling** — labeled rows (Label + slider + value), no more broken dual overlaps
- **Added Envelope Follower** — continuous audio-reactive modulation as a separate block mode
- **Two block types** — Randomize blocks (discrete triggers) and Envelope blocks (continuous following)
- Maintained light greyscale palette with orange (`#FF5500`) as only accent

---

## Architecture Summary

The plugin is a **host container** that loads an external VST3/AU and provides two types of modulation:

1. **Randomize blocks** — fire discrete random values triggered by manual, tempo, MIDI, or audio threshold
2. **Envelope follower blocks** — continuously map incoming audio amplitude to parameter values

Both block types target the same parameter grid. Multiple blocks of either type can coexist.

---

## Layout

### Global Structure (920 × 620px)

```
┌──────────────────────────────────────────────────────────────┐
│ HEADER              [Plugin Select]  [Open Editor]  [⏻] Mix │  40px
├──────────────────────────────────────────────────────────────┤
│ PARAMETERS                             [Select All] [Clear] │  28px bar
│ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐   │
│ │Osc1│ │Osc1│ │Osc1│ │Osc1│ │Osc2│ │Osc2│ │Osc2│ │Osc2│   │
│ │Wave│ │Semi│ │Fine│ │Lvl │ │Wave│ │Semi│ │Fine│ │Lvl │   │  Scrollable
│ └────┘ └────┘ └────┘ └────┘ └────┘ └────┘ └────┘ └────┘   │  Grid
│ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐   │
│ │Flt │ │Flt │ │Flt │ │Flt │ │Env1│ │Env1│ │Env1│ │Env1│   │
│ │Cut │ │Res │ │Drv │ │Type│ │Atk │ │Dec │ │Sus │ │Rel │   │
│ └────┘ └────┘ └────┘ └────┘ └────┘ └────┘ └────┘ └────┘   │
│  ... more rows ...                                          │
├──────────────────────────────────────────────────────────────┤
│ LOGIC BLOCKS                                                │  28px bar
│ ┌─────────────────┐ ┌─────────────────┐ ┌─────┐ ┌─────┐    │
│ │ Block 1         │ │ Block 2         │ │+ Rnd│ │+ Env│    │  Scrollable
│ │ [Randomize mode]│ │ [Envelope mode] │ └─────┘ └─────┘    │  horizontal
│ │ Trigger / Range │ │ Attack/Release  │                     │
│ │ Quantize / Move │ │ Gain / Range    │                     │
│ │ Targets / FIRE  │ │ Invert / Tgts   │                     │
│ └─────────────────┘ └─────────────────┘                     │
├──────────────────────────────────────────────────────────────┤
│ STATUS: Serum · 32 params · 1 locked · 2 blocks · MIDI ENV │  22px
└──────────────────────────────────────────────────────────────┘
```

---

## Parameter Grid

- **Layout**: CSS Grid, `auto-fill`, `minmax(94px, 1fr)`
- **Cell contents**: Parameter name, value (mono font), value bar, lock icon
- **States**:
  - Default: white bg, grey border
  - Hover: light grey bg
  - Selected (orange): `#FFF0E6` bg, `#FFB380` border, orange value bar
  - Locked (red): `#FFF0F0` bg, `#FFCCCC` border, 🔒 icon
  - Auto-locked (amber): `#FFF5E6` bg, `#FFD699` border, ⚠ icon
- **Interactions**:
  - Left-click: toggle selection (assigns/removes from active block)
  - Right-click: context menu (Lock / Unlock / Select / Deselect)

---

## Logic Blocks

### Block Card Layout
- Min-width: 270px, max-width: 290px
- Header: title + summary text, chevron expand/collapse
- Active block: 3px orange left border
- Click header: expand block + set as active
- Close button: × on header

### Mode Selector (top of every block)
- Segmented control: **Randomize** | **Envelope**
- Randomize: orange active state
- Envelope: blue (`#22AAFF`) active state

### Randomize Block Body

#### Trigger Section
Segmented control: **Manual** | **Tempo** | **MIDI** | **Audio**

Sub-controls appear based on selection:
- **Manual**: No sub-controls (uses FIRE button)
- **Tempo**: Division dropdown (1/1 through 1/32)
- **MIDI**: Mode dropdown (Any Note / Specific Note / CC)
  - Specific Note: note display + slider (0–127)
  - CC: CC# number input
  - Toggle: "Velocity scales range"
- **Audio**: Threshold slider (-60 to 0 dB)

#### Range Section
- Two labeled slider rows:
  ```
  Min  ═══════●════  25%
  Max  ══════════●═  80%
  ```

#### Quantize Section
- Toggle + step count input (2–128)
- When off, input is disabled/dimmed

#### Movement Section
Segmented control: **Instant** | **Smooth**
- Smooth: reveals glide time slider (1–2000ms)

#### Targets
- Tag box showing selected parameter names as orange tags
- Each tag has × to remove individually
- Empty state: "Click parameters to assign"

#### FIRE Button
- Full-width orange button, uppercase
- Flash animation on click

### Envelope Follower Block Body

#### Level Meter
- 40px tall, blue fill from bottom
- Real-time percentage label
- Pulsing blue dot in header indicates active

#### Response Section
- Attack slider (1–500ms)
- Release slider (1–2000ms)

#### Mapping Section
- Gain slider (0–100%)
- Min/Max range sliders (same as Randomize)
- Invert toggle

#### Targets
- Same tag box as Randomize blocks

#### No FIRE button (always active when audio present)

---

## Slider Design (v3 Fix)

All sliders use a consistent row layout:

```
[Label 32px]  [═══════●═════ slider]  [Value 32px]
```

- **Track**: 4px height, `#E8E8E8` background, 2px radius
- **Thumb**: 14px circle, white fill, 2px `#C0C0C0` border
- **Thumb hover**: border → `#FF5500`
- **Thumb active**: border → `#FF5500`, 3px `#FFF0E6` box-shadow ring
- **Value display**: mono font, right-aligned

---

## Interactions

### Block Management
- **Add Randomizer**: dashed border button `+ Randomizer`
- **Add Envelope**: dashed border button `+ Envelope` (blue tint)
- **Remove**: × button on block header
- **Activate**: click block header
- **Expand/Collapse**: click header toggles body visibility

### Parameter Selection
- Click grid cell → toggles selection
- Selected params auto-appear in ALL active block target boxes
- Remove from target box → deselects globally

### Envelope Follower Real-time
- Audio amplitude drives the level meter continuously
- Selected parameter values update in real-time on the grid
- Status bar ENV dot pulses blue when envelope is active

---

## Status Bar
- Height: 22px
- Shows: Plugin name, param count, locked count, block count, BPM, MIDI dot, ENV dot
- MIDI dot: green flash on MIDI activity
- ENV dot: blue when any envelope block is processing

---

## Window Size
- **Fixed**: 920 × 620px (VST3 plugin window)
- **Not resizable** in v1 implementation
