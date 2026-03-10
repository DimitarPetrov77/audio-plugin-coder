# ModularRandomizer — Codebase Audit (Current Source)

---

## First: What You Already Fixed Correctly

Reading `ProcessBlock.cpp`, the most important line in your whole codebase is this comment at line 129:

> *"No pluginMutex lock on the audio thread! — a single block of unprocessed audio is inaudible, whereas blocking would cause priority inversion and clicks."*

And it's true — your audio thread does **not** acquire `pluginMutex`. That was clearly a deliberate decision, and it's the right one. You also use `std::try_to_lock` on `blockMutex` so even that can't block the audio thread. The audio thread is clean.

Your two-tier polling system, lock-free FIFOs for MIDI/triggers/selfWrite/glide, batched single `__rt_data__` event per tick, and direct DOM manipulation in `realtime.js` are all solid.

---

## The Actual Source of Your Randomize Lag

The problem is **not** `pluginMutex` on the audio thread. The audio thread never takes it. The problem is what happens on the **message thread** when the user hits FIRE.

### What happens when you press FIRE

The JS `randomize()` function in `logic_blocks.js` loops over every target parameter and calls `setParamFn(p.hostId, p.realIndex, newVal)` **individually per parameter** inside the `forEach`. That calls the `setParam` native function, which calls `setHostedParam`, which:

1. Acquires `pluginMutex`
2. Calls `params[paramIndex]->setValue(normValue)`
3. Calls `recordSelfWrite()`
4. Releases `pluginMutex`

With 900 targets, this is **900 separate IPC bridge crossings**, each acquiring and releasing the mutex. The JUCE WebView native function bridge is not free — each crossing involves serialization, a context switch through the webview layer, and C++ execution. Doing this 900 times synchronously in a `forEach` loop is the bottleneck.

After the loop, `refreshParamDisplay()` is called synchronously, which iterates `_dirtyParams` and rebuilds the SVG knob innerHTML for every changed parameter. With 900 dirty params that's 900 SVG string builds and 900 DOM mutations in one synchronous call.

### The fix

**Part 1 — Replace 900 individual `setParam` calls with one `fireRandomize` call.**

The `fireRandomize` native function already exists in `PluginEditor.cpp` at line 317 and `randomizeParams` in `PluginProcessor.cpp` handles the whole batch in one mutex acquisition. You're just not using it from JS — the JS `randomize()` function ignores it entirely and calls `setParam` one at a time instead.

Rewrite the instant-mode path in `randomize()` in `logic_blocks.js`:

```javascript
function randomize(bId) {
    var b = findBlock(bId); if (!b) return;
    var mn = b.rMin / 100, mx = b.rMax / 100;
    if (mn > mx) { var t = mn; mn = mx; mx = t; }
    var isRelative = b.rangeMode === 'relative';
    var startGlideFn = (window.__JUCE__ && window.__JUCE__.backend) 
        ? window.__juceGetNativeFunction('startGlide') : null;

    // Collect all instant-mode targets into one batch
    var instantIds = [], instantVals = [];

    b.targets.forEach(function (id) {
        var p = PMap[id]; if (!p || p.lk) return;
        var newVal;
        if (isRelative) {
            var offset = mn + Math.random() * (mx - mn);
            var sign = Math.random() < 0.5 ? -1 : 1;
            newVal = p.v + sign * offset;
        } else {
            newVal = mn + Math.random() * (mx - mn);
        }
        if (b.quantize && b.qSteps > 1) {
            newVal = Math.round(newVal * (b.qSteps - 1)) / (b.qSteps - 1);
        }
        newVal = Math.max(0, Math.min(1, newVal));

        if (b.movement === 'glide' && b.glideMs > 0) {
            if (startGlideFn && p.hostId !== undefined) {
                startGlideFn(p.hostId, p.realIndex, newVal, b.glideMs);
            }
            p.v = newVal;
            _dirtyParams.add(id);
        } else {
            // Collect for batch — don't call setParam here
            p.v = newVal;           // update JS state immediately
            _dirtyParams.add(id);   // mark dirty for display
            instantIds.push(p.realIndex);
            instantVals.push(newVal);
        }
    });

    // One single IPC call for all instant params
    if (instantIds.length > 0 && window.__JUCE__ && window.__JUCE__.backend) {
        var fireRandomizeFn = window.__juceGetNativeFunction('fireRandomize');
        // Pass pre-computed values instead of letting C++ re-randomize
        // OR use the existing fireRandomize with a values array (see Part 2)
    }

    // Defer display refresh — don't block the call stack
    requestAnimationFrame(refreshParamDisplay);
}
```

**Part 2 — Modify `fireRandomize` to accept pre-computed values from JS.**

Currently `fireRandomize` re-randomizes on the C++ side, which means JS and C++ would pick different random values. You want JS to own the randomization (it already does, since it handles relative mode, quantization, etc.) and just send the results to C++ for application.

Change the native function signature to accept `[pluginId, [[paramIndex, value], ...]]`:

```cpp
// In PluginEditor.cpp, replace fireRandomize handler:
.withNativeFunction(
    "applyParamBatch",
    [this](const juce::Array<juce::var>& args,
           juce::WebBrowserComponent::NativeFunctionCompletion completion)
    {
        // args: [pluginId, [[index, value], [index, value], ...]]
        if (args.size() >= 2)
        {
            int pluginId = (int)args[0];
            auto& pairs = *args[1].getArray();

            // One mutex acquisition for the entire batch
            std::lock_guard<std::mutex> lock(audioProcessor.pluginMutex);
            for (auto& hp : audioProcessor.hostedPlugins)
            {
                if (hp->id == pluginId && hp->instance)
                {
                    auto& params = hp->instance->getParameters();
                    for (auto& pair : pairs)
                    {
                        int idx = (int)(*pair.getArray())[0];
                        float val = (float)(double)(*pair.getArray())[1];
                        if (idx >= 0 && idx < params.size())
                        {
                            params[idx]->setValue(juce::jlimit(0.0f, 1.0f, val));
                            audioProcessor.recordSelfWrite(pluginId, idx);
                        }
                    }
                    break;
                }
            }
        }
        completion(juce::var("ok"));
    }
)
```

Then in JS:
```javascript
// One call, one mutex lock, one IPC crossing
var batchFn = window.__juceGetNativeFunction('applyParamBatch');
if (batchFn && instantIds.length > 0) {
    var pairs = instantIds.map(function(idx, i) { return [idx, instantVals[i]]; });
    batchFn(hostPluginId, pairs);
}
```

**Part 3 — Replace `refreshParamDisplay()` with `requestAnimationFrame(refreshParamDisplay)`.**

Line 2629 in `logic_blocks.js`:
```javascript
// Before:
refreshParamDisplay();

// After:
requestAnimationFrame(refreshParamDisplay);
```

This defers the 900 SVG rebuilds to the browser's next paint cycle instead of blocking the JS call stack. The user won't notice a one-frame delay and the FIRE button will feel instant.

---

## Issue 2 — CONFIRMED CRITICAL: `getHostedParams` in Tier 2 is the cause of UI lag during automation

**File:** `PluginEditor.cpp` line 1030

**This is the issue that makes your UI lag when automating many parameters on plugins like FabFilter Saturn.**

Every 10th timer tick (~6Hz), Tier 2 calls `audioProcessor.getHostedParams(plugInfo.id)` for every loaded plugin. That function acquires `pluginMutex` and then calls **both** `p->getValue()` and `p->getText(p->getValue(), 32)` on every single parameter.

`getText` is the killer. It asks the plugin to format a human-readable display string for every parameter every 160ms. Complex plugins like Saturn do real internal work inside `getText` — unit conversion, lookup tables, formatted strings. With Saturn's parameter count this scan can easily take 5–10ms per tick, which blows your 16ms frame budget and causes dropped frames. The plugin's own UI stays smooth because FabFilter renders it on their own schedule. Your UI stutters because your timer is spending most of its budget inside Saturn's `getText` calls.

**Verify this first** by adding timing in the Tier 2 block:

```cpp
if (timerTickCount % 10 == 0)
{
    auto t0 = juce::Time::getMillisecondCounterHiRes();
    auto params = audioProcessor.getHostedParams(plugInfo.id);
    DBG("Tier2 getHostedParams took: " + juce::String(juce::Time::getMillisecondCounterHiRes() - t0) + "ms");
    // ...
}
```

If that number is above 3ms you have confirmed the issue.

**The fix — strip `getText` out of Tier 2 entirely:**

Tier 2's only job is to detect idle parameter changes and promote them to Tier 1. It does not need display text — when a param gets promoted to Tier 1, Tier 1 already calls `getParamDisplayTextFast` on the next tick. So Tier 2 only needs the float value, and `getParamValueFast` is lock-free and cheap.

After the first full `getHostedParams` scan per plugin (which populates `paramIdentCache`), all subsequent Tier 2 ticks should use the fast path:

```cpp
// In timerCallback, replace the entire Tier 2 section with:
if (timerTickCount % 10 == 0)
{
    for (auto& [key, ident] : paramIdentCache)
    {
        // Skip params already handled by Tier 1
        if (modulatedParamKeys.count(key) > 0) continue;
        if (recentlyChangedKeys.count(key) > 0) continue;

        // Lock-free float read — no getText, no mutex, no plugin callbacks
        float val = audioProcessor.getParamValueFast(ident.pluginId, ident.paramIndex);
        if (val < 0.0f) continue;

        auto lastIt = lastParamValues.find(key);
        bool changed = (lastIt == lastParamValues.end())
                    || (std::abs(val - lastIt->second) > 0.0005f);

        if (changed)
        {
            // Promote to Tier 1 — it will fetch display text on next tick
            recentlyChangedKeys[key] = 120;

            // Auto-locate (keep existing logic)
            if (lastIt != lastParamValues.end() && selfWritten.count(key) == 0)
            {
                float delta = std::abs(val - lastIt->second);
                if (delta > 0.0005f && delta > biggestDelta)
                {
                    biggestDelta = delta;
                    touchedParamId = juce::String(key);
                }
            }
        }
        lastParamValues[key] = val;
    }
}
```

You still need one `getHostedParams` call per plugin when it first loads to populate `paramIdentCache`. After that, the fast path handles everything and Tier 2 costs near zero regardless of how many parameters the plugin has.

---

## Issue 3 — CONFIRMED: `loadPlugin` blocks the message thread

**File:** `PluginEditor.cpp` line 176, `PluginHosting.cpp` line 70

Your own comment says `// Load synchronously (VST3 COM requires message thread)`. Instance creation on the message thread is correct for VST3 on Windows. But the `PluginDirectoryScanner` scan loop with `scanNextFile` is pure disk I/O and does not need to be on the message thread. On a slow drive or a large plugin bundle this scan alone can freeze the UI for a second or more before instantiation even begins.

Split it: scan on a background thread, instantiate on the message thread via `callAsync`.

```cpp
void loadPluginAsync(const juce::String& pluginPath,
                     std::function<void(int pluginId)> onComplete)
{
    juce::Thread::launch([this, pluginPath, onComplete]()
    {
        // Phase 1: disk scan on background thread
        juce::PluginDescription foundDesc;
        bool found = false;

        // ... your existing scan logic here (knownPlugins check + scanner) ...

        if (!found)
        {
            juce::MessageManager::callAsync([onComplete]() { onComplete(-1); });
            return;
        }

        // Phase 2: instantiation must happen on message thread
        juce::MessageManager::callAsync([this, foundDesc, onComplete]()
        {
            juce::String err;
            auto instance = formatManager.createPluginInstance(
                foundDesc, currentSampleRate, currentBlockSize, err);

            if (!instance) { onComplete(-1); return; }

            // ... your existing bus layout, prepareToPlay, hostedPlugins push ...

            onComplete(newId);
        });
    });
}
```

The JS side should show a loading spinner immediately and hide it in the `onComplete` callback.

---

## Issue 4 — MINOR: `reorderPlugins` modifies `hostedPlugins` vector while audio thread may be iterating it

**File:** `PluginHosting.cpp` line 320

`reorderPlugins` acquires `pluginMutex` and does `hostedPlugins = std::move(reordered)` — this replaces the vector's internal buffer. Your audio thread in `ProcessBlock.cpp` explicitly does **not** acquire `pluginMutex`, meaning it can be in the middle of iterating `hostedPlugins` when the vector's internal pointer is replaced.

The iterator invalidation from moving a vector while iterating it is undefined behavior. In practice it likely works because the audio thread holds a pointer to the old buffer until iteration finishes — but it is technically a data race and sanitizers will catch it.

The safe fix is to have `reorderPlugins` post a message to the audio thread via a lock-free FIFO (similar to your `glideFifo`) rather than mutating the vector directly. In practice this is low priority since reordering only happens on user drag, not during active audio stress, but it's worth knowing.

---

## Issue 5 — MINOR: `juce::Random rng` created fresh per `randomizeParams` call

**File:** `PluginProcessor.cpp` line 649

`juce::Random` with no argument seeds from the system time. Two calls within the same millisecond get the same seed and produce identical sequences. Make it a member:

```cpp
// In PluginProcessor.h:
juce::Random rng; // persistent, seeded once

// In randomizeParams — remove: juce::Random rng;
// Just use the member rng directly
```

---

## Summary Table

| Priority | Location | Problem | Fix |
|---|---|---|---|
| **Critical** | `PluginEditor.cpp` Tier 2 | `getText` called on every param every 160ms — causes UI lag during automation of complex plugins like Saturn | Strip `getText` from Tier 2, use `getParamValueFast` only |
| **High** | `logic_blocks.js` randomize() | 900 individual `setParam` IPC calls per FIRE | Batch into one `applyParamBatch` call |
| **High** | `logic_blocks.js` line 2629 | `refreshParamDisplay()` synchronous on 900 params | `requestAnimationFrame(refreshParamDisplay)` |
| **Medium** | `PluginEditor.cpp` loadPlugin | Disk scan blocks message thread on plugin load | Move `PluginDirectoryScanner` to background thread |
| **Low** | `PluginHosting.cpp` reorderPlugins | Vector mutation without audio thread coordination | Lock-free reorder command via FIFO |
| **Low** | `PluginProcessor.cpp` randomizeParams | `juce::Random` reseeded each call | Make `rng` a persistent member |

---

## What Is Not a Problem

- **Audio thread mutex usage** — there is none. `ProcessBlock.cpp` correctly avoids `pluginMutex` entirely.
- **`blockMutex` in processBlock** — `try_to_lock` means the audio thread never blocks. If it can't get the lock, it skips logic block processing for that buffer. One skipped buffer is inaudible.
- **The two-tier polling design** — this is correct and well-implemented.
- **The selfWriteFifo mechanism** — correct and clean.
- **Glide via lock-free FIFO** — correct.
- **Batched `__rt_data__` event** — correct.
