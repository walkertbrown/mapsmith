// Browser demo: runs the real Mapsmith plugin against the test shim over one note, with the block's text shown
// beside the map so you can see the buttons rewrite it.
import { App, installDomHelpers } from '../test/obsidian-shim';
import MapsmithPlugin from '../src/main';

installDomHelpers();

const START = '```mapsmith\nseed: saltmarch\nsize: town\nwater: estuary\nside: east\n```';
const SHIP = '```mapsmith\nmap: ship\nseed: saltmarch\nsize: freighter\nmood: derelict\n```';

type Ctx = { sourcePath: string; addChild: (c: { load(): void }) => void; getSectionInfo: () => { text: string; lineStart: number; lineEnd: number } };
type Proc = (src: string, el: HTMLElement, c: Ctx) => void;

const app = new App();
app.notes.set('Saltmarch.md', { path: 'Saltmarch.md', content: START });
const plugin = new MapsmithPlugin(app as never, { id: 'mapsmith' } as never);
plugin.onload();
const proc = (plugin as never as { codeBlocks: Record<string, Proc> }).codeBlocks.mapsmith!;
const note = () => app.notes.get('Saltmarch.md')!.content;
const ctx: Ctx = {
	sourcePath: 'Saltmarch.md',
	addChild: (c) => c.load(),
	getSectionInfo: () => {
		const lines = note().split('\n');
		const lineStart = lines.findIndex((l) => l.startsWith('```mapsmith'));
		const lineEnd = lines.findIndex((l, i) => i > lineStart && l.startsWith('```'));
		return { text: note(), lineStart, lineEnd };
	},
};

const board = document.querySelector<HTMLElement>('#board')!;
const source = document.querySelector<HTMLTextAreaElement>('#source')!;
const made = document.querySelector<HTMLElement>('#made')!;
const draw = () => {
	const info = ctx.getSectionInfo();
	board.replaceChildren();
	const el = board.createDiv();
	proc(note().split('\n').slice(info.lineStart + 1, info.lineEnd).join('\n'), el, ctx);
	if (document.activeElement !== source) source.value = note();
	const notes = [...app.notes.values()].filter((n) => n.path !== 'Saltmarch.md');
	made.textContent = notes.length ? notes.map((n) => n.path).join('\n') : 'No place notes yet.';
	if (app.active && app.active !== 'Saltmarch.md') made.textContent += `\n\nOpened ${app.active}:\n\n${app.notes.get(app.active)?.content ?? ''}`;
};
app.vault.on('modify', () => draw());
const create = app.vault.create;
app.vault.create = async (p, c) => {
	const f = await create(p, c);
	setTimeout(draw, 0);
	return f;
};
for (const [id, block] of [['try-town', START], ['try-ship', SHIP]] as const) {
	document.querySelector('#' + id)!.addEventListener('click', () => {
		app.notes.get('Saltmarch.md')!.content = block;
		source.value = block;
		draw();
	});
}
source.addEventListener('input', () => {
	app.notes.get('Saltmarch.md')!.content = source.value;
	draw();
});
document.querySelector('#theme')!.addEventListener('click', () => {
	const dark = !document.body.classList.contains('theme-dark');
	document.body.classList.toggle('theme-dark', dark);
	document.documentElement.dataset.theme = dark ? 'dark' : 'light';
	app.workspace.trigger('css-change', null);
});
draw();
