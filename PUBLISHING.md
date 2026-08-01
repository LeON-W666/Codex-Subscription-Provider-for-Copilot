# Publishing

## Build both distributions

```powershell
npm ci
npm run package:all
```

Outputs:

- `copilot-codex-provider-0.6.0-thin.vsix`
- `copilot-codex-provider-0.6.0-win32-x64-full.vsix`

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
files. Create a `v0.6.0` tag; the release workflow builds both distributions
and attaches them to the GitHub Release.
