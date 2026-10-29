import { describe, expect, it } from 'vitest';
import { editBlock, newSeed, noteName, parseBlock, placeNote, setKey } from '../src/block';
import { DEFAULTS, generateTown } from '../src/town';

describe('parseBlock', () => {
	it('reads every key, with the words people are likely to type', () => {
		const { opts, problems } = parseBlock('seed: Saltmarch 7\nsize: Large town\nwater: harbour\nside: E\nwalls: no\nland: grass\nname: Gullhaven\n');
		expect(problems).toEqual([]);
		expect(opts).toEqual({ seed: 'Saltmarch 7', size: 'large-town', water: 'coast', side: 'east', walls: false, land: 'green', name: 'Gullhaven' });
	});
	it('falls back to the defaults and says what it could not use', () => {
		const { opts, problems } = parseBlock('size: huge\ncolour: red\njust words\n\n# a comment');
		expect(opts).toEqual(DEFAULTS);
		expect(problems).toHaveLength(3);
		expect(problems[0]).toContain('hamlet');
	});
});

describe('setKey and editBlock', () => {
	it('rewrites a key in place or adds it', () => {
		expect(setKey('seed: a\nsize: town\n', 'size', 'city')).toBe('seed: a\nsize: city\n');
		expect(setKey('seed: a\n', 'water', 'lake')).toBe('seed: a\nwater: lake\n');
		expect(setKey('', 'seed', 'b')).toBe('seed: b\n');
	});
	it('edits only the block it was drawn from', () => {
		const note = '# Map\n\n```mapsmith\nseed: a\n```\n\nafter';
		expect(editBlock(note, 2, 4, (b) => setKey(b, 'seed', 'z'))).toBe('# Map\n\n```mapsmith\nseed: z\n```\n\nafter');
		expect(editBlock(note, 1, 4, (b) => b)).toBeNull();
	});
});

describe('notes', () => {
	it('makes readable seeds', () => {
		expect(newSeed(() => 0)).toBe('ashash-100');
		expect(newSeed()).toMatch(/^[a-z]+-\d{3}$/);
	});
	it('writes a note for a place with its keeper and hook, linked to the map', () => {
		const t = generateTown({ seed: 'note' });
		const p = t.places[1]!;
		const text = placeNote(t, p, 'Towns/Map.md');
		expect(text).toContain(`# ${p.name}`);
		expect(text).toContain(p.keeper);
		expect(text).toContain(p.hook);
		expect(text).toContain('[[Towns/Map|map]]');
		expect(noteName({ ...p, name: 'The "Red" Fox: Inn' })).toBe('The Red Fox Inn');
	});
});
