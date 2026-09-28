<h1 align="center">DuetAI</h1>

<p align="center"><strong>Claude plans and reviews. Codex implements and fixes.<br>Two coding agents. One terminal.</strong></p>

<p align="center">
  <a href="https://github.com/dancher00/duetai/actions/workflows/ci.yml"><img src="https://github.com/dancher00/duetai/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-276c58" alt="MIT license"></a>
  <img src="https://img.shields.io/badge/Node.js-20%2B-276c58" alt="Node.js 20 or newer">
</p>

<p align="center"><a href="https://dancher00.github.io/duetai/">Interactive walkthrough</a> · <a href="#try-it-in-one-command">Try the demo</a> · <a href="https://github.com/dancher00/duetai/issues/new?template=feedback.yml">Share feedback</a></p>

<p align="center"><img src="https://raw.githubusercontent.com/dancher00/duetai/main/assets/workflow-demo.gif" alt="Scripted walkthrough: Claude plans, Codex implements, review catches a missing upper bound, and the fix passes" width="850"></p>
<p align="center"><sub>Scripted walkthrough, not recorded model output. The CLI demo runs real local tests.</sub></p>

DuetAI coordinates your installed Claude Code and Codex CLIs in a local terminal. Give it a coding task: Claude makes a plan, Codex changes the files, and Claude reviews the result. A `NEEDS_FIX` review sends the findings back to Codex, up to the configured round limit.

```text
task → Claude plan → Codex implementation → Claude review
                           ↑                      │
                           └──── NEEDS_FIX ───────┘
```

Use it when you want a second agent to review changes without copying prompts between terminals. It uses one working directory and sequential execution. No server, database, or runtime npm dependencies.

**Early release:** the workflow has automated regression tests and a reproducible comparison harness. Better results than a single agent are a hypothesis to measure, not a guarantee.

## Try it in one command

With **Node.js 20+ and npm**, run the offline demo — no agent account or API key needed:

```bash
npx --yes https://dancher00.github.io/duetai/duetai-cli-0.2.0.tgz --demo
```

The demo uses **scripted agents and real tests** in a temporary directory. It exercises the actual plan → implementation → failed review → fix → passing review workflow, then removes the temporary files. It makes no model calls and does not change your current project.

For real work, install Git and authenticate [Claude Code](https://code.claude.com/docs/en/overview) and [Codex CLI](https://developers.openai.com/codex/cli), then run this in your project:

```bash
npx --yes https://dancher00.github.io/duetai/duetai-cli-0.2.0.tgz
```

DuetAI reuses each CLI's existing login and provider settings. Linux and macOS are supported by CI; use WSL on Windows.

### Install a permanent command

```bash
git clone https://github.com/dancher00/duetai.git
cd duetai
npm link
cd /path/to/your/project
duet --doctor
duet
```

`duet --doctor` checks installed tools without model requests. It does not test authentication or sandbox permissions. `duet --help` lists startup options.

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

- [Interactive browser walkthrough](https://dancher00.github.io/duetai/) — scripted, no accounts needed.
- [15-second workflow clip](assets/workflow-demo.mp4) — the same scripted walkthrough.
- [Actual CLI offline-demo recording](assets/offline-demo.cast) — replay with `asciinema play assets/offline-demo.cast`.
- [Earlier real-agent recording](assets/duetai-demo.mp4) — recorded before this release.

The [benchmark harness](benchmarks/README.md) compares Codex alone, Claude alone, and DuetAI on three tasks using independent acceptance checks, wall time, and available usage data. The first live comparison hit a host sandbox limitation; [the report](benchmarks/launch-check.md) makes no quality or speedup claim.

If this workflow is useful to you, **star the repository to follow its progress**. A concrete [task report](https://github.com/dancher00/duetai/issues/new?template=feedback.yml) helps improve it.

## Development

```bash
npm ci --ignore-scripts
npm run check
npm test
npm run test:install
```

CI runs these checks on Linux and macOS with Node.js 20, 22, and 24. Tests use local fake agents, so CI needs no account credentials. The install check packs the actual npm artifact, installs it in a temporary prefix, and runs it from an empty home directory.

For bug reports, include your OS, Node/CLI versions, what you expected, and a redacted error message in [an issue](https://github.com/dancher00/duetai/issues).

See [CONTRIBUTING.md](CONTRIBUTING.md) to help. MIT licensed. Independent project; not affiliated with Anthropic or OpenAI.
