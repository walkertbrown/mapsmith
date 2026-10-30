// Solo play on a dungeon: the rooms you have been in are seen, and so are the corridors and open
// ground that join them; every other room stays dark until you go through a door into it.

import type { DungeonKind, DungeonSize } from './dungeon';
import type { Mood, ShipSize } from './ship/generate';
import { int, makeRng, pick } from './rng';
import { FIRST_ROOM, VOID, bounds, cellAt, idx, keyEntries, sideDelta, type Deck } from './ship/model';

export interface Explored {
	/** 1 for every cell that is seen, by idx(x, y) */
	seen: Uint8Array;
	/** the doors you can go through next: the dark side's square and the room's number */
	ways: { x: number; y: number; num: number }[];
	/** the ids of the rooms that have been explored */
	rooms: Set<number>;
}

/** What can be seen once the rooms numbered `nums` have been explored. The ways in (`from`, squares; room 1 when
 *  there are none) always have been. */
export function explore(d: Deck, nums: number[], from: [number, number][] = []): Explored {
	const b = bounds(d);
	const seen = new Uint8Array(d.cells.length);
	if (!b) return { seen, ways: [], rooms: new Set() };
	const keyed = new Map(keyEntries(d).map((e) => [e.id, e.num]));
	// every square belongs to a place: a keyed room by its id, anything else (corridors, a keep's yard
	// and towers) by the first square of its run, so each length of corridor is one place
	const place = new Int32Array(d.cells.length).fill(-1);
	const squares = new Map<number, number[]>();
	for (let y = b.y0; y < b.y1; y++)
		for (let x = b.x0; x < b.x1; x++) {
			const at = idx(x, y), c = cellAt(d, x, y);
			if (c === VOID || place[at] !== -1) continue;
			const id = c >= FIRST_ROOM && keyed.has(c) ? c : -2 - at;
			const list: number[] = [];
			const todo = [[x, y] as const];
			place[at] = id;
			while (todo.length) {
				const [px, py] = todo.pop()!;
				list.push(idx(px, py));
				for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
					const nx = px + dx, ny = py + dy;
					if (cellAt(d, nx, ny) !== c || place[idx(nx, ny)] !== -1) continue;
					place[idx(nx, ny)] = id;
					todo.push([nx, ny]);
				}
			}
			squares.set(id, list);
		}
	// doors join places; a secret door is only wall until someone finds it, and a window lets no one through
	const links = new Map<number, { to: number; x: number; y: number }[]>();
	for (const k of d.doors) {
		if (k.kind === 'secret' || k.kind === 'window') continue;
		const [dx, dy] = sideDelta(k.side);
		const a = place[idx(k.x, k.y)] as number, z = cellAt(d, k.x + dx, k.y + dy) === VOID ? -1 : (place[idx(k.x + dx, k.y + dy)] as number);
		if (a === -1 || z === -1 || a === z) continue;
		for (const [p, q, x, y] of [[a, z, k.x + dx, k.y + dy], [z, a, k.x, k.y]] as const) links.set(p, [...(links.get(p) ?? []), { to: q, x, y }]);
	}
	const been = new Set(nums);
	const open = new Set<number>();
	for (const [x, y] of from) if ((place[idx(x, y)] ?? -1) !== -1) open.add(place[idx(x, y)] as number);
	const first = Math.min(...keyed.values());
	for (const [id, num] of keyed) if ((!open.size && num === first) || been.has(num)) open.add(id);
	// from the rooms you've been in, out along every corridor and across open ground
	const todo = [...open];
	while (todo.length) {
		for (const l of links.get(todo.pop()!) ?? []) {
			if (open.has(l.to) || l.to >= FIRST_ROOM) continue;
			open.add(l.to);
			todo.push(l.to);
		}
	}
	const ways: Explored['ways'] = [];
	for (const id of open) {
		for (const i of squares.get(id) ?? []) seen[i] = 1;
		for (const l of links.get(id) ?? []) {
			const num = keyed.get(l.to);
			if (num !== undefined && !open.has(l.to) && !ways.some((w) => w.x === l.x && w.y === l.y)) ways.push({ x: l.x, y: l.y, num });
		}
	}
	return { seen, ways, rooms: new Set([...open].filter((id) => keyed.has(id))) };
}

/** Where you come aboard a ship's deck: inside its airlocks, or else at the ladders and lifts from the next deck. */
export function boarding(d: Deck): [number, number][] {
	const locks = d.doors.filter((k) => k.kind === 'airlock').map((k): [number, number] => {
		const [dx, dy] = sideDelta(k.side);
		return cellAt(d, k.x, k.y) === VOID ? [k.x + dx, k.y + dy] : [k.x, k.y];
	});
	if (locks.length) return locks;
	return d.stamps.filter((st) => st.link && (st.kind === 'ladder' || st.kind === 'lift' || st.kind === 'stairs')).map((st) => [st.x, st.y]);
}

/** The `explore:` line's numbers, or null when it is off. */
export function parseExplored(v: string): number[] | null {
	if (/^(off|no|none|false)$/i.test(v.trim())) return null;
	return [...new Set(v.split(/[\s,]+/).map(Number).filter((n) => Number.isInteger(n) && n >= 1))].sort((a, b) => a - b);
}

// What you find when you walk in. A foe is [one of them, several of them]; # is how many.
type Foe = [string, string];
type Kind = DungeonKind | Mood;
const FOES: Record<Kind, Foe[]> = {
	crypt: [
		['A skeleton climbs out of its niche', '# skeletons climb out of the niches'],
		['A ghoul crouches over an open coffin', '# ghouls crouch over an open coffin'],
		['A giant rat has nested in the bones', '# giant rats have nested in the bones'],
		['A ghost in burial clothes asks who you are', '# ghosts in burial clothes ask who you are'],
		['A grave robber freezes with a sack half full', '# grave robbers freeze with their sacks half full'],
		['A wight sits in a stone chair, waiting', 'A wight sits in a stone chair, with # dead kneeling round it'],
		['A swarm of beetles pours out of a cracked urn', '# swarms of beetles pour out of cracked urns'],
	],
	keep: [
		['A bandit looks up from a game of dice', '# bandits look up from a game of dice'],
		['A wolf has made a den here', '# wolves have made a den here'],
		['A goblin is prying at a locked chest', '# goblins are prying at a locked chest'],
		['An ogre is asleep against the wall', 'An ogre is asleep against the wall, and # goblins keep watch over it'],
		['A deserter in old livery begs you not to tell', '# deserters in old livery reach for their swords'],
		['A skeleton of the old garrison still stands its post', '# skeletons of the old garrison still stand their posts'],
		['A giant spider waits in the rafters', '# giant spiders wait in the rafters'],
	],
	intact: [
		['A crew member looks up from their work', '# crew look up from their work'],
		['A guard levels a stunner at you', '# guards level stunners at you'],
		['A passenger asks if you are lost', '# passengers ask if you are lost'],
		['A mechanic waves you over to hold a panel', '# mechanics stop arguing over an open panel'],
		['A stowaway freezes behind the crates', '# stowaways freeze behind the crates'],
		['An officer wants to know who let you aboard', 'An officer and # guards want to know who let you aboard'],
	],
	derelict: [
		['A scavenger is cutting out the wiring', '# scavengers are cutting out the wiring'],
		['A security drone wakes up and turns towards you', '# security drones wake up and turn towards you'],
		['Something that used to be crew drifts towards you', '# things that used to be crew drift towards you'],
		['A rat the size of a dog comes out of the vents', '# rats the size of dogs come out of the vents'],
		['A survivor points a flare gun at you', '# survivors point flare guns at you'],
		['A repair bot welds the hatch shut behind you', '# repair bots weld the hatches shut behind you'],
	],
};
const SIGNS: Record<Kind, string[]> = {
	crypt: [
		'Fresh footprints in the dust lead further in.',
		'A candle on the floor is still warm.',
		'Something scratches behind the far wall, then stops.',
		'Someone has chalked one word on the door: back.',
		'A coffin lid lies on the floor, pushed off from inside.',
		'The air smells of turned earth and smoke.',
	],
	keep: [
		'A campfire, cold since this morning.',
		'Boot prints, and something heavy dragged away.',
		'Voices further in, then quiet.',
		'A crossbow bolt in the door frame, still bright.',
		'Blood on the flagstones, and none of it yours.',
		'A tripwire that someone has already cut.',
	],
	intact: [
		'A mug of coffee, still hot.',
		'Footsteps on the deck above.',
		'The intercom clicks on, then off.',
		'A hatch down the corridor locks itself.',
		'A bunk still warm, and a jacket over the chair.',
		'Someone has written a number on the bulkhead in marker.',
	],
	derelict: [
		'Scratches on the inside of the hatch.',
		'A helmet lamp blinking on the floor.',
		'Something taps on the hull, in a pattern.',
		'A log screen loops the same ten seconds.',
		'Frost on the walls, and handprints in it.',
		'The emergency lights come on as you enter.',
	],
};
const TRAPS: Record<Kind, string[]> = {
	crypt: [
		'A flagstone sinks, and darts fly from the walls.',
		'The floor gives way into a pit of old bones.',
		'A sealed jar breaks, and grave dust fills the air.',
		'The door swings shut and a bar drops on the far side.',
		'A blade swings out of the doorway, rusted but quick.',
	],
	keep: [
		'The rotten floor gives way to the cellar below.',
		'Stones fall from above the door.',
		'A rusted trap snaps shut under the straw.',
		'A loose stair throws you down.',
		'A bell on a string rings somewhere further in.',
	],
	intact: [
		'A camera turns to follow you.',
		'The hatch seals behind you and the air starts to cycle.',
		'A maintenance drone takes you for debris.',
		'A loose panel sparks as you pass.',
		'The lights go red. Somebody has noticed you.',
	],
	derelict: [
		'A pressure door slams, and the room starts to vent.',
		'A live cable thrashes in the dark.',
		'The gravity cuts out, then comes back hard.',
		'A coolant pipe bursts in a white cloud.',
		'A turret still guards the hatch, and it still works.',
	],
};
const QUIET: Record<Kind, string[]> = {
	crypt: ['Empty and quiet. Take a breath.', 'Quiet. Whatever was here has gone.', 'Nothing stirs. You could rest here a while.'],
	keep: ['Empty and quiet. Take a breath.', 'Quiet. Whatever was here has gone.', 'Nothing stirs. You could rest here a while.'],
	intact: ['Nobody here. The lights hum.', 'Empty, and tidy. Someone will be back.', 'Quiet, apart from the air.'],
	derelict: ['Dark, cold and empty.', 'Nothing but drifting debris.', 'The air is thin, but it holds.'],
};
const HOW_MANY: Record<DungeonSize | ShipSize, [number, number]> = { lair: [1, 2], dungeon: [1, 4], deep: [2, 6], shuttle: [1, 2], corvette: [1, 3], freighter: [1, 4], station: [2, 6] };
const WORDS = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six'];

/** What happens when you first walk into room `num`, the same every time for one dungeon or ship. */
export function onEntering(seed: string, kind: Kind, size: DungeonSize | ShipSize, num: number): string {
	const r = makeRng(`${seed}:${kind}:${size}:enter:${num}`);
	const roll = int(r, 1, 6);
	if (roll <= 2) return pick(r, QUIET[kind]);
	if (roll === 3) return pick(r, SIGNS[kind]);
	if (roll === 4) return pick(r, TRAPS[kind]);
	const [one, many] = pick(r, FOES[kind]);
	const n = int(r, ...HOW_MANY[size]);
	return n === 1 ? `${one}.` : `${many.replace('#', many.startsWith('#') ? WORDS[n] as string : (WORDS[n] as string).toLowerCase())}.`;
}
