// node hx.mjs <port> run capture.mjs <phase> [screen | name=#/hash ...]
// Shoots each screen in light and dark to $HX_OUT and returns console errors per screen.
import { execSync } from 'node:child_process'
import fs from 'node:fs'

import { outDir } from './out-dir.mjs'

const SCREENS = {
  chat: '#/',
  settings: '#/settings',
  'settings-appearance': '#/settings?tab=config:appearance',
  'settings-model': '#/settings?tab=config:model',
  'settings-providers': '#/settings?tab=providers',
  'settings-gateway': '#/settings?tab=gateway',
  'settings-keybinds': '#/settings?tab=keybinds',
  'settings-billing': '#/settings?tab=billing',
  'settings-about': '#/settings?tab=about',
  'settings-chat': '#/settings?tab=config:chat',
  'settings-workspace': '#/settings?tab=config:workspace',
  'settings-safety': '#/settings?tab=config:safety',
  'settings-browser': '#/settings?tab=config:browser',
  'settings-memory': '#/settings?tab=config:memory',
  'settings-voice': '#/settings?tab=config:voice',
  'settings-advanced': '#/settings?tab=config:advanced',
  'settings-connections': '#/settings?tab=connections',
  'settings-web-access': '#/settings?tab=web-access',
  'settings-keys': '#/settings?tab=keys',
  'settings-vault': '#/settings?tab=vault',
  'settings-notifications': '#/settings?tab=notifications',
  'settings-sessions': '#/settings?tab=sessions',
  'settings-plugins': '#/settings?tab=plugins',
  'capabilities-plugins': '#/capabilities?tab=plugins',
  'capabilities-connectors': '#/capabilities?tab=connectors',
  'capabilities-toolsets': '#/capabilities?tab=toolsets',
  'command-center': '#/command-center',
  capabilities: '#/capabilities',
  messaging: '#/messaging',
  webhooks: '#/webhooks',
  artifacts: '#/artifacts',
  cron: '#/cron',
  profiles: '#/profiles',
  agents: '#/agents',
  starmap: '#/starmap',
  'session-import': '#/session-import'
}

export default async function capture(page, { args, out }) {
  const [phase, ...wanted] = args
  const dir = outDir()
  const proc = process.env.HX_PROCESS ?? 'Hermes'
  execSync(`osascript -e 'tell application "System Events" to tell process "${proc}" to set size of window 1 to {1280, 800}'`)
  await page.waitForTimeout(600)
  const cdp = await page.context().newCDPSession(page)
  const errors = {}
  let current = ''
  page.on('console', m => m.type() === 'error' && (errors[current] ??= []).push(m.text().slice(0, 300)))
  page.on('pageerror', e => (errors[current] ??= []).push('pageerror: ' + String(e).slice(0, 300)))
  const list = wanted.length
    ? wanted.map(w => (w.includes('=') ? w.split('=') : [w, SCREENS[w]]))
    : Object.entries(SCREENS)
  for (const [name, hash] of list) {
    current = name
    await page.evaluate(h => (location.hash = h.slice(1)), hash)
    await page.waitForTimeout(Number(process.env.HX_WAIT ?? 3000))
    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme })
      await page.waitForTimeout(500)
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' })
      fs.writeFileSync(`${dir}/${name}-${scheme}-${phase}.png`, Buffer.from(data, 'base64'))
    }
  }
  await page.emulateMedia({ colorScheme: null })
  out({ dir, shots: list.map(([n]) => n), errors })
}
