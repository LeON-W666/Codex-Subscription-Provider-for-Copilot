# Publishing

## Build both distributions

```powershell
npm ci
npm run package:all
```

Outputs:

- `copilot-codex-provider-0.6.3-thin.vsix`
- `copilot-codex-provider-0.6.3-win32-x64-full.vsix`

## Runtime compatibility smoke

Run the same streamed-turn smoke against every Runtime that will be shipped or
recommended. `CODEX_SMOKE_MODEL` must be an explicit model visible to the
current ChatGPT subscription.

```powershell
$env:CODEX_SMOKE_MODEL = "<model-id>"
$env:CODEX_RUNTIME_SOURCE = "thin-path"
Remove-Item Env:CODEX_EXECUTABLE -ErrorAction SilentlyContinue
npm run smoke:codex

$env:CODEX_RUNTIME_SOURCE = "thin-official-extension"
$env:CODEX_EXECUTABLE = "<official-extension-codex.exe>"
npm run smoke:codex

$env:CODEX_RUNTIME_SOURCE = "full-win32-x64"
$env:CODEX_EXECUTABLE = "<full-package-codex.exe>"
npm run smoke:codex
```

Each run must report SDK and Runtime versions, known event/item type sets,
event count, validated usage, and `PASS`. Payloads and final response content
must not be printed.

## Marketplace

The Marketplace package must be the Thin VSIX. It discovers Codex from an
explicit path, `PATH`, or the official OpenAI VS Code extension.

```powershell
npx vsce login leonbwang
npm run publish:marketplace
```

For the first publication, the Thin VSIX can also be uploaded manually from
the Visual Studio Marketplace publisher portal.

## GitHub Release

Commit source code and `package-lock.json`, but do not commit generated VSIX
files. Create a `v0.6.3` tag; the release workflow builds both distributions
and attaches them to the GitHub Release.
