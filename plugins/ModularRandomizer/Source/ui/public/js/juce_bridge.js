// ============================================================
// GLOBAL ERROR SURFACING
// ============================================================
// A WebView UI fails silently: a script that 404s or throws just leaves controls dead
// with no clue why. This shows those failures on screen instead. Loaded first, so it
// also catches load failures of every script that follows.
(function () {
    var box = null, seen = {}, count = 0;

    function ensureBox() {
        if (box && box.parentNode) return box;
        box = document.createElement('div');
        box.id = 'jsErrBox';
        // Inline styles only — this must work even if CSS failed to load.
        box.style.cssText = [
            'position:fixed', 'left:8px', 'right:8px', 'bottom:8px', 'z-index:99999',
            'max-height:40%', 'overflow:auto', 'padding:8px 10px',
            'background:#2a1414', 'border:1px solid #a33', 'border-radius:4px',
            'color:#ffb4b4', 'font:12px/1.45 Consolas,monospace', 'white-space:pre-wrap',
            'box-shadow:0 4px 18px rgba(0,0,0,.6)'
        ].join(';');
        var close = document.createElement('div');
        close.textContent = '×';
        close.title = 'Dismiss';
        close.style.cssText = 'position:absolute;top:2px;right:8px;cursor:pointer;font-size:16px;color:#fff';
        close.onclick = function () { if (box && box.parentNode) box.remove(); seen = {}; count = 0; };
        box.appendChild(close);
        if (document.body) document.body.appendChild(box);
        else document.addEventListener('DOMContentLoaded', function () { document.body.appendChild(box); });
        return box;
    }

    function report(msg) {
        if (seen[msg]) return;          // don't spam repeats (e.g. per-frame errors)
        seen[msg] = true;
        if (++count > 12) return;
        var b = ensureBox();
        var line = document.createElement('div');
        line.textContent = msg;
        line.style.cssText = 'margin-right:14px;padding:2px 0;border-top:1px solid rgba(255,255,255,.08)';
        b.appendChild(line);
    }

    // Runtime errors, and (capture phase) failed <script>/<link>/<img> loads
    window.addEventListener('error', function (e) {
        var t = e.target;
        if (t && t !== window && (t.src || t.href)) {
            report('FAILED TO LOAD: ' + (t.src || t.href));
            return;
        }
        var where = e.filename ? (' [' + String(e.filename).split('/').pop() + ':' + e.lineno + ']') : '';
        report('JS ERROR: ' + (e.message || 'unknown') + where);
    }, true);

    window.addEventListener('unhandledrejection', function (e) {
        var r = e.reason;
        report('PROMISE REJECTED: ' + ((r && (r.message || r)) || 'unknown'));
    });

    // Let other code report its own problems the same way
    window.__uiError = report;
})();

// ============================================================
// JUCE NATIVE FUNCTION BRIDGE
// Replicates the getNativeFunction from JUCE's ES module
// since we can't import it from a non-module script context.
// ============================================================
(function () {
    var lastPromiseId = 0;
    var promises = {};

    // Wait for __JUCE__ to be available, then set up the completion listener
    function setupCompletionListener() {
        if (window.__JUCE__ && window.__JUCE__.backend) {
            window.__JUCE__.backend.addEventListener('__juce__complete', function (data) {
                var pid = data.promiseId;
                if (promises[pid]) {
                    promises[pid].resolve(data.result);
                    delete promises[pid];
                }
            });
            return true;
        }
        return false;
    }

    // Try immediately, then retry
    if (!setupCompletionListener()) {
        var retryInterval = setInterval(function () {
            if (setupCompletionListener()) clearInterval(retryInterval);
        }, 100);
    }

    // Global getNativeFunction implementation
    window.__juceGetNativeFunction = function (name) {
        return function () {
            var promiseId = lastPromiseId++;
            var args = Array.prototype.slice.call(arguments);
            var result = new Promise(function (resolve, reject) {
                promises[promiseId] = { resolve: resolve, reject: reject };
            });

            if (window.__JUCE__ && window.__JUCE__.backend) {
                window.__JUCE__.backend.emitEvent('__juce__invoke', {
                    name: name,
                    params: args,
                    resultId: promiseId
                });
            }

            return result;
        };
    };
})();
