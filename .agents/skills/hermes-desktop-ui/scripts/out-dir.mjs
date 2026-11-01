import fs from 'node:fs'

export function outDir() {
  const dir = process.env.HX_OUT
  if (!dir) throw new Error('Set HX_OUT to a folder for screenshots')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}
