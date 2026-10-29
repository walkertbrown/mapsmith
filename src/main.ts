import { Editor, MarkdownPostProcessorContext, MarkdownRenderChild, Notice, Plugin, TFile, normalizePath } from 'obsidian';
import { SHIP_SIZES, editBlock, newSeed, noteName, parseBlock, placeNote, setKey, type Key, type ShipOptions } from './block';
import { DARK, LIGHT, renderTown, toDom } from './render';
import { hashSeed } from './rng';
import { generate } from './ship/generate';
import { keyEntries, type RoomInfo } from './ship/model';
import { SHIP_DARK, SHIP_LIGHT, renderDeck } from './ship/svg';
import { SIZES, TERRAINS, WATERS, generateTown, type Place, type Town } from './town';

const SIZE_TEXT: Record<string, string> = { hamlet: 'Hamlet', village: 'Village', town: 'Town', 'large-town': 'Large town', city: 'City' };
const WATER_TEXT: Record<string, string> = { none: 'No water', river: 'River', coast: 'Coast', estuary: 'River mouth', lake: 'Lake' };
const TERRAIN_TEXT: Record<string, string> = { flat: 'Flat', hills: 'Hills', mountains: 'Mountains' };
const SHIP_TEXT: Record<string, string> = { shuttle: 'Shuttle', corvette: 'Corvette', freighter: 'Freighter', station: 'Station' };

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
		this.addCommand({
			id: 'insert-ship',
			name: 'Insert a ship map',
			editorCallback: (editor: Editor) => editor.replaceSelection(`\`\`\`mapsmith\nmap: ship\nseed: ${newSeed()}\nsize: corvette\nmood: derelict\n\`\`\`\n`),
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
		const { map, opts, ship, problems } = parseBlock(this.src);
		if (map === 'ship') {
			this.drawShip(root, ship, problems);
			return;
		}
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
		const terrain = bar.createEl('select', { cls: 'dropdown' });
		for (const k of TERRAINS) terrain.createEl('option', { text: TERRAIN_TEXT[k], value: k });
		terrain.value = opts.terrain;
		terrain.addEventListener('change', () => this.set('terrain', terrain.value));
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
		const items = t.places.map((p) => {
			const li = key.createEl('li');
			li.createSpan({ cls: 'mapsmith-key-name', text: p.name });
			li.createSpan({ cls: 'mapsmith-key-label', text: p.label });
			return li;
		});
		this.pickable(svg, items, (i) => this.drawCard(card, t, i < 0 ? undefined : t.places[i]));
	}

	/** Clicking a number on the map or a line of the key picks that place; the pick lasts through a redraw. */
	pickable(svg: SVGElement, items: HTMLElement[], show: (i: number) => void) {
		const pick = (i: number) => {
			this.picked = i;
			svg.querySelectorAll('.is-picked').forEach((e) => e.removeClass('is-picked'));
			svg.querySelectorAll(`[data-place="${i}"]`).forEach((e) => e.addClass('is-picked'));
			items.forEach((li, k) => li.toggleClass('is-picked', k === i));
			show(i);
		};
		items.forEach((li, i) => li.addEventListener('click', () => pick(i)));
		svg.addEventListener('click', (ev) => {
			const hit = (ev.target as Element | null)?.closest('[data-place]');
			if (hit) pick(Number(hit.getAttribute('data-place')));
		});
		if (this.picked >= 0 && this.picked < items.length) pick(this.picked);
		else show(-1);
	}

	drawShip(root: HTMLElement, o: ShipOptions, problems: string[]) {
		const s = generate(o.size, o.mood, hashSeed(o.seed));
		const at = Math.min(o.deck, s.decks.length) - 1;
		const deck = s.decks[at];
		if (!deck) return;

		const bar = root.createDiv({ cls: 'mapsmith-bar' });
		const size = bar.createEl('select', { cls: 'dropdown' });
		for (const k of SHIP_SIZES) size.createEl('option', { text: SHIP_TEXT[k], value: k });
		size.value = o.size;
		size.addEventListener('change', () => this.set('size', size.value));
		if (s.decks.length > 1) {
			const decks = bar.createEl('select', { cls: 'dropdown' });
			s.decks.forEach((d, i) => decks.createEl('option', { text: d.name, value: String(i + 1) }));
			decks.value = String(at + 1);
			decks.addEventListener('change', () => this.set('deck', decks.value));
		}
		const wreck = o.mood === 'derelict';
		const mood = bar.createEl('button', { text: wreck ? 'Derelict' : 'Intact', cls: 'mapsmith-toggle' });
		mood.toggleClass('is-on', wreck);
		mood.addEventListener('click', () => this.set('mood', wreck ? 'intact' : 'derelict'));
		const again = bar.createEl('button', { text: 'New ship', cls: 'mod-cta' });
		again.addEventListener('click', () => this.set('seed', newSeed()));
		if (problems.length) root.createDiv({ cls: 'mapsmith-problem', text: problems.join('. ') + '.' });

		root.createDiv({ cls: 'mapsmith-title', text: s.decks.length > 1 ? `${s.name}, ${deck.name.toLowerCase()}` : s.name });
		const story = root.createEl('details', { cls: 'mapsmith-story' });
		story.createEl('summary', { text: wreck ? 'What happened here' : 'Who is aboard' });
		for (const para of s.brief.split('\n\n')) story.createEl('p', { text: para });

		const dark = document.body.hasClass('theme-dark');
		const frame = root.createDiv({ cls: 'mapsmith-map' });
		const id = `ms${hashSeed(`${o.seed}:${o.size}:${o.mood}:${at}`).toString(36)}`;
		const svg = toDom(renderDeck(deck, { palette: dark ? SHIP_DARK : SHIP_LIGHT, id }), frame);
		const card = root.createDiv({ cls: 'mapsmith-card' });
		const key = root.createEl('ol', { cls: 'mapsmith-key' });
		const rooms = keyEntries(deck);
		const items = rooms.map((r) => {
			const li = key.createEl('li');
			li.createSpan({ cls: 'mapsmith-key-name', text: r.name });
			return li;
		});
		this.pickable(svg, items, (i) => this.drawRoom(card, i < 0 ? undefined : rooms[i]));
	}

	drawRoom(card: HTMLElement, r: RoomInfo | undefined) {
		card.empty();
		if (!r) {
			card.createDiv({ cls: 'mapsmith-hint', text: 'Click a number to see what is in that room.' });
			return;
		}
		const head = card.createDiv({ cls: 'mapsmith-card-head' });
		head.createSpan({ cls: 'mapsmith-card-n', text: String(r.num) });
		head.createSpan({ cls: 'mapsmith-card-name', text: r.name });
		for (const line of r.notes.split('\n').filter(Boolean)) {
			// "Hazard: ..." and the like get the same tag as a town's hook
			const m = /^(Hazard|Salvage|Way in|Hook): (.*)$/.exec(line);
			const div = card.createDiv({ cls: m ? 'mapsmith-card-hook' : '' });
			if (m) {
				div.createSpan({ cls: 'mapsmith-card-tag', text: m[1] as string });
				div.appendText(m[2] as string);
			} else div.setText(line);
		}
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
