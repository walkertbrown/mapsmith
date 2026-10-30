// Dungeons on the ship's grid, so the deck renderer, the key and the notes all carry over.
// Rooms sit in a loose grid of slots, one each, joined by corridors that run between the slots;
// a few extra corridors close loops, and some of those hide behind secret doors. All words are Mapsmith's own.

import { person } from './names';
import { chance, int, makeRng, pick, shuffle, type Rng } from './rng';
import type { GenResult } from './ship/generate';
import { CORRIDOR, FIRST_ROOM, GRID_H, GRID_W, VOID, canonicalEdge, cellAt, idx, newDeck, stampSize, stampCells, type Deck, type DoorKind, type Side, type StampKind } from './ship/model';

export type DungeonSize = 'lair' | 'dungeon' | 'deep';
export type DungeonKind = 'crypt' | 'keep';
export const DUNGEON_SIZES: DungeonSize[] = ['lair', 'dungeon', 'deep'];
export const DUNGEON_KINDS: DungeonKind[] = ['crypt', 'keep'];

const SW = 12, SH = 10, O = 8; // slot size in cells, and where the first slot starts
const YARD = 8; // the keep's yard, a palette's ninth tint
const PLAN: Record<DungeonSize, { rooms: [number, number]; cols: number; rows: number }> = {
	lair: { rooms: [4, 6], cols: 3, rows: 3 },
	dungeon: { rooms: [8, 10], cols: 4, rows: 4 },
	deep: { rooms: [13, 16], cols: 6, rows: 4 },
};

interface Room { id: number; sx: number; sy: number; x: number; y: number; w: number; h: number; role: Role }

// Puts fittings in one room, in its own coordinates, never on a doorstep or on another fitting.
export interface Fit {
	r: Rng;
	w: number;
	h: number;
	/** a wall with no door in it, for the altar or the throne */
	head: Side;
	put(k: StampKind, x: number, y: number, rot?: 0 | 1 | 2 | 3): boolean;
	/** a row against one wall, every `step` cells */
	along(k: StampKind, side: Side, step?: number): void;
	/** one, against the middle of a wall */
	mid(k: StampKind, side: Side): void;
	/** one at each end of a wall */
	ends(k: StampKind, side: Side): void;
	centre(k: StampKind, rot?: 0 | 1 | 2 | 3): void;
	scatter(k: StampKind, n: number): void;
	pillars(): void;
}

interface Role {
	names: [string, ...string[]];
	w: [number, number];
	h: [number, number];
	tint: number;
	/** cut the corners off, when the room is big enough */
	round?: boolean;
	/** the door into it, when it isn't a plain one */
	door?: DoorKind;
	say: string[];
	fit: (f: Fit) => void;
}

const ROT: Record<Side, 0 | 1 | 2 | 3> = { N: 0, E: 1, S: 2, W: 3 };
const opposite = (s: Side): Side => ({ N: 'S', S: 'N', E: 'W', W: 'E' })[s] as Side;

const CRYPT: Record<string, Role> = {
	entry: {
		names: ['Entry stair', 'Stair hall'], w: [4, 6], h: [4, 5], tint: 0,
		say: ['Worn steps come down from the surface. The air turns cold halfway.', 'A stair hall with niches for lamps, every one of them empty.', 'Steps down, each one hollowed by feet. Someone chalked a mark on the lowest.'],
		fit: (f) => { f.mid('stairs', f.head); if (chance(f.r, 0.5)) f.scatter('bones', 1); },
	},
	ossuary: {
		names: ['Ossuary', 'Bone hall', 'Charnel room'], w: [4, 7], h: [4, 6], tint: 2,
		say: ['Skulls stacked in the walls to the ceiling, every one facing the door.', 'Long bones bundled and tied with cord, shelf on shelf.', 'Bones sorted by kind, by hands that took their time over it.'],
		fit: (f) => { f.scatter('bones', int(f.r, 3, 5)); f.scatter('rubble', 1); },
	},
	vault: {
		names: ['Burial vault', 'Lower vault', 'Family vault', 'Old vault', 'Sealed vault'], w: [5, 8], h: [4, 6], tint: 1,
		say: ['Coffins in stone, the lids carved with the faces of the dead.', 'Niches in rows, each with a name scratched out and written again.', 'Sarcophagi along both walls. One lid is off and set neatly beside it.'],
		fit: (f) => { f.along('sarcophagus', 'N', 2); if (f.h >= 5) f.along('sarcophagus', 'S', 2); if (chance(f.r, 0.4)) f.scatter('bones', 1); },
	},
	chapel: {
		names: ['Chapel', 'Mourning chapel'], w: [7, 10], h: [6, 8], tint: 5, round: true,
		say: ['An altar under a carved sun. The braziers were lit not long ago.', 'The benches have gone to rot. The altar cloth is new.', 'A chapel for the mourners. The names of the dead cover one wall.'],
		fit: (f) => { f.mid('altar', f.head); f.ends('statue', f.head); f.pillars(); f.scatter('brazier', 2); },
	},
	embalm: {
		names: ['Embalming room', 'Preparation room'], w: [4, 6], h: [4, 5], tint: 4,
		say: ['A stone slab with gutters cut in it, and jars along the wall.', 'Tools hung in order on pegs. One peg is empty.', 'It smells of resin and salt. The jars are labelled in an old hand.'],
		fit: (f) => { f.centre('altar'); f.along('barrel', f.head, 2); f.mid('rack', opposite(f.head)); },
	},
	tomb: {
		names: ["Founder's tomb", 'Great tomb'], w: [7, 10], h: [6, 8], tint: 6, round: true,
		say: ['One sarcophagus in the middle, bigger than the rest, on a raised floor.', 'Statues of the founder stand round the tomb, all of them looking at it.', 'The great tomb. Hands have been at the dust on the lid.'],
		fit: (f) => { f.centre('sarcophagus'); f.ends('statue', 'N'); f.ends('statue', 'S'); f.scatter('brazier', 2); f.mid('chest', f.head); },
	},
	collapse: {
		names: ['Collapsed passage', 'Fallen room'], w: [4, 6], h: [4, 6], tint: 3,
		say: ['Half the ceiling is on the floor. The rest creaks.', 'Rubble chokes one side. A crawlway runs through it.', 'Roots have broken through the roof and lifted the stones.'],
		fit: (f) => { f.scatter('rubble', int(f.r, 4, 6)); f.scatter('bones', 1); },
	},
	well: {
		names: ['Well chamber', 'Cistern'], w: [5, 7], h: [5, 6], tint: 4,
		say: ['A well in the floor, black water a long way down.', 'The cistern that served the mourners. A rope hangs into it, cut.', 'Water drips into a round well from a crack in the vault.'],
		fit: (f) => { f.centre('well'); f.scatter('barrel', 1); if (chance(f.r, 0.5)) f.scatter('bones', 1); },
	},
	camp: {
		names: ["Robbers' camp", "Squatters' room"], w: [5, 7], h: [4, 6], tint: 7,
		say: ['Bedrolls, a cold fire, and a map of this place with rooms crossed off.', 'Someone has been living here. They left in a hurry.', 'A cookfire under a crack that draws the smoke away.'],
		fit: (f) => { f.along('bed', f.head, 2); f.centre('brazier'); f.scatter('chest', 1); f.scatter('barrel', 1); },
	},
};

const KEEP: Record<string, Role> = {
	entry: {
		names: ['Gatehouse'], w: [5, 7], h: [4, 6], tint: 3, door: 'bars',
		say: ["A portcullis, raised a hand's width and stuck there.", 'Murder holes in the ceiling. Arrows still in the floor.', 'A guard post with a cold brazier and a bell on a rope.'],
		fit: (f) => { f.mid('rack', f.head); f.scatter('barrel', 1); f.scatter('brazier', 1); },
	},
	hall: {
		names: ['Great hall', 'Lesser hall'], w: [8, 10], h: [6, 8], tint: 5,
		say: ['Long tables, a high seat at the end, banners gone to rags.', 'The hearth is big enough to stand in. The bones of a feast are still on the boards.', 'Pillars hold up a roof black with old smoke.'],
		fit: (f) => { f.mid('throne', f.head); f.pillars(); for (let x = 2; x < f.w - 2; x++) f.put('table', x, f.h >> 1); f.ends('brazier', f.head); },
	},
	barracks: {
		names: ['Barracks', 'Guardroom'], w: [5, 8], h: [4, 6], tint: 2,
		say: ['Cots in rows, a chest at the foot of each.', 'Dice on a blanket, and a game nobody finished.', 'Kit hung on pegs, boots lined up under the cots.'],
		fit: (f) => { f.along('bed', 'N', 2); if (f.h >= 5) f.along('chest', 'S', 2); },
	},
	armoury: {
		names: ['Armoury', 'Old armoury'], w: [4, 6], h: [4, 5], tint: 3,
		say: ['Racks of spears, most of them gone.', 'Shields stacked against the wall, painted with an old crest.', 'A grindstone, a barrel of oil, and a locked rack.'],
		fit: (f) => { f.along('rack', f.head, 2); f.scatter('barrel', 1); f.scatter('chest', 1); },
	},
	kitchen: {
		names: ['Kitchen', 'Bakehouse'], w: [5, 7], h: [4, 6], tint: 4,
		say: ['A cold hearth, hooks for meat, a cauldron on its side.', 'Something has been at the stores. There is flour everywhere.', 'Pots still on the hearth, the food in them gone hard.'],
		fit: (f) => { f.mid('brazier', f.head); f.centre('table'); f.along('barrel', opposite(f.head), 2); },
	},
	store: {
		names: ['Storeroom', 'Cellar'], w: [4, 6], h: [4, 6], tint: 6,
		say: ['Barrels and sacks, most of them broken open.', 'Wine casks along the wall, one of them still sound.', 'Grain sacks gnawed through. Tracks in the spill.'],
		fit: (f) => { f.along('barrel', f.head); f.scatter('barrel', 2); f.scatter('trapdoor', 1); },
	},
	chapel: {
		names: ['Chapel', 'Oratory'], w: [5, 7], h: [5, 7], tint: 5,
		say: ['A small chapel. The altar is bare and the candles burnt down.', 'Painted saints on the walls, their eyes scratched out.', 'A chapel kept clean by someone, though the keep is empty.'],
		fit: (f) => { f.mid('altar', f.head); f.ends('brazier', f.head); f.scatter('statue', 1); },
	},
	lord: {
		names: ["Lord's chamber", "Lady's chamber"], w: [5, 7], h: [5, 6], tint: 1,
		say: ['A curtained bed, a chest at its foot, letters on a desk.', 'The best room in the keep, and the coldest.', 'A bed big enough for four, a hearth, and a strongbox under the boards.'],
		fit: (f) => { f.mid('bed', f.head); f.scatter('chest', 1); f.mid('bookcase', opposite(f.head)); f.scatter('brazier', 1); },
	},
	library: {
		names: ['Library', 'Records room'], w: [5, 7], h: [4, 6], tint: 1,
		say: ['Shelves of ledgers and a few real books, swollen with damp.', 'A reading desk with a book still open on it.', "Rolls of the keep's accounts, going back fifty years."],
		fit: (f) => { f.along('bookcase', 'N'); if (f.h >= 5) f.along('bookcase', 'S'); f.centre('table'); },
	},
	well: {
		names: ['Well room', 'Cistern'], w: [4, 6], h: [4, 6], tint: 4,
		say: ["The keep's own well, so it never had to open its gates in a siege.", 'A windlass and a bucket on a chain. The water tastes of iron.'],
		fit: (f) => { f.centre('well'); f.scatter('barrel', 1); },
	},
	treasury: {
		names: ['Treasury', 'Strongroom'], w: [4, 6], h: [4, 5], tint: 6,
		say: ['Iron-bound chests behind a second door.', 'Strongboxes bolted to the floor. One is open and empty.', "The keep's wealth, or what is left of it."],
		fit: (f) => { f.along('chest', f.head, 2); f.scatter('chest', 1); },
	},
	tower: {
		names: ['Collapsed tower', 'Fallen tower'], w: [5, 7], h: [5, 7], tint: 3, round: true,
		say: ['The tower fell in on itself. Sky shows through the top.', 'Stairs go up three turns and stop at nothing.', 'Birds nest in the rubble.'],
		fit: (f) => { f.mid('stairs', f.head); f.scatter('rubble', int(f.r, 3, 5)); },
	},
};

interface Kind {
	roles: Record<string, Role>;
	/** the room at the far end */
	last: string;
	pool: string[];
	hazards: string[];
	treasure: string[];
}

const KINDS: Record<DungeonKind, Kind> = {
	crypt: {
		roles: CRYPT, last: 'tomb',
		pool: ['vault', 'ossuary', 'chapel', 'embalm', 'vault', 'collapse', 'well', 'camp', 'ossuary', 'vault'],
		hazards: [
			'A loose flagstone drops into a pit of old stakes.',
			'The air is bad. A torch gutters here before anyone feels it.',
			'Rats live in the walls, and noise brings them out.',
			'The floor is slick with seepage. Running here means a fall.',
			'The dead here do not lie still once the room is entered.',
			'A tripwire across the doorway rings bells somewhere deeper.',
			'The ceiling is held up by one cracked beam.',
			'Spores drift from a white growth on the walls.',
			'A ward cut into the floor burns whoever steps on it.',
			'Something hungry has made its nest in a niche.',
			'Gas pools low here. A flame sets it off.',
			'The door shuts and locks behind the last one in.',
		],
		treasure: [
			'Grave goods: a silver cup and a ring, under the dust.',
			'A purse of old coins, the faces worn off them.',
			'A sword laid on a coffin, still sharp.',
			'Three funeral masks of beaten gold.',
			'A reliquary holding a finger bone and a garnet.',
			'Candlesticks of real silver, black with age.',
			'A sealed jar of oil that burns without smoke.',
			'A book of names, worth a lot to the family that lost it.',
			'An amber necklace on a skeleton that will not let go of it.',
			'A map of these vaults, with one room more than you have found.',
		],
	},
	keep: {
		roles: KEEP, last: 'treasury',
		pool: ['hall', 'barracks', 'kitchen', 'store', 'armoury', 'lord', 'chapel', 'library', 'well', 'tower', 'store', 'barracks'],
		hazards: [
			'Rotten boards over the cellar.',
			'A guard dog gone wild, and its pups.',
			'Arrow slits cover the doorway from a room you cannot reach.',
			'The stairs give way under more than one person.',
			'Squatters who think the keep is theirs now.',
			'A crossbow trap on the chest, still wound.',
			'Smoke from a fire someone set and left.',
			'A loose stone in the roof drops when a door slams.',
			'Bees in the walls, a whole summer of them.',
			"The last garrison's dead, and whatever took them.",
		],
		treasure: [
			"A strongbox of the garrison's pay, never paid out.",
			'A good sword in a plain sheath.',
			'Silver plate wrapped in a cloak.',
			"The keep's seal, which opens doors for whoever holds it.",
			'A bag of gems sewn into a mattress.',
			'A tapestry worth more than the keep, if it can be carried.',
			'Letters that would ruin someone still alive.',
			'A fine crossbow and twenty bolts.',
			'A chest of good wine, still sealed.',
			'The deed to the land, signed and sealed.',
		],
	},
};

const FAMILY = ['Ashgrove', 'Varrow', 'Kettering', 'Morne', 'Hallam', 'Corwen', 'Thale', 'Brannock', 'Vell', 'Ondry', 'Lisk', 'Harrowgate', 'Penlow', 'Strand'];
const PLACE = ['Elder Hill', 'Saltmere', 'Hollowford', 'Crane Down', 'Whitstone', 'Gallow Rise', 'Marrowby', 'Blackwater', 'Fenn Cross', 'Oldbury'];
const AGO = ['forty years', 'a hundred years', 'three winters', 'a lifetime', 'two generations', 'ten years'];

function dungeonName(r: Rng, kind: DungeonKind): string {
	const fam = pick(r, FAMILY), place = pick(r, PLACE);
	return kind === 'crypt'
		? pick(r, [`The ${fam} Crypt`, `${fam} Barrow`, `The Vaults under ${place}`, `The Crypt at ${place}`])
		: pick(r, [`${fam} Keep`, `${place} Hold`, `The Keep at ${place}`, `Fort ${fam}`]);
}

function story(r: Rng, kind: DungeonKind, name: string): string {
	const fam = /(\w+) (Crypt|Barrow|Keep)$|^Fort (\w+)$/.exec(name);
	const who = fam?.[1] ?? fam?.[3] ?? pick(r, FAMILY);
	const ago = pick(r, AGO);
	const p = person(r);
	if (kind === 'crypt')
		return [
			pick(r, [
				`The ${who} family buried their dead here for six generations, each one deeper than the last.`,
				`An order of mourners dug these vaults for the ${who} dead and kept the lamps lit for a century.`,
				`The ${who} line built this place to keep their dead close and their secrets closer.`,
			]),
			pick(r, [
				`The last of the line was laid in the great tomb ${ago} ago, and the doors were sealed.`,
				`Grave robbers broke in ${ago} ago. They never came out.`,
				`A flood ${ago} ago drowned the lower vaults and drove the keepers off.`,
				`The keepers stopped coming ${ago} ago. Nobody in town will say why.`,
			]),
			`Now ${pick(r, ['robbers camp in the upper rooms and dig deeper every night', 'the dead walk the lower vaults after dark', 'something has made its nest in the great tomb', 'a cult meets in the chapel on moonless nights', 'rats the size of dogs own the place'])}.`,
			`Hook: ${pick(r, [
				`${p} will pay to have their grandmother's ring brought back up.`,
				'The family wants its book of names back, and nobody else to read it.',
				'A child went in on a dare last night and has not come out.',
				'The town wants it sealed for good, with whatever is down there inside.',
				`${p} says the founder was buried with the key to something bigger.`,
			])}`,
		].join('\n\n');
	return [
		pick(r, [
			`The ${who}s held this keep for the crown and taxed the road below it.`,
			`It was built to watch the pass, back when there was a border here.`,
			`A lord of the ${who} line raised it on the bones of an older fort.`,
		]),
		pick(r, [
			`The garrison was called away ${ago} ago and never sent back.`,
			`It fell to a siege ${ago} ago, and the winners did not stay.`,
			`Sickness emptied it ${ago} ago. The gate was left open.`,
			`The last lord died ${ago} ago with no heir, and the keep was forgotten.`,
		]),
		`Now ${pick(r, ['bandits use it to rob the road again', 'a warlord means to make it his seat', 'something lives in the fallen tower', 'squatters farm the yard and bar the gate at night', 'it is empty, and the lights in it at night say otherwise'])}.`,
		`Hook: ${pick(r, [
			`${p} holds a claim to the keep and wants it cleared before they ride in.`,
			'The treasury was never found. Everyone in the valley has a story about where it went.',
			'Travellers keep going missing on the road beneath it.',
			`${p} needs the deed, and it was last seen in the keep.`,
			'The crown will pay for proof of who holds it now.',
		])}`,
	].join('\n\n');
}

const DIRS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export function generateDungeon(size: DungeonSize, kind: DungeonKind, seed: string): GenResult {
	const r = makeRng(`${seed}:dungeon:${kind}:${size}`);
	const K = KINDS[kind], plan = PLAN[size];
	const n = int(r, ...plan.rooms);

	// slots, grown from the way in on the bottom row; edges [a, b, loop]
	const slots: [number, number][] = [[int(r, 0, plan.cols - 1), plan.rows - 1]];
	const used = new Map<string, number>([[`${slots[0]?.[0]},${slots[0]?.[1]}`, 0]]);
	const edges: [number, number, boolean][] = [];
	while (slots.length < n) {
		const i = chance(r, 0.5) ? slots.length - 1 : int(r, 0, slots.length - 1);
		const [sx, sy] = slots[i] as [number, number];
		const [dx, dy] = pick(r, DIRS);
		const nx = sx + dx, ny = sy + dy;
		if (nx < 0 || ny < 0 || nx >= plan.cols || ny >= plan.rows || used.has(`${nx},${ny}`)) continue;
		used.set(`${nx},${ny}`, slots.length);
		edges.push([i, slots.length, false]);
		slots.push([nx, ny]);
	}
	let loops = Math.ceil(n / 4);
	slots.forEach(([sx, sy], a) => {
		for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
			const b = used.get(`${sx + dx},${sy + dy}`);
			if (b === undefined || loops <= 0 || edges.some(([p, q]) => (p === a && q === b) || (p === b && q === a))) continue;
			if (chance(r, 0.45)) {
				edges.push([a, b, true]);
				loops--;
			}
		}
	});

	// how far each room is from the way in, so the best room is at the far end
	const depth = slots.map(() => -1);
	depth[0] = 0;
	for (let changed = true; changed; ) {
		changed = false;
		for (const [a, b, loop] of edges) {
			if (loop) continue;
			const da = depth[a] as number, db = depth[b] as number;
			if (da >= 0 && db < 0) { depth[b] = da + 1; changed = true; }
			if (db >= 0 && da < 0) { depth[a] = db + 1; changed = true; }
		}
	}
	const far = depth.indexOf(Math.max(...depth));
	const pool = shuffle(r, [...K.pool]);
	const roles = slots.map((_, i) => (i === 0 ? 'entry' : i === far ? K.last : (pool[(i - 1) % pool.length] as string)));

	const d = newDeck('Level 1');
	const rooms: Room[] = slots.map(([sx, sy], i) => {
		const role = K.roles[roles[i] as string] as Role;
		const w = Math.min(int(r, ...role.w), SW - 2), h = Math.min(int(r, ...role.h), SH - 2);
		const x = O + sx * SW + 1 + int(r, 0, SW - 2 - w), y = O + sy * SH + 1 + int(r, 0, SH - 2 - h);
		return { id: FIRST_ROOM + i, sx, sy, x, y, w, h, role };
	});
	for (const rm of rooms) {
		const cut = rm.role.round && rm.w >= 6 && rm.h >= 6;
		for (let y = 0; y < rm.h; y++)
			for (let x = 0; x < rm.w; x++) {
				if (cut && (x === 0 || x === rm.w - 1) && (y === 0 || y === rm.h - 1)) continue;
				d.cells[idx(rm.x + x, rm.y + y)] = rm.id;
			}
		d.tints[rm.id] = rm.role.tint;
	}

	const doorAt = new Set<string>();
	const addDoor = (x: number, y: number, side: Side, k: DoorKind) => {
		const e = canonicalEdge(x, y, side);
		const key = `${e.x},${e.y},${e.side}`;
		if (doorAt.has(key)) return;
		doorAt.add(key);
		d.doors.push({ ...e, kind: k });
	};
	const doorFor = (rm: Room, loop: boolean) => (loop && chance(r, 0.5) ? 'secret' : (rm.role.door ?? (chance(r, 0.25) ? 'arch' : 'door')));
	for (const [a, b, loop] of edges) {
		const A = rooms[a] as Room, B = rooms[b] as Room;
		const horiz = A.sy === B.sy;
		const [p, q] = (horiz ? A.sx < B.sx : A.sy < B.sy) ? [A, B] : [B, A];
		// u runs from p toward q, v across
		const at = (u: number, v: number): [number, number] => (horiz ? [u, v] : [v, u]);
		const u0 = (rm: Room) => (horiz ? rm.x : rm.y), ul = (rm: Room) => (horiz ? rm.w : rm.h);
		const v0 = (rm: Room) => (horiz ? rm.y : rm.x), vl = (rm: Room) => (horiz ? rm.h : rm.w);
		const start = u0(p) + ul(p) - 1, end = u0(q);
		const lo = Math.max(v0(p), v0(q)) + 1, hi = Math.min(v0(p) + vl(p), v0(q) + vl(q)) - 2;
		const path: [number, number][] = [];
		if (lo <= hi) {
			const v = int(r, lo, hi);
			for (let u = start; u <= end; u++) path.push(at(u, v));
		} else {
			// round the corner in the gap between the two slots, where no room can be
			const va = v0(p) + (vl(p) >> 1), vb = v0(q) + (vl(q) >> 1);
			const mu = O + (horiz ? q.sx * SW : q.sy * SH) - int(r, 0, 1);
			for (let u = start; u <= mu; u++) path.push(at(u, va));
			const st = vb > va ? 1 : -1;
			for (let v = va + st; v !== vb + st; v += st) path.push(at(mu, v));
			for (let u = mu + 1; u <= end; u++) path.push(at(u, vb));
		}
		for (const [x, y] of path) if (cellAt(d, x, y) === VOID) d.cells[idx(x, y)] = CORRIDOR;
		const kp = doorFor(p, false), kq = doorFor(q, loop);
		for (let i = 1; i < path.length; i++) {
			const [x1, y1] = path[i - 1] as [number, number], [x2, y2] = path[i] as [number, number];
			const c1 = cellAt(d, x1, y1), c2 = cellAt(d, x2, y2);
			if (c1 === c2 || (c1 < FIRST_ROOM && c2 < FIRST_ROOM)) continue;
			const side: Side = x2 > x1 ? 'E' : x2 < x1 ? 'W' : y2 > y1 ? 'S' : 'N';
			addDoor(x1, y1, side, c1 === p.id || c2 === p.id ? kp : kq);
		}
	}
	if (kind === 'keep') bailey(d, rooms, FIRST_ROOM + n);

	// fittings, kept off every doorstep
	const taken = new Set<number>(), near = new Set<number>();
	for (const k of d.doors) {
		near.add(idx(k.x, k.y));
		near.add(k.side === 'N' ? idx(k.x, k.y - 1) : idx(k.x - 1, k.y));
	}
	const hazards = shuffle(r, [...K.hazards]), treasure = shuffle(r, [...K.treasure]);
	const used2 = new Set<string>();
	for (const rm of rooms) {
		const sides = new Set<Side>();
		for (const k of d.doors) {
			const a = cellAt(d, k.x, k.y) === rm.id, b = cellAt(d, k.side === 'N' ? k.x : k.x - 1, k.side === 'N' ? k.y - 1 : k.y) === rm.id;
			if (a) sides.add(k.side);
			if (b) sides.add(opposite(k.side));
		}
		const free = (['N', 'E', 'W', 'S'] as Side[]).filter((s) => !sides.has(s));
		rm.role.fit(fitter(d, rm, r, taken, near, free.length ? pick(r, free) : 'N'));

		const name = rm.role.names.find((x) => !used2.has(x)) ?? rm.role.names[0];
		used2.add(name);
		const i = rm.id - FIRST_ROOM;
		const notes = [pick(r, rm.role.say)];
		if (i === far && size === 'deep') notes.push(kind === 'crypt' ? 'Stairs go on down from here, to a level not on this map.' : 'Stairs go down from here to cellars not on this map.');
		if (i !== 0 && hazards.length && chance(r, 0.4)) notes.push(`Hazard: ${hazards.pop()}`);
		if (treasure.length && (i === far || (i !== 0 && chance(r, 0.35)))) notes.push(`Treasure: ${treasure.pop()}`);
		d.key[rm.id] = { num: i + 1, name, notes: notes.join('\n') };
	}
	if (size === 'deep') {
		const end = rooms[far] as Room;
		fitter(d, end, r, taken, near, 'S').scatter('stairs', 1);
	}

	const name = dungeonName(r, kind);
	return { name, decks: [d], brief: story(r, kind, name) };
}

// A keep stands in a walled yard, its buildings opening onto it.
function bailey(d: Deck, rooms: Room[], first: number) {
	// no corridors in the open: close up the yard to two squares between buildings
	for (let i = 0; i < d.cells.length; i++) if (d.cells[i] === CORRIDOR) d.cells[i] = VOID;
	const used = (n: number, at: (i: number, j: number) => number) => {
		const keep: number[] = [];
		for (let i = 0; i < n; i++) {
			let any = false;
			for (let j = 0; j < n && !any; j++) any = at(i, j) >= FIRST_ROOM;
			keep.push(any ? 1 : 0);
		}
		// new position of every old line; an empty run keeps at most two lines
		const to: number[] = [];
		let pos = O, run = 0; // far enough in for the wall and towers
		for (let i = 0; i < n; i++) {
			run = keep[i] ? 0 : run + 1;
			to.push(pos);
			if (keep[i] || run <= 2) pos++;
		}
		return to;
	};
	const nx = used(GRID_W, (x, y) => cellAt(d, x, y)), ny = used(GRID_H, (y, x) => cellAt(d, x, y));
	const old = d.cells.slice();
	d.cells.fill(VOID);
	for (let i = 0; i < old.length; i++) if (old[i] !== VOID) d.cells[idx(nx[i % GRID_W] as number, ny[Math.floor(i / GRID_W)] as number)] = old[i] as number;
	// a door edge moves with the room on either side of it
	d.doors = d.doors.map((k) => {
		const [ax, ay] = k.side === 'N' ? [k.x, k.y - 1] : [k.x - 1, k.y];
		const inA = (old[idx(k.x, k.y)] as number) >= FIRST_ROOM;
		return inA ? { ...k, x: nx[k.x] as number, y: ny[k.y] as number } : { ...k, x: (nx[ax] as number) + (k.side === 'W' ? 1 : 0), y: (ny[ay] as number) + (k.side === 'N' ? 1 : 0) };
	});
	for (const rm of rooms) { rm.x = nx[rm.x] as number; rm.y = ny[rm.y] as number; }

	// the curtain wall three squares out from every building (room to walk past a corner tower),
	// a tower on each corner, and the gate in the south wall below the way in
	let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
	for (let i = 0; i < d.cells.length; i++) {
		if (d.cells[i] === VOID) continue;
		const x = i % GRID_W, y = Math.floor(i / GRID_W);
		x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
	}
	x0 -= 3; y0 -= 3; x1 += 3; y1 += 3;
	const yard = first;
	for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (cellAt(d, x, y) === VOID) d.cells[idx(x, y)] = yard;
	d.tints[yard] = YARD;
	const door = (x: number, y: number, side: Side, kind: DoorKind) => d.doors.push({ ...canonicalEdge(x, y, side), kind });
	const corners: [number, number, number, number][] = [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]];
	corners.forEach(([cx, cy, dx, dy], i) => {
		const tower = first + 1 + i;
		for (let y = cy - 1; y <= cy + 1; y++) for (let x = cx - 1; x <= cx + 1; x++) d.cells[idx(x, y)] = tower;
		d.tints[tower] = 3;
		// an arch from the tower's inner corner into the yard
		door(cx + dx, cy + dy, dx > 0 ? 'E' : 'W', 'arch');
	});
	const gate = rooms[0] as Room, gx = gate.x + (gate.w >> 1);
	if (!d.doors.some((k) => k.side === 'N' && k.x === gx && k.y === gate.y + gate.h)) door(gx, gate.y + gate.h - 1, 'S', 'door');
	door(gx, y1, 'S', 'bars');
	door(gx + 1, y1, 'S', 'bars');
	d.nextRoom = first + 5;
}

export function fitter(d: Deck, rm: Pick<Room, 'id' | 'x' | 'y' | 'w' | 'h'>, r: Rng, taken: Set<number>, near: Set<number>, head: Side): Fit {
	const ok = ([x, y]: [number, number]) => cellAt(d, x, y) === rm.id && !taken.has(idx(x, y)) && !near.has(idx(x, y));
	const put = (k: StampKind, x: number, y: number, rot: 0 | 1 | 2 | 3 = 0) => {
		const st = { x: rm.x + x, y: rm.y + y, kind: k, rot };
		const cells = stampCells(st);
		if (!cells.every(ok)) return false;
		for (const [cx, cy] of cells) taken.add(idx(cx, cy));
		d.stamps.push(st);
		return true;
	};
	// where a stamp of size sw×sh sits against a wall, t cells along it
	const spot = (side: Side, t: number, sw: number, sh: number): [number, number] =>
		side === 'N' ? [t, 0] : side === 'S' ? [t, rm.h - sh] : side === 'W' ? [0, t] : [rm.w - sw, t];
	const len = (side: Side) => (side === 'N' || side === 'S' ? rm.w : rm.h);
	const f: Fit = {
		r, w: rm.w, h: rm.h, head, put,
		along(k, side, step) {
			const rot = ROT[side];
			const [sw, sh] = stampSize({ kind: k, rot });
			const along = side === 'N' || side === 'S' ? sw : sh;
			for (let t = 0; t + along <= len(side); t += step ?? along) put(k, ...spot(side, t, sw, sh), rot);
		},
		mid(k, side) {
			const rot = ROT[side];
			const [sw, sh] = stampSize({ kind: k, rot });
			const along = side === 'N' || side === 'S' ? sw : sh;
			const t = (len(side) - along) >> 1;
			for (const dt of [0, 1, -1, 2, -2]) if (put(k, ...spot(side, t + dt, sw, sh), rot)) return;
		},
		ends(k, side) {
			const rot = ROT[side];
			const [sw, sh] = stampSize({ kind: k, rot });
			const along = side === 'N' || side === 'S' ? sw : sh;
			// a round room has no corner, so step in one
			for (const t of [0, len(side) - along]) if (!put(k, ...spot(side, t, sw, sh), rot)) put(k, ...spot(side, t === 0 ? 1 : t - 1, sw, sh), rot);
		},
		centre(k, rot = 0) {
			const [sw, sh] = stampSize({ kind: k, rot });
			const x = (rm.w - sw) >> 1, y = (rm.h - sh) >> 1;
			for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1], [1, 1]]) if (put(k, x + (dx as number), y + (dy as number), rot)) return;
		},
		scatter(k, n) {
			for (let tries = 0, done = 0; done < n && tries < n * 12; tries++) if (put(k, int(r, 0, rm.w - 1), int(r, 0, rm.h - 1), (int(r, 0, 3) as 0 | 1 | 2 | 3))) done++;
		},
		pillars() {
			if (rm.w < 7 || rm.h < 6) return;
			for (let x = 1; x <= rm.w - 2; x += 2) for (const y of [1, rm.h - 2]) { put('pillar', x, y); put('pillar', rm.w - 1 - x, y); }
		},
	};
	return f;
}
