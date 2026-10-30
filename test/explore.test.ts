import { describe, expect, it } from 'vitest';
import { parseBlock, setKey } from '../src/block';
import { generateDungeon } from '../src/dungeon';
import { explore, onEntering, parseExplored } from '../src/explore';
import { keyEntries } from '../src/ship/model';
import { renderDeck } from '../src/ship/svg';
import { toString } from '../src/render';

const deckOf = (seed: string, kind: 'crypt' | 'keep' = 'crypt') => generateDungeon('dungeon', kind, seed).decks[0]!;

describe('solo play', () => {
	it('starts in room 1 with only its doors leading on', () => {
		for (const seed of ['a', 'b', 'c', 'd']) {
			const d = deckOf(seed);
			const rooms = keyEntries(d);
			const e = explore(d, [1]);
			expect([...e.rooms]).toEqual([rooms[0]!.id]);
			expect(e.ways.length).toBeGreaterThan(0);
			expect(e.ways.every((w) => w.num !== 1)).toBe(true);
			// every seen square of a room is room 1's
			const seenRooms = new Set<number>();
			e.seen.forEach((v, i) => { if (v && (d.cells[i] as number) in d.key) seenRooms.add(d.cells[i] as number); });
			expect([...seenRooms]).toEqual([rooms[0]!.id]);
		}
	});

	it('reaches every room through open doors', () => {
		for (const kind of ['crypt', 'keep'] as const)
			for (const seed of ['one', 'two', 'three', 'four', 'five', 'six']) {
				const d = deckOf(seed, kind);
				let been = [1];
				for (let step = 0; step < 100; step++) {
					const e = explore(d, been);
					if (!e.ways.length) break;
					been = [...been, e.ways[0]!.num];
				}
				const all = explore(d, been);
				expect(all.rooms.size).toBe(keyEntries(d).length);
			}
	});

	it('draws dark over what is not seen, a mark at each way in, and no number on a dark room', () => {
		const d = deckOf('a');
		const e = explore(d, [1]);
		const svg = toString(renderDeck(d, { id: 't', fog: e }));
		expect(svg).toContain('mask="url(#t-fog)"');
		expect(svg.match(/data-enter=/g)?.length).toBe(e.ways.length);
		expect(svg.match(/data-place=/g)?.length).toBe(1);
		expect(toString(renderDeck(d, { id: 't' })).match(/data-place=/g)?.length).toBe(keyEntries(d).length);
	});

	it('reads and writes the explore line', () => {
		expect(parseExplored('1, 4,  2 4')).toEqual([1, 2, 4]);
		expect(parseExplored('off')).toBeNull();
		expect(parseBlock('map: dungeon\nseed: x').dungeon.explore).toBeNull();
		const body = setKey('map: dungeon\nseed: x\n', 'explore', '1, 3');
		expect(parseBlock(body).dungeon.explore).toEqual([1, 3]);
		expect(parseBlock(body).problems).toEqual([]);
	});

	it('rolls the same thing every time for a room, from lists of its own for each kind', () => {
		expect(onEntering('a', 'crypt', 'dungeon', 3)).toBe(onEntering('a', 'crypt', 'dungeon', 3));
		const seen = (kind: 'crypt' | 'keep') => new Set(Array.from({ length: 200 }, (_, i) => onEntering(`s${i}`, kind, 'deep', 2)));
		const crypt = seen('crypt'), keep = seen('keep');
		expect(crypt.size).toBeGreaterThan(20);
		expect(keep.size).toBeGreaterThan(20);
		for (const t of [...crypt, ...keep]) expect(t).toMatch(/^[A-Z][^#]*\.$/);
		// a deep dungeon's foes come two or more at a time
		expect([...crypt].some((t) => /^(Two|Three|Four|Five|Six) /.test(t))).toBe(true);
		expect([...crypt].some((t) => /^A skeleton climbs/.test(t))).toBe(false);
	});
});
