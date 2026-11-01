# State Migration Plan — Processor Owns the Model

**Branch:** `hostesa/state-in-processor`
**Goal:** The processor owns all plugin state and can restore a session completely without the
editor ever opening. JS becomes a view that renders state and sends commands. That is the
prerequisite for a native (Visage) UI, which can then be built screen by screen against the
same model.

**Status (2026-11-02):** Phase 1 (headless restore) is implemented on this branch. The
full native-UI migration (Phases 2–4, Visage) is **not** being pursued; the decision was
to perfect the existing WebView UI instead.

### Phase 1 — what was done
- `Source/StateRestore.cpp`: C++ port of the restore + `syncBlocksToHost` transforms;
  `setStateInformation` now restores blocks, bypass, bus mixer, routing and full WrongEQ
  without the editor. Sample-modulator audio files are saved and reloaded.
- **State nesting bug fixed:** `setStateInformation` used to pass the whole XML to
  `apvts.replaceState()`, so every load/save cycle stacked another stale copy of
  `HOSTED_PLUGINS`/`UI_STATE` (with the UI text dropped) *before* the real one, and restore
  read the oldest. Sessions reopened twice came back with their first-ever plugin list and
  no blocks. Sections are now kept out of the APVTS tree and read from their last
  occurrence, which also recovers existing bloated states.
- **DAW exposure:** exact AP_ slot map saved/restored (`PROXY_MAP`, guarded by the plugin
  list); re-exposing a plugin now gets its slots back; block-param automation no longer
  dropped by `syncProxyCacheToHost`; block automation and proxy → DAW sync run without the
  editor (`HeadlessSyncTimer`); slots of deleted blocks are freed and lane params refresh.
- **JS:** WrongEQ targets/locks no longer dropped on reopen; no half-restored state saved
  while the UI restores.
- **Self-check:** on each editor open the processor compiles the saved state itself and
  diffs it against what the editor sends → `%APPDATA%\DimitarPetrov\Hostesa\restore_check.txt`.
  Verified exact on a synthetic session (all 8 block types, quirks, locks, EQ routing) and
  across repeated reloads in the Standalone.

### WrongEQ internal modulation moved to the audio engine
- `Source/EqInternalMod.cpp` is a line-for-line port of `weqAnimTick` (gain LFO shapes,
  drift textures, continuous noise, Q-mod shapes, tempo sync, zones, per-point
  exclusion/depth). It runs per block on the audio thread, so the EQ moves with the editor
  closed and in offline renders. `setEqUiMod` (editor → audio offsets) is gone.
- The editor still draws at full frame rate and eases its clocks toward the engine's
  (`eqGainPhase` / `eqDriftTime` in `__rt_data__`, ~250 ms ease).
- Per-point mod depths are now saved with the session, and a running Q-mod no longer
  bakes its animated Q into the saved band Q.
- Verified in the Standalone: 31 configs match the JS maths exactly (the only
  mismatches were one-block read skew in the test, confirmed by a time-shift search);
  drawing tracks the audio clock within ~3 ms median / 8 ms max, clock speed ±3% per frame.

### Not covered yet
- Exposed `lane.N.speed` maps to a field the DSP never reads (no effect).
- Not yet tested in a DAW: headless block automation, sample reload.

---

The original plan follows for reference.

---

## 1. Where state lives today (code facts)

### Restored by C++ alone (`setStateInformation`)
| State | Where |
|---|---|
| APVTS (`MIX`, `BYPASS`) | `PluginProcessor.cpp` `setStateInformation` |
| Hosted plugins: id, name, path, busId, all param values | `HOSTED_PLUGINS` XML |
| Routing mode | `HOSTED_PLUGINS@routingMode` |
| EQ points + some globals (only when routing mode is 2) | `PluginProcessor.cpp:2456`, parsed out of `uiStateJson` |

### Only applied when the editor opens and the JS pushes it
`restoreFromHost()` (`persistence.js:159`) parses the saved blob and then calls the native
functions one by one:

| State | Pushed via | Effect if the editor never opens |
|---|---|---|
| All logic blocks (7 types, lanes, morph snapshots, links) | `updateBlocks` (`syncBlocksToHost`, `logic_blocks.js:3946`) | **No modulation runs** |
| Param locks | Indirectly: locked params are dropped from block targets | — |
| Plugin bypass | `setPluginBypass` | Bypassed plugins process audio |
| Bus volume / mute / solo | `setBusVolume`, `setBusMute`, `setBusSolo` | Mixer at defaults |
| Exposed-param (AP_ slot) mappings | `updateExposeState` | **DAW automation on exposed params does nothing.** `setStateInformation` clears every slot (`PluginProcessor.cpp:2373`) |
| Full EQ state (anim, drift, Q-mod, cuts, …) | `setEqCurve` (`wrongeq_canvas.js:5312`) | Only the subset in the C++ pre-populate applies |

C++ stores everything above as one opaque string, `uiStateJson` (`PluginProcessor.h:1063`),
written by `saveUiState` and saved verbatim into `UI_STATE`.

### Two schemas, derived in JS
1. **Save schema:** `saveUiStateToHost()` (`persistence.js:9`). UI-facing units (percent,
   dial positions), param ids as `"pluginId:paramIndex"` strings, includes view state (theme,
   scale, expanded, collapsed).
2. **DSP schema:** `syncBlocksToHost()` (`logic_blocks.js:3946`). Derived from (1) with
   transforms that exist **only in JS**:
   - percent → 0..1 (`rMin/100`, `lfoDepth/100`, `jitter/100`, `snapRadius/100`, …)
   - `envDialToHz(envFilterFreq)`, `envBwIdxToOct(envFilterBW)`
   - `shapes_range` overrides (`shapeSize = 1.0`, `shapeDepth = size/200`, …)
   - locked params dropped from targets
   - `"pid"` strings → `{hostId, paramIndex}`
   - missing bases / snapshot values fall back to the **live** param value (and the snapshot
     value gets written back into JS state)

The block serializer is duplicated **four times**: save (`persistence.js`), restore
(`persistence.js`), global preset build (`preset_system.js:1004`) and global preset apply
(`preset_system.js:1173`). The morph pad overhaul had to edit all four.

Undo is JS-only (`undo_system.js:46`, full snapshots of the JS objects).

---

## 2. Target architecture

```
           ┌──────────────────────── Processor (message thread) ───────────────────────┐
 commands  │  HostesaModel  ──compile──▶  LogicBlock[] / EQ / bus / expose  ──swap──▶  │ audio thread
 ────────▶ │  (single source of truth, versioned, (de)serialises UI_STATE)              │
           │        │  undo stack · global presets                                     │
           └────────┼───────────────────────────────────────────────────────────────────┘
                    ▼ change notifications
             WebView today / Visage later  (render + send commands only)
```

- **`HostesaModel`** (new, `Source/Model/`): plain C++ structs mirroring the *save* schema
  (`BlockConfig`, `LaneConfig`, `MorphSnapshot`, `LaneSnapshot`, `EqState`, `BusState`,
  `PluginUiState`, `ExposeState`, locks, view prefs). Serialised to and from `juce::var` with
  a `schemaVersion` field. Reading a v0 blob (today's format) must work forever.
- **`compileBlocks(model, livePluginParams)`**: a C++ port of the transforms in
  `syncBlocksToHost`. Produces exactly what `updateLogicBlocks` builds today, then reuses the
  existing swap into the audio thread.
- **`applyModel()`**: the single place that pushes model → engine (blocks, bypass, buses,
  expose slots, full EQ). Called from `setStateInformation`, preset load, undo and edits.

---

## 3. Phases

Each phase ships on its own and leaves the plugin working.

### Phase 0 — Confirm and set up a safety net (≈2–3 days)
1. **Reproduce the bug** in a DAW (Reaper): add a plugin, a Randomize block and a Lane block,
   expose one param and automate it. Save, reopen the project **without opening Hostesa's
   editor**, press play. Expected today: no modulation, automation does nothing.
2. **Fixtures:** save 6–10 real sessions covering every block type, morph pad snapshots
   (incl. weight/curve/depth), morph lanes, link blocks with macros, locks, parallel and EQ
   routing. Extract each `UI_STATE` blob to `tests/fixtures/*.json`.
3. **Golden DSP output:** for each fixture, capture the exact `updateBlocks` JSON the current
   JS produces (temporary log line in `PluginEditor.cpp:475`). Store as
   `tests/fixtures/*.dsp.json`. This is the equivalence oracle for Phase 1.
4. Decide on a small test target (JUCE `UnitTest` or a console app in CMake) that can load a
   fixture and compare compiled output to golden.

### Phase 1 — Headless restore (≈1 week) — fixes the bug, JS untouched
1. Add `HostesaModel` + `fromVar()` for the current schema.
2. Port `syncBlocksToHost` transforms into `compileBlocks()`. Match golden output on every
   fixture, **quirks included** (see Risks, "falsy defaults").
3. In `setStateInformation`, after plugins and IDs are restored: parse model → `applyModel()`
   (blocks, bypass, bus mixer, expose slots, full EQ).
4. When the editor opens, the JS still re-sends everything. Because the data is identical,
   this is a no-op. Verify that it doesn't retrigger or glitch running modulation (playheads,
   lane phase, morph positions).
5. Re-run the Phase 0 DAW test: modulation and automation work without opening the editor.

### Phase 2 — Model becomes authoritative (≈2–3 weeks)
1. New native functions: `getModel()` and `applyEdit(path, value)` / `replaceBlock(id, json)`.
   C++ mutates the model, recompiles, notifies the editor (`modelChanged` event with
   revision number).
2. JS stops computing the DSP schema: `syncBlocksToHost` sends the save-schema block, and C++
   compiles. Delete the JS transform code.
3. `saveUiState` shrinks to view-only prefs (theme, scale, expanded/collapsed). Everything
   else is read from the model.
4. Capture-type actions that read live param values in JS (morph `+ Snap`, lane capture,
   base capture on assign) become C++ commands so they work identically from any UI.

### Phase 3 — Presets and undo in C++ (≈1–2 weeks)
1. Global presets serialise from and to `HostesaModel`. Delete `buildGlobalPresetData` and
   `applyGlobalPreset`'s block mapping (two of the four duplicated serializers).
2. Undo/redo as model snapshots (or command diffs) in the processor. JS undo becomes a thin
   call. Param-only undo entries (`setParam` / `applyParamBatch`) move along with it.
3. Old preset files must still load (same v0 reader as session state).

### Phase 4 — JS is a pure view (ongoing)
Audit for remaining JS-only logic (anything writing to `blocks`, `PMap.lk`, `wrongEqPoints`
outside a command). When the audit is clean, a Visage screen can be built against the same
model and commands. Suggested first screen: WrongEQ canvas or the lane editor.

---

## 4. Risks and decisions

- **Falsy defaults in JS.** `syncBlocksToHost` uses `||` for defaults, so legitimate zeros are
  replaced: `threshold: b.threshold || -12` (0 dB → −12), `envAtk || 10` (0 ms → 10),
  `midiNote || 60` (note 0 → 60), `morphSpeed || 50`, `freeSecs || 4`, etc. Phase 1 must
  reproduce these to match golden output. **Decision needed:** keep them, or fix them in
  Phase 2 (fixing changes how some saved sessions sound).
- **Plugin-ID remapping.** `setStateInformation` patches restored plugin IDs to match the
  saved ones. Block targets are `"pluginId:paramIndex"`, so compile must run **after**
  remapping. A plugin that fails to load must drop its targets without breaking the block.
- **Threading.** Some hosts call `setStateInformation` off the message thread. Compile into a
  local and publish through the existing swap path; never touch editor objects there.
- **Live-value fallbacks.** JS falls back to the live param value for missing bases and
  snapshot values. In headless restore, the "live" value is the restored hosted-plugin value,
  so plugin param restore must finish first. Also, write the fallback back into the model so
  it doesn't drift (the same fix the morph pad overhaul made in JS).
- **Double-apply on editor open (Phase 1 only).** Applying the same blocks twice must not
  reset lane phases, morph playheads or sample heads. Check `updateLogicBlocks` for state
  that gets reinitialised on every call.
- **Schema versioning.** Today's blob has no version. Treat "no `schemaVersion`" as v0
  permanently.
- **UI responsiveness is the top priority.** Phase 2 must not put a C++ round-trip inside a
  drag. Continuous gestures (knobs, pad playhead, lane drawing, EQ points) update the UI
  locally and immediately, and send coalesced edits (at most one per frame, as
  `_weqSyncPending` already does). The model echo is reconciled by revision number, never
  re-rendered over an in-progress gesture. Measure drag latency and frame time before and
  after Phase 2; any regression blocks the merge.
- **Visage is gated on a spike, not assumed.** Before committing to a native port, build the
  WrongEQ canvas alone in Visage, hosted in the plugin. Compare frame time, CPU, resize, HiDPI
  and multi-instance behaviour against the WebView version in at least two DAWs. Proceed only
  if it is clearly better *and* the visual quality matches.

## 5. Out of scope
- Any Visage code (comes after Phase 4).
- DSP behaviour changes, except the falsy-defaults decision above.
- Moving `Source/ui/public` to `WebUI/`. Not worth the churn if the WebView is being replaced.
