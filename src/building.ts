// The inside of a town's buildings, on the ship's grid like a dungeon, so the plan, the key, solo play and the
// tabletop file all carry over. A building is a box cut into bands of rooms, from the street at the front (south)
// to the back; upstairs is a landing with rooms either side, reached by stairs in the front room's corner.
// All words are Mapsmith's own.

import { fitter, type Fit } from './dungeon';
import { person, sign, type PlaceKind } from './names';
import { chance, int, makeRng, pick, shuffle, type Rng } from './rng';
import type { GenResult } from './ship/generate';
import { CORRIDOR, FIRST_ROOM, canonicalEdge, cellAt, idx, newDeck, type Deck, type DoorKind, type Side } from './ship/model';

export type BuildingKind = 'inn' | 'tavern' | 'shop' | 'smithy' | 'temple';
export const BUILDING_KINDS: BuildingKind[] = ['inn', 'tavern', 'shop', 'smithy', 'temple'];

const FOR: Partial<Record<PlaceKind, BuildingKind>> = {
	inn: 'inn', tavern: 'tavern', smithy: 'smithy', temple: 'temple', shrine: 'temple',
	general: 'shop', apothecary: 'shop', tailor: 'shop', jeweller: 'shop', herbalist: 'shop', moneylender: 'shop',
};
/** The inside a place on a town map has, when Mapsmith can draw one. */
export const buildingFor = (k: PlaceKind): BuildingKind | undefined => FOR[k];

const O = 8; // where the building starts on the grid
export const GROUND = 'Ground floor', UPPER = 'Upper floor';

interface Role {
	names: [string, ...string[]];
	tint: number;
	/** the door into it, when it isn't a plain one */
	door?: DoorKind;
	say: string[];
	fit: (f: Fit) => void;
}

// tables down the room, a chair either side of each
const tables = (f: Fit) => {
	for (let y = 1; y < f.h - 1; y += 2) for (let x = 2; x < f.w - 2; x += 3) if (f.put('table', x, y)) { f.put('chair', x - 1, y); f.put('chair', x + 1, y); }
};

const ROLES: Record<string, Role> = {
	common: {
		names: ['Common room'], tint: 5,
		say: ['Long tables, a fire at one end, and a cat asleep on the warmest bench.', 'Low beams hung with hops. The talk stops for a moment when the door opens.', 'Prices chalked on a board by the fire, and a fiddler in the corner who knows four songs.'],
		fit: (f) => { f.mid('brazier', f.head); f.ends('barrel', f.head); tables(f); },
	},
	taproom: {
		names: ['Taproom'], tint: 5,
		say: ['A long counter, casks behind it, and sawdust on the floor.', 'Smoke, noise and the smell of spilt ale. Everyone here knows everyone.', 'A dartboard, a dog under every table, and a landlord who sees everything.'],
		fit: (f) => { f.mid('bench', f.head); f.ends('barrel', f.head); tables(f); },
	},
	kitchen: {
		names: ['Kitchen'], tint: 4,
		say: ['A spit over the fire and a pot that is never empty.', 'Flour on every surface, and bread rising under a cloth.', 'Hams hang from the beams. The cook does not like visitors.'],
		fit: (f) => { f.mid('brazier', f.head); f.centre('table'); f.scatter('barrel', 2); },
	},
	store: {
		names: ['Store room', 'Pantry'], tint: 6,
		say: ['Casks, sacks and a trapdoor down to the cellar.', 'Shelves of jars, a side of bacon, and a trapdoor with a heavy ring.', 'Everything the house needs for a month, and a trapdoor to the cellar under it.'],
		fit: (f) => { f.along('barrel', f.head); f.scatter('trapdoor', 1); f.scatter('chest', 1); },
	},
	snug: {
		names: ['Snug', 'Back parlour'], tint: 1,
		say: ['One table and a door that shuts, for talk that should not carry.', 'Panelled walls, a good fire, and a bolt on the inside of the door.', 'Where the regulars play cards, and where strangers are not asked in.'],
		fit: (f) => { f.mid('brazier', f.head); f.centre('table'); f.scatter('chair', 3); },
	},
	shop: {
		names: ['Shop'], tint: 5,
		say: ['Shelves to the ceiling, a counter, and a bell over the door.', 'Goods hang from every beam. The keeper knows where each one is.', 'A narrow shop, swept clean, with the scales on the counter where buyers can see them.'],
		fit: (f) => { f.along('bookcase', f.head); f.centre('bench'); f.scatter('chest', 1); f.scatter('barrel', 1); },
	},
	work: {
		names: ['Workroom', 'Back room'], tint: 4,
		say: ['A bench under the window and tools hung in order on the wall.', 'Half-made stock on every surface and a lamp that burns late.', 'Where the real work is done, out of sight of the buyers.'],
		fit: (f) => { f.centre('table'); f.along('rack', f.head, 3); f.scatter('chair', 1); },
	},
	forge: {
		names: ['Forge'], tint: 3, door: 'arch',
		say: ['The fire, the anvil, and a trough of black water to quench in.', 'Open to the street, hot as summer all year, and loud.', 'Horseshoes on nails by the hundred, and a half-made gate on the floor.'],
		fit: (f) => { f.mid('brazier', f.head); f.centre('table'); f.ends('rack', f.head); f.scatter('barrel', 1); },
	},
	coal: {
		names: ['Coal store', 'Fuel store'], tint: 6,
		say: ['Charcoal heaped to the roof. Everything in here is black.', 'Coal, iron bar and old scrap, sorted in heaps.'],
		fit: (f) => { f.scatter('rubble', 3); f.scatter('barrel', 1); },
	},
	porch: {
		names: ['Porch'], tint: 0,
		say: ['A bench for beggars and a box for alms, nailed down.', 'Notices of births, deaths and banns pinned by the door.', 'A stone basin of water for the faithful to wet their hands.'],
		fit: (f) => { f.ends('statue', f.head); },
	},
	nave: {
		names: ['Nave'], tint: 5,
		say: ['Rows of benches, and light from high windows falling across them.', 'Pillars of old stone, and every footstep echoes.', 'Painted walls, faded, showing the god at work in the world.'],
		fit: (f) => {
			f.pillars();
			// benches either side of an aisle down the middle
			const aisle = f.w >> 1;
			for (let y = 2; y < f.h - 1; y += 2) { f.put('bench', aisle - 4, y); f.put('bench', aisle + 1 + (f.w % 2 ? 1 : 0), y); }
		},
	},
	sanctuary: {
		names: ['Sanctuary'], tint: 1, door: 'arch',
		say: ['The altar, a lamp that never goes out, and a rail no one crosses but the priests.', 'Gold on the altar and candles round it. A priest is always near.', 'The holiest part of the house, and the coldest.'],
		fit: (f) => { f.mid('altar', f.head); f.ends('brazier', f.head); },
	},
	vestry: {
		names: ['Vestry', 'Robing room'], tint: 4,
		say: ['Robes on pegs, plate in a locked press, and the register of the dead.', 'A table covered in candle ends and a ledger of gifts.', 'Where the priests dress, and where they talk when the doors are shut.'],
		fit: (f) => { f.mid('bookcase', f.head); f.scatter('chest', 1); f.scatter('rack', 1); },
	},
	keeper: {
		names: ["Keeper's room"], tint: 7,
		say: ['A good bed, a strongbox under it, and the takings counted on the table.', 'Plain and tidy, with a window over the street.', 'The only room with a lock that works.'],
		fit: (f) => { f.mid('bed', f.head); f.scatter('chest', 1); f.scatter('table', 1); },
	},
	best: {
		names: ['Best room'], tint: 5,
		say: ['A wide bed, a fire laid ready, and the price to match.', 'Hangings on the bed and glass in the window.'],
		fit: (f) => { f.mid('bed', f.head); f.scatter('brazier', 1); f.scatter('table', 1); f.scatter('chest', 1); },
	},
	guest: {
		names: ['Corner room', 'Small room', 'Long room', 'Room over the yard', 'Room under the eaves', 'Green room', 'Blue room', 'Back room'], tint: 1,
		say: [],
		fit: (f) => { f.mid('bed', f.head); f.scatter('chest', 1); },
	},
	parlour: {
		names: ['Parlour'], tint: 7,
		say: ['A table for meals, two good chairs, and the family linen in a press.', 'The room the family lives in, warm and crowded.'],
		fit: (f) => { f.centre('table'); f.scatter('chair', 2); f.mid('bookcase', f.head); },
	},
	bedroom: {
		names: ['Bedroom', 'Back bedroom', 'Small bedroom', 'End bedroom'], tint: 1,
		say: ['A bed, a chest and a window onto the street.', 'Clothes on every hook and a bed that creaks.', 'Swept and bare, the bed made up for whoever comes next.'],
		fit: (f) => { f.mid('bed', f.head); f.scatter('chest', 1); },
	},
};

interface Plan {
	w: [number, number];
	/** the bands from the street to the back: how deep, and what is in them, west to east */
	bands: { d: [number, number]; rooms: string[] }[];
	/** upstairs: the rooms it must have, and what fills the rest; none for one floor */
	upper?: { must: string[]; fill: string };
	known: string[];
	hooks: string[];
}

const PLANS: Record<BuildingKind, Plan> = {
	inn: {
		w: [12, 15], bands: [{ d: [5, 6], rooms: ['common'] }, { d: [4, 5], rooms: ['kitchen', 'store', 'snug'] }],
		upper: { must: ['keeper', 'best'], fill: 'guest' },
		known: ['Travellers stop here because it is the last good bed before the road gets hard.', 'It has stood here longer than the town wall, and it has the crooked floors to prove it.', 'The beer is thin and the beds are clean, which is the right way round for an inn.'],
		hooks: ['A guest left in the night without paying and without their luggage, and the luggage is ticking.', 'Somebody is asking every new guest the same question, and paying well for the answer.', 'The keeper wants the cellar cleared of whatever has been drinking the wine.', 'Two guests booked the same room under the same name.'],
	},
	tavern: {
		w: [10, 12], bands: [{ d: [5, 6], rooms: ['taproom'] }, { d: [4, 4], rooms: ['kitchen', 'store', 'snug'] }],
		upper: { must: ['keeper'], fill: 'bedroom' },
		known: ['Locals drink here, and strangers get looked at.', 'The cheapest ale in town and the loudest arguments.', 'Half the deals in town are made at its back table.'],
		hooks: ['A dice game in the snug has gone on for three days and the stakes keep climbing.', 'The keeper pays someone off every week, and the someone is getting greedy.', 'A brawl last night left a man dead, and nobody saw a thing.', 'A song about the council is going round, and the council wants the singer.'],
	},
	shop: {
		w: [8, 10], bands: [{ d: [4, 5], rooms: ['shop'] }, { d: [3, 4], rooms: ['work', 'store'] }],
		upper: { must: ['parlour'], fill: 'bedroom' },
		known: ['Goods to the ceiling, and a keeper who knows where every one of them is.', 'The family has run it for three generations; the sign was painted again for each.', 'Fair prices and honest scales, mostly.'],
		hooks: ['A delivery came that nobody ordered, and someone wants it back badly.', 'The keeper is selling up and leaving town, fast.', 'Stock goes missing every night from a locked store.', 'A buyer paid in coins from a city that burned forty years ago.'],
	},
	smithy: {
		w: [10, 12], bands: [{ d: [5, 6], rooms: ['forge'] }, { d: [3, 4], rooms: ['coal', 'store'] }],
		upper: { must: ['parlour'], fill: 'bedroom' },
		known: ['The hammer starts at dawn and the whole street hears it.', 'Horseshoes, hinges and ploughs, and a blade now and then for those who ask quietly.', 'The forge has not gone out in twenty years, and the smith means to keep it that way.'],
		hooks: ['A sword came in for mending with a crest on it that should not be in this town.', 'Someone wants keys made from wax prints, and the smith does not like it.', 'An apprentice has run off with the best hammer and a debt.', 'Someone wants a cage made, big enough for a person.'],
	},
	temple: {
		w: [10, 12], bands: [{ d: [2, 3], rooms: ['porch'] }, { d: [7, 9], rooms: ['nave'] }, { d: [4, 5], rooms: ['vestry', 'sanctuary', 'store'] }],
		known: ['Its bells mark the hours for the whole town.', 'Old stone, older than anything round it, and cold in every season.', 'The priests feed whoever comes to the side door at dusk.'],
		hooks: ['A relic has gone from the sanctuary, and a copy has been put in its place.', 'Someone leaves offerings at night to a god this temple does not serve.', 'The crypt under the floor has been sealed for years, and now there are sounds in it.', 'A priest has not said a word since the last funeral.'],
	},
};

const GUESTS = [
	'a wool trader, asleep with a knife under the pillow',
	'a pilgrim on the way to somewhere holy, who prays loudly',
	'a soldier on leave, spending all of it',
	'a pair of newlyweds who do not look happy',
	'a pedlar with a pack bigger than they are',
	'a scholar with a box of books and no money',
	'a courier who sleeps in their boots',
	'a widow travelling alone, armed',
];
const HIDDEN = [
	'A loose board with a purse under it.',
	'A ledger that does not match the one out front.',
	'Letters tied with a ribbon, never meant to be found.',
	'A small locked box, and its key on a nail behind the door.',
	'A spyhole into the next room, at eye height.',
	'A map of the town with three houses marked on it.',
	'Coins sewn into the hem of a curtain.',
];

function buildingName(r: Rng, kind: BuildingKind): string {
	const fam = person(r).split(' ')[1] as string;
	if (kind === 'inn' || kind === 'tavern') return sign(r);
	if (kind === 'shop') return `${fam}'s`;
	if (kind === 'smithy') return `${fam}'s Forge`;
	return pick(r, ['Temple of the Dawn', 'Temple of the Harvest', 'Temple of the Hearth', 'Temple of the Tide', 'Temple of the Lamp']);
}

// widths of n rooms across `total` squares, each at least three
function split(r: Rng, total: number, n: number): number[] {
	const w = Array.from({ length: n }, () => 3);
	for (let left = total - 3 * n; left > 0; left--) {
		const i = int(r, 0, n - 1);
		w[i] = (w[i] as number) + 1;
	}
	return w;
}

interface Box { id: number; x: number; y: number; w: number; h: number; role: string }

export function generateBuilding(kind: BuildingKind, seed: string, name?: string, keeper?: string): GenResult {
	const r = makeRng(`${seed}:building:${kind}`);
	const P = PLANS[kind];
	const W = int(r, ...P.w);
	const depth = P.bands.map((b) => int(r, ...b.d));
	const H = depth.reduce((a, b) => a + b, 0);
	const who = keeper ?? person(r);
	const title = name ?? buildingName(r, kind);
	const x0 = O, y0 = O, front = y0 + H - 1;
	// the row upstairs that is the landing, and where the stairs come up: the front room's back corner
	const hy = y0 + H - (depth[0] as number);
	const decks: Deck[] = [];
	const used = new Set<string>();
	let num = 1;
	const hidden = shuffle(r, [...HIDDEN]), guests = shuffle(r, [...GUESTS]);
	const secretAt = int(r, 1, 3); // which room, counting from the second, has something hidden

	const finish = (d: Deck, boxes: Box[], doors: { x: number; y: number; side: Side; kind: DoorKind }[], windows: [number, number, Side][]) => {
		for (const b of boxes) {
			for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) d.cells[idx(b.x + x, b.y + y)] = b.id;
			d.tints[b.id] = (ROLES[b.role] as Role).tint;
		}
		for (const k of doors) d.doors.push({ ...canonicalEdge(k.x, k.y, k.side), kind: k.kind });
		const taken = new Set<number>(), near = new Set<number>();
		for (const st of d.stamps) taken.add(idx(st.x, st.y));
		for (const k of d.doors) {
			near.add(idx(k.x, k.y));
			near.add(k.side === 'N' ? idx(k.x, k.y - 1) : idx(k.x - 1, k.y));
		}
		for (const b of boxes) {
			const role = ROLES[b.role] as Role;
			const sides = new Set<Side>();
			for (const k of d.doors) {
				if (cellAt(d, k.x, k.y) === b.id) sides.add(k.side);
				if (cellAt(d, k.side === 'N' ? k.x : k.x - 1, k.side === 'N' ? k.y - 1 : k.y) === b.id) sides.add(k.side === 'N' ? 'S' : 'E');
			}
			const free = (['N', 'E', 'W', 'S'] as Side[]).filter((s) => !sides.has(s));
			role.fit(fitter(d, b, r, taken, near, free.length ? (free[0] as Side) : 'N'));
			const nm = role.names.find((x) => !used.has(x)) ?? role.names[0];
			used.add(nm);
			const notes: string[] = [];
			if (b.role === 'guest') notes.push(chance(r, 0.3) ? 'Empty tonight, and aired.' : `Taken by ${person(r)}, ${guests.pop() ?? pick(r, GUESTS)}.`);
			else notes.push(pick(r, role.say));
			if (b.role === 'keeper') notes.push(`${who.split(',')[0] as string} sleeps here.`); // a town's keeper comes with a few words about them
			if (b.role === 'vestry' && !d.stamps.some((st) => st.kind === 'stairs')) {
				fitter(d, b, r, taken, near, 'N').scatter('stairs', 1);
				notes.push('Stairs go down to the crypt under the temple.');
			}
			if (num === secretAt + 1 && hidden.length) notes.push(`Hidden: ${hidden.pop()}`);
			d.key[b.id] = { num: num++, name: nm, notes: notes.join('\n') };
		}
		// windows last, so a bed can stand under one
		for (const [x, y, side] of windows) d.doors.push({ ...canonicalEdge(x, y, side), kind: 'window' });
		d.nextRoom = FIRST_ROOM + boxes.length;
		decks.push(d);
	};

	// the ground floor, band by band from the street back
	{
		const d = newDeck(P.upper ? GROUND : 'Inside');
		const boxes: Box[] = [];
		const doors: Parameters<typeof finish>[2] = [];
		const windows: [number, number, Side][] = [];
		let bottom = front + 1;
		P.bands.forEach((band, i) => {
			const top = bottom - (depth[i] as number);
			let x = x0;
			split(r, W, band.rooms.length).forEach((w, j) => {
				const b: Box = { id: FIRST_ROOM + boxes.length, x, y: top, w, h: depth[i] as number, role: band.rooms[j] as string };
				boxes.push(b);
				const k = ROLES[b.role]?.door ?? 'door';
				const mid = b.x + (b.w >> 1);
				if (i === 0 && j === 0) {
					// the front door, and a wide one for an open front
					doors.push({ x: mid, y: front, side: 'S', kind: k });
					if (k === 'arch') doors.push({ x: mid - 1, y: front, side: 'S', kind: k });
				} else if (i === 0) doors.push({ x: b.x, y: b.y + (b.h >> 1), side: 'W', kind: k });
				else doors.push({ x: mid === x0 ? mid + 1 : mid, y: bottom - 1, side: 'S', kind: k });
				if (i === 0) for (let wx = b.x + 1; wx < b.x + b.w - 1; wx += 3) if (Math.abs(wx - mid) > 1) windows.push([wx, front, 'S']);
				if (i === P.bands.length - 1) {
					if (b.role === 'kitchen') doors.push({ x: mid, y: top, side: 'N', kind: 'door' }); // the back door
					else if (b.role !== 'store' && b.role !== 'coal') windows.push([mid, top, 'N']);
				}
				x += w;
			});
			bottom = top;
		});
		if (P.upper) d.stamps.push({ x: x0, y: hy, kind: 'stairs', rot: 0, link: UPPER });
		finish(d, boxes, doors, windows);
	}

	// upstairs: a landing across the building with rooms either side
	const up = P.upper;
	if (up) {
		const d = newDeck(UPPER);
		for (let x = x0; x < x0 + W; x++) d.cells[idx(x, hy)] = CORRIDOR;
		d.stamps.push({ x: x0, y: hy, kind: 'stairs', rot: 0, link: GROUND });
		const boxes: Box[] = [];
		const doors: Parameters<typeof finish>[2] = [];
		const windows: [number, number, Side][] = [];
		const sides = [{ y: y0, h: hy - y0 }, { y: hy + 1, h: front - hy }].map((s) => ({ ...s, n: Math.max(1, Math.round(W / int(r, 4, 5))) }));
		const many = sides.reduce((a, s) => a + s.n, 0);
		const roles = shuffle(r, [...up.must, ...Array.from({ length: Math.max(0, many - up.must.length) }, () => up.fill)]);
		for (const s of sides) {
			let x = x0;
			for (const w of split(r, W, s.n)) {
				const b: Box = { id: FIRST_ROOM + boxes.length, x, y: s.y, w, h: s.h, role: roles[boxes.length] as string };
				boxes.push(b);
				const mid = Math.max(b.x + (b.w >> 1), x0 + 1);
				const north = s.y < hy;
				doors.push({ x: mid, y: hy, side: north ? 'N' : 'S', kind: 'door' });
				windows.push([mid, north ? b.y : b.y + b.h - 1, north ? 'N' : 'S']);
				x += w;
			}
		}
		finish(d, boxes, doors, windows);
	}

	const brief = [`${pick(r, P.known)} ${kind === 'temple' ? `The high priest is ${who}.` : `It is kept by ${who}.`}`, `Hook: ${pick(r, P.hooks)}`].join('\n\n');
	return { name: title, decks, brief };
}
