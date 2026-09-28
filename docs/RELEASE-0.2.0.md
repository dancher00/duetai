# DuetAI 0.2.0 — a pair of coding agents in one terminal

Claude plans and reviews. Codex implements and fixes. DuetAI connects your existing CLIs in a sequential implementation/review loop.

**Try it without an agent account:**

```bash
npx --yes https://dancher00.github.io/duetai/duetai-cli-0.2.0.tgz --demo
```

The offline demo uses scripted agents and real local tests. It makes no model calls and only changes a temporary directory. [Explore the interactive walkthrough](https://dancher00.github.io/duetai/).

For real work, authenticate Claude Code and Codex, then run the same command without `--demo` inside your project. Linux/macOS and Node.js 20+ are the initial targets.

## What's included

- Existing CLI authentication by default; no mandatory proxy profile or DuetAI key entry.
- Bounded Claude → Codex → review → fix workflow, with explicit passing verdicts and optional final test gates.
- Model and permission controls, saved error context for `/resume`, and per-phase token usage when available.
- `--demo`, `--doctor`, `--help`, and `--version` for a quick first run.
- Linux/macOS CI on Node 20/22/24, including installation of the actual package artifact.
- An independent three-task comparison harness, an interactive site, and feedback forms.

## Early-release limitations

Both agents share your working tree; there is no automatic isolation or rollback. `/resume` starts fresh native agent sessions with saved task/result text. A second review adds time and model usage; general quality or cost improvements have not been established.

The first live comparison was interrupted by this host's Codex sandbox error. The [compatibility report](https://github.com/dancher00/duetai/blob/main/benchmarks/launch-check.md) retains that finding. New walkthrough assets are explicitly scripted; the earlier real-agent video is labeled separately.

If you try a real task, [share the outcome](https://github.com/dancher00/duetai/issues/new?template=feedback.yml). Star the project if you want to follow its development.
