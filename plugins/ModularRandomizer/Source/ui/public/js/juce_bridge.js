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
