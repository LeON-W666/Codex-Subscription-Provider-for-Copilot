# Security Policy

## Supported versions

Security fixes are provided for the latest published version.

## Reporting a vulnerability

Do not disclose suspected vulnerabilities, credentials, private source code, authentication files, or other sensitive information in a public issue.

Use GitHub private vulnerability reporting for this repository. If private reporting is unavailable, open a public issue containing only a request for a private contact channel and no sensitive technical details.

Reports should include the affected version, impact, reproduction conditions, and any proposed mitigation. Please allow a reasonable period for investigation before public disclosure.

## Security boundaries

This extension:

- requires Codex ChatGPT subscription authentication;
- removes common API-key and custom endpoint variables from the Codex child process environment;
- runs Codex in an isolated, read-only workspace;
- disables Codex network access, web search, and MCP servers;
- delegates all VS Code and MCP tool execution to GitHub Copilot.

These controls reduce risk but do not replace the security policies of OpenAI, GitHub Copilot, Visual Studio Code, SAP systems, or user-configured MCP tools.