// A town from a seed. Wards are Voronoi cells around a market square; the river, roads, wall and
// coast run along the cells' edges, and each ward is cut into lots and buildings.

import {
	add,
	along,
	area,
	centroid,
	chaikin,
	clipHalf,
	contains,
	dist,
	dot,
	inset,
	lerp,
	lineDist,
	longestSide,
	norm,
	perp,
	polyLength,
	pt,
	scale,
	shrink,
	split,
	sub,
	at,
	type Poly,
	type Pt,
} from './geom';
import { chance, fork, int, makeNoise, makeRng, pick, range, shuffle, type Rng } from './rng';
import { edgeKey, path, voronoi, type Cell, type Graph } from './voronoi';
import { placeFor, townName, type PlaceKind, type PlaceText } from './names';

export type Size = 'hamlet' | 'village' | 'town' | 'large-town' | 'city';
export type Water = 'none' | 'river' | 'coast' | 'estuary' | 'lake';
export type Side = 'north' | 'south' | 'east' | 'west';

export const SIZES: Size[] = ['hamlet', 'village', 'town', 'large-town', 'city'];
export const WATERS: Water[] = ['none', 'river', 'coast', 'estuary', 'lake'];
export const SIDES: Side[] = ['north', 'south', 'east', 'west'];

export interface TownOptions {
	seed: string;
	size: Size;
	water: Water;
	side: Side; // where the sea or lake lies
	walls: boolean;
	name?: string;
}

interface SizeSpec {
	span: number; // metres across the map
	radius: number; // the built-up area, as a share of the map
	wards: number;
	roads: number;
	inner: number; // share of the built-up wards that are packed tight (and walled, when there are walls)
	lot: number; // square metres of a lot in a packed ward
	river: number; // metres across
	places: number;
}

export const SPEC: Record<Size, SizeSpec> = {
	hamlet: { span: 420, radius: 0.2, wards: 6, roads: 2, inner: 0, lot: 140, river: 9, places: 4 },
	village: { span: 600, radius: 0.24, wards: 13, roads: 3, inner: 0.25, lot: 150, river: 11, places: 7 },
	town: { span: 900, radius: 0.29, wards: 30, roads: 3, inner: 0.7, lot: 120, river: 15, places: 10 },
	'large-town': { span: 1100, radius: 0.31, wards: 44, roads: 4, inner: 0.72, lot: 110, river: 18, places: 13 },
	city: { span: 1400, radius: 0.33, wards: 72, roads: 5, inner: 0.78, lot: 100, river: 22, places: 16 },
};

export type WardKind = 'market' | 'dense' | 'sparse' | 'temple' | 'keep' | 'docks' | 'park' | 'farm' | 'wood' | 'meadow' | 'water';
export type BuildingKind = 'house' | 'hall' | 'temple' | 'keep' | 'warehouse' | 'stall' | 'farmhouse';

export interface Ward {
	cell: number;
	kind: WardKind;
	poly: Poly; // the ward's ground, inside its streets
}
export interface Building {
	poly: Poly;
	kind: BuildingKind;
	ward: number;
	place?: number; // index into places
}
export interface Place extends PlaceText {
	n: number; // the number on the map
	kind: PlaceKind;
	at: Pt;
	building?: number;
}
export interface Gate {
	p: Pt;
	dir: Pt;
}
export interface Field {
	poly: Poly;
	tone: number;
}
export interface Tree {
	x: number;
	y: number;
	r: number;
}

export interface Town {
	opts: TownOptions;
	name: string;
	w: number;
	h: number;
	mpu: number; // metres per map unit
	center: Pt;
	water: Poly[];
	river: Pt[] | null;
	riverW: number;
	roads: Pt[][];
	roadW: number;
	streets: Poly[]; // the built-up cells, under the wards, drawn as street
	wards: Ward[];
	buildings: Building[];
	walls: Pt[][];
	towers: Pt[];
	gates: Gate[];
	bridges: Gate[];
	piers: Poly[];
	fields: Field[];
	trees: Tree[];
	places: Place[];
}

const SIDE_DIR: Record<Side, Pt> = { north: pt(0, -1), south: pt(0, 1), east: pt(1, 0), west: pt(-1, 0) };
export const W = 1000;

export const DEFAULTS: TownOptions = { seed: 'mapsmith', size: 'town', water: 'river', side: 'south', walls: true };

export function generateTown(o: Partial<TownOptions> = {}): Town {
	const opts: TownOptions = { ...DEFAULTS, ...o };
	const spec = SPEC[opts.size];
	const root = makeRng(`${opts.seed}`);
	const r = {
		sites: fork(root, 'sites'),
		water: fork(root, 'water'),
		roads: fork(root, 'roads'),
		lots: fork(root, 'lots'),
		land: fork(root, 'land'),
		names: fork(root, 'names'),
	};
	const mpu = spec.span / W;
	const u = (m: number) => m / mpu; // metres to map units
	const riverW = u(spec.river);
	const R = spec.radius * W;
	const sea = SIDE_DIR[opts.side];
	const hasSea = opts.water === 'coast' || opts.water === 'estuary';
	const center = pt(W / 2 + range(r.sites, -0.04, 0.04) * W - (hasSea ? sea.x * R * 0.25 : 0), W / 2 + range(r.sites, -0.04, 0.04) * W - (hasSea ? sea.y * R * 0.25 : 0));

	// sites: tight in town, looser over the fields
	const d0 = Math.sqrt((Math.PI * R * R) / spec.wards);
	const space = (q: Pt) => {
		const rr = dist(q, center);
		return d0 * 0.85 * (rr < R ? 1 : 1 + ((rr - R) / R) * 0.8);
	};
	const sites: Pt[] = [center];
	for (let t = 0; t < 9000; t++) {
		const q = pt(range(r.sites, 0, W), range(r.sites, 0, W));
		const s = space(q);
		if (sites.every((o) => dist(o, q) > s)) sites.push(q);
	}
	const g = voronoi(sites, W, W);
	const cells = g.cells;
	const vcells: number[][] = g.verts.map(() => []);
	for (const c of cells) for (const v of c.verts) (vcells[v] as number[]).push(c.i);

	// water cells
	const nw = makeNoise(r.water);
	const isWater = new Uint8Array(cells.length);
	if (hasSea) {
		const reach = R * 0.5;
		for (const c of cells) {
			const off = dot(sub(c.site, center), sea);
			const wob = (nw(c.site.x / 220, c.site.y / 220) - 0.5) * R * 0.9;
			if (c.i !== 0 && off > reach + wob) isWater[c.i] = 1;
		}
	} else if (opts.water === 'lake') {
		const lc = add(center, scale(sea, R * 1.15));
		for (const c of cells) {
			const a = Math.atan2(c.site.y - lc.y, c.site.x - lc.x);
			const rad = R * (0.55 + 0.35 * nw(Math.cos(a) * 1.5 + 3, Math.sin(a) * 1.5 + 3));
			if (c.i !== 0 && dist(c.site, lc) < rad) isWater[c.i] = 1;
		}
	}
	const waterAt = (i: number) => i >= 0 && isWater[i] === 1;
	const vertWater = (v: number) => (vcells[v] as number[]).some(waterAt);
	const vertAllWater = (v: number) => (vcells[v] as number[]).every(waterAt);

	// river along cell edges, past the middle of town but not through the square
	const riverEdges = new Set<string>();
	const riverVerts = new Set<number>();
	let riverLine: number[] | null = null;
	if (opts.water === 'river' || opts.water === 'estuary') {
		const axis = opts.water === 'estuary' ? sea : chance(r.water, 0.5) ? pt(1, range(r.water, -0.4, 0.4)) : pt(range(r.water, -0.4, 0.4), 1);
		const side = perp(norm(axis));
		const via = add(add(center, scale(side, R * range(r.water, 0.12, 0.3) * (chance(r.water, 0.5) ? 1 : -1))), scale(norm(axis), opts.water === 'estuary' ? -R * 0.15 : 0));
		const start = nearestVert(g, via, (v) => !g.border.has(v) && !vertWater(v));
		const meander = (a: number, b: number) => {
			if (g.border.has(a) && g.border.has(b)) return Infinity;
			if (vertAllWater(b)) return Infinity;
			const m = lerp(g.verts[a] as Pt, g.verts[b] as Pt, 0.5);
			return dist(g.verts[a] as Pt, g.verts[b] as Pt) * (0.4 + nw(m.x / 90 + 40, m.y / 90));
		};
		const towards = (dir: Pt) => (v: number) => g.border.has(v) && dot(norm(sub(g.verts[v] as Pt, center)), dir) > 0.55;
		const down = opts.water === 'estuary' ? path(g, start, (v) => vertWater(v), meander) : path(g, start, towards(norm(axis)), meander);
		const used = new Set(down ?? []);
		const up = path(g, start, towards(scale(norm(axis), -1)), (a, b) => (used.has(b) ? Infinity : meander(a, b)));
		if (down && up) {
			riverLine = [...up.reverse(), ...down.slice(1)];
			for (let i = 0; i + 1 < riverLine.length; i++) riverEdges.add(edgeKey(riverLine[i] as number, riverLine[i + 1] as number));
			for (const v of riverLine) riverVerts.add(v);
		}
	}

	// the built-up area and its packed heart
	const nt = makeNoise(r.land);
	const urban = new Uint8Array(cells.length);
	const inner = new Uint8Array(cells.length);
	for (const c of cells) {
		if (waterAt(c.i) || c.verts.some((v) => g.border.has(v))) continue;
		if (dist(c.site, center) < R * (0.8 + 0.4 * nt(c.site.x / 160, c.site.y / 160)) || c.i === 0) urban[c.i] = 1;
	}
	const byDist = cells.filter((c) => urban[c.i]).sort((a, b) => dist(a.site, center) - dist(b.site, center));
	const innerCount = Math.round(byDist.length * spec.inner);
	byDist.slice(0, innerCount).forEach((c) => (inner[c.i] = 1));
	if (innerCount) inner[0] = 1;
	const walled = opts.walls && spec.inner >= 0.5;

	// wall: edges between the packed heart and the land outside it
	const wallEdges = new Set<string>();
	if (walled)
		for (const [key, [a, b]] of g.edges) {
			if (riverEdges.has(key) || a < 0 || b < 0 || waterAt(a) || waterAt(b)) continue;
			if (inner[a] !== inner[b]) wallEdges.add(key);
		}
	const wallVerts = new Set<number>();
	for (const key of wallEdges) for (const v of key.split(',').map(Number)) wallVerts.add(v);

	// main roads from the square out to the edge of the map, sharing a trunk where they can
	const roadEdges = new Set<string>();
	const roads: number[][] = [];
	const nr = makeNoise(r.roads);
	const dirs: Pt[] = [];
	const a0 = range(r.roads, 0, Math.PI * 2);
	for (let k = 0; dirs.length < spec.roads && k < 24; k++) {
		const a = a0 + (k * Math.PI * 2) / (spec.roads + (hasSea || opts.water === 'lake' ? 1 : 0)) + range(r.roads, -0.3, 0.3);
		const d = pt(Math.cos(a), Math.sin(a));
		if ((hasSea || opts.water === 'lake') && dot(d, sea) > 0.3) continue;
		dirs.push(d);
	}
	if (riverLine && dirs.length) {
		const mid = g.verts[riverLine[Math.floor(riverLine.length / 2)] as number] as Pt;
		const across = norm(sub(mid, center));
		if (!dirs.some((d) => dot(d, across) > 0.8)) dirs[dirs.length - 1] = (hasSea || opts.water === 'lake') && dot(across, sea) > 0.3 ? (dirs[dirs.length - 1] as Pt) : across;
	}
	const plaza = cells[0] as Cell;
	for (const d of dirs) {
		// leave the square from a corner off the river, so a crossing is always seen from both banks
		const dry = plaza.verts.filter((v) => !riverVerts.has(v));
		const from = dry.length ? dry : plaza.verts;
		const start = from.reduce((best, v) => (dot(sub(g.verts[v] as Pt, center), d) > dot(sub(g.verts[best] as Pt, center), d) ? v : best), from[0] as number);
		const cost = (a: number, b: number) => {
			const key = edgeKey(a, b);
			const e = g.edges.get(key) as [number, number];
			if (e[1] < 0 || waterAt(e[0]) || waterAt(e[1])) return Infinity;
			const m = lerp(g.verts[a] as Pt, g.verts[b] as Pt, 0.5);
			let c = dist(g.verts[a] as Pt, g.verts[b] as Pt) * (0.7 + nr(m.x / 120, m.y / 120));
			// a river or wall edge is crossed, never followed: a bridge or a gate
			if (riverEdges.has(key)) c += u(60);
			else if (wallEdges.has(key)) c += u(30);
			else if (riverVerts.has(b)) c += u(120);
			else if (wallVerts.has(b)) c += u(40);
			if (roadEdges.has(key)) c *= 0.3;
			return c;
		};
		const p = path(g, start, (v) => g.border.has(v) && dot(norm(sub(g.verts[v] as Pt, center)), d) > 0.7, cost) ?? path(g, start, (v) => g.border.has(v), cost);
		if (!p) continue;
		roads.push(p);
		for (let i = 0; i + 1 < p.length; i++) roadEdges.add(edgeKey(p[i] as number, p[i + 1] as number));
	}

	// Roads meet the river and the wall at corners, and where those corners only have spokes on one
	// side the road has to walk a barrier edge or two to get across. Draw each crossing as one short
	// cut over the barrier, with a bridge or a gate in the middle of it.
	const gates: Gate[] = [];
	const bridges: Gate[] = [];
	const roadLines: Pt[][] = [];
	const barrier = (a: number, b: number | undefined) => {
		if (b === undefined) return null;
		const key = edgeKey(a, b);
		return riverEdges.has(key) ? 'river' : wallEdges.has(key) ? 'wall' : null;
	};
	// which bank of the river, or which side of the wall, x lies on as seen from v; null off the line
	const along2 = new Map<string, [number, number]>();
	const lines: [string, number[][]][] = [['river', riverLine ? [riverLine] : []], ['wall', chains(wallEdges)]];
	for (const [kind, ls] of lines)
		for (const l of ls) {
			const closed = l[0] === l[l.length - 1];
			l.forEach((v, i) => {
				const b = l[i - 1] ?? (closed ? l[l.length - 2] : undefined), f = l[i + 1] ?? (closed ? l[1] : undefined);
				if (b !== undefined && f !== undefined) along2.set(`${kind}${v}`, [b, f]);
			});
		}
	const TAU = Math.PI * 2;
	const ang = (o: Pt, q: Pt) => Math.atan2(q.y - o.y, q.x - o.x);
	const side = (kind: 'river' | 'wall', v: number, x: number) => {
		const bf = along2.get(`${kind}${v}`);
		if (!bf) return null;
		const o = g.verts[v] as Pt, a0 = ang(o, g.verts[bf[1]] as Pt);
		return (ang(o, g.verts[x] as Pt) - a0 + TAU) % TAU < (ang(o, g.verts[bf[0]] as Pt) - a0 + TAU) % TAU;
	};
	const crosses = (kind: 'river' | 'wall', v: number, prev: number, w: number, next: number) => {
		const s1 = side(kind, v, prev), s2 = side(kind, w, next);
		return s1 !== null && s2 !== null && s1 !== s2;
	};
	const mark = (kind: 'river' | 'wall', p: Pt, dir: Pt) => {
		const list = kind === 'river' ? bridges : gates;
		if (!list.some((x) => dist(x.p, p) < u(4))) list.push({ p, dir });
	};
	for (const p of roads) {
		const line: Pt[] = [];
		for (let i = 0; i < p.length; i++) {
			const v = p[i] as number, prev = p[i - 1], next = p[i + 1];
			const kind = barrier(v, next);
			if (kind && prev !== undefined) {
				let j = i + 1;
				while (barrier(p[j] as number, p[j + 1]) === kind) j++;
				const after = p[j + 1];
				if (after !== undefined && crosses(kind, v, prev, p[j] as number, after)) {
					// entered on one side, left on the other
					const run = p.slice(i, j + 1).map((x) => g.verts[x] as Pt);
					const back = kind === 'river' ? riverW * 0.9 + u(3) : u(5);
					const off = (from: Pt, to: Pt) => lerp(from, to, Math.min(0.45, back / (dist(from, to) || 1)));
					const inn = off(run[0] as Pt, g.verts[prev] as Pt), out = off(run[run.length - 1] as Pt, g.verts[after] as Pt);
					const mid = along(run, polyLength(run) / 2).p;
					line.push(inn, mid, out);
					mark(kind, mid, norm(sub(out, inn)));
					i = j;
					continue;
				}
			}
			line.push(g.verts[v] as Pt);
			if (prev === undefined || next === undefined) continue;
			for (const k of ['river', 'wall'] as const)
				if (barrier(prev, v) !== k && barrier(v, next) !== k && crosses(k, v, prev, v, next))
					mark(k, g.verts[v] as Pt, norm(sub(g.verts[next] as Pt, g.verts[prev] as Pt)));
		}
		roadLines.push(line);
	}
	// in a packed town the streets on either bank meet over footbridges too
	if (riverLine) {
		const extra = { hamlet: 0, village: 0, town: 1, 'large-town': 2, city: 3 }[opts.size];
		const spots = shuffle(r.roads, riverLine.slice(1).map((v, i) => [riverLine?.[i] as number, v] as const)).filter(([a, b]) => {
			const e = g.edges.get(edgeKey(a, b)) as [number, number];
			return inner[e[0]] === 1 && inner[e[1]] === 1;
		});
		let added = 0;
		for (const [a, b] of spots) {
			if (added >= extra) break;
			const pa = g.verts[a] as Pt, pb = g.verts[b] as Pt;
			if (dist(pa, pb) < u(30)) continue;
			const m = lerp(pa, pb, 0.5);
			if (bridges.some((x) => dist(x.p, m) < u(110))) continue;
			bridges.push({ p: m, dir: norm(perp(sub(pb, pa))) });
			added++;
		}
	}

	// what each cell is
	const kinds: WardKind[] = cells.map((c) => {
		if (waterAt(c.i)) return 'water';
		if (c.i === 0) return 'market';
		if (inner[c.i]) return 'dense';
		if (urban[c.i]) return 'sparse';
		const n = nt(c.site.x / 260 + 50, c.site.y / 260 + 50);
		const near = dist(c.site, center) < R * 2.1;
		if (n > 0.6 && !c.verts.some((v) => roads.some((p) => p.includes(v)))) return 'wood';
		if (near && n < 0.56) return 'farm';
		return n > 0.5 ? 'wood' : 'meadow';
	});
	const touchesPlaza = (c: Cell) => c.nbrs.includes(0);
	const bigTown = opts.size === 'town' || opts.size === 'large-town' || opts.size === 'city';
	if (bigTown) {
		const t = shuffle(r.lots, cells.filter((c) => kinds[c.i] === 'dense' && touchesPlaza(c)))[0];
		if (t) kinds[t.i] = 'temple';
	}
	if (opts.size === 'city' || opts.size === 'large-town') {
		const edge = cells.filter((c) => kinds[c.i] === 'dense' && c.verts.some((v) => wallVerts.has(v)) && !c.nbrs.some(waterAt));
		edge.sort((a, b) => dist(b.site, center) * Math.sqrt(Math.abs(area(b.poly))) - dist(a.site, center) * Math.sqrt(Math.abs(area(a.poly))));
		const k = edge[0];
		if (k) kinds[k.i] = 'keep';
		const park = shuffle(r.lots, cells.filter((c) => kinds[c.i] === 'dense' && !touchesPlaza(c)))[0];
		if (park && opts.size === 'city') kinds[park.i] = 'park';
	}
	if (hasSea || opts.water === 'lake')
		for (const c of cells) if (kinds[c.i] === 'dense' && c.nbrs.some(waterAt) && bigTown) kinds[c.i] = 'docks';

	// ground of each ward, inside its streets
	const streetW = u(opts.size === 'city' ? 4 : 4.5);
	const roadW = u(opts.size === 'hamlet' ? 5 : opts.size === 'village' ? 6 : 8);
	const wards: Ward[] = [];
	const ground = (c: Cell) =>
		inset(
			c.poly,
			c.verts.map((a, k) => {
				const key = edgeKey(a, at(c.verts, k + 1));
				const nb = c.nbrs[k] as number;
				if (riverEdges.has(key)) return riverW / 2 + u(4);
				if (nb >= 0 && waterAt(nb)) return u(5);
				if (wallEdges.has(key)) return u(6);
				if (roadEdges.has(key)) return roadW / 2 + u(1.5);
				if (nb < 0) return 0;
				return urban[c.i] || (nb >= 0 && urban[nb]) ? streetW / 2 : u(1.5);
			}),
		);
	for (const c of cells) {
		const kind = kinds[c.i] as WardKind;
		if (kind === 'water') continue;
		const poly = ground(c);
		if (poly.length >= 3) wards.push({ cell: c.i, kind, poly });
	}

	// lots and buildings
	const buildings: Building[] = [];
	const fields: Field[] = [];
	const trees: Tree[] = [];
	const piers: Poly[] = [];
	const keepWalls: Poly[] = [];
	const lotA = u(1) * u(1) * spec.lot;
	const isRoadSide = (c: Cell, k: number) => roadEdges.has(edgeKey(c.verts[k] as number, at(c.verts, k + 1)));
	for (const [wi, ward] of wards.entries()) {
		const c = cells[ward.cell] as Cell;
		const rr = r.lots;
		switch (ward.kind) {
			case 'dense':
			case 'docks': {
				const min = ward.kind === 'docks' ? lotA * 2.4 : lotA * (opts.size === 'village' ? 1.6 : 1);
				for (const lot of cutLots(ward.poly, min, u(2.2), u(0.35), rr)) {
					if (!compact(lot)) continue;
					if (!onEdge(lot, ward.poly, u(0.6))) {
						if (chance(rr, ward.kind === 'docks' ? 0.55 : 0.25) && Math.abs(area(lot)) < min * 2) buildings.push({ poly: inset(lot, u(0.6)), kind: 'house', ward: wi });
						continue;
					}
					if (chance(rr, opts.size === 'village' ? 0.15 : 0.04)) continue;
					const b = inset(lot, u(0.25));
					if (b.length < 3) continue;
					const big = Math.abs(area(lot)) > min * 3.2;
					buildings.push({ poly: b, kind: ward.kind === 'docks' ? 'warehouse' : big ? 'hall' : 'house', ward: wi });
				}
				if (ward.kind === 'docks') piers.push(...docksFor(c, g, waterAt, u, rr));
				break;
			}
			case 'sparse': {
				// a hamlet is all outskirts, so its few wards are built up more
				const small = opts.size === 'hamlet';
				for (const lot of cutLots(ward.poly, lotA * (small ? 3.6 : 3.2), u(0), u(0), rr)) {
					const road = c.verts.some((_, k) => isRoadSide(c, k) && edgeTouch(lot, c.poly[k] as Pt, at(c.poly, k + 1), roadW / 2 + u(3)));
					if (!chance(rr, road ? 0.9 : onEdge(lot, ward.poly, u(0.6)) ? (small ? 0.6 : 0.4) : small ? 0.25 : 0.1)) continue;
					const b = houseIn(lot, rr, u);
					if (b) buildings.push({ poly: b, kind: 'house', ward: wi });
				}
				treesIn(ward.poly, u(12), 0.12, rr, trees, u);
				break;
			}
			case 'market': {
				const n = opts.size === 'hamlet' ? 0 : opts.size === 'village' ? 3 : int(rr, 5, 9);
				const ctr = centroid(ward.poly);
				for (let i = 0; i < n; i++) {
					const q = add(ctr, pt(range(rr, -1, 1) * u(18), range(rr, -1, 1) * u(18)));
					if (!contains(inset(ward.poly, u(3)), q)) continue;
					buildings.push({ poly: rect(q, pt(1, 0), u(3), u(2.4)), kind: 'stall', ward: wi });
				}
				break;
			}
			case 'temple': {
				const d = norm(sub(at(ward.poly, longestSide(ward.poly) + 1), ward.poly[longestSide(ward.poly)] as Pt));
				const ext = extent(ward.poly, d);
				const b = clipTo(rect(centroid(ward.poly), d, ext * 0.55, extent(ward.poly, perp(d)) * 0.38), inset(ward.poly, u(3)));
				buildings.push({ poly: b, kind: 'temple', ward: wi });
				treesIn(ward.poly, u(9), 0.35, rr, trees, u, b);
				break;
			}
			case 'keep': {
				const d = norm(sub(at(ward.poly, longestSide(ward.poly) + 1), ward.poly[longestSide(ward.poly)] as Pt));
				const curtain = inset(ward.poly, u(4));
				const b = clipTo(rect(centroid(ward.poly), d, extent(ward.poly, d) * 0.42, extent(ward.poly, perp(d)) * 0.36), inset(ward.poly, u(12)));
				buildings.push({ poly: b, kind: 'keep', ward: wi });
				if (curtain.length >= 3) keepWalls.push(curtain);
				break;
			}
			case 'park':
				treesIn(ward.poly, u(8), 0.55, rr, trees, u);
				break;
			case 'farm': {
				for (const [i, s] of strips(inset(ward.poly, u(2)), u(range(rr, 22, 40))).entries()) fields.push({ poly: s, tone: (i * 7 + int(rr, 0, 3)) % 4 });
				const roadSide = c.verts.findIndex((_, k) => isRoadSide(c, k));
				if (roadSide >= 0 && chance(rr, 0.5)) {
					const m = lerp(c.poly[roadSide] as Pt, at(c.poly, roadSide + 1), range(rr, 0.3, 0.7));
					const inward = norm(sub(centroid(c.poly), m));
					const q = add(m, scale(inward, roadW / 2 + u(10)));
					buildings.push({ poly: rect(q, norm(sub(at(c.poly, roadSide + 1), c.poly[roadSide] as Pt)), u(12), u(7)), kind: 'farmhouse', ward: wi });
				}
				break;
			}
			case 'wood':
				treesIn(ward.poly, u(9), 0.92, rr, trees, u);
				break;
			case 'meadow':
				treesIn(ward.poly, u(11), 0.07, rr, trees, u);
				break;
		}
	}

	// the wall, as lines
	const walls = chains(wallEdges);
	const towers: Pt[] = [];
	for (const k of keepWalls) towers.push(...k);
	for (const w of walls) w.forEach((v, i) => (i % 2 === 0 || i === w.length - 1) && !gates.some((gt) => dist(gt.p, g.verts[v] as Pt) < u(9)) && towers.push(g.verts[v] as Pt));

	// water outlines
	const water = waterOutlines(g, waterAt);

	const name = opts.name?.trim() || townName(r.names, opts);
	const town: Town = {
		opts,
		name,
		w: W,
		h: W,
		mpu,
		center,
		water,
		river: riverLine ? chaikin(riverLine.map((v) => g.verts[v] as Pt), 3) : null,
		riverW,
		roads: roadLines.map((l) => chaikin(l, 2)),
		roadW,
		streets: cells.filter((c) => inner[c.i] || c.i === 0).map((c) => c.poly),
		wards,
		buildings,
		walls: [...walls.map((w) => w.map((v) => g.verts[v] as Pt)), ...keepWalls.map((k) => [...k, k[0] as Pt])],
		towers,
		gates,
		bridges,
		piers,
		fields,
		trees,
		places: [],
	};
	town.places = placePlaces(town, r.names, spec.places);
	return town;
}

function nearestVert(g: Graph, q: Pt, ok: (v: number) => boolean): number {
	let best = 0, bd = Infinity;
	g.verts.forEach((p, v) => {
		const d = dist(p, q);
		if (d < bd && ok(v)) {
			bd = d;
			best = v;
		}
	});
	return best;
}

// Cut a ward into lots: the first cuts leave alleys, later ones only a party wall.
function cutLots(p: Poly, minA: number, alley: number, gap: number, r: Rng, depth = 0): Poly[] {
	const a = Math.abs(area(p));
	if (p.length < 3) return [];
	if (a < minA * range(r, 1, 2.2) || depth > 14) return [p];
	const i = longestSide(p);
	const s = p[i] as Pt, e = at(p, i + 1);
	const m = lerp(s, e, range(r, 0.38, 0.62));
	const d = perp(sub(e, s));
	const tilt = range(r, -0.06, 0.06);
	const dir = add(norm(d), scale(norm(sub(e, s)), tilt));
	const w = depth < 2 && a > minA * 14 ? alley : gap;
	const [x, y] = split(p, m, dir, w);
	return [...cutLots(x, minA, alley, gap, r, depth + 1), ...cutLots(y, minA, alley, gap, r, depth + 1)];
}

// Does a lot reach the ward's edge (so it fronts a street)?
function onEdge(lot: Poly, ward: Poly, tol: number): boolean {
	return lot.some((q) => {
		for (let k = 0; k < ward.length; k++) if (lineDist(q, [ward[k] as Pt, at(ward, k + 1)]) < tol) return true;
		return false;
	});
}

// Slivers and sharp triangles make poor houses.
function compact(p: Poly): boolean {
	let per = 0;
	for (let i = 0; i < p.length; i++) per += dist(p[i] as Pt, at(p, i + 1));
	return (Math.abs(area(p)) * 4 * Math.PI) / (per * per) > (p.length === 3 ? 0.5 : 0.42);
}

function edgeTouch(lot: Poly, a: Pt, b: Pt, tol: number): boolean {
	return lot.some((q) => lineDist(q, [a, b]) < tol);
}

function houseIn(lot: Poly, r: Rng, u: (m: number) => number): Poly | null {
	const i = longestSide(lot);
	const d = norm(sub(at(lot, i + 1), lot[i] as Pt));
	const len = Math.min(extent(lot, d) * 0.6, u(range(r, 10, 16)));
	const wid = Math.min(extent(lot, perp(d)) * 0.6, u(range(r, 6, 9)));
	if (len < u(4) || wid < u(3)) return null;
	const c = centroid(lot);
	const toward = lerp(c, lerp(lot[i] as Pt, at(lot, i + 1), 0.5), 0.35);
	const b = clipTo(rect(toward, d, len, wid), lot);
	return b.length >= 3 ? b : null;
}

export function rect(c: Pt, d: Pt, l: number, w: number): Poly {
	const a = scale(norm(d), l / 2), b = scale(perp(norm(d)), w / 2);
	return [add(add(c, a), b), add(sub(c, a), b), sub(sub(c, a), b), sub(add(c, a), b)];
}

function extent(p: Poly, d: Pt): number {
	const n = norm(d);
	const xs = p.map((q) => dot(q, n));
	return Math.max(...xs) - Math.min(...xs);
}

// Clip a convex polygon to the inside of another convex polygon.
function clipTo(p: Poly, by: Poly): Poly {
	if (by.length < 3) return p;
	const ccw = area(by) > 0;
	let q = p;
	for (let i = 0; i < by.length && q.length >= 3; i++) {
		const a = by[i] as Pt, b = at(by, i + 1);
		q = ccw ? clipHalf(q, a, sub(b, a)) : clipHalf(q, b, sub(a, b));
	}
	return q;
}

// Fields: parallel strips across a ward.
function strips(p: Poly, w: number): Poly[] {
	if (p.length < 3) return [];
	const i = longestSide(p);
	const d = norm(sub(at(p, i + 1), p[i] as Pt));
	const xs = p.map((q) => dot(q, d));
	const lo = Math.min(...xs), hi = Math.max(...xs);
	const out: Poly[] = [];
	let rest = p;
	for (let t = lo + w; t < hi - w * 0.4 && rest.length >= 3; t += w) {
		const [a, b] = split(rest, scale(d, t), perp(d), 0);
		const [first, other] = dot(centroid(a.length >= 3 ? a : rest), d) < t ? [a, b] : [b, a];
		if (first.length >= 3) out.push(first);
		rest = other;
	}
	if (rest.length >= 3) out.push(rest);
	return out;
}

function treesIn(p: Poly, step: number, density: number, r: Rng, out: Tree[], u: (m: number) => number, avoid?: Poly) {
	if (p.length < 3) return;
	const xs = p.map((q) => q.x), ys = p.map((q) => q.y);
	const s = Math.max(step, 6);
	const inner = inset(p, s * 0.4);
	if (inner.length < 3) return;
	for (let x = Math.min(...xs); x < Math.max(...xs); x += s)
		for (let y = Math.min(...ys); y < Math.max(...ys); y += s) {
			if (!chance(r, density)) continue;
			const q = pt(x + range(r, -0.45, 0.45) * s, y + range(r, -0.45, 0.45) * s);
			if (!contains(inner, q) || (avoid && contains(avoid, q))) continue;
			out.push({ x: q.x, y: q.y, r: Math.min(u(range(r, 3.5, 5.5)), s * range(r, 0.55, 0.8)) });
		}
}

function docksFor(c: Cell, g: Graph, waterAt: (i: number) => boolean, u: (m: number) => number, r: Rng): Poly[] {
	const out: Poly[] = [];
	c.nbrs.forEach((nb, k) => {
		if (nb < 0 || !waterAt(nb)) return;
		const a = c.poly[k] as Pt, b = at(c.poly, k + 1);
		const L = dist(a, b);
		const out_ = norm(sub(lerp(a, b, 0.5), c.site));
		const n = Math.floor(L / u(22));
		for (let i = 1; i < n; i++) {
			if (chance(r, 0.35)) continue;
			const q = lerp(a, b, i / n);
			const l = u(range(r, 14, 28));
			out.push(rect(add(q, scale(out_, l / 2)), out_, l, u(3)));
		}
	});
	return out;
}

// Turn a set of edges into polylines of vertex ids.
function chains(edges: Set<string>): number[][] {
	const adj = new Map<number, number[]>();
	for (const key of edges) {
		const [a, b] = key.split(',').map(Number) as [number, number];
		adj.set(a, [...(adj.get(a) ?? []), b]);
		adj.set(b, [...(adj.get(b) ?? []), a]);
	}
	const used = new Set<string>();
	const out: number[][] = [];
	const walk = (s: number) => {
		const line = [s];
		let v = s;
		for (;;) {
			const next = (adj.get(v) ?? []).find((n) => !used.has(edgeKey(v, n)));
			if (next === undefined) break;
			used.add(edgeKey(v, next));
			line.push(next);
			v = next;
		}
		if (line.length > 1) out.push(line);
	};
	for (const [v, n] of adj) if (n.length !== 2) while ((adj.get(v) ?? []).some((m) => !used.has(edgeKey(v, m)))) walk(v);
	for (const [v] of adj) while ((adj.get(v) ?? []).some((m) => !used.has(edgeKey(v, m)))) walk(v);
	return out;
}

// The outline of each body of water, smoothed except where it runs along the map's edge.
function waterOutlines(g: Graph, waterAt: (i: number) => boolean): Poly[] {
	const edges = new Set<string>();
	for (const [key, [a, b]] of g.edges) if (waterAt(a) !== waterAt(b)) edges.add(key);
	const loops = chains(edges);
	return loops.map((l) => {
		const pts = l.map((v) => g.verts[v] as Pt);
		const closed = l[0] === l[l.length - 1];
		const ring = closed ? pts.slice(0, -1) : pts;
		const fixed = (closed ? l.slice(0, -1) : l).map((v) => g.border.has(v));
		return smoothFixed(ring, fixed, 3);
	});
}

function smoothFixed(p: Pt[], fixed: boolean[], times: number): Pt[] {
	let q = p, f = fixed;
	for (let t = 0; t < times; t++) {
		const out: Pt[] = [], of: boolean[] = [];
		q.forEach((v, i) => {
			if (f[i]) {
				out.push(v);
				of.push(true);
				return;
			}
			out.push(lerp(v, at(q, i - 1), 0.25), lerp(v, at(q, i + 1), 0.25));
			of.push(false, false);
		});
		q = out;
		f = of;
	}
	return q;
}

const ORDER: PlaceKind[] = ['market', 'temple', 'keep', 'inn', 'tavern', 'smithy', 'harbour', 'general', 'shrine', 'mill', 'apothecary', 'stables', 'guild', 'tavern', 'tailor', 'moneylender', 'bathhouse', 'library', 'barracks', 'theatre', 'jeweller', 'herbalist', 'tavern'];

function placePlaces(t: Town, r: Rng, count: number): Place[] {
	const places: Place[] = [];
	const taken = new Set<number>();
	const has = (k: BuildingKind) => t.buildings.findIndex((b) => b.kind === k);
	const wardOf = (b: Building) => t.wards[b.ward] as Ward;
	const kinds = ORDER.filter((k) => {
		if (k === 'temple') return has('temple') >= 0;
		if (k === 'keep') return has('keep') >= 0;
		if (k === 'harbour') return has('warehouse') >= 0;
		if (k === 'mill') return !!t.river && (t.opts.size === 'hamlet' || t.opts.size === 'village');
		if (k === 'shrine') return has('temple') < 0;
		if (k === 'market') return t.opts.size !== 'hamlet';
		return true;
	}).slice(0, count);
	const homes = t.buildings.map((b, i) => ({ b, i })).filter(({ b }) => b.kind === 'house' || b.kind === 'hall' || b.kind === 'farmhouse');
	const big = homes.filter(({ b }) => Math.abs(area(b.poly)) > 0).sort((a, b) => Math.abs(area(b.b.poly)) - Math.abs(area(a.b.poly)));
	const pool = big.slice(0, Math.max(12, Math.ceil(big.length * 0.5)));
	const spread = (q: Pt) => (places.length ? Math.min(...places.map((p) => dist(p.at, q))) : 0);
	for (const kind of kinds) {
		let bi = -1;
		let at_: Pt | null = null;
		if (kind === 'market') at_ = centroid((t.wards.find((w) => w.kind === 'market') as Ward).poly);
		else if (kind === 'temple') bi = has('temple');
		else if (kind === 'keep') bi = has('keep');
		else if (kind === 'harbour') bi = t.buildings.findIndex((b, i) => b.kind === 'warehouse' && !taken.has(i));
		else if (kind === 'mill' && t.river) {
			const river = t.river;
			bi = homes.filter(({ i }) => !taken.has(i)).sort((a, b) => lineDist(centroid(a.b.poly), river) - lineDist(centroid(b.b.poly), river))[0]?.i ?? -1;
		} else {
			const free = pool.filter(({ i }) => !taken.has(i));
			const near = kind === 'inn' || kind === 'tavern' ? free.filter(({ b }) => wardOf(b).kind !== 'sparse' || t.opts.size === 'hamlet' || t.opts.size === 'village') : free;
			const list = (near.length ? near : free).map(({ b, i }) => ({ i, s: spread(centroid(b.poly)) * range(r, 0.7, 1) - (kind === 'inn' ? dist(centroid(b.poly), t.center) * 2 : 0) }));
			list.sort((a, b) => b.s - a.s);
			bi = list[0]?.i ?? -1;
		}
		if (bi >= 0) {
			taken.add(bi);
			at_ = centroid((t.buildings[bi] as Building).poly);
		}
		if (!at_) continue;
		const n = places.length + 1;
		if (bi >= 0) (t.buildings[bi] as Building).place = places.length;
		places.push({ n, kind, at: at_, building: bi >= 0 ? bi : undefined, ...placeFor(r, kind, t) });
	}
	return places;
}

export const _test = { cutLots, strips, chains, smoothFixed, polyLength, along, shrink, pick };
