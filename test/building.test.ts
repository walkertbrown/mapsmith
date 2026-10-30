import { describe, expect, it } from 'vitest';
import { BUILDING_KINDS, CELLAR, GROUND, UPPER, buildingFor, generateBuilding } from '../src/building';
import { parseBlock, placeNote } from '../src/block';
import { boarding, explore } from '../src/explore';
import { cellAt, keyEntries, stampCells, type Deck } from '../src/ship/model';
import { generateTown } from '../src/town';

// walk in through every door there is, the way solo play does, and see how many rooms that reaches
function reached(d: Deck, from: [number, number][]) {
	const nums: number[] = [];
	for (;;) {
		const e = explore(d, nums, from);
		const next = e.ways.map((w) => w.num).filter((n) => !nums.includes(n));
		if (!next.length) return e.rooms.size;
		nums.push(...next);
	}
}

describe('the inside of a building', () => {
	for (const kind of BUILDING_KINDS)
		for (const seed of ['salt', 'wren', 'a', 'b', 'c'])
			it(`${kind} ${seed}: every room has a way in, and fittings sit on the floor`, () => {
				const g = generateBuilding(kind, seed);
				expect(g, 'the same seed draws the same building').toEqual(generateBuilding(kind, seed));
				expect(g.decks.length).toBe(['temple', 'bathhouse', 'theatre'].includes(kind) ? 1 : ['inn', 'tavern'].includes(kind) ? 3 : 2);
				const nums = g.decks.flatMap((d) => keyEntries(d).map((e) => e.num));
				expect(nums).toEqual(nums.map((_, i) => i + 1));
				g.decks.forEach((d, i) => {
					expect(reached(d, i ? boarding(d) : [])).toBe(keyEntries(d).length);
					for (const st of d.stamps) for (const [x, y] of stampCells(st)) expect(cellAt(d, x, y)).toBeGreaterThan(0);
					expect(d.doors.some((k) => k.kind === (d.name === CELLAR ? 'bars' : 'window'))).toBe(true);
				});
				if (g.decks.length > 1) {
					const [a, b] = g.decks.map((d) => d.stamps.find((st) => st.kind === 'stairs' && st.link)!);
					expect([a!.x, a!.y, a!.link, b!.link]).toEqual([b!.x, b!.y, UPPER, GROUND]);
				}
				if (g.decks.length === 3) {
					// down a ladder from the store room into the cellar, on the same square
					const [a, c] = [g.decks[0]!, g.decks[2]!].map((d) => d.stamps.find((st) => st.kind === 'ladder' && st.link)!);
					expect([a!.x, a!.y, a!.link, c!.link]).toEqual([c!.x, c!.y, CELLAR, GROUND]);
					expect(g.decks[0]!.key[cellAt(g.decks[0]!, a!.x, a!.y)]!.name).toMatch(/Store room|Pantry/);
					expect(keyEntries(g.decks[2]!).map((e) => e.name).sort()).toEqual(['Cellar', 'Old cellar', 'Wine cellar']);
				}
				expect(g.brief).toMatch(/Hook: /);
			});

	it('keeps the name and keeper it is given', () => {
		const g = generateBuilding('inn', 'x', 'The Drowned Goose', 'Agna Cobb, who never sits down');
		expect(g.name).toBe('The Drowned Goose');
		expect(g.brief).toContain('Agna Cobb');
		expect(g.decks.flatMap((d) => Object.values(d.key)).some((k) => k.notes.includes('Agna Cobb sleeps here'))).toBe(true);
	});

	it('reads a building block, and says what it could not use', () => {
		const p = parseBlock('map: building\nkind: pub\nseed: s\ndeck: 2\nname: The Eel\nkeeper: Hob Penn');
		expect(p.map).toBe('building');
		expect(p.building).toMatchObject({ kind: 'tavern', seed: 's', floor: 2, name: 'The Eel', keeper: 'Hob Penn' });
		expect(p.problems).toEqual([]);
		expect(parseBlock('map: building\nkind: crypt\nsize: deep').problems).toEqual(["a building's kind can be inn, tavern, shop, smithy, temple, guild, bathhouse, library, barracks, stables, theatre, mill", "a building's size comes from its kind"]);
		expect(parseBlock('map: dungeon\nkind: keep').dungeon.kind).toBe('keep');
	});

	it("puts the inside into a place's note when it has one", () => {
		const t = generateTown({ seed: 'note', size: 'town' });
		const inn = t.places.find((p) => buildingFor(p.kind))!;
		const text = placeNote(t, inn, 'Towns/Map.md');
		const block = /```mapsmith\n([^`]*)```/.exec(text)![1]!;
		expect(parseBlock(block)).toMatchObject({ map: 'building', problems: [], building: { kind: buildingFor(inn.kind), name: inn.name, seed: `${t.opts.seed}-${inn.n}` } });
		const other = t.places.find((p) => p.kind === 'market' || p.kind === 'harbour')!;
		expect(placeNote(t, other, 'Towns/Map.md')).not.toContain('```mapsmith');
	});

	it("gives a town's keep the dungeon keep, under the keep's own name", () => {
		const t = ['a', 'b', 'c', 'd', 'e'].map((seed) => generateTown({ seed, size: 'city' })).find((x) => x.places.some((p) => p.kind === 'keep'))!;
		const keep = t.places.find((p) => p.kind === 'keep')!;
		const block = /```mapsmith\n([^`]*)```/.exec(placeNote(t, keep, 'Towns/Map.md'))![1]!;
		expect(parseBlock(block)).toMatchObject({ map: 'dungeon', problems: [], dungeon: { kind: 'keep', size: 'lair', name: keep.name } });
	});

	it("puts a crypt under a town's temple, and nowhere else", () => {
		const t = ['a', 'b', 'c', 'd', 'e'].map((seed) => generateTown({ seed, size: 'town' })).find((x) => x.places.some((p) => p.kind === 'temple'))!;
		const temple = t.places.find((p) => p.kind === 'temple')!;
		const blocks = [...placeNote(t, temple, 'Towns/Map.md').matchAll(/```mapsmith\n([^`]*)```/g)].map((m) => parseBlock(m[1]!));
		expect(blocks.map((b) => b.map)).toEqual(['building', 'dungeon']);
		expect(blocks[1]).toMatchObject({ problems: [], dungeon: { kind: 'crypt', size: 'lair' } });
		expect(blocks[1]!.dungeon.name).toMatch(/^The crypt under [a-zA-Z]/);
		for (const p of t.places.filter((x) => x.kind !== 'temple')) expect(placeNote(t, p, 'Towns/Map.md')).not.toContain('## Below');
	});
});
