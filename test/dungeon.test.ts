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
		for (let i = 0; i < 45; i++) {
			const kind = DUNGEON_KINDS[i % 3] ?? 'crypt', size = DUNGEON_SIZES[Math.floor(i / 3) % 3] ?? 'lair';
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
				else expect(a === CORRIDOR || b === CORRIDOR || !(a in d.key) || !(b in d.key)).toBe(true); // or the keep's yard and towers
				steps.add(`${k.x},${k.y}`).add(k.side === 'N' ? `${k.x},${k.y - 1}` : `${k.x - 1},${k.y}`);
			}
			for (const s of d.stamps) for (const [x, y] of stampCells(s)) expect(steps.has(`${x},${y}`)).toBe(false);
			expect(keyEntries(d).some((e) => e.notes.includes('Treasure: '))).toBe(true);
			expect(g.brief).toMatch(/\n\nHook: /);
		}
	});

	it('walls a keep in a yard with a tower on each corner and the gate in the curtain wall', () => {
		for (let i = 0; i < 12; i++) {
			const d = generateDungeon(DUNGEON_SIZES[i % 3] ?? 'lair', 'keep', `k${i}`).decks[0]!;
			const unkeyed = new Set([...d.cells].filter((c) => c >= FIRST_ROOM && !(c in d.key)));
			expect(unkeyed.size).toBe(5);
			expect(d.doors.filter((k) => k.kind === 'arch' && [...unkeyed].includes(cellAt(d, k.x, k.y))).length).toBeGreaterThanOrEqual(2);
			const out = d.doors.filter((k) => cellAt(d, k.x, k.y) === VOID || (k.side === 'N' ? cellAt(d, k.x, k.y - 1) : cellAt(d, k.x - 1, k.y)) === VOID);
			expect(out.map((k) => k.kind)).toEqual(['bars', 'bars']); // a double gate
			expect(cutOffRooms(d).size).toBe(0);
		}
		const crypt = generateDungeon('dungeon', 'crypt', 'k0').decks[0]!;
		expect([...crypt.cells].every((c) => c < FIRST_ROOM || c in crypt.key)).toBe(true);
	});

	it('gives a secret door to some dungeons and not others', () => {
		const secret = Array.from({ length: 30 }, (_, i) => generateDungeon('dungeon', 'crypt', `s${i}`).decks[0]?.doors.some((k) => k.kind === 'secret'));
		expect(secret.filter(Boolean).length).toBeGreaterThan(3);
		expect(secret.filter((x) => !x).length).toBeGreaterThan(3);
	});
});

describe('mines', () => {
	it('end at the lode, with a story of their own', () => {
		for (let i = 0; i < 12; i++) {
			const g = generateDungeon(DUNGEON_SIZES[i % 3] ?? 'lair', 'mine', `m${i}`);
			const names = keyEntries(g.decks[0]!).map((e) => e.name);
			expect(names[0]).toMatch(/^(Mine mouth|Adit)$/);
			expect(names.some((n) => /^(The deep lode|Mother lode)$/.test(n))).toBe(true);
			expect(g.name).toMatch(/Mine$|Dig$|Workings at |Pit$/);
			expect(g.brief).toMatch(/seam|shaft|miners|ore|claim/);
		}
	});
});
