import { Editor, MarkdownPostProcessorContext, MarkdownRenderChild, Notice, Plugin, TFile, normalizePath } from 'obsidian';
import { editBlock, newSeed, noteName, parseBlock, placeNote, setKey, type Key } from './block';
import { DARK, LIGHT, renderTown, toDom } from './render';
import { SIZES, WATERS, generateTown, type Place, type Town } from './town';

const SIZE_TEXT: Record<string, string> = { hamlet: 'Hamlet', village: 'Village', town: 'Town', 'large-town': 'Large town', city: 'City' };
const WATER_TEXT: Record<string, string> = { none: 'No water', river: 'River', coast: 'Coast', estuary: 'River mouth', lake: 'Lake' };

export default class MapsmithPlugin extends Plugin {
	onload() {
		this.registerMarkdownCodeBlockProcessor('mapsmith', (src, el, ctx) => {
			ctx.addChild(new TownMap(this, el, ctx, src));
		});
		this.addCommand({
			id: 'insert-town',
			name: 'Insert a town map',
			editorCallback: (editor: Editor) => editor.replaceSelection(`\`\`\`mapsmith\nseed: ${newSeed()}\nsize: town\nwater: river\n\`\`\`\n`),
		});
	}

	/** Rewrites the block's body. False when the block can't be found where it was drawn. */
	async edit(el: HTMLElement, ctx: MarkdownPostProcessorContext, edit: (body: string) => string): Promise<boolean> {
		const info = ctx.getSectionInfo(el);
		const file = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
		if (!info || !(file instanceof TFile)) return false;
		let ok = false;
		await this.app.vault.process(file, (data) => {
			const out = editBlock(data, info.lineStart, info.lineEnd, edit);
			if (out === null) return data;
			ok = true;
			return out;
		});
		return ok;
	}

	/** Opens the place's note, writing it first if it isn't there yet. It sits in a folder named after the town,
	 *  beside the note with the map. */
	async openPlace(t: Town, p: Place, sourcePath: string) {
		const { vault, workspace } = this.app;
		const at = sourcePath.lastIndexOf('/');
		const dir = normalizePath(`${at < 0 ? '' : sourcePath.slice(0, at + 1)}${t.name}`);
		const path = normalizePath(`${dir}/${noteName(p)}.md`);
		let file = vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			if (!vault.getAbstractFileByPath(dir)) await vault.createFolder(dir);
			file = await vault.create(path, placeNote(t, p, sourcePath));
		}
		if (file instanceof TFile) await workspace.getLeaf(true).openFile(file);
	}
}

class TownMap extends MarkdownRenderChild {
	town: Town | null = null;
	picked = -1;

	constructor(
		readonly plugin: MapsmithPlugin,
		el: HTMLElement,
		readonly ctx: MarkdownPostProcessorContext,
		readonly src: string,
	) {
		super(el);
	}

	onload() {
		this.draw();
		// light and dark themes get their own ink
		this.registerEvent(this.plugin.app.workspace.on('css-change', () => this.draw()));
	}

	set(key: Key, value: string) {
		void this.plugin.edit(this.containerEl, this.ctx, (body) => setKey(body, key, value)).then((ok) => {
			if (!ok) new Notice('Mapsmith could not find this block in the note. Edit it by hand.');
		});
	}

	draw() {
		const root = this.containerEl;
		root.empty();
		root.addClass('mapsmith');
		const { opts, problems } = parseBlock(this.src);
		const t = generateTown(opts);
		this.town = t;

		const bar = root.createDiv({ cls: 'mapsmith-bar' });
		const size = bar.createEl('select', { cls: 'dropdown' });
		for (const s of SIZES) size.createEl('option', { text: SIZE_TEXT[s], value: s });
		size.value = opts.size;
		size.addEventListener('change', () => this.set('size', size.value));
		const water = bar.createEl('select', { cls: 'dropdown' });
		for (const w of WATERS) water.createEl('option', { text: WATER_TEXT[w], value: w });
		water.value = opts.water;
		water.addEventListener('change', () => this.set('water', water.value));
		const walls = bar.createEl('button', { text: opts.walls ? 'Walls' : 'No walls', cls: 'mapsmith-toggle' });
		walls.toggleClass('is-on', opts.walls);
		walls.addEventListener('click', () => this.set('walls', opts.walls ? 'no' : 'yes'));
		const green = opts.land === 'green';
		const land = bar.createEl('button', { text: green ? 'Green' : 'Parchment', cls: 'mapsmith-toggle' });
		land.toggleClass('is-on', green);
		land.setAttr('aria-label', 'How the country around the town is painted');
		land.addEventListener('click', () => this.set('land', green ? 'parchment' : 'green'));
		const again = bar.createEl('button', { text: 'New town', cls: 'mod-cta' });
		again.addEventListener('click', () => this.set('seed', newSeed()));
		if (problems.length) root.createDiv({ cls: 'mapsmith-problem', text: problems.join('. ') + '.' });

		const dark = document.body.hasClass('theme-dark');
		const frame = root.createDiv({ cls: 'mapsmith-map' });
		const svg = toDom(renderTown(t, { palette: dark ? DARK : LIGHT }), frame);
		const card = root.createDiv({ cls: 'mapsmith-card' });
		const key = root.createEl('ol', { cls: 'mapsmith-key' });
		const items = t.places.map((p, i) => {
			const li = key.createEl('li');
			li.createSpan({ cls: 'mapsmith-key-name', text: p.name });
			li.createSpan({ cls: 'mapsmith-key-label', text: p.label });
			li.addEventListener('click', () => pick(i));
			return li;
		});

		const pick = (i: number) => {
			this.picked = i;
			svg.querySelectorAll('.is-picked').forEach((e) => e.removeClass('is-picked'));
			svg.querySelectorAll(`[data-place="${i}"]`).forEach((e) => e.addClass('is-picked'));
			items.forEach((li, k) => li.toggleClass('is-picked', k === i));
			this.drawCard(card, t, t.places[i]);
		};
		svg.addEventListener('click', (ev) => {
			const hit = (ev.target as Element | null)?.closest('[data-place]');
			if (hit) pick(Number(hit.getAttribute('data-place')));
		});
		if (this.picked >= 0 && this.picked < t.places.length) pick(this.picked);
		else this.drawCard(card, t, undefined);
	}

	drawCard(card: HTMLElement, t: Town, p: Place | undefined) {
		card.empty();
		if (!p) {
			card.createDiv({ cls: 'mapsmith-hint', text: `Click a number or a building with one to see who's there.` });
			return;
		}
		const head = card.createDiv({ cls: 'mapsmith-card-head' });
		head.createSpan({ cls: 'mapsmith-card-n', text: String(p.n) });
		head.createSpan({ cls: 'mapsmith-card-name', text: p.name });
		card.createDiv({ cls: 'mapsmith-card-sub', text: p.keeper ? `${p.label}, kept by ${p.keeper}` : p.label });
		card.createDiv({ text: p.detail });
		const hook = card.createDiv({ cls: 'mapsmith-card-hook' });
		hook.createSpan({ cls: 'mapsmith-card-tag', text: 'Hook' });
		hook.appendText(p.hook);
		const open = card.createEl('button', { text: 'Open its note' });
		open.addEventListener('click', () => void this.plugin.openPlace(t, p, this.ctx.sourcePath));
	}
}
