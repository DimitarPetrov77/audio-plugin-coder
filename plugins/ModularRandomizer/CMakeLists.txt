# Hostesa - Multi-Plugin Parameter Host
# WebView-based UI with plugin hosting architecture
# Windows: VST3/Standalone (WebView2)

# ============================================
# PLATFORM-SPECIFIC CONFIGURATION
# ============================================
if(WIN32)
    set(PLUGIN_FORMATS VST3 Standalone)
    set(NEEDS_WEBVIEW2 TRUE)
    set(WEBVIEW_BACKEND "WebView2")
elseif(APPLE)
    set(PLUGIN_FORMATS VST3 AU Standalone)
    set(NEEDS_WEBVIEW2 FALSE)
    set(WEBVIEW_BACKEND "WKWebView")
    set(AU_MAIN_TYPE kAudioUnitType_MusicEffect)
elseif(UNIX)
    set(PLUGIN_FORMATS VST3 LV2 Standalone)
    set(NEEDS_WEBVIEW2 FALSE)
    set(NEEDS_WEB_BROWSER TRUE)
    set(WEBVIEW_BACKEND "WebKitGTK")
    set(LV2_URI "https://dimitarp.com/audio-plugin-coder/Hostesa")
else()
    message(FATAL_ERROR "Unsupported platform")
endif()

message(STATUS "Hostesa: Building for ${PLUGIN_FORMATS}")
message(STATUS "Hostesa: WebView backend: ${WEBVIEW_BACKEND}")

# ============================================
# BINARY DATA (Web UI Resources)
# ============================================
juce_add_binary_data(HostesaWebUI
    HEADER_NAME "BinaryData.h"
    NAMESPACE BinaryData
    SOURCES
        Source/ui/public/index.html
        Source/ui/public/css/variables.css
        Source/ui/public/css/base.css
        Source/ui/public/css/header.css
        Source/ui/public/css/plugin_rack.css
        Source/ui/public/css/logic_blocks.css
        Source/ui/public/css/dialogs.css
        Source/ui/public/css/themes.css
        Source/ui/public/css/wrongeq.css
        Source/ui/public/css/overrides.css
        Source/ui/public/js/juce_bridge.js
        Source/ui/public/js/state.js
        Source/ui/public/js/theme_system.js
        Source/ui/public/js/help_panel.js
        Source/ui/public/js/undo_system.js
        Source/ui/public/js/plugin_rack.js
        Source/ui/public/js/context_menus.js
        Source/ui/public/js/preset_system.js
        Source/ui/public/js/logic_blocks.js
        Source/ui/public/js/lane_module.js
        Source/ui/public/js/wrongeq_canvas.js
        Source/ui/public/js/realtime.js
        Source/ui/public/js/expose_system.js
        Source/ui/public/js/controls.js
        Source/ui/public/js/persistence.js
        Source/ui/public/js/juce_integration.js
        Source/ui/public/fonts/ShareTechMono-Regular.ttf
        Source/ui/public/fonts/VT323-Regular.ttf
)

# Set include directories for binary data
set_target_properties(HostesaWebUI PROPERTIES
    POSITION_INDEPENDENT_CODE TRUE
)

# ============================================
# PLUGIN TARGET
# ============================================
juce_add_plugin(Hostesa
    COMPANY_NAME "Dimitar Petrov"
    IS_SYNTH FALSE
    NEEDS_MIDI_INPUT TRUE
    NEEDS_MIDI_OUTPUT FALSE
    IS_MIDI_EFFECT FALSE
    EDITOR_WANTS_KEYBOARD_FOCUS TRUE
    COPY_PLUGIN_AFTER_BUILD FALSE
    PLUGIN_MANUFACTURER_CODE DmPt
    PLUGIN_CODE Hsta
    FORMATS ${PLUGIN_FORMATS}
    PRODUCT_NAME "Hostesa"
    BUNDLE_ID "com.dimitarp.hostesa"
    PLUGIN_NAME "Hostesa"
    DESCRIPTION "Multi-Plugin Parameter Host"

    # WebView2 requirement for Windows
    NEEDS_WEBVIEW2 ${NEEDS_WEBVIEW2}
)

# ============================================
# SOURCE FILES
# ============================================
target_sources(Hostesa
    PRIVATE
        Source/PluginProcessor.cpp
        Source/PluginProcessor.h
        Source/ProcessBlock.cpp
        Source/PluginHosting.cpp
        Source/PluginEditor.cpp
        Source/PluginEditor.h
        Source/ParameterIDs.hpp
)

# ============================================
# INCLUDE DIRECTORIES
# ============================================
target_include_directories(Hostesa
    PRIVATE
        ${CMAKE_CURRENT_SOURCE_DIR}/Source
)

# ============================================
# COMPILE DEFINITIONS
# ============================================
target_compile_definitions(Hostesa
    PUBLIC
        JUCE_WEB_BROWSER=1
        JUCE_VST3_CAN_REPLACE_VST2=0
        JUCE_DISPLAY_SPLASH_SCREEN=0
        JUCE_WEB_BROWSER_RESOURCE_PROVIDER_AVAILABLE=1
        JUCE_PLUGINHOST_VST3=1
)

# WebView2 static linking is Windows-only
if(WIN32)
    target_compile_definitions(Hostesa PUBLIC
        JUCE_USE_WIN_WEBVIEW2_WITH_STATIC_LINKING=1
    )
endif()

# ============================================
# LINK LIBRARIES
# ============================================
target_link_libraries(Hostesa
    PRIVATE
        HostesaWebUI
        juce::juce_audio_basics
        juce::juce_audio_processors
        juce::juce_audio_plugin_client
        juce::juce_audio_formats
        juce::juce_audio_utils
        juce::juce_gui_basics
        juce::juce_gui_extra
        juce::juce_dsp
    PUBLIC
        juce::juce_recommended_config_flags
        juce::juce_recommended_warning_flags
)
