# UI Specification v1 — Modular Randomizer

## Design Direction
**Ableton Live inspired.** Flat, functional, muted. The UI works, it doesn't decorate.
No node graph. No cables. No skeuomorphism. Parameters in a grid, logic blocks as assignable panels.

## Window
- **Size:** 900 × 600px
- **Resizable:** No (fixed)
- **Framework:** WebView2

## Layout Structure

```
┌────────────────────────────────────────────────────────┐
│ HEADER BAR (40px)                                      │
│ [Logo] MODULAR RANDOMIZER    [Plugin: Serum ▾] [⏻] [Mix]│
├──────────────────────────┬─────────────────────────────┤
│ PARAMETER GRID           │ LOGIC BLOCKS                │
│ (scrollable, 520px wide) │ (scrollable, 380px wide)    │
│                          │                             │
│ ┌──────┐ ┌──────┐ ┌────┐│ ┌─────────────────────────┐ │
│ │Cutoff│ │Reso  │ │Vol ▒││ │ BLOCK 1              [×]│ │
│ │ 0.45 │ │ 0.30 │ │🔒  ▒││ │ Trigger: [Man|Tmp|Aud] │ │
│ └──────┘ └──────┘ └────┘││ │ Range: ====●====       │ │
│ ┌──────┐ ┌──────┐ ┌────┐││ │ Quantize: [off]        │ │
│ │Drive │ │WavTbl│ │Mix  ││ │ Move: [Instant|Glide]   │ │
│ │ 0.70 │ │ 0.00 │ │0.50 ││ │ Glide: ===●=====       │ │
│ └──────┘ └──────┘ └────┘││ │ Targets: Cutoff, Reso   │ │
│                          ││ │ [FIRE]                   │ │
│  ... more params ...     ││ └─────────────────────────┘ │
│                          ││                             │
│                          ││ [+ Add Logic Block]         │
├──────────────────────────┴─────────────────────────────┤
│ STATUS BAR (24px)                                      │
│ 32 params · 3 locked · 1 block · 120 BPM               │
└────────────────────────────────────────────────────────┘
```

## Interaction Model (Simplified)

### Loading a Plugin
1. Click plugin selector dropdown in header
2. Browse/search installed VST3 plugins
3. Select → plugin loads → parameters populate the grid

### Assigning Parameters to a Logic Block
1. Click a parameter cell in the grid → it highlights
2. Click another → multi-select (shift-click for range)
3. Selected params automatically appear as "Targets" on the active Logic Block
- **Or:** Click "Assign" button on a Logic Block, then click params

### Locking Parameters
- Right-click any parameter cell → toggle lock
- Locked cells show 🔒 icon and muted styling
- Auto-locked params (detected volume) show with striped background

### Firing Randomization
- Click the **FIRE** button on any Logic Block
- Or: Tempo sync fires automatically on beat
- Or: Audio threshold fires when signal exceeds level

### No Cables. No Nodes. Just Click and Go.

## Controls Summary

| Area | Controls |
|:---|:---|
| Header | Plugin selector, bypass toggle, global mix knob |
| Parameter Grid | Clickable cells, multi-select, right-click lock |
| Logic Block — Trigger | 3-way mode switch, fire button, beat division selector, threshold slider |
| Logic Block — Range | Min/max dual slider, quantize toggle + step count |
| Logic Block — Movement | 2-way mode switch, glide time slider, curve selector |
| Logic Block — Targets | Tag list of assigned parameters, clear button |
| Status Bar | Param count, lock count, block count, DAW BPM |
