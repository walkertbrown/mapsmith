import { describe, expect, it } from 'vitest';
import { DUNGEON_KINDS, DUNGEON_SIZES, generateDungeon } from '../src/dungeon';
import { CORRIDOR, FIRST_ROOM, VOID, cellAt, cutOffRooms, keyEntries, stampCells } from '../src/ship/model';
import { DUNGEON_DARK, DUNGEON_LIGHT, renderDeck } from '../src/ship/svg';
import { toString } from '../src/render';

const ROOMS = { lair: [4, 6], dungeon: [8, 10], deep: [13, 16] };

describe('dungeons', () => {
	it('draws the same dungeon for the same seed, with a clickable number for each room', () => {
		for (const kind of DUNGEON_KINDS)
			for (const size of DUNGEON_SIZES) {
				const a = generateDungeon(size, kind, 'saltmarch'), b = generateDungeon(size, kind, 'saltmarch');
				const d = a.decks[0], e = b.decks[0];
				if (!d || !e) throw new Error('level missing');
				expect(a.name).toBe(b.name);
				expect(a.brief).toBe(b.brief);
				const svg = toString(renderDeck(d, { palette: DUNGEON_LIGHT }));
				expect(svg).toBe(toString(renderDeck(e, { palette: DUNGEON_LIGHT })));
				expect(svg).not.toContain('NaN');
				expect(svg).toContain('-rock)'); // hatching round the floors
				expect(svg.match(/data-place=/g)).toHaveLength(keyEntries(d).length);
				expect(toString(renderDeck(d, { palette: DUNGEON_DARK }))).not.toBe(svg);
				const [lo, hi] = ROOMS[size] as [number, number];
				expect(keyEntries(d).length).toBeGreaterThanOrEqual(lo);
				expect(keyEntries(d).length).toBeLessThanOrEqual(hi);
			}
	});

	it('can walk to every room, never parks a fitting in a doorway, and keeps the best for last', () => {
		for (let i = 0; i < 40; i++) {
			const kind = DUNGEON_KINDS[i % 2] ?? 'crypt', size = DUNGEON_SIZES[i % 3] ?? 'lair';
			const g = generateDungeon(size, kind, `seed ${i}`);
			const d = g.decks[0];
			if (!d) throw new Error('level missing');
			expect(cutOffRooms(d).size).toBe(0);
			const steps = new Set<string>();
			for (const k of d.doors) {
				const a = cellAt(d, k.x, k.y), b = k.side === 'N' ? cellAt(d, k.x, k.y - 1) : cellAt(d, k.x - 1, k.y);
				expect(a !== b).toBe(true);
				expect(a >= FIRST_ROOM || b >= FIRST_ROOM).toBe(true);
				if (a === VOID || b === VOID) expect(k.kind).toBe('bars'); // only the keep's gate opens on the outside
				else expect(a === CORRIDOR || b === CORRIDOR).toBe(true);
				steps.add(`${k.x},${k.y}`).add(k.side === 'N' ? `${k.x},${k.y - 1}` : `${k.x - 1},${k.y}`);
			}
			for (const s of d.stamps) for (const [x, y] of stampCells(s)) expect(steps.has(`${x},${y}`)).toBe(false);
			expect(keyEntries(d).some((e) => e.notes.includes('Treasure: '))).toBe(true);
			expect(g.brief).toMatch(/\n\nHook: /);
		}
	});

	it('gives a secret door to some dungeons and not others', () => {
		const secret = Array.from({ length: 30 }, (_, i) => generateDungeon('dungeon', 'crypt', `s${i}`).decks[0]?.doors.some((k) => k.kind === 'secret'));
		expect(secret.filter(Boolean).length).toBeGreaterThan(3);
		expect(secret.filter((x) => !x).length).toBeGreaterThan(3);
	});
});
