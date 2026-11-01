---
name: hermes-desktop-ui
description: Build, restyle or fix the Hermes Desktop UI (apps/desktop) and prove it on screen. Use for any visible change in the Electron app. Not for backend-only work or the web dashboard.
---

# Hermes Desktop UI work

A UI change is finished when it has been seen in the rebuilt Electron app, on every screen it touches, in light and dark. Passing tests do not show that.

## 1. Before editing

- Read `apps/desktop/DESIGN.md`, `apps/desktop/docs/linear-design-reference.md` and `apps/desktop/src/AGENTS.md`.
- Write the list of touched screens and states: how to reach each one, plus its empty, error, long-content and hover states. Fix a shared look in the primitive or token, then re-list every screen using it.
- Capture `before` for that list on the unmodified build. Record the test and lint baseline, so later failures can be attributed.
- Never guess a value. If the reference lacks it, measure it in the real Linear app (method in the reference doc) and add it there. Keep Linear read-only: create nothing, change no setting, and restore its theme if you switched it.

## 2. Pick the instance, and say which

Run this first. Two windows confuse the user and can hide that you are looking at the wrong one.

```sh
ps -axo pid,command | grep -E "MacOS/(Hermes|Electron)" | grep -v Helper
```

| Instance | Shows | Use it for |
|---|---|---|
| Rebuilt app on the user's real data | Real sessions and settings | **Default. All final proof.** |
| `npm run dev` | Real data, hot reload | Iterating on a fix |
| Isolated copy on a temporary home | Empty lists, forced states | Only states you cannot provoke otherwise |

- Use the real Electron app over the DevTools protocol, never a plain browser tab on the Vite URL.
- Before opening the isolated copy, tell the user a second, empty window will appear and why. Close it as soon as the capture ends.
- A capture from the isolated copy proves chrome only. Never mark a data-bearing screen verified from it.
- Quitting Hermes interrupts the user: agents on a local gateway stop. Warn them first, and relaunch without a debug port when done.
- The debug instance is a window the user can type in, and your navigation moves under their hands. Ask them to stay out of it, and stop scripting as soon as a capture shows activity that is not yours. Before each quit, read the composer over the debug port. If it holds a draft, do not quit: ask.

## 3. Delegate large work

For a small change, do it yourself. For work across many screens:

1. Commit tokens and primitives first, so subagents do not each patch the same look locally.
2. Split the remaining work into file groups that do not overlap, and run them in parallel.
3. Give each brief the goal, docs to read, allowed files, screens to verify in light and dark, and what is already ruled out. Ask for unmeasured deviations to be listed.
4. Only the main agent commits, by area.
5. Check each agent's result on captures yourself before accepting it. A report is not proof.

## 4. Prove it

1. Run the checks: `cd apps/desktop && npm run typecheck && npm run lint && npm run test:ui`, then `python scripts/check` at the repo root. Attribute any failure by running it on the base commit.
   After any token or class change, also run `python3 .agents/skills/hermes-desktop-ui/scripts/token-audit.py`: a misspelled token paints nothing and no test notices.
2. Rebuild and launch. See [the harness guide](references/harness.md).
3. Capture every listed screen in both modes with `scripts/capture.mjs`. For Settings, `scripts/settings-sweep.mjs` visits every subpage and flags content overflowing its panel.
4. **Open and look at every image.** A saved file proves nothing. Check for clipped or overflowing content, off-centre layouts, weak contrast in dark, leftover legacy styling, and divergence from the Linear reference. Read the console errors the script returns.
5. Exercise difficult content: long unbroken strings, real error text, long names, empty lists.
6. Fix in the primitive where possible, then recapture what changed. Run one full pass on the final build.

## 5. Report

Tick a screen only if you saw it. State plainly:

- screens checked, per mode, and on which instance;
- screens not seen, and why;
- deviations from the reference that were not measured;
- test failures already present on the base commit, with the proof;
- side effects on the user's data, such as a session whose "last active" moved because a capture opened it.

Delivery follows `apps/desktop/AGENTS.md` § Delivery. Replace `/Applications/Hermes.app` only when the user or the task asks for it.

Before packing for delivery, run `git status -sb` and confirm `main` matches `origin/main`. A failed `git pull --ff-only` does not stop `npm run pack`, which then builds the old UI without warning. A branch cut from a local `main` that was ahead of GitHub causes this failure.

## When something is missing

- Linear not installed: use the measured reference doc and say that nothing was compared live.
- Not on macOS: `capture.mjs` cannot resize the window, so set the size by hand and say so.
- A state cannot be reached anywhere: report it as not seen. Do not infer it from the code.
