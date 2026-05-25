# Architecture

ChatGPT Thread Lite is a Manifest V3 browser extension with one content script and one popup.

## Content Script

Files:

- `src/content.js`
- `src/content.css`

The content script runs on `https://chatgpt.com/*` and `https://chat.openai.com/*`.

It watches the page with a `MutationObserver`, detects conversation turns, and applies two optimizations:

- `content-visibility` and containment for all detected turns.
- Compact parked placeholders for older long turns outside the recent-turn window.

Parking is reversible. The original DOM nodes stay in the page and expand in place when clicked or focused and activated with the keyboard.

## Popup

Files:

- `src/popup.html`
- `src/popup.css`
- `src/popup.js`

The popup stores settings in `chrome.storage.sync` and sends runtime messages to the active ChatGPT tab.

## Detection Strategy

The extension looks for conversation-turn test IDs and message role attributes. This is intentionally defensive because ChatGPT's DOM can change.

The current selectors are:

- `article[data-testid^="conversation-turn-"]`
- `[data-testid^="conversation-turn-"]`
- `article:has([data-message-author-role])`

Nested matches are filtered so a turn is only counted once.

## Safety Model

The extension does not:

- Delete conversation content.
- Patch ChatGPT's bundled JavaScript.
- Send chat content to a server.
- Persist message text.

This design trades maximum memory reduction for reliability and reversibility.
