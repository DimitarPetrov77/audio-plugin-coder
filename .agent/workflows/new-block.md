---
description: Add a new Logic Block type to the ModularRandomizer plugin (UI + DSP + wiring)
---

# New Logic Block Workflow

This workflow adds a new Logic Block type to the ModularRandomizer plugin. Follow every step exactly.
Missing ANY step will cause silent failures (block won't automate, won't animate, won't persist correctly).

## Prerequisites

The user must provide:
- **Mode name** — the internal `mode` string (e.g. `"step_seq"`, `"gravity"`, `"macro"`)
- **Display label** — what the user sees in the UI (e.g. `"Step Sequencer"`, `"Gravity"`, `"Macro Knob"`)
- **Block type** — `continuous` (like Shapes/Envelope: outputs a stream) or `triggered` (like Randomize: fires on events)
- **Brief description** — what it does musically

---

## PART 1: JavaScript UI (7 files to touch)

### Step 1: Add the "+" button in index.html

**File:** `plugins/ModularRandomizer/Source/ui/public/index.html`  
**Location:** Inside `<div class="add-wrap">` (lines 135–151)

Add a new button entry before the closing `</div>`:

```html
<button class="add-blk" id="add{PascalName}" style="border-left:3px solid var(--{mode}-color, #HEXCOLOR)">+
    {Display Label}</button>
```

### Step 2: Wire the "+" button

**File:** `plugins/ModularRandomizer/Source/ui/public/js/controls.js`  
**Location:** After line 87 (existing `addBlock` handlers at lines 81–87)

```javascript
document.getElementById('add{PascalName}').onclick = function () { addBlock('{mode_name}'); };
```

**Also check line 285:** There's a keyboard shortcut guard `if (b.mode === 'lane') return;` — decide if your block needs a similar guard for the R key (randomize all targets).

### Step 3: Add default block state

**File:** `plugins/ModularRandomizer/Source/ui/public/js/logic_blocks.js`  
**Location:** Inside `addBlock()` function (lines 120–133)

If your block has custom fields, add them as defaults. If it only uses existing fields (trigger, polarity, speed, etc.), skip this — they already exist.

### Step 4: Write the render function

**File:** `plugins/ModularRandomizer/Source/ui/public/js/logic_blocks.js`  
**Location:** After the last render function (~line 935, after `renderShapesRangeBody`)

Create `render{PascalName}Body(b)` — must accept `(b)` and return HTML string.

**Available helpers:**
- `buildBlockKnob(val, min, max, size, mode, field, blockId, label, unit)` — SVG arc knob
- `buildKnobRow(html)` — horizontal knob layout
- `renderBeatDivSelect(blockId, field, currentVal)` — tempo division dropdown
- `buildDetectionBandSection(b, mode)` — LP/HP/BP audio selector
- `buildShapeOptions(field, b)` — shape type selector (15 shapes)
- Segmented buttons: `<div class="seg" data-b="ID" data-f="field">...</div>`
- Toggles: `<div class="tgl" data-b="ID" data-f="field"></div>`

### Step 5: Register in buildBlockCard() — 5 SUB-STEPS

**File:** `plugins/ModularRandomizer/Source/ui/public/js/logic_blocks.js`

**5a. Mode CSS class** (line 150) — add to the ternary chain:
```javascript
// Current pattern ends with: (b.mode === 'lane' ? ' mode-lane' : ' mode-smp')
// Insert your mode BEFORE the final fallback ' mode-smp'
```

**5b. Active highlight class** (line 151) — add:
```javascript
+ (b.mode === '{mode_name}' && isAct ? ' {mode}-active' : '')
```

**5c. Summary text** (lines 153–158) — add an `else if`:
```javascript
else if (b.mode === '{mode_name}') { sum = '{Label} / ' + someInfo; }
```

**5d. Mode button** (line 188) — add your button to the `<div class="seg">`:
```html
<button class="' + (b.mode === '{mode_name}' ? 'on' : '') + '" data-v="{mode_name}">{Display Label}</button>
```

**5e. Body dispatch** (line 190) — add to the if/else chain:
```javascript
else if (b.mode === '{mode_name}') bH += render{PascalName}Body(b);
```

### Step 6: Register modulation arc (continuous blocks ONLY)

**File:** `plugins/ModularRandomizer/Source/ui/public/js/plugin_rack.js`  
**Location:** Inside `MOD_ARC_REGISTRY` (lines 484–600)

This gives animated modulation arcs on param knobs for FREE:

```javascript
{mode_name}: {
    getDepth: function(b, pid) { return b.myDepth / 100; },
    getPolarity: function(b) { return b.polarity || 'bipolar'; },
    getOutput: function(b, pid) { return b.myReadbackValue || 0; },
    outputType: 'bipolar'  // 'bipolar' (-1..1), 'unipolar' (0..1), or 'absolute' (0..1)
},
```

**Also check:** If your block needs per-param state when a target is assigned (like shapes_range does at line 1351), add initialization logic to the assign handler in `plugin_rack.js`:
```javascript
if (b.mode === '{mode_name}') { /* init per-param state */ }
```

**Also check line 727 `updateModBases()`:** If your block tracks per-param base values, add a branch here.

### Step 7: Sync to host — mode-specific fields

**File:** `plugins/ModularRandomizer/Source/ui/public/js/logic_blocks.js`  
**Location:** Inside `syncBlocksToHost()` (lines 2580–2634)

**IMPORTANT:** This function uses conditional blocks per mode. Generic fields (trigger, rMax, etc.) are already sent. But mode-specific fields MUST be wrapped in a conditional:

```javascript
if (b.mode === '{mode_name}') {
    obj.myCustomField = b.myCustomField;
    obj.anotherField = (b.anotherField || 50) / 100;
}
```

Look at the existing patterns: `morph_pad` (line 2580), `shapes` (line 2610), `lane` (line 2635).

### Step 8: Register in BLOCK_EXPOSABLE_PARAMS ⚠️ EASY TO MISS

**File:** `plugins/ModularRandomizer/Source/ui/public/js/expose_system.js`  
**Location:** Inside `BLOCK_EXPOSABLE_PARAMS` (lines 18–70)

Add an entry defining which params DAW automation can control:

```javascript
{mode_name}: [
    { key: 'mySpeed', label: 'Speed', type: 'float', min: 0, max: 100, suffix: '%' },
    { key: 'myDepth', label: 'Depth', type: 'float', min: 0, max: 100, suffix: '%' },
    { key: 'enabled', label: 'Enabled', type: 'bool' }
],
```

**Without this, the block's params WON'T appear in the Expose to DAW dropdown and can't be automated.**

### Step 9: Add realtime readback handler ⚠️ EASY TO MISS

**File:** `plugins/ModularRandomizer/Source/ui/public/js/realtime.js`  
**Location:** Inside `setupRtDataListener()` — look at existing mode-specific handlers:
- Line 214: Envelope reads `envLevels`
- Line 351: Morph pad reads `morphHeads`
- Line 413: Shapes reads `shapeHeads`
- Line 484: Lane reads `laneHeads`

For continuous blocks, add a handler that reads the C++ readback data and writes it to the block object (e.g., `b.myModOutput = readbackValue`). This is what makes the modulation arcs animate and meters move.

For triggered blocks, check line ~200 area where trigger flash events are consumed — your block already participates via `triggerFifo` without extra code.

### Step 10: CSS styles

**File:** `plugins/ModularRandomizer/Source/ui/public/css/variables.css` — add `--{mode}-color: #HEX;`

**File:** `plugins/ModularRandomizer/Source/ui/public/css/logic_blocks.css` — add:

```css
.lcard.mode-{mode} .lhead { border-left-color: var(--{mode}-color); }
.lcard.mode-{mode}.active .lhead { background: color-mix(in srgb, var(--{mode}-color) 15%, var(--bg-card)); }
.lcard.mode-{mode} .block-section-label { color: var(--{mode}-color); }
```

---

## PART 2: C++ Backend (3 files to touch)

### Step 11: Add BlockMode enum

**File:** `plugins/ModularRandomizer/Source/PluginProcessor.h`  
**Location:** Line 916

```cpp
enum class BlockMode : uint8_t { Randomize, Envelope, Sample, MorphPad, Shapes, ShapesRange, Lane, {PascalName}, Unknown };
```

### Step 12: Add mode parser

**File:** `plugins/ModularRandomizer/Source/PluginProcessor.cpp`  
**Location:** Inside `parseBlockMode()` (lines 20–28)

```cpp
if (s == "{mode_name}") return BlockMode::{PascalName};
```

### Step 13: Add runtime state to LogicBlock struct (if needed)

**File:** `plugins/ModularRandomizer/Source/PluginProcessor.h`  
**Location:** Inside `struct LogicBlock` (~line 963)

```cpp
// ── {Display Label} ──
float myPhase = 0.0f;
float mySmoothedValue = 0.0f;
```

### Step 14: Parse custom fields in updateLogicBlocks()

**File:** `plugins/ModularRandomizer/Source/PluginProcessor.cpp`  
**Location:** Inside `updateLogicBlocks()`, after the Shapes Block fields section (~line 577)

```cpp
// ── {Display Label} Block fields ──
lb.myField = (float)(double) obj->getProperty("myField");
```

### Step 15: Implement audio processing

**File:** `plugins/ModularRandomizer/Source/ProcessBlock.cpp`  
**Location:** Inside the main block loop (~line 458), after the last mode case

```cpp
// ===== {DISPLAY_LABEL} MODE =====
else if (lb.modeE == BlockMode::{PascalName})
{
    // YOUR DSP LOGIC HERE
}
```

**Available audio thread helpers:**
| Function | Purpose |
|---|---|
| `checkTrigger(lb)` | MIDI/tempo/audio trigger detection |
| `getFilteredAudioLevel(lb)` | Band-filtered RMS |
| `computeShapeXY(shape, t, R)` | 2D shape geometry (15 shapes) |
| `addModOffset(pluginId, paramIndex, offset)` | Continuous modulation (summed in modbus) |
| `setParamDirect(pluginId, paramIndex, value)` | Immediate param set (triggered blocks) |
| `updateParamBase(pluginId, paramIndex, value)` | Update base value |
| `glidePool[]` / `numActiveGlides` | Smooth glide transitions |
| `envReadback[idx]` | Write readback for UI meters |
| `triggerFifo.write(1)` | Notify UI of trigger flash |

**Audio thread rules:** ZERO heap allocations. No `new`, no `std::string`, no `push_back`. Use pre-allocated arrays. All float math.

### Step 16: Write C++ readback data (continuous blocks)

**File:** `plugins/ModularRandomizer/Source/ProcessBlock.cpp` (inside your case)

```cpp
if (envIdx < maxEnvReadback) {
    envReadback[envIdx].blockId.store(lb.id);
    envReadback[envIdx].level.store(outputLevel);
    envIdx++;
}
```

OR define a new readback channel if the existing ones (envReadback, morphReadback, shapeReadback, laneReadback) don't fit your data shape.

---

## PART 3: Verification Checklist

After implementing all steps, verify:

- [ ] Click "+" button — block appears
- [ ] Mode buttons in card — switching works, body renders correctly
- [ ] Assign params — targets appear in target list
- [ ] Modulation arcs on param knobs animate (continuous blocks)
- [ ] Expose dropdown shows block params under Logic Blocks section
- [ ] DAW automation of exposed block params works (two-way)
- [ ] Save/reload project — block state preserved
- [ ] Save/load preset — block included
- [ ] Undo/redo (Ctrl+Z/Y) — block changes roll back correctly
- [ ] Duplicate block (right-click header) — deep copy works
- [ ] Delete block — clean removal

---

## What IS Automatic (No Changes Needed)

| System | Why |
|---|---|
| **Core persistence** | `saveUiStateToHost()` serializes all block fields via JSON |
| **Basic preset save/load** | Saves full `blocks` array (but check for mode-specific branches) |
| **Undo/Redo** | `pushUndoSnapshot()` captures full block state |
| **Target assignment** | Drag-drop and Assign mode work generically |
| **Color system** | Auto-assigns from `LANE_COLORS` palette |
| **Block duplication** | Deep clone via context menu copies any block |
| **Block deletion** | Generic handler removes any block |
| **Trigger flash** | Uses shared `triggerFifo` — already wired for all modes |

## What is NOT Automatic (Mode-Specific Branches Exist)

| System | File | What to check |
|---|---|---|
| **Expose to DAW** | `expose_system.js` | Must add `BLOCK_EXPOSABLE_PARAMS` entry |
| **Realtime readback** | `realtime.js` | Must add handler for mode's data channel |
| **Target assignment init** | `plugin_rack.js:1351` | May need per-param state init |
| **Mod base tracking** | `plugin_rack.js:727` | May need `updateModBases` branch |
| **Sync to host** | `logic_blocks.js:2580` | Mode-specific fields need conditional block |
| **Post-restore hooks** | `persistence.js:545` | May need canvas/init call after restore |
| **Preset mode branches** | `preset_system.js:1020,1579` | May need mode-specific save/load logic |
| **Keyboard guards** | `controls.js:285` | May need mode guard for R key |
