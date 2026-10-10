import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
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

// Writes sw.js once the build is on disk: src/sw.js with the list of every file it has to cache for the
// game to run offline, and a version drawn from their contents (and its own), so any change to the build
// updates it. Left out: what only search engines and link previews fetch.
const NOT_CACHED = ['sitemap.xml', 'og-image.jpg', 'sw.js'];
function serviceWorker() {
  let root = '', outDir = '';
  return {
    name: 'service-worker',
    apply: 'build',
    configResolved(config) { root = config.root; outDir = resolve(root, config.build.outDir); },
    writeBundle() {
      const files = readdirSync(outDir, { recursive: true, withFileTypes: true })
        .filter((f) => f.isFile())
        .map((f) => relative(outDir, join(f.parentPath, f.name)).split('\\').join('/'))
        .filter((f) => !NOT_CACHED.includes(f))
        .sort();
      const template = readFileSync(resolve(root, 'src/sw.js'), 'utf8');
      const hash = createHash('sha256').update(template);
      for (const f of files) hash.update(f).update(readFileSync(join(outDir, f)));
      const list = files.map((f) => (f === 'index.html' ? './' : `./${f}`));
      const source = template
        .replace('__VERSION__', JSON.stringify(hash.digest('hex').slice(0, 12)))
        .replace('__FILES__', JSON.stringify(list, null, 2));
      writeFileSync(join(outDir, 'sw.js'), source);
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [sitemap(), serviceWorker()],
  // An inline (empty) PostCSS config stops Vite from picking up configs in parent folders.
  css: { postcss: {} },
  build: { chunkSizeWarningLimit: 1500 },
});
