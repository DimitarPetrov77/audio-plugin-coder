// ============================================================
// JUCE BACKEND INTEGRATION
// Sync UI controls with host parameters via relay system
// ============================================================
// Init: restore from host or start fresh
restoreFromHost();
// Plugin scan is LAZY — triggered when the browser is opened and
// scannedPlugins is empty. The knownPlugins cache persists in C++.
// The peek popup uses scannedPlugins (if available) for "installed on disk"
// checks, and only shows MISSING if the cache has actually been populated.

// ============================================================
// JUCE BACKEND INTEGRATION
// Sync UI controls with host parameters via relay system
// ============================================================
function initJuceIntegration() {
    if (!window.__JUCE__) {
        console.log('Waiting for JUCE backend...');
        setTimeout(initJuceIntegration, 100);
        return;
    }
    console.log('JUCE backend detected, syncing parameters');

    // Sync Mix slider from host
    try {
        var mixState = window.__JUCE__.getSliderState('MIX');
        if (mixState) {
            var slider = document.getElementById('mixSlider');
            var valEl = document.getElementById('mixVal');
            // Set initial value from host
            var initVal = Math.round(mixState.getNormalisedValue() * 100);
            slider.value = initVal;
            valEl.textContent = initVal + '%';
            // Listen for host-side changes
            mixState.valueChangedEvent.addListener(function () {
                var v = Math.round(mixState.getNormalisedValue() * 100);
                slider.value = v;
                valEl.textContent = v + '%';
            });
        }
    } catch (e) { console.log('Mix relay error:', e); }

    // Sync Bypass toggle from host
    try {
        var bypState = window.__JUCE__.getToggleState('BYPASS');
        if (bypState) {
            var btn = document.getElementById('bypassBtn');
            // Set initial value from host
            if (bypState.getValue()) btn.classList.add('on');
            else btn.classList.remove('on');
            // Listen for host-side changes
            bypState.valueChangedEvent.addListener(function () {
                if (bypState.getValue()) btn.classList.add('on');
                else btn.classList.remove('on');
            });
        }
    } catch (e) { console.log('Bypass relay error:', e); }
}
initJuceIntegration();
