import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Kept out of pre-bundling, which rewrites a dependency's module URL; the published
  // build inlines its wasm, but that is the kind of detail that changes between versions.
  optimizeDeps: { exclude: ['esm-potrace-wasm'] },
  // The tracing worker is a module worker (see trace/client.ts), and its graph splits into
  // chunks; the default 'iife' format cannot express either.
  worker: { format: 'es' },
  test: {
    // The maths is pure and runs in node. Anything touching potrace or a canvas is
    // verified in the browser instead -- a wasm tracer under jsdom tests jsdom.
    include: ['src/**/*.test.ts'],
  },
})
