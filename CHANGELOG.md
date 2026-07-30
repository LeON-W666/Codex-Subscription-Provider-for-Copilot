# Changelog

## 0.5.2 - SDK Compatibility and Icon

- Fixed `ERR_INVALID_ARG_VALUE: filename ... Received undefined` on the first
  provider request by loading the Codex SDK as native ESM instead of embedding
  it in the CommonJS extension bundle.
- Added an SDK initialization smoke test that exercises `import.meta.url`.
- Added the selected Copilot-with-ChatGPT-cap Marketplace icon.

## 0.5.1 - Runtime Discovery Hotfix

- Fixed Thin builds failing when the VS Code Extension Host does not inherit
  the Codex App entry in `PATH`.
- Added automatic discovery of the Codex executable bundled with the official
  `openai.chatgpt` VS Code extension.
- Added diagnostics that distinguish PATH, official-extension, configured, and
  Full-bundle Runtime sources.

## 0.5.0 - Distribution

- Added Marketplace Thin and GitHub Full Win64 distributions.
- Added `auto`, `external`, and `bundled` Codex runtime modes.
- Added official Codex executable discovery through the system `PATH`.
- Added the `Check Codex Runtime` diagnostic command.
- Bundled the TypeScript SDK into the extension entry point.
- Added public distribution metadata, privacy information, and third-party notices.

## 0.4.1 - Reliability

- Reduced image token-estimation overhead.
- Read image capabilities from the Codex model catalog.
- Deduplicated repeated image history and cleaned stale temporary images.
