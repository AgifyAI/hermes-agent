---
sidebar_position: 16
title: "Persistent Goals"
description: "Set a standing goal and let Hermes keep working across turns until it is done, blocked, or out of budget."
---

# Persistent Goals (`/goal`)

`/goal` gives Hermes a standing objective that survives across turns. After each turn Hermes decides
whether another round is warranted and, if so, feeds a continuation prompt back into the same
session — until the goal is achieved, the agent reports a concrete blocker, you pause or clear it, or
the token budget runs out.

**There is no LLM judge in the decision path.** A goal ends in exactly one of two ways:

1. **The agent ends it.** On a goal round, after running the completion audit against the objective,
   contract and gates, the agent calls the `update_goal` tool with `status="complete"` (and a one-line
   summary of what it delivered) or `status="blocked"` (and exactly what blocks it). `blocked` is
   refused until the goal has run at least `goals.blocked_min_rounds` rounds (default 3), so the agent
   cannot bail out early.
2. **You end it** with `/goal pause`, `/goal clear`, or by spending the token budget.

Deterministic signals replace the judge: quality-gate commands, the agent's own terminal status, the
token budget, and the deferral policy (background work, timers, subagents). Everything is visible and
controllable from the Desktop **Automations** panel.

It's our take on the **Ralph loop**, inspired by [Codex CLI 0.128.0's `/goal`](https://github.com/openai/codex)
by Eric Traut (OpenAI). The core idea — keep a goal alive across turns and don't stop until it's
achieved — is theirs. The implementation here is independent and adapted to Hermes' architecture.

## When to use it

Use `/goal` for tasks where you want Hermes to iterate on its own without you re-prompting every turn:

- "Fix every lint error in `src/` and verify `ruff check` passes"
- "Port feature X from repo Y, including tests, and get CI green"
- "Investigate why session IDs sometimes drift on mid-run compression and write up a report"
- "Build a small CLI to rename files by their EXIF dates, then test it against the photos/ folder"

Tasks where the agent does one turn and stops don't need `/goal`. Tasks where *you'd otherwise have to
say "keep going" three times* are where this shines.

## Goals vs Kanban: which one do I want?

`/goal` and [Kanban](./kanban) both keep Hermes working without you re-prompting, but the boundary is
sharp:

- **`/goal` is single-session.** The loop feeds continuation prompts back into *this* conversation
  until the agent marks it complete or blocked. Setting a goal never creates a kanban card, never
  assigns work to another profile, and never fans out.
- **Kanban is a board of many tasks.** Each card is dispatched to its own worker process with its own
  session; cards, dependencies, assignees and handoffs live on the board.
- **The overlap is deliberate, and small.** A kanban card created with `--goal` runs the same
  continuation engine *inside that one card's worker session* — borrowing the engine, not the board.

| You want | Reach for |
|---|---|
| Keep iterating on one task in this chat until it's done | `/goal <text>` |
| Many independent tasks, with dependencies, handoffs, or multiple profiles | [Kanban](./kanban) — `hermes kanban create …` |
| One card on the board that should keep iterating until its acceptance criteria are met | A kanban card with `--goal` |

:::note
Pausing, resuming or clearing a goal in this chat never creates, claims, or moves a kanban card. If
you want work on the board, put it there yourself.
:::

## Quick start

```
/goal Fix every failing test in tests/hermes_cli/ and make sure scripts/run_tests.sh passes for that directory
```

What happens:

1. **Goal accepted** — `⊙ Goal set: <your goal>` and the first turn starts immediately.
2. **Rounds run.** After each turn, Hermes decides whether another round is useful:
   - quality gates run first; a red gate produces the next continuation with the failure output;
   - otherwise the agent gets a fresh continuation prompt with the objective, contract, criteria,
     budget line, and the completion audit to perform;
   - if background work (a CI watcher, a subagent, a timer) is genuinely in the way, the loop defers
     instead of busy-polling, then resumes by itself.
3. **The agent ends it.** Once the completion audit maps every requirement to concrete evidence, it
   calls `update_goal(status="complete", reason="…")`. If it hits a real blocker (missing credentials,
   an impossible requirement, a decision only you can make), it calls `update_goal(status="blocked",
   reason="…")` after the minimum number of rounds.
4. **Or the budget ends it.** When the token budget is reached, one closing turn summarizes what is
   done and what remains, the phase becomes `budget_limited`, and nothing runs until you resume.

## Phases

A goal is always in one of five phases, shown in `/goal status` and as the coloured dot/label in the
Desktop panel:

| Phase | Meaning |
|---|---|
| `active` | The loop may run rounds and dispatch continuations. |
| `paused` | Stopped by you, by a failed/interrupted turn, by an exhausted gate, or by compression. `/goal resume` re-arms it. |
| `blocked` | The agent reported a concrete blocker through `update_goal`; the reason is recorded. Fix the blocker and `/goal resume`, or `/goal edit` to re-scope. |
| `budget_limited` | The token budget is spent (the closing turn already ran). `/goal resume` grants more budget. |
| `complete` | The agent audited the goal against its contract and marked it done. |

## Commands

| Command | What it does |
|---|---|
| `/goal <text>` | Set the standing goal. Starts the first turn immediately. On an unfinished goal it is a **preserving rewrite**: after a confirmation the objective changes but rounds, criteria, gates and the completion contract are kept. |
| `/goal edit <text>` | Rewrite the objective explicitly (same preserving behaviour, no ambiguity with a control word). |
| `/goal -- <text>` | Set goal text that starts with a control word (`/goal -- pause the nightly cron`). |
| `/goal draft <text>` | Draft a structured completion contract from a plain-language objective, then set it. Falls back to a free-form goal if the drafting model is unavailable. |
| `/goal show` | Print the active goal's completion contract. |
| `/goal` or `/goal status` | Show the current goal, its phase, rounds, tokens and contract. |
| `/goal pause` | Stop the loop without clearing the goal. |
| `/goal resume` | Resume the loop: re-arms the goal, resets the round counter, resets each gate's retry budget and last result, and grants more token budget when the budget was the reason for the stop. |
| `/goal clear` | Drop the goal entirely. |
| `/goal wait <pid> [reason]` | Park the loop on a background process (manual override for the automatic deferral policy). |
| `/goal unwait` | Drop the deferral and resume immediately. |
| `/goal gate add <command>` | Add a **quality gate**: a shell command that must pass before the goal can complete. |
| `/goal gate` or `/goal gate list` | List the goal's gates and their pass/fail state. |
| `/goal gate remove <N>` | Remove the Nth gate (1-based). |
| `/goal gate clear` | Remove all gates. |

The classic CLI, TUI, Desktop, dashboard chat and messaging gateway share one `/goal` command
handler, so parsing and persisted goal changes are identical everywhere; rendering and turn
scheduling are surface-specific.

### Rewriting a goal keeps its progress

`/goal <new text>` on an **unfinished** goal never silently discards progress. It asks for
confirmation, then changes only the objective: the goal identity, rounds already run, criteria,
gates, completion contract and token accounting stay. The next continuation prompt tells the agent
that the objective changed and that earlier work is not done again from scratch. A **complete**
goal is not rewritten: setting a new objective starts a fresh goal (with its own confirmation).

The Desktop panel exposes the same behaviour as **Edit**, and a plain goal can be created from the
panel's empty state.

### Messaging and ACP

Messaging platforms retain their access rules: `/goal gate add` requires an explicitly configured
gateway admin; listing, removing and clearing gates remain available for recovery.

ACP does not implement `/goal` itself. A connected gateway **forwards** registry commands to the
session owner (`slash.exec`), so `/goal` can work through an ACP editor while the gateway serves that
session — but ACP is not a goal surface in this redesign and has no goal card or status UI.

## Completion contracts

A bare `/goal <text>` works, but a vague goal makes for a vague completion audit. A **completion
contract** names what done means, how to prove it, what not to break, what's in scope, and when to
stop. It is optional and layered on top of the loop.

| Field | Meaning |
|---|---|
| `outcome` | The single end state that must be true when done. |
| `verification` | The specific test / command / artifact that *proves* the outcome. |
| `constraints` | What must not change or regress. |
| `boundaries` | Which files, dirs, tools, or systems are in scope. |
| `stop_when` | The condition under which the agent should stop and report a blocker. |

When a contract is set, the continuation prompt tells the agent to target the verification surface,
respect the constraints, and treat the completion audit as the gate: the goal can only be marked
complete when the verification criterion is met with concrete evidence (a command result, a test
report, a file excerpt) — not a loose "looks done" claim.

### Two ways to set a contract

**1. Let Hermes draft it** (adapted from Codex's "let the agent draft the goal" tip):

```
/goal draft Migrate the auth service from session cookies to JWT
```

Hermes expands your one-liner into a full contract with the `goal_judge` auxiliary model (that model
is only used here, by `/loop --until`, and by the kanban review gate — never for goal decisions),
sets it, and shows it for review. If the aux model is unavailable it falls back to a plain goal.

**2. Write it inline** with `field: value` lines:

```
/goal Migrate auth to JWT
verify: pytest tests/auth passes
constraints: keep the /login response shape unchanged
boundaries: only touch services/auth and its tests
stop when: a DB schema migration is required
```

Recognised aliases include `goal:`, `done:`, `done when:` (outcome); `verify:`, `verified by:`,
`evidence:`, `proof:` (verification); `preserve:`, `must not:`, `do not change:` (constraints);
`scope:`, `allowed:`, `files:` (boundaries); `blocked:`, `stop if blocked:`, `give up when:`
(stop_when). A plain goal with an incidental colon (`Fix bug: the parser drops commas`) is **not**
mangled — only known prefixes are pulled out; everything else stays in the objective.

Use `/goal show` to review the contract. Contracts persist in `SessionDB.state_meta` alongside the
goal and survive `/resume`. They can be edited from the Desktop panel (Edit form), which asks for a
confirmation before applying a preserving rewrite.

## Agent-owned ending

The `update_goal` tool is the only way an agent ends a goal:

- It must be called on a real goal round, not on a plain user turn.
- `status="complete"` requires the completion audit: every requirement of the objective, contract and
  criteria mapped to concrete evidence. The reason is a one-line summary of what was delivered.
- `status="blocked"` requires a concrete blocker and is refused before `goals.blocked_min_rounds`
  rounds (default 3).
- The call is idempotent: repeating it on a finished goal does not corrupt the state.
- The tool cannot create, edit, pause or resume a goal — only you can do those.

There is no `/goal done` override: a paused, budget-limited or blocked goal is resumed or rewritten
by you; a complete goal is a new goal.

## Quality gates

A completion contract shapes *what the agent aims for*; a **quality gate** makes "done" mechanically
checkable: a deterministic shell command that must exit 0 before the goal can complete.

```
/goal Fix the flaky session tests
/goal gate add scripts/run_tests.sh tests/hermes_cli/test_goals.py
```

How it works, each round:

1. **Gates run first.** If a gate fails, the goal cannot complete and the failure output becomes the
   next continuation prompt, so the agent iterates against the actual failure instead of a vibe.
2. **A passing gate resets its attempt counter.** Gates re-run against the current workspace every
   boundary; a stale result is never replayed.
3. **Retries are bounded.** Each gate has a timeout and retry count. When a gate exhausts its retries
   the goal pauses with the exact command and exit code, and tells you to fix it and run
   `/goal resume` (which resets tries) or remove the gate.
4. **Gates run in the goal's workspace**, not the Hermes install tree.

Gates persist with the goal and survive `/resume` and compression. In the Desktop panel they are
listed with pass/fail state, attempts, timeout and last exit code; **Add gate** and **Remove** ask
for confirmation showing the exact shell command. `/goal gate …` remains available for recovery.

## Waiting without busy-polling

Some goals are gated on something outside the conversation: CI on a pushed PR, a long build, a
subagent batch, a cooldown, or a human decision. The loop handles this with **one bounded deferral**
instead of re-poking the agent:

- **Causes:** background process, background session, timer, subagents, context compression,
  human-pending.
- **Hard ceiling:** `goals.max_wait_seconds` (default 30 minutes). Nothing can park the goal longer.
- **Visible:** `/goal status` and the Desktop card show the cause, the deadline and the remaining
  time, with a **Resume now** action. `/goal unwait` is the CLI equivalent.
- **Automatic:** the driver notices background work and active delegations itself; you only use
  `/goal wait <pid>` as a manual override. A stale barrier (dead pid, passed deadline) clears itself.

## Token budget and the closing turn

Since the 2026-11 redesign, **tokens are the budget**. Rounds are only a safety cap (256).

- `goals.max_tokens` (default 2,000,000) bounds the goal's total token spend.
- `goals.closing_reserve_tokens` (default 0 = auto: 5% of the budget, minimum 20,000) is kept for one
  **closing turn**: when the working budget is exhausted, the agent gets exactly one final round to
  wrap up — summarize what was delivered, what remains, and the next concrete action — then the phase
  becomes `budget_limited`.
- `/goal resume` on a budget-limited goal extends the budget by twice the closing reserve (computed
  from what was actually spent), so you can keep going in measured chunks.
- `/goal status` shows tokens used/budget and the phase; the Desktop card shows the same progress.

`goals.max_turns` still exists as a deprecated round safety cap; it is not the budget and is not what
the guides mean by "keep going".

## Desktop: the Automations panel

The right sidebar's **Automations** group is the single place to see and control all three session
automations:

- **Goal card** — phase dot and label, objective, tokens/rounds/time, pause or blocked reason, the
  live deferral with **Resume now**, criteria (add/remove), quality gates (status, add with
  command confirmation, remove), recent **History**, and actions: **Edit** (objective + 5 contract
  fields, preserving rewrite with confirmation), **Pause/Resume**, **Criterion**, **Wait**,
  **Clear** (confirmation).
- **Loop card** — state, prompt, cadence, next wakeup countdown, runs used/max, the
  "deferred while an active goal holds the session" notice, and pause/resume/stop plus an inline
  create/edit form.
- **Heartbeat card** — state, prompt, interval, fire count, next wakeup countdown, and
  pause/resume/clear plus an inline create/edit form.

When the right rail is closed, a discreet row above the composer shows the goal phase, rounds and
token usage (for example `Goal · Active · R3 · 128k/2.0M`) and opens the panel.

## Behavior details

### User messages always preempt

Any real message you send while a goal is active takes priority over the continuation loop: on the
CLI it lands ahead of the queued continuation, on the gateway it goes through the adapter FIFO the
same way. The next round is evaluated after your turn.

### Mid-run safety

While an agent is running, `/goal status`, `/goal pause`, `/goal clear`, `/goal wait` and
`/goal unwait` only touch control-plane state and do not interrupt the current turn. Setting a **new**
goal mid-run is refused with a message telling you to `/stop` first, so the old continuation cannot
race the new one.

### Persistence and restart

Goal state lives in `SessionDB.state_meta` keyed by `goal:<session_id>`, so `/resume` picks up where
you left off. The **armed** state (the in-process flag that lets a continuation relaunch) is
deliberately not persisted: after a restart, resume, fork or unload, a goal stays visible and
inspectable but does not relaunch until you `/goal resume`. This prevents ghost loops.

### Observability and cost

Every goal keeps its own audit trail, independent of the transcript:

- **Accounting per goal:** tokens spent vs budget, elapsed goal time, rounds used vs the safety cap,
  closing-reserve state. `/goal status` prints them in one line (for example
  `⊙ Goal (active, 3/256 rounds, 128,450/2,000,000 tokens, 4m, contract, 2 gates): …`) and the
  Desktop card/panel shows the same numbers.
- **Event journal:** creation, rewrite, contract change, round reserved/admitted/released, pause,
  resume, deferral start/end, gate added/passed/failed, token spend, closing turn, budget limit and
  the agent's `complete`/`blocked` transitions. The journal is bounded (200 entries in the persisted
  row); the Desktop History list reads its tail (30 entries) with time, round, tokens, reason and gate
  command/exit code — enough to rebuild what happened without reading logs.
- **Correlation:** every journal entry carries the `goal_id`, round events carry the round number,
  and transition logs name `goal_id` and round, so a goal can be traced across CLI, gateway and
  Desktop logs.
- **Secrets never enter the trail:** credential-looking strings (`sk-…`, GitHub/Stripe/Slack tokens,
  `Bearer …`, `api_key: …`) are redacted from journal details, from every reason exposed to the
  Desktop snapshot, and from the logs the goal engine writes. Gate output tails stay in the engine
  only — the panel receives the exit code, never the output.
- **Untrusted objective:** the objective is always rendered inside an explicit
  `<untrusted_objective>` data fence, with `<`, `>`, `&` escaped and a hard length cap (4000
  characters), so user text can never close the fence or impersonate system instructions.
- **Gate authorization:** adding a gate executes shell, so the messaging gateway requires an
  explicit admin for `/goal gate add` (listing/removing stay open for recovery); the Desktop RPC is
  scoped to the session owner and the confirmation shows the exact command before it is sent.

### Prompt cache

The continuation prompt is a plain user-role message appended to history. It does not mutate the
system prompt, swap toolsets, or invalidate Hermes' prompt cache — running goal rounds costs the same
cache-wise as normal conversation.

## Configuration

```yaml
goals:
  # Token budget for the whole goal. 0 disables the budget (round cap still applies).
  max_tokens: 2000000
  # Kept for the one closing turn; 0 = auto (5%, minimum 20000).
  closing_reserve_tokens: 0
  # update_goal(blocked) is refused before this many goal rounds.
  blocked_min_rounds: 3
  # Hard ceiling for any deferred continuation (background work, timer, subagents…).
  max_wait_seconds: 1800
  # DEPRECATED: round safety cap only (default 256 used by the driver); not the budget.
  max_turns: 20
```

The `goal_judge` auxiliary model is not used for goal decisions anymore. It is still used by
`/goal draft`, `/loop --until`, and the kanban review gate; set it only if you use those:

```yaml
auxiliary:
  goal_judge:
    provider: openrouter
    model: google/gemini-3-flash-preview
```

## Example walkthrough

```
You: /goal Create four files ~/.hermes/cache/scratch/note_{1..4}.txt, one per turn, each containing its number as text

  ⊙ Goal set: Create four files ~/.hermes/cache/scratch/note_{1..4}.txt, one per turn, each containing its number as text

Hermes: Creating ~/.hermes/cache/scratch/note_1.txt now.
  I've created note_1.txt with the content "1". I'll continue with the remaining files next round.

  ↻ Continuing toward your standing goal (round 2) · tokens 4k/2M · 4 files planned

Hermes: [Continuing toward your standing goal]
  Created note_2.txt. Two more to go.

  ↻ Continuing toward your standing goal (round 3) · tokens 8k/2M

Hermes: [Continuing toward your standing goal]
  Created note_3.txt.

  ↻ Continuing toward your standing goal (round 4) · tokens 12k/2M

Hermes: [Continuing toward your standing goal]
  All four files exist with the right contents; I verified each one with `cat`.
  update_goal(status="complete", reason="Created note_1.txt … note_4.txt, each containing its number")

  ✓ Goal complete: Created note_1.txt … note_4.txt, each containing its number

You: _
```

Three continuation rounds, one `/goal` invocation, zero "keep going" prompts from you.

## Troubleshooting

**`⏸ Goal paused — quality gate still failing after N retries: $ <command>`** — fix the workspace,
then `/goal resume` (it resets the gate attempts and the round counter) or `/goal gate remove` the
gate.

**`⏸ Goal paused — <rounds>/<max> rounds used`** — the deprecated safety cap was hit. Resume or clear;
check that the objective is achievable in fewer rounds.

**`⏸ Goal paused — token budget reached`** — the closing turn already ran; read its summary, then
`/goal resume` to extend the budget by twice the reserve, or `/goal edit` to narrow the objective.

**Blocked by the agent** — read the recorded reason. Provide what's missing (credentials, access, a
decision), then `/goal resume`; or `/goal edit` to re-scope so the blocker is no longer required.

## Attribution

`/goal` is Hermes' take on the **Ralph loop** pattern. The user-facing design — keep a goal alive
across turns, don't stop until it's achieved, with create/pause/resume/clear controls — was
popularised and shipped in [Codex CLI 0.128.0](https://github.com/openai/codex) by Eric Traut on
OpenAI's Codex team. The versioned goal model here (phases, token budget, agent-owned ending,
preserving rewrites, deterministic gates, bounded deferral) is adapted from that design and from
DeepSeek Harness' goal model. Our implementation is independent; the idea is theirs.
