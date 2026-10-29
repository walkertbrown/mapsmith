// The `mapsmith` code block: `key: value` lines in, town options out, and back again when a button
// changes one of them. Kept apart from main.ts so it can be tested without Obsidian.

import type { Mood, ShipSize } from './ship/generate';
import type { RoomInfo } from './ship/model';
import { DEFAULTS, LANDS, SIDES, SIZES, TERRAINS, WATERS, type Land, type Side, type Terrain, type Size, type Town, type TownOptions, type Water, type Place } from './town';

export const KEYS = ['map', 'seed', 'size', 'water', 'side', 'walls', 'land', 'terrain', 'name', 'mood', 'deck'] as const;
export type Key = (typeof KEYS)[number];

export const MAPS = ['town', 'ship'] as const;
export type MapKind = (typeof MAPS)[number];
export const SHIP_SIZES: ShipSize[] = ['shuttle', 'corvette', 'freighter', 'station'];
export const MOODS: Mood[] = ['intact', 'derelict'];

export interface ShipOptions {
	seed: string;
	size: ShipSize;
	mood: Mood;
	deck: number; // counted from 1, as the deck list shows it
}

const ALIAS: Record<string, string> = {
	spaceship: 'ship',
	starship: 'ship',
	wreck: 'derelict',
	wrecked: 'derelict',
	abandoned: 'derelict',
	'large town': 'large-town',
	largetown: 'large-town',
	sea: 'coast',
	harbour: 'coast',
	harbor: 'coast',
	port: 'coast',
	mouth: 'estuary',
	no: 'none',
	n: 'north',
	s: 'south',
	e: 'east',
	w: 'west',
	grass: 'green',
	grassy: 'green',
	paper: 'parchment',
	hill: 'hills',
	hilly: 'hills',
	mountain: 'mountains',
	mountainous: 'mountains',
	plain: 'flat',
	plains: 'flat',
};

const clean = (v: string) => {
	const s = v.trim().toLowerCase();
	return ALIAS[s] ?? s;
};

export interface Parsed {
	map: MapKind;
	opts: TownOptions;
	ship: ShipOptions;
	problems: string[]; // lines that said something we could not use, in words for the reader
}

export function parseBlock(src: string): Parsed {
	const opts: TownOptions = { ...DEFAULTS };
	const ship: ShipOptions = { seed: DEFAULTS.seed, size: 'corvette', mood: 'intact', deck: 1 };
	const problems: string[] = [];
	let map: MapKind = 'town';
	let size = ''; // a town's sizes and a ship's differ, so it waits until the map is known
	for (const raw of src.split('\n')) {
		const line = raw.trim();
		if (!line || line.startsWith('#') || line.startsWith('//')) continue;
		const m = /^([a-z]+)\s*[:=]\s*(.*)$/i.exec(line);
		if (!m) {
			problems.push(`"${line}" isn't a key: value line`);
			continue;
		}
		const key = (m[1] as string).toLowerCase(), val = (m[2] as string).trim();
		if (key === 'map') {
			const v = clean(val);
			if ((MAPS as readonly string[]).includes(v)) map = v as MapKind;
			else problems.push(`map can be ${MAPS.join(' or ')}`);
		} else if (key === 'seed') opts.seed = ship.seed = val || DEFAULTS.seed;
		else if (key === 'name') opts.name = val || undefined;
		else if (key === 'size') size = clean(val);
		else if (key === 'mood') {
			const v = clean(val);
			if ((MOODS as string[]).includes(v)) ship.mood = v as Mood;
			else problems.push(`mood can be ${MOODS.join(' or ')}`);
		} else if (key === 'deck') {
			const n = Number(val);
			if (Number.isInteger(n) && n >= 1) ship.deck = n;
			else problems.push('deck is a number, 1 for the first');
		} else if (key === 'water') {
			const v = clean(val);
			if ((WATERS as string[]).includes(v)) opts.water = v as Water;
			else problems.push(`water can be ${WATERS.join(', ')}`);
		} else if (key === 'side') {
			const v = clean(val);
			if ((SIDES as string[]).includes(v)) opts.side = v as Side;
			else problems.push(`side can be ${SIDES.join(', ')}`);
		} else if (key === 'walls') {
			const v = clean(val);
			if (['yes', 'true', 'on', 'y'].includes(v)) opts.walls = true;
			else if (['none', 'false', 'off'].includes(v)) opts.walls = false;
			else problems.push('walls can be yes or no');
		} else if (key === 'land') {
			const v = clean(val);
			if ((LANDS as string[]).includes(v)) opts.land = v as Land;
			else problems.push(`land can be ${LANDS.join(' or ')}`);
		} else if (key === 'terrain') {
			const v = clean(val);
			if ((TERRAINS as string[]).includes(v)) opts.terrain = v as Terrain;
			else if (v === 'none') opts.terrain = 'flat';
			else problems.push(`terrain can be ${TERRAINS.join(', ')}`);
		} else problems.push(`no key "${key}"; try ${KEYS.join(', ')}`);
	}
	if (size && map === 'ship') {
		if ((SHIP_SIZES as string[]).includes(size)) ship.size = size as ShipSize;
		else problems.push(`a ship's size can be ${SHIP_SIZES.join(', ')}`);
	} else if (size) {
		if ((SIZES as string[]).includes(size)) opts.size = size as Size;
		else problems.push(`size can be ${SIZES.join(', ')}`);
	}
	return { map, opts, ship, problems };
}

// The block's body with `key` set to `value`: the first line for that key is rewritten, or a line is added.
export function setKey(src: string, key: Key, value: string): string {
	const lines = src.replace(/\n$/, '').split('\n');
	const re = new RegExp(`^\\s*${key}\\s*[:=]`, 'i');
	const i = lines.findIndex((l) => re.test(l));
	const line = `${key}: ${value}`;
	if (i >= 0) lines[i] = line;
	else if (lines.length === 1 && lines[0] === '') lines[0] = line;
	else lines.push(line);
	return lines.join('\n') + '\n';
}

// Replace the body between a block's fences, given the note and the fence lines. Null when the lines no longer
// hold a mapsmith block (the note changed since it was drawn).
export function editBlock(note: string, lineStart: number, lineEnd: number, edit: (body: string) => string): string | null {
	const lines = note.split('\n');
	if (!/^\s*(`{3,}|~{3,})\s*mapsmith\b/.test(lines[lineStart] ?? '') || lineEnd <= lineStart) return null;
	const body = lines.slice(lineStart + 1, lineEnd).join('\n');
	const next = edit(body + '\n').replace(/\n$/, '');
	return [...lines.slice(0, lineStart + 1), ...next.split('\n'), ...lines.slice(lineEnd)].join('\n');
}

// A seed people can read back and type again.
const SYL = ['ash', 'bel', 'cor', 'dun', 'el', 'fen', 'gar', 'hol', 'is', 'jor', 'kel', 'lom', 'mar', 'nor', 'ost', 'pel', 'quin', 'ros', 'sel', 'tam', 'ul', 'ver', 'wen', 'yar'];
export function newSeed(rand: () => number = Math.random): string {
	const s = () => SYL[Math.floor(rand() * SYL.length)] as string;
	return `${s()}${s()}-${Math.floor(rand() * 900 + 100)}`;
}

// The note a place gets when it's clicked: what the map says about it, ready to write on.
export function placeNote(t: Town, p: Place, mapNote: string): string {
	const link = mapNote.replace(/\.md$/, '');
	return [
		'---',
		`town: "${t.name}"`,
		`place: ${p.n}`,
		`kind: ${p.label.toLowerCase()}`,
		...(p.keeper ? [`keeper: "${p.keeper}"`] : []),
		'---',
		`# ${p.name}`,
		'',
		`*${p.label} in ${t.name}, number ${p.n} on the [[${link}|map]].*`,
		'',
		...(p.keeper ? [`**Kept by** ${p.keeper}.`, ''] : []),
		p.detail,
		'',
		'## Hook',
		'',
		p.hook,
		'',
		'## Notes',
		'',
		'',
	].join('\n');
}

// A ship room's note: the deck it's on, what the card said, with its hazards and salvage in bold.
export function roomNote(ship: string, deck: string | undefined, r: RoomInfo, mapNote: string): string {
	const link = mapNote.replace(/\.md$/, '');
	return [
		'---',
		`ship: "${ship}"`,
		...(deck ? [`deck: "${deck}"`] : []),
		`room: ${r.num}`,
		'---',
		`# ${r.name}`,
		'',
		`*Room ${r.num}${deck ? ` on the ${deck.toLowerCase()}` : ''} of ${ship}, on the [[${link}|map]].*`,
		'',
		...r.notes
			.split('\n')
			.filter(Boolean)
			.flatMap((l) => [l.replace(/^(Hazard|Salvage|Way in|Hook): /, '**$1:** '), '']),
		'## Notes',
		'',
		'',
	].join('\n');
}

export const noteName = (p: Pick<Place, 'name' | 'n'>) => p.name.replace(/[\\/:*?"<>|#^[\]]/g, '').trim() || `Place ${p.n}`;
