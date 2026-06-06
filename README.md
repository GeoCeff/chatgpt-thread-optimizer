# ChatGPT Thread Optimizer

ChatGPT Thread Optimizer is a Manifest V3 browser extension that reduces lag in very long ChatGPT conversations by keeping recent turns fully live and parking older, lengthy turns into lightweight placeholders.

It is designed as a safe client-side mitigation, not a server-side patch. The extension does not alter your account, send chat data anywhere, or delete conversation content. Parked turns expand in-place when clicked.

## Repository Description

Browser extension that reduces long ChatGPT thread lag by parking older turns and keeping recent turns live.

## Why This Exists

Long AI chats can become slow because the browser still has to manage a large page full of message DOM, markdown, code blocks, tables, and syntax highlighting. As a thread grows, scrolling and typing can become increasingly expensive.

This extension targets the parts a browser extension can reasonably influence:

- Applies `content-visibility` to conversation turns so off-screen content can skip rendering work.
- Parks older long turns behind compact placeholders while keeping the newest turns live.
- Adds optional containment to heavy markdown, code, and table blocks.
- Leaves the original ChatGPT app and conversation data intact.

## Limits

This cannot truly fix every memory issue inside the ChatGPT web app. React state, browser internals, extension conflicts, and ChatGPT's own rendering strategy are outside the extension's control. The goal is to reduce layout, paint, and scroll pressure during long sessions while staying reversible.

## Install Locally

1. Clone or download this repository.
2. Open Chrome or Edge and go to `chrome://extensions`.
3. Enable **Developer mode**.
4. Choose **Load unpacked**.
5. Select this project folder.
6. Open `https://chatgpt.com` and start or open a long conversation.

## Test

```bash
npm run check
npm run test:long-thread
npm run test:live-simulated
```

`test:long-thread` runs a local long-thread browser simulation. By default it uses 240 turns; set `CGLF_FIXTURE_TURNS=1000` for a heavier stress run.

`test:live-simulated` launches ChatGPT with the unpacked extension, injects simulated turns into the live page, and verifies that the actual extension content script parks older turns. The injected fixture stays local to that temporary browser session.

## How It Works

The content script watches the conversation area with a `MutationObserver`. When it finds conversation turns, it:

1. Keeps the newest configured number of turns fully visible.
2. Converts older long turns into compact placeholders.
3. Restores a parked turn immediately when you click it or press Enter while focused.
4. Re-runs when ChatGPT adds new messages or when settings change.

The implementation favors reversible DOM and CSS changes over aggressive deletion. That makes it less likely to break when ChatGPT updates its frontend.

## Project Structure

```text
CONTRIBUTING.md
SECURITY.md
CHANGELOG.md
manifest.json
src/
  content.css
  content.js
  popup.css
  popup.html
  popup.js
demo/
docs/
scripts/
```

## Documentation

- [Architecture](docs/architecture.md)
- [Testing](docs/testing.md)
- [Repository metadata](docs/repository-metadata.md)
- [Portfolio case study](docs/portfolio-case-study.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)

## Portfolio Notes

This project is useful to discuss because it demonstrates:

- Browser extension architecture with Manifest V3.
- DOM observation and defensive selectors on a third-party app.
- Rendering performance techniques like `content-visibility` and containment.
- Product judgment around safe defaults and reversible UX.
- Honest technical boundaries for client-side performance fixes.

See [docs/portfolio-case-study.md](docs/portfolio-case-study.md) for a concise write-up you can adapt for a portfolio page.

## Roadmap

- Add Firefox support.
- Add optional per-domain profiles.
- Add a performance overlay using `PerformanceObserver`.
- Add automated fixture tests for message detection.
- Publish a signed Chrome Web Store build.

## Privacy

The extension does not collect analytics, make network requests, or transmit chat content. Settings are stored with `chrome.storage.sync`.

## License

MIT
