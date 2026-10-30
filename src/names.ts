// Names and one-line notes for the town and the places marked on it. All original lists.

import { chance, pick, type Rng } from './rng';
import type { TownOptions } from './town';

export type PlaceKind =
	| 'market'
	| 'temple'
	| 'keep'
	| 'inn'
	| 'tavern'
	| 'smithy'
	| 'harbour'
	| 'general'
	| 'shrine'
	| 'mill'
	| 'apothecary'
	| 'stables'
	| 'guild'
	| 'tailor'
	| 'moneylender'
	| 'bathhouse'
	| 'library'
	| 'barracks'
	| 'theatre'
	| 'jeweller'
	| 'herbalist';

export interface PlaceText {
	label: string; // what it is: "Inn"
	name: string; // what it is called: "The Drowned Lantern"
	keeper: string; // who runs it, and one thing about them
	detail: string; // what you notice
	hook: string; // trouble the players can walk into
}

const START = ['Ash', 'Bram', 'Cold', 'Elder', 'Fen', 'Grey', 'Hollow', 'Ivy', 'Kettle', 'Lark', 'Marrow', 'North', 'Oak', 'Pike', 'Quarry', 'Raven', 'Salt', 'Thorn', 'Umber', 'Vale', 'Wick', 'Yarrow', 'Brindle', 'Copper', 'Dun', 'Gull', 'Heron', 'Low', 'Mill', 'Stone', 'Tallow', 'Wether', 'Black', 'Bright', 'Crow', 'Elm', 'Fallow', 'Gold', 'Hart', 'Rook'];
const END = ['ford', 'bury', 'wick', 'mere', 'stead', 'holm', 'by', 'ton', 'field', 'gate', 'haven', 'bridge', 'well', 'moor', 'cross', 'hithe', 'combe', 'dale', 'marsh', 'stow'];
const WATER_END: Partial<Record<TownOptions['water'], string[]>> = {
	river: ['ford', 'bridge', 'bank', 'weir'],
	coast: ['haven', 'mouth', 'strand', 'port'],
	estuary: ['mouth', 'haven', 'quay', 'port'],
	lake: ['mere', 'water', 'shore', 'pool'],
};

export function townName(r: Rng, o: Pick<TownOptions, 'water'>): string {
	const ends = chance(r, 0.5) ? (WATER_END[o.water] ?? END) : END;
	const s = pick(r, START), e = pick(r, ends);
	return s.toLowerCase().endsWith(e[0] as string) ? `${s}${e.slice(1)}` : `${s}${e}`;
}

const FIRST = ['Agna', 'Bertil', 'Cass', 'Dorran', 'Edda', 'Fenwick', 'Gisla', 'Hob', 'Ilse', 'Jory', 'Kesta', 'Lom', 'Maudie', 'Nils', 'Orla', 'Pell', 'Quill', 'Rosamund', 'Sefton', 'Tamsin', 'Ulf', 'Verity', 'Wynn', 'Yorick', 'Alder', 'Brannagh', 'Corin', 'Dace', 'Elspeth', 'Garrow', 'Hesper', 'Ivo', 'Linnet', 'Mabry', 'Odo', 'Petra', 'Rufus', 'Sabine', 'Tobin', 'Wren'];
const LAST = ['Ashby', 'Blackwater', 'Cobb', 'Dunning', 'Fairweather', 'Gale', 'Hartley', 'Inchbald', 'Kell', 'Lowe', 'Marsh', 'Nettle', 'Oakes', 'Pratt', 'Quayle', 'Rudd', 'Small', 'Thatcher', 'Underhill', 'Vane', 'Whitlock', 'Yeo', 'Bracken', 'Crane', 'Dawe', 'Flint', 'Goodbody', 'Hobb', 'Mallory', 'Penn'];
const TRAIT = [
	'laughs too loudly at their own jokes',
	'never sits with their back to the door',
	'counts every coin twice',
	'is missing two fingers and won\'t say how',
	'knows everyone\'s business and sells it',
	'is kind to strangers and cold to locals',
	'hums the same three notes all day',
	'was a soldier once and still stands like one',
	'owes money to someone dangerous',
	'is newly widowed and running the place alone',
	'is far too young for the job and knows it',
	'is the oldest person in town, or says so',
	'speaks only when it matters',
	'keeps a dog that growls at liars',
	'is quietly in love with a rival',
	'writes everything down in a small book',
	'has a sister nobody has seen in a year',
	'collects stories from travellers and pays for good ones',
];

export const person = (r: Rng) => `${pick(r, FIRST)} ${pick(r, LAST)}`;

const ADJ = ['Drowned', 'Gilded', 'Crooked', 'Sleeping', 'Laughing', 'Broken', 'Silver', 'Hungry', 'Wandering', 'Lame', 'Green', 'Blind', 'Red', 'Patient', 'Lucky', 'Weeping', 'Merry', 'Iron', 'Last', 'Lost'];
const NOUN = ['Lantern', 'Goose', 'Anchor', 'Stag', 'Kettle', 'Fiddler', 'Crown', 'Eel', 'Plough', 'Hound', 'Bell', 'Mare', 'Oar', 'Barrel', 'Wheel', 'Heron', 'Boot', 'Candle', 'Ram', 'Key'];

interface Kind {
	label: string;
	name: (r: Rng, keeper: string) => string;
	detail: string[];
	hook: string[];
	keeperless?: boolean;
}

const last = (who: string) => who.split(' ').slice(-1)[0] as string;
export const sign = (r: Rng) => `The ${pick(r, ADJ)} ${pick(r, NOUN)}`;

const KINDS: Record<PlaceKind, Kind> = {
	market: {
		label: 'Market square',
		name: (r) => pick(r, ['Market Square', 'the Cross', 'Old Market', 'the Shambles', 'Wool Market', 'the Green']),
		keeperless: true,
		detail: ['Stalls under striped awnings, and a stone cross worn smooth.', 'A well in the middle, and a queue at it every morning.', 'Trestles, crates, a pillory nobody has used in years.', 'Pigeons, hawkers, and a notice board three layers deep.'],
		hook: ['A notice on the board offers a reward, and the name on it has been scratched out.', 'Two stallholders come to blows over the same pitch; both swear they paid for it.', 'A crier reads out a new tax nobody has heard of.', 'Someone is selling goods that went missing from a caravan last week.'],
	},
	temple: {
		label: 'Temple',
		name: (r) => `${pick(r, ['St', 'Our Lady of', 'the Chapel of', 'the House of'])} ${pick(r, ['the Tides', 'the Harvest', 'Mercy', 'the Lamp', 'the Long Road', 'Saint Odo', 'the Open Hand', 'Ashes'])}`,
		detail: ['Bells cast from melted swords, rung on the hour.', 'A crypt the priests say is empty.', 'Coloured glass, half of it replaced with plain.', 'Pilgrims sleep on the steps when the inns are full.'],
		hook: ['The relic in the side chapel has been swapped for a fake, and only the sexton has noticed.', 'A priest is hearing confessions after dark, and some of them are not from the living.', 'The bells rang at midnight, and nobody was in the tower.', 'An heir is buried here, and someone wants proof the coffin is not empty.'],
	},
	keep: {
		label: 'Keep',
		name: (r) => `${pick(r, ['The Old Keep', 'Castle', 'The Tower of', 'Fort'])} ${pick(r, START)}${pick(r, ['', 'mont', 'hold', 'gard'])}`.replace(/^The Old Keep \S+/, 'The Old Keep'),
		detail: ['A curtain wall, a gatehouse, and a lord who is seldom home.', 'Guards in faded livery, more of them than there used to be.', 'The banner on the tower has been changed twice this year.'],
		hook: ['The lord\'s steward is selling the castle\'s stores, a sack at a time.', 'A prisoner in the cells claims to be the lord\'s missing brother.', 'The garrison has not been paid, and they are talking about it.'],
	},
	inn: {
		label: 'Inn',
		name: (r) => sign(r),
		detail: ['Rooms upstairs, a fire that never goes out, and a stew that never runs out either.', 'A coaching inn with stabling for twenty horses.', 'Low beams, smoke, and a long table for travellers.', 'Clean sheets and a landlord who asks no questions, for a price.'],
		hook: ['A guest has not come down from their room in two days, and the door is locked from inside.', 'A stranger pays for the whole room\'s drinks and asks about a map.', 'Someone left a sealed letter with the landlord, addressed to one of the players.', 'The cellar is bigger than the inn above it.'],
	},
	tavern: {
		label: 'Tavern',
		name: (r) => sign(r),
		detail: ['Sawdust floor, dice in the corner, ale that is mostly water.', 'Dockhands and drovers, and a fight most nights.', 'A singer who only knows sad songs.', 'Cheap, loud, and the best place in town to hear things.'],
		hook: ['A dice game in the back is rigged, and the winner is not who you think.', 'Someone is recruiting for a job that pays too well.', 'A drunk keeps talking about what he saw in the woods.', 'The tavern\'s dog won\'t stop barking at one table.'],
	},
	smithy: {
		label: 'Smithy',
		name: (r, k) => `${last(k)}'s ${pick(r, ['Forge', 'Smithy', 'Ironworks', 'Anvil'])}`,
		detail: ['Hammering from dawn, horseshoes and nails mostly.', 'A forge that burns blue on cold days.', 'Blades on the wall, none of them for sale.'],
		hook: ['An order of fifty spearheads arrived with no name and gold up front.', 'The smith\'s apprentice has run off with the best hammer.', 'A sword brought in for mending carries a crest that should not exist any more.'],
	},
	harbour: {
		label: 'Harbour',
		name: (r) => pick(r, ['the Harbour Office', 'the Customs House', 'Fish Quay', 'the Long Wharf', 'the Weigh House']),
		detail: ['Nets drying, gulls everywhere, and a harbourmaster with a ledger.', 'Warehouses, cranes, and boats three deep at the quay.', 'The smell of tar and fish, and a bell for the tide.'],
		hook: ['A ship came in with no crew aboard and the cargo untouched.', 'The harbourmaster is waving through boats that never pay dues.', 'Something keeps tearing the nets, every night, at the same mooring.'],
	},
	general: {
		label: 'General store',
		name: (r, k) => pick(r, [`${last(k)}'s Sundries`, `${last(k)} & Daughters`, 'The Corner Shop', 'Provisions', `${last(k)}'s`]),
		detail: ['Rope, lamp oil, flour, and a little of everything else.', 'Shelves to the ceiling and a ladder on a rail.', 'Everything has a price, and the price changes when you ask.'],
		hook: ['The shopkeeper has bought every lantern in town, and will not say why.', 'A customer keeps paying in coins from a kingdom that fell a century ago.', 'Stock goes missing at night, and the door is always locked.'],
	},
	shrine: {
		label: 'Shrine',
		name: (r) => `Shrine of ${pick(r, ['the Well', 'the Crossroads', 'the Harvest', 'the Lost', 'Saint Ilse', 'the Mother'])}`,
		detail: ['A roadside shrine, candles and ribbons.', 'A small chapel with one bench and a bell.', 'Offerings of bread and coins, left out overnight.'],
		hook: ['The offerings have stopped disappearing, and the villagers are frightened.', 'A hermit has moved in and preaches to anyone who stops.', 'Someone broke the statue, and it was found whole again the next morning.'],
	},
	mill: {
		label: 'Mill',
		name: (r, k) => pick(r, [`${last(k)}'s Mill`, 'the Watermill', 'the Old Mill', 'Weir Mill']),
		detail: ['A waterwheel on the river and flour on everything.', 'The miller takes one sack in ten, and everybody grumbles.', 'The wheel creaks loud enough to hear across the fields.'],
		hook: ['The wheel stopped overnight, and something is wedged in the race.', 'The miller is weighing short, and the village wants proof.', 'There is a door in the mill\'s cellar that opens onto the river.'],
	},
	apothecary: {
		label: 'Apothecary',
		name: (r, k) => pick(r, [`${last(k)}'s Remedies`, 'The Mortar & Pestle', 'The Green Bottle', `${last(k)}, Apothecary`]),
		detail: ['Jars of everything, labelled in a hand nobody else can read.', 'Dried herbs from the beams, and a cat asleep on the counter.', 'Medicines, poisons, and a ledger of who bought which.'],
		hook: ['Someone bought enough sleeping draught to fell a horse.', 'A remedy that worked for years has started making people ill.', 'The apothecary needs a rare root from somewhere dangerous, and pays well.'],
	},
	stables: {
		label: 'Stables',
		name: (r, k) => pick(r, [`${last(k)}'s Livery`, 'The Horse Fair', 'The Coach Yard', 'Post Stables']),
		detail: ['Horses for hire, and a few for sale.', 'A coach leaves twice a week, when it leaves.', 'Hay, harness, and a farrier who works for the smith.'],
		hook: ['A horse came back alone with a saddlebag full of letters.', 'The coach is late, three days now.', 'Someone wants a horse that can\'t be traced.'],
	},
	guild: {
		label: 'Guildhall',
		name: (r) => `${pick(r, ['Weavers\'', 'Masons\'', 'Merchants\'', 'Chandlers\'', 'Coopers\'', 'Fishers\''])} Hall`,
		detail: ['A timber hall with a painted ceiling and a long table.', 'Members only, and members pay.', 'The guild\'s charter hangs framed by the door.'],
		hook: ['A guild election is coming, and one candidate has been threatened.', 'The guild\'s strongbox is short, and the treasurer has left town.', 'Non-members are being run out of the market.'],
	},
	tailor: {
		label: 'Tailor',
		name: (r, k) => pick(r, [`${last(k)}, Tailor`, 'Needle & Thread', `${last(k)}'s Cloth`]),
		detail: ['Bolts of cloth and a dummy in the window.', 'Mends anything by morning, at a price.'],
		hook: ['A noble has ordered a wedding coat, but nobody in town is getting married.', 'The tailor found something sewn into a coat brought in for mending.'],
	},
	moneylender: {
		label: 'Moneylender',
		name: (r, k) => pick(r, [`${last(k)} & Sons`, 'The Counting House', `${last(k)}'s Bank`]),
		detail: ['A counter, a grille, and a guard who does not smile.', 'Loans to anyone, at rates nobody can pay.'],
		hook: ['A debt ledger has been stolen, and half the town is relieved.', 'The moneylender wants someone to collect from a person who has gone into the woods.'],
	},
	bathhouse: {
		label: 'Bathhouse',
		name: (r) => pick(r, ['The Bathhouse', 'The Hot Springs', 'The Steam House']),
		detail: ['Hot water, gossip, and a back room for card games.', 'Old stone baths, older than the town.'],
		hook: ['The water has started coming up red.', 'A deal is struck in the steam room every week, and the players overhear one.'],
	},
	library: {
		label: 'Library',
		name: (r) => pick(r, ['The Archive', 'The Scriptorium', 'The Old Library', 'The Hall of Records']),
		detail: ['Chained books and a clerk who reads everything twice.', 'Records of every birth, death and deed in town.'],
		hook: ['A page has been cut from the deed book, and only one family benefits.', 'A scholar wants help finding a book that the library says it never had.'],
	},
	barracks: {
		label: 'Barracks',
		name: (r) => pick(r, ['The Watch House', 'The Barracks', 'The Guardhouse']),
		detail: ['The town watch, a cell, and a sergeant with a long memory.', 'Drills at dawn, dice at dusk.'],
		hook: ['The watch is hiring, no questions asked.', 'A prisoner escaped, and the cell was still locked.'],
	},
	theatre: {
		label: 'Playhouse',
		name: (r) => pick(r, ['The Globe', 'The Swan', 'The Mummers\' Yard', 'The Players\' House']),
		detail: ['A wooden O with a thatched gallery.', 'A new play every week, and riots at some of them.'],
		hook: ['The new play is about a real scandal, and someone wants it stopped.', 'An actor vanished between acts.'],
	},
	jeweller: {
		label: 'Jeweller',
		name: (r, k) => pick(r, [`${last(k)}, Goldsmith`, 'The Gilt Hand', `${last(k)}'s Gems`]),
		detail: ['Rings in a locked case, and a loupe on a chain.', 'Buys and sells, and does not ask where things came from.'],
		hook: ['A ring brought in to sell belongs to the lord\'s missing daughter.', 'The jeweller needs a courier for a small box, and a big fee.'],
	},
	herbalist: {
		label: 'Herbalist',
		name: (r, k) => pick(r, [`${last(k)}'s Garden`, 'The Wise Woman', 'The Herb Cottage']),
		detail: ['Bundles of herbs and a garden out the back.', 'Charms against fever, and some against other things.'],
		hook: ['The herbalist is accused of a death, and the village wants a trial.', 'A child was cured overnight, and the herbalist won\'t say how.'],
	},
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function placeFor(r: Rng, kind: PlaceKind, _t: unknown): PlaceText {
	const k = KINDS[kind];
	const who = person(r);
	return {
		label: k.label,
		name: cap(k.name(r, who)),
		keeper: k.keeperless ? '' : `${who}, who ${pick(r, TRAIT)}`,
		detail: pick(r, k.detail),
		hook: pick(r, k.hook),
	};
}

export const LABELS: Record<PlaceKind, string> = Object.fromEntries(Object.entries(KINDS).map(([k, v]) => [k, v.label])) as Record<PlaceKind, string>;

// Streets and quarters. A hint says what the street passes or where it leads; without one it's named for a trade.
export type StreetHint = 'high' | 'bridge' | 'castle' | 'temple' | 'harbour' | 'gate' | 'mill' | null;
const TRADES = ['Tanners', 'Coopers', 'Weavers', 'Chandlers', 'Cutlers', 'Fullers', 'Bakers', 'Brewers', 'Saddlers', 'Dyers', 'Potters', 'Ropers', 'Glovers', 'Masons', 'Skinners', 'Tinkers'];
const WAYS = ['Street', 'Lane', 'Row', 'Way', 'Walk'];
const HINTED: Record<Exclude<StreetHint, null>, string[]> = {
	high: ['High Street', 'Market Street', 'Broad Street', 'Kings Way'],
	bridge: ['Bridge Street', 'Bridge Lane', 'Ford Street'],
	castle: ['Castle Street', 'Castle Hill', 'Keep Lane'],
	temple: ['Temple Street', 'Chapel Lane', 'Bell Street'],
	harbour: ['Harbour Street', 'Quay Street', 'Wharf Lane', 'Fish Street'],
	gate: ['Gate Street', 'Wall Lane', 'Bar Street'],
	mill: ['Mill Lane', 'Mill Street', 'Weir Lane'],
};
export function streetName(r: Rng, hint: StreetHint, used: Set<string>): string {
	// a trade names one street only
	const free = (n: string) => !used.has(n) && !used.has(n.split(' ')[0] as string);
	const tries = [...(hint ? HINTED[hint] : []), ...Array.from({ length: 12 }, () => `${pick(r, TRADES)} ${pick(r, WAYS)}`)];
	const name = tries.find((n) => free(n) && (hint === null || chance(r, 0.8))) ?? tries.find(free) ?? 'Back Lane';
	used.add(name);
	if (TRADES.includes(name.split(' ')[0] as string)) used.add(name.split(' ')[0] as string);
	return name;
}

export type QuarterHint = 'middle' | 'docks' | 'castle' | 'temple' | 'river' | 'north' | 'south' | 'east' | 'west';
const QUARTERS: Record<QuarterHint, string[]> = {
	middle: ['Old Town', 'Market Ward', 'the Chepe'],
	docks: ['the Docks', 'Fish Quarter', 'Saltside', 'the Strand'],
	castle: ['Castle Ward', 'Castle Hill', 'Keepside'],
	temple: ['Temple Ward', 'the Close', 'Bellside'],
	river: ['Riverside', 'the Bankside', 'Waterside'],
	north: ['Northgate', 'the Northern Ward', 'Highfield'],
	south: ['Southgate', 'the Southern Ward', 'Lowtown'],
	east: ['Eastgate', 'the Eastern Ward', 'Dawnside'],
	west: ['Westgate', 'the Western Ward', 'Duskside'],
};
const TRADE_QUARTERS = ['Tanners Quarter', 'Weavers Quarter', 'the Narrows', 'New Town', 'the Warrens', 'Coopers Quarter', 'Dyers Quarter'];
export function quarterName(r: Rng, hint: QuarterHint, used: Set<string>): string {
	const tries = [...QUARTERS[hint], ...(chance(r, 0.4) ? [] : TRADE_QUARTERS)];
	const name = tries.find((n) => !used.has(n) && chance(r, 0.6)) ?? tries.find((n) => !used.has(n)) ?? pick(r, TRADE_QUARTERS);
	used.add(name);
	return name;
}
