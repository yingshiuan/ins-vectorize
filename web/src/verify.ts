/**
 * The end-to-end check as a page, at /verify.html.
 *
 * Same assertions as `npm run verify`; this one also shows the source beside the
 * trace, because some faults are obvious to look at and tedious to assert — and it
 * checks the worker, which only a browser can start.
 */
import { createTraceClient } from './trace/client'
import { disc, ground, threeInks, toImageData } from './trace/fixtures'
import { vectorize, type TraceResult } from './trace/pipeline'
import { runSelfTest, type Case } from './trace/selftest'
import { defaultSpec } from './trace/spec'

const out = document.getElementById('out')!
const shots = document.getElementById('shots')!

const PASS = '<span class="pass">pass</span>'
const FAIL = '<span class="fail">FAIL</span>'

/**
 * That the worker starts, that potrace loads inside it, and that it answers exactly what
 * tracing on the page does. A fallback to the page would still trace correctly, so it is
 * checked for separately rather than left to pass unnoticed.
 */
async function checkWorker(): Promise<{ text: string; failures: number }> {
  const spec = defaultSpec()
  const waiting = new Map<number, (answer: TraceResult | string) => void>()
  const client = createTraceClient({
    onResult: (run, result) => waiting.get(run)?.(result),
    onError: (run, message) => waiting.get(run)?.(message),
  })

  const lines = ['worker  —  the same answers, off the page']
  let failures = 0
  const shapes = [
    ['disc', disc(ground(120, 120), 60, 60, 40)],
    ['three inks', threeInks()],
  ] as const
  for (const [i, [name, raw]] of shapes.entries()) {
    const image = toImageData(raw)
    const got = await new Promise<TraceResult | string>((resolve) => {
      waiting.set(i + 1, resolve)
      client.trace(i + 1, spec, image)
    })
    const want = await vectorize(image, spec)
    const ok = typeof got !== 'string' && got.svg === want.svg
    if (!ok) failures++
    lines.push(`  ${ok ? PASS : FAIL} ${name.padEnd(24)} ${typeof got === 'string' ? `threw: ${got}` : 'same SVG as the page'}`)
  }

  const threaded = client.mode === 'worker'
  if (!threaded) failures++
  lines.push(`  ${threaded ? PASS : FAIL} ${'ran in a worker'.padEnd(24)} ${client.mode}`)
  client.dispose()
  return { text: lines.join('\n'), failures }
}

function render(c: Case) {
  const lines = [`${c.name}  —  ${c.note}`]
  for (const k of c.checks) {
    const mark = k.ok ? PASS : FAIL
    lines.push(
      `  ${mark} ${k.label.padEnd(24)} got ${k.got.toFixed(2).padStart(8)}   want ${k.want
        .toFixed(2)
        .padStart(8)}  ±${k.slack}`,
    )
  }

  const canvas = document.createElement('canvas')
  canvas.width = c.source.width
  canvas.height = c.source.height
  canvas.getContext('2d')!.putImageData(toImageData(c.source), 0, 0)

  const figure = document.createElement('figure')
  figure.innerHTML = `<img src="${canvas.toDataURL()}" alt="">${c.svg}<figcaption>${c.name}</figcaption>`
  shots.append(figure)

  return lines.join('\n')
}

runSelfTest()
  .then(async ({ cases, failures }) => {
    const body = cases.map(render).join('\n\n')
    const worker = await checkWorker()
    const total = failures + worker.failures
    const tail =
      total === 0
        ? '<span class="pass">all checks passed</span>'
        : `<span class="fail">${total} check(s) failed</span>`
    out.innerHTML = `${body}\n\n${worker.text}\n\n${tail}`
  })
  .catch((e: unknown) => {
    out.innerHTML = `<span class="fail">threw: ${e instanceof Error ? `${e.message}\n\n${e.stack}` : String(e)}</span>`
  })
