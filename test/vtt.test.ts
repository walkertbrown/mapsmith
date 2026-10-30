import { describe, expect, it } from 'vitest';
import { generateDungeon } from '../src/dungeon';
import { toString } from '../src/render';
import { generate } from '../src/ship/generate';
import { renderDeck } from '../src/ship/svg';
import { generateTown, SIZES } from '../src/town';
import { gridPixels, townUvttData, uvttData } from '../src/vtt';

describe('Universal VTT', () => {
	it('gives every door but an arch a portal, and walls a secret door up', () => {
		let secrets = 0;
		for (const seed of ['saltmarch', 'wren', 'a', 'b', 'c', 'd', 'e', 'f']) {
			for (const kind of ['crypt', 'keep'] as const) {
				const d = generateDungeon('dungeon', kind, seed).decks[0];
				if (!d) throw new Error('no deck');
				const u = uvttData(d, 70);
				const count = (k: string) => d.doors.filter((x) => x.kind === k).length;
				secrets += count('secret');
				expect(u.portals).toHaveLength(d.doors.length - count('arch') - count('secret'));
				expect(u.portals.filter((p) => !p.closed)).toHaveLength(count('bars'));
				const { x: w, y: h } = u.resolution.map_size;
				for (const p of [...u.line_of_sight.flat(), ...u.portals.flatMap((p) => p.bounds)]) {
					expect(p.x).toBeGreaterThanOrEqual(0);
					expect(p.y).toBeGreaterThanOrEqual(0);
					expect(p.x).toBeLessThanOrEqual(w);
					expect(p.y).toBeLessThanOrEqual(h);
				}
				for (const p of u.portals) expect(Math.hypot(p.bounds[1]!.x - p.bounds[0]!.x, p.bounds[1]!.y - p.bounds[0]!.y)).toBe(1);
				expect(u.lights).toHaveLength(d.stamps.filter((s) => s.kind === 'brazier').length + d.lights.length);
				// the players' picture: no numbers, and no S to give a secret door away
				const svg = toString(renderDeck(d, { players: true }));
				expect(svg).not.toContain('data-place');
				expect(svg).not.toContain('>S<');
				expect(JSON.parse(JSON.stringify(u))).toEqual(u);
			}
		}
		expect(secrets).toBeGreaterThan(0);
	});

	it('keeps a ship deck\'s airlocks as doors and its lights', () => {
		const d = generate('corvette', 'intact', 3).decks[0];
		if (!d) throw new Error('no deck');
		const u = uvttData(d, 70);
		expect(u.portals).toHaveLength(d.doors.length);
		expect(u.lights.length).toBe(d.lights.length);
		expect(u.lights.every((l) => /^ff[0-9a-f]{6}$/.test(l.color))).toBe(true);
	});

	it('shrinks the squares on a big map so a phone can draw it', () => {
		expect(gridPixels(40, 30)).toBe(70);
		expect(gridPixels(100, 80) * 100 * gridPixels(100, 80) * 80).toBeLessThanOrEqual(16e6);
	});

	it('walls in every building of a town, with a door in each gate and into the keep', () => {
		for (const size of SIZES) {
			for (const seed of ['salt', 'wren']) {
				const t = generateTown({ seed, size, walls: true });
				const u = townUvttData(t, 0);
				const { x: w, y: h } = u.resolution.map_size;
				const px = gridPixels(w, h);
				expect(w * px * h * px).toBeLessThanOrEqual(16.1e6);
				expect(u.line_of_sight.length).toBeGreaterThanOrEqual(t.buildings.length);
				const keeps = t.walls.length - (t.gates.length ? 1 : 0);
				if (t.walls.length) expect(u.portals.length).toBeGreaterThanOrEqual(t.gates.length);
				expect(u.portals.length).toBeLessThanOrEqual(t.gates.length + Math.max(0, keeps));
				for (const p of [...u.line_of_sight.flat(), ...u.portals.flatMap((p) => p.bounds)]) {
					expect(p.x).toBeGreaterThanOrEqual(0);
					expect(p.y).toBeGreaterThanOrEqual(0);
					expect(p.x).toBeLessThanOrEqual(w);
					expect(p.y).toBeLessThanOrEqual(h);
				}
				// a gate is the road and a metre either side; a keep's door is up to four metres
				for (const p of u.portals) expect(Math.hypot(p.bounds[1]!.x - p.bounds[0]!.x, p.bounds[1]!.y - p.bounds[0]!.y)).toBeGreaterThan(0.2);
			}
		}
	});
});
