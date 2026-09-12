/**
 * The end-to-end check as a page, at /verify.html.
 *
 * Same assertions as `npm run verify`; this one also shows the source beside the
 * trace, because some faults are obvious to look at and tedious to assert.
 */
import { runSelfTest, type Case } from './trace/selftest'
import { toImageData } from './trace/fixtures'

const out = document.getElementById('out')!
const shots = document.getElementById('shots')!

function render(c: Case) {
  const lines = [`${c.name}  —  ${c.note}`]
  for (const k of c.checks) {
    const mark = k.ok ? '<span class="pass">pass</span>' : '<span class="fail">FAIL</span>'
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
  .then(({ cases, failures }) => {
    const body = cases.map(render).join('\n\n')
    const tail =
      failures === 0
        ? '<span class="pass">all checks passed</span>'
        : `<span class="fail">${failures} check(s) failed</span>`
    out.innerHTML = `${body}\n\n${tail}`
  })
  .catch((e: unknown) => {
    out.innerHTML = `<span class="fail">threw: ${e instanceof Error ? `${e.message}\n\n${e.stack}` : String(e)}</span>`
  })
