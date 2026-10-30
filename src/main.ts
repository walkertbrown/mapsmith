import { App, Editor, MarkdownPostProcessorContext, MarkdownRenderChild, Notice, Plugin, PluginSettingTab, SettingDefinitionItem, TFile, normalizePath, requestUrl } from 'obsidian';
import { DUNGEON_KINDS, DUNGEON_SIZES, generateDungeon } from './dungeon';
import { SHIP_SIZES, editBlock, newSeed, noteName, parseBlock, placeNote, roomNote, setKey, type DungeonOptions, type Key, type ShipOptions } from './block';
import { DARK, LIGHT, renderTown, toDom, toString } from './render';
import { hashSeed } from './rng';
import { generate, type GenResult } from './ship/generate';
import { keyEntries, type Deck, type RoomInfo } from './ship/model';
import { explore, type Explored } from './explore';
import { DUNGEON_DARK, DUNGEON_LIGHT, SHIP_DARK, SHIP_LIGHT, renderDeck, type ShipPalette } from './ship/svg';
import { SIZES, TERRAINS, WATERS, generateTown, type Place, type Town } from './town';
import { gridPixels, svgToPng, uvttData } from './vtt';

const SIZE_TEXT: Record<string, string> = { hamlet: 'Hamlet', village: 'Village', town: 'Town', 'large-town': 'Large town', city: 'City' };
const WATER_TEXT: Record<string, string> = { none: 'No water', river: 'River', coast: 'Coast', estuary: 'River mouth', lake: 'Lake' };
const TERRAIN_TEXT: Record<string, string> = { flat: 'Flat', hills: 'Hills', mountains: 'Mountains' };
const SHIP_TEXT: Record<string, string> = { shuttle: 'Shuttle', corvette: 'Corvette', freighter: 'Freighter', station: 'Station' };
const DUNGEON_TEXT: Record<string, string> = { lair: 'Lair', dungeon: 'Dungeon', deep: 'Deep', crypt: 'Crypt', keep: 'Keep' };

/** Where a VTT key is checked, and mailed again. The only places the plugin goes online. */
export const SERVER = 'https://bulkhead.bananafest-destiny.com';

interface Settings {
	key: string;
	vtt: boolean;
}

export default class MapsmithPlugin extends Plugin {
	settings: Settings = { key: '', vtt: false };
	/** The room just walked into in solo play, so the redrawn map opens on it. */
	entered: { path: string; num: number } | null = null;

	async onload() {
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
		this.addCommand({
			id: 'insert-dungeon',
			name: 'Insert a dungeon map',
			editorCallback: (editor: Editor) => editor.replaceSelection(`\`\`\`mapsmith\nmap: dungeon\nseed: ${newSeed()}\nsize: dungeon\nkind: crypt\n\`\`\`\n`),
		});
		this.settings = Object.assign({ key: '', vtt: false }, (await this.loadData()) as Partial<Settings> | null);
		this.addSettingTab(new MapsmithSettingTab(this.app, this));
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

	/** Opens a place's note, writing it first if it isn't there yet. It sits in a folder named after the town
	 *  or ship, beside the note with the map. */
	async openNote(folder: string, name: string, text: () => string, sourcePath: string) {
		const { vault, workspace } = this.app;
		const at = sourcePath.lastIndexOf('/');
		const dir = normalizePath(`${at < 0 ? '' : sourcePath.slice(0, at + 1)}${folder}`);
		const path = normalizePath(`${dir}/${name}.md`);
		let file = vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			if (!vault.getAbstractFileByPath(dir)) await vault.createFolder(dir);
			file = await vault.create(path, text());
		}
		if (file instanceof TFile) await workspace.getLeaf(true).openFile(file);
	}

	/** Asks the server whether the key in settings is good, turns VTT saving on or off by the answer, and says it in words. */
	async checkKey(): Promise<string> {
		const r = await requestUrl({ url: `${SERVER}/api/mapsmith/key`, method: 'POST', contentType: 'application/json', body: JSON.stringify({ key: this.settings.key }), throw: false }).catch(() => null);
		if (r?.status !== 200) return 'Could not check the key. Check the connection and try again.';
		const got = r.json as { ok?: boolean; sold?: boolean; buy?: string };
		if (got.sold === false) return 'Mapsmith Pro isn\'t sold yet.';
		this.settings.vtt = !!got.ok;
		await this.saveData(this.settings);
		if (got.ok) return 'Good key. Save for virtual tabletop is on in this vault.';
		return `itch doesn't know that key for Mapsmith Pro. Paste the address of your download page, or the key at the end of it.${got.buy ? ` Keys are at ${got.buy}` : ''}`;
	}

	/** Mails the key again to the address that bought it. The server says the same whether or not it did. */
	async mailKey(email: string): Promise<string> {
		const r = await requestUrl({ url: `${SERVER}/api/mapsmith/key/mail`, method: 'POST', contentType: 'application/json', body: JSON.stringify({ email }), throw: false }).catch(() => null);
		return r?.status === 200 ? 'If that address bought Mapsmith Pro, its key is on the way. Look in your mail in a minute.' : 'Could not ask for the key. Check the connection and try again.';
	}

	/** Writes a Universal VTT file next to the note: the players' map, its walls, doors and lights. */
	async saveVtt(deck: Deck, palette: ShipPalette, name: string, sourcePath: string) {
		if (!this.settings.vtt) {
			new Notice('Saving for a virtual tabletop needs a key. Paste yours in Mapsmith\'s settings.');
			return;
		}
		const data = uvttData(deck, 0);
		const { x: w, y: h } = data.resolution.map_size;
		const px = (data.resolution.pixels_per_grid = gridPixels(w, h));
		const svg = renderDeck(deck, { palette, id: 'vtt', players: true });
		svg.a.width = w * px;
		svg.a.height = h * px;
		data.image = await svgToPng(toString(svg), w * px, h * px);
		const at = sourcePath.lastIndexOf('/');
		const path = normalizePath(`${at < 0 ? '' : sourcePath.slice(0, at + 1)}${name.replace(/[\\/:*?"<>|#^[\]]/g, '')}.dd2vtt`);
		const old = this.app.vault.getAbstractFileByPath(path);
		if (old instanceof TFile) await this.app.vault.modify(old, JSON.stringify(data));
		else await this.app.vault.create(path, JSON.stringify(data));
		new Notice(`Saved ${path}. Roll20 imports it as it is; Foundry reads it with the Universal Battlemap Importer module.`);
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
		const { map, opts, ship, dungeon, problems } = parseBlock(this.src);
		if (map === 'ship') {
			this.drawShip(root, ship, problems);
			return;
		}
		if (map === 'dungeon') {
			this.drawDungeon(root, dungeon, problems);
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

		const dark = document.body.hasClass('theme-dark');
		const id = `ms${hashSeed(`${o.seed}:${o.size}:${o.mood}:${at}`).toString(36)}`;
		this.drawPlan(root, s, deck, wreck ? 'What happened here' : 'Who is aboard', dark ? SHIP_DARK : SHIP_LIGHT, id, 'ship');
	}

	drawDungeon(root: HTMLElement, o: DungeonOptions, problems: string[]) {
		const s = generateDungeon(o.size, o.kind, o.seed);
		const deck = s.decks[0];
		if (!deck) return;
		const bar = root.createDiv({ cls: 'mapsmith-bar' });
		for (const [k, list] of [['size', DUNGEON_SIZES], ['kind', DUNGEON_KINDS]] as const) {
			const sel = bar.createEl('select', { cls: 'dropdown' });
			for (const v of list) sel.createEl('option', { text: DUNGEON_TEXT[v] ?? v, value: v });
			sel.value = o[k];
			sel.addEventListener('change', () => this.set(k, sel.value));
		}
		const solo = o.explore !== null;
		const play = bar.createEl('button', { text: 'Explore', cls: 'mapsmith-toggle' });
		play.toggleClass('is-on', solo);
		play.setAttr('aria-label', solo ? 'Show the whole map' : 'Play it alone: every room stays dark until you go in');
		play.addEventListener('click', () => this.set('explore', solo ? 'off' : '1'));
		const again = bar.createEl('button', { text: 'New dungeon', cls: 'mod-cta' });
		again.addEventListener('click', () => this.set('seed', newSeed()));
		if (problems.length) root.createDiv({ cls: 'mapsmith-problem', text: problems.join('. ') + '.' });

		const dark = document.body.hasClass('theme-dark');
		const pal = dark ? DUNGEON_DARK : DUNGEON_LIGHT;
		const id = `ms${hashSeed(`${o.seed}:${o.size}:${o.kind}`).toString(36)}`;
		// a keep stands in the open, so only a crypt gets rock round it
		const fog = o.explore ? explore(deck, o.explore) : undefined;
		const enter = (num: number) => this.set('explore', [...(o.explore ?? []), num].sort((a, b) => a - b).join(', '));
		this.drawPlan(root, s, deck, 'What happened here', o.kind === 'crypt' ? pal : { ...pal, rock: undefined }, id, 'dungeon', fog && { fog, enter });
	}

	// The part a ship and a dungeon share: the name, the story, the map, the card and the key.
	drawPlan(root: HTMLElement, s: GenResult, deck: Deck, summary: string, palette: ShipPalette, id: string, what: 'ship' | 'dungeon', solo?: { fog: Explored; enter: (num: number) => void }) {
		root.createDiv({ cls: 'mapsmith-title', text: s.decks.length > 1 ? `${s.name}, ${deck.name.toLowerCase()}` : s.name });
		const rooms = keyEntries(deck);
		if (solo) {
			const came = this.plugin.entered;
			if (came?.path === this.ctx.sourcePath) {
				this.picked = rooms.findIndex((r) => r.num === came.num);
				this.plugin.entered = null;
			}
			const left = solo.fog.ways.length ? ' Click a question mark to go through that door.' : solo.fog.rooms.size < rooms.length ? ' No open door leads on. The rest is behind secret doors.' : '';
			root.createDiv({ cls: 'mapsmith-hint', text: `${solo.fog.rooms.size} of ${rooms.length} rooms explored.${left}` });
		}
		const story = root.createEl('details', { cls: 'mapsmith-story' });
		story.createEl('summary', { text: summary });
		for (const para of s.brief.split('\n\n')) story.createEl('p', { text: para });

		const frame = root.createDiv({ cls: 'mapsmith-map' });
		const svg = toDom(renderDeck(deck, { palette, id, fog: solo?.fog }), frame);
		const card = root.createDiv({ cls: 'mapsmith-card' });
		const key = root.createEl('ol', { cls: 'mapsmith-key' });
		const items = rooms.map((r) => {
			const li = key.createEl('li');
			li.createSpan({ cls: 'mapsmith-key-name', text: r.name });
			if (solo && !solo.fog.rooms.has(r.id)) li.hide();
			return li;
		});
		if (solo)
			svg.addEventListener('click', (ev) => {
				const way = (ev.target as Element | null)?.closest('[data-enter]');
				if (!way) return;
				const num = Number(way.getAttribute('data-enter'));
				// the room you walk into is the one shown once the note draws the map again
				this.plugin.entered = { path: this.ctx.sourcePath, num };
				solo.enter(num);
			});
		const ship = s.name.replace(/^Derelict — /, '');
		const deckName = s.decks.length > 1 ? deck.name : undefined;
		const vtt = root.createDiv({ cls: 'mapsmith-tools' }).createEl('button', { text: 'Save for virtual tabletop' });
		vtt.addEventListener('click', () => {
			vtt.disabled = true;
			this.plugin
				.saveVtt(deck, palette, deckName ? `${ship} ${deckName}` : ship, this.ctx.sourcePath)
				.catch((e: unknown) => new Notice(`Could not save the VTT file: ${e instanceof Error ? e.message : String(e)}`))
				.finally(() => (vtt.disabled = false));
		});
		this.pickable(svg, items, (i) => this.drawRoom(card, i < 0 ? undefined : rooms[i], ship, deckName, what));
	}

	drawRoom(card: HTMLElement, r: RoomInfo | undefined, ship: string, deck: string | undefined, what: 'ship' | 'dungeon' = 'ship') {
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
			const m = /^(Hazard|Salvage|Treasure|Way in|Hook): (.*)$/.exec(line);
			const div = card.createDiv({ cls: m ? 'mapsmith-card-hook' : '' });
			if (m) {
				div.createSpan({ cls: 'mapsmith-card-tag', text: m[1] as string });
				div.appendText(m[2] as string);
			} else div.setText(line);
		}
		const open = card.createEl('button', { text: 'Open its note' });
		const folder = deck ? `${ship}/${deck}` : ship;
		open.addEventListener('click', () => void this.plugin.openNote(folder, noteName({ name: `${r.num} ${r.name}`, n: r.num }), () => roomNote(ship, deck, r, this.ctx.sourcePath, what), this.ctx.sourcePath));
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
		open.addEventListener('click', () => void this.plugin.openNote(t.name, noteName(p), () => placeNote(t, p, this.ctx.sourcePath), this.ctx.sourcePath));
	}
}

class MapsmithSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: MapsmithPlugin) {
		super(app, plugin);
	}
	getSettingDefinitions(): SettingDefinitionItem[] {
		const p = this.plugin;
		return [
			{
				name: 'Pro key',
				desc: 'The address of your itch download page for Mapsmith Pro, or the key at the end of it. It turns on Save for virtual tabletop under each ship and dungeon. Check asks this plugin\'s server once, and saving stays on after that, offline too. The key is kept in this vault\'s plugin folder.',
				render: (setting) => {
					const said = setting.descEl.createDiv({ cls: 'mapsmith-said' });
					setting
						.addText((t) =>
							t.setPlaceholder('Download page address or key').setValue(p.settings.key).onChange(async (v) => {
								p.settings.key = v.trim();
								await p.saveData(p.settings);
							}),
						)
						.addButton((b) => b.setButtonText('Check').onClick(async () => said.setText(await p.checkKey())));
				},
			},
			{
				name: 'Lost your key?',
				desc: 'Type the email you bought Mapsmith Pro with, and its key is mailed there.',
				render: (setting) => {
					let email = '';
					const said = setting.descEl.createDiv({ cls: 'mapsmith-said' });
					setting
						.addText((t) => t.setPlaceholder('you@example.com').onChange((v) => (email = v.trim())))
						.addButton((b) => b.setButtonText('Mail my key').onClick(async () => said.setText(await p.mailKey(email))));
				},
			},
		];
	}
}
