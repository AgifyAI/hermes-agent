// node hx.mjs <port> run shot.mjs <name> [phase]: light and dark of whatever is on screen now.
import fs from 'node:fs'

import { outDir } from './out-dir.mjs'

export default async function shot(page, { args, out }) {
  const [name, phase = 'after'] = args
  const dir = outDir()
  const cdp = await page.context().newCDPSession(page)
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme })
    await page.waitForTimeout(400)
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(`${dir}/${name}-${scheme}-${phase}.png`, Buffer.from(data, 'base64'))
  }
  await page.emulateMedia({ colorScheme: null })
  out({ dir, hash: await page.evaluate(() => location.hash) })
}
