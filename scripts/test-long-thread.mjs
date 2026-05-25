import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";

const root = resolve(".");
const host = "127.0.0.1";
const edgeCandidates = [
  process.env.EDGE_PATH,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"
].filter(Boolean);
const useHeadless = process.env.CGLF_HEADLESS !== "0";
const fixtureTurns = Math.min(
  1000,
  Math.max(20, Number(process.env.CGLF_FIXTURE_TURNS || 240))
);

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"]
]);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function sleep(ms) {
  return new Promise((resolveSleep) => {
    setTimeout(resolveSleep, ms);
  });
}

function findEdge() {
  const edgePath = edgeCandidates.find((candidate) => existsSync(candidate));

  if (!edgePath) {
    throw new Error("Microsoft Edge was not found. Set EDGE_PATH to a Chromium-compatible browser.");
  }

  return edgePath;
}

function resolveRequestPath(url) {
  const parsedUrl = new URL(url, "http://localhost");
  const decodedPath = decodeURIComponent(parsedUrl.pathname);
  const safePath = normalize(decodedPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = resolve(join(root, safePath));

  if (!filePath.startsWith(root)) {
    return null;
  }

  return decodedPath.endsWith("/") ? join(filePath, "index.html") : filePath;
}

function startStaticServer() {
  const server = createServer(async (request, response) => {
    const filePath = resolveRequestPath(request.url || "/");

    if (!filePath) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }

    try {
      const body = await readFile(filePath);
      response.writeHead(200, {
        "Content-Type": contentTypes.get(extname(filePath)) || "application/octet-stream"
      });
      response.end(body);
    } catch (_error) {
      response.writeHead(404);
      response.end("Not found");
    }
  });

  return new Promise((resolveServer, reject) => {
    server.once("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      resolveServer({
        origin: `http://${host}:${address.port}`,
        close: () =>
          new Promise((resolveClose) => {
            server.close(resolveClose);
          })
      });
    });
  });
}

async function fetchJson(url, timeoutMs = 10_000) {
  const startedAt = Date.now();
  let lastError;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);

      if (response.ok) {
        return response.json();
      }

      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await sleep(100);
  }

  throw lastError || new Error(`Timed out fetching ${url}`);
}

function connect(webSocketDebuggerUrl) {
  const socket = new WebSocket(webSocketDebuggerUrl);
  let nextId = 1;
  const pending = new Map();

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);

    if (!message.id || !pending.has(message.id)) {
      return;
    }

    const { resolve: resolvePending, reject } = pending.get(message.id);
    pending.delete(message.id);

    if (message.error) {
      reject(new Error(message.error.message));
    } else {
      resolvePending(message.result);
    }
  });

  return new Promise((resolveSocket, reject) => {
    socket.addEventListener("open", () => {
      resolveSocket({
        send(method, params = {}) {
          const id = nextId;
          nextId += 1;

          socket.send(JSON.stringify({ id, method, params }));

          return new Promise((resolveMethod, rejectMethod) => {
            const timeout = setTimeout(() => {
              pending.delete(id);
              rejectMethod(new Error(`Timed out waiting for CDP method ${method}.`));
            }, 10_000);

            pending.set(id, {
              resolve(value) {
                clearTimeout(timeout);
                resolveMethod(value);
              },
              reject(error) {
                clearTimeout(timeout);
                rejectMethod(error);
              }
            });
          });
        },
        close() {
          socket.close();
        }
      });
    });
    socket.addEventListener("error", reject);
  });
}

async function evaluate(client, expression) {
  const result = await client.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true
  });

  if (result.exceptionDetails) {
    const description = result.exceptionDetails.exception?.description;
    const value = result.exceptionDetails.exception?.value;
    throw new Error(description || value || result.exceptionDetails.text || "Browser evaluation failed.");
  }

  return result.result.value;
}

async function waitFor(client, expression, timeoutMs = 10_000) {
  const startedAt = Date.now();
  let value;

  while (Date.now() - startedAt < timeoutMs) {
    value = await evaluate(client, expression);

    if (value) {
      return value;
    }

    await sleep(100);
  }

  throw new Error(`Timed out waiting for: ${expression}`);
}

function readStatsExpression() {
  return `(() => {
    const turns = Array.from(document.querySelectorAll('[data-testid^="conversation-turn-"]'));
    const parked = Array.from(document.querySelectorAll('.cglf-parked'));
    const contained = Array.from(document.querySelectorAll('.cglf-contained-turn'));
    const badge = document.querySelector('.cglf-badge-label');
    const firstParked = parked[0];

    return {
      installed: document.documentElement.dataset.cglfInstalled === 'true',
      totalTurns: turns.length,
      parkedTurns: parked.length,
      containedTurns: contained.length,
      badgeText: badge ? badge.textContent : null,
      firstParkedId: firstParked ? firstParked.dataset.testid : null,
      firstParkedRole: firstParked ? firstParked.dataset.cglfRole : null,
      firstParkedPreviewLength: firstParked?.dataset.cglfPreview?.length || 0,
      lastTenParked: turns.slice(-10).filter((turn) => turn.classList.contains('cglf-parked')).length,
      addButtonExists: Boolean(document.querySelector('#add-turn'))
    };
  })()`;
}

async function run() {
  const server = await startStaticServer();
  const port = 9333 + Math.floor(Math.random() * 400);
  const profileDir = resolve(root, ".test-profiles", `long-thread-${Date.now()}`);
  const edgePath = findEdge();
  let browserProcess;
  let browserClient;
  let pageClient;

  await mkdir(profileDir, { recursive: true });

  try {
    console.log(`Serving demo from ${server.origin}/demo/index.html`);
    console.log(`Launching Edge on remote debugging port ${port}`);

    const browserArgs = [
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      `--user-data-dir=${profileDir}`,
      `--remote-debugging-port=${port}`,
      "--remote-allow-origins=*",
      "about:blank"
    ];

    if (useHeadless) {
      browserArgs.unshift("--headless=new");
    }

    browserProcess = spawn(edgePath, browserArgs, {
      stdio: "ignore"
    });

    browserProcess.once("exit", (code, signal) => {
      if (code !== null && code !== 0) {
        console.error(`Edge exited with code ${code}.`);
      }

      if (signal) {
        console.error(`Edge exited with signal ${signal}.`);
      }
    });

    const version = await fetchJson(`http://${host}:${port}/json/version`);
    browserClient = await connect(version.webSocketDebuggerUrl);
    const demoUrl = `${server.origin}/demo/index.html?turns=${fixtureTurns}`;
    const defaultParkedTurns = fixtureTurns - 10;
    const aggressiveParkedTurns = fixtureTurns - 5;
    const appendedTurns = fixtureTurns + 1;
    const appendedAggressiveParkedTurns = appendedTurns - 5;
    console.log(`Opening ${demoUrl}`);
    const { targetId } = await browserClient.send("Target.createTarget", {
      url: demoUrl
    });

    const targets = await fetchJson(`http://${host}:${port}/json`);
    const target = targets.find((item) => item.id === targetId);
    assert(target, "Created browser target was not found.");

    pageClient = await connect(target.webSocketDebuggerUrl);
    await pageClient.send("Runtime.enable");
    await pageClient.send("Page.enable");

    console.log("Waiting for extension optimizer to run");
    await waitFor(pageClient, "document.readyState === 'complete'");
    await waitFor(pageClient, "document.documentElement.dataset.cglfInstalled === 'true'");
    await waitFor(pageClient, `document.querySelectorAll('.cglf-parked').length === ${defaultParkedTurns}`);

    console.log("Checking default optimization state");
    const initial = await evaluate(pageClient, readStatsExpression());
    assert(initial.totalTurns === fixtureTurns, `Expected ${fixtureTurns} turns, got ${initial.totalTurns}.`);
    assert(initial.parkedTurns === defaultParkedTurns, `Expected ${defaultParkedTurns} parked turns, got ${initial.parkedTurns}.`);
    assert(initial.containedTurns === fixtureTurns, `Expected ${fixtureTurns} contained turns, got ${initial.containedTurns}.`);
    assert(initial.badgeText === `${defaultParkedTurns} parked`, `Expected badge "${defaultParkedTurns} parked", got ${initial.badgeText}.`);
    assert(initial.firstParkedRole === "ChatGPT", `Expected first parked role ChatGPT, got ${initial.firstParkedRole}.`);
    assert(initial.firstParkedPreviewLength > 80, "Expected parked turn preview text.");
    assert(initial.lastTenParked === 0, `Expected newest 10 turns to stay live, got ${initial.lastTenParked} parked.`);
    assert(initial.addButtonExists, "Expected the demo Add turn button.");

    console.log("Checking click-to-expand behavior");
    await evaluate(pageClient, `document.querySelector('.cglf-parked').click()`);
    await waitFor(pageClient, `document.querySelectorAll('.cglf-parked').length === ${defaultParkedTurns - 1}`);
    await waitFor(pageClient, `document.querySelector('.cglf-badge-label')?.textContent === '${defaultParkedTurns - 1} parked'`);

    const afterExpandOne = await evaluate(pageClient, readStatsExpression());
    assert(afterExpandOne.parkedTurns === defaultParkedTurns - 1, `Expected ${defaultParkedTurns - 1} parked turns after expanding one, got ${afterExpandOne.parkedTurns}.`);
    assert(afterExpandOne.badgeText === `${defaultParkedTurns - 1} parked`, `Expected badge "${defaultParkedTurns - 1} parked", got ${afterExpandOne.badgeText}.`);

    console.log("Checking disabled state");
    await evaluate(pageClient, `chrome.storage.sync.set({ enabled: false })`);
    await waitFor(pageClient, "document.querySelectorAll('.cglf-parked').length === 0");

    const disabled = await evaluate(pageClient, readStatsExpression());
    assert(disabled.containedTurns === 0, `Expected containment removed when disabled, got ${disabled.containedTurns}.`);
    assert(disabled.badgeText === null, `Expected badge hidden when disabled, got ${disabled.badgeText}.`);

    console.log("Checking aggressive settings");
    await evaluate(pageClient, `chrome.storage.sync.set({ enabled: true, keepLastTurns: 5, minCharactersToPark: 80 })`);
    await waitFor(pageClient, `document.querySelectorAll('.cglf-parked').length === ${aggressiveParkedTurns}`);

    const aggressive = await evaluate(pageClient, readStatsExpression());
    assert(aggressive.parkedTurns === aggressiveParkedTurns, `Expected ${aggressiveParkedTurns} parked turns with aggressive settings, got ${aggressive.parkedTurns}.`);
    assert(aggressive.badgeText === `${aggressiveParkedTurns} parked`, `Expected badge "${aggressiveParkedTurns} parked", got ${aggressive.badgeText}.`);

    console.log("Checking dynamic appended turns");
    await evaluate(pageClient, `document.querySelector('#add-turn').click()`);
    await waitFor(pageClient, `document.querySelectorAll('[data-testid^="conversation-turn-"]').length === ${appendedTurns}`);
    await waitFor(pageClient, `document.querySelectorAll('.cglf-parked').length === ${appendedAggressiveParkedTurns}`);

    const afterAppend = await evaluate(pageClient, readStatsExpression());
    assert(afterAppend.totalTurns === appendedTurns, `Expected ${appendedTurns} turns after append, got ${afterAppend.totalTurns}.`);
    assert(afterAppend.parkedTurns === appendedAggressiveParkedTurns, `Expected ${appendedAggressiveParkedTurns} parked turns after append, got ${afterAppend.parkedTurns}.`);

    console.log("Checking runtime Expand all message");
    await evaluate(pageClient, `window.__cglfDemo.sendRuntimeMessage({ type: 'CGLF_EXPAND_ALL' })`);
    await waitFor(pageClient, "document.querySelectorAll('.cglf-parked').length === 0");
    await waitFor(pageClient, "document.querySelector('.cglf-badge-label') === null");

    const expandedAll = await evaluate(pageClient, readStatsExpression());
    assert(expandedAll.containedTurns === appendedTurns, `Expected ${appendedTurns} contained turns after expand all, got ${expandedAll.containedTurns}.`);
    assert(expandedAll.badgeText === null, `Expected badge hidden after expand all, got ${expandedAll.badgeText}.`);

    console.log("Long-thread simulation passed.");
    console.log(JSON.stringify({
      initial,
      afterExpandOne,
      disabled,
      aggressive,
      afterAppend,
      expandedAll
    }, null, 2));
  } finally {
    pageClient?.close();

    if (browserClient) {
      try {
        await Promise.race([
          browserClient.send("Browser.close"),
          sleep(2_000)
        ]);
      } catch (_error) {
        // Browser may already be closed.
      }

      browserClient.close();
    }

    browserProcess?.kill();
    await server.close();

    if (profileDir.startsWith(resolve(root, ".test-profiles"))) {
      try {
        await rm(profileDir, {
          recursive: true,
          force: true
        });
      } catch (error) {
        if (error.code !== "EBUSY") {
          throw error;
        }

        console.warn(`Skipped locked temporary browser profile: ${profileDir}`);
      }
    }
  }
}

await run();
