import { describe, expect, it } from 'vitest';
import { editBlock, newSeed, noteName, parseBlock, placeNote, roomNote, setKey } from '../src/block';
import { DEFAULTS, generateTown } from '../src/town';

describe('parseBlock', () => {
	it('reads every key, with the words people are likely to type', () => {
		const { opts, problems } = parseBlock('seed: Saltmarch 7\nsize: Large town\nwater: harbour\nside: E\nwalls: no\nland: grass\nterrain: hilly\nname: Gullhaven\n');
		expect(problems).toEqual([]);
		expect(opts).toEqual({ seed: 'Saltmarch 7', size: 'large-town', water: 'coast', side: 'east', walls: false, land: 'green', terrain: 'hills', name: 'Gullhaven' });
	});
	it('falls back to the defaults and says what it could not use', () => {
		const { opts, problems } = parseBlock('size: huge\ncolour: red\njust words\n\n# a comment');
		expect(opts).toEqual(DEFAULTS);
		expect(problems).toHaveLength(3);
		expect(problems.join(' ')).toContain('hamlet');
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

describe('ship blocks', () => {
	it('reads a ship, with its own sizes', () => {
		const { map, ship, problems } = parseBlock('map: starship\nseed: Wren 7\nsize: Freighter\nmood: wreck\ndeck: 2\n');
		expect(problems).toEqual([]);
		expect(map).toBe('ship');
		expect(ship).toEqual({ seed: 'Wren 7', size: 'freighter', mood: 'derelict', deck: 2 });
	});

	it('says which sizes a ship can be, and leaves towns alone', () => {
		expect(parseBlock('size: corvette\nmap: ship').ship.size).toBe('corvette');
		expect(parseBlock('map: ship\nsize: town').problems).toEqual(['a ship\'s size can be shuttle, corvette, freighter, station']);
		expect(parseBlock('size: corvette').problems).toEqual(['size can be hamlet, village, town, large-town, city']);
		expect(parseBlock('map: ship\ndeck: 0').problems).toEqual(['deck is a number, 1 for the first']);
	});
});

describe('roomNote', () => {
	it('writes the room up with its hazards in bold and a link to the map', () => {
		const r = { num: 4, name: 'Engineering', notes: 'Vacuum. Suit up.\nHazard: the floor is live.\nSalvage: a spare coolant loop.' };
		const text = roomNote('ISV Larkspur', 'Upper deck', r, 'Ships/Larkspur.md');
		expect(text).toContain('# Engineering');
		expect(text).toContain('*Room 4 on the upper deck of ISV Larkspur, on the [[Ships/Larkspur|map]].*');
		expect(text).toContain('**Hazard:** the floor is live.');
		expect(text).toContain('**Salvage:** a spare coolant loop.');
		expect(roomNote('MSV Mistral', undefined, r, 'M.md')).not.toContain('deck');
	});
	it('reads a dungeon block', () => {
		const p = parseBlock('map: dungeon\nseed: Wren 7\nsize: Deep\nkind: castle');
		expect(p.map).toBe('dungeon');
		expect(p.dungeon).toEqual({ seed: 'Wren 7', size: 'deep', kind: 'keep', explore: null });
		expect(p.problems).toEqual([]);
		const bad = parseBlock('map: dungeon\nsize: city\nkind: swamp');
		expect(bad.problems.join(' ')).toContain("a dungeon's size can be lair, dungeon, deep");
		expect(bad.problems.join(' ')).toContain('kind can be crypt or keep');
		expect(roomNote('The Vell Crypt', undefined, { num: 3, name: 'Ossuary', notes: 'Bones.\nTreasure: A cup.' }, 'Maps/Crypt.md', 'dungeon')).toContain('dungeon: "The Vell Crypt"');
		expect(roomNote('The Vell Crypt', undefined, { num: 3, name: 'Ossuary', notes: 'Bones.\nTreasure: A cup.' }, 'Maps/Crypt.md', 'dungeon')).toContain('**Treasure:** A cup.');
	});
});
