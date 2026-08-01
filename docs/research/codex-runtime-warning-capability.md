# Codex SDK/runtime warning capability check

Date: 2026-08-01

Installed SDK: `@openai/codex-sdk` 0.146.0.

## Findings

- `ErrorItem` contains only `id`, `type: "error"`, and `message`.
- The SDK describes `ErrorItem` as a non-fatal item.
- No structured warning severity or issue code is available on the installed
  `ErrorItem` type.
- `turn.failed` is a separate event. The SDK's `run()` implementation throws
  when that event is observed.
- `run()` can collect completed items, including error items, and independently
  return the last completed agent message as `finalResponse`.
- `RunResult` does not expose the turn event/status. Diagnostics must report
  status as unavailable and completion as unknown instead of inferring it.

## Implementation decision

Use a strict, bounded text compatibility classifier for
`SKILL_DESCRIPTIONS_SHORTENED`, while preferring the exact structured
`code + severity=warning` form if a future runtime supplies it. All unmatched
error items remain fatal. Any SDK upgrade must be reviewed separately.
