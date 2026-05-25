(() => {
  const storageState = {};
  const storageListeners = new Set();
  const runtimeListeners = new Set();
  const chromeApi = globalThis.chrome || {};

  function clone(value) {
    if (value === undefined || value === null || typeof value !== "object") {
      return value;
    }

    return JSON.parse(JSON.stringify(value));
  }

  function readStorage(defaults) {
    if (defaults && typeof defaults === "object" && !Array.isArray(defaults)) {
      return {
        ...clone(defaults),
        ...clone(storageState)
      };
    }

    if (Array.isArray(defaults)) {
      return defaults.reduce((result, key) => {
        if (key in storageState) {
          result[key] = clone(storageState[key]);
        }

        return result;
      }, {});
    }

    return clone(storageState);
  }

  chromeApi.runtime = {
      onMessage: {
        addListener(listener) {
          runtimeListeners.add(listener);
        }
      }
    };
  chromeApi.storage = {
      sync: {
        get(defaults, callback) {
          callback(readStorage(defaults));
        },
        set(values, callback = () => {}) {
          const changes = {};

          Object.entries(values).forEach(([key, value]) => {
            changes[key] = {
              oldValue: clone(storageState[key]),
              newValue: clone(value)
            };
            storageState[key] = clone(value);
          });

          storageListeners.forEach((listener) => {
            listener(changes, "sync");
          });

          callback();
        }
      },
      onChanged: {
        addListener(listener) {
          storageListeners.add(listener);
        }
      }
    };

  globalThis.chrome = chromeApi;

  globalThis.__cglfDemo = {
    sendRuntimeMessage(message) {
      return new Promise((resolve) => {
        for (const listener of runtimeListeners) {
          const handled = listener(message, { id: "demo" }, resolve);

          if (handled) {
            return;
          }
        }

        resolve(null);
      });
    }
  };
})();
