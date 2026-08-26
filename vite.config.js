import { defineConfig } from 'vite'
import { sveltekit } from '@sveltejs/kit/vite'

export default defineConfig({
  plugins: [sveltekit()],
  server: {
    allowedHosts: ['fno.hidayattaufiqur.dev']
  },
  build: {
    rollupOptions: {
      // TDD §9.1 (Q15): keep sigma+graphology+fa2 out of the entry chunk so
      // non-graph pages never pay ~85KB gz. Verified by scripts/assert-chunk-split.
      manualChunks: {
        sigma: ['sigma', 'graphology', 'graphology-layout-forceatlas2']
      }
    }
  }
})
