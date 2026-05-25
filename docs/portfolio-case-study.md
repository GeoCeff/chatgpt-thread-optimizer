# Portfolio Case Study: ChatGPT Thread Lite

## Problem

Long ChatGPT conversations can become slower over time because the browser continues managing a large rendered document: message turns, markdown, syntax-highlighted code, tables, and interactive controls. The visible symptom is lag while scrolling or typing in a thread that has grown very large.

## Goal

Build a browser extension that improves long-thread usability without depending on private APIs, scraping account data, or making destructive changes to the page.

## Approach

The extension uses a content script to watch the conversation page and apply reversible optimizations:

- Recent turns remain fully live so the current conversation stays natural.
- Older long turns are parked behind compact placeholders.
- Clicking a parked turn expands it in place.
- CSS `content-visibility` reduces off-screen rendering work.
- A popup lets users tune how aggressively old turns are parked.

## Why This Design

The extension deliberately avoids deleting conversation nodes or trying to patch ChatGPT's bundled JavaScript. That would be fragile and could break whenever the site changes. Instead, it uses defensive DOM selectors, CSS containment, and small reversible mutations.

This means the extension cannot eliminate every source of memory use. It focuses on a narrower and safer target: reducing layout and paint pressure in long conversations.

## Technical Highlights

- Manifest V3 browser extension architecture.
- `MutationObserver` for dynamic third-party app updates.
- Defensive selector strategy for changing DOM structures.
- `chrome.storage.sync` settings persistence.
- Popup-to-content-script messaging.
- Rendering optimization with `content-visibility` and containment.
- Accessible parked-turn expansion with click and keyboard support.
- Automated browser simulations against both a local fixture and the live ChatGPT page.

## Tradeoffs

The safest approach is not the most aggressive one. A more aggressive extension could remove old DOM nodes entirely and rebuild them on demand, but that risks fighting React reconciliation and losing interactive state. The current project chooses reliability and reversibility over maximum memory reduction.

## Future Work

- Add fixture-based tests for message detection.
- Add Firefox support.
- Add a measured performance overlay for before/after comparisons.
- Add an optional experimental mode that snapshots old turns more aggressively.
- Publish signed builds for Chrome Web Store and Edge Add-ons.
