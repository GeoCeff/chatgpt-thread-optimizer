(() => {
  const INSTALL_FLAG = "__chatgptThreadLiteInstalled";

  if (window[INSTALL_FLAG]) {
    return;
  }

  window[INSTALL_FLAG] = true;

  const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    keepLastTurns: 10,
    minCharactersToPark: 220,
    optimizeHeavyBlocks: true,
    showBadge: true
  });

  const MESSAGE_SELECTORS = [
    'article[data-testid^="conversation-turn-"]',
    '[data-testid^="conversation-turn-"]',
    'article:has([data-message-author-role])'
  ];

  const state = {
    settings: { ...DEFAULT_SETTINGS },
    observer: null,
    scheduled: false,
    badge: null,
    stats: {
      totalTurns: 0,
      parkedTurns: 0,
      containedTurns: 0,
      lastRunAt: null
    }
  };

  document.documentElement.dataset.cglfInstalled = "true";

  function getStorage() {
    return globalThis.chrome?.storage?.sync;
  }

  function normalizeText(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function clampNumber(value, min, max, fallback) {
    const parsed = Number(value);

    if (!Number.isFinite(parsed)) {
      return fallback;
    }

    return Math.min(max, Math.max(min, parsed));
  }

  function sanitizeSettings(settings) {
    return {
      enabled: Boolean(settings.enabled),
      keepLastTurns: clampNumber(
        settings.keepLastTurns,
        2,
        40,
        DEFAULT_SETTINGS.keepLastTurns
      ),
      minCharactersToPark: clampNumber(
        settings.minCharactersToPark,
        80,
        1200,
        DEFAULT_SETTINGS.minCharactersToPark
      ),
      optimizeHeavyBlocks: Boolean(settings.optimizeHeavyBlocks),
      showBadge: Boolean(settings.showBadge)
    };
  }

  async function loadSettings() {
    const storage = getStorage();

    if (!storage) {
      return { ...DEFAULT_SETTINGS };
    }

    return new Promise((resolve) => {
      storage.get(DEFAULT_SETTINGS, (settings) => {
        resolve(sanitizeSettings(settings));
      });
    });
  }

  function getConversationRoot() {
    return document.querySelector("main") || document.body;
  }

  function getObserverRoot() {
    return document.body || document.documentElement;
  }

  function compareDocumentPosition(a, b) {
    if (a === b) {
      return 0;
    }

    return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_PRECEDING ? 1 : -1;
  }

  function removeNestedCandidates(candidates) {
    return candidates.filter((candidate) => {
      return !candidates.some((other) => other !== candidate && other.contains(candidate));
    });
  }

  function getConversationTurns() {
    const root = getConversationRoot();
    const candidates = new Set();

    MESSAGE_SELECTORS.forEach((selector) => {
      try {
        root.querySelectorAll(selector).forEach((node) => {
          if (node instanceof HTMLElement) {
            candidates.add(node);
          }
        });
      } catch (_error) {
        // Some Chromium builds disable :has() in extension contexts.
      }
    });

    return removeNestedCandidates([...candidates])
      .filter((node) => normalizeText(node.textContent).length > 0)
      .sort(compareDocumentPosition);
  }

  function getTurnRole(turn) {
    const roleNode = turn.querySelector("[data-message-author-role]");
    const role = roleNode?.getAttribute("data-message-author-role");

    if (role === "user") {
      return "You";
    }

    if (role === "assistant") {
      return "ChatGPT";
    }

    return "Turn";
  }

  function getTurnPreview(turn) {
    const text = normalizeText(turn.textContent);

    if (!text) {
      return "Parked conversation turn";
    }

    return text.length > 180 ? `${text.slice(0, 177)}...` : text;
  }

  function shouldParkTurn(turn, index, turns) {
    const recentBoundary = turns.length - state.settings.keepLastTurns;
    const isOlderThanWindow = index < recentBoundary;
    const hasEnoughText = normalizeText(turn.textContent).length >= state.settings.minCharactersToPark;

    return isOlderThanWindow && hasEnoughText && turn.dataset.cglfUserExpanded !== "true";
  }

  function containTurn(turn) {
    turn.classList.add("cglf-contained-turn");

    if (state.settings.optimizeHeavyBlocks) {
      turn.dataset.cglfOptimizeHeavyBlocks = "true";
    } else {
      delete turn.dataset.cglfOptimizeHeavyBlocks;
    }
  }

  function parkTurn(turn) {
    if (!turn.dataset.cglfPreview) {
      turn.dataset.cglfPreview = getTurnPreview(turn);
    }

    if (!turn.dataset.cglfHadTabindex) {
      turn.dataset.cglfHadTabindex = turn.hasAttribute("tabindex") ? "true" : "false";
      turn.dataset.cglfOriginalTabindex = turn.getAttribute("tabindex") || "";
    }

    turn.dataset.cglfRole = getTurnRole(turn);
    turn.classList.add("cglf-parked");
    turn.classList.remove("cglf-expanded-once");
    turn.setAttribute("tabindex", "0");
    turn.setAttribute(
      "aria-label",
      `${turn.dataset.cglfRole} parked conversation turn. Press Enter to expand.`
    );
  }

  function restoreTabindex(turn) {
    if (!turn.dataset.cglfHadTabindex) {
      return;
    }

    if (turn.dataset.cglfHadTabindex === "true") {
      turn.setAttribute("tabindex", turn.dataset.cglfOriginalTabindex ?? "");
    } else {
      turn.removeAttribute("tabindex");
    }
  }

  function unparkTurn(turn, rememberExpansion = false) {
    turn.classList.remove("cglf-parked");
    turn.classList.add("cglf-expanded-once");
    turn.removeAttribute("aria-label");

    if (rememberExpansion) {
      turn.dataset.cglfUserExpanded = "true";
    }

    restoreTabindex(turn);
  }

  function resetTurn(turn) {
    restoreTabindex(turn);
    turn.classList.remove("cglf-parked", "cglf-contained-turn", "cglf-expanded-once");
    turn.removeAttribute("aria-label");
    delete turn.dataset.cglfPreview;
    delete turn.dataset.cglfRole;
    delete turn.dataset.cglfUserExpanded;
    delete turn.dataset.cglfOptimizeHeavyBlocks;
    delete turn.dataset.cglfHadTabindex;
    delete turn.dataset.cglfOriginalTabindex;
  }

  function ensureBadge() {
    if (
      !state.settings.showBadge ||
      !state.settings.enabled ||
      state.stats.totalTurns === 0 ||
      state.stats.parkedTurns === 0
    ) {
      state.badge?.remove();
      state.badge = null;
      return;
    }

    if (!state.badge) {
      const badge = document.createElement("div");
      const dot = document.createElement("span");
      const label = document.createElement("span");

      badge.className = "cglf-badge";
      dot.className = "cglf-badge-dot";
      label.className = "cglf-badge-label";

      badge.append(dot, label);
      document.documentElement.append(badge);
      state.badge = badge;
    }

    const label = state.badge.querySelector(".cglf-badge-label");

    if (label) {
      label.textContent = `${state.stats.parkedTurns} parked`;
    }
  }

  function runOptimizer() {
    state.scheduled = false;

    try {
      const turns = getConversationTurns();
      let parkedTurns = 0;
      let containedTurns = 0;

      turns.forEach((turn, index) => {
        if (!state.settings.enabled) {
          resetTurn(turn);
          return;
        }

        containTurn(turn);
        containedTurns += 1;

        if (shouldParkTurn(turn, index, turns)) {
          parkTurn(turn);
          parkedTurns += 1;
        } else {
          unparkTurn(turn);
        }
      });

      state.stats = {
        totalTurns: turns.length,
        parkedTurns,
        containedTurns,
        lastRunAt: new Date().toISOString()
      };

      ensureBadge();
    } catch (error) {
      console.warn("[ChatGPT Thread Lite] Optimizer skipped a run.", error);
    }
  }

  function scheduleOptimizer() {
    if (state.scheduled) {
      return;
    }

    state.scheduled = true;
    window.requestAnimationFrame(runOptimizer);
  }

  function expandAll() {
    getConversationTurns().forEach((turn) => {
      unparkTurn(turn, true);
    });

    scheduleOptimizer();
  }

  function handleTurnActivation(event) {
    const turn = event.target instanceof Element ? event.target.closest(".cglf-parked") : null;

    if (!turn) {
      return;
    }

    if (event.type === "keydown" && !["Enter", " "].includes(event.key)) {
      return;
    }

    event.preventDefault();
    unparkTurn(turn, true);
    scheduleOptimizer();
  }

  function handleMessages(message, _sender, sendResponse) {
    if (message?.type === "CGLF_GET_STATUS") {
      sendResponse({
        settings: state.settings,
        stats: state.stats
      });
      return true;
    }

    if (message?.type === "CGLF_APPLY_SETTINGS") {
      state.settings = sanitizeSettings({ ...state.settings, ...message.settings });
      scheduleOptimizer();
      sendResponse({
        settings: state.settings,
        stats: state.stats
      });
      return true;
    }

    if (message?.type === "CGLF_EXPAND_ALL") {
      expandAll();
      sendResponse({
        settings: state.settings,
        stats: state.stats
      });
      return true;
    }

    if (message?.type === "CGLF_RUN_NOW") {
      scheduleOptimizer();
      sendResponse({
        settings: state.settings,
        stats: state.stats
      });
      return true;
    }

    return false;
  }

  async function start() {
    state.settings = await loadSettings();

    document.addEventListener("click", handleTurnActivation, true);
    document.addEventListener("keydown", handleTurnActivation, true);

    globalThis.chrome?.runtime?.onMessage?.addListener(handleMessages);
    globalThis.chrome?.storage?.onChanged?.addListener((changes, areaName) => {
      if (areaName !== "sync") {
        return;
      }

      const nextSettings = { ...state.settings };

      Object.keys(DEFAULT_SETTINGS).forEach((key) => {
        if (changes[key]) {
          nextSettings[key] = changes[key].newValue;
        }
      });

      state.settings = sanitizeSettings(nextSettings);
      scheduleOptimizer();
    });

    state.observer = new MutationObserver(scheduleOptimizer);
    state.observer.observe(getObserverRoot(), {
      childList: true,
      subtree: true
    });

    scheduleOptimizer();
  }

  start();
})();
