import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  root: fileURLToPath(new URL('./', import.meta.url)),
  base: './',
  publicDir: 'public',
  envDir: false,
  envPrefix: 'RECOVERY_PUBLIC_UNUSED_',
  plugins: [react()],
  resolve: { alias: { ethers: fileURLToPath(new URL('./node_modules/ethers/lib.esm/index.js', import.meta.url)) } },
  server: { fs: { allow: [fileURLToPath(new URL('.', import.meta.url)), fileURLToPath(new URL('../shared/', import.meta.url))] } },
  build: { outDir: 'dist-wallet-recovery', emptyOutDir: true, sourcemap: false },
})
