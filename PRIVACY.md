# Privacy

This extension is an unofficial local bridge between GitHub Copilot Chat and
the Codex runtime selected by the user.

## Data processing

- Prompts, conversation context, attached images, and Copilot tool definitions
  are passed to the local Codex runtime for model processing.
- The Codex runtime may transmit that content to OpenAI under the user's
  ChatGPT/Codex subscription and applicable OpenAI terms.
- Copilot executes any VS Code or MCP tool calls. This extension does not
  directly execute those tools.
- Temporary image files are stored only for the duration of a request and are
  removed afterward. Stale image directories are cleaned on activation.

## Credentials and telemetry

- The extension checks the local Codex ChatGPT authentication state.
- It does not require or intentionally use an OpenAI API key.
- It does not collect product analytics or operate a separate telemetry
  service.
- Logs exclude prompt content, image bytes, credentials, tool arguments, and
  tool results.

Users should review the privacy policies and terms for OpenAI, GitHub Copilot,
Visual Studio Code, and any MCP tools they enable.
