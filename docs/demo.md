# Live demo and token usage

The animated demo in the README is a concise replay of a real DuetAI run against a temporary Git repository. The repository contained an intentionally broken `add(a, b)` implementation. Claude planned the repair, Codex changed the source and ran the tests, and Claude reviewed the final diff.

## Recorded result

```text
Claude plan       complete
Codex implement   complete
Claude review     VERDICT: PASS
Test suite        1 passed, 0 failed
Rounds            1
Session phase     complete
```

## Models and reasoning

| Role | Reported model | Reasoning configuration | Observed thinking/reasoning |
|---|---|---|---:|
| Claude planning | `claude-opus-5[1m]` | Claude Code default; DuetAI did not pass `--effort` | 417 tokens |
| Codex implementation | `gpt-5.6-sol` | `model_reasoning_effort = "low"` | 42 tokens |
| Claude review | `claude-opus-5[1m]` | Claude Code default; DuetAI did not pass `--effort` | 318 tokens |

Claude's exact effort label is not present in its stream metadata, so DuetAI reports it as inherited/default rather than guessing a level.

## Provider-reported usage

| Stage | Fresh input | Cache write | Cache read | Output | Total processed |
|---|---:|---:|---:|---:|---:|
| Claude planning | 1,301 | 5,708 | 191,527 | 2,390 | 200,926 |
| Codex implementation | 15,312 | 0 | 20,480 | 432 | 36,224 |
| Claude review | 2,388 | 10,007 | 177,718 | 3,429 | 193,542 |
| **Total** | **19,001** | **15,715** | **389,725** | **6,251** | **430,692** |

For Codex, `input_tokens` was 35,792 and `cached_input_tokens` was 20,480. The table separates that cached subset from fresh input. Reasoning/thinking tokens are already included in provider output totals and are not added again.

Claude Code also reported a combined list-price estimate of `$0.44676125` for planning and review. That is provider metadata, not necessarily the amount charged by the configured LLM Proxy. The Codex stream did not report a monetary cost.

Token use varies significantly with repository size, agent instructions, cache state, model, and the number of review rounds. This small task is not a general cost benchmark.
