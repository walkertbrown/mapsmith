// Mapsmith on the web: the plugin's own code over one stand-in note kept in this browser. Pictures and VTT files
// download; the Pro key is checked against the same server as in Obsidian and remembered here.
import { App, Notice, installDomHelpers, requestUrl } from '../test/obsidian-shim';
import MapsmithPlugin from '../src/main';

installDomHelpers();

const NOTE = 'Map.md';
const STORE = 'mapsmith-web';
const BLOCKS: Record<string, string> = {
	town: 'seed: saltmarch\nsize: town\nwater: estuary\nside: east',
	region: 'map: region\nseed: saltmarch\nwater: coast\nside: east\nterrain: hills',
	dungeon: 'map: dungeon\nseed: saltmarch\nsize: dungeon\nkind: crypt',
	ship: 'map: ship\nseed: saltmarch\nsize: freighter\nmood: derelict',
	building: 'map: building\nseed: saltmarch\nkind: inn',
};
const fence = (body: string) => '```mapsmith\n' + body + '\n```';

type Saved = { block?: string; data?: unknown };
const load = (): Saved => {
	try { return JSON.parse(localStorage.getItem(STORE) ?? '{}') as Saved; } catch { return {}; }
};
const store = (s: Saved) => {
	try { localStorage.setItem(STORE, JSON.stringify({ ...load(), ...s })); } catch { /* private window: works, forgets */ }
};

// The key check and the key mail go to the real server, same origin as this page.
requestUrl.reply = async (r) => {
	const res = await fetch(r.url, { method: r.method ?? 'GET', headers: r.contentType ? { 'content-type': r.contentType } : {}, body: r.body });
	return { status: res.status, json: await res.json().catch(() => null) };
};

// A map's link carries its block in the address, as #map=dungeon&seed=penlow&kind=crypt.
const toHash = (body: string) => '#' + new URLSearchParams(body.split('\n').map((l) => /^\s*([\w-]+)\s*:\s*(.*?)\s*$/.exec(l)).filter((m): m is RegExpExecArray => !!m).map((m) => [m[1]!, m[2]!])).toString();
const fromHash = (h: string) => [...new URLSearchParams(h.replace(/^#/, ''))].filter(([k]) => /^[\w-]+$/.test(k)).map(([k, v]) => `${k}: ${v.replace(/[\n`]/g, ' ')}`).join('\n');
const linked = fromHash(location.hash);

const app = new App();
app.notes.set(NOTE, { path: NOTE, content: linked.includes('seed:') ? fence(linked) : load().block ?? fence(BLOCKS.town!) });
const plugin = new MapsmithPlugin(app as never, { id: 'mapsmith' } as never);
const p = plugin as never as { data: unknown; saveData: (d: unknown) => Promise<void>; settings: { key: string; vtt: boolean }; checkKey(): Promise<string>; mailKey(e: string): Promise<string>; codeBlocks: Record<string, Proc> };
p.data = load().data ?? null;
p.saveData = async (d) => { p.data = d; store({ data: d }); };

type Ctx = { sourcePath: string; addChild: (c: { load(): void }) => void; getSectionInfo: () => { text: string; lineStart: number; lineEnd: number } };
type Proc = (src: string, el: HTMLElement, c: Ctx) => void;
const note = () => app.notes.get(NOTE)!.content;
const ctx: Ctx = {
	sourcePath: NOTE,
	addChild: (c) => c.load(),
	getSectionInfo: () => {
		const lines = note().split('\n');
		const lineStart = lines.findIndex((l) => l.startsWith('```mapsmith'));
		const lineEnd = lines.findIndex((l, i) => i > lineStart && l.startsWith('```'));
		return { text: note(), lineStart, lineEnd };
	},
};

const $ = <T extends HTMLElement>(s: string) => document.querySelector<T>(s)!;
const board = $('#board'), source = $<HTMLTextAreaElement>('#source'), made = $('#made'), madeBox = $('#notes');

const download = (name: string, data: BlobPart, type: string) => {
	const a = document.createElement('a');
	a.href = URL.createObjectURL(new Blob([data], { type }));
	a.download = name.slice(name.lastIndexOf('/') + 1);
	document.body.append(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(a.href), 10000);
};

let proc: Proc;
const body = () => {
	const info = ctx.getSectionInfo();
	return note().split('\n').slice(info.lineStart + 1, info.lineEnd).join('\n');
};
const draw = () => {
	const info = ctx.getSectionInfo();
	board.replaceChildren();
	const el = board.createDiv();
	proc(note().split('\n').slice(info.lineStart + 1, info.lineEnd).join('\n'), el, ctx);
	if (document.activeElement !== source) source.value = body();
	store({ block: note() });
	history.replaceState(null, '', toHash(body()));
	const kind = /^map:\s*(\w+)/m.exec(note())?.[1] ?? 'town';
	for (const b of document.querySelectorAll<HTMLButtonElement>('[data-map]')) b.classList.toggle('mod-cta', b.dataset.map === kind);
	if (app.active && app.active !== NOTE) {
		madeBox.hidden = false;
		made.textContent = `${app.active}\n\n${app.notes.get(app.active)?.content ?? ''}`;
	}
};

void (async () => {
	await plugin.onload();
	proc = p.codeBlocks.mapsmith!;
	app.vault.on('modify', () => draw());
	// A place's note is shown beside the map, and can be downloaded. A VTT file downloads instead of being kept.
	const create = app.vault.create;
	app.vault.create = async (path, content) => {
		if (path.endsWith('.dd2vtt')) {
			download(path, content, 'application/json');
			return { path } as never;
		}
		const f = await create(path, content);
		setTimeout(draw, 0);
		return f;
	};
	const createBinary = app.vault.createBinary;
	app.vault.createBinary = async (path, data) => {
		download(path, data, 'image/png');
		return createBinary(path, data);
	};
	for (const b of document.querySelectorAll<HTMLButtonElement>('[data-map]')) {
		b.addEventListener('click', () => {
			app.notes.get(NOTE)!.content = fence(BLOCKS[b.dataset.map!]!);
			app.active = null;
			madeBox.hidden = true;
			draw();
			board.scrollIntoView({ behavior: 'smooth', block: 'start' });
		});
	}
	source.addEventListener('input', () => {
		app.notes.get(NOTE)!.content = fence(source.value);
		draw();
	});
	$('#copy-link').addEventListener('click', () => {
		const b = $<HTMLButtonElement>('#copy-link');
		void navigator.clipboard.writeText(location.href).then(
			() => { b.textContent = 'Link copied'; setTimeout(() => (b.textContent = 'Copy link to this map'), 2500); },
			() => new Notice(`This map's link: ${location.href}`),
		);
	});
	addEventListener('hashchange', () => {
		const b = fromHash(location.hash);
		if (b.includes('seed:') && b !== body()) { app.notes.get(NOTE)!.content = fence(b); draw(); }
	});
	$('#save-note').addEventListener('click', () => {
		if (app.active) download(app.active, app.notes.get(app.active)?.content ?? '', 'text/markdown');
	});
	if (document.querySelector('#key-form')) {
		const key = $<HTMLInputElement>('#key'), said = $('#key-said');
		key.value = p.settings.key;
		const pro = () => { $('#pro-on').hidden = !p.settings.vtt; };
		pro();
		$('#key-form').addEventListener('submit', (e) => {
			e.preventDefault();
			p.settings.key = key.value.trim();
			said.textContent = 'Checking…';
			void p.checkKey().then((m) => { said.textContent = m.replace('in this vault', 'in this browser'); pro(); });
		});
		$('#mail-form').addEventListener('submit', (e) => {
			e.preventDefault();
			const m = $<HTMLInputElement>('#mail');
			$('#mail-said').textContent = 'Asking…';
			void p.mailKey(m.value.trim()).then((t) => { $('#mail-said').textContent = t; });
		});
	}
	const theme = (dark: boolean) => {
		document.body.classList.toggle('theme-dark', dark);
		document.documentElement.dataset.theme = dark ? 'dark' : 'light';
		app.workspace.trigger('css-change', null);
	};
	theme(matchMedia('(prefers-color-scheme: dark)').matches);
	$('#theme').addEventListener('click', () => theme(!document.body.classList.contains('theme-dark')));
	draw();
})();

// Notices show on the page the way Obsidian shows them, with any address in them as a link.
const toast = $('#notice');
let hide = 0;
Notice.show = (msg) => {
	toast.replaceChildren();
	for (const part of msg.replace(/ Then paste your key in Mapsmith's settings\./, document.querySelector('#key-form') ? ' Then paste your key under Mapsmith Pro on this page.' : ' Then open this map on the web version and paste your key there: https://bulkhead.bananafest-destiny.com/mapsmith/' + location.hash).replace(/Saved Map\//, 'Saved ').split(/(https:\/\/[^\s]*[^\s.,])/)) {
		if (part.startsWith('https://')) {
			const a = document.createElement('a');
			a.href = part;
			a.textContent = part;
			a.target = '_blank';
			a.rel = 'noopener';
			toast.append(a);
		} else toast.append(part);
	}
	toast.hidden = false;
	clearTimeout(hide);
	hide = window.setTimeout(() => { toast.hidden = true; }, 12000);
};
