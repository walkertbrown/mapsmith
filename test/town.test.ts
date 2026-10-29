import { describe, expect, it } from 'vitest';
import { generateTown, SIZES, WATERS, type Town } from '../src/town';
import { renderTown, toString, DARK } from '../src/render';
import { contains } from '../src/geom';

const inside = (t: Town, p: { x: number; y: number }) => p.x >= 0 && p.y >= 0 && p.x <= t.w && p.y <= t.h;

describe('generateTown', () => {
	it('draws the same town from the same seed', () => {
		const a = toString(renderTown(generateTown({ seed: 'harbour', size: 'town', water: 'coast' })));
		const b = toString(renderTown(generateTown({ seed: 'harbour', size: 'town', water: 'coast' })));
		expect(a).toBe(b);
		expect(toString(renderTown(generateTown({ seed: 'harbour2', size: 'town', water: 'coast' })))).not.toBe(a);
	});

	for (const size of SIZES)
		for (const water of WATERS)
			it(`makes a ${size} with ${water}`, () => {
				for (const seed of ['a', 'b', 'c']) {
					const t = generateTown({ seed, size, water });
					expect(t.name).toMatch(/^[A-Z][a-z]+$/);
					expect(t.buildings.length).toBeGreaterThanOrEqual(size === 'hamlet' ? 6 : 40);
					expect(t.places.length).toBeGreaterThanOrEqual(3);
					expect(t.places.map((p) => p.n)).toEqual(t.places.map((_, i) => i + 1));
					for (const p of t.places) {
						expect(inside(t, p.at)).toBe(true);
						expect(p.name && p.detail && p.hook).toBeTruthy();
					}
					for (const b of t.buildings) for (const q of b.poly) expect(Number.isFinite(q.x) && Number.isFinite(q.y)).toBe(true);
					if (water === 'river' || water === 'estuary') expect(t.river).not.toBeNull();
					if (water === 'coast' || water === 'estuary' || water === 'lake') expect(t.water.length).toBeGreaterThan(0);
				}
			});

	it('puts no building in the water', () => {
		for (const seed of ['p', 'q', 'r']) {
			const t = generateTown({ seed, size: 'large-town', water: 'coast' });
			const wet = t.buildings.filter((b) => t.water.some((w) => b.poly.every((q) => contains(w, q))));
			expect(wet).toHaveLength(0);
		}
	});

	it('bridges the river when a road crosses it', () => {
		let bridged = 0;
		for (const seed of ['alpha', 'bravo', 'kilo', 'delta', 'echo']) if (generateTown({ seed, size: 'town', water: 'river' }).bridges.length) bridged++;
		expect(bridged).toBeGreaterThanOrEqual(4);
	});

	it('walls a town but not a hamlet, and gates the wall', () => {
		const t = generateTown({ seed: 'gate', size: 'town', water: 'none' });
		expect(t.walls.length).toBeGreaterThan(0);
		expect(t.gates.length).toBeGreaterThan(0);
		expect(generateTown({ seed: 'gate', size: 'town', water: 'none', walls: false }).walls).toHaveLength(0);
		expect(generateTown({ seed: 'gate', size: 'hamlet', water: 'none' }).walls).toHaveLength(0);
	});

	it('uses the name it is given', () => {
		expect(generateTown({ seed: 'x', name: 'Saltmarch' }).name).toBe('Saltmarch');
	});

	it('marks every place on the map so it can be clicked', () => {
		const t = generateTown({ seed: 'click', size: 'city', water: 'river' });
		const svg = toString(renderTown(t, { palette: DARK }));
		for (let i = 0; i < t.places.length; i++) expect(svg).toContain(`data-place="${i}"`);
		expect(svg).not.toMatch(/NaN|undefined/);
	});

	it('names streets and quarters in towns and up, each name once', () => {
		for (const seed of ['alpha', 'kilo', 'delta']) {
			for (const size of ['town', 'large-town', 'city'] as const) {
				const t = generateTown({ seed, size, water: 'river' });
				const streets = t.labels.filter((l) => l.kind === 'street');
				const quarters = t.labels.filter((l) => l.kind === 'quarter');
				expect(streets.length, `${seed} ${size}`).toBeGreaterThanOrEqual(1);
				expect(quarters.length, `${seed} ${size}`).toBeGreaterThanOrEqual(2);
				const words = t.labels.filter((l) => l.kind !== 'exit').map((l) => l.text.toLowerCase());
				expect(new Set(words).size).toBe(words.length);
				for (const l of streets) {
					const line = l.line ?? [];
					expect(line.length).toBeGreaterThan(1);
					// read left to right
					expect((line[line.length - 1] as { x: number }).x).toBeGreaterThanOrEqual((line[0] as { x: number }).x);
				}
				for (const l of t.labels) expect(l.at.x >= 0 && l.at.x <= t.w && l.at.y >= 0 && l.at.y <= t.h).toBe(true);
			}
		}
	});

	it('draws street names along open paths, and leaves them off when asked', () => {
		const t = generateTown({ seed: 'kilo', size: 'city', water: 'river' });
		const svg = toString(renderTown(t));
		expect(svg).toContain('<textPath');
		for (const m of svg.matchAll(/<path id="ms[^"]*" d="([^"]*)"/g)) expect(m[1]).not.toMatch(/Z$/);
		expect(toString(renderTown(t, { names: false }))).not.toContain('<textPath');
	});
});
