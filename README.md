# DuetAI

**Two coding agents. One focused terminal.**

DuetAI is a small, local-first terminal orchestrator for running Claude Code and Codex as a disciplined pair. Claude plans and reviews; Codex implements. Both are the official CLIs you already use, so your existing LLM Proxy configuration and credentials stay in place.

```text
task → Claude plan → Codex implementation → Claude review → Codex fixes
```

## Install

Requirements: Node.js 20+, Git, an installed `codex` CLI and Claude Code.

```bash
git clone https://github.com/dancher00/duetai.git
cd duetai
npm link
cd /path/to/your/project
duet doctor
duet
```

Or run without installing:

```bash
node /path/to/DuetAI/bin/duet.js run "Add OAuth authentication and tests"
```

## Your LLM Proxy setup

DuetAI does not receive or store API keys. It starts the local CLIs as child processes and inherits their environment/configuration.

```bash
export LLMPROXY_API_KEY="your-key"
duet
```

Codex is launched with `codex exec --profile llm-proxy-cu --sandbox workspace-write --json`. Claude Code uses its existing `~/.claude/settings.json` configuration.

## Commands

```bash
duet                         # interactive TUI
duet run "your task"         # run the complete workflow
duet resume                  # continue the saved task
duet status                  # inspect the latest session
duet doctor                  # check prerequisites
duet init                    # create .duet.json
```

The interactive TUI is intentionally dependency-free and works over SSH. Type a task and press Enter. `Ctrl-C` stops the UI; agent subprocesses are owned by the current terminal session.

## Configuration

Run `duet init` to create `.duet.json`, or copy `.duet.example.json`. The configuration is project-local and is safe to commit except for any custom command that might contain secrets. Session state and event logs are stored in `.duet/`, which is ignored by Git.

## Safety

Codex runs with the explicit `workspace-write` sandbox. Claude review runs in `plan` mode. The first version uses one working tree and a sequential workflow to avoid agents overwriting one another. Review the final `git diff` before committing or pushing.

## Development

```bash
npm run check
```

DuetAI is MIT licensed.
