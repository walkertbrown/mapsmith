// A region: the country around the towns, a long day's ride across. Towns and villages along the rivers and
// the shore, roads between them that go round high ground, woods, hills and the odd ruin, mine or barrow.
// Every settlement is numbered, and its note holds a town block drawn to match where it stands; every ruin
// holds a dungeon block.

import { add, chaikin, dist, dot, lerp, perp, pt, scale, sub, type Pt } from './geom';
import { townName } from './names';
import { LIGHT, el, f, g, type Node, type Palette, type TownPaint } from './render';
import { chance, fork, hashSeed, int, makeNoise, makeRng, pick, range, shuffle } from './rng';
import { contours, type Relief, type Terrain } from './terrain';
import type { Side, Size, Water } from './town';

export type RegionWater = 'river' | 'coast' | 'none';
export const REGION_WATERS: RegionWater[] = ['river', 'coast', 'none'];

export interface RegionOptions {
	seed: string;
	water: RegionWater;
	side: Side; // where the sea is
	terrain: Terrain; // how much high ground
	land: 'parchment' | 'green';
	name?: string;
}

export type SiteKind = 'settlement' | 'keep' | 'crypt' | 'mine';

export interface Site {
	n: number; // its number on the map, from 1
	kind: SiteKind;
	name: string;
	at: Pt;
	/** a settlement's town: what its own map block says */
	size?: Size;
	water?: Water;
	side?: Side;
	terrain?: Terrain;
	walls?: boolean;
	label: string; // "Market town on the coast", "Ruined keep"
	line: string; // a sentence on the place
}

export interface Region {
	opts: RegionOptions;
	name: string;
	w: number;
	h: number;
	km: number; // kilometres across the map
	sea: Pt[][]; // rings, even-odd
	river: Pt[] | null;
	relief: Relief[];
	rockLevel: number | null;
	trees: { x: number; y: number; r: number }[];
	roads: Pt[][];
	tracks: Pt[][]; // the paths out to the ruins
	sites: Site[];
}

export const RW = 1000;
export const REGION_DEFAULTS: RegionOptions = { seed: 'mapsmith', water: 'river', side: 'south', terrain: 'hills', land: 'parchment' };

const SIDE_DIR: Record<Side, Pt> = { north: pt(0, -1), south: pt(0, 1), east: pt(1, 0), west: pt(-1, 0) };
const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const smooth = (x: number) => {
	const t = clamp(x);
	return t * t * (3 - 2 * t);
};

const SIZE_WORD: Record<Size, string> = { hamlet: 'Hamlet', village: 'Village', town: 'Market town', 'large-town': 'Large town', city: 'City' };
const WATER_WORD: Record<Water, string> = { none: '', river: ' on the river', coast: ' on the coast', estuary: ' at the river mouth', lake: ' by the lake' };

const LINES: Record<Size, string[]> = {
	city: ['The seat of the region, where the roads and the taxes go.', 'Walls, a cathedral and a market every day but the holy one.', 'Everyone here has a cousin in the city, and an opinion of it.'],
	'large-town': ['A walled town with two markets and a quarrel between them.', 'Rich on wool and tolls, and proud of both.', 'Its fair draws people from three days away.'],
	town: ['A market town: one good inn, one bad one, and a square between.', 'Walled when times were worse; the gates are open now.', 'The kind of town where a stranger is talked about by supper.'],
	village: ['A green, a church, a mill and an alehouse.', 'Everyone farms, and everyone watches the road.', 'They brew something here that travellers ask about.'],
	hamlet: ['A few farms round a well.', 'A handful of houses that owe rent to someone far away.', 'Smoke from three chimneys, and a dog that barks at the road.'],
};
const SITE_TEXT: Record<Exclude<SiteKind, 'settlement'>, { label: string; lines: string[]; names: string[] }> = {
	keep: {
		label: 'Ruined keep',
		lines: ['Its lord died without an heir, and the land has not settled who owns it.', 'Burned in the last war. Lights are seen in it on still nights.', 'The villagers take stone from its walls, and lately they stopped.'],
		names: ['Keep', 'Tower', 'Castle'],
	},
	crypt: {
		label: 'Old barrow',
		lines: ['A grassy mound with a stone door the farmers plough around.', 'The old kings were buried here, or so the shepherds say.', 'Someone has dug at its door this spring.'],
		names: ['Barrow', 'Howe', 'Mound'],
	},
	mine: {
		label: 'Old mine',
		lines: ['Worked out two generations ago, they say. Not everyone agrees.', 'The adit is boarded, and the boards were pulled down from inside.', 'The ore cart still sits on its rails at the mouth.'],
		names: ['Delving', 'Mine', 'Workings'],
	},
};

const REGION_ENDS = ['Vale', 'Downs', 'March', 'Reach', 'Weald', 'Dale', 'Moors', 'Shire'];

export function generateRegion(o: Partial<RegionOptions> = {}): Region {
	const opts: RegionOptions = { ...REGION_DEFAULTS, ...o };
	const W = RW;
	const r0 = makeRng(`${opts.seed}:region:${opts.water}:${opts.side}:${opts.terrain}`);
	const rLand = fork(r0, 'land'), rWater = fork(r0, 'water'), rSite = fork(r0, 'sites'), rName = fork(r0, 'names'), rWood = fork(r0, 'woods');
	const C = pt(W / 2, W / 2);
	const toSea = SIDE_DIR[opts.side];
	const coast = opts.water === 'coast';

	// the sea: past a noisy line across the map on its side
	const cn = makeNoise(rWater);
	const seaF = (p: Pt) => (coast ? dot(sub(p, C), toSea) - (W * 0.27 + (cn(p.x / 170, p.y / 170) - 0.5) * 170) : -1);
	const isSea = (p: Pt) => seaF(p) > 0;

	// the land rises away from the sea, or toward a side the seed picks
	const up = coast ? scale(toSea, -1) : SIDE_DIR[pick(rLand, ['north', 'south', 'east', 'west'] as Side[])];
	const n1 = makeNoise(rLand), n2 = makeNoise(rLand), n3 = makeNoise(rLand);
	const amp = opts.terrain === 'flat' ? 0.45 : opts.terrain === 'hills' ? 0.8 : 1;
	const rawH = (p: Pt) => {
		const climb = clamp(0.5 + dot(sub(p, C), up) / (W * 0.9));
		const base = n1(p.x / 260, p.y / 260) * 0.65 + n2(p.x / 110, p.y / 110) * 0.35;
		if (opts.terrain === 'mountains') {
			const ridge = 1 - Math.abs(2 * n3(p.x / 300, p.y / 300) - 1);
			return clamp((climb ** 1.4 * (0.2 + 0.9 * ridge ** 1.6) + (base - 0.5) * 0.35) * amp);
		}
		return clamp(((base - 0.38) * 1.6 + (climb - 0.5) * 0.5) * amp);
	};

	// the river: from the high side down to the sea, or across the map, wandering
	let river: Pt[] | null = null;
	if (opts.water !== 'none') {
		const across = perp(up);
		const from = add(add(C, scale(up, W * 0.62)), scale(across, range(rWater, -0.25, 0.25) * W));
		const to = coast ? add(add(C, scale(toSea, W * 0.62)), scale(across, range(rWater, -0.2, 0.2) * W)) : add(add(C, scale(up, -W * 0.62)), scale(across, range(rWater, -0.25, 0.25) * W));
		const wn = makeNoise(rWater);
		const pts: Pt[] = [];
		const N = 60;
		for (let i = 0; i <= N; i++) {
			const t = i / N;
			const bend = (wn(t * 3.2, 0.5) - 0.5) * 2 * 160 * Math.sin(Math.PI * t);
			const q = add(lerp(from, to, t), scale(across, bend));
			pts.push(q);
			if (coast && isSea(q) && i > 2) {
				pts.push(add(q, scale(toSea, 60))); // on into the sea, under it
				break;
			}
		}
		river = chaikin(pts, 2);
	}
	// distance to the river, worked out once on a grid of 5 and read back between the cells
	const riverDist = river ? distanceField(river, W, 5) : null;
	// rivers cut valleys; the shore is low
	const height = (p: Pt) => {
		let v = rawH(p);
		if (riverDist) v *= smooth(riverDist(p) / 90 - 0.1);
		if (coast) v *= smooth(-seaF(p) / 140);
		return isSea(p) ? 0 : v;
	};

	const levels = opts.terrain === 'flat' ? [0.3, 0.45] : opts.terrain === 'hills' ? [0.2, 0.32, 0.44, 0.56, 0.68] : [0.16, 0.26, 0.36, 0.46, 0.56, 0.66, 0.76, 0.86];
	const rockLevel = opts.terrain === 'mountains' ? 0.66 : null;
	const relief = contours(height, W, 10, levels);
	const sea = coast ? (contours((p) => Math.max(0, seaF(p) + 1), W, 10, [1])[0]?.rings ?? []) : [];

	// settlements: the best ground, by the water and low down, kept apart
	const nearRiver = (p: Pt) => (riverDist ? riverDist(p) : Infinity);
	const shore = (p: Pt) => (coast ? -seaF(p) : Infinity);
	const cands: { p: Pt; score: number }[] = [];
	const gn = makeNoise(rSite);
	for (let y = 70; y <= W - 70; y += 25)
		for (let x = 70; x <= W - 70; x += 25) {
			const p = pt(x + range(rSite, -10, 10), y + range(rSite, -10, 10));
			if (isSea(p) || (Math.abs(p.x - W / 2) < 230 && p.y < 110)) continue; // not under the title
			const h = height(p), dr = nearRiver(p), ds = shore(p);
			if (h > (opts.terrain === 'mountains' ? 0.5 : 0.6) || dr < 14 || ds < 14) continue;
			const score = gn(p.x / 150, p.y / 150) * 0.6 + (dr < 45 ? 0.8 : 0) + (ds < 50 ? 0.7 : 0) - h * 1.2;
			cands.push({ p, score });
		}
	cands.sort((a, b) => b.score - a.score);
	const want = int(rSite, 7, 10);
	const placed: { p: Pt; score: number }[] = [];
	for (const c of cands) {
		if (placed.length >= want) break;
		if (placed.every((q) => dist(q.p, c.p) > 125)) placed.push(c);
	}
	const sizes: Size[] = [coast || river ? 'city' : 'large-town', 'town', 'town', 'village', 'village', 'village', 'hamlet', 'hamlet', 'hamlet', 'hamlet'];
	const used = new Set<string>();
	const sites: Site[] = placed.map((c, i) => {
		const p = c.p, size = sizes[i] ?? 'hamlet';
		const atRiver = nearRiver(p) < 50, atSea = shore(p) < 60;
		const water: Water = atSea && atRiver ? 'estuary' : atSea ? 'coast' : atRiver ? 'river' : 'none';
		let top = 0;
		for (let a = 0; a < 8; a++) top = Math.max(top, height(add(p, pt(Math.cos(a) * 70, Math.sin(a) * 70))));
		const terrain: Terrain = top > 0.5 ? 'mountains' : top > 0.22 ? 'hills' : 'flat';
		let name = townName(rName, { water });
		for (let k = 0; used.has(name) && k < 10; k++) name = townName(rName, { water });
		used.add(name);
		return {
			n: 0, kind: 'settlement', name, at: p, size, water, side: opts.side, terrain,
			walls: size === 'city' || size === 'large-town' || (size === 'town' && chance(rSite, 0.6)),
			label: `${SIZE_WORD[size]}${WATER_WORD[water]}`,
			line: pick(rSite, LINES[size]),
		};
	});

	// ruins, barrows and mines, out in the country away from the towns
	const others: SiteKind[] = shuffle(rSite, ['keep', 'crypt', 'mine', pick(rSite, ['keep', 'crypt'] as SiteKind[])]);
	for (const kind of others) {
		for (let k = 0; k < 200; k++) {
			const p = pt(range(rSite, 80, W - 80), range(rSite, 80, W - 80));
			const h = height(p);
			if (isSea(p) || nearRiver(p) < 30 || shore(p) < 30 || (Math.abs(p.x - W / 2) < 230 && p.y < 110)) continue;
			if (kind === 'mine' ? h < 0.3 && k < 150 : h > 0.6) continue;
			if (sites.some((s) => dist(s.at, p) < 95)) continue;
			const t = SITE_TEXT[kind as Exclude<SiteKind, 'settlement'>];
			const base = townName(rName, { water: 'none' });
			sites.push({ n: 0, kind, name: kind === 'mine' ? `${base} ${pick(rName, t.names)}` : `${base} ${pick(rName, t.names)}`, at: p, label: t.label, line: pick(rSite, t.lines) });
			break;
		}
	}
	const rank = (s: Site) => (s.kind === 'settlement' ? ['city', 'large-town', 'town', 'village', 'hamlet'].indexOf(s.size ?? 'hamlet') : 9);
	sites.sort((a, b) => rank(a) - rank(b));
	sites.forEach((s, i) => (s.n = i + 1));

	// roads: a tree joining the settlements by their nearest neighbours, plus a loop or two, routed round
	// high ground; the big places have roads off the map
	const towns = sites.filter((s) => s.kind === 'settlement');
	const step = 10, G = Math.ceil(W / step) + 1;
	const rn = makeNoise(fork(r0, 'roads'));
	const cost = (p: Pt) => {
		if (isSea(p)) return Infinity;
		const h = height(p);
		return 1 + rn(p.x / 60, p.y / 60) * 1.2 + h * h * 30 + (rockLevel !== null && h > rockLevel ? 40 : 0);
	};
	const costs = new Float32Array(G * G);
	for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) costs[j * G + i] = cost(pt(i * step, j * step));
	const route = (a: Pt, b: Pt): Pt[] | null => {
		const ia = Math.round(a.x / step) + Math.round(a.y / step) * G, ib = Math.round(b.x / step) + Math.round(b.y / step) * G;
		const best = new Float32Array(G * G).fill(Infinity), from = new Int32Array(G * G).fill(-1);
		best[ia] = 0;
		const heap = new Heap();
		heap.push(0, ia);
		const hx = (i: number) => Math.hypot((i % G) - (ib % G), Math.floor(i / G) - Math.floor(ib / G));
		const done = new Uint8Array(G * G);
		while (heap.size) {
			const i = heap.pop();
			if (done[i]) continue;
			done[i] = 1;
			if (i === ib) break;
			const x = i % G, y = Math.floor(i / G);
			for (let dy = -1; dy <= 1; dy++)
				for (let dx = -1; dx <= 1; dx++) {
					if (!dx && !dy) continue;
					const nx = x + dx, ny = y + dy;
					if (nx < 0 || ny < 0 || nx >= G || ny >= G) continue;
					const k = ny * G + nx, c = costs[k] as number;
					if (c === Infinity) continue;
					const nb = (best[i] as number) + (dx && dy ? 1.414 : 1) * ((c + (costs[i] as number)) / 2);
					if (nb < (best[k] as number)) {
						best[k] = nb;
						from[k] = i;
						heap.push(nb + hx(k), k);
					}
				}
		}
		if (from[ib] === -1 && ia !== ib) return null;
		const out: Pt[] = [];
		for (let i = ib; i !== -1; i = from[i] as number) out.push(pt((i % G) * step, Math.floor(i / G) * step));
		out.reverse();
		out[0] = a;
		out[out.length - 1] = b;
		return chaikin(out.filter((_, k) => k % 2 === 0 || k === out.length - 1), 3);
	};
	const roads: Pt[][] = [];
	const linked = new Set<string>();
	const join = (a: Site, b: Site) => {
		const key = [a.n, b.n].sort().join('-');
		if (linked.has(key)) return;
		linked.add(key);
		const line = route(a.at, b.at);
		if (line) roads.push(line);
	};
	const inTree = towns.slice(0, 1);
	while (inTree.length < towns.length) {
		let best: [Site, Site, number] | null = null;
		for (const s of towns)
			if (!inTree.includes(s))
				for (const t of inTree) {
					const dd = dist(s.at, t.at);
					if (!best || dd < best[2]) best = [s, t, dd];
				}
		if (!best) break;
		join(best[0], best[1]);
		inTree.push(best[0]);
	}
	for (const s of towns.slice(0, 4)) {
		const near = towns.filter((t) => t !== s).sort((a, b) => dist(a.at, s.at) - dist(b.at, s.at))[1];
		if (near && dist(near.at, s.at) < 330) join(s, near);
	}
	// roads off the map from the two biggest places, away from the sea
	for (const s of towns.slice(0, 2)) {
		const dirs = (['north', 'south', 'east', 'west'] as Side[]).filter((d) => !(coast && d === opts.side));
		const d = dirs.sort((a, b) => edgeDist(s.at, a, W) - edgeDist(s.at, b, W))[0] as Side;
		const v = SIDE_DIR[d];
		const end = pt(clamp(s.at.x + v.x * W, 0, W), clamp(s.at.y + v.y * W, 0, W));
		const line = route(s.at, end);
		if (line) roads.push(line);
	}
	// tracks out to the ruins from the nearest place
	const tracks: Pt[][] = [];
	for (const s of sites.filter((x) => x.kind !== 'settlement')) {
		const t = towns.slice().sort((a, b) => dist(a.at, s.at) - dist(b.at, s.at))[0];
		const line = t ? route(t.at, s.at) : null;
		if (line) tracks.push(line);
	}

	// woods: where the woods noise is high, off the roads, the water and the tops
	const trees: { x: number; y: number; r: number }[] = [];
	const wn = makeNoise(rWood);
	// cells of 4 near a road or track, so the woods stand back from them
	const M = Math.ceil(W / 4) + 1, onWay = new Uint8Array(M * M);
	for (const l of [...roads, ...tracks])
		for (let k = 1; k < l.length; k++) {
			const p0 = l[k - 1] as Pt, p1 = l[k] as Pt, n = Math.ceil(dist(p0, p1) / 2);
			for (let j = 0; j <= n; j++) {
				const q = lerp(p0, p1, j / n);
				for (let dy = -2; dy <= 2; dy++)
					for (let dx = -2; dx <= 2; dx++) {
						const x = Math.round(q.x / 4) + dx, y = Math.round(q.y / 4) + dy;
						if (x >= 0 && y >= 0 && x < M && y < M) onWay[y * M + x] = 1;
					}
			}
		}
	for (let y = 4; y < W; y += 8)
		for (let x = 4; x < W; x += 8) {
			const p = pt(x + range(rWood, -3, 3), y + range(rWood, -3, 3));
			const v = wn(p.x / 140, p.y / 140) + (wn(p.x / 40, p.y / 40) - 0.5) * 0.25;
			if (v < 0.6) continue;
			if (isSea(p) || nearRiver(p) < 10 || shore(p) < 10) continue;
			const h = height(p);
			if (rockLevel !== null && h > rockLevel - 0.05) continue;
			if (sites.some((s) => dist(s.at, p) < (s.kind === 'settlement' ? 34 : 16))) continue;
			if (onWay[Math.round(p.y / 4) * M + Math.round(p.x / 4)]) continue;
			trees.push({ x: p.x, y: p.y, r: range(rWood, 4, 6.5) });
		}

	const root = townName(rName, { water: 'none' });
	// a name that is already a valley or a down takes a word that isn't one: Kettledale March, not Kettledale Vale
	const ends = /(dale|vale|down|downs|moor|moors|wold|field|weald|combe)$/i.test(root) ? ['March', 'Reach', 'Shire'] : REGION_ENDS;
	const name = opts.name ?? `The ${root} ${pick(rName, ends)}`;
	return { opts, name, w: W, h: W, km: 40, sea, river, relief, rockLevel, trees, roads, tracks, sites };
}

// How far each point is from a line: the exact distance near it, spread outward by a two-pass chamfer, and
// read between cells.
function distanceField(line: Pt[], W: number, step: number): (p: Pt) => number {
	const N = Math.ceil(W / step) + 1, D = new Float32Array(N * N).fill(1e9);
	for (let k = 1; k < line.length; k++) {
		const a = line[k - 1] as Pt, b = line[k] as Pt, n = Math.ceil(dist(a, b) / step) + 1;
		for (let j = 0; j <= n; j++) {
			const q = lerp(a, b, j / n), x0 = Math.round(q.x / step), y0 = Math.round(q.y / step);
			for (let y = y0 - 1; y <= y0 + 1; y++)
				for (let x = x0 - 1; x <= x0 + 1; x++) {
					if (x < 0 || y < 0 || x >= N || y >= N) continue;
					const v = Math.hypot(x * step - q.x, y * step - q.y);
					if (v < (D[y * N + x] as number)) D[y * N + x] = v;
				}
		}
	}
	const s1 = step, s2 = step * Math.SQRT2;
	const at = (x: number, y: number) => D[y * N + x] as number;
	for (let y = 0; y < N; y++)
		for (let x = 0; x < N; x++) {
			let v = at(x, y);
			if (x > 0) v = Math.min(v, at(x - 1, y) + s1);
			if (y > 0) v = Math.min(v, at(x, y - 1) + s1);
			if (x > 0 && y > 0) v = Math.min(v, at(x - 1, y - 1) + s2);
			if (x < N - 1 && y > 0) v = Math.min(v, at(x + 1, y - 1) + s2);
			D[y * N + x] = v;
		}
	for (let y = N - 1; y >= 0; y--)
		for (let x = N - 1; x >= 0; x--) {
			let v = at(x, y);
			if (x < N - 1) v = Math.min(v, at(x + 1, y) + s1);
			if (y < N - 1) v = Math.min(v, at(x, y + 1) + s1);
			if (x < N - 1 && y < N - 1) v = Math.min(v, at(x + 1, y + 1) + s2);
			if (x > 0 && y < N - 1) v = Math.min(v, at(x - 1, y + 1) + s2);
			D[y * N + x] = v;
		}
	return (p) => {
		const fx = clamp(p.x / step, 0, N - 1.001), fy = clamp(p.y / step, 0, N - 1.001);
		const x = Math.floor(fx), y = Math.floor(fy), tx = fx - x, ty = fy - y;
		return (at(x, y) * (1 - tx) + at(x + 1, y) * tx) * (1 - ty) + (at(x, y + 1) * (1 - tx) + at(x + 1, y + 1) * tx) * ty;
	};
}

function edgeDist(p: Pt, s: Side, W: number) {
	return s === 'north' ? p.y : s === 'south' ? W - p.y : s === 'west' ? p.x : W - p.x;
}

/** The block a site's note holds: its town, or the dungeon under the ruin. */
export function siteBlock(R: Region, s: Site): string[] {
	const seed = `${R.opts.seed}-${s.n}`;
	if (s.kind === 'settlement')
		return [`seed: ${seed}`, `size: ${s.size}`, `water: ${s.water}`, ...(s.water !== 'none' && s.water !== 'river' ? [`side: ${s.side}`] : []), `terrain: ${s.terrain}`, `walls: ${s.walls ? 'yes' : 'no'}`, `name: ${s.name}`, ...(R.opts.land === 'green' ? ['land: green'] : [])];
	return ['map: dungeon', `kind: ${s.kind}`, 'size: dungeon', `seed: ${seed}`, `name: ${s.kind === 'keep' ? `The ruins of ${s.name}` : s.name}`];
}

const d = (p: Pt[], closed = true) => p.map((q, i) => `${i ? 'L' : 'M'}${f(q.x)} ${f(q.y)}`).join('') + (closed ? 'Z' : '');
const line = (p: Pt[]) => d(p, false);

export interface RegionRender {
	palette?: Palette;
	paint?: TownPaint;
	labels?: boolean;
}

export function renderRegion(R: Region, o: RegionRender = {}): Node {
	const base = o.palette ?? LIGHT;
	const P: Palette = R.opts.land === 'green' ? { ...base, ...base.country } : base;
	const id = `mr${hashSeed(`${R.opts.seed}:${R.opts.water}:${R.opts.side}:${R.opts.terrain}`).toString(36)}`;
	const kids: Node[] = [];
	const W = R.w, H = R.h;
	kids.push(el('rect', { x: 0, y: 0, width: W, height: H, fill: P.land }));
	const pats: Node[] = [];
	const tex = (name: string, uri: string, size: number) => {
		const pid = `${id}-tx-${name}`;
		pats.push(el('pattern', { id: pid, patternUnits: 'userSpaceOnUse', width: size, height: size }, [el('image', { href: uri, width: size, height: size, preserveAspectRatio: 'none' })]));
		return `url(#${pid})`;
	};
	const pt0 = o.paint;
	const op = (x: number) => Math.round(x * (pt0?.strength ?? 0) * 100) / 100;
	if (pt0) {
		kids.push(el('defs', {}, pats));
		kids.push(el('rect', { x: 0, y: 0, width: W, height: H, fill: tex('grass', pt0.grass, 60), opacity: op(0.42) }));
	}

	// high ground, lit from the north-west as in a town
	if (R.relief.length) {
		const defs: Node[] = [], lit: Node[] = [], bands: Node[] = [];
		const whole = { x: 0, y: 0, width: W, height: H };
		R.relief.forEach((b, i) => {
			const band = `${id}-h${i}`, href = `#${band}`;
			defs.push(el('path', { id: band, d: b.rings.map((x) => d(x)).join('') }));
			for (const [side, dx, dy, fill, o2] of [['s', 2.5, 3.5, P.ink, 0.16], ['l', -2, -2.5, P.sun, 0.3]] as const) {
				defs.push(el('mask', { id: `${band}${side}` }, [el('rect', { ...whole, fill: 'black' }), el('use', { href, transform: `translate(${dx} ${dy})`, fill: 'white' }), el('use', { href, fill: 'black' })]));
				lit.push(el('rect', { ...whole, fill, opacity: o2, mask: `url(#${band}${side})` }));
			}
			const rock = R.rockLevel !== null && b.level >= R.rockLevel;
			bands.push(el('use', { href, fill: rock ? P.rock : P.hill, 'fill-opacity': rock ? 0.6 : 0.1 }));
		});
		kids.push(el('defs', {}, defs));
		kids.push(g({ 'fill-rule': 'evenodd' }, bands));
		kids.push(g({}, lit));
		kids.push(g({ fill: 'none', stroke: P.contour, 'stroke-width': 0.8, 'stroke-linejoin': 'round' }, R.relief.map((_, i) => el('use', { href: `#${id}-h${i}` }))));
	}

	// the sea and the river
	const water = pt0 ? tex('water', pt0.water, 80) : null;
	if (R.river) {
		const rd = line(R.river);
		kids.push(el('path', { d: rd, fill: 'none', stroke: P.bank, 'stroke-width': 11, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
		kids.push(el('path', { d: rd, fill: 'none', stroke: P.waterInk, 'stroke-width': 7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
		kids.push(el('path', { d: rd, fill: 'none', stroke: P.water, 'stroke-width': 5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
	}

	if (R.sea.length) {
		const sd = R.sea.map((x) => d(x)).join('');
		kids.push(el('path', { d: sd, fill: 'none', stroke: P.bank, 'stroke-width': 10, 'stroke-linejoin': 'round' }));
		kids.push(el('path', { d: sd, fill: P.water, 'fill-rule': 'evenodd' }));
		if (water) kids.push(el('path', { d: sd, fill: water, 'fill-rule': 'evenodd', opacity: op(0.5) }));
		kids.push(el('path', { d: sd, fill: 'none', stroke: P.waterInk, 'stroke-width': 1.2, 'fill-rule': 'evenodd' }));
	}
	// roads and tracks
	kids.push(g({ fill: 'none', stroke: P.roadInk, 'stroke-width': 5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, R.roads.map((x) => el('path', { d: line(x) }))));
	kids.push(g({ fill: 'none', stroke: P.road, 'stroke-width': 3, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, R.roads.map((x) => el('path', { d: line(x) }))));
	kids.push(g({ fill: 'none', stroke: P.ink, 'stroke-opacity': 0.55, 'stroke-width': 1.6, 'stroke-dasharray': '5 4', 'stroke-linecap': 'round' }, R.tracks.map((x) => el('path', { d: line(x) }))));

	// woods
	kids.push(dots(R.trees, P.treeDark, 1.18, 0.18, 0.24));
	kids.push(dots(R.trees, P.tree, 0.92, 0, 0));
	kids.push(dots(R.trees, P.treeLight, 0.4, -0.3, -0.32));

	// the places: a huddle of roofs for a settlement, a mark for a ruin
	const marks: Node[] = [];
	for (const s of R.sites) {
		const r = makeRng(`${R.opts.seed}:site:${s.n}`);
		if (s.kind === 'settlement') {
			const n = { city: 34, 'large-town': 22, town: 14, village: 8, hamlet: 4 }[s.size ?? 'hamlet'];
			const rad = { city: 24, 'large-town': 18, town: 14, village: 10, hamlet: 7 }[s.size ?? 'hamlet'];
			const roofs: Node[] = [];
			for (let i = 0; i < n; i++) {
				const a = r() * Math.PI * 2, k = Math.sqrt(r()) * rad;
				const c = add(s.at, pt(Math.cos(a) * k, Math.sin(a) * k));
				const w = range(r, 4.5, 7.5), h = range(r, 3.5, 5), ang = Math.round(r() * 4) * 22.5;
				roofs.push(el('rect', { x: f(c.x - w / 2), y: f(c.y - h / 2), width: f(w), height: f(h), transform: `rotate(${ang} ${f(c.x)} ${f(c.y)})`, fill: pick(r, P.roof) }));
			}
			if (s.walls) marks.push(el('circle', { cx: f(s.at.x), cy: f(s.at.y), r: rad + 4, fill: P.street, stroke: P.wall, 'stroke-width': 2.2 }));
			marks.push(g({ stroke: P.ink, 'stroke-width': 0.5 }, roofs));
		} else {
			const c = s.at;
			if (s.kind === 'keep') marks.push(g({ fill: P.rock, stroke: P.ink, 'stroke-width': 1.2 }, [el('path', { d: `M${f(c.x - 8)} ${f(c.y + 6)}V${f(c.y - 4)}h3v-3h3v3h4v-3h3v3h3V${f(c.y + 6)}Z` })]));
			else if (s.kind === 'crypt') marks.push(el('ellipse', { cx: f(c.x), cy: f(c.y + 2), rx: 9, ry: 5, fill: P.hill, 'fill-opacity': 0.5, stroke: P.ink, 'stroke-width': 1.2 }));
			else marks.push(g({ fill: 'none', stroke: P.ink, 'stroke-width': 1.6, 'stroke-linecap': 'round' }, [el('path', { d: `M${f(c.x - 6)} ${f(c.y - 6)}L${f(c.x + 6)} ${f(c.y + 6)}M${f(c.x + 6)} ${f(c.y - 6)}L${f(c.x - 6)} ${f(c.y + 6)}` })]));
		}
	}
	kids.push(g({}, marks));

	// names beside the places
	type Box = { x0: number; x1: number; y0: number; y1: number };
	const set: Box[] = [];
	const halo = { stroke: P.land, 'stroke-width': 5, 'stroke-linejoin': 'round', 'paint-order': 'stroke' };
	kids.push(
		g(
			{ class: 'mapsmith-names', 'font-family': 'Georgia, serif', fill: P.label, ...halo },
			R.sites.map((s) => {
				const big = s.kind === 'settlement' ? { city: 27, 'large-town': 24, town: 22, village: 19, hamlet: 17 }[s.size ?? 'hamlet'] : 16;
				const off = s.kind === 'settlement' ? { city: 30, 'large-town': 24, town: 20, village: 15, hamlet: 12 }[s.size ?? 'hamlet'] : 13;
				// a name goes to the right of its place unless that runs off the map, into another place or into a name already set
				const wide = s.name.length * big * 0.5;
				const box = (left: boolean) => ({ x0: left ? s.at.x - off - wide : s.at.x + off, x1: left ? s.at.x - off : s.at.x + off + wide, y0: s.at.y - big, y1: s.at.y + 6 });
				const hits = (b: Box) => (b.x0 < 4 || b.x1 > W - 4 ? 1 : 0) + R.sites.filter((o) => o !== s && o.at.x > b.x0 - 14 && o.at.x < b.x1 + 14 && o.at.y > b.y0 - 34 && o.at.y < b.y1 + 14).length + set.filter((o) => o.x0 < b.x1 && o.x1 > b.x0 && o.y0 < b.y1 && o.y1 > b.y0).length;
				const right = box(false), leftBox = box(true);
				const left = hits(leftBox) < hits(right);
				set.push(left ? leftBox : right);
				return el('text', { x: f(s.at.x + (left ? -off : off)), y: f(s.at.y + 4), 'font-size': big, 'text-anchor': left ? 'end' : 'start', 'font-style': s.kind === 'settlement' ? 'normal' : 'italic' }, [s.name]);
			}),
		),
	);

	// numbers
	if (o.labels !== false) {
		const rad = 12;
		kids.push(
			g(
				{ 'font-family': 'Georgia, serif', 'font-size': 15, 'text-anchor': 'middle', 'font-weight': 'bold' },
				R.sites.map((s) => {
					const up = s.kind === 'settlement' ? { city: 33, 'large-town': 28, town: 24, village: 20, hamlet: 17 }[s.size ?? 'hamlet'] : 20;
					const c = pt(s.at.x, s.at.y - up);
					return g({ class: 'mapsmith-badge', 'data-place': s.n - 1 }, [
						el('circle', { class: 'mapsmith-ring', cx: f(c.x), cy: f(c.y), r: rad * 2.2, fill: 'none', stroke: P.badgeInk, 'stroke-width': 3, visibility: 'hidden', 'pointer-events': 'none' }),
						el('circle', { cx: f(c.x), cy: f(c.y), r: rad, fill: P.badge, stroke: P.badgeInk, 'stroke-width': 1.5 }),
						el('text', { x: f(c.x), y: f(c.y + 5), fill: P.badgeInk }, [String(s.n)]),
					]);
				}),
			),
		);
	}

	// the region's name, a scale in kilometres and north
	const tw = Math.max(200, R.name.length * 19 + 40);
	kids.push(el('rect', { x: f(W / 2 - tw / 2), y: 18, width: f(tw), height: 40, rx: 3, fill: P.badge, stroke: P.ink, 'stroke-width': 1.2 }));
	kids.push(el('text', { x: W / 2, y: 46, 'text-anchor': 'middle', 'font-family': 'Georgia, serif', 'font-size': 24, 'letter-spacing': 2, fill: P.label }, [R.name.toUpperCase()]));
	const seg = (5 / R.km) * W, x0 = 30, y0 = H - 34;
	const bar: Node[] = [];
	for (let i = 0; i < 2; i++) bar.push(el('rect', { x: f(x0 + i * seg), y: y0, width: f(seg), height: 6, fill: i % 2 ? P.badge : P.ink, stroke: P.ink, 'stroke-width': 1 }));
	for (let i = 0; i <= 2; i++) bar.push(el('text', { x: f(x0 + i * seg), y: y0 - 6, 'text-anchor': 'middle' }, [String(i * 5)]));
	bar.push(el('text', { x: f(x0 + 2 * seg + 10), y: y0 + 7 }, ['km']));
	kids.push(g({ 'font-family': 'Georgia, serif', 'font-size': 12, fill: P.label, ...halo }, bar));
	const c = pt(W - 50, H - 60);
	kids.push(
		g({}, [
			el('circle', { cx: c.x, cy: c.y, r: 22, fill: P.badge, stroke: P.ink, 'stroke-width': 1 }),
			el('path', { d: `M${c.x} ${c.y - 18}L${c.x + 6} ${c.y}L${c.x} ${c.y + 18}L${c.x - 6} ${c.y}Z`, fill: P.ink }),
			el('path', { d: `M${c.x} ${c.y - 18}L${c.x + 6} ${c.y}L${c.x} ${c.y}Z`, fill: P.badgeInk }),
			el('text', { x: c.x, y: c.y - 26, 'text-anchor': 'middle', 'font-family': 'Georgia, serif', 'font-size': 12, fill: P.label }, ['N']),
		]),
	);

	return el('svg', { xmlns: 'http://www.w3.org/2000/svg', viewBox: `0 0 ${W} ${H}`, class: 'mapsmith-svg' }, kids);
}

function dots(list: { x: number; y: number; r: number }[], color: string, k: number, dx: number, dy: number): Node {
	const by = new Map<number, string[]>();
	for (const c of list) {
		const w = Math.max(0.5, Math.round(c.r * k * 4) / 2);
		by.set(w, [...(by.get(w) ?? []), `M${f(c.x + c.r * dx)} ${f(c.y + c.r * dy)}h0`]);
	}
	return g({ fill: 'none', stroke: color, 'stroke-linecap': 'round' }, [...by].map(([w, ds]) => el('path', { d: ds.join(''), 'stroke-width': w })));
}


// A binary heap of grid cells by cost, smallest first.
class Heap {
	private k: number[] = [];
	private v: number[] = [];
	get size() {
		return this.k.length;
	}
	push(key: number, val: number) {
		const k = this.k, v = this.v;
		let i = k.length;
		k.push(key);
		v.push(val);
		while (i > 0) {
			const p = (i - 1) >> 1;
			if ((k[p] as number) <= key) break;
			k[i] = k[p] as number;
			v[i] = v[p] as number;
			i = p;
		}
		k[i] = key;
		v[i] = val;
	}
	pop(): number {
		const k = this.k, v = this.v;
		const top = v[0] as number;
		const lk = k.pop() as number, lv = v.pop() as number;
		if (k.length) {
			let i = 0;
			for (;;) {
				const a = 2 * i + 1, b = a + 1;
				let m = i, mk = lk;
				if (a < k.length && (k[a] as number) < mk) {
					m = a;
					mk = k[a] as number;
				}
				if (b < k.length && (k[b] as number) < mk) {
					m = b;
					mk = k[b] as number;
				}
				if (m === i) break;
				k[i] = k[m] as number;
				v[i] = v[m] as number;
				i = m;
			}
			k[i] = lk;
			v[i] = lv;
		}
		return top;
	}
}
