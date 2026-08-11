# Codex Subscription Provider for Copilot

<p align="center">
  <img src="images/icon.png" alt="Codex Subscription Provider for Copilot icon" width="160">
</p>

An unofficial Visual Studio Code extension that connects GitHub Copilot Chat to local Codex models using your ChatGPT subscription. Codex handles reasoning while Copilot executes tools and workspace edits, without requiring an OpenAI API key.

> [!IMPORTANT]
> This is an independent, unofficial project. It is not affiliated with or endorsed by OpenAI, GitHub, or Microsoft.

[简体中文](README.zh-CN.md)

## 0.6.2 Runtime Event Stream Guarding

- Processes complete Codex turns through `runStreamed()` without exposing
  intermediate Runtime content to Copilot.
- Rejects forbidden, unknown, malformed, incomplete, or failed Runtime streams
  before Bridge output is accepted.
- Keeps security and Runtime failures ahead of ordinary cancellation and checks
  cancellation again before every Copilot response part.
- Reports privacy-safe event counts, lifecycle timings, and token usage in
  Last Request Details.
- Uses Codex SDK `0.146.0`; Full Win64 bundles Runtime
  `0.146.0-win32-x64`, while Thin builds smoke-test the selected external
  official Runtime.

## 0.6.0 Provider Reliability

- Links Copilot-supplied virtual workspace URI resolvers to compatible editing
  tools while keeping all tool execution inside Copilot.
- Compacts long conversations as complete tool-call/result groups with a
  configurable bridge input budget.
- Treats the narrowly identified skill-description budget warning as
  recoverable only when the final structured response remains valid.
- Keeps unknown Runtime errors, forbidden Codex side effects, and unauthorized
  tool calls fail-closed.

## How It Works

```text
GitHub Copilot Agent
  -> conversation, images, selected model, and available tools
Codex Subscription Provider
  -> local Codex runtime and ChatGPT/Codex subscription
Codex
  -> text response or structured tool-call request
Provider
  -> response returned to Copilot Agent
GitHub Copilot Agent
  -> executes VS Code tools, MCP calls, and workspace edits
```

The provider does not register or execute SAP, MCP, terminal, or file-editing tools itself. It only forwards the tools supplied by Copilot for the current request. Copilot remains responsible for tool execution, confirmation, and virtual-file changes.

## Features

- Explicit Codex model selection in the Copilot model picker
- Configurable model reasoning effort
- Image and screenshot input
- Structured forwarding of Copilot tool calls
- ChatGPT subscription authentication with API-key authentication rejected
- Automatic discovery of the local Codex runtime
- Read-only, isolated Codex working directory with network and MCP disabled
- Runtime, model-catalog, and last-request diagnostics
- No extension-specific analytics or telemetry

## Requirements

- Visual Studio Code `1.109.0` or later
- GitHub Copilot Chat in Agent mode
- Codex signed in with **Sign in with ChatGPT**
- For the Thin distribution, an official Codex runtime available from an explicitly configured path, the system `PATH`, or the official OpenAI VS Code extension

## Installation

Install the Thin distribution from the [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=leonbwang.copilot-codex-provider), or install a VSIX from [GitHub Releases](https://github.com/LeON-W666/Codex-Subscription-Provider-for-Copilot/releases).

After installation:

1. Run `Developer: Reload Window`.
2. Run `Codex Subscription Provider: Check Codex Runtime`.
3. Run `Codex Subscription Provider: Refresh Models`.
4. Open Copilot Chat and switch to Agent mode.
5. Select an explicit `Codex Subscription | ...` model.
6. Ask Copilot to analyze, edit, review, or test your workspace.

## Configuration

```json
{
  "copilotCodexProvider.runtimeMode": "auto",
  "copilotCodexProvider.codexExecutablePath": "",
  "copilotCodexProvider.modelSource": "discovered",
  "copilotCodexProvider.enabledModels": [],
  "copilotCodexProvider.reasoningEffort": "model-default"
}
```

### Runtime modes

- `auto`: configured path, system `PATH`, official OpenAI VS Code extension, then the bundled runtime when available.
- `external`: require an external official Codex runtime.
- `bundled`: require the runtime included in a Full distribution.

### Models and reasoning

The extension discovers subscription-visible models through the local `codex app-server` model catalog. Each model is exposed as a separate Copilot model-picker entry. The selected model ID is passed to Codex without a silent fallback.

`copilotCodexProvider.reasoningEffort` supports `model-default`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`, and `ultra`. Unsupported values are rejected instead of silently downgraded.

### Image input

- Up to 20 images and 50 MiB per request
- Duplicate images removed using SHA-256
- Temporary image files deleted after each request
- Requests rejected when the selected model does not declare image support

## Privacy and Security

The extension checks the local Codex ChatGPT authentication state and removes common API-key and custom OpenAI endpoint variables before starting Codex. It does not log prompts, source code, image contents, credentials, tool arguments, or tool results.

Requests are processed by the selected local Codex runtime under the applicable OpenAI terms. Copilot and any enabled MCP tools remain subject to their own terms and privacy policies.

See [PRIVACY.md](PRIVACY.md), [SECURITY.md](SECURITY.md), and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for details.

## Development

```powershell
npm ci
npm run validate
npm run package:thin
```

The test suite covers subscription-auth validation, runtime resolution, model
catalog parsing, image handling, guarded Runtime event aggregation,
cancellation races, structured tool-call bridging, and SDK loading.

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening an issue or pull request.

## Distributions

| Distribution | Target | Runtime |
| --- | --- | --- |
| Thin | Marketplace and cross-platform VSIX | Uses an official runtime installed by the user |
| Full Win64 | GitHub Release for Windows x64 | Includes the official Codex runtime |

Marketplace releases use the Thin package. Full Win64 packages are distributed only through GitHub Releases.

## License

The extension source code is licensed under the [MIT License](LICENSE). OpenAI Codex components retain their original Apache-2.0 license.
