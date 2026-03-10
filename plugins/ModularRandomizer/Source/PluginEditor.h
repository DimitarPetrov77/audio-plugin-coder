#pragma once

#include "PluginProcessor.h"
#include <juce_gui_extra/juce_gui_extra.h>
#include <map>
#include <unordered_map>
#include <unordered_set>

//==============================================================================
// SEH helper for plugin editor teardown -- must be a free function because
// MSVC forbids __try in functions whose enclosing class has members that
// require unwinding (e.g. std::function). Also cannot use DBG or any
// construct that creates C++ objects with destructors.
#if JUCE_WINDOWS
static void safeClearEditorContent (juce::DocumentWindow* w)
{
    __try
    {
        w->clearContentComponent();
    }
    __except (EXCEPTION_EXECUTE_HANDLER)
    {
        OutputDebugStringA ("PluginEditorWindow: SEH caught during editor teardown\n");
    }
}
#else
static inline void safeClearEditorContent (juce::DocumentWindow* w)
{
    try { w->clearContentComponent(); } catch (...) {}
}
#endif

/**
 * Window that hosts a VST3 plugin's native editor GUI.
 * Opens as a separate floating window on top of the main plugin window.
 */
class PluginEditorWindow : public juce::DocumentWindow
{
public:
    PluginEditorWindow (const juce::String& name,
                        juce::AudioPluginInstance* pluginInstance,
                        std::function<void()> onCloseCallback)
        : DocumentWindow (name, juce::Colours::darkgrey, DocumentWindow::closeButton),
          closeCallback (std::move (onCloseCallback))
    {
        if (pluginInstance != nullptr)
        {
            if (auto* editor = pluginInstance->createEditor())
            {
                setContentOwned (editor, true);
            }
            else
            {
                // Plugin has no GUI — show placeholder
                auto* label = new juce::Label ({}, "No GUI available");
                label->setSize (300, 100);
                label->setJustificationType (juce::Justification::centred);
                setContentOwned (label, true);
            }
        }

        setUsingNativeTitleBar (true);
        setResizable (true, false);
        setAlwaysOnTop (true);
        centreWithSize (getWidth(), getHeight());
        setVisible (true);
    }

    ~PluginEditorWindow() override
    {
        // Must clear content component BEFORE DocumentWindow destructor.
        // Some plugins crash during editor teardown (especially while modulated),
        // so we wrap in SEH to prevent killing the host process.
        safeClearEditorContent (this);
    }

    void closeButtonPressed() override
    {
        // SAFETY: Do NOT call clearContentComponent() synchronously here.
        // Some plugins' editor destructors trigger re-entrant message dispatch
        // (modal dialogs, parameter notifications, COM calls), which could process
        // our queued async erase while we're still inside this callback — destroying
        // 'this' mid-function and crashing the host.
        //
        // Instead: hide the window immediately (visual feedback) and defer ALL
        // destruction to an async block so the call stack fully unwinds first.
        setVisible (false);

        // prevent user from interacting while destruction is pending
        if (closeCallback)
        {
            auto cb = std::move (closeCallback);  // move out to prevent double-fire
            try { cb(); }
            catch (...) { DBG ("PluginEditorWindow: close callback threw"); }
        }
    }

private:
    std::function<void()> closeCallback;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (PluginEditorWindow)
};

//==============================================================================
/**
 * ModularRandomizer Editor — WebView2-based UI
 *
 * ⚠️ CRITICAL: Member declaration order prevents DAW crashes on unload.
 *    Destruction order = reverse of declaration.
 *    Order: Relays → WebView → Attachments
 */
class ModularRandomizerAudioProcessorEditor : public juce::AudioProcessorEditor,
                                               private juce::Timer
{
public:
    ModularRandomizerAudioProcessorEditor (ModularRandomizerAudioProcessor&);
    ~ModularRandomizerAudioProcessorEditor() override;

    //==============================================================================
    void paint (juce::Graphics&) override;
    void resized() override;

private:
    void timerCallback() override;

    // Resource provider for WebView
    std::optional<juce::WebBrowserComponent::Resource> getResource (const juce::String& url);
    static const char* getMimeForExtension (const juce::String& extension);

    // Open/close a hosted plugin's editor window
    void openPluginEditorWindow (int pluginId);

    ModularRandomizerAudioProcessor& audioProcessor;

    // ═══════════════════════════════════════════════════════════════
    // CRITICAL: Destruction Order = Reverse of Declaration
    // Order: Relays → WebView → Attachments
    // ═══════════════════════════════════════════════════════════════

    // 1. RELAYS FIRST (destroyed last)
    juce::WebSliderRelay mixRelay       { "MIX" };
    juce::WebToggleButtonRelay bypassRelay  { "BYPASS" };

    // 2. WEBVIEW SECOND (destroyed middle)
    std::unique_ptr<juce::WebBrowserComponent> webView;

    // 3. ATTACHMENTS LAST (destroyed first)
    std::unique_ptr<juce::WebSliderParameterAttachment>       mixAttachment;
    std::unique_ptr<juce::WebToggleButtonParameterAttachment> bypassAttachment;

    // Hosted plugin editor windows (keyed by plugin ID)
    std::map<int, std::unique_ptr<PluginEditorWindow>> pluginEditorWindows;

    // Timer tick counter for throttled polling
    int timerTickCount = 0;
    int tier2ScanOffset = 0;

    // Auto-locate: track which param was last touched in hosted plugin UI
    std::unordered_map<std::string, float> lastParamValues;
    juce::String touchedParamId;

    // Two-tier polling: modulated params polled frequently, idle params polled lazily
    std::unordered_set<std::string> modulatedParamKeys;  // refreshed periodically

    // Params that recently changed (from hosted plugin UI) — promoted to tier 1 temporarily
    // Value = TTL in timer ticks (decremented each tick, removed when 0)
    std::unordered_map<std::string, int> recentlyChangedKeys;

    // Per-param identity cache: key → {pluginId, paramIndex} for fast value reads
    struct ParamIdent { int pluginId; int paramIndex; };
    std::unordered_map<std::string, ParamIdent> paramIdentCache;
    std::vector<std::pair<std::string, ParamIdent>> paramIdentVec; // O(1) indexed access for sliding window

    // Visibility culling: only poll params from expanded (visible) plugins
    // Updated by JS via setExpandedPlugins native function
    std::unordered_set<int> expandedPluginIds;

    // Fine-grained visibility: only Tier 1 poll params actually visible on screen
    // Updated by JS via setVisibleParams native function (~8 PIDs, debounced 100ms)
    std::unordered_set<std::string> visibleParamKeys;

    //==============================================================================
    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (ModularRandomizerAudioProcessorEditor)
};
