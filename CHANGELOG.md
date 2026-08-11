# Changelog

## 0.6.3 - Tool Activation Recovery

Released 2026-08-03.

- Classify direct, dynamically loadable, and unavailable Copilot tool
  capabilities from the tools supplied in the current request.
- Request matching tool-group activators before declaring a requested
  capability unavailable.
- Retry an incorrect unavailable-capability answer at most once while keeping
  all tool execution and virtual-resource edits under Copilot control.
- Distinguish tool-group loading, object management, and successful object
  activation evidence.

## 0.6.2 - Runtime Event Stream Guarding

Released 2026-08-03.

- Process Codex turns through the SDK Runtime event stream while preserving
  complete Bridge JSON validation before returning text or tool calls.
- Detect known forbidden Runtime activity earlier and terminate the Runtime to
  reduce the exposure window.
- Fail closed on unknown Runtime events, item types, malformed completed items,
  invalid usage, and incomplete event streams.
- Preserve typed security and Runtime failures across cancellation races, and
  prevent output after late cancellation.
- Record privacy-safe Runtime lifecycle timings and token usage.
- Add Thin and Full Runtime compatibility smoke coverage.
- Pin the Codex SDK to `0.146.0`; the Full Win64 package uses the
  `0.146.0-win32-x64` Runtime. Thin packages use the selected external official
  Runtime and report its version during compatibility smoke testing.
- Compatibility smoke passed with SDK `0.146.0` against Full Runtime `0.146.0`
  and the current PATH/official-extension Runtime `0.146.0-alpha.9.2`.

## 0.6.1 - Marketplace Packaging Refresh

Released 2026-08-02.

- Repackage the 0.6.0 Provider reliability changes as version 0.6.1 for
  Visual Studio Marketplace upload.
- No Provider behavior changes are included in this packaging-only release.

## 0.6.0 - Provider Reliability and Virtual Resource Editing

Released 2026-08-02.

- Link Copilot-supplied virtual workspace URI resolvers to compatible editing
  tools without moving tool execution into the Provider.
- Add evidence-preserving conversation compaction with a configurable bridge
  input budget and privacy-safe request metrics.
- Add conditional diagnostics and activation guidance that never advertises a
  tool Copilot did not supply.
- Treat the narrowly identified skill-description shortening item as a
  recoverable Runtime warning when a non-empty, protocol-valid response is
  available.
- Keep unknown Runtime errors, forbidden side effects, invalid responses, and
  unauthorized tool calls fail-closed.
- Add privacy-safe result diagnostics without logging raw Runtime messages or
  response content.

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
