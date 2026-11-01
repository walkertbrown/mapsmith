import { describe, expect, it } from 'vitest';
import { parseBlock, regionNote, setKey } from '../src/block';
import { generateRegion, renderRegion, siteBlock } from '../src/region';
import { toString } from '../src/render';
import { townPaint } from '../src/paint';
import { gridPixels, regionUvttData } from '../src/vtt';

const SEEDS = ['saltmarch', 'oakford', 'greyfell', 'dunmere', 'ashwick', 'penlow'];

describe('region maps', () => {
	it('draws the same region from the same seed', () => {
		const a = toString(renderRegion(generateRegion({ seed: 'oakford' })));
		const b = toString(renderRegion(generateRegion({ seed: 'oakford' })));
		expect(a).toBe(b);
		expect(a).not.toBe(toString(renderRegion(generateRegion({ seed: 'greyfell' }))));
	});

	it('numbers its sites from 1, settlements first, with roads between them', () => {
		for (const seed of SEEDS)
			for (const water of ['river', 'coast', 'none'] as const) {
				const R = generateRegion({ seed, water, terrain: 'hills' });
				expect(R.sites.map((s) => s.n)).toEqual(R.sites.map((_, i) => i + 1));
				const towns = R.sites.filter((s) => s.kind === 'settlement');
				expect(towns.length).toBeGreaterThanOrEqual(5);
				expect(R.sites[0]?.kind).toBe('settlement');
				expect(R.roads.length).toBeGreaterThan(0);
				expect(R.river !== null).toBe(water !== 'none');
				if (water !== 'coast') expect(R.sea.length).toBe(0);
			}
	});

	it('gives every site a block that draws without a problem', () => {
		for (const seed of SEEDS) {
			const R = generateRegion({ seed, water: 'coast', side: 'east', terrain: 'mountains', land: 'green' });
			for (const s of R.sites) {
				const p = parseBlock(siteBlock(R, s).join('\n'));
				expect(p.problems).toEqual([]);
				if (s.kind === 'settlement') {
					expect(p.map).toBe('town');
					expect(p.opts.name).toBe(s.name);
					expect(p.opts.size).toBe(s.size);
					expect(p.opts.land).toBe('green');
				} else {
					expect(p.map).toBe('dungeon');
					expect(p.dungeon.kind).toBe(s.kind);
				}
			}
		}
	});

	it('reads its block, with the town keys meaning the country', () => {
		const p = parseBlock('map: country\nseed: oakford\nwater: estuary\nside: west');
		expect(p.map).toBe('region');
		expect(p.problems).toEqual([]);
		expect(p.region).toMatchObject({ seed: 'oakford', water: 'coast', side: 'west', terrain: 'hills' });
		expect(parseBlock('map: region\nwater: inland\nterrain: flat').region).toMatchObject({ water: 'none', terrain: 'flat' });
		expect(parseBlock(setKey('map: region\n', 'seed', 'x')).region.seed).toBe('x');
	});

	it('writes a note for a place with its map in it', () => {
		const R = generateRegion({ seed: 'saltmarch', water: 'coast' });
		const s = R.sites[0]!;
		const note = regionNote(R, s, 'Maps/Region.md');
		expect(note).toContain(`# ${s.name}`);
		expect(note).toContain('[[Maps/Region|map]]');
		expect(note).toContain('```mapsmith\n' + siteBlock(R, s).join('\n') + '\n```');
	});

	it('paints and draws in good time', () => {
		const t0 = performance.now();
		for (const seed of SEEDS) toString(renderRegion(generateRegion({ seed, terrain: 'mountains' }), { paint: townPaint(false) }));
		expect((performance.now() - t0) / SEEDS.length).toBeLessThan(1500);
	});

	it('saves for a virtual tabletop as open country, a square a kilometre, with no numbers', () => {
		const R = generateRegion({ seed: 'oakford' });
		const u = regionUvttData(R, 0);
		expect(u.resolution.map_size).toEqual({ x: 40, y: 40 });
		expect(u.line_of_sight).toEqual([]);
		expect(gridPixels(40, 40)).toBe(70);
		const players = toString(renderRegion(R, { labels: false }));
		expect(players).not.toContain('mapsmith-badge');
		expect(players).toContain(R.sites[0]!.name);
	});
});
