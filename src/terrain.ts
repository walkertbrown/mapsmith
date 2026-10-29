// High ground: a height for every point, and the contour rings that draw it. The town itself sits on flat
// ground; hills roll up around it, and mountains climb toward one side of the map, away from the water.

import { chaikin, dist, dot, lineDist, pt, sub, type Pt } from './geom';
import { makeNoise, type Rng } from './rng';

export type Terrain = 'flat' | 'hills' | 'mountains';

const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const smooth = (x: number) => {
	const t = clamp(x);
	return t * t * (3 - 2 * t);
};

// Height from 0 (the town's ground) to 1 (the tops). `up` is the way the land climbs.
export function makeHeight(r: Rng, terrain: Terrain, center: Pt, R: number, W: number, up: Pt): (p: Pt) => number {
	if (terrain === 'flat') return () => 0;
	const n = makeNoise(r), m = makeNoise(r);
	return (p) => {
		const away = smooth((dist(p, center) - R * 0.85) / Math.max(R * 1.1, W * 0.25));
		if (away === 0) return 0;
		const climb = clamp(0.5 + dot(sub(p, center), up) / (W * 0.75));
		if (terrain === 'hills') return away * clamp((n(p.x / 230, p.y / 230) - 0.42) * 2.2 + (climb - 0.5) * 0.3);
		// ridges where the noise crosses its middle, rising toward the far side
		const ridge = 1 - Math.abs(2 * m(p.x / 230, p.y / 230) - 1);
		return away * clamp(climb ** 1.2 * (0.15 + 0.85 * ridge ** 1.5) + (n(p.x / 120, p.y / 120) - 0.5) * 0.3);
	};
}

// Lower the ground along a line (a river cuts its valley), fully within `w` of it.
export function carve(h: (p: Pt) => number, line: Pt[], w: number): (p: Pt) => number {
	return (p) => {
		const v = h(p);
		return v === 0 ? 0 : v * smooth(lineDist(p, line) / w - 0.15);
	};
}

export interface Relief {
	level: number;
	rings: Pt[][]; // closed; filled together with even-odd they are the ground above `level`
}

// Contour rings at each level, by marching squares over a grid padded with zero so every ring closes.
export function contours(h: (p: Pt) => number, W: number, step: number, levels: number[]): Relief[] {
	const n = Math.ceil(W / step) + 1;
	const N = n + 2; // one padding row and column each side
	const v = new Float32Array(N * N);
	const X = (i: number) => (i - 1) * step;
	for (let j = 1; j <= n; j++) for (let i = 1; i <= n; i++) v[j * N + i] = h(pt(X(i), X(j)));
	const val = (i: number, j: number) => v[j * N + i] as number;
	const out: Relief[] = [];
	for (const level of levels) {
		// where the level crosses each grid edge, keyed by the edge
		const cut = (i: number, j: number, horiz: boolean): [string, Pt] => {
			const a = val(i, j), b = horiz ? val(i + 1, j) : val(i, j + 1);
			const t = clamp((level - a) / (b - a || 1e-9));
			return [`${horiz ? 'h' : 'v'}${i},${j}`, horiz ? pt(X(i) + t * step, X(j)) : pt(X(i), X(j) + t * step)];
		};
		const links = new Map<string, string[]>();
		const where = new Map<string, Pt>();
		const link = (a: [string, Pt], b: [string, Pt]) => {
			where.set(a[0], a[1]);
			where.set(b[0], b[1]);
			links.set(a[0], [...(links.get(a[0]) ?? []), b[0]]);
			links.set(b[0], [...(links.get(b[0]) ?? []), a[0]]);
		};
		let any = false;
		for (let j = 0; j < N - 1; j++)
			for (let i = 0; i < N - 1; i++) {
				const c = (val(i, j) > level ? 1 : 0) | (val(i + 1, j) > level ? 2 : 0) | (val(i + 1, j + 1) > level ? 4 : 0) | (val(i, j + 1) > level ? 8 : 0);
				if (c === 0 || c === 15) continue;
				any = true;
				const top = cut(i, j, true), right = cut(i + 1, j, false), bottom = cut(i, j + 1, true), left = cut(i, j, false);
				const mid = (val(i, j) + val(i + 1, j) + val(i + 1, j + 1) + val(i, j + 1)) / 4 > level;
				switch (c) {
					case 1: case 14: link(left, top); break;
					case 2: case 13: link(top, right); break;
					case 3: case 12: link(left, right); break;
					case 4: case 11: link(right, bottom); break;
					case 6: case 9: link(top, bottom); break;
					case 7: case 8: link(left, bottom); break;
					case 5:
						if (mid) { link(left, bottom); link(top, right); } else { link(left, top); link(right, bottom); }
						break;
					case 10:
						if (mid) { link(left, top); link(right, bottom); } else { link(left, bottom); link(top, right); }
						break;
				}
			}
		if (!any) continue;
		// walk each loop
		const seen = new Set<string>();
		const rings: Pt[][] = [];
		for (const k0 of links.keys()) {
			if (seen.has(k0)) continue;
			const ring: Pt[] = [];
			let k: string | undefined = k0, prev = '';
			while (k && !seen.has(k)) {
				seen.add(k);
				ring.push(where.get(k) as Pt);
				const next: string | undefined = (links.get(k) ?? []).find((x) => x !== prev && !seen.has(x));
				prev = k;
				k = next;
			}
			if (ring.length >= 4) rings.push(chaikin(thin(ring, step * 0.7), 1, true));
		}
		out.push({ level, rings });
	}
	return out;
}

// Drop points closer than `min` to the last one kept.
function thin(ring: Pt[], min: number): Pt[] {
	const out = [ring[0] as Pt];
	for (const q of ring) if (dist(q, out[out.length - 1] as Pt) >= min) out.push(q);
	return out.length >= 4 ? out : ring;
}
