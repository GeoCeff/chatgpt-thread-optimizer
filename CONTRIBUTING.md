# Contributing

Thanks for taking a look at ChatGPT Thread Lite.

This project is intentionally conservative: it should improve long-thread usability without deleting conversation content, patching ChatGPT's bundled JavaScript, or sending chat data anywhere.

## Local Setup

```bash
npm run check
npm run demo
```

Then open `http://127.0.0.1:5173/demo/`.

## Testing

```bash
npm run check
npm run test:long-thread
npm run test:live-simulated
```

The browser tests use Microsoft Edge on Windows by default. If Edge is installed somewhere else, set `EDGE_PATH`.

For a heavier stress test:

```bash
CGLF_FIXTURE_TURNS=1000 npm run test:long-thread
```

On PowerShell:

```powershell
$env:CGLF_FIXTURE_TURNS='1000'; npm run test:long-thread
```

## Change Guidelines

- Prefer reversible DOM and CSS changes.
- Avoid collecting analytics or transmitting page content.
- Keep selectors defensive because ChatGPT's DOM can change.
- Add or update tests when changing turn detection, parking behavior, settings, or messaging.
- Be honest about limits: this is a client-side mitigation, not a full fix for ChatGPT internals.

## Pull Request Checklist

- `npm run check` passes.
- Long-thread behavior has been tested locally.
- README or docs are updated if behavior changes.
- Privacy assumptions remain unchanged.
