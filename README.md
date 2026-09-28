<h1 align="center">DuetAI</h1>

<p align="center"><strong>Claude plans and reviews. Codex implements and fixes.<br>One command in your repository.</strong></p>

<p align="center">
  <img src="https://raw.githubusercontent.com/dancher00/duetai/main/assets/duetai-teaser.svg" alt="Claude plans and reviews; Codex implements and fixes" width="900">
</p>

DuetAI coordinates your installed Claude Code and Codex CLIs in a local terminal. Give it a coding task: Claude makes a plan, Codex changes the files, and Claude reviews the result. A `NEEDS_FIX` review sends the findings back to Codex, up to the configured round limit.

```text
task → Claude plan → Codex implementation → Claude review
                           ↑                      │
                           └──── NEEDS_FIX ───────┘
```

Use it when you want a second agent to review changes without copying prompts between terminals. It uses one working directory and sequential execution. No server, database, or runtime npm dependencies.

**Early release:** the workflow has automated regression tests and a reproducible comparison harness. Better results than a single agent are a hypothesis to measure, not a guarantee.

## Install

Requirements: **Node.js 20+**, Git, and both [Claude Code](https://code.claude.com/docs/en/overview) and [Codex CLI](https://developers.openai.com/codex/cli) installed and authenticated. Linux and macOS are the initial targets; Windows users should use WSL.

First, verify that `claude` and `codex` each work on their own with your account or provider configuration. DuetAI reuses that setup. It does not ask you to enter API keys.

```bash
git clone https://github.com/dancher00/duetai.git
cd duetai
npm link
cd /path/to/your/project
duet
```

Or, after cloning, run `node /path/to/duetai/bin/duet.js` from your project directory.

## Inside DuetAI

Enter a task such as `Fix the cache expiry bug and add regression tests`.

```text
/resume       start a new run using the previous coding task and result
/permissions  choose safe, workspace, or full access
/model        choose models, or keep each CLI's current default
/exit         quit
```

Type `/` for hints and press `Tab` to complete a command. `Esc` cancels an active agent request or exits an idle prompt. `Ctrl-C` exits. Ordinary conversation is answered by Claude without starting Codex.

A coding run succeeds only when review returns an explicit `PASS` and configured final tests pass. Missing or conflicting verdicts, exhausted correction rounds, and failing tests are reported as failures. With piped input, any failed task makes the process exit nonzero.

## Configuration

No configuration file is required. Copy [`.duet.example.json`](.duet.example.json) to `.duet.json` in your project to override defaults.

To make a test command a required completion check:

```json
{
  "workflow": {
    "maxRounds": 2,
    "runTests": true,
    "testCommand": "npm test"
  }
}
```

By default, agents are prompted to validate their changes, but DuetAI's separate final test command is disabled. Configure it for your project if you want a deterministic test gate.

Codex uses its existing configuration and login by default. To select a profile you have already configured:

```json
{
  "codex": {
    "profile": "your-profile"
  }
}
```

For example, an existing LLM Proxy setup can opt into `"profile": "llm-proxy-cu"`. That profile is not required or installed by DuetAI. Provider environment variables and Claude's existing login or `apiKeyHelper` continue to work. Known OpenAI/Codex key variables are excluded from Claude's child environment, and known Anthropic/Claude key variables are excluded from Codex's. Other environment variables are inherited.

## Results and limits

Add `.duet/` and `.duet.json` to your project's `.gitignore`. DuetAI writes the latest state, agent reports, available token usage, and structured events under `.duet/`. Events can contain prompts, source code, tool output, and provider diagnostics; keep them local. DuetAI does not create a credentials file.

- The default Codex sandbox is `workspace-write`. Claude review uses `plan` mode. `/permissions` changes the selected access level; inspect the final diff before committing.
- `/resume` starts fresh agent processes with the saved task, review, error, and final test output. It does not restore native Claude or Codex sessions. Ordinary follow-up messages do not inherit a conversation history.
- Both agents share the working tree, including any changes you made before starting. There is no automatic isolation or rollback.
- A separate final test failure stops the run; `/resume` can start another attempt. Esc cancellation applies to agent requests, not the synchronous final test command.
- Dollar cost is unknown when a CLI does not report it. Provider-reported cost is not a verified bill.

## Demo and comparison

[Watch the earlier-version terminal demo](https://github.com/dancher00/duetai/blob/main/assets/duetai-demo.mp4). A new recording is pending the environment issue documented in [the launch check](benchmarks/launch-check.md).

See [the benchmark procedure](benchmarks/README.md) for three small tasks run against Codex alone, Claude alone, and DuetAI. The harness records independent acceptance results, wall time, available token counts, and provider-reported cost. Real runs use your configured agent accounts.

## Development

```bash
npm ci --ignore-scripts
npm run check
npm test
npm run test:install
```

CI runs these checks on Linux and macOS with Node.js 20, 22, and 24. Tests use local fake agents, so CI needs no account credentials. The install check packs the actual npm artifact, installs it in a temporary prefix, and runs it from an empty home directory.

For bug reports, include your OS, Node/CLI versions, what you expected, and a redacted error message in [an issue](https://github.com/dancher00/duetai/issues).

MIT licensed. Independent project; not affiliated with Anthropic or OpenAI.
