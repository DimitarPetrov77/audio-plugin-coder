# ModularRandomizer UI Refactoring Plan
## From 4262-line monolith → Feature-level modules

---

## Current State

**The problem:** Everything is in a single `index.html` (4262 lines, 191KB):
- ~2170 lines of CSS (inline `<style>`)
- ~2090 lines of JavaScript (inline `<script>`)
- Existing `style.css` (1291 lines) and `app.js` (416 lines) are **dead files** — never referenced

**CMakeLists.txt** only embeds `index.html` as binary data.
**`getResource()`** in `PluginEditor.cpp` ignores the URL and always returns `index.html`.

---

## Target Structure

Modules named by **what they do**, not by technical role:

```
Source/ui/public/
├── index.html                    # Slim shell: HTML structure + <link>/<script> tags (~200 lines)
│
├── css/
│   ├── variables.css             # Design tokens: colors, fonts, spacing
│   ├── base.css                  # Reset, body, scrollbar, range input
│   ├── header.css                # Top bar, branding, bypass, mix, status
│   ├── plugin-rack.css           # Plugin cards, param rows, drag states
│   ├── logic-blocks.css          # Block cards, controls, targets, waveforms
│   ├── dialogs.css               # Modal overlays: browser, presets, context menus
│   └── themes.css                # Theme definitions and color overrides
│
├── js/
│   ├── juce-bridge.js            # JUCE native function polyfill (loads first, zero deps)
│   ├── state.js                  # All global declarations: PMap, pluginBlocks, blocks, etc.
│   ├── theme-system.js           # THEMES object, applyTheme(), renderThemeGrid(), settings panel
│   ├── undo-system.js            # pushUndoSnapshot(), performUndo(), undo stack
│   ├── plugin-rack.js            # Plugin hosting: load/remove/reorder, card rendering, param rows, drag/drop, search, context menu
│   ├── preset-system.js          # Plugin presets + global presets: save/load/delete, modal wiring, buildGlobalPresetData()
│   ├── logic-blocks.js           # Block CRUD, card rendering, wireBlockDropTargets, assignment mode, param assignment
│   ├── randomize-engine.js       # Core randomize(), envelope follower, sample modulator, glide management
│   ├── host-sync.js              # syncBlocksToHost(), saveUiStateToHost(), restoreFromHost(), refreshParamDisplay()
│   ├── realtime-data.js          # processRealTimeData(), setupRtDataListener(), MIDI/RMS/BPM handling
│   ├── plugin-browser.js         # Scan modal: doScanPlugins(), renderModalList(), scan path management
│   └── init.js                   # Orchestrator: button wiring, bypass/mix/scale handlers, calls restoreFromHost()
```

**Dead files to delete:** `app.js`, `style.css`

---

## Module Responsibility Map

### CSS Modules

| Module | Content | Lines |
|--------|---------|-------|
| `variables.css` | `:root` custom properties, font imports | ~60 |
| `base.css` | `*` reset, `body`, `.app`, scrollbar, range input track/thumb | ~80 |
| `header.css` | `.header`, `.brand`, `.bypass`, `.mix-area`, `.h-right`, status dots, settings dropdown, scale selector | ~150 |
| `plugin-rack.css` | `.pcard`, `.pcard-head`, `.pcard-body`, `.pr`, `.pr-bar`, `.pr-dots`, `.pr-lock`, `.pcard-search`, assign states, drag-over, touched animation, bypassed | ~380 |
| `logic-blocks.css` | `.lcard`, `.lhead`, `.lbody`, `.seg`, `.tgl`, `.sl-row`, `.brow`, `.tgt-box`, `.tg`, waveform canvas, block-color dot, assignment banner | ~530 |
| `dialogs.css` | `.modal`, `.plug-row`, `.ctx`, preset modal, global preset modal, scan path rows, plugin browser, overlay, plugin context menu | ~500 |
| `themes.css` | All `THEMES[...]` color override definitions as CSS vars | ~200 |

### JS Modules

| Module | What it owns | Key functions | Source lines |
|--------|-------------|---------------|-------------|
| **`juce-bridge.js`** | Native function call mechanism | `__juceGetNativeFunction()` polyfill IIFE | 2177–2230 |
| **`state.js`** | Every global variable | `PMap`, `pluginBlocks`, `blocks`, `bc`, `actId`, `assignMode`, `selectedParams`, `rtData`, `scannedPlugins`, `allParams()`, `findBlock()`, `bColor()`, `noteName()`, `BCOLORS` | 2371–2420 |
| **`theme-system.js`** | Visual theme switching | `THEMES{}`, `applyTheme()`, `renderThemeGrid()`, settings panel toggle | 2233–2370 |
| **`undo-system.js`** | State snapshots + restore | `pushUndoSnapshot()`, `performUndo()`, undo stack management | 2388–2420 |
| **`plugin-rack.js`** | Plugin hosting lifecycle + UI | `addPlugin()`, `removePlugin()`, `renderAllPlugins()`, `wirePluginCards()`, `buildPluginCard()`, `fillPluginParams()`, param row click/drag handlers, plugin reorder drag/drop, `showParamCtx()`, `showPlugCtx()`, plugin context menu handlers | 2420–2970 |
| **`preset-system.js`** | All preset persistence | Plugin presets: `openPresetBrowser()`, `closePresetBrowser()`, `refreshPresetList()`, `savePresetFromInput()`, `loadPreset()`, `deletePreset()`. Global presets: `openGlobalPresetBrowser()`, `closeGlobalPresetBrowser()`, `refreshGlobalPresetList()`, `buildGlobalPresetData()`, `saveGlobalPresetFromInput()`, `loadGlobalPreset()`, `applyGlobalPreset()`, `deleteGlobalPreset()`, `updateGpNameDisplay()`, modal wiring | 2970–3350 |
| **`logic-blocks.js`** | Block lifecycle + assignment | `addBlock()`, `renderBlocks()`, `buildBlockCard()`, `wireBlocks()`, `wireBlockDropTargets()`, `renderSingleBlock()`, assignment mode toggle, `updateAssignBanner()`, block mode switching, block enable/disable, target removal | 3350–3643 |
| **`randomize-engine.js`** | Core modulation logic | `randomize()`, envelope simulation, sample playback, `startGlide()`, `drawSampleWaveform()`, quantize snapping | 3644–3685 |
| **`host-sync.js`** | C++ backend synchronization | `syncBlocksToHost()`, `refreshParamDisplay()`, `updCounts()`, `saveUiStateToHost()`, `restoreFromHost()` | 3686–3717, 4001–4210 |
| **`realtime-data.js`** | Live data from processor | `processRealTimeData()`, `setupRtDataListener()`, MIDI event handling, RMS levels, BPM tracking, auto-locate logic | 3718–3840 |
| **`plugin-browser.js`** | VST3 scan + browse modal | `openPluginBrowser()`, `closePluginBrowser()`, `doScanPlugins()`, `renderModalList()`, `renderScanPaths()`, category/search filtering | 3899–4000 |
| **`init.js`** | Startup wiring | Bypass button handler, mix slider handler, scale dropdown, auto-locate checkbox, add-block buttons, add-plugin button, undo button, `initJuceIntegration()`, calls `restoreFromHost()` | 3841–3898, 4211–4262 |

---

## Script Load Order

```html
<!-- Infrastructure (must load first) -->
<script src="js/juce-bridge.js"></script>
<script src="js/state.js"></script>

<!-- Feature systems (order matters for cross-references) -->
<script src="js/theme-system.js"></script>
<script src="js/undo-system.js"></script>
<script src="js/plugin-rack.js"></script>
<script src="js/preset-system.js"></script>
<script src="js/logic-blocks.js"></script>
<script src="js/randomize-engine.js"></script>
<script src="js/host-sync.js"></script>
<script src="js/realtime-data.js"></script>
<script src="js/plugin-browser.js"></script>

<!-- Startup (must load last) -->
<script src="js/init.js"></script>
```

All scripts are plain `<script>` tags (no ES6 modules). Functions reference each other via global scope.

---

## Implementation Phases

### Phase 1: CSS Extraction (LOW RISK)
1. Create `css/` directory with 7 files
2. Replace `<style>...</style>` with `<link>` tags
3. Update CMakeLists.txt + getResource()
4. **Build + test**

### Phase 2: Infrastructure JS (MEDIUM RISK)
1. Extract `juce-bridge.js` (self-contained IIFE)
2. Extract `state.js` (global declarations)
3. Update CMakeLists.txt + getResource()
4. **Build + test** — native bridge must survive

### Phase 3: Feature Systems (HIGH RISK — sequential)
Extract one at a time, build+test after each:
1. `theme-system.js` — standalone
2. `undo-system.js` — simple, few deps
3. `plugin-rack.js` — large, the plugin card rendering system
4. `preset-system.js` — preset save/load/delete for both plugin and global
5. `logic-blocks.js` — block cards, assignment, rendering
6. `randomize-engine.js` — core modulation
7. `host-sync.js` — state persistence and sync
8. `realtime-data.js` — live data processing
9. `plugin-browser.js` — scan modal
10. `init.js` — bootstrap wiring

### Phase 4: Cleanup
1. Delete dead: `app.js`, `style.css`
2. Full build + DAW test
3. Git commit

---

## C++ Changes Required

### 1. CMakeLists.txt — Register all files
```cmake
juce_add_binary_data(ModularRandomizerWebUI
    HEADER_NAME "BinaryData.h"
    NAMESPACE BinaryData
    SOURCES
        Source/ui/public/index.html
        Source/ui/public/css/variables.css
        Source/ui/public/css/base.css
        Source/ui/public/css/header.css
        Source/ui/public/css/plugin-rack.css
        Source/ui/public/css/logic-blocks.css
        Source/ui/public/css/dialogs.css
        Source/ui/public/css/themes.css
        Source/ui/public/js/juce-bridge.js
        Source/ui/public/js/state.js
        Source/ui/public/js/theme-system.js
        Source/ui/public/js/undo-system.js
        Source/ui/public/js/plugin-rack.js
        Source/ui/public/js/preset-system.js
        Source/ui/public/js/logic-blocks.js
        Source/ui/public/js/randomize-engine.js
        Source/ui/public/js/host-sync.js
        Source/ui/public/js/realtime-data.js
        Source/ui/public/js/plugin-browser.js
        Source/ui/public/js/init.js
)
```

### 2. getResource() — URL routing (CloudWash pattern)
Rewrite from "always return index.html" to proper path routing with MIME types and 404 fallback.

### 3. PluginEditor.h — Add helper methods
`getMimeForExtension()`, `getExtension()` — copy from CloudWash.

---

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| Cross-file function calls break | Strict load order; grep all function names after each extraction |
| BinaryData name mangling (hyphens) | JUCE replaces `-` with `_`: `plugin-rack.css` → `pluginrack_css`. Verify in BinaryData.h |
| Font loading from external URL | Keep `@import` in variables.css — works fine in WebView2 |
| getResource routing bugs | Add CloudWash-style 404 fallback page listing all available resources |

---

## Estimated Effort
- Phase 1 (CSS): ~30 min
- Phase 2 (Infrastructure): ~20 min
- Phase 3 (Feature systems, 10 modules): ~2-3 hours
- Phase 4 (Cleanup): ~10 min
- **Total: ~3-4 hours**
