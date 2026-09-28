# DuetAI 0.2 launch notes

## Positioning

Claude plans and reviews. Codex implements and fixes. One command in your repository.

DuetAI is for developers who already use both CLIs and want a sequential implementation/review loop in their terminal. It reuses CLI authentication, works locally, and requires no server or database.

## Release notes

- Existing CLI login sessions and provider configuration work without entering keys in DuetAI.
- Codex profiles are optional; the CLI's own configuration is the default.
- Completion requires an explicit passing review and successful configured final tests.
- Failed tasks remain available to `/resume`, including the error and test output.
- Stream parsing handles terminal Claude results, structured errors, and split UTF-8 text.
- Available token usage is stored per agent phase; unknown cost remains unknown.
- Automated CI and clean-package installation checks cover the portable setup.

Ready-to-use social materials are in [promotion.md](promotion.md). The scripted browser walkthrough and CLI offline demo are available; the new real-agent recording remains pending.

## Announcement draft

I built DuetAI because I wanted Claude Code and Codex to work through the same coding task without copying prompts between terminals.

Run `duet` in your repository: Claude plans, Codex implements, Claude reviews, and a failing review can trigger another correction round. It uses your installed CLIs and existing login setup. No server or database.

This is an early release. The workflow has regression tests, and there is a reproducible comparison harness. I do not yet have evidence that it consistently beats a single agent on quality or cost.

I'm looking for feedback on setup friction and whether the extra review actually helps on real tasks.

https://github.com/dancher00/duetai

## New demo recording

The new real-agent recording is pending the sandbox compatibility blocker in [the launch check](../benchmarks/launch-check.md). The existing MP4 remains an earlier-version recording.

Once the environment works, use a fresh benchmark fixture and record the actual terminal output. Show the task, Claude's plan, Codex's implementation, Claude's verdict, and independently run tests. Include elapsed time and available token usage. If review passes on the first round, show that; do not manufacture a defect or present fake agents as real model calls.

The benchmark runner writes asciinema v2 `.cast` files. Replay with `asciinema play path/to/run.cast`. If shortening idle periods, label the recording as having idle time removed and keep the original run duration visible. Review the recording for local account information before sharing it.
