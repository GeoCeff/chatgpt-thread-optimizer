# Testing

This project has three levels of testing.

## Static Validation

```bash
npm run check
```

This verifies required files, Manifest V3 structure, manifest file references, and JavaScript syntax.

## Local Long-Thread Simulation

```bash
npm run test:long-thread
```

This launches a temporary browser, serves the local demo fixture, and verifies:

- The extension installs in the simulated page.
- Older turns are parked.
- Recent turns remain live.
- Click-to-expand works.
- Disabling the extension removes parking and containment.
- Aggressive settings park more turns.
- Newly appended turns are detected.
- Expand-all runtime messaging works.

Set `CGLF_FIXTURE_TURNS` to increase thread size.

## Live ChatGPT Simulated Thread

```bash
npm run test:live-simulated
```

This launches `https://chatgpt.com/` with the unpacked extension, injects a local simulated long thread into that page, and verifies the actual content script behavior on the real ChatGPT origin.

The injected turns do not use your account, send prompts, or modify ChatGPT history.

## Manual QA

For a real account/thread test:

1. Load the unpacked extension.
2. Open a long ChatGPT conversation.
3. Confirm older turns become compact placeholders.
4. Confirm recent turns remain readable and interactive.
5. Click a parked turn and confirm it expands.
6. Use the popup to disable the extension and confirm all turns return.
7. Check the browser console for extension warnings or errors.
