# Skill-budget Runtime observation

Date: 2026-08-01

## Evidence used

1. The reported VS Code failure contains the exact Runtime item text:
   `Skill descriptions were shortened`, `skills context budget`, and
   `Codex can still see every skill`.
2. In the previous Provider implementation, that text could only be thrown by
   `assertNoCodexSideEffects(result.items)` after `thread.run()` returned a
   `RunResult`.
3. The installed SDK 0.146.0 defines an error item as non-fatal, keeps
   `turn.failed` separate, and throws for `turn.failed`.
4. The SDK independently returns completed items and the last completed agent
   message as `finalResponse`.
5. A real subscription smoke request on this machine returned a valid
   structured response and only an `agent_message` item. It did not reproduce
   the budget warning with the currently enabled skills.

## Release gate

Recovery is not based on the warning alone. The Provider accepts the result
only when all of the following hold:

- every error item is the one strictly recognized shortening warning;
- no command, file, MCP, or web-search side effect item exists;
- `finalResponse` is non-empty;
- the bridge response is valid structured JSON;
- every requested tool was supplied by Copilot and the call count is within
  the configured limit.

If any condition fails, the request remains fatal. An isolated 150+ synthetic
skill Runtime reproduction remains a separate integration test because it
must not modify the user's real Codex home, skills, plugin state, or
credentials.
