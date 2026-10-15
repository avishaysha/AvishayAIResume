// optimize-images.mjs: one-time export of responsive AVIF/WebP variants into public/img/.
// Run with `npm run optimize:images`; the outputs are committed, so builds never need sharp.
// Reads originals from source-images/ when that (gitignored) folder exists, else from public/.
// Never upscales: a width larger than the original is skipped (except the original width itself).
import sharp from 'sharp'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const srcDir = existsSync(join(root, 'source-images')) ? join(root, 'source-images') : join(root, 'public')
const outDir = join(root, 'public', 'img')
mkdirSync(outDir, { recursive: true })

// name -> { file, widths }; `optional` widths are only exported when the original is at least that wide.
const jobs = [
  { name: 'portrait', file: 'portrait.jpg', widths: [480, 720, 900] },
  { name: 'event-it', file: 'event-it.jpg', widths: [960, 1440, 1920] },
  { name: 'followup', file: 'followup.png', widths: [640, 1227] },
  { name: 'lecture', file: 'lecture.jpg', widths: [800, 1448], optional: [2400] },
]

const kb = (p) => `${Math.round(statSync(p).size / 1024)}KB`

for (const job of jobs) {
  const input = join(srcDir, job.file)
  if (!existsSync(input)) { console.warn(`skip ${job.file}: not found in ${srcDir}`); continue }
  const { width: w0, height: h0 } = await sharp(input).metadata()
  const widths = [...job.widths, ...(job.optional || []).filter((w) => w <= w0)]
  for (const w of widths) {
    if (w > w0) { console.warn(`skip ${job.name}-${w}: original is only ${w0}px wide`); continue }
    const base = sharp(input).rotate().resize({ width: w, withoutEnlargement: true })
    const avif = join(outDir, `${job.name}-${w}.avif`)
    const webp = join(outDir, `${job.name}-${w}.webp`)
    await base.clone().avif({ quality: 50, effort: 6 }).toFile(avif)
    await base.clone().webp({ quality: 72, effort: 6 }).toFile(webp)
    console.log(`${job.name}-${w} (${w}x${Math.round((h0 * w) / w0)}): avif ${kb(avif)}, webp ${kb(webp)}`)
  }
}
