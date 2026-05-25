const endpoint = process.env.CDP_ENDPOINT || "http://127.0.0.1:9223";

async function getChatGptTarget() {
  const response = await fetch(`${endpoint}/json`);

  if (!response.ok) {
    throw new Error(`Unable to read CDP targets: ${response.status}`);
  }

  const targets = await response.json();
  const target = targets.find((item) => {
    return item.type === "page" && /^https:\/\/chatgpt\.com\//.test(item.url);
  });

  if (!target) {
    throw new Error("No open ChatGPT page found in the debug browser.");
  }

  return target;
}

function connect(webSocketDebuggerUrl) {
  const socket = new WebSocket(webSocketDebuggerUrl);
  let nextId = 1;
  const pending = new Map();

  socket.addEventListener("message", (event) => {
    const payload = JSON.parse(event.data);

    if (!payload.id || !pending.has(payload.id)) {
      return;
    }

    const { resolve, reject } = pending.get(payload.id);
    pending.delete(payload.id);

    if (payload.error) {
      reject(new Error(payload.error.message));
    } else {
      resolve(payload.result);
    }
  });

  return new Promise((resolve, reject) => {
    socket.addEventListener("open", () => {
      resolve({
        send(method, params = {}) {
          const id = nextId;
          nextId += 1;

          socket.send(JSON.stringify({ id, method, params }));

          return new Promise((methodResolve, methodReject) => {
            pending.set(id, {
              resolve: methodResolve,
              reject: methodReject
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

const expression = `(() => {
  const turnSelector = '[data-testid^="conversation-turn-"], article:has([data-message-author-role])';
  const turns = Array.from(document.querySelectorAll(turnSelector));
  const uniqueTurns = turns.filter((turn, index) => turns.findIndex((other) => other !== turn && other.contains(turn)) === -1);
  const parked = document.querySelectorAll('.cglf-parked');
  const contained = document.querySelectorAll('.cglf-contained-turn');
  const badge = document.querySelector('.cglf-badge-label');

  return {
    url: location.href,
    title: document.title,
    extensionInstalled: document.documentElement.dataset.cglfInstalled === 'true',
    totalTurns: uniqueTurns.length,
    parkedTurns: parked.length,
    containedTurns: contained.length,
    badgeText: badge ? badge.textContent : null,
    hasPromptBox: Boolean(document.querySelector('textarea, [contenteditable="true"]')),
    bodyTextSample: document.body.innerText.slice(0, 300)
  };
})()`;

const target = await getChatGptTarget();
const client = await connect(target.webSocketDebuggerUrl);

try {
  await client.send("Runtime.enable");
  const result = await client.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true
  });

  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || "Runtime evaluation failed.");
  }

  console.log(JSON.stringify(result.result.value, null, 2));
} finally {
  client.close();
}
