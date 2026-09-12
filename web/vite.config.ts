import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // esm-potrace-wasm loads its own .wasm beside the module. Pre-bundling rewrites
  // the module's URL and the fetch for the binary then misses.
  optimizeDeps: { exclude: ['esm-potrace-wasm'] },
  test: {
    // The maths is pure and runs in node. Anything touching potrace or a canvas is
    // verified in the browser instead -- a wasm tracer under jsdom tests jsdom.
    include: ['src/**/*.test.ts'],
  },
})
