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
