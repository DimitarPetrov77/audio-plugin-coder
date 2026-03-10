// ============================================================
// GLOBAL STATE DECLARATIONS
// Shared variables used across all modules
// ============================================================

// Block color palette
var BCOLORS = ['#C8983C', '#2D6B3F', '#8B3030', '#5880A0', '#A87030', '#507860', '#986050', '#688848'];
function bColor(i) { return BCOLORS[i % BCOLORS.length]; }

// Plugin scanner state
var scannedPlugins = [];
var scanPaths = []; // populated from backend via getDefaultScanPaths
var scanInProgress = false;

// Fetch platform-appropriate default scan paths from C++ backend
(function initScanPaths() {
    if (window.__JUCE__ && window.__JUCE__.backend) {
        var fn = window.__juceGetNativeFunction('getDefaultScanPaths');
        if (fn) {
            fn().then(function (paths) {
                if (paths && paths.length && scanPaths.length === 0) {
                    scanPaths = paths.slice();
                }
            });
        }
    }
    // Fallback if backend not ready yet — will be overridden by getFullState restore
    if (scanPaths.length === 0) {
        if (navigator.platform && navigator.platform.indexOf('Mac') >= 0) {
            scanPaths = ['/Library/Audio/Plug-Ins/VST3'];
        } else if (navigator.platform && navigator.platform.indexOf('Linux') >= 0) {
            scanPaths = ['~/.vst3', '/usr/lib/vst3'];
        } else {
            scanPaths = ['C:\\Program Files\\Common Files\\VST3', 'C:\\Program Files\\VSTPlugins'];
        }
    }
})();

// Plugin rack state
var PMap = {}, pluginBlocks = [], plugBC = 0;

// Logic blocks state
var blocks = [], bc = 0, actId = null, assignMode = null, ctxP = null;

// Routing mode: 0=sequential, 1=parallel, 2=wrongeq
var routingMode = 0;
// WrongEQ state (mode 2)
var wrongEqPoints = []; // Array of {x, y, busId, seg}
var BUS_COLORS = ['#17B2A0', '#4ECDC4', '#FF6B6B', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD'];
// Per-bus mixer state (parallel mode)
var busVolumes = [1, 1, 1, 1, 1, 1, 1];
var busMutes = [false, false, false, false, false, false, false];
var busCollapsed = [false, false, false, false, false, false, false];
var busSolos = [false, false, false, false, false, false, false];

// Real-time data from processor
var rtData = { rms: 0, scRms: 0, bpm: 120, playing: false, ppq: 0, midi: [] };

// MIDI note names
var NN = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
function midiName(n) { return NN[n % 12] + (Math.floor(n / 12) - 1); }

// Multi-select for drag/right-click assign
var selectedParams = new Set();

// Utility lookups
function findBlock(id) { for (var i = 0; i < blocks.length; i++) { if (blocks[i].id === id) return blocks[i]; } return null; }
function allParams() { var a = []; pluginBlocks.forEach(function (pb) { a = a.concat(pb.params); }); return a; }
function paramPluginName(pid) { var pi = parseInt(pid.split(':')[0]); for (var i = 0; i < pluginBlocks.length; i++) { if (pluginBlocks[i].id === pi) return pluginBlocks[i].name; } return '?'; }
// HTML escape for safe innerHTML injection of user-supplied strings
function escHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
