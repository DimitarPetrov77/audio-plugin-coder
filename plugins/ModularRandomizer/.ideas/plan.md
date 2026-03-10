# Implementation Plan — Modular Randomizer

## Complexity Score: 4/5

## Implementation Strategy: Phased

Given the complexity score of 4, this plugin requires a multi-phase implementation. The core challenge is **not DSP** — it's **plugin hosting, dynamic parameter management, and a rich interactive UI**. The phases are ordered by dependency: you can't randomize parameters until you can load a plugin, and you can't draw cables until the graph UI exists.

---

## Phase 1: Plugin Host Foundation

The minimum viable core — load a plugin and pass audio through it.

- [ ] **Audio Processor Graph Setup** — Create `juce::AudioProcessorGraph` with input/output nodes
- [ ] **Plugin Format Registration** — Register VST3 (and optionally AU on macOS) via `AudioPluginFormatManager`
- [ ] **Plugin Scanner** — Scan system directories, build `KnownPluginList`, cache results
- [ ] **Plugin Loader** — Instantiate a selected plugin, insert into the audio graph
- [ ] **Audio Passthrough** — Verify clean audio routing: DAW → Modular Randomizer → Loaded Plugin → DAW output
- [ ] **Parameter Discovery** — On load, enumerate all parameters from the loaded plugin's tree
- [ ] **Parameter Normalization** — Map all discovered parameter types (float, int, bool, enum) to normalized 0.0–1.0

### Validation Gate
✅ Can load a VST3 plugin, pass audio through it, and print its parameter list to the debug console.

---

## Phase 2: Randomization Engine

The control-rate engine that generates and applies random values.

### Phase 2.1: Single Logic Block
- [ ] **Random Number Generator** — `std::mt19937` seeded per block, generating [0.0, 1.0]
- [ ] **Manual Trigger** — Edge-detected fire button
- [ ] **Constraint Processor** — Min/max clamping, step quantization
- [ ] **Instant Apply** — Direct parameter write via `setValue()`
- [ ] **Value Applicator** — Bypass check, lock check, rate limiting
- [ ] **Safety Scanner** — Keyword matching on parameter names, auto-lock volume params

### Phase 2.2: Advanced Triggers
- [ ] **Tempo Sync Trigger** — Read `AudioPlayHead::PositionInfo`, compute beat positions, fire on divisions
- [ ] **Audio Threshold Trigger** — Envelope follower (peak or RMS), level comparator, retrigger holdoff
- [ ] **Trigger Mode Switching** — Clean state transitions between manual/tempo/threshold

### Phase 2.3: Glide System
- [ ] **Linear Interpolation** — Ramp from current to target over configurable time
- [ ] **Curve Shapes** — Implement ease-in, ease-out, ease-in-out using power functions
- [ ] **Block-Rate Stepping** — Advance interpolation each processBlock call
- [ ] **Instant Fallback** — Zero-time glide = instant jump (no special case needed)

### Phase 2.4: Multi-Block & Routing
- [ ] **Logic Block Manager** — Create, delete, serialize multiple Logic Block instances
- [ ] **Connection Router** — Map blocks to parameters, groups, or "all"
- [ ] **Fan-Out** — One block drives multiple targets
- [ ] **Fan-In Policy** — Decide and implement conflict resolution (last-write-wins recommended)
- [ ] **Global Mix** — Blend original vs. randomized parameter values

### Validation Gate
✅ Can load a plugin, create one logic block, randomize a parameter with constraints, glide to the new value, and auto-lock the master volume.

---

## Phase 3: WebView UI — Node Graph

The interactive visual environment.

### Phase 3.1: WebView Shell
- [ ] **WebView2 Integration** — Set up `juce::WebBrowserComponent` with WebView2 backend
- [ ] **Message Bridge** — Bidirectional JSON messaging between C++ and JS
- [ ] **State Push** — C++ sends parameter list, block states, and connections to JS on load
- [ ] **Event Receive** — JS sends user actions (create block, draw cable, fire, lock) to C++

### Phase 3.2: Node Canvas
- [ ] **Canvas Renderer** — HTML5 Canvas or SVG for the node graph workspace
- [ ] **Parameter Nodes** — Render discovered parameters as target nodes on the canvas
- [ ] **Logic Block Nodes** — Render as source nodes with trigger/constraint/movement controls
- [ ] **Cable Drawing** — Click-drag from output port to input port, Bézier curve rendering
- [ ] **Node Positioning** — Drag to reposition, auto-layout on initial load
- [ ] **Zoom & Pan** — Canvas navigation for large parameter sets

### Phase 3.3: Interaction & Feedback
- [ ] **Right-Click Context Menu** — Lock/unlock parameters, delete connections
- [ ] **Real-Time Value Display** — Show current parameter values on nodes (polled from C++)
- [ ] **Trigger Activity** — Flash/pulse animation when a Logic Block fires
- [ ] **Cable Activity** — Visual signal flow along cables when randomization occurs
- [ ] **Plugin Selector UI** — Dropdown or browser to select which plugin to load

### Phase 3.4: Loaded Plugin Editor
- [ ] **Plugin Window** — Option to open the loaded plugin's native editor in a floating window
- [ ] **Parameter Sync** — If user manually tweaks the loaded plugin's editor, reflect changes on the graph

### Validation Gate
✅ Full visual workflow: select a plugin → plugin loads → parameters appear as nodes → create logic block → draw cable → hit fire → see parameter change on loaded plugin.

---

## Phase 4: Polish & State Management

- [ ] **Full State Serialization** — Save/restore Modular Randomizer graph + loaded plugin state as a single preset
- [ ] **Undo/Redo** — Track graph topology changes (create block, draw cable, delete, lock)
- [ ] **Parameter Grouping** — UI for creating named groups of parameters
- [ ] **Edge Cases** — Handle plugin unload/reload, parameter count changes, missing plugins
- [ ] **Performance** — Profile control-rate overhead, optimize for large parameter counts (100+ params)
- [ ] **Accessibility** — Keyboard navigation for node graph

---

## Dependencies

### Required JUCE Modules
- `juce_audio_basics` — Audio buffer management
- `juce_audio_processors` — Plugin hosting, AudioProcessorGraph, parameter management
- `juce_audio_plugin_client` — Plugin format wrapper (VST3/AU export)
- `juce_audio_formats` — Audio format support for plugin hosting
- `juce_audio_utils` — Plugin list/scanner utilities
- `juce_gui_basics` — Window management
- `juce_gui_extra` — WebBrowserComponent (WebView2)

### External Dependencies
- **Microsoft WebView2 SDK** — Required for WebView2 on Windows (NuGet package, version 1.0.1901.177 or later based on existing Kari project patterns)
- **No additional DSP libraries** — All randomization/interpolation is basic math, no STK or FFTW needed

### Build System
- **CMake** via JUCE's CMake API
- **FetchContent** for WebView2 SDK (following existing Kari project pattern)

---

## Risk Assessment

### High Risk
| Risk | Impact | Mitigation |
|:---|:---|:---|
| **Plugin hosting stability** | Loaded plugins can crash, leak memory, or behave unexpectedly | Wrap plugin loading in try/catch, validate plugin before inserting into graph, provide "unload" escape hatch |
| **Thread safety** | Parameter writes from control engine must not block or race with audio thread | Use `juce::AudioProcessorParameter::setValue()` which is designed for this; avoid custom locks in audio path |
| **State serialization with loaded plugin** | Loading a preset with a missing plugin = broken state | Store plugin ID + fallback behavior; warn user if plugin not found |

### Medium Risk
| Risk | Impact | Mitigation |
|:---|:---|:---|
| **Tempo sync accuracy** | Missed beats or double-fires if beat position math is wrong | Use `ppqPosition` from `AudioPlayHead`, test with various DAWs and tempos |
| **WebView2 availability** | Windows-only, requires Edge/WebView2 runtime | Document requirement; WebView2 Evergreen runtime is widely pre-installed on Windows 10/11 |
| **Large parameter counts** | Plugins with 200+ parameters may overwhelm the UI | Implement search/filter, collapsible groups, pagination in the node graph |

### Low Risk
| Risk | Impact | Mitigation |
|:---|:---|:---|
| **Random number generation** | Poor distribution or predictable sequences | `std::mt19937` is well-tested and sufficient for this use case |
| **Glide interpolation** | Clicks if glide time is too short | Minimum glide time of 1ms, and instant mode already handles 0ms case |
| **Min/max constraint clamping** | User sets min > max | Enforce min ≤ max in UI and clamp in engine |

---

## Framework Decision: WebView

**Decision: `webview`**

**Rationale:**
This plugin's core value proposition is a **node-based visual workspace** — an interactive canvas with draggable nodes, Bézier cable drawing, right-click context menus, zoom/pan, real-time value displays, and trigger animations. This is fundamentally a **rich graphical application** rather than a traditional knob-and-slider plugin UI.

A native C++ framework like Visage would require building a custom canvas renderer, hit-testing, cable physics, and layout engine from scratch. WebView2 provides:

1. **HTML5 Canvas / SVG** — Battle-tested 2D graphics with hardware acceleration
2. **DOM event handling** — Click, drag, right-click, wheel events are trivial
3. **CSS animations** — Trigger pulses, cable glow, node transitions with zero DSP overhead
4. **Rapid iteration** — Hot-reload HTML/JS/CSS without rebuilding the plugin
5. **Proven pattern** — The Kari drum synth in this same workspace already uses WebView2 successfully

The overhead of WebView2 is negligible for a UI that updates at 30–60fps, and the loaded plugin's native editor can still open in its own window.
