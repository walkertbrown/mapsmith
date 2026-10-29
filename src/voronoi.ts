// Voronoi cells by clipping the map box with the bisector to each nearby site, then a graph of the
// shared corners and edges. Rivers, roads, walls and the coast all run along these edges, so the
// wards on either side of them never need cutting.

import { clipHalf, dist, lerp, perp, sub, type Poly, type Pt } from './geom';

export interface Cell {
	i: number;
	site: Pt;
	poly: Poly; // corners as points
	verts: number[]; // the same corners as graph vertex ids, in order
	nbrs: number[]; // cells across each side; -1 at the map edge (side k runs verts[k] to verts[k+1])
}

export interface Graph {
	cells: Cell[];
	verts: Pt[];
	edges: Map<string, [number, number]>; // "a,b" (a < b) -> the cells on each side, -1 for none
	adj: number[][]; // vertex -> neighbouring vertices
	border: Set<number>; // vertices on the map edge
}

export const edgeKey = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);

export function voronoi(sites: Pt[], w: number, h: number): Graph {
	const box: Poly = [
		{ x: 0, y: 0 },
		{ x: w, y: 0 },
		{ x: w, y: h },
		{ x: 0, y: h },
	];
	const polys: Poly[] = sites.map((s, i) => {
		const order = sites
			.map((o, j) => ({ j, d: dist(s, o) }))
			.filter((o) => o.j !== i)
			.sort((a, b) => a.d - b.d);
		let p = box;
		for (const { j, d } of order) {
			let far = 0;
			for (const q of p) far = Math.max(far, dist(s, q));
			if (d > 2 * far) break; // no site further out can cut this cell
			const o = sites[j] as Pt;
			const m = lerp(s, o, 0.5);
			const dir = perp(sub(o, s)); // bisector direction; keeps the side facing s
			p = clipHalf(p, m, dir);
			if (p.length < 3) break;
		}
		return p;
	});

	// merge corners that several cells computed separately
	const verts: Pt[] = [];
	const grid = new Map<string, number[]>();
	const EPS = 1e-3;
	const vid = (q: Pt) => {
		const gx = Math.round(q.x * 100), gy = Math.round(q.y * 100);
		for (let dx = -1; dx <= 1; dx++)
			for (let dy = -1; dy <= 1; dy++)
				for (const k of grid.get(`${gx + dx},${gy + dy}`) ?? []) if (dist(verts[k] as Pt, q) < EPS * 10) return k;
		verts.push(q);
		const key = `${gx},${gy}`;
		grid.set(key, [...(grid.get(key) ?? []), verts.length - 1]);
		return verts.length - 1;
	};

	const cells: Cell[] = polys.map((poly, i) => {
		const ids: number[] = [];
		for (const q of poly) {
			const k = vid(q);
			if (ids[ids.length - 1] !== k && ids[0] !== k) ids.push(k);
		}
		return { i, site: sites[i] as Pt, poly: ids.map((k) => verts[k] as Pt), verts: ids, nbrs: [] };
	});

	const edges = new Map<string, [number, number]>();
	for (const c of cells)
		for (let k = 0; k < c.verts.length; k++) {
			const a = c.verts[k] as number, b = c.verts[(k + 1) % c.verts.length] as number;
			const key = edgeKey(a, b);
			const e = edges.get(key);
			if (e) e[1] = c.i;
			else edges.set(key, [c.i, -1]);
		}
	for (const c of cells)
		c.nbrs = c.verts.map((a, k) => {
			const e = edges.get(edgeKey(a, c.verts[(k + 1) % c.verts.length] as number)) as [number, number];
			return e[0] === c.i ? e[1] : e[0];
		});

	const adj: number[][] = verts.map(() => []);
	const border = new Set<number>();
	for (const [key, [, b]] of edges) {
		const [x, y] = key.split(',').map(Number) as [number, number];
		(adj[x] as number[]).push(y);
		(adj[y] as number[]).push(x);
		if (b === -1) {
			border.add(x);
			border.add(y);
		}
	}
	return { cells, verts, edges, adj, border };
}

// Cheapest path over the corner graph. `cost` gives the price of walking an edge, Infinity to forbid it.
export function path(g: Graph, from: number, to: (v: number) => boolean, cost: (a: number, b: number) => number): number[] | null {
	const best = new Float64Array(g.verts.length).fill(Infinity);
	const prev = new Int32Array(g.verts.length).fill(-1);
	const done = new Uint8Array(g.verts.length);
	best[from] = 0;
	// a binary heap would be quicker; a few thousand corners don't need one
	const open = [from];
	while (open.length) {
		let bi = 0;
		for (let i = 1; i < open.length; i++) if ((best[open[i] as number] as number) < (best[open[bi] as number] as number)) bi = i;
		const v = open[bi] as number;
		open[bi] = open[open.length - 1] as number;
		open.pop();
		if (done[v]) continue;
		done[v] = 1;
		if (to(v)) {
			const out = [v];
			while ((prev[out[0] as number] as number) >= 0) out.unshift(prev[out[0] as number] as number);
			return out;
		}
		for (const u of g.adj[v] as number[]) {
			if (done[u]) continue;
			const c = cost(v, u);
			if (!isFinite(c)) continue;
			const nb = (best[v] as number) + c;
			if (nb < (best[u] as number)) {
				best[u] = nb;
				prev[u] = v;
				open.push(u);
			}
		}
	}
	return null;
}
