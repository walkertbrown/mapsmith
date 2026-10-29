// Seeded randomness: a seed word always gives the same town.

export type Rng = () => number;

// FNV-1a over the seed text, so any word or number works as a seed.
export function hashSeed(seed: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < seed.length; i++) {
		h ^= seed.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return h >>> 0;
}

// mulberry32
export function makeRng(seed: string | number): Rng {
	let a = (typeof seed === 'number' ? seed : hashSeed(seed)) >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

// A separate stream for one part of the town, so adding a step later doesn't reshuffle the others.
export function fork(r: Rng, label: string): Rng {
	return makeRng((Math.floor(r() * 4294967296) ^ hashSeed(label)) >>> 0);
}

export const range = (r: Rng, lo: number, hi: number) => lo + (hi - lo) * r();
export const int = (r: Rng, lo: number, hi: number) => Math.floor(range(r, lo, hi + 1));
export const chance = (r: Rng, p: number) => r() < p;
export function pick<T>(r: Rng, a: readonly T[]): T {
	return a[Math.floor(r() * a.length)] as T;
}
export function shuffle<T>(r: Rng, a: T[]): T[] {
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(r() * (i + 1));
		[a[i], a[j]] = [a[j] as T, a[i] as T];
	}
	return a;
}

// Smooth value noise in [0, 1], for coastlines, woods and field colours.
export function makeNoise(r: Rng): (x: number, y: number) => number {
	const N = 256;
	const vals = Array.from({ length: N }, () => r());
	const perm = shuffle(r, Array.from({ length: N }, (_, i) => i));
	const at = (i: number, j: number) => vals[(perm[(perm[i & 255] as number) + j & 255] as number)] as number;
	const fade = (t: number) => t * t * (3 - 2 * t);
	const one = (x: number, y: number) => {
		const i = Math.floor(x), j = Math.floor(y);
		const fx = fade(x - i), fy = fade(y - j);
		const a = at(i, j), b = at(i + 1, j), c = at(i, j + 1), d = at(i + 1, j + 1);
		return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
	};
	return (x, y) => (one(x, y) * 0.6 + one(x * 2.1 + 17, y * 2.1 + 5) * 0.3 + one(x * 4.3 + 3, y * 4.3 + 29) * 0.1);
}
