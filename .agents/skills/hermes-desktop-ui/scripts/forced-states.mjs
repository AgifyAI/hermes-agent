// node hx.mjs 9222 run forced-states.mjs [state ...]
// Isolated dev copy only: forces states through the app's own stores, with fake data.
import fs from 'node:fs'

import { outDir } from './out-dir.mjs'

const SESSION = '/src/store/session.ts'

const tool = (id, toolName, args, result, isError) => ({
  type: 'tool-call', toolCallId: id, toolName, args, argsText: JSON.stringify(args), ...(result === undefined ? {} : { result }), isError
})

const TRANSCRIPT = [
  { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Audit the build and fix what fails.' }], timestamp: 1 },
  { id: 'a1', role: 'assistant', timestamp: 2, parts: [
    { type: 'reasoning', text: 'I should read the config before running anything.' },
    { type: 'text', text: 'I will start with the config.\n\n```ts\nconst a = 1\n```\n\n| Step | State |\n|---|---|\n| Build | ok |' },
    tool('t1', 'read_file', { path: 'apps/desktop/package.json' }, { content: '{ "name": "desktop" }' }),
    tool('t2', 'terminal', { command: 'npm run build' }, { output: 'built in 12s', exit_code: 0 }),
    tool('t3', 'web_search', { query: 'electron vibrancy' }, { error: 'network down' }, true),
    tool('t4', 'patch', { path: 'src/a.ts', old_string: 'a', new_string: 'b' }, { success: true, diff: '--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-const a = 1\n+const a = 2\n' })
  ] }
]

const QUESTION = [{ id: 'q1', question: 'Which branch should I use?', choices: ['main (Recommended)', 'feature'] }]
const COMMAND = 'rm -rf node_modules && npm ci'

// In the page: open a session, wait out its reset, then show the transcript.
const showTranscript = page => page.evaluate(async ([path, messages]) => {
  const s = await window.__mod(path)
  s.$activeSessionId.set('harness')
  s.$selectedStoredSessionId.set('harness')
  await new Promise(r => setTimeout(r, 1500))
  s.$messages.set(messages)
}, [SESSION, TRANSCRIPT])

const running = (page, message) => page.evaluate(async ([path, msg]) => {
  const s = await window.__mod(path)
  s.$messages.set([...s.$messages.get(), msg])
  s.$busy.set(true)
}, [SESSION, message])

const clearChat = page => page.evaluate(async path => {
  const s = await window.__mod(path)
  s.$busy.set(false)
  s.$messages.set([])
}, SESSION)

const setAtom = (page, path, name, value) => page.evaluate(async ([p, n, v]) => { (await window.__mod(p))[n].set(v) }, [path, name, value])

const toggled = (path, name) => ({ show: p => setAtom(p, path, name, true), hide: p => setAtom(p, path, name, false) })

const bootPatch = (page, patch) => page.evaluate(async p => {
  const m = await window.__mod('/src/store/boot.ts')
  m.$desktopBoot.set({ ...m.$desktopBoot.get(), ...p })
}, patch)

const BOOT_CLEAR = { error: null, updateHold: null, running: false }

const STATES = {
  updates: toggled('/src/store/updates.ts', '$updateOverlayOpen'),
  'pet-generate': toggled('/src/store/pet-generate.ts', '$petGenerateOpen'),
  'usage-stats': toggled('/src/store/shared-metrics.ts', '$sharedMetricsDetailsOpen'),
  'session-picker': toggled(SESSION, '$sessionPickerOpen'),
  toasts: {
    show: page => page.evaluate(async () => {
      const n = await window.__mod('/src/store/notifications.ts')
      n.notifyError(new Error('Could not reach the gateway'), 'Sync failed')
      n.notify({ kind: 'success', title: 'Saved', message: 'Your settings were saved.' })
    })
  },
  tools: { show: showTranscript, hide: clearChat },
  clarify: {
    show: async page => {
      await showTranscript(page)
      await page.evaluate(async ([path, q]) => {
        const s = await window.__mod(path)
        const c = await window.__mod('/src/store/clarify.ts')
        c.setClarifyRequest({ requestId: 'r1', sessionId: s.$activeSessionId.get(), questions: c.normalizeQuestions(q) })
      }, [SESSION, QUESTION])
      await running(page, { id: 'a2', role: 'assistant', timestamp: 3, status: { type: 'running' }, parts: [tool('c1', 'clarify', { questions: QUESTION })] })
    },
    hide: clearChat
  },
  approval: {
    show: async page => {
      await showTranscript(page)
      await page.evaluate(async ([path, command]) => {
        const s = await window.__mod(path)
        const p = await window.__mod('/src/store/prompts.ts')
        p.setApprovalRequest({ sessionId: s.$activeSessionId.get(), requestId: 'ap1', command, description: 'Delete dependencies and reinstall', allowPermanent: true })
      }, [SESSION, COMMAND])
      await running(page, { id: 'a3', role: 'assistant', timestamp: 4, status: { type: 'running' }, parts: [tool('x1', 'terminal', { command: COMMAND })] })
    },
    hide: clearChat
  },
  'boot-failure': {
    show: page => bootPatch(page, { error: 'Could not start the Hermes backend: connection refused on 127.0.0.1:9119', running: false, visible: true }),
    hide: page => bootPatch(page, BOOT_CLEAR)
  },
  'update-hold': {
    show: page => bootPatch(page, { error: null, running: false, updateHold: { holdId: 'x', verdict: 'held', since: Date.now() - 60_000, checkedAt: Date.now() } }),
    hide: page => bootPatch(page, BOOT_CLEAR)
  }
}

const WINDOWS = ['quick', 'overlay', 'wake', 'hud']

export default async function forcedStates(page, { args, out }) {
  const dir = outDir()
  const cdp = await page.context().newCDPSession(page)
  const home = new URL(page.url()).origin
  const names = args.length ? args : [...Object.keys(STATES), ...WINDOWS]
  const results = {}

  const shoot = async name => {
    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme })
      await page.waitForTimeout(500)
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' })
      fs.writeFileSync(`${dir}/state-${name}-${scheme}-after.png`, Buffer.from(data, 'base64'))
    }
    await page.emulateMedia({ colorScheme: null })
  }

  const urls = []
  page.on('request', r => r.url().includes('/src/store/') && urls.push(r.url()))
  await page.reload()
  await page.waitForTimeout(7000)
  await page.evaluate(list => {
    window.__mod = async file => {
      const hit = list.find(u => u.includes(file + '?') || u.endsWith(file))
      if (!hit) throw new Error('not loaded: ' + file)
      return import(hit)
    }
  }, urls)

  for (const name of names.filter(n => STATES[n])) {
    try {
      await STATES[name].show(page)
      await page.waitForTimeout(1200)
      await shoot(name)
      results[name] = 'ok'
    } catch (e) {
      results[name] = 'ERR ' + String(e).slice(0, 180)
    }
    await STATES[name].hide?.(page).catch(() => {})
    await page.waitForTimeout(300)
  }

  for (const win of names.filter(n => WINDOWS.includes(n))) {
    await page.goto(`${home}/?win=${win}`)
    await page.waitForTimeout(4000)
    await shoot('win-' + win)
    results['win-' + win] = 'ok'
  }

  if (names.some(n => WINDOWS.includes(n))) await page.goto(`${home}/`)
  out({ dir, results })
}
