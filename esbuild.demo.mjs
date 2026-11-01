// Browser bundle of the plugin plus the test shim, for the demo page on the site.
import esbuild from 'esbuild';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const out = new URL('../../public/press/mapsmith/', import.meta.url);
mkdirSync(out, { recursive: true });
await esbuild.build({
	entryPoints: ['demo/driver.ts'],
	bundle: true,
	format: 'iife',
	target: 'es2021',
	minify: true,
	alias: { obsidian: './test/obsidian-shim.ts' },
	outfile: new URL('demo.js', out).pathname,
	logLevel: 'info',
});
copyFileSync('styles.css', new URL('styles.css', out));
copyFileSync('demo/index.html', new URL('index.html', out));

// The web version at /mapsmith/: the same plugin over a note kept in the browser, with real key checks.
const web = new URL('../../public/mapsmith/', import.meta.url);
mkdirSync(web, { recursive: true });
await esbuild.build({
	entryPoints: ['web/app.ts'],
	bundle: true,
	format: 'iife',
	target: 'es2021',
	minify: true,
	alias: { obsidian: './test/obsidian-shim.ts' },
	outfile: new URL('app.js', web).pathname,
	logLevel: 'info',
});
copyFileSync('styles.css', new URL('styles.css', web));
// The site's analytics tag is taken from a page already on the site, so it never sits in the plugin's repo.
const site = readFileSync(new URL('../../public/fantasy-town-map-generator/index.html', import.meta.url), 'utf8');
const tag = /<!-- Cloudflare Web Analytics -->.*?<!-- End Cloudflare Web Analytics -->/s.exec(site)?.[0] ?? '';
writeFileSync(new URL('index.html', web), readFileSync('web/index.html', 'utf8').replace('</body>', `${tag}\n</body>`));

// The same page for itch's browser player: no site tags, and Pro saves send you to the web version (itch's frame
// can't reach the key server). Zipped as mapsmith-web.zip for the boss to upload.
const itch = new URL('../../public/press/mapsmith/itch-web/', import.meta.url);
const files = new URL('files/', itch);
mkdirSync(files, { recursive: true });
let page = readFileSync('web/index.html', 'utf8')
	.replace(/<link rel="canonical"[^>]*>\n/, '<meta name="robots" content="noindex">\n')
	.replace(/<meta property="og:[^>]*>\n/g, '')
	.replace(/<meta name="twitter:[^>]*>\n/, '')
	.replace(/<script src="https:\/\/pulse[^>]*><\/script>\n/, '')
	.replace('<link rel="icon" href="/favicon.svg" type="image/svg+xml">\n', '')
	.replace(/<nav class="top">.*?<\/nav>\n/, '')
	.replace(/<form id="key-form">[\s\S]*?<\/details>/, '<p>Bought it? <a href="https://bulkhead.bananafest-destiny.com/mapsmith/" target="_blank" rel="noopener">Open Mapsmith on the web</a>, paste your key there, and every map saves for your tabletop. The map you have open here goes with you through Copy link.</p>')
	.replace('<p>Your map and key stay in this browser. The page goes online only to check a Pro key or mail one.', '<p>Nothing leaves your browser; this page never goes online.');
if (page.includes('key-form')) throw new Error('itch page still has the key form');
writeFileSync(new URL('index.html', files), page);
copyFileSync(new URL('../../public/mapsmith/app.js', import.meta.url), new URL('app.js', files));
copyFileSync('styles.css', new URL('styles.css', files));
