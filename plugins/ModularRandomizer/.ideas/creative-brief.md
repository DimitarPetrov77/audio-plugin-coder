# Creative Brief — Modular Randomizer

## Hook

**Stop tweaking. Start discovering.**
A modular, node-based randomization engine that lives inside your DAW. Load any VST3/AU plugin, wire up logic blocks, and let controlled chaos sculpt your sound — on beat, on threshold, or on demand.

## Description

### What It Is

Modular Randomizer is a **plugin host container**. You load an external VST3 or AU instrument/effect inside it. Its job is not to process audio itself — it's to **control the loaded plugin's parameters** through a visual, node-based randomization environment.

### How It Works

The interface is a **modular graph workspace**, inspired by modular synth patching:

1. **Parameter Nodes** — When an external plugin loads, its exposed parameters appear as target nodes on the canvas. Each parameter is a destination that can receive randomized values.

2. **Logic Blocks** — These are the source nodes. Each block is a self-contained randomization generator with three control areas:
   - **Triggers** — *When* to fire: manual button, tempo-synced beat divisions (1/4, 1/8, 1/16 notes via DAW BPM), or audio threshold (fires when incoming signal exceeds a set level, e.g. kick drum detection).
   - **Constraints** — *What* to pick: min/max range sliders (e.g. keep a filter between 20%–80%), and step quantization (snap to grid, essential for pitch).
   - **Movement** — *How* to apply: instant jump or glide (smooth interpolation over configurable milliseconds, preventing clicks/pops).

3. **Connections** — Cables drawn from a Logic Block output to a single parameter, a custom group, or the entire plugin at once.

### Safety System

Total randomness can ruin sounds or spike volume. Built-in protection:

- **Auto-Detect Master Volume** — On plugin load, the engine scans parameter names for keywords ("master", "output", "main vol", etc.) and auto-locks matches to prevent volume spikes.
- **Right-Click Locking** — Any parameter or group can be locked via right-click. Locked parameters ignore all incoming randomization signals completely.

### Sonic Goal

This is not a sound generator. It's a **creative control surface** — a tool for producers and sound designers who want to break out of manual knob-tweaking and discover unexpected parameter combinations through structured randomness.

### Visual Aesthetic

Modular synth workspace. Dark background, cable patching, glowing nodes. Think VCV Rack meets Bitwig's modulator system — functional, clean, and alive with signal flow.
