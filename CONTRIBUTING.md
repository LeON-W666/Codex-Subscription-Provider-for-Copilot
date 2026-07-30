# Contributing

Thank you for helping improve Codex Subscription Provider for Copilot.

## Before opening an issue

- Search existing issues first.
- Remove credentials, source code, customer data, SAP connection details, local paths, and other private information from screenshots and logs.
- Use GitHub private vulnerability reporting for security issues.

## Development

Requirements:

- Node.js 22
- Visual Studio Code 1.109.0 or later
- An official Codex runtime for manual integration testing

Install and validate:

```powershell
npm ci
npm run validate
```

Build the Marketplace-compatible Thin package:

```powershell
npm run package:thin
```

## Pull requests

- Keep changes focused.
- Add or update tests for behavior changes.
- Run `npm run validate` before submitting.
- Do not commit `node_modules`, `dist`, `vendor`, `runtime`, VSIX files, credentials, authentication files, or private workspace data.
- Explain the behavior change, motivation, and verification performed.

By contributing, you agree that your contribution is licensed under the repository MIT License.