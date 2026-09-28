# Launch compatibility check — 2026-09-28

**Incomplete. Do not use this run to rank DuetAI against a single agent.**

The planned comparison was three tasks × three modes (Codex, Claude, DuetAI), one trial per case, using identical fresh repositories and independent acceptance checks. The suite was stopped after the first baseline pair because the host could not initialize Codex's sandbox. A following in-flight Duet run was cancelled and is not scored.

Environment: Linux, Node.js 22.23.2, Codex CLI 0.157.1, Claude Code 2.1.270. Both CLIs reused existing authentication and default model settings. The local Codex configuration selected `gpt-6-astra`; its event stream did not emit an effective model ID. Claude emitted `claude-opus-5[1m]`. Each run had a 180-second limit.

| Money parsing task | Result | Wall time | Input tokens, including cache | Cached input subset | Output tokens | CLI-reported USD |
|---|---|---:|---:|---:|---:|---|
| Codex alone | Blocked by host sandbox; files unchanged | 153.0 s | 307,034 | 282,880 | 3,128 | Unknown |
| Claude alone | Independent acceptance checks passed | 125.9 s | 371,865 | 337,267 | 7,376 | $0.576451 |
| DuetAI | Not completed | — | — | — | — | — |

Codex reported `bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted` and failed file writes. Its process exited zero despite reporting that it was blocked; independent checks correctly rejected the unchanged implementation. Sandbox restrictions were not disabled to obtain a success result.

Claude wrote the implementation and tests but reported that its own test execution needed permission. The external grader subsequently passed the implementation against the fixed acceptance contract. That is a narrower result than a fully autonomous successful workflow.

Input token totals include cache reads and cache writes. Dollar cost is the CLI's estimate, not a verified invoice. There is no measured DuetAI cost, speedup, quality improvement, or completed new end-to-end demo from this run.

## What was verified separately

- A real terminal prompt starts with an empty home directory and no API-key environment variables.
- The packed npm artifact installs into an isolated prefix and completes a fake-agent workflow.
- Automated tests exercise login-environment handling, optional profiles, stream parsing, token accounting, review failures, final test failures, and successful correction rounds.
- The regression suite passes locally on Node.js 20, 22, and 24. Hosted CI covers Linux and macOS.

Before promoting a new end-to-end recording, rerun the [benchmark procedure](README.md) on a host where both native CLIs can complete the fixture with the intended permissions. Retain every result, including cases where one agent is faster or equally accurate.
