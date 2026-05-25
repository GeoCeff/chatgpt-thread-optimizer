import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const requiredFiles = [
  "manifest.json",
  "demo/chrome-shim.js",
  "demo/demo.css",
  "demo/demo.js",
  "demo/index.html",
  "src/content.css",
  "src/content.js",
  "src/popup.css",
  "src/popup.html",
  "src/popup.js",
  "README.md",
  "LICENSE"
];

for (const file of requiredFiles) {
  if (!existsSync(file)) {
    throw new Error(`Missing required file: ${file}`);
  }
}

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));

if (manifest.manifest_version !== 3) {
  throw new Error("Expected a Manifest V3 extension.");
}

if (!manifest.content_scripts?.length) {
  throw new Error("Expected at least one content script.");
}

for (const contentScript of manifest.content_scripts) {
  for (const file of [...(contentScript.css || []), ...(contentScript.js || [])]) {
    if (!existsSync(file)) {
      throw new Error(`Manifest references missing file: ${file}`);
    }
  }
}

if (!existsSync(manifest.action?.default_popup || "")) {
  throw new Error("Manifest action.default_popup is missing.");
}

for (const file of [
  "demo/chrome-shim.js",
  "demo/demo.js",
  "scripts/inspect-live.mjs",
  "scripts/serve-demo.mjs",
  "scripts/test-live-simulated-thread.mjs",
  "scripts/test-long-thread.mjs",
  "src/content.js",
  "src/popup.js"
]) {
  execFileSync(process.execPath, ["--check", file], {
    stdio: "inherit"
  });
}

console.log("Extension validation passed.");
