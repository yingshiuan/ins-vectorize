/**
 * Trace a real image from the command line.
 *
 *   vite-node scripts/trace-file.ts <raw-rgba.bin> <width> <height> <out.svg>
 *
 * Takes raw RGBA rather than a PNG because node has no image decoder and adding one
 * would be a dependency carried solely for a check. Produce the input with any
 * decoder to hand, e.g.
 *
 *   python -c "from PIL import Image; im=Image.open('x.png').convert('RGBA'); \
 *              open('x.bin','wb').write(im.tobytes()); print(im.width, im.height)"
 *
 * Synthetic shapes prove the geometry; this is for proving it survives real artwork.
 */
import './node-shims.ts'
import { readFileSync, writeFileSync } from 'node:fs'

const argv = process.argv.slice(2)
const [binPath, width, height, outPath] = argv.filter((a) => !a.startsWith('--'))
const flags = new Map(
  argv
    .filter((a) => a.startsWith('--'))
    .map((a) => {
      const [k, v] = a.slice(2).split('=')
      return [k, Number(v)] as const
    }),
)
if (!binPath || !width || !height || !outPath) {
  console.error(
    'usage: trace-file.ts <raw-rgba.bin> <width> <height> <out.svg>' +
      ' [--mode=auto|single|multi] [--limit=] [--blur=] [--upscale=] [--despeckle=] [--smooth=] [--denoise=]' +
      ' [--shapes=0] [--repeats=0] [--warm]',
  )
  process.exit(2)
}

const buf = readFileSync(binPath)
const w = Number(width)
const h = Number(height)
if (buf.byteLength !== w * h * 4) {
  console.error(`${binPath} is ${buf.byteLength} bytes; ${w}x${h} RGBA needs ${w * h * 4}`)
  process.exit(2)
}

const data = new Uint8ClampedArray(buf.byteLength)
data.set(buf)

const { vectorize } = await import('../src/trace/pipeline.ts')
const { defaultSpec } = await import('../src/trace/spec.ts')

const spec = defaultSpec()
const mode = argv.find((a) => a.startsWith('--mode='))?.slice(7)
if (mode === 'auto' || mode === 'single' || mode === 'multi') spec.palette.mode = mode
if (flags.has('limit')) spec.palette.limit = flags.get('limit')!
if (argv.includes('--remove=0')) spec.background.remove = false
if (flags.has('tolerance')) spec.background.tolerance = flags.get('tolerance')!
if (flags.has('softness')) spec.background.softness = flags.get('softness')!
if (flags.has('blur')) spec.trace.blur = flags.get('blur')!
if (flags.has('upscale')) spec.trace.upscale = flags.get('upscale')!
if (flags.has('despeckle')) spec.trace.despeckle = flags.get('despeckle')!
if (flags.has('smooth')) spec.fit.smooth = flags.get('smooth')!
if (flags.has('denoise')) spec.fit.denoise = flags.get('denoise')!
if (flags.has('shapes')) spec.fit.shapes = flags.get('shapes') !== 0
if (flags.has('repeats')) spec.fit.repeats = flags.get('repeats') !== 0

const result = await vectorize(new ImageData(data, w, h), spec)
writeFileSync(outPath, result.svg)

console.log(`source     ${w}x${h}`)
console.log(`blur       ${spec.trace.blur}  despeckle ${spec.trace.despeckle}`)
console.log(`background ${result.background}`)
console.log(`ink        ${result.ink}`)
console.log(`verdict    ${result.census?.verdict ?? 'none'}  (${result.census?.distinct.length ?? 0} distinct)`)
console.log(`outlines   ${result.outlines}`)
console.log(`nodes      ${result.nodes}`)
console.log(`circles    ${result.circles}`)
console.log(`repeats    ${result.repeats}`)
console.log(`size       ${(Buffer.byteLength(result.svg) / 1024).toFixed(1)} KB`)
console.log(`time       ${Math.round(result.ms)} ms`)
const ms = (n: number) => `${Math.round(n)}`
console.log(
  `  stages   separate ${ms(result.stages.separate)}  trace ${ms(result.stages.trace)}` +
    `  fit ${ms(result.stages.fit)}  emit ${ms(result.stages.emit)} ms`,
)

// What a slider costs once the tracer has something to remember: the worker's case.
if (argv.includes('--warm')) {
  const { createTracer } = await import('../src/trace/tracer.ts')
  const { layerContours } = await import('../src/trace/layer.ts')
  const tracer = createTracer(layerContours)
  const image = new ImageData(data, w, h)
  await tracer.run(image, spec)
  const steps = [
    ['smoothing +0.05', { ...spec, fit: { ...spec.fit, smooth: spec.fit.smooth + 0.05 } }],
    ['page colour', { ...spec, output: { ...spec.output, background: '#ffffff' } }],
  ] as const
  for (const [label, next] of steps) {
    const r = await tracer.run(image, next)
    console.log(`  warm     ${label.padEnd(16)} ${Math.round(r.ms)} ms`)
  }
}
const { toHex } = await import('../src/trace/ink.ts')
console.log('  census:')
for (const ink of result.census?.inks ?? []) {
  const share = `${(ink.share * 100).toFixed(1)}%`.padStart(6)
  console.log(
    `    ${toHex(ink.color)} ${share}  d1 ${ink.d1.toFixed(3)}  perp ${ink.perp.toFixed(3)}` +
      `  interior ${(ink.interior * 100).toFixed(0).padStart(3)}%  ${ink.distinct ? 'INK' : '-'}`,
  )
}
console.log('  layers:')
for (const [i, l] of result.layers.entries()) {
  const share = `${(l.share * 100).toFixed(1)}%`.padStart(6)
  console.log(`    ${i}  ${l.color} ${share}  ${String(l.outlines).padStart(3)} outlines  ${String(l.nodes).padStart(4)} nodes`)
}
console.log(`wrote      ${outPath}`)
