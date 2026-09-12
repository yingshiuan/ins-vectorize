/**
 * What the browser pipeline needs before it will run under node.
 *
 * Import this *statically*, before any dynamic import of the pipeline: static
 * imports evaluate in order and before the importing module's body, so these are in
 * place by the time potrace is pulled in.
 *
 * esm-potrace-wasm declares "type": "module" but its node branch calls bare
 * `require`, `__filename`, `__dirname` and `module` — so as published it cannot load
 * under node ESM at all. Those references resolve through the scope chain, so
 * globalThis stand-ins satisfy them.
 *
 * potrace also wants an `ImageData`, which node has no reason to provide. The shape
 * of it is three fields.
 *
 * None of this touches the code under test.
 */
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const g = globalThis as unknown as Record<string, unknown>

g.require ??= createRequire(import.meta.url)
g.__filename ??= fileURLToPath(import.meta.url)
g.__dirname ??= dirname(fileURLToPath(import.meta.url))
g.module ??= { exports: {} }

if (!('ImageData' in globalThis)) {
  class NodeImageData {
    data: Uint8ClampedArray
    width: number
    height: number
    readonly colorSpace = 'srgb'

    constructor(data: Uint8ClampedArray | number, width: number, height?: number) {
      if (typeof data === 'number') {
        this.width = data
        this.height = width
        this.data = new Uint8ClampedArray(this.width * this.height * 4)
      } else {
        this.data = data
        this.width = width
        this.height = height ?? data.length / 4 / width
      }
    }
  }
  g.ImageData = NodeImageData
}
