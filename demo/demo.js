const conversation = document.querySelector("#conversation");
const addTurnButton = document.querySelector("#add-turn");
const requestedTurns = Number(new URLSearchParams(location.search).get("turns"));
const initialTurnCount = Number.isFinite(requestedTurns)
  ? Math.min(1000, Math.max(1, requestedTurns))
  : 64;

const paragraphs = [
  "This is a deliberately long demo turn used to simulate the way large AI conversations accumulate many rendered nodes, markdown sections, code blocks, and repeated layout work over time.",
  "The extension keeps recent turns live while older turns become compact placeholders. Clicking one of those placeholders restores the original content immediately.",
  "In the real ChatGPT site, the same content script runs as an unpacked Manifest V3 extension instead of being loaded directly by this demo page."
];

function longText(index) {
  return paragraphs
    .map((paragraph) => `${paragraph} Fixture turn ${index} repeats enough content to cross the parking threshold.`)
    .join(" ");
}

function makeCode(index) {
  return `function optimizeTurn${index}(turn) {
  const isOlder = turn.index < turn.total - 10;
  const isLong = turn.text.length > 220;
  return isOlder && isLong ? "park" : "keep-live";
}`;
}

function createTurn(index) {
  const role = index % 3 === 0 ? "user" : "assistant";
  const article = document.createElement("article");
  const roleLabel = document.createElement("div");
  const message = document.createElement("div");

  article.dataset.testid = `conversation-turn-${index}`;
  article.dataset.demoRole = role;
  roleLabel.className = "role";
  roleLabel.dataset.messageAuthorRole = role;
  roleLabel.textContent = role === "user" ? "You" : "ChatGPT";
  message.className = "markdown prose";
  message.innerHTML = `
    <p>${longText(index)}</p>
    <p>${longText(index + 100)}</p>
    ${
      index % 4 === 0
        ? `<pre><code>${makeCode(index)}</code></pre>`
        : `<table>
            <thead>
              <tr><th>Metric</th><th>Value</th></tr>
            </thead>
            <tbody>
              <tr><td>Turn</td><td>${index}</td></tr>
              <tr><td>Rendered blocks</td><td>${index * 6}</td></tr>
            </tbody>
          </table>`
    }
  `;

  article.append(roleLabel, message);
  return article;
}

function appendTurns(count) {
  const start = conversation.children.length + 1;
  const fragment = document.createDocumentFragment();

  for (let index = start; index < start + count; index += 1) {
    fragment.append(createTurn(index));
  }

  conversation.append(fragment);
}

addTurnButton.addEventListener("click", () => {
  appendTurns(1);
});

appendTurns(initialTurnCount);
