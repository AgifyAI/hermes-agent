// Drive Hermes over the Chrome DevTools Protocol. Usage: node hx.mjs <port> <cmd> [args...]
//   eval <js>                 evaluate an expression in the main window, print JSON
//   shot <file.png>           screenshot the main window
//   run <script.mjs>          import a script exporting default async (page, ctx) => {}
//   pages                     list open windows
import { chromium } from 'playwright-core'

const [, , port, cmd, ...args] = process.argv
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
const pages = browser.contexts().flatMap(c => c.pages())
const page =
  pages.find(p => /index\.html|127\.0\.0\.1:\d+\/?(#|$)/.test(p.url()) && !/[?&]win=/.test(p.url())) ??
  pages[0]

const out = v => process.stdout.write((typeof v === 'string' ? v : JSON.stringify(v, null, 1)) + '\n')

try {
  if (cmd === 'pages') out(pages.map(p => p.url()))
  else if (cmd === 'eval') out(await page.evaluate(args[0]))
  else if (cmd === 'shot') {
    await page.screenshot({ path: args[0] })
    out(args[0])
  } else if (cmd === 'run') {
    const mod = await import(new URL(args[0], `file://${process.cwd()}/`).href)
    await mod.default(page, { browser, pages, args: args.slice(1), out })
  }
} finally {
  await browser.close().catch(() => {})
}
