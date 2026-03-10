# Morph Pad — Implementation Plan

> **For Agent:** This document is self-contained. Follow it step-by-step. All design decisions are final.

---

## ⚠️ BEFORE YOU START — MANDATORY ANALYSIS

You MUST read and understand the following files before writing any code. This plugin is a complex, existing WebView-based JUCE 8 audio plugin with modular architecture. You are **adding a new feature** to a working codebase — do not break anything.

### Skills to Load First (read SKILL.md in each)
1. `.agent/skills/skill_design_webview/SKILL.md` — JUCE 8 WebView2 critical patterns (member order, resource provider, CMake)
2. `.agent/skills/skill_implementation/SKILL.md` — DSP implementation rules (real-time safety, parameter handling)

### Workflows to Reference
- `.agent/workflows/impl.md` — Implementation phase workflow
- `.agent/workflows/debug.md` — If build fails, follow this
- `.agent/workflows/test.md` — After implementation, run tests

### Files to Analyze (read in this order)

**1. Understand the existing architecture:**
- `plugins/ModularRandomizer/Source/PluginProcessor.h` — The `LogicBlock` struct (around line 240-310) is what you're extending. Study `ParamTarget`, `SampleData`, `GlideCommand`, `ActiveGlide`, and the readback structs (`EnvReadback`, `SampleReadback`). Your new `MorphSnapshot` and `MorphReadback` structs follow the same patterns.
- `plugins/ModularRandomizer/Source/PluginProcessor.cpp` — Study these sections:
  - `processBlock()` (starts ~line 380) — the Logic Block Engine section processes existing modes. Your morph_pad branch goes as a new `else if` alongside `envelope` and `sample` modes.
  - `updateLogicBlocks()` (~line 1200) — parses JSON from the UI. You need to add morph field parsing here.
  - Understand how `setParamDirect()`, `getParamValue()`, `recordSelfWrite()` work — you'll call these.
  - Understand the trigger detection pattern (MIDI, tempo, audio) used by randomize and sample modes — morph_pad reuses it.

**2. Understand the existing UI:**
- `plugins/ModularRandomizer/Source/ui/public/js/state.js` — Global state declarations. No changes needed.
- `plugins/ModularRandomizer/Source/ui/public/js/logic_blocks.js` — **CRITICAL FILE**. Study:
  - `addBlock(mode)` — how blocks are created with default properties
  - `buildBlockCard(b, bi)` — how block cards render (mode class, header, body)
  - `renderRndBody(b)` / `renderEnvBody(b)` / `renderSampleBody(b)` — how each mode renders its controls. Your `renderMorphBody(b)` follows the same pattern.
  - `wireBlocks()` — how events are wired (segmented controls, sliders, toggles, selects). You add morph-specific wiring here (pad drag, snapshot management).
  - `syncBlocksToHost()` — how block data is serialised to JSON and sent to C++. You add morph fields here.
- `plugins/ModularRandomizer/Source/ui/public/js/persistence.js` — How UI state is saved/restored. Add morph fields.
- `plugins/ModularRandomizer/Source/ui/public/js/realtime.js` — How real-time readback data from C++ updates the UI. Add morph playhead readback.
- `plugins/ModularRandomizer/Source/ui/public/js/controls.js` — Button handlers. Add morph button handler.
- `plugins/ModularRandomizer/Source/ui/public/index.html` — Main HTML shell. Add the morph button.

**3. Understand the Editor (C++ → JS bridge):**
- `plugins/ModularRandomizer/Source/PluginEditor.h` — Editor class structure
- `plugins/ModularRandomizer/Source/PluginEditor.cpp` — The `timerCallback()` sends `__rt_data__` JSON to the WebView every tick. You add morph readback data here.

**4. Understand the styling:**
- `plugins/ModularRandomizer/Source/ui/public/css/variables.css` — CSS custom properties (theme colors)
- `plugins/ModularRandomizer/Source/ui/public/css/logic_blocks.css` — Existing block card styles
- `plugins/ModularRandomizer/Source/ui/public/js/theme_system.js` — Theme definitions with CSS variable overrides

**5. Understand the build system:**
- `plugins/ModularRandomizer/CMakeLists.txt` — If you add new CSS or JS files, they must be added to `juce_add_binary_data()`.

---

## Overview

A new logic block mode `morph_pad` — the **4th mode** alongside `randomize`, `envelope`, and `sample`. Users save parameter snapshots as dots on a 2D XY pad. A playhead dot travels through the space, interpolating parameter values using Inverse Distance Weighting (IDW) based on proximity to snapshots.

---

## Design Decisions (All Final)

| Question | Decision |
|----------|----------|
| Step trigger | **Both** ordered cycle AND random — as a segmented option |
| LFO mode | **Multiple shapes** — Circle, Figure-8, Sweep X, Sweep Y |
| Max snapshots | **12** |
| Empty state | **Allowed** — 0 snaps = passthrough (no processing), pad shows placeholder |
| Snapshot values | **Keyed by param ID** — survives target add/remove |
| Button layout | **4 buttons** in same row, shrink the first 3 to fit Morph Pad |

---

## Implementation Order

**Do these in order. Build and test between phases.**

1. Phase 1: CSS + Theme (safe, no logic changes)
2. Phase 2: Frontend JS (UI only, no C++ changes)
3. Phase 3: Backend C++ (PluginProcessor.h/cpp)
4. Phase 4: Editor bridge (PluginEditor.cpp rt_data)
5. Phase 5: Persistence (save/restore)
6. Phase 6: Build + Test

---

## Phase 1: CSS + Theme

### 1.1 `css/variables.css`

Add morph color:
```css
--morph-color: #5C6BC0;
```

### 1.2 `css/logic_blocks.css`

Add these styles:
```css
/* Morph pad mode class */
.lcard.mode-morph { }
.lcard.mode-morph.active { border-color: var(--morph-color); }

/* Shrink add buttons to fit 4 in row */
.add-blk { font-size: 10px; padding: 4px 6px; }

/* XY Pad container */
.morph-pad {
    width: 100%;
    height: 160px;
    background: var(--bg-inset);
    border: 1px solid var(--border);
    border-radius: 4px;
    position: relative;
    overflow: hidden;
    cursor: crosshair;
    background-image:
        linear-gradient(var(--border) 1px, transparent 1px),
        linear-gradient(90deg, var(--border) 1px, transparent 1px);
    background-size: 25% 25%;
    background-position: center center;
}
.morph-pad .empty-label {
    position: absolute;
    top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    color: var(--text-muted);
    font-size: 10px;
    pointer-events: none;
}

/* Snapshot dots */
.snap-dot {
    width: 10px; height: 10px;
    background: var(--text-muted);
    border: 1px solid var(--border-strong);
    border-radius: 50%;
    position: absolute;
    cursor: grab;
    transform: translate(-50%, -50%);
    transition: background 0.15s;
    z-index: 2;
}
.snap-dot:hover { background: var(--text-primary); }
.snap-dot.active { background: var(--morph-color); border-color: var(--morph-color); }
.snap-dot .snap-label {
    position: absolute;
    bottom: 12px; left: 50%;
    transform: translateX(-50%);
    font-size: 8px;
    color: var(--text-muted);
    white-space: nowrap;
    pointer-events: none;
}

/* Playhead dot */
.playhead-dot {
    width: 14px; height: 14px;
    background: var(--morph-color);
    border: 2px solid var(--text-primary);
    border-radius: 50%;
    position: absolute;
    transform: translate(-50%, -50%);
    z-index: 5;
    box-shadow: 0 0 8px var(--morph-color);
    pointer-events: none;
}
.playhead-dot.manual { cursor: grab; pointer-events: auto; }

/* Snapshot chips */
.snap-chips {
    display: flex; flex-wrap: wrap;
    gap: 3px; margin-top: 4px;
    align-items: center;
}
.snap-chip {
    font-size: 9px; padding: 2px 6px;
    border-radius: 3px;
    background: var(--bg-cell);
    border: 1px solid var(--border);
    color: var(--text-secondary);
    cursor: pointer;
    display: flex; align-items: center; gap: 3px;
}
.snap-chip:hover { background: var(--bg-cell-hover); }
.snap-chip .snap-del { cursor: pointer; opacity: 0.5; }
.snap-chip .snap-del:hover { opacity: 1; color: var(--locked-icon); }
.snap-add-btn {
    font-size: 9px; padding: 2px 8px;
    border-radius: 3px;
    background: var(--morph-color);
    border: 1px solid var(--morph-color);
    color: white;
    cursor: pointer;
}
```

### 1.3 `js/theme_system.js`

Add `--morph-color` to every theme definition:
```
earthy:    #5C6BC0
midnight:  #7C4DFF
clinical:  #42A5F5
forest:    #66BB6A
volcanic:  #FF7043
arctic:    #26C6DA
```

---

## Phase 2: Frontend JS

### 2.1 `index.html`

Add button in the `.add-wrap` div (alongside existing 3 buttons):
```html
<button class="add-blk" id="addMorph" style="border-left:3px solid var(--morph-color)">+ Morph Pad</button>
```

### 2.2 `js/controls.js`

Add handler:
```js
document.getElementById('addMorph').onclick = function () { addBlock('morph_pad'); };
```

### 2.3 `js/logic_blocks.js` — Main Changes

#### `addBlock(mode)` — Add morph_pad defaults

When `mode === 'morph_pad'`, the block object gets these additional properties:
```js
snapshots: [],           // [{x, y, values: {paramId: value}, name: 'Snap 1'}]
playheadX: 0.5,
playheadY: 0.5,
morphMode: 'manual',    // 'manual', 'auto', 'trigger'
exploreMode: 'wander',  // 'wander', 'bounce', 'lfo'
lfoShape: 'circle',     // 'circle', 'figure8', 'sweepX', 'sweepY'
morphSpeed: 50,          // 0..100
morphAction: 'jump',    // 'jump', 'step'
stepOrder: 'cycle',     // 'cycle', 'random'
morphSource: 'midi',    // 'midi', 'tempo', 'audio'
// Trigger sub-options reuse existing: beatDiv, midiMode, midiNote, midiCC, midiCh, threshold, audioSrc
jitter: 0,              // 0..100
morphGlide: 200         // 1..2000ms
```

#### `buildBlockCard(b, bi)` — Add morph mode

- Add `'morph_pad'` to the mode segmented control
- Add mode class: `b.mode === 'morph_pad' ? ' mode-morph' : ...`
- In summary: `'Morph / ' + morphModeLabel + ' / ' + b.snapshots.length + ' snaps'`
- Call `renderMorphBody(b)` when `b.mode === 'morph_pad'`

#### `renderMorphBody(b)` — New function

Renders the morph pad UI within the block card body. Structure:

```
1. XY Pad (.morph-pad)
   - If no snapshots: show ".empty-label" with "Add a snapshot to begin"
   - For each snapshot: .snap-dot positioned at {x%, (1-y)*100%}
   - If snapshots exist: .playhead-dot at {playheadX%, (1-playheadY)*100%}

2. Snapshot chips (.snap-chips)
   - For each snapshot: .snap-chip with name + delete (×) button
   - "+ Snap" button (.snap-add-btn) — disabled if snapshots.length >= 12

3. Play Mode: segmented [Manual] [Auto] [Trigger]

4. Auto sub-panel (visible when morphMode === 'auto'):
   - Explore: segmented [Wander] [Bounce] [LFO]
   - LFO Shape sub (visible when exploreMode === 'lfo'):
     segmented [Circle] [Figure-8] [Sweep X] [Sweep Y]
   - Speed: slider 0..100

5. Trigger sub-panel (visible when morphMode === 'trigger'):
   - Action: segmented [Jump] [Step]
   - Step Order sub (visible when morphAction === 'step'):
     segmented [Cycle] [Random]
   - Source: segmented [MIDI] [Tempo] [Audio]
   - Source sub-options (reuse existing pattern from renderRndBody):
     - MIDI: mode select, note/CC input, channel select
     - Tempo: division select
     - Audio: source select, threshold input

6. Modifiers:
   - Jitter: slider 0..100%
   - Glide: slider 1..2000ms
```

#### `wireBlocks()` — Add morph event wiring

**Playhead drag** (manual mode only):
- `mousedown` on `.playhead-dot.manual` → start drag
- `mousemove` on `.morph-pad` → update `b.playheadX`, `b.playheadY` based on mouse position relative to pad bounds
- `mouseup` → end drag, call `syncBlocksToHost()`

**Snapshot dot drag:**
- `mousedown` on `.snap-dot` → start drag
- `mousemove` → update snapshot x,y
- `mouseup` → end drag, call `syncBlocksToHost()`

**"+ Snap" button:**
- Read current values from `PMap` for all targets in the block
- Create snapshot object: `{ x: b.playheadX, y: b.playheadY, values: capturedValues, name: 'Snap N' }`
- Push to `b.snapshots`, cap at 12
- Re-render block, sync to host

**Snapshot chip click:**
- Jump playhead to that snapshot's x,y position
- Update playhead dot display

**Snapshot delete (×):**
- Remove from array
- Re-render, sync to host

#### `syncBlocksToHost()` — Add morph fields

For morph_pad blocks, add to the serialised object:
```js
snapshots: b.snapshots.map(function(s) {
    // Convert values object to array aligned with current targets
    var vals = [];
    b.targets.forEach(function(pid) {
        vals.push(s.values[pid] !== undefined ? s.values[pid] : 0.5);
    });
    return { x: s.x, y: s.y, targetValues: vals };
}),
playheadX: b.playheadX,
playheadY: b.playheadY,
morphMode: b.morphMode || 'manual',
exploreMode: b.exploreMode || 'wander',
lfoShape: b.lfoShape || 'circle',
morphSpeed: (b.morphSpeed || 50) / 100,    // normalise 0..1
morphAction: b.morphAction || 'jump',
stepOrder: b.stepOrder || 'cycle',
morphSource: b.morphSource || 'midi',
jitter: (b.jitter || 0) / 100,             // normalise 0..1
morphGlide: b.morphGlide || 200
```

### 2.4 `js/realtime.js` — Morph playhead readback

In the `__rt_data__` handler, add:
```js
if (data.morphHeads) {
    for (var mi = 0; mi < data.morphHeads.length; mi++) {
        var mh = data.morphHeads[mi];
        var mb = findBlock(mh.id);
        if (mb && mb.mode === 'morph_pad' && mb.morphMode !== 'manual') {
            mb.playheadX = mh.x;
            mb.playheadY = mh.y;
            // Direct DOM update (no full re-render)
            var dot = document.getElementById('morphHead-' + mh.id);
            if (dot) {
                dot.style.left = (mh.x * 100) + '%';
                dot.style.top = ((1 - mh.y) * 100) + '%';
            }
        }
    }
}
```

---

## Phase 3: Backend C++

### 3.1 `PluginProcessor.h` — Extend LogicBlock

Add inside the `LogicBlock` struct:
```cpp
// ── Morph Pad ──
struct MorphSnapshot {
    float x = 0.5f, y = 0.5f;
    std::vector<float> targetValues;  // aligned with targets array
};
std::vector<MorphSnapshot> snapshots;
float playheadX = 0.5f, playheadY = 0.5f;
juce::String morphMode;       // "manual", "auto", "trigger"
juce::String exploreMode;     // "wander", "bounce", "lfo"
juce::String lfoShape;        // "circle", "figure8", "sweepX", "sweepY"
float morphSpeed = 0.5f;      // 0..1
juce::String morphAction;     // "jump", "step"
juce::String stepOrder;       // "cycle", "random"
juce::String morphSource;     // "midi", "tempo", "audio"
float jitter = 0.0f;          // 0..1
float morphGlide = 200.0f;    // ms

// Morph runtime state (audio thread only, preserved across updateLogicBlocks)
float morphVelX = 0.0f, morphVelY = 0.0f;   // wander/bounce velocity
float morphAngle = 0.0f;                      // bounce angle (radians)
float morphLfoPhase = 0.0f;                   // LFO phase
int morphStepIndex = 0;                       // step trigger index
float morphSmoothX = 0.5f, morphSmoothY = 0.5f;  // smoothed playhead
```

Add readback struct (follow the same pattern as `EnvReadback` and `SampleReadback`):
```cpp
static constexpr int maxMorphReadback = 8;
struct MorphReadback {
    std::atomic<int>   blockId { -1 };
    std::atomic<float> headX   { 0.5f };
    std::atomic<float> headY   { 0.5f };
};
MorphReadback morphReadback[maxMorphReadback];
std::atomic<int> numActiveMorphBlocks { 0 };
```

### 3.2 `PluginProcessor.cpp` — updateLogicBlocks()

Add morph field parsing after the existing sample modulator parsing:
```cpp
// Morph Pad settings
lb.morphMode    = obj->getProperty("morphMode").toString();
lb.exploreMode  = obj->getProperty("exploreMode").toString();
lb.lfoShape     = obj->getProperty("lfoShape").toString();
lb.morphSpeed   = (float)(double) obj->getProperty("morphSpeed");
lb.morphAction  = obj->getProperty("morphAction").toString();
lb.stepOrder    = obj->getProperty("stepOrder").toString();
lb.morphSource  = obj->getProperty("morphSource").toString();
lb.playheadX    = (float)(double) obj->getProperty("playheadX");
lb.playheadY    = (float)(double) obj->getProperty("playheadY");
lb.jitter       = (float)(double) obj->getProperty("jitter");
lb.morphGlide   = (float)(double) obj->getProperty("morphGlide");

// Defaults
if (lb.morphMode.isEmpty())   lb.morphMode = "manual";
if (lb.exploreMode.isEmpty()) lb.exploreMode = "wander";
if (lb.lfoShape.isEmpty())    lb.lfoShape = "circle";
if (lb.morphAction.isEmpty()) lb.morphAction = "jump";
if (lb.stepOrder.isEmpty())   lb.stepOrder = "cycle";
if (lb.morphSource.isEmpty()) lb.morphSource = "midi";
if (lb.morphGlide <= 0.0f)    lb.morphGlide = 200.0f;

// Parse snapshots array
auto snapsVar = obj->getProperty("snapshots");
if (snapsVar.isArray()) {
    for (int si = 0; si < snapsVar.size() && si < 12; ++si) {
        if (auto* sObj = snapsVar[si].getDynamicObject()) {
            LogicBlock::MorphSnapshot snap;
            snap.x = (float)(double) sObj->getProperty("x");
            snap.y = (float)(double) sObj->getProperty("y");
            auto valsVar = sObj->getProperty("targetValues");
            if (valsVar.isArray()) {
                for (int vi = 0; vi < valsVar.size(); ++vi)
                    snap.targetValues.push_back((float)(double) valsVar[vi]);
            }
            lb.snapshots.push_back(snap);
        }
    }
}
```

In the "preserve runtime state" section, add:
```cpp
lb.morphVelX      = existing.morphVelX;
lb.morphVelY      = existing.morphVelY;
lb.morphAngle     = existing.morphAngle;
lb.morphLfoPhase  = existing.morphLfoPhase;
lb.morphStepIndex = existing.morphStepIndex;
lb.morphSmoothX   = existing.morphSmoothX;
lb.morphSmoothY   = existing.morphSmoothY;
```

### 3.3 `PluginProcessor.cpp` — processBlock() morph_pad branch

Add a new `else if` block after the sample mode processing, inside the Logic Block Engine section. The morph_pad counter variable `morphIdx` should be `int morphIdx = 0;` declared alongside `envIdx` and `smpIdx`.

```cpp
else if (lb.mode == "morph_pad" && !lb.snapshots.empty() && lb.enabled)
{
    float targetX = lb.playheadX;
    float targetY = lb.playheadY;

    // ── Trigger detection (for trigger mode) ──
    bool shouldTrigger = false;
    if (lb.morphMode == "trigger")
    {
        juce::String src = lb.morphSource;

        if (src == "midi") {
            // Reuse existing MIDI trigger pattern (same as randomize/sample)
            for (int ri = 0; ri < midiCount; ++ri) {
                auto& ev = midiRing[((readPos + ri) % midiRingSize)];
                if (lb.midiCh > 0 && ev.channel != lb.midiCh) continue;
                if (lb.midiMode == "any_note" && !ev.isCC) { shouldTrigger = true; break; }
                if (lb.midiMode == "specific_note" && !ev.isCC && ev.note == lb.midiNote) { shouldTrigger = true; break; }
                if (lb.midiMode == "cc" && ev.isCC && ev.note == lb.midiCC) { shouldTrigger = true; break; }
            }
        }
        if (src == "tempo" && playing) {
            float bpt = beatsPerTrig(lb.beatDiv);
            int currentBeat = (int) std::floor(ppq / bpt);
            if (lb.lastBeat < 0) lb.lastBeat = currentBeat;
            if (currentBeat != lb.lastBeat) { lb.lastBeat = currentBeat; shouldTrigger = true; }
        }
        if (src == "audio") {
            float audioLvl = (lb.audioSrc == "sidechain") ? scRms : mainRms;
            float threshLin = std::pow(10.0f, lb.threshold / 20.0f);
            double cooldownSamples = currentSampleRate * 0.1;
            if (audioLvl > threshLin && (sampleCounter - lb.lastAudioTrigSample) > cooldownSamples) {
                lb.lastAudioTrigSample = sampleCounter;
                shouldTrigger = true;
            }
        }
    }

    // ── Auto-Explore mode ──
    if (lb.morphMode == "auto")
    {
        float speed = lb.morphSpeed * 0.02f;

        if (lb.exploreMode == "wander") {
            lb.morphVelX += (audioRandom.nextFloat() - 0.5f) * speed * 0.5f;
            lb.morphVelY += (audioRandom.nextFloat() - 0.5f) * speed * 0.5f;
            lb.morphVelX *= 0.95f;
            lb.morphVelY *= 0.95f;
            targetX = juce::jlimit(0.0f, 1.0f, lb.playheadX + lb.morphVelX);
            targetY = juce::jlimit(0.0f, 1.0f, lb.playheadY + lb.morphVelY);
            if (targetX < 0.05f) lb.morphVelX += 0.01f;
            if (targetX > 0.95f) lb.morphVelX -= 0.01f;
            if (targetY < 0.05f) lb.morphVelY += 0.01f;
            if (targetY > 0.95f) lb.morphVelY -= 0.01f;
        }
        else if (lb.exploreMode == "bounce") {
            float dx = std::cos(lb.morphAngle) * speed;
            float dy = std::sin(lb.morphAngle) * speed;
            targetX = lb.playheadX + dx;
            targetY = lb.playheadY + dy;
            if (targetX < 0.0f || targetX > 1.0f) {
                lb.morphAngle = juce::MathConstants<float>::pi - lb.morphAngle;
                targetX = juce::jlimit(0.0f, 1.0f, targetX);
            }
            if (targetY < 0.0f || targetY > 1.0f) {
                lb.morphAngle = -lb.morphAngle;
                targetY = juce::jlimit(0.0f, 1.0f, targetY);
            }
        }
        else if (lb.exploreMode == "lfo") {
            float rate = speed * 0.1f;
            lb.morphLfoPhase += rate;
            if (lb.morphLfoPhase > juce::MathConstants<float>::twoPi)
                lb.morphLfoPhase -= juce::MathConstants<float>::twoPi;

            if (lb.lfoShape == "circle") {
                targetX = 0.5f + 0.4f * std::cos(lb.morphLfoPhase);
                targetY = 0.5f + 0.4f * std::sin(lb.morphLfoPhase);
            } else if (lb.lfoShape == "figure8") {
                targetX = 0.5f + 0.4f * std::sin(lb.morphLfoPhase);
                targetY = 0.5f + 0.4f * std::sin(lb.morphLfoPhase * 2.0f);
            } else if (lb.lfoShape == "sweepX") {
                targetX = 0.5f + 0.4f * std::sin(lb.morphLfoPhase);
                targetY = lb.playheadY;
            } else if (lb.lfoShape == "sweepY") {
                targetX = lb.playheadX;
                targetY = 0.5f + 0.4f * std::sin(lb.morphLfoPhase);
            }
        }

        lb.playheadX = targetX;
        lb.playheadY = targetY;
    }

    // ── Trigger mode — apply jump/step on trigger ──
    if (lb.morphMode == "trigger" && shouldTrigger)
    {
        int numSnaps = (int) lb.snapshots.size();
        if (lb.morphAction == "jump") {
            int ri = audioRandom.nextInt(numSnaps);
            targetX = lb.snapshots[ri].x;
            targetY = lb.snapshots[ri].y;
        } else if (lb.morphAction == "step") {
            if (lb.stepOrder == "cycle")
                lb.morphStepIndex = (lb.morphStepIndex + 1) % numSnaps;
            else
                lb.morphStepIndex = audioRandom.nextInt(numSnaps);
            targetX = lb.snapshots[lb.morphStepIndex].x;
            targetY = lb.snapshots[lb.morphStepIndex].y;
        }
        lb.playheadX = targetX;
        lb.playheadY = targetY;

        // Fire trigger notification to UI
        const auto tScope = triggerFifo.write(1);
        if (tScope.blockSize1 > 0)      triggerRing[tScope.startIndex1] = lb.id;
        else if (tScope.blockSize2 > 0)  triggerRing[tScope.startIndex2] = lb.id;
    }

    // ── Apply jitter ──
    float finalX = lb.playheadX;
    float finalY = lb.playheadY;
    if (lb.jitter > 0.001f) {
        finalX += (audioRandom.nextFloat() - 0.5f) * lb.jitter * 0.2f;
        finalY += (audioRandom.nextFloat() - 0.5f) * lb.jitter * 0.2f;
        finalX = juce::jlimit(0.0f, 1.0f, finalX);
        finalY = juce::jlimit(0.0f, 1.0f, finalY);
    }

    // ── Smooth playhead (glide) ──
    float glideCoeff = std::exp(-1.0f / std::max(1.0f, lb.morphGlide * 0.001f * bufferRate));
    lb.morphSmoothX = glideCoeff * lb.morphSmoothX + (1.0f - glideCoeff) * finalX;
    lb.morphSmoothY = glideCoeff * lb.morphSmoothY + (1.0f - glideCoeff) * finalY;

    // ── IDW Interpolation ──
    // Compute weights based on playhead distance to each snapshot
    float totalWeight = 0.0f;
    std::vector<float> weights(lb.snapshots.size(), 0.0f);
    for (size_t si = 0; si < lb.snapshots.size(); ++si) {
        float dx = lb.morphSmoothX - lb.snapshots[si].x;
        float dy = lb.morphSmoothY - lb.snapshots[si].y;
        float dist = std::sqrt(dx * dx + dy * dy);
        float w = 1.0f / (dist + 0.001f);
        weights[si] = w;
        totalWeight += w;
    }
    if (totalWeight > 0.0f)
        for (auto& w : weights) w /= totalWeight;

    // ── Mix target values and apply ──
    for (size_t ti = 0; ti < lb.targets.size(); ++ti) {
        float mixed = 0.0f;
        for (size_t si = 0; si < lb.snapshots.size(); ++si) {
            if (ti < lb.snapshots[si].targetValues.size())
                mixed += weights[si] * lb.snapshots[si].targetValues[ti];
        }
        mixed = juce::jlimit(0.0f, 1.0f, mixed);
        setParamDirect(lb.targets[ti].pluginId, lb.targets[ti].paramIndex, mixed);
    }

    // ── Write playhead readback for UI ──
    if (morphIdx < maxMorphReadback) {
        morphReadback[morphIdx].blockId.store(lb.id);
        morphReadback[morphIdx].headX.store(lb.morphSmoothX);
        morphReadback[morphIdx].headY.store(lb.morphSmoothY);
        morphIdx++;
    }
}
```

After the loop, store the count:
```cpp
numActiveMorphBlocks.store(morphIdx);
```

### ⚠️ REAL-TIME SAFETY NOTE

The `std::vector<float> weights(...)` inside processBlock is a **heap allocation**. For production safety, consider using a fixed-size array:
```cpp
float weights[12] = {};  // max 12 snapshots
int numSnaps = juce::jmin((int) lb.snapshots.size(), 12);
```
This avoids audio-thread allocation entirely.

---

## Phase 4: Editor Bridge

### 4.1 `PluginEditor.cpp` — timerCallback()

In the section that builds `__rt_data__` JSON, add morph readback (follow the same pattern as envelope and sample readback):

```cpp
int numMorph = processor.numActiveMorphBlocks.load();
if (numMorph > 0) {
    auto morphArr = juce::Array<juce::var>();
    for (int i = 0; i < numMorph; ++i) {
        auto* obj = new juce::DynamicObject();
        obj->setProperty("id", processor.morphReadback[i].blockId.load());
        obj->setProperty("x", (double) processor.morphReadback[i].headX.load());
        obj->setProperty("y", (double) processor.morphReadback[i].headY.load());
        morphArr.add(juce::var(obj));
    }
    rtObj->setProperty("morphHeads", morphArr);
}
```

---

## Phase 5: Persistence

### 5.1 `js/persistence.js`

In `saveUiStateToHost()`, add morph fields to block serialisation:
```js
snapshots: b.snapshots,         // full objects with {x, y, values, name}
playheadX: b.playheadX,
playheadY: b.playheadY,
morphMode: b.morphMode,
exploreMode: b.exploreMode,
lfoShape: b.lfoShape,
morphSpeed: b.morphSpeed,
morphAction: b.morphAction,
stepOrder: b.stepOrder,
morphSource: b.morphSource,
jitter: b.jitter,
morphGlide: b.morphGlide
```

In `restoreFromHost()`, restore morph fields with defaults:
```js
snapshots: bd.snapshots || [],
playheadX: bd.playheadX !== undefined ? bd.playheadX : 0.5,
playheadY: bd.playheadY !== undefined ? bd.playheadY : 0.5,
morphMode: bd.morphMode || 'manual',
exploreMode: bd.exploreMode || 'wander',
lfoShape: bd.lfoShape || 'circle',
morphSpeed: bd.morphSpeed !== undefined ? bd.morphSpeed : 50,
morphAction: bd.morphAction || 'jump',
stepOrder: bd.stepOrder || 'cycle',
morphSource: bd.morphSource || 'midi',
jitter: bd.jitter || 0,
morphGlide: bd.morphGlide || 200
```

---

## Phase 6: Build + Test

### 6.1 Check CMakeLists.txt

Verify all new/modified CSS and JS files are listed in `juce_add_binary_data()`. If you added any new files (unlikely since you're modifying existing ones), add them.

### 6.2 Build

```powershell
.\scripts\build-and-install.ps1 -PluginName ModularRandomizer
```

### 6.3 Test Checklist

- [ ] Plugin loads without crash
- [ ] Morph Pad button appears in add-wrap bar alongside other 3 buttons
- [ ] All 4 buttons fit without overflow
- [ ] Clicking "+ Morph Pad" creates a new block with morph_pad mode
- [ ] Mode segmented control shows all 4 modes (Randomize, Envelope, Sample, Morph Pad)
- [ ] XY pad renders with grid lines
- [ ] "Add a snapshot to begin" shows when no snapshots
- [ ] "+ Snap" captures current target values and places dot
- [ ] Snapshot dots are draggable within the pad
- [ ] Playhead dot is draggable in Manual mode
- [ ] Playhead dot is NOT draggable in Auto/Trigger modes
- [ ] Auto mode moves playhead (wander/bounce/lfo)
- [ ] Trigger mode responds to MIDI/tempo/audio
- [ ] Jitter slider randomises playhead position slightly
- [ ] Glide slider smooths parameter transitions
- [ ] Snapshots can be deleted (including all of them)
- [ ] 0 snapshots = passthrough (no parameter changes)
- [ ] Plugin state saves and restores correctly (close/reopen DAW project)
- [ ] Existing block modes (randomize, envelope, sample) still work correctly
- [ ] Plugin unloads without crash

---

## Snapshot Value Storage Format

Each snapshot stores values as an **object keyed by param ID** (in JS):
```js
snapshot.values = {
    "1:3": 0.75,    // pluginId:paramIndex = value
    "1:7": 0.20,
    "2:0": 0.50
}
```

When syncing to C++, this is flattened to an array aligned with the block's current targets order. If a snapshot doesn't have a value for a target (param added after snapshot was created), it falls back to `0.5` (centre). When a param is removed from targets, the snapshot's extra keys are simply ignored — no data loss.

---

## File Change Summary

| File | Scope | What Changes |
|------|-------|--------------|
| `index.html` | Minor | Add `+ Morph Pad` button |
| `css/variables.css` | Minor | Add `--morph-color` |
| `css/logic_blocks.css` | **Major** | Morph pad, dot, chip, button styles |
| `js/theme_system.js` | Medium | `--morph-color` per theme |
| `js/logic_blocks.js` | **Major** | `renderMorphBody()`, `addBlock()`, `buildBlockCard()`, `wireBlocks()`, `syncBlocksToHost()` |
| `js/controls.js` | Minor | Button click handler |
| `js/persistence.js` | Medium | Save/restore morph fields |
| `js/realtime.js` | Medium | Morph playhead readback |
| `PluginProcessor.h` | Medium | Extend LogicBlock struct + MorphReadback |
| `PluginProcessor.cpp` | **Major** | JSON parse + processBlock morph branch |
| `PluginEditor.cpp` | Medium | Morph readback in `__rt_data__` |
