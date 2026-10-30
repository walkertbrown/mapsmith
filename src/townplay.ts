// Solo play in a town: you know the streets, but not who is where. You start at place 1; the places near
// the ones you have been to are the ones you can walk to next, and each walk has something on the way.

import { int, makeRng, pick } from './rng';
import type { Town } from './town';

export interface Walked {
	/** the numbers of the places you have been to, place 1 first */
	seen: Set<number>;
	/** the numbers of the places you can walk to next */
	ways: number[];
}

/** How many of the nearest places each place you have been to leads on to. */
const NEAR = 2;

export function walk(t: Town, nums: number[]): Walked {
	const seen = new Set([1, ...nums.filter((n) => n >= 1 && n <= t.places.length)]);
	const ways = new Set<number>();
	for (const n of seen) {
		const at = t.places[n - 1]!.at;
		t.places
			.filter((p) => !seen.has(p.n))
			.map((p) => ({ n: p.n, d: Math.hypot(p.at.x - at.x, p.at.y - at.y) }))
			.sort((a, b) => a.d - b.d || a.n - b.n)
			.slice(0, NEAR)
			.forEach((p) => ways.add(p.n));
	}
	return { seen, ways: [...ways].sort((a, b) => a - b) };
}

const QUIET = [
	'The street is quiet. A dog follows you halfway, then loses interest.',
	'Washing hangs across the lane, and somebody is singing behind it.',
	'A cart has lost a wheel and blocks the way. You go round by the back lanes.',
	'Rain, sudden and hard. Everyone else is under the eaves.',
	'Market noise from a few streets over, and nothing else.',
];
const RUMOURS = [
	'Two porters argue about whether the bridge toll is going up again.',
	'A crier reads out a reward for news of a missing boat. Nobody looks up.',
	'Someone has chalked a mark on three doors in this street. All the same mark.',
	'A child sells you a story about a ghost in the old well for a copper. It is a good story.',
	'Talk outside a doorway: the watch were up all night, and nobody will say why.',
];
const TROUBLE = [
	'A cutpurse brushes past you. Check your belt.',
	'A brawl spills out of a doorway and into your path.',
	'The watch stop you and ask your business, and they ask it twice.',
	'A runaway goat, and the man chasing it wants your help.',
	'Somebody is following you. They stop when you stop.',
];
const MEETINGS = [
	'An old soldier asks for a coin and offers a piece of advice for it.',
	'A tinker with a tray of odds and ends, one of which is not what it seems.',
	'A messenger running the wrong way, lost, with a sealed letter.',
	'A priest collecting for the poor, who knows everyone in this quarter.',
	'A stranger who seems to know your name.',
];

/** What happens on the way to place `num`, the same each time for the same town. */
export function onTheWay(seed: string, num: number): string {
	const r = makeRng(`${seed}:town:way:${num}`);
	const roll = int(r, 1, 6);
	return pick(r, roll <= 2 ? QUIET : roll === 3 ? RUMOURS : roll === 4 ? TROUBLE : MEETINGS);
}
