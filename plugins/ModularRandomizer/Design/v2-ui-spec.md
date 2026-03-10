# UI Specification v2 — Modular Randomizer

## Design Direction Change (v1 → v2)
- **Dark → Light greyscale.** Clean, professional, paper-like. Only accent color is orange.
- **Added MIDI trigger mode.** Any note / specific note / CC, with velocity scaling.
- **Deeper UX thinking.** Layout reorganized around actual producer workflow.

## Window
- **Size:** 900 × 600px
- **Resizable:** No (fixed)
- **Framework:** WebView2

---

## Core UX Insight

The plugin serves **four distinct use cases** that can coexist simultaneously:

| Use Case | Trigger | Movement | Example |
|:---|:---|:---|:---|
| Sound exploration | Manual (click) | Instant | Hit FIRE, discover new filter combos |
| Evolving performance | MIDI note-on | Smooth glide | Every note subtly morphs the sound |
| Rhythmic texture | Tempo sync | Instant | Waveshape snaps to new value every bar |
| Reactive sound design | Audio threshold | Smooth glide | Kick drum morphs a pad synth |

Multiple blocks allow different params to randomize with different triggers and timing. That's the power.

---

## Layout Structure

```
┌────────────────────────────────────────────────────────┐
│ HEADER (40px)                                          │
│ ■ MODULAR RANDOMIZER   [Plugin: ▾ Serum]  [⏻] [Mix ═] │
├────────────────────────────────────────────────────────┤
│                                                        │
│  PARAMETER GRID (full width, scrollable)               │
│                                                        │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐    │
│  │Cut  │ │Reso │ │Drive│ │Wave │ │Semi │ │Fine │    │
│  │65%  │ │30%  │ │10%  │ │25%  │ │50%  │ │50%  │    │
│  └─────┘ └─────┘ └─────┘ └─────┘ └─────┘ └─────┘    │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐    │
│  │Atk  │ │Dec  │ │Sus  │ │Rel  │ │LFO  │ │■Vol │    │
│  │ 5%  │ │30%  │ │70%  │ │40%  │ │50%  │ │🔒80%│    │
│  └─────┘ └─────┘ └─────┘ └─────┘ └─────┘ └─────┘    │
│                                                        │
├────────────────────────────────────────────────────────┤
│ BLOCK STRIP (collapsible, horizontal)                  │
│                                                        │
│ ┌─ Block 1 ──────────┐ ┌─ Block 2 ──────────┐  [+]   │
│ │ MIDI · Any Note     │ │ Tempo · 1/4         │        │
│ │ Smooth · 200ms      │ │ Instant             │        │
│ │ Range: 20–80%       │ │ Range: 0–100%       │        │
│ │ ● Filter Cut, Reso  │ │ ● Osc1 Wave         │        │
│ │ [FIRE]              │ │ [FIRE]              │        │
│ └─────────────────────┘ └─────────────────────┘        │
│                                                        │
├────────────────────────────────────────────────────────┤
│ 32 params · 1 locked · 2 blocks · 120 BPM             │
└────────────────────────────────────────────────────────┘
```

### Key Layout Change from v1
Parameter grid is now **full width** (the main focus). Logic blocks are in a **horizontal strip below**, more compact. This puts the parameters front and center — that's what you're looking at 90% of the time.

---

## Interaction Model

### Assigning Params to Blocks
1. **Select a block** by clicking its header (active block has orange left border)
2. **Click params** in the grid — they toggle selection (orange highlight)
3. Selected params automatically appear as targets on the active block
4. **Shift+click** for range selection
5. **Select All / Clear** buttons in the param panel header

### Locking Parameters
- **Right-click** any param cell → context menu with Lock/Unlock
- **Auto-lock**: Master Vol detected on load → striped background + lock icon
- Locked params cannot be selected or randomized

### MIDI Trigger (new in v2)
When a block's trigger is set to MIDI:
- **Any Note**: every incoming MIDI note fires the block
- **Specific Note**: only the selected note fires (shows note name, e.g. "C3")
- **CC**: a CC message above value 64 fires
- **Velocity Scale**: when on, velocity proportionally scales the random range
  - vel 127 = full range, vel 64 = half range, vel 1 = barely moves

### Expanding a Block
- Click a block to expand it (shows all controls)
- When collapsed, shows: trigger type · movement type · target count
- Only one block expanded at a time (accordion)

---

## Controls Summary

| Area | Controls |
|:---|:---|
| Header | Plugin selector, bypass toggle, global mix slider |
| Param Grid | Clickable cells, multi-select, right-click lock, Select All / Clear |
| Block — Trigger | 4-way mode: Manual / Tempo / MIDI / Audio |
| Block — Trigger (Tempo) | Beat division selector |
| Block — Trigger (MIDI) | MIDI mode: Any Note / Note / CC, note selector, velocity scale toggle |
| Block — Trigger (Audio) | Threshold slider, retrigger time |
| Block — Range | Min/max dual slider, quantize toggle + step count |
| Block — Movement | 2-way: Instant / Smooth, glide time slider |
| Block — Targets | Tag list of assigned params, clear all button |
| Block — Action | FIRE button |
| Status Bar | Param count, lock count, block count, DAW BPM, MIDI activity indicator |
