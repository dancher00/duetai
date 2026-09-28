# DuetAI launch materials

## Links

- Project: https://github.com/dancher00/duetai
- Interactive walkthrough: https://dancher00.github.io/duetai/
- Release: https://github.com/dancher00/duetai/releases/tag/v0.2.0
- Feedback form: https://github.com/dancher00/duetai/issues/new?template=feedback.yml
- Clip: `assets/workflow-demo.mp4` (scripted browser walkthrough)
- Replay: `assets/offline-demo.cast` (actual offline CLI run, scripted agents)
- Social card: `docs/site-assets/social.png`

## Short post — English

I built DuetAI: Claude Code plans and reviews, Codex implements and fixes, in one terminal.

Try the offline demo with no account, then bring your existing CLI logins for real tasks. Open source, no server.

https://dancher00.github.io/duetai/

## Short post — Russian

Сделал DuetAI — Claude Code и Codex работают над одной задачей в терминале: Claude планирует и проверяет, Codex пишет код и исправляет замечания.

Есть офлайн-демо без аккаунтов и API-ключей. Оно показывает цикл на скриптовых агентах с настоящими тестами. Для реальных задач используются твои установленные CLI и их авторизация.

Буду рад конкретным примерам: где второй review помог, а где только потратил время.

https://dancher00.github.io/duetai/
Код: https://github.com/dancher00/duetai

## Developer community showcase draft

I maintain DuetAI, a small terminal orchestrator for Claude Code and Codex. Claude produces a plan, Codex edits the repository, and Claude reviews the diff. A NEEDS_FIX result starts a bounded correction round. An explicit passing review and any configured final tests gate success.

The motivation is reducing prompt handoffs between two CLIs. It reuses their existing authentication and has no runtime npm dependencies. There is a no-account offline demo with scripted agents and real tests, so you can inspect the loop before spending model usage.

Limitations: one shared working tree, no rollback, and /resume starts fresh native sessions with saved task/result text. Better quality or lower cost than one agent has not been demonstrated. The first exploratory live comparison was blocked by a host sandbox error and is documented.

I'd find reports from real tasks useful, including cases where a single agent is enough.

Project: https://github.com/dancher00/duetai
Walkthrough: https://dancher00.github.io/duetai/

## Placement notes, checked 2026-09-28

- r/ClaudeCode requires simple project sharing in its weekly showcase thread. Use one relevant thread, disclose ownership, and include the limitations above. [Current rules](https://www.reddit.com/r/ClaudeCode/about/rules/).
- Hacker News prohibits generated or AI-edited text. No generated Show HN submission or comment is supplied here. The maintainer would need to write and discuss the project personally. [HN guidelines](https://news.ycombinator.com/newsguidelines.html), [Show HN guidelines](https://news.ycombinator.com/showhn.html).
- `ichangyou/awesome-codex` rejects AI-generated tool descriptions. Do not submit an assistant-written description there. [Contribution rules](https://github.com/ichangyou/awesome-codex/blob/main/CONTRIBUTING.md).
- `milisp/awesome-codex-cli` requires demonstrated external usage. Revisit after users try the project. [Contribution rules](https://github.com/milisp/awesome-codex-cli/blob/main/contributing.md).

These are drafts and destination research, not claims that posts have been published or directory listings accepted. Social posting requires the owner's connected account and a suitable destination. Do not buy stars, coordinate votes, send unsolicited bulk messages, or post repetitive announcements.
