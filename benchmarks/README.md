# Comparing DuetAI with one agent

This is an exploratory workflow comparison, not proof that two agents beat one. The task suite contains three small dependency-free JavaScript repairs: exact money parsing, TTL cache semantics, and async retry behavior.

Each mode gets the same task text and starting files in a fresh temporary Git repository. Modes are Codex alone, Claude alone, and DuetAI. DuetAI gets up to two implementation/review rounds and a final `npm test` gate. Baselines get one native agent session, which can use multiple tools and run its own tests. All receive the same per-run time limit, not an equal token budget.

Acceptance tests live outside the agent workspace and are supplied only after the run. They check the public contract without relying on tests written by the agent. No human corrections are supplied during a run. Existing user configuration, permissions, provider caches, and agent memory can affect results; fresh repositories do not remove those effects.

The first [launch compatibility check](launch-check.md) was blocked by the host sandbox; it is not a quality ranking.

## Run

Authenticate both CLIs first. These commands make real model requests and consume your account usage. They are never run by CI.

```bash
npm run benchmark -- --timeout=180
```

Optional filters and a project-style agent configuration:

```bash
npm run benchmark -- --task=money --mode=duet --timeout=300 --out=benchmark-results/my-run
npm run benchmark -- --config=/path/to/agent-config.json
```

Available tasks: `money`, `ttl-cache`, `retry`. Modes: `codex`, `claude`, `duet`. A run never overwrites an existing `results.json`.

The ignored `benchmark-results/` directory contains `REPORT.md`, `results.json`, terminal output, replayable asciinema `.cast` files, diffs, and independent test results. Temporary agent workspaces are retained at the paths recorded in `results.json` for inspection. Raw output may contain local paths and provider information; only reviewed summaries should be published.

## Read the results

- Acceptance PASS means the implementation passed the independent checks. It is separate from the agent's exit code and DuetAI's workflow status.
- Input tokens include cached input and cache writes. Cached input is a subset; do not add it again.
- Only terminal usage events count. Claude's per-message counters are not added to its final total.
- Missing dollar cost is `unknown`, including mixed runs where Codex supplies no dollar total. It is not zero.
- Reported USD comes from the CLI, not a verified invoice. Tokens from different model providers are not directly equivalent.
- Each invocation runs one trial per case. Repeat trials with fixed models, rotate mode order, and expand to real repository tasks before drawing general conclusions.

A useful outcome can be that a single agent passes just as often and takes less time. Keep that result; do not select only cases where DuetAI wins.
