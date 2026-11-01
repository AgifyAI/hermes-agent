# Harness guide

Commands run from the repo root. `playwright-core` resolves from the root `node_modules`. Screenshots go to `$HX_OUT`, which must be outside the repo or left uncommitted.

## Rebuilt app (default)

Warn the user, because this interrupts their running agents. `release/` shares user data and the single-instance lock with the installed app.

```sh
(cd apps/desktop && npm run pack)
osascript -e 'quit app "Hermes"'
apps/desktop/release/mac-arm64/Hermes.app/Contents/MacOS/Hermes --remote-debugging-port=9334   # run in the background
export HX_OUT=/path/to/scratch/screens S=.agents/skills/hermes-desktop-ui/scripts
node $S/hx.mjs 9334 run $S/capture.mjs after                         # every known screen
node $S/hx.mjs 9334 run $S/capture.mjs after settings cron           # some of them
node $S/hx.mjs 9334 run $S/capture.mjs after 'kanban=#/kanban'       # any route: name=#/hash
node $S/hx.mjs 9334 run $S/shot.mjs session-menu                     # whatever is on screen now
```

Set `HX_PROCESS` to the macOS process name when it is not `Hermes`, and `HX_WAIT` in milliseconds for slow routes. Files are named `<screen>-<light|dark>-<phase>.png`. Stop the debug instance and reopen the app normally when finished: `open -a Hermes`.

To review many captures, build sheets and read them: `uv run --no-project --with pillow python $S/sheets.py "$HX_OUT" chat settings cron` writes `sheets/` with each screen in light above dark, three screens per sheet. The final decision on a suspicious cell still needs the full-size image.

`node $S/hx.mjs 9334 run $S/settings-sweep.mjs` writes every Settings subpage to `$HX_OUT/sweep/` and returns console errors and overflow per page. It only opens navigation rows. It needs a connected instance: on the isolated copy, Settings does not open.

To open menus or dialogs, write a small script exporting `default async (page, { args, out })` and run it with `hx.mjs <port> run`. Prefer role and label locators, then call `shot.mjs`.

## Isolated copy (forced states only)

Tell the user first. This does not touch their data, but it opens a second window.

```sh
cd apps/desktop
npx vite --port 5174 --host 127.0.0.1                                # background; check package.json dev:renderer if it fails
node scripts/bundle-electron-main.mjs --dev
T=$(mktemp -d); mkdir -p $T/home; E=$(node -p "require('electron')")
HOME=$T/home HERMES_HOME=$T/home/.hermes HERMES_DESKTOP_DEV_SERVER=http://127.0.0.1:5174 \
  HERMES_DESKTOP_BOOT_FAKE=1 HERMES_DESKTOP_BOOT_FAKE_STEP_MS=100 \
  "$E" . --user-data-dir=$T/data > $T/run.log 2>&1                   # background
cd ../..; node $S/hx.mjs 9222 run $S/forced-states.mjs               # or: ... forced-states.mjs updates clarify
```

Close the copy and Vite straight after. `npm run pack` rebuilds the production bundle that `--dev` replaced.

`forced-states.mjs` sets the app's own stores with fake data: boot failure, update hold, updates, pet generator, usage stats, tools, clarify, approval, session picker, toasts, and the `quick`, `overlay`, `wake` and `hud` windows. Add a state there rather than scripting one elsewhere.

## Traps seen in practice

- With a dev server, debugging is forced to port 9222 and `--remote-debugging-port` is ignored. Set `HERMES_DESKTOP_CDP_PORT` to change it.
- A second launch on the same user data exits 0 and hands over to the first instance. Check the port and what `hx.mjs <port> pages` returns: `file://…/dist/index.html` means the production bundle, not your dev server.
- After hot reload, `import('/src/store/x.ts')` can load a second copy of the module, so setting an atom does nothing. `forced-states.mjs` resolves the URL the app really requested.
- Fake boot steps can clear a forced boot error. Force it once boot has finished.
- After a native window resize Playwright's viewport is stale, so the scripts capture through `Page.captureScreenshot`.
- `quick`, `overlay`, `wake` and `hud` are small or transparent windows. In the main window they look stretched, so judge the control, not the layout.
- Clarify rows look dim in a forced state because no server request is open: that is the disabled style, not a contrast bug.
- The isolated copy has no sessions and keeps the connecting overlay up. To reach a session menu there, call `setSidebarOpen(true)` from `store/layout.ts`, set `$sessions` from `store/session.ts` to one fake row, and hide `[class*="z-(--z-connecting)"]` with a style tag.
- A menu or dialog that shows the page behind it may be losing to a global CSS rule. Read `getComputedStyle` on the surface and compare it with the reference, instead of trusting the class list.
- Radix tabs and menus open on pointer events, so a DOM `.click()` returns true and changes nothing. Use a real click, and check the capture shows the state you asked for.
- `npm run pack` leaves a production `dist/electron-main.mjs`, and the isolated copy then opens no debug port. Run `node scripts/bundle-electron-main.mjs --dev` first; the next pack rebuilds it.
- A second instance on a copied user data folder has no remote sign-in. Do not copy the session to get around it: it can invalidate the user's real one.
- Rows and tabs in the sidebar are missing when it is collapsed on the user's profile, so a locator can time out on a healthy screen. Check `[role=tab]` before blaming the UI.
- The session switcher does not open on an empty profile. Check it on real data.
- Opening a real session in a capture can move its "last active" time. Say so in the report.
- Untracked tarballs in `.cache/desktop-inputs/` make the `profile-archives` check fail locally. Move `.cache` aside for that run.
- A bulk rename can corrupt a class: `text-primary` inside `--linear-text-primary` became `text-(--linear-text-(--linear-accent))` at 12 sites and survived every review, because the text simply inherited a nearby colour. Run `scripts/token-audit.py` after a rename.
- Mounting a component alone can hide a layout bug: the Review diff collapsed to 0px only inside the real rail. Check the real parent, not a forced wrapper with a test-only height.
