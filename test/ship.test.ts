import { describe, expect, it } from 'vitest';
import { generate } from '../src/ship/generate';
import { keyEntries } from '../src/ship/model';
import { renderDeck, SHIP_DARK } from '../src/ship/svg';
import { toString } from '../src/render';
import { shipPainted } from '../src/paint';
import { BAY, GRATE, PLATE } from '../src/textures';

describe('ship decks', () => {
	it('draws the same deck for the same seed, with a clickable number for each room', () => {
		for (const [size, mood, seed] of [['shuttle', 'intact', 11], ['corvette', 'derelict', 3], ['station', 'derelict', 5]] as const) {
			const a = generate(size, mood, seed), b = generate(size, mood, seed);
			expect(a.name).toBe(b.name);
			for (const [i, d] of a.decks.entries()) {
				const other = b.decks[i];
				if (!other) throw new Error('deck missing');
				const svg = toString(renderDeck(d));
				expect(svg).toBe(toString(renderDeck(other)));
				expect(svg).not.toContain('NaN');
				expect(svg.match(/data-place=/g)).toHaveLength(keyEntries(d).length);
				expect(svg.match(/class="mapsmith-ring"[^>]*visibility="hidden"/g)).toHaveLength(keyEntries(d).length);
				expect(toString(renderDeck(d, { palette: SHIP_DARK }))).not.toBe(svg);
			}
		}
	});

	it('tears the hull open on a derelict', () => {
		const d = generate('corvette', 'derelict', 3).decks[0];
		if (!d) throw new Error('deck missing');
		expect(d.breaches.length).toBeGreaterThan(0);
		expect(toString(renderDeck(d))).toContain('opacity="0.8"'); // the shards on the floor
	});
});

describe('painted ships', () => {
	it('puts plate in the rooms, grating in the corridors and stars round the hull, the same each time', () => {
		const d = generate('corvette', 'intact', 3).decks[0];
		if (!d) throw new Error('no deck');
		const svg = toString(renderDeck(d, { palette: shipPainted(false), id: 't' }));
		for (const uri of [PLATE, GRATE, BAY]) expect(svg).toContain(uri);
		expect(svg).toContain('fill="#05070d"');
		expect(svg.match(/<circle/g)?.length ?? 0).toBeGreaterThan(20);
		expect(toString(renderDeck(d, { palette: shipPainted(false), id: 't' }))).toBe(svg);
		expect(toString(renderDeck(d, { palette: shipPainted(true), id: 't' }))).toContain('opacity="0.3"');
	});
});

