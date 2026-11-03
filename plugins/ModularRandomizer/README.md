# Hostesa

A modular parameter modulation engine and plugin host — built as a VST3 plugin with JUCE 8 and a WebView2 interface.
(The source lives in `plugins/ModularRandomizer/`; the plugin it builds is **Hostesa**.)

Load any VST3 instruments or effects, assign their parameters to **Logic Blocks**, and modulate everything in real time through randomization, envelope following, automation lanes, morph pads, and geometric LFO shapes.

---

## Core Features

### Plugin Hosting
- Load and chain multiple VST3 plugins in series or **parallel routing** with per-bus volume, mute, and solo
- Full parameter discovery: every hosted plugin's parameters appear in a searchable, scrollable rack
- Plugin state is saved and restored with the DAW project automatically — and a saved session
  runs fully (modulation, WrongEQ movement, DAW automation) even if the editor is never opened
- Big plugins: up to 8,192 parameters per hosted plugin can be modulated (tested with Arturia
  Pigments, 2,265 parameters)
- A plugin that can't be loaded (not installed on this machine) stays in the session as a
  **Not found** card with **Retry**: its settings, modulation targets and DAW slots are kept and
  come back when it loads
- Crash-isolated hosting — a misbehaving plugin is disabled without taking down the session

### Logic Blocks
Six modulation modes, each assignable to any combination of hosted plugin parameters:

| Mode | Description |
|------|-------------|
| **Randomize** | Random values on trigger (tempo, MIDI, audio). Absolute or relative range, optional glide and quantize |
| **Envelope** | Audio envelope follower with attack/release/sensitivity, optional bandpass filter, sidechain input |
| **Sample** | Load an audio file and use its waveform as a modulation source. Loop, one-shot, or ping-pong |
| **Morph Pad** | XY pad with up to 12 snapshots — capture whole states and move between them. Exact recall, live mix display, auto-explore (wander/shapes/orbit/path), triggered sequencing |
| **Shapes** | Geometric LFO paths (circle, figure-8, triangle, star, spiral, butterfly, etc.) with tempo sync, spin, and phase control |
| **Lane** | Drawable automation curves and morph lanes — the most powerful mode (see below) |

### Morph Pad
- **Capture** takes a snapshot of the whole state (every unlocked parameter of every plugin, or one
  plugin / only assigned parameters from the ▾ menu). Set up a sound, capture, change it, capture
  again — then move between them.
- **Click a snapshot** to go to it; drag it to move it. With **Exact** snapshots (default for new
  pads) standing on a snapshot gives exactly that sound; **Soft** keeps the original always-blend
  behaviour of older projects.
- Each snapshot has its own colour; the pad and list show live how much each one contributes, and
  each row names the parameters that make that snapshot different.
- Values are read straight from the plugins when capturing, so knobs turned in a plugin's own
  window are captured correctly.

### Automation Lanes
Each lane block can contain multiple sub-lanes running independently:

- **Curve Lanes** — Draw breakpoint automation with smooth, linear, or step interpolation
- **Morph Lanes** — Capture parameter snapshots and morph between them on beat
- **Per-lane timing** — Loop lengths from 1/16 note to 32 bars, or free-running in seconds
- **Play modes** — Forward, reverse, ping-pong, random
- **One-shot triggering** — Manual, MIDI (note + channel), or audio threshold, with hold and retrigger
- **Overlay system** — Layer lanes of different lengths for polyrhythmic modulation

#### Lane Effects (Footer)
| Control | Function |
|---------|----------|
| Depth | Output scaling 0–200% |
| Warp | Transfer curve — compress or expand dynamics |
| Steps | Quantize output to N levels |
| Drift | Organic variation — slow wandering or fast micro-jitter |
| DftRng | Drift amplitude as % of parameter range |
| DriftScale | Musical period for drift cycles (1/16 to 32 bars), independent of loop length |

### Expose to DAW
- **2048 unified proxy parameter slots** (AP_0001 to AP_2048)
- Expose any hosted plugin parameter or logic block control to the DAW's automation system
- Bidirectional: DAW automation ↔ plugin parameter changes
- Discrete parameters appear as stepped values with labels

### Preset System
- Global presets (full session: all plugins + blocks + lanes + routing)
- Per-plugin presets
- Factory programs with categorized browsing
- Morph snapshot library (save/load snapshot sets across projects)

### UI
- 13 themes with customizable color palettes
- Scalable interface with local font bundling (Share Tech Mono)
- Real-time modulation arcs, playhead visualization, and value tooltips
- Context menus on nearly everything
- Keyboard shortcuts for fast workflow (S for select, arrows for nudge, Ctrl+C/V for copy/paste)

---

## Architecture

```
Source/
├── PluginProcessor.cpp/h    — Plugin hosting, state serialization, lane clip parsing
├── ProcessBlock.cpp         — Audio-rate modulation engine (zero-allocation)
├── PluginHosting.cpp        — VST3 scan, load, crash isolation, missing-plugin placeholders
├── StateRestore.cpp         — Runs a saved session without the editor; exact DAW slot map
├── EqInternalMod.cpp        — WrongEQ's own gain LFO / drift / Q-mod, on the audio thread
├── PluginEditor.cpp/h       — WebView2 bridge with native function API
├── ParameterIDs.hpp         — Parameter ID constants
└── ui/public/
    ├── index.html           — Entry point
    ├── style.css            — Base styles
    ├── css/
    │   ├── variables.css    — Design tokens
    │   ├── themes.css       — Theme definitions
    │   ├── logic_blocks.css — Block and lane styles
    │   ├── plugin_rack.css  — Plugin rack styles
    │   ├── dialogs.css      — Modals and panels
    │   ├── header.css       — Top bar
    │   └── overrides.css    — Edge case fixes
    ├── fonts/               — Share Tech Mono (local TTF)
    └── js/
        ├── logic_blocks.js  — Block creation, rendering, event handling
        ├── lane_module.js   — Lane drawing, mouse/keyboard, drift, overlays
        ├── plugin_rack.js   — Plugin cards, virtual scroll, drag & drop
        ├── theme_system.js  — 13 themes + CSS variable system
        ├── preset_system.js — Global + per-plugin + factory presets
        ├── persistence.js   — State save/restore across editor lifecycle
        ├── expose_system.js — Proxy parameter mapping UI
        ├── realtime.js      — 30/60Hz readback polling + modulation arcs
        ├── controls.js      — Sliders, knobs, routing mixer
        ├── context_menus.js — Right-click menus
        ├── help_panel.js    — Tabbed help/reference modal
        ├── undo_system.js   — Undo/redo stack
        ├── state.js         — Global state variables
        ├── juce_bridge.js   — JUCE ↔ WebView message layer
        └── juce_integration.js — Native function wrappers
```

### Key Design Decisions
- **Zero-allocation audio thread** — All DSP runs without heap allocation or mutex contention; the
  UI swaps in new block settings holding the engine lock only for the swap itself
- **Additive modulation bus** — Multiple blocks can modulate the same parameter simultaneously
- **Cheap writes to hosted plugins** — A parameter is only written when its value changes, and
  continuous modulation goes out at a ~10 ms control rate, so big synths (which recompute on every
  parameter change) stay light even with thousands of mapped parameters
- **Two-layer meta-modulation** — Blocks can modulate other blocks' parameters
- **O(visible) UI scaling** — Virtual scroll, dirty marking, and batched IPC handle plugins with 2000+ parameters
- **SEH crash isolation** — Plugin hosting and scanning wrapped in structured exception handlers

---

## Install

### From a release (no build tools needed)
Download from the repository's **Releases** page (or from a finished **Build and Release** run under
**Actions → Artifacts**):
- **Windows:** run the `Hostesa-…-Setup.exe` installer, or extract the Portable ZIP and copy the
  `Hostesa.vst3` folder to `C:\Program Files\Common Files\VST3\`
- **macOS:** open the `.pkg`, or copy `Hostesa.vst3` to `/Library/Audio/Plug-Ins/VST3/`
- **Linux:** extract the tar.gz and copy `Hostesa.vst3` to `~/.vst3/`

Then rescan plugins in your DAW. Windows needs the WebView2 Runtime (built into Windows 11).

### Build and install from source (Windows)
**Requirements:** JUCE 8 in `_tools/JUCE/`, CMake 3.22+, Visual Studio 2022, the WebView2 SDK.

From the repository root, in an **administrator** PowerShell (installing writes to Program Files):
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build-and-install.ps1 -PluginName ModularRandomizer
```
This builds the VST3 and Standalone and copies `Hostesa.vst3` to `C:\Program Files\Common Files\VST3\`.
Add `-NoInstall` to only build. Outputs:
- VST3: `build/plugins/ModularRandomizer/Hostesa_artefacts/Release/VST3/Hostesa.vst3`
- Standalone: `build/plugins/ModularRandomizer/Hostesa_artefacts/Release/Standalone/Hostesa.exe`

### Automated builds (GitHub Actions)
`.github/workflows/build-release.yml` builds Windows (installer + portable ZIP), macOS (universal
`.pkg`) and Linux:
- **Any branch, on demand:** Actions → *Build and Release* → *Run workflow* (plugin name `Hostesa`).
  The packages are attached to the run as artifacts for 30 days.
- **A release:** push a tag such as `v1.8.0` — the same build runs and publishes a GitHub Release
  with the installers.

---

## License

Copyright © Dimitar Petrov
