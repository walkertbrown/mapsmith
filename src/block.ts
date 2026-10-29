// The `mapsmith` code block: `key: value` lines in, town options out, and back again when a button
// changes one of them. Kept apart from main.ts so it can be tested without Obsidian.

import { DEFAULTS, LANDS, SIDES, SIZES, WATERS, type Land, type Side, type Size, type Town, type TownOptions, type Water, type Place } from './town';

export const KEYS = ['seed', 'size', 'water', 'side', 'walls', 'land', 'name'] as const;
export type Key = (typeof KEYS)[number];

const ALIAS: Record<string, string> = {
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
};

const clean = (v: string) => {
	const s = v.trim().toLowerCase();
	return ALIAS[s] ?? s;
};

export interface Parsed {
	opts: TownOptions;
	problems: string[]; // lines that said something we could not use, in words for the reader
}

export function parseBlock(src: string): Parsed {
	const opts: TownOptions = { ...DEFAULTS };
	const problems: string[] = [];
	for (const raw of src.split('\n')) {
		const line = raw.trim();
		if (!line || line.startsWith('#') || line.startsWith('//')) continue;
		const m = /^([a-z]+)\s*[:=]\s*(.*)$/i.exec(line);
		if (!m) {
			problems.push(`"${line}" isn't a key: value line`);
			continue;
		}
		const key = (m[1] as string).toLowerCase(), val = (m[2] as string).trim();
		if (key === 'seed') opts.seed = val || DEFAULTS.seed;
		else if (key === 'name') opts.name = val || undefined;
		else if (key === 'size') {
			const v = clean(val);
			if ((SIZES as string[]).includes(v)) opts.size = v as Size;
			else problems.push(`size can be ${SIZES.join(', ')}`);
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
		} else problems.push(`no key "${key}"; try ${KEYS.join(', ')}`);
	}
	return { opts, problems };
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

export const noteName = (p: Place) => p.name.replace(/[\\/:*?"<>|#^[\]]/g, '').trim() || `Place ${p.n}`;
