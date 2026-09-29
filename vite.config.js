import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Writes sitemap.xml at build time: the page's canonical address from index.html, dated today,
// so the date never goes stale and a fork only has to change the address in one place.
function sitemap() {
  let root = '';
  return {
    name: 'sitemap',
    configResolved(config) { root = config.root; },
    generateBundle() {
      const html = readFileSync(resolve(root, 'index.html'), 'utf8');
      const url = html.match(/<link rel="canonical" href="([^"]+)"/)?.[1];
      if (!url) this.error('index.html needs a <link rel="canonical"> to build the sitemap from');
      this.emitFile({
        type: 'asset',
        fileName: 'sitemap.xml',
        source: `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${url}</loc>
    <lastmod>${new Date().toISOString().slice(0, 10)}</lastmod>
  </url>
</urlset>
`,
      });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [sitemap()],
  // An inline (empty) PostCSS config stops Vite from picking up configs in parent folders.
  css: { postcss: {} },
  build: { chunkSizeWarningLimit: 1500 },
});
