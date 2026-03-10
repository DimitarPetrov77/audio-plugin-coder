# Parameter Specification — Modular Randomizer

## Architecture Note

This plugin is a **host container**. It does not have traditional audio DSP parameters. Instead, its parameters describe the behavior of the randomization engine and the logic blocks within the node graph.

The loaded external plugin's parameters are **dynamic** — they are discovered at runtime when a VST3/AU is loaded and exposed as target nodes.

---

## Host-Level Parameters

These are global controls for the Modular Randomizer itself.

| ID | Name | Type | Range | Default | Unit | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `host_bypass` | Bypass | Bool | off / on | off | — | Disables all randomization signals |
| `host_mix` | Global Mix | Float | 0.0 – 1.0 | 1.0 | % | Wet/dry blend of randomized vs. original parameter values |
| `host_rate_limit` | Rate Limit | Float | 1 – 1000 | 100 | ms | Minimum interval between randomization events (global) |

---

## Logic Block Parameters

Each Logic Block instance exposes these parameters. Multiple Logic Blocks can coexist on the graph.

### Trigger Section

| ID | Name | Type | Range | Default | Unit | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `lb_trigger_mode` | Trigger Mode | Enum | manual / tempo_sync / audio_threshold / midi | manual | — | Selects when the block fires |
| `lb_manual_fire` | Fire | Trigger | — | — | — | Momentary button, fires one randomization event |
| `lb_tempo_division` | Beat Division | Enum | 1/1, 1/2, 1/4, 1/8, 1/16, 1/32 | 1/4 | note | Active when trigger_mode = tempo_sync |
| `lb_threshold_level` | Threshold | Float | -60.0 – 0.0 | -12.0 | dB | Audio level that triggers firing when trigger_mode = audio_threshold |
| `lb_threshold_release` | Retrigger Time | Float | 10 – 2000 | 100 | ms | Minimum time between audio-triggered fires (prevents retriggering) |
| `lb_midi_mode` | MIDI Mode | Enum | any_note / specific_note / cc | any_note | — | Active when trigger_mode = midi. Determines what MIDI event fires the block |
| `lb_midi_note` | MIDI Note | Int | 0 – 127 | 60 | note | Active when midi_mode = specific_note. Only this note triggers the block |
| `lb_midi_cc` | MIDI CC | Int | 0 – 127 | 1 | cc# | Active when midi_mode = cc. CC value > 64 fires, < 64 does not |
| `lb_velocity_scale` | Velocity Scale | Bool | off / on | off | — | When on, incoming velocity (0–127) scales the randomization range proportionally |

### Constraint Section

| ID | Name | Type | Range | Default | Unit | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `lb_range_min` | Range Min | Float | 0.0 – 1.0 | 0.0 | norm | Lower bound of random output (normalized) |
| `lb_range_max` | Range Max | Float | 0.0 – 1.0 | 1.0 | norm | Upper bound of random output (normalized) |
| `lb_quantize_enable` | Quantize | Bool | off / on | off | — | Enables step quantization |
| `lb_quantize_steps` | Steps | Int | 2 – 128 | 12 | — | Number of discrete steps within the range (12 = semitones for pitch) |

### Movement Section

| ID | Name | Type | Range | Default | Unit | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `lb_movement_mode` | Movement | Enum | instant / glide | instant | — | How the parameter transitions to the new value |
| `lb_glide_time` | Glide Time | Float | 1 – 5000 | 50 | ms | Duration of smooth interpolation (active when movement = glide) |
| `lb_glide_curve` | Glide Curve | Enum | linear / ease_in / ease_out / ease_in_out | linear | — | Shape of the glide interpolation curve |

---

## Envelope Follower Block Parameters

An Envelope Follower block is a **continuous modulation source** — unlike Randomize blocks which fire discrete events, this block continuously maps the incoming audio amplitude to target parameter values. Multiple Envelope blocks can coexist alongside Randomize blocks.

### Response

| ID | Name | Type | Range | Default | Unit | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `ef_attack` | Attack | Float | 1 – 500 | 10 | ms | How fast the envelope rises when audio gets louder |
| `ef_release` | Release | Float | 1 – 2000 | 100 | ms | How fast the envelope falls when audio gets quieter |

### Mapping

| ID | Name | Type | Range | Default | Unit | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `ef_gain` | Gain | Float | 0.0 – 1.0 | 0.5 | norm | Amplifies the envelope signal before mapping. Higher = more sensitive to quiet audio |
| `ef_range_min` | Range Min | Float | 0.0 – 1.0 | 0.0 | norm | Lower bound of the output mapping range |
| `ef_range_max` | Range Max | Float | 0.0 – 1.0 | 1.0 | norm | Upper bound of the output mapping range |
| `ef_invert` | Invert | Bool | off / on | off | — | When on, loud audio drives parameters DOWN instead of up |

---

## Safety & Locking Parameters

These are per-parameter-node controls, applied to each discovered parameter of the loaded plugin.

| ID | Name | Type | Range | Default | Unit | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `pn_locked` | Locked | Bool | off / on | off* | — | When on, parameter ignores all randomization. *Auto-set to `on` for detected master volume params |
| `pn_auto_detected` | Auto-Detected | Bool | off / on | — | — | Read-only flag indicating the safety system detected this as a volume-critical parameter |

---

## Connection Routing (Graph State — Not Audio Parameters)

These are part of the graph topology, not traditional plugin parameters. They are serialized as part of the preset/state but don't appear as automatable knobs.

| Property | Type | Notes |
| :--- | :--- | :--- |
| `connection_source` | Logic Block ID | Which logic block is the source |
| `connection_target` | Parameter Node ID / Group ID / "all" | Single param, named group, or entire plugin |
| `connection_enabled` | Bool | Cable can be toggled on/off without deleting |

---

## Dynamic Runtime Parameters

These are **not predefined** — they are discovered when the user loads an external VST3/AU plugin:

- **Parameter count**: Unknown until load time
- **Parameter names**: Read from the loaded plugin's parameter tree
- **Parameter ranges**: Read from the loaded plugin metadata
- **Parameter types**: Float, Int, Bool, Enum — mapped to normalized 0.0–1.0 for randomization

The safety system scans parameter names against keywords: `master`, `output`, `main vol`, `main volume`, `master vol`, `master volume`, `out level`, `output level`, `volume`.
