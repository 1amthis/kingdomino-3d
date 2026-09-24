import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  // An inline (empty) PostCSS config stops Vite from picking up configs in parent folders.
  css: { postcss: {} },
  build: { chunkSizeWarningLimit: 1500 },
});
