// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import { App, Notice, ctx, installDomHelpers, requestUrl } from './obsidian-shim';
import MapsmithPlugin from '../src/main';

beforeAll(() => installDomHelpers());

type Proc = (src: string, el: HTMLElement, c: ReturnType<typeof ctx>) => void;

function setup(note: string) {
	const app = new App();
	app.notes.set('Towns/Map.md', { path: 'Towns/Map.md', content: note });
	const plugin = new MapsmithPlugin(app as never, { id: 'mapsmith' } as never);
	plugin.onload();
	const proc = (plugin as never as { codeBlocks: Record<string, Proc> }).codeBlocks['mapsmith']!;
	const el = document.createElement('div');
	const render = () => {
		const text = app.notes.get('Towns/Map.md')!.content;
		const lines = text.split('\n');
		const lineStart = lines.findIndex((l) => /```mapsmith/.test(l));
		const lineEnd = lines.findIndex((l, i) => i > lineStart && l.includes('```'));
		el.replaceChildren();
		proc(lines.slice(lineStart + 1, lineEnd).join('\n'), el, ctx('Towns/Map.md', { text, lineStart, lineEnd }));
	};
	render();
	const flush = () => new Promise((r) => setTimeout(r, 0));
	const content = () => app.notes.get('Towns/Map.md')!.content;
	return { app, el, plugin, render, flush, content };
}

const NOTE = '# Saltmarch\n\n```mapsmith\nseed: salt\nsize: village\nwater: coast\n```\n';

describe('the town block', () => {
	it('draws the map, the key and a hint without touching the note', () => {
		const { el, content } = setup(NOTE);
		expect(el.querySelector('.mapsmith-map svg')).not.toBeNull();
		expect(el.querySelectorAll('.mapsmith-key li').length).toBeGreaterThanOrEqual(3);
		expect(el.querySelector('.mapsmith-hint')).not.toBeNull();
		expect(content()).toBe(NOTE);
	});

	it('shows a place when its number is clicked, and writes its note once', async () => {
		const { app, el, flush } = setup(NOTE);
		const badge = el.querySelector('.mapsmith-badge[data-place="1"] circle')!;
		badge.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		const name = el.querySelector('.mapsmith-card-name')!.textContent!;
		expect(name).toBe(el.querySelectorAll('.mapsmith-key-name')[1]!.textContent);
		expect(el.querySelectorAll('.is-picked').length).toBeGreaterThanOrEqual(2);
		const open = Array.from(el.querySelectorAll('button')).find((b) => b.textContent === 'Open its note')!;
		open.click();
		await flush();
		const made = [...app.notes.keys()].filter((k) => k !== 'Towns/Map.md');
		expect(made).toHaveLength(1);
		expect(made[0]).toMatch(/^Towns\/[A-Z][a-z]+\/.+\.md$/);
		expect(app.notes.get(made[0]!)!.content).toContain(`# ${name}`);
		expect(app.opened).toEqual([made[0]]);
		open.click();
		await flush();
		expect([...app.notes.keys()]).toHaveLength(2);
	});

	it('writes the new choice into the block', async () => {
		const { el, flush, content, render } = setup(NOTE);
		const size = el.querySelector('select')!;
		size.value = 'city';
		size.dispatchEvent(new Event('change'));
		await flush();
		expect(content()).toContain('size: city\n');
		render();
		Array.from(el.querySelectorAll('button')).find((b) => b.textContent === 'New town')!.click();
		await flush();
		expect(content()).not.toContain('seed: salt');
		expect(content()).toMatch(/seed: [a-z]+-\d{3}\n/);
	});

	it('says which lines it could not use', () => {
		const { el } = setup('```mapsmith\nsize: enormous\n```\n');
		expect(el.querySelector('.mapsmith-problem')!.textContent).toContain('size can be');
		expect(el.querySelector('svg')).not.toBeNull();
	});
});

describe('saving for a virtual tabletop', () => {
	const DUNGEON = '# Below\n\n```mapsmith\nmap: dungeon\nseed: saltmarch\n```\n';

	it('writes nothing without a key, and says where the key goes', async () => {
		const { app, el, flush } = setup(DUNGEON);
		const save = Array.from(el.querySelectorAll('button')).find((b) => b.textContent === 'Save for virtual tabletop')!;
		save.click();
		await flush();
		expect([...app.notes.keys()]).toEqual(['Towns/Map.md']);
		expect(Notice.last).toContain("Mapsmith's settings");
	});

	it('has the button under a town too', () => {
		const { el } = setup(NOTE);
		expect(Array.from(el.querySelectorAll('.mapsmith-tools button')).map((b) => b.textContent)).toEqual(['Save for virtual tabletop']);
	});

	it('turns saving on for a key the server knows, and off for one it does not', async () => {
		const { plugin } = setup(DUNGEON);
		plugin.settings.key = 'somekey';
		requestUrl.reply = () => ({ status: 200, json: { ok: true, sold: true } });
		expect(await plugin.checkKey()).toMatch(/^Good key/);
		expect(plugin.settings.vtt).toBe(true);
		expect(requestUrl.sent.at(-1)!.url).toMatch(/\/api\/mapsmith\/key$/);
		requestUrl.reply = () => ({ status: 200, json: { ok: false, sold: true, buy: 'https://example.itch.io/x' } });
		expect(await plugin.checkKey()).toContain('https://example.itch.io/x');
		expect(plugin.settings.vtt).toBe(false);
		requestUrl.reply = () => ({ status: 200, json: { ok: false, sold: false } });
		expect(await plugin.checkKey()).toBe("Mapsmith Pro isn't sold yet.");
	});
});

describe('solo play in a dungeon', () => {
	const CRYPT = '# Crypt\n\n```mapsmith\nmap: dungeon\nseed: a\nsize: dungeon\nkind: crypt\n```\n';
	it('starts in room 1, goes through a door, and shows what was inside', async () => {
		const { el, flush, content, render } = setup(CRYPT);
		Array.from(el.querySelectorAll('button')).find((b) => b.textContent === 'Explore')!.click();
		await flush();
		expect(content()).toContain('explore: on\n');
		render();
		const shown = () => Array.from(el.querySelectorAll<HTMLElement>('.mapsmith-key li')).filter((li) => li.style.display !== 'none');
		expect(shown().map((li) => li.getAttribute('value'))).toEqual(['1']);
		const way = el.querySelector('.mapsmith-way')!;
		const num = way.getAttribute('data-enter')!;
		way.querySelector('circle')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		await flush();
		expect(content()).toContain(`explore: ${num}\n`);
		render();
		expect(shown().map((li) => li.getAttribute('value'))).toEqual(['1', num]);
		expect(el.querySelector('.mapsmith-card-n')!.textContent).toBe(num);
		expect(el.querySelector('.mapsmith-card')!.textContent).toMatch(/Inside[A-Z]/);
		expect(el.querySelector('.mapsmith-hint')!.textContent).toMatch(/^2 of \d+ rooms explored/);
	});
});
