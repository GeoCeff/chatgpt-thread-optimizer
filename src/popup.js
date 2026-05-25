const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  keepLastTurns: 10,
  minCharactersToPark: 220,
  optimizeHeavyBlocks: true,
  showBadge: true
});

const controls = {
  enabled: document.querySelector("#enabled"),
  keepLastTurns: document.querySelector("#keepLastTurns"),
  keepLastTurnsValue: document.querySelector("#keepLastTurnsValue"),
  minCharactersToPark: document.querySelector("#minCharactersToPark"),
  minCharactersToParkValue: document.querySelector("#minCharactersToParkValue"),
  optimizeHeavyBlocks: document.querySelector("#optimizeHeavyBlocks"),
  showBadge: document.querySelector("#showBadge"),
  status: document.querySelector("#status"),
  runNow: document.querySelector("#runNow"),
  expandAll: document.querySelector("#expandAll")
};

let settings = { ...DEFAULT_SETTINGS };

function setStatus(text) {
  controls.status.textContent = text;
}

function readSettingsFromControls() {
  return {
    enabled: controls.enabled.checked,
    keepLastTurns: Number(controls.keepLastTurns.value),
    minCharactersToPark: Number(controls.minCharactersToPark.value),
    optimizeHeavyBlocks: controls.optimizeHeavyBlocks.checked,
    showBadge: controls.showBadge.checked
  };
}

function renderSettings(nextSettings) {
  settings = { ...settings, ...nextSettings };

  controls.enabled.checked = settings.enabled;
  controls.keepLastTurns.value = String(settings.keepLastTurns);
  controls.keepLastTurnsValue.value = String(settings.keepLastTurns);
  controls.minCharactersToPark.value = String(settings.minCharactersToPark);
  controls.minCharactersToParkValue.value = String(settings.minCharactersToPark);
  controls.optimizeHeavyBlocks.checked = settings.optimizeHeavyBlocks;
  controls.showBadge.checked = settings.showBadge;
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  return tabs[0];
}

async function sendToActiveTab(message) {
  const tab = await getActiveTab();

  if (!tab?.id || !/^https:\/\/(chatgpt\.com|chat\.openai\.com)\//.test(tab.url || "")) {
    setStatus("Open ChatGPT to use this");
    return null;
  }

  try {
    return await chrome.tabs.sendMessage(tab.id, message);
  } catch (_error) {
    setStatus("Refresh ChatGPT to connect");
    return null;
  }
}

function renderStats(stats) {
  if (!stats) {
    return;
  }

  setStatus(`${stats.parkedTurns} parked of ${stats.totalTurns} turns`);
}

async function saveSettings() {
  settings = readSettingsFromControls();
  await chrome.storage.sync.set(settings);
  const response = await sendToActiveTab({
    type: "CGLF_APPLY_SETTINGS",
    settings
  });

  renderStats(response?.stats);
}

function bindControlEvents() {
  [
    controls.enabled,
    controls.keepLastTurns,
    controls.minCharactersToPark,
    controls.optimizeHeavyBlocks,
    controls.showBadge
  ].forEach((control) => {
    control.addEventListener("input", () => {
      renderSettings(readSettingsFromControls());
      saveSettings();
    });
  });

  controls.runNow.addEventListener("click", async () => {
    const response = await sendToActiveTab({ type: "CGLF_RUN_NOW" });
    renderStats(response?.stats);
  });

  controls.expandAll.addEventListener("click", async () => {
    const response = await sendToActiveTab({ type: "CGLF_EXPAND_ALL" });
    renderStats(response?.stats);
  });
}

async function init() {
  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  renderSettings(stored);
  bindControlEvents();

  const response = await sendToActiveTab({ type: "CGLF_GET_STATUS" });

  if (response?.settings) {
    renderSettings(response.settings);
  }

  renderStats(response?.stats);
}

init();
