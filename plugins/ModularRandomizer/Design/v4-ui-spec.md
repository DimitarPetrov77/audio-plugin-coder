# UI Specification v4 — Modular Randomizer

## Design Changes (v3 → v4)

### Problems Solved
1. **No per-block parameter assignment** — v3 used a single global selection. Now each logic block has its own `targets` Set
2. **Adding all params broke the UI** — Target box now has max-height with scroll, shows abbreviated tags, overflow counter
3. **Plugin was just a dropdown** — Now rendered as a full **Plugin Block** panel (left side) consistent with the rack metaphor
4. **No connection model** — Colored dots on parameters show which blocks target them (visual "cables")
5. **Parameter sharing** — A single parameter can belong to multiple blocks. Color dots make this visible

---

## Architecture: Two-Panel Rack

```
┌─────────────────────┬──────────────────────────────────────┐
│   PLUGIN BLOCK      │        LOGIC BLOCKS                  │
│   (Left Panel)      │        (Right Panel)                 │
│                     │                                      │
│   ┌ Oscillator 1 ─┐│  ┌─ Block 1 (Randomize) ───────────┐│
│   │ Wave    65% ●○ ││  │ ● Assign  Mode  Trigger  Range  ││
│   │ Semi    50%  ○ ││  │   Quantize  Movement  Targets   ││
│   │ Fine    50%    ││  │   [FIRE]                        ││
│   │ Level   80%    ││  └──────────────────────────────────┘│
│   └────────────────┘│  ┌─ Block 2 (Envelope) ────────────┐│
│   ┌ Filter ────────┐│  │ ○ Assign  Meter  Response       ││
│   │ Cutoff  65% ●  ││  │   Mapping  Targets              ││
│   │ Res     30%    ││  └──────────────────────────────────┘│
│   └────────────────┘│                                      │
│   ... more groups   │  [+ Randomizer]  [+ Envelope]        │
└─────────────────────┴──────────────────────────────────────┘
```

### Plugin Block (Left Panel, 240px)
- **Header**: "LOADED PLUGIN" label
- **Plugin selector**: Dropdown + "Editor" button
- **Toolbar**: All / None buttons + param count
- **Assign banner**: Shows when assign mode is active for a block (colored)
- **Parameter list**: Grouped by category, collapsible groups
  - Each parameter row shows: name, value, bar, colored dots for connected blocks
  - Clicking a param while in assign mode toggles it for that block
  - Right-click: Lock / Unlock context menu

### Logic Blocks (Right Panel)
- **Card layout**: 2-column grid, scrollable
- **Each card has**:
  - Colored block indicator (unique per block)
  - Assign button: enters assign mode for that block
  - Mode selector: Randomize / Envelope
  - All controls from v3
  - Targets box: shows parameter tags with block color, max-height scroll, overflow counter
- **Per-block targeting**: Each block maintains its own `targets` Set

---

## Parameter Sharing Model

A parameter CAN be targeted by multiple blocks simultaneously:

- **Visual indicator**: Colored dots on the parameter row, one per connected block
- **Last-write wins**: If a Randomize block fires while an Envelope block is also modulating, the most recent write takes effect
- **Independent ranges**: Each block applies its own min/max range to the shared parameter
- **Locking**: Locking a parameter removes it from ALL blocks' targets

---

## Assign Mode Workflow

1. User clicks **Assign** button on a logic block
2. Plugin block shows colored banner: "Click params to assign → Block N"
3. Parameter rows highlight on hover with block color
4. Clicking a param toggles it in that block's target set
5. Colored dots appear/disappear in real-time
6. Click **Assign** again (now shows "✓ Assigning") to exit assign mode
7. "All" / "None" buttons in toolbar work on the active assign block

---

## Window Size
- **960 × 640px** (slightly wider than v3 for two-panel layout)
- Not resizable in v1 implementation
