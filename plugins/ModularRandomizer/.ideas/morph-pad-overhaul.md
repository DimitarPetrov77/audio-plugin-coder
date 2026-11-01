# Morph Pad — Complete Overhaul Proposal

**Status: IMPLEMENTED (Phases 1–4), built and shipping. Not yet user-verified.**

Delivered: undo on every interaction · lock-respecting, source-filtered capture that also
assigns · deterministic assign-time snapshot seeding · value pruning on save *and* load ·
340 px pad in a two-column double-height workspace · snapshot list with select,
ctrl/shift multi-select, inline rename, drag reorder, audition, delete ·
Update-from-current · per-snapshot weight/curve/depth through to the DSP.

Not delivered (deliberately): marquee multi-select on the pad face and move-together
(§2.6) — the list multi-select covers the same intent; and §5, the shared Lane/Pad morph
engine, which remains the right long-term fix but is not needed for delivery.
**Reference implementation:** the Morph *Lane* (`lane_module.js`), which solves most of
these problems already. The strategic goal is to make the Pad the 2-D sibling of the
Lane, not a separate, weaker design.

---

## 1. Why the Pad feels worse than the Lane — measured, not guessed

Every claim below is a code fact with a location.

### 1.1 Capture ignores locks, source, and scope
`+ Snap` (`logic_blocks.js:2306`) captures **every parameter of every loaded plugin**:

```js
for (var pid in PMap) { vals[pid] = p.v; }
```

- Locked (`p.lk`) and auto-locked (`p.alk`) params are captured anyway. The Lane's
  capture (`lane_module.js:1545`) skips both.
- No source choice. The Lane offers *All assigned* or a specific plugin, and remembers
  it in `lane._captureSource`.
- No undo.

### 1.2 Capture and assignment are two disconnected concepts
Capturing a snapshot on the Pad assigns **nothing**. You must separately assign targets,
so the block has two mental models to reconcile. The Lane unifies them: capturing into an
empty lane adds those params as `pids` *and* calls `assignTarget()` in the same action.

### 1.3 Snapshot meaning changes retroactively — non-deterministic patches
When a target has no stored value in a snapshot, the sync falls back to the parameter's
**live current value** (`logic_blocks.js:3527`):

```js
var fallback = PMap[tIds[ti]] ? PMap[tIds[ti]].v : 0.5;
```

So assigning a parameter *after* taking snapshots silently writes whatever that knob
happens to be at, into every existing snapshot, at sync time. The same patch reloaded in
a different order produces different sound. This is the most serious defect here.

### 1.4 State bloat — the whole rack, per snapshot, saved to disk
Because 1.1 captures all of `PMap`, and both save paths store `values` verbatim
(`persistence.js:32`, `persistence.js:279`, and the preset equivalents), a Pad with 12
snapshots stores **12 × (every param of every loaded plugin)**. With one large synth
(~2 000 params) that is ~24 000 numbers per Pad block in every autosave and every preset.
Delivery risk: preset size, save/load latency, session bloat.

### 1.5 No per-snapshot shaping at all
What each module sends to the DSP per snapshot:

| | Fields |
|---|---|
| **Pad** (`logic_blocks.js:3530`) | `x`, `y`, `targetValues` |
| **Lane** (`logic_blocks.js:3620`) | `position`, `hold`, `curve`, `depth`, `drift`, `driftRange`, `driftScale`, `warp`, `steps`, `name`, `source`, `values` |

The Pad's only shaping is one global `snapRadius` and a glide time. Every snapshot pulls
with identical strength and an identical falloff curve.

### 1.6 Editing is impoverished next to the Lane's sidebar

| Capability | Lane | Pad |
|---|---|---|
| Select snapshot | yes | chip click *jumps the playhead* instead |
| Multi-select (ctrl) / range (shift) | yes | no |
| Rename (double-click) | yes | no |
| Reorder (drag) | yes | no |
| Audition — hear a snapshot by applying its values | yes | no |
| Re-capture / update an existing snapshot | yes | **no** |
| Per-snapshot controls | Hold, curve, depth, warp, steps | none |
| Delete | yes | `×` on chip |

"No update" is the one that hurts most in practice: to fix one snapshot you must delete it
and take a new one, which loses its pad position and its place in the order.

### 1.7 Zero undo coverage
All eight Pad interaction handlers lack undo — `snap-add-btn`, `snap-del`, `snap-chip`
(×3 sites), `snap-dot` drag, `playhead-dot` drag, `snap-lib-btn` — while the same file
contains 37 `pushUndoSnapshot()` calls for other block types. Deleting a snapshot that
holds a full rack capture is currently **irreversible**.

### 1.8 The `source` label lies
`source` is set to `getPluginName()` of the *first* param encountered while iterating
`PMap` (`logic_blocks.js:2321`), but the snapshot spans every plugin. The chip's
`(source)` suffix is therefore arbitrary.

---

## 2. Proposed design

### 2.1 Size and layout — a double-height block
Current pad is a 200 × 200 circle centred above a cramped chip row
(`css/logic_blocks.css .morph-pad`). A Lane block is ~190 px (28 header + 130 canvas +
footer). Target: **two lanes ≈ 380–400 px**, laid out in two columns so every convenience
is visible at once and nothing hides in a menu.

```
┌─ Morph Pad ─────────────────────────────────────────────────────────────┐
│ Mode: [Manual][Auto][Trigger]          Capture ▾   📂 Library   ⊘ Clear │
├──────────────────────────────────────────┬──────────────────────────────┤
│                                          │ SNAPSHOTS            8/12    │
│                                          │ ┌──────────────────────────┐ │
│              ╭───────────────╮           │ │▸S1  Warm      12p  ●  ×  │ │
│            ╱                   ╲         │ │ S2  Bright     12p  ○  ×  │ │
│           │        ● S2          │       │ │ S3  Chaos      12p  ○  ×  │ │
│           │    ✛                 │       │ │ …                        │ │
│           │  ● S1      ● S3      │       │ └──────────────────────────┘ │
│            ╲                   ╱         │ SELECTED: S1                 │
│              ╰───────────────╯           │ Weight 100%  Curve ⌄  Dpth   │
│                  ~360 px                 │ [Update from current]        │
│                                          │ [Audition]  [Rename]         │
├──────────────────────────────────────────┴──────────────────────────────┤
│ Radius 100%  ·  Glide 200ms  ·  Grid ⌄  ·  12 params  ·  Snap to grid   │
└─────────────────────────────────────────────────────────────────────────┘
```

- **Left:** the pad, ~360 px, so dots are easy to hit and labels fit without overlap.
- **Right:** a real snapshot list, mirroring the Lane's sidebar — the component the user
  already prefers. Selection here is *selection*, not "jump the playhead".
- **Footer:** global movement controls, one strip, same idiom as the Lane footer.
- Auto/Trigger sub-panels expand in the footer region rather than pushing the pad around.

### 2.2 Capture and assignment become one action
Replace `+ Snap` with the Lane's proven **`Capture ▾`**:

- Menu lists *All assigned params* plus one entry per loaded plugin; the choice is
  remembered per block (`_captureSource`) and shown on the button, with a `×` to reset.
- Skips `lk` / `alk` params.
- **Empty pad:** capture assigns the chosen plugin's params as targets *and* stores their
  values — one action, like the Lane.
- **Pad with targets:** capture stores values for the assigned targets only.
- Pushes undo.

### 2.3 Snapshots store only assigned targets
Kill 1.4 at the source. `values` holds exactly the block's targets.

**Migration:** on load, prune each snapshot's `values` to the block's target set. Lossless
for anything reachable today (non-target values were never sent to the DSP — see 1.5), and
it shrinks existing sessions.

### 2.4 Assignment initialises snapshots explicitly — fixes 1.3
When a parameter is assigned to a Pad that already has snapshots, write its current value
into every snapshot **at assign time**, and say so:

> *"Cutoff added to 8 snapshots at its current value — edit per snapshot in the list."*

Deterministic, visible, undoable. The silent read at sync time is removed, and the `0.5`
fallback disappears with it.

### 2.5 Per-snapshot shaping — the Pad's missing expression
Add to each snapshot, sent to the DSP alongside `x`/`y`:

| Field | Meaning | Range |
|---|---|---|
| `weight` | influence multiplier — a "strong" snapshot dominates its neighbourhood | 0–200 %, default 100 |
| `curve` | falloff shape: Smooth / Linear / Sharp / Late | 0–3, matching the Lane's curve values |
| `depth` | scales this snapshot's values toward the parameter mid-point | 0–200 %, default 100 |

This is the same vocabulary the Lane's snapshots already use, so the two modules teach
each other. DSP change is confined to the IDW weighting in `ProcessBlock.cpp:1037`.

### 2.6 Interaction parity with the Lane
- **Snapshot list:** click select, ctrl multi-select, shift range-select, double-click
  rename, drag reorder, `×` delete, per-snapshot dot colour.
- **Audition:** apply a snapshot's values to the plugins so you *hear* it, exactly as the
  Lane does.
- **Update from current:** re-capture into the selected snapshot, keeping its position,
  name and order. The single biggest workflow win.
- **Pad:** dot drag with undo; marquee multi-select and move-together; right-click a dot
  for rename / audition / update / weight / delete; optional grid snap.
- **Undo on all of it.**

### 2.7 Honest metadata
`source` records the actual capture filter ("All assigned", or the plugin name), set from
the menu choice rather than inferred from iteration order.

---

## 3. Compatibility

- **Old sessions/presets load unchanged.** New per-snapshot fields default to
  neutral (`weight` 100 %, `curve` Smooth, `depth` 100 %) — identical behaviour to today.
- **Snapshot pruning (2.3)** is the only data-shape change; it only removes values that
  never reached the DSP.
- The 12-snapshot cap stays; the list UI makes it legible rather than cramped.
- `getSnapSectorPos()` auto-placement stays for new snapshots (12 sectors, radius 0.35).

---

## 4. Suggested phasing

Each phase is independently shippable and leaves the block working.

| Phase | Content | Risk |
|---|---|---|
| **1 — Correctness** | undo on all 8 handlers; lock-respecting capture; explicit assign-time init (2.4); honest `source`; prune values (2.3) | low, high value; fixes the non-deterministic patch bug |
| **2 — Layout** | double-height two-column block, big pad, snapshot list, footer strip (2.1) | medium, pure UI |
| **3 — Workflow** | `Capture ▾` with source memory, Update-from-current, audition, rename, reorder, multi-select (2.2, 2.6) | medium |
| **4 — Expression** | per-snapshot `weight` / `curve` / `depth` incl. DSP + serialisation in all 5 whitelists (2.5) | medium, touches audio |

Phase 1 alone removes the delivery blockers. Phases 2–3 are what makes it *feel* like the
Lane. Phase 4 is the new capability.

---

## 5. Strategic note — one morph engine, two views

The Lane and the Pad already do the same thing: interpolate between captured snapshots.
The Lane does it along one axis, the Pad across two. They currently duplicate the concept
with different data models, different capture code, different editing UIs and different
levels of polish — which is exactly why one drifted behind the other, and why per-snapshot
fields exist in one and not the other.

Worth considering after Phase 4: extract a shared snapshot model + shared list component,
and let Lane and Pad be two *views* of it. That prevents this divergence recurring, and
means future work (a new per-snapshot field, a new capture source) lands in both at once.
Not required for delivery — but it is the fix for the underlying cause.

---

## 6. Open questions

1. **Weight semantics:** should `weight` scale IDW influence (a strong snapshot wins ties)
   or its effective radius (a strong snapshot reaches further)? Influence is simpler to
   reason about; radius is more visual. Recommend influence, drawn as dot size.
2. **Grid snap on the pad:** useful for tidy layouts, or unwanted constraint?
3. Should the Pad also gain the Lane's **drift** per snapshot, or is drift better left as
   a global for a 2-D field?
