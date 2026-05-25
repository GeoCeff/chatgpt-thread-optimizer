import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(".");
const host = "127.0.0.1";
const turnCount = Math.min(1000, Math.max(20, Number(process.env.CGLF_FIXTURE_TURNS || 1000)));
const edgeCandidates = [
  process.env.EDGE_PATH,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"
].filter(Boolean);

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

async function fetchJson(url, timeoutMs = 20_000) {
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

    await sleep(150);
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
            }, 15_000);

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

async function waitFor(client, expression, timeoutMs = 30_000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const value = await evaluate(client, expression);

    if (value) {
      return value;
    }

    await sleep(150);
  }

  throw new Error(`Timed out waiting for: ${expression}`);
}

function injectFixtureExpression(count) {
  return `(() => {
    document.querySelector('#cglf-live-fixture')?.remove();

    const main = document.querySelector('main') || document.body;
    const section = document.createElement('section');
    const fragment = document.createDocumentFragment();
    section.id = 'cglf-live-fixture';
    section.style.display = 'grid';
    section.style.gap = '12px';
    section.style.maxWidth = '900px';
    section.style.margin = '24px auto';
    section.style.padding = '0 16px 80px';

    for (let index = 1; index <= ${count}; index += 1) {
      const role = index % 3 === 0 ? 'user' : 'assistant';
      const article = document.createElement('article');
      const roleNode = document.createElement('div');
      const body = document.createElement('div');

      article.dataset.testid = 'conversation-turn-live-' + index;
      article.style.border = '1px solid rgba(127, 127, 127, 0.28)';
      article.style.borderRadius = '8px';
      article.style.padding = '14px';
      article.style.background = role === 'user' ? 'rgba(16, 163, 127, 0.08)' : 'rgba(127, 127, 127, 0.08)';
      roleNode.dataset.messageAuthorRole = role;
      roleNode.textContent = role === 'user' ? 'You' : 'ChatGPT';
      body.className = 'markdown prose';
      body.innerHTML = '<p>Live ChatGPT fixture turn ' + index + ' repeats enough text to behave like a long conversation message. This locally injected content never leaves the browser and exists only for extension testing.</p><pre><code>const turn = ' + index + ';\\nconst mode = "simulated-chatgpt-live-page";</code></pre>';

      article.append(roleNode, body);
      fragment.append(article);
    }

    section.append(fragment);
    main.append(section);
    return section.children.length;
  })()`;
}

function readStatsExpression() {
  return `(() => {
    const turns = Array.from(document.querySelectorAll('[data-testid^="conversation-turn-live-"]'));
    const parked = turns.filter((turn) => turn.classList.contains('cglf-parked'));
    const contained = turns.filter((turn) => turn.classList.contains('cglf-contained-turn'));
    const badge = document.querySelector('.cglf-badge-label');

    return {
      url: location.href,
      installed: document.documentElement.dataset.cglfInstalled === 'true',
      injectedTurns: turns.length,
      parkedTurns: parked.length,
      containedTurns: contained.length,
      badgeText: badge ? badge.textContent : null,
      firstParkedId: parked[0]?.dataset.testid || null,
      newestTenParked: turns.slice(-10).filter((turn) => turn.classList.contains('cglf-parked')).length,
      promptVisible: Boolean(document.querySelector('textarea, [contenteditable="true"]'))
    };
  })()`;
}

async function run() {
  const port = 10_200 + Math.floor(Math.random() * 500);
  const profileDir = resolve(root, ".test-profiles", `live-chatgpt-${Date.now()}`);
  const edgePath = findEdge();
  let browserProcess;
  let browserClient;
  let pageClient;

  await mkdir(profileDir, { recursive: true });

  try {
    console.log(`Launching ChatGPT with extension loaded on port ${port}`);
    browserProcess = spawn(edgePath, [
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      `--user-data-dir=${profileDir}`,
      `--remote-debugging-port=${port}`,
      "--remote-allow-origins=*",
      `--disable-extensions-except=${root}`,
      `--load-extension=${root}`,
      "https://chatgpt.com/"
    ], {
      stdio: "ignore"
    });

    const version = await fetchJson(`http://${host}:${port}/json/version`);
    const targets = await fetchJson(`http://${host}:${port}/json`);
    const target = targets.find((item) => item.type === "page" && item.url.startsWith("https://chatgpt.com/"));
    assert(target, "ChatGPT page target was not found.");

    browserClient = await connect(version.webSocketDebuggerUrl);
    pageClient = await connect(target.webSocketDebuggerUrl);
    await pageClient.send("Runtime.enable");
    await pageClient.send("Page.enable");

    await waitFor(pageClient, "document.readyState === 'complete' || document.readyState === 'interactive'");
    await waitFor(pageClient, "document.documentElement.dataset.cglfInstalled === 'true'");

    console.log(`Injecting ${turnCount} simulated turns into the live ChatGPT page`);
    const injected = await evaluate(pageClient, injectFixtureExpression(turnCount));
    assert(injected === turnCount, `Expected to inject ${turnCount} turns, got ${injected}.`);

    await waitFor(pageClient, `document.querySelectorAll('[data-testid^="conversation-turn-live-"].cglf-parked').length === ${turnCount - 10}`);
    const initial = await evaluate(pageClient, readStatsExpression());

    assert(initial.installed, "Expected extension installed marker on ChatGPT.");
    assert(initial.injectedTurns === turnCount, `Expected ${turnCount} injected turns, got ${initial.injectedTurns}.`);
    assert(initial.parkedTurns === turnCount - 10, `Expected ${turnCount - 10} parked turns, got ${initial.parkedTurns}.`);
    assert(initial.containedTurns === turnCount, `Expected ${turnCount} contained turns, got ${initial.containedTurns}.`);
    assert(initial.badgeText === `${turnCount - 10} parked`, `Expected badge "${turnCount - 10} parked", got ${initial.badgeText}.`);
    assert(initial.newestTenParked === 0, `Expected newest 10 turns to stay live, got ${initial.newestTenParked} parked.`);

    await evaluate(pageClient, `document.querySelector('[data-testid^="conversation-turn-live-"].cglf-parked').click()`);
    await waitFor(pageClient, `document.querySelectorAll('[data-testid^="conversation-turn-live-"].cglf-parked').length === ${turnCount - 11}`);
    await waitFor(pageClient, `document.querySelector('.cglf-badge-label')?.textContent === '${turnCount - 11} parked'`);

    const afterExpand = await evaluate(pageClient, readStatsExpression());
    assert(afterExpand.parkedTurns === turnCount - 11, `Expected ${turnCount - 11} parked turns after expand, got ${afterExpand.parkedTurns}.`);

    await evaluate(pageClient, `document.querySelector('#cglf-live-fixture')?.remove()`);
    await waitFor(pageClient, "document.querySelectorAll('[data-testid^=\"conversation-turn-live-\"]').length === 0");
    await waitFor(pageClient, "document.querySelector('.cglf-badge-label') === null");

    console.log("Live ChatGPT simulated-thread test passed.");
    console.log(JSON.stringify({ initial, afterExpand }, null, 2));
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
