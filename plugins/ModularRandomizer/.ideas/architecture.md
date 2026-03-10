# DSP Architecture Specification — Modular Randomizer

## Architecture Type

This is **not a traditional audio DSP plugin**. It is a **plugin host container** with a **control-rate engine**. The audio signal passes through untouched (or through the loaded sub-plugin). The core processing is all about **parameter manipulation at control rate**, not sample-level DSP.

---

## Core Components

### 1. Plugin Host Engine
Loads and manages an external VST3/AU plugin instance inside the Modular Randomizer.

- **Plugin Scanner** — Discovers installed VST3/AU plugins on the system
- **Plugin Loader** — Instantiates the selected plugin, creates its audio processing graph
- **Parameter Discovery** — Reads the loaded plugin's parameter tree, extracts names, ranges, types
- **Audio Passthrough** — Routes audio I/O through the loaded plugin's `processBlock()`
- **State Serialization** — Saves/restores the loaded plugin's state alongside Modular Randomizer's own state

**JUCE API surface:**
- `juce::AudioPluginFormatManager` — VST3/AU format registration
- `juce::KnownPluginList` — Plugin scanning and caching
- `juce::AudioPluginInstance` — Loaded plugin lifecycle
- `juce::AudioProcessorGraph` — Internal audio routing

### 2. Parameter Registry
Central store for all discovered parameters from the loaded plugin.

- **Normalized Parameter Map** — All external parameters mapped to normalized 0.0–1.0
- **Lock State Tracker** — Per-parameter lock flag (manual or auto-detected)
- **Safety Scanner** — On load, scans parameter names against volume-critical keywords and auto-locks matches
- **Group Manager** — Allows user-defined parameter groups for bulk randomization

**Keywords for auto-lock:** `master`, `output`, `main vol`, `main volume`, `master vol`, `master volume`, `out level`, `output level`, `volume`

### 3. Logic Block Engine
The randomization generators. Each Logic Block is an independent instance with its own trigger, constraint, and movement configuration.

- **Random Number Generator** — Per-block PRNG (e.g. `std::mt19937`) generating values in [0.0, 1.0]
- **Trigger System** — Evaluates firing conditions each control-rate tick:
  - *Manual*: Edge-detected button press
  - *Tempo Sync*: Beat-position comparator using DAW transport (`juce::AudioPlayHead`)
  - *Audio Threshold*: Envelope follower on sidechain/input with level comparator and retrigger holdoff
- **Constraint Processor** — Applies range clamping and step quantization to raw random output
- **Glide Interpolator** — Smoothly transitions current value → target value over configurable time with selectable curve shape

### 4. Connection Router
Manages the graph topology — which Logic Block outputs connect to which Parameter Nodes.

- **Connection Map** — Sparse mapping from Logic Block IDs to Parameter Node IDs / Group IDs / "all"
- **Fan-Out Support** — One Logic Block can drive multiple parameters
- **Fan-In Prevention** — Each parameter can only receive from one Logic Block (last-write-wins or first-connected-wins)
- **Enable/Disable** — Connections can be toggled without deletion

### 5. Value Applicator
The final stage that writes randomized values to the loaded plugin's parameters.

- **Bypass Check** — Respects global bypass and per-parameter lock states
- **Mix Blend** — Interpolates between original and randomized values based on Global Mix
- **Rate Limiter** — Enforces minimum interval between value changes (global setting)
- **Thread Safety** — Parameter writes happen on the audio thread via `juce::AudioProcessorParameter::setValue()`

### 6. UI Bridge (WebView2)
Bridges the visual node graph (HTML/JS/Canvas) to the C++ engine.

- **State Sync** — Pushes parameter lists, connection topology, and Logic Block states to the WebView
- **Event Handling** — Receives user interactions (create block, draw cable, lock param, fire) from JS
- **Real-Time Display** — Streams current parameter values and trigger activity to the UI for visual feedback

---

## Processing Chain

This plugin has **two parallel processing paths**:

```
AUDIO PATH (sample-rate):
  Audio In → [Loaded Plugin processBlock()] → Audio Out
                    ↑
                    | parameter writes
                    |
CONTROL PATH (control-rate, per-block):
  Trigger System → fires? → RNG → Constraint Processor → Glide Interpolator
                                                                ↓
                                                      Connection Router
                                                                ↓
                                                      Value Applicator → Loaded Plugin Parameters
                                                         ↑         ↑
                                                    Lock Check   Mix Blend
```

### Timing Model

- **Audio path**: Runs at sample rate inside `processBlock()`. The loaded plugin processes audio normally.
- **Control path**: Runs at **block rate** (once per `processBlock()` call, typically every 64–512 samples). Logic Blocks evaluate triggers and update parameter targets at this rate.
- **Glide interpolation**: Can run at block rate with linear interpolation, or at sample rate if click-free smoothing requires it. Block rate is sufficient for most cases given typical buffer sizes (1–10ms).
- **UI updates**: Decoupled from audio thread. UI polls or receives pushed state at ~30–60 fps via WebView message bridge.

---

## Parameter Mapping

### Host-Level Parameters → Components

| Parameter | Component | Function |
|:---|:---|:---|
| `host_bypass` | Value Applicator | Gates all parameter writes |
| `host_mix` | Value Applicator | Blends original vs. randomized values |
| `host_rate_limit` | Value Applicator | Enforces minimum event interval |

### Logic Block Parameters → Components

| Parameter | Component | Function |
|:---|:---|:---|
| `lb_trigger_mode` | Trigger System | Selects trigger evaluation mode |
| `lb_manual_fire` | Trigger System | Edge-detected manual fire |
| `lb_tempo_division` | Trigger System | Beat division for tempo sync |
| `lb_threshold_level` | Trigger System | Audio threshold comparator level |
| `lb_threshold_release` | Trigger System | Retrigger holdoff timer |
| `lb_range_min` | Constraint Processor | Lower bound clamping |
| `lb_range_max` | Constraint Processor | Upper bound clamping |
| `lb_quantize_enable` | Constraint Processor | Enables step snapping |
| `lb_quantize_steps` | Constraint Processor | Number of discrete steps |
| `lb_movement_mode` | Glide Interpolator | Instant vs. glide selection |
| `lb_glide_time` | Glide Interpolator | Interpolation duration |
| `lb_glide_curve` | Glide Interpolator | Curve shape selection |

### Per-Parameter Node → Components

| Parameter | Component | Function |
|:---|:---|:---|
| `pn_locked` | Value Applicator | Blocks randomization for this param |
| `pn_auto_detected` | Safety Scanner | Read-only detection flag |

---

## Complexity Assessment

**Score: 4/5 (Expert)**

### Rationale

| Factor | Complexity | Why |
|:---|:---|:---|
| Plugin Hosting | High | Loading external VST3/AU plugins, managing their lifecycle, audio routing through `AudioProcessorGraph`, and state serialization is one of the most complex JUCE tasks |
| Dynamic Parameter Discovery | Medium-High | Reading parameter trees at runtime, normalizing heterogeneous types, tracking changes |
| Multi-Instance Logic Blocks | Medium | Each block is independent with its own state, but the pattern is repetitive once one works |
| Tempo Sync Triggers | Medium | Requires correct parsing of `AudioPlayHead::PositionInfo` and beat-position math |
| Audio Threshold Triggers | Medium | Envelope follower + level comparator + retrigger holdoff — standard DSP but needs tuning |
| Glide Interpolation | Low-Medium | Straightforward exponential/linear ramp, runs at control rate |
| Node Graph UI | High | Interactive canvas with draggable nodes, cable drawing, right-click menus — rich WebView UI |
| Thread Safety | High | Parameter writes from control engine to loaded plugin must be lock-free and audio-thread safe |
| State Serialization | High | Must serialize both Modular Randomizer state AND the loaded plugin's opaque state blob |

**Not Level 5** because: No ML, no physical modeling, no novel DSP algorithms. The complexity comes from **systems integration** (hosting, threading, state management) rather than signal processing research.
