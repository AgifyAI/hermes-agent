// node hx.mjs <port> run settings-sweep.mjs
// Opens every Settings subpage from the navigation (nothing else is clicked), shoots light and dark,
// and returns console errors plus any element overflowing the content panel.
import fs from 'node:fs'

import { outDir } from './out-dir.mjs'

export default async function settingsSweep(page, { out }) {
  const dir = `${outDir()}/sweep/`
  fs.mkdirSync(dir, { recursive: true })
  const cdp = await page.context().newCDPSession(page)
  const errors = {}; let cur = ''
  page.on('console', m => m.type() === 'error' && (errors[cur] ??= []).push(m.text().slice(0, 200)))
  await page.evaluate(() => (location.hash = '/settings')); await page.waitForTimeout(2000)
  const rows = () => page.evaluate(() => {
    let c = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Close settings')
    while (c && c.querySelectorAll('button').length < 10) c = c.parentElement
    if (!c) throw new Error('Settings did not open: run the sweep on a connected instance, not the isolated copy')
    window.__nav = c
    return [...new Set([...c.querySelectorAll('button')].map(b => b.textContent.trim()).filter(t => t && t !== 'Close settings' && !/^Search/.test(t)))]
  })
  const click = t => page.evaluate(t => { [...window.__nav.querySelectorAll('button')].find(b => b.textContent.trim() === t)?.click() }, t)
  const audit = () => page.evaluate(() => {
    const m = document.querySelector('main'); if (!m) return ['no main']
    const R = m.getBoundingClientRect(); const bad = []
    for (const e of m.querySelectorAll('*')) { const r = e.getBoundingClientRect(); if (r.width && r.height && r.right > R.right + 1 && r.left < R.right && getComputedStyle(e).visibility !== 'hidden') bad.push(e.tagName + ':' + (e.textContent || '').trim().slice(0, 40)) }
    return bad.slice(0, 4)
  })
  const shoot = async name => { for (const s of ['light', 'dark']) { await page.emulateMedia({ colorScheme: s }); await page.waitForTimeout(350); fs.writeFileSync(`${dir}${name}-${s}.png`, Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png' })).data, 'base64')) } await page.emulateMedia({ colorScheme: null }) }
  const tops = await rows(); const seen = new Set(); const report = {}
  const visit = async (label, tag) => { cur = tag; await click(label); await page.waitForTimeout(1300); const heading = await page.evaluate(() => document.querySelector('main h1')?.textContent ?? ''); const slug = tag.replace(/[^a-z0-9]+/gi, '-').toLowerCase(); if (seen.has(slug)) return; seen.add(slug); await shoot(slug); const a = await audit(); report[slug] = heading + (a.length ? ' OVERFLOW ' + JSON.stringify(a) : '') }
  for (const top of tops) {
    await click(top); await page.waitForTimeout(800)
    const subs = (await rows()).filter(l => !tops.includes(l))
    if (!subs.length) { await visit(top, top); continue }
    for (const sub of subs) await visit(sub, `${top}-${sub}`)
  }
  out({ count: seen.size, report, errors })
}
