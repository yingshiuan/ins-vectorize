/**
 * The end-to-end check, headless.
 *
 *   npm run verify
 *
 * Two things have to be arranged before the pipeline will run outside a browser.
 *
 * esm-potrace-wasm declares "type": "module" but its node branch calls bare
 * `require`, so as published it cannot load under node ESM. Those calls resolve
 * through the scope chain, so globalThis stand-ins satisfy them. They must be in
 * place *before* the module is evaluated, which is why the pipeline is pulled in by
 * dynamic import below — static imports hoist and would run it first.
 *
 * potrace also wants an `ImageData`, which node has no reason to provide. The shape
 * of it is three fields.
 *
 * Everything past that is the real code: potrace itself, the coordinate mapping,
 * the fitter.
 */
import './node-shims.ts'

const { runSelfTest } = await import('../src/trace/selftest.ts')
const { cases, failures } = await runSelfTest()

for (const c of cases) {
  console.log(`\n${c.name}  —  ${c.note}`)
  for (const k of c.checks) {
    console.log(
      `  ${k.ok ? '  ok  ' : ' FAIL '} ${k.label.padEnd(24)}` +
        ` got ${k.got.toFixed(2).padStart(8)}   want ${k.want.toFixed(2).padStart(8)}  ±${k.slack}`,
    )
  }
}

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
