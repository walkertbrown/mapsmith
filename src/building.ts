// The inside of a town's buildings, on the ship's grid like a dungeon, so the plan, the key, solo play and the
// tabletop file all carry over. A building is a box cut into bands of rooms, from the street at the front (south)
// to the back; upstairs is a landing with rooms either side, reached by stairs in the front room's corner.
// All words are Mapsmith's own.

import { fitter, type Fit } from './dungeon';
import { person, placeFor, sign, type PlaceKind } from './names';
import { chance, int, makeRng, pick, shuffle, type Rng } from './rng';
import type { GenResult } from './ship/generate';
import { CORRIDOR, FIRST_ROOM, canonicalEdge, cellAt, idx, newDeck, type Deck, type DoorKind, type Side } from './ship/model';

export type BuildingKind = 'inn' | 'tavern' | 'shop' | 'smithy' | 'temple' | 'guild' | 'bathhouse' | 'library' | 'barracks' | 'stables' | 'theatre' | 'mill';
export const BUILDING_KINDS: BuildingKind[] = ['inn', 'tavern', 'shop', 'smithy', 'temple', 'guild', 'bathhouse', 'library', 'barracks', 'stables', 'theatre', 'mill'];

const FOR: Partial<Record<PlaceKind, BuildingKind>> = {
	inn: 'inn', tavern: 'tavern', smithy: 'smithy', temple: 'temple', shrine: 'temple',
	general: 'shop', apothecary: 'shop', tailor: 'shop', jeweller: 'shop', herbalist: 'shop', moneylender: 'shop',
	guild: 'guild', bathhouse: 'bathhouse', library: 'library', barracks: 'barracks', stables: 'stables', theatre: 'theatre', mill: 'mill',
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
	/** whoever keeps the place sleeps here */
	sleeps?: boolean;
	/** in the back row, it has the back door */
	back?: boolean;
	/** in the back row, no window */
	shut?: boolean;
	say: string[];
	fit: (f: Fit) => void;
}

// tables down the room, a chair either side of each; one table in a narrow room
const tables = (f: Fit) => {
	let n = 0;
	for (let y = 1; y < f.h - 1; y += 2) for (let x = 2; x < f.w - 2; x += 3) if (f.put('table', x, y)) { n++; f.put('chair', x - 1, y); f.put('chair', x + 1, y); }
	if (!n) { f.centre('table'); f.scatter('chair', 1); }
};

// benches in rows either side of an aisle down the middle, between pillars
const pews = (f: Fit) => {
	f.pillars();
	const aisle = f.w >> 1;
	for (let y = 2; y < f.h - 1; y += 2) { f.put('bench', aisle - 4, y); f.put('bench', aisle + 1 + (f.w % 2 ? 1 : 0), y); }
};
// rows of shelves
const shelves = (f: Fit) => {
	for (let y = 1; y < f.h - 1; y += 2) for (let x = 1; x < f.w - 1; x += 3) f.put('bookcase', x, y);
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
		names: ['Kitchen'], tint: 4, back: true,
		say: ['A spit over the fire and a pot that is never empty.', 'Flour on every surface, and bread rising under a cloth.', 'Hams hang from the beams. The cook does not like visitors.'],
		fit: (f) => { f.mid('brazier', f.head); f.centre('table'); f.scatter('barrel', 2); },
	},
	store: {
		names: ['Store room', 'Pantry'], tint: 6, shut: true,
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
		names: ['Coal store', 'Fuel store'], tint: 6, shut: true,
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
		fit: pews,
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
		names: ["Keeper's room"], tint: 7, sleeps: true,
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
	hall: {
		names: ['Guild hall'], tint: 5,
		say: ['A long table under a painted ceiling, and the charter framed by the door.', 'Banners of the trade on every wall, and a high chair at the head of the table.', 'Benches for the members, and a fine for anyone who speaks out of turn.'],
		fit: (f) => { f.mid('statue', f.head); tables(f); },
	},
	counting: {
		names: ['Counting room', "Clerks' room"], tint: 4,
		say: ['Ledgers to the ceiling, and a clerk who knows every member\'s debts.', 'Dues are paid here, and fines, and quiet favours.'],
		fit: (f) => { f.along('bookcase', f.head); f.centre('table'); f.scatter('chair', 2); },
	},
	strong: {
		names: ['Strongroom'], tint: 6, door: 'bars', shut: true,
		say: ['Iron-bound chests, and a door with three locks and three keyholders.', 'The guild\'s silver, its seal and its secrets, behind bars.'],
		fit: (f) => { f.scatter('chest', 3); },
	},
	master: {
		names: ["Guildmaster's room"], tint: 7, sleeps: true,
		say: ['A carved bed, a writing desk, and the guild\'s seal in a locked drawer.', 'Fine, and a little shabby, like the guild.'],
		fit: (f) => { f.mid('bed', f.head); f.scatter('table', 1); f.scatter('chest', 1); },
	},
	meeting: {
		names: ['Meeting room', "Masters' room", "Apprentices' room", 'Robe room'], tint: 1,
		say: ['A round table, so no one sits at the head.', 'Chairs pushed back, cups left out, and an argument still in the air.', 'Where the guild settles what it will say downstairs.'],
		fit: (f) => { f.centre('table'); f.scatter('chair', 3); },
	},
	changing: {
		names: ['Changing room'], tint: 0,
		say: ['Benches, pegs for clothes, and an attendant who takes the coin and watches the purses.', 'Towels in a heap and a boy who will mind your sword for a penny.'],
		fit: (f) => { f.along('bench', f.head); f.ends('rack', f.head); },
	},
	cold: {
		names: ['Cold bath'], tint: 2,
		say: ['A stone pool of cold water, deep enough to stand in, and the gasp of whoever just got in.', 'Green water under a high window. Coins glint on the bottom.'],
		fit: (f) => { f.centre('statue'); f.ends('bench', f.head); },
	},
	warm: {
		names: ['Warm room'], tint: 5,
		say: ['Warm stone benches, and the best gossip in town.', 'Old mosaics on the floor, half of them missing.'],
		fit: (f) => { f.along('bench', f.head); f.centre('statue'); },
	},
	hot: {
		names: ['Steam room', 'Hot room'], tint: 3,
		say: ['Steam so thick you hear people before you see them.', 'Hot stones in a basket, and water thrown over them.'],
		fit: (f) => { f.centre('brazier'); f.along('bench', f.head); },
	},
	furnace: {
		names: ['Furnace room', 'Stoke hole'], tint: 3, back: true,
		say: ['The fire under the baths, fed day and night by two stokers who never speak.', 'Wood stacked to the roof, and the roar of the flue.'],
		fit: (f) => { f.mid('brazier', f.head); f.scatter('rubble', 2); },
	},
	reading: {
		names: ['Reading room'], tint: 5,
		say: ['Long desks, chained books, and a clerk on a high stool watching every page turn.', 'Silence, dust, and a cough that echoes.'],
		fit: (f) => { f.along('bookcase', f.head); tables(f); },
	},
	stacks: {
		names: ['Stacks', 'Old stacks', 'Deed room', 'Map room', 'Locked stacks', 'Upper stacks'], tint: 4,
		say: ['Shelves so close you go sideways between them.', 'Rolls and boxes, labelled in a hand nobody can read any more.', 'Records of every birth, death and deed in town, more or less in order.'],
		fit: shelves,
	},
	copying: {
		names: ['Copying room', 'Scriptorium'], tint: 7,
		say: ['Slanted desks under the windows, and ink on everything.', 'Two copyists, one book, and a quarrel over a word.'],
		fit: tables,
	},
	librarian: {
		names: ["Librarian's room"], tint: 7, sleeps: true,
		say: ['A narrow bed, and books on every other surface.', 'A candle, a cot, and a book open face down.'],
		fit: (f) => { f.mid('bed', f.head); f.along('bookcase', f.head === 'N' ? 'S' : 'N'); },
	},
	guard: {
		names: ['Guard room'], tint: 5,
		say: ['A table, a dice cup, and a sergeant who has seen everything twice.', 'Spears in a rack, mud on the floor, and the duty roster pinned by the door.'],
		fit: (f) => { f.mid('brazier', f.head); f.centre('table'); f.scatter('chair', 3); f.scatter('rack', 1); },
	},
	cell: {
		names: ['Cells', 'Lock-up'], tint: 6, door: 'bars',
		say: ['Straw, a bucket, and a drunk sleeping it off.', 'Names scratched in the wall, some of them recent.'],
		fit: (f) => { f.scatter('bench', 1); f.scatter('rubble', 1); },
	},
	mess: {
		names: ['Mess'], tint: 4, back: true,
		say: ['Long tables, tin plates, and stew that is mostly water.', 'Where the watch eats, argues and plays cards.'],
		fit: (f) => { f.mid('brazier', f.head); tables(f); },
	},
	armoury: {
		names: ['Armoury'], tint: 3, shut: true,
		say: ['Racks of spears and crossbows, and a list of who has what.', 'Rusty mail, good helmets, and three swords that belong to nobody.'],
		fit: (f) => { f.along('rack', f.head); f.scatter('chest', 1); },
	},
	captain: {
		names: ["Captain's room"], tint: 7, sleeps: true,
		say: ['A camp bed, a map of the town on the wall, and orders in a pile.', 'Kept as neat as a parade ground.'],
		fit: (f) => { f.mid('bed', f.head); f.scatter('table', 1); f.scatter('chest', 1); },
	},
	bunks: {
		names: ['Bunk room', 'Long dorm', "Recruits' room", 'Old dorm'], tint: 1,
		say: ['Beds in a row, a chest at the foot of each.', 'Boots by every bed, and someone snoring.'],
		fit: (f) => { f.along('bed', f.head, 2); f.scatter('chest', 1); },
	},
	stalls: {
		names: ['Stalls'], tint: 6, door: 'arch',
		say: ['A row of stalls, each with a name chalked over it.', 'Warm, dark and loud with horses shifting their feet.', 'Straw, dung and leather, and a cat on every beam.'],
		fit: (f) => { f.pillars(); f.along('rack', f.head); f.scatter('barrel', 2); },
	},
	tack: {
		names: ['Tack room'], tint: 4, back: true,
		say: ['Saddles on pegs, bridles in a tangle, and the smell of oil.', 'Harness for every horse, and a ledger of who hired what.'],
		fit: (f) => { f.along('rack', f.head); f.scatter('chest', 1); },
	},
	feed: {
		names: ['Feed store'], tint: 6, shut: true,
		say: ['Oats in bins with heavy lids against the rats.', 'Sacks of feed, and a rat that has outlived three cats.'],
		fit: (f) => { f.scatter('barrel', 3); },
	},
	groom: {
		names: ["Groom's room"], tint: 7, sleeps: true,
		say: ['A bed over the horses, warm in winter.', 'A cot, a lamp, and a bell that rings when the yard gate opens.'],
		fit: (f) => { f.mid('bed', f.head); f.scatter('chest', 1); },
	},
	loft: {
		names: ['Hayloft', 'Back loft', 'Straw loft', 'Grain loft', 'Bin floor'], tint: 6,
		say: ['Hay to the rafters, and a hatch to fork it down.', 'Dusty and warm. Good for hiding in, or sleeping off a night.', 'Bins of grain and a hoist at the window.'],
		fit: (f) => { f.scatter('barrel', 2); f.scatter('chest', 1); },
	},
	foyer: {
		names: ['Foyer'], tint: 0,
		say: ['A table where a man takes pennies and gives back nothing.', 'Bills for the week\'s plays pasted one over another.'],
		fit: (f) => { f.centre('table'); f.ends('statue', f.head); },
	},
	house: {
		names: ['The house'], tint: 5,
		say: ['Benches for those who pay, and standing room for those who shout.', 'Posts hold up a gallery all round, and nuts crack underfoot.'],
		fit: pews,
	},
	stage: {
		names: ['Stage'], tint: 7, door: 'arch',
		say: ['Bare boards, a painted cloth at the back, and a trapdoor for ghosts.', 'Scuffed boards that have seen a hundred deaths, none of them real, until last week.'],
		fit: (f) => { f.scatter('trapdoor', 1); f.ends('pillar', f.head); f.scatter('chest', 1); },
	},
	tiring: {
		names: ['Tiring room', 'Dressing room'], tint: 4, back: true,
		say: ['Costumes on every hook, paint pots, and a crown of gilt wood.', 'Where the players change, fight and learn their lines too late.'],
		fit: (f) => { f.along('rack', f.head); f.centre('table'); f.scatter('chair', 2); },
	},
	millroom: {
		names: ['Mill floor'], tint: 3,
		say: ['The great stones turn with a rumble you feel in your teeth. Flour hangs in the air.', 'The shaft comes down from the wheel, and everything shakes.'],
		fit: (f) => { f.centre('pillar'); f.ends('barrel', f.head); f.scatter('chest', 1); },
	},
	sacks: {
		names: ['Sack store'], tint: 6, back: true,
		say: ['Sacks of grain waiting, and sacks of flour going out.', 'Sacks to the ceiling, each with a farmer\'s mark.'],
		fit: (f) => { f.scatter('barrel', 3); },
	},
	weigh: {
		names: ['Weigh room'], tint: 4,
		say: ['The scales, and the miller\'s ledger of who brought what.', 'The town\'s weights hang here, and the miller swears they are true.'],
		fit: (f) => { f.centre('table'); f.along('rack', f.head); },
	},
	miller: {
		names: ["Miller's room"], tint: 7, sleeps: true,
		say: ['A bed that shakes when the wheel turns, and the miller sleeps through it.', 'Flour on the blankets, and a strongbox under the bed.'],
		fit: (f) => { f.mid('bed', f.head); f.scatter('chest', 1); },
	},
};

interface Plan {
	w: [number, number];
	/** the bands from the street to the back: how deep, and what is in them, west to east */
	bands: { d: [number, number]; rooms: string[] }[];
	/** upstairs: the rooms it must have, and what fills the rest; none for one floor */
	upper?: { must: string[]; fill: string };
	/** how the brief names whoever keeps it */
	by?: string;
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
		by: 'The high priest is',
		known: ['Its bells mark the hours for the whole town.', 'Old stone, older than anything round it, and cold in every season.', 'The priests feed whoever comes to the side door at dusk.'],
		hooks: ['A relic has gone from the sanctuary, and a copy has been put in its place.', 'Someone leaves offerings at night to a god this temple does not serve.', 'The crypt under the floor has been sealed for years, and now there are sounds in it.', 'A priest has not said a word since the last funeral.'],
	},
	guild: {
		w: [12, 14], bands: [{ d: [5, 6], rooms: ['hall'] }, { d: [4, 5], rooms: ['counting', 'strong', 'store'] }],
		upper: { must: ['master'], fill: 'meeting' }, by: 'The guildmaster is',
		known: ['Nobody in the trade works in this town without the guild\'s mark.', 'The richest hall in town, and the members like it seen.', 'Its feast day is the loudest night of the year.'],
		hooks: ['A guild election is coming, and one candidate has been threatened.', 'The strongroom is short, and the treasurer has left town.', 'A master was thrown out of the guild, and wants back in by any means.', 'The guild is hiring muscle to keep outsiders out of the market.'],
	},
	bathhouse: {
		w: [12, 14], bands: [{ d: [3, 4], rooms: ['changing'] }, { d: [5, 6], rooms: ['cold', 'warm', 'hot'] }, { d: [3, 4], rooms: ['furnace', 'store'] }],
		known: ['Hot water, gossip, and a back room for cards.', 'Old stone baths, older than the town.', 'Everyone comes here, so everyone hears everything.'],
		hooks: ['The water has started coming up red.', 'A deal is struck in the steam room every week, and someone wants to know what.', 'A bather drowned in water up to their waist.', 'The stokers have found a passage behind the furnace.'],
	},
	library: {
		w: [11, 13], bands: [{ d: [5, 6], rooms: ['reading'] }, { d: [4, 5], rooms: ['stacks', 'copying', 'stacks'] }],
		upper: { must: ['librarian'], fill: 'stacks' }, by: 'The librarian is',
		known: ['Chained books, and a clerk who reads everything twice.', 'Records of every birth, death and deed in town.', 'Scholars come from far off for one book it keeps locked away.'],
		hooks: ['A page has been cut from the deed book, and only one family benefits.', 'A scholar wants help finding a book the library says it never had.', 'Someone has been reading in the locked stacks at night.', 'A map in the stacks shows a cellar under the town hall that nobody knows about.'],
	},
	barracks: {
		w: [11, 13], bands: [{ d: [4, 5], rooms: ['guard', 'cell'] }, { d: [4, 5], rooms: ['mess', 'armoury', 'store'] }],
		upper: { must: ['captain'], fill: 'bunks' }, by: 'The watch is under',
		known: ['The town watch, a cell, and a sergeant with a long memory.', 'Drills at dawn, dice at dusk.', 'More of the watch than there used to be, and better armed.'],
		hooks: ['The watch is hiring, no questions asked.', 'A prisoner escaped, and the cell was still locked.', 'Crossbows have gone missing from the armoury, two at a time.', 'Half the watch is in someone\'s pay, and the captain knows it.'],
	},
	stables: {
		w: [12, 14], bands: [{ d: [6, 7], rooms: ['stalls'] }, { d: [3, 4], rooms: ['tack', 'feed'] }],
		upper: { must: ['groom'], fill: 'loft' },
		known: ['Horses for hire, and a few for sale.', 'A coach leaves twice a week, when it leaves.', 'Hay, harness, and a farrier who works for the smith.'],
		hooks: ['A horse came back alone with a saddlebag full of letters.', 'The coach is late, three days now.', 'Someone wants a horse that cannot be traced.', 'A stall is kept locked, and something in it kicks the door at night.'],
	},
	theatre: {
		w: [12, 14], bands: [{ d: [3, 4], rooms: ['foyer'] }, { d: [7, 9], rooms: ['house'] }, { d: [4, 5], rooms: ['tiring', 'stage', 'store'] }],
		by: 'It is run by',
		known: ['A new play every week, and riots at some of them.', 'The best seats are on the stage, for those who want to be seen.', 'The players are the talk of the town, and the town is the talk of the plays.'],
		hooks: ['The new play is about a real scandal, and someone wants it stopped.', 'An actor vanished between acts.', 'The prop sword in the second act is real, and someone swapped it.', 'A patron pays for every seat each night and never comes.'],
	},
	mill: {
		w: [10, 12], bands: [{ d: [6, 7], rooms: ['millroom'] }, { d: [3, 4], rooms: ['sacks', 'weigh'] }],
		upper: { must: ['miller'], fill: 'loft' }, by: 'The miller is',
		known: ['Every farm round about brings its grain here.', 'The wheel has turned for a hundred years, and the miller\'s family for longer.', 'Bread is dear in town, and folk say the mill is why.'],
		hooks: ['The wheel stopped overnight, and something is wedged in the race.', 'The miller is weighing short, and the village wants proof.', 'There is a door in the mill\'s cellar that opens onto the river.', 'Sacks go out at night by boat, and they are not flour.'],
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
	if (kind !== 'temple') return placeFor(r, kind, null).name;
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
			if (role.sleeps) notes.push(`${who.split(',')[0] as string} sleeps here.`); // a town's keeper comes with a few words about them
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
					if (ROLES[b.role]?.back) doors.push({ x: mid, y: top, side: 'N', kind: 'door' });
					else if (!ROLES[b.role]?.shut) windows.push([mid, top, 'N']);
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

	const brief = [`${pick(r, P.known)} ${P.by ?? 'It is kept by'} ${who}.`, `Hook: ${pick(r, P.hooks)}`].join('\n\n');
	return { name: title, decks, brief };
}
