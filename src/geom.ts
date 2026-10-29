// Plane geometry for the town: points, convex polygons, and the cuts that turn a ward into lots.

export interface Pt {
	x: number;
	y: number;
}
export type Poly = Pt[];

export const pt = (x: number, y: number): Pt => ({ x, y });
export const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Pt, k: number): Pt => ({ x: a.x * k, y: a.y * k });
export const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export const dot = (a: Pt, b: Pt) => a.x * b.x + a.y * b.y;
export const cross = (a: Pt, b: Pt) => a.x * b.y - a.y * b.x;
export const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
export const len = (a: Pt) => Math.hypot(a.x, a.y);
export const norm = (a: Pt): Pt => {
	const l = len(a) || 1;
	return { x: a.x / l, y: a.y / l };
};
export const perp = (a: Pt): Pt => ({ x: -a.y, y: a.x });
export const at = <T>(a: readonly T[], i: number): T => a[((i % a.length) + a.length) % a.length] as T;

// Signed area; positive when the corners run counter-clockwise in y-up terms.
export function area(p: Poly): number {
	let s = 0;
	for (let i = 0; i < p.length; i++) s += cross(p[i] as Pt, at(p, i + 1));
	return s / 2;
}

export function centroid(p: Poly): Pt {
	let x = 0, y = 0, a = 0;
	for (let i = 0; i < p.length; i++) {
		const u = p[i] as Pt, v = at(p, i + 1), c = cross(u, v);
		x += (u.x + v.x) * c;
		y += (u.y + v.y) * c;
		a += c;
	}
	if (Math.abs(a) < 1e-9) return mean(p);
	return { x: x / (3 * a), y: y / (3 * a) };
}

export function mean(p: Poly): Pt {
	const s = p.reduce((m, q) => add(m, q), pt(0, 0));
	return scale(s, 1 / Math.max(1, p.length));
}

// Keep the side of the line through `a` along `d` where cross(d, q - a) >= 0.
export function clipHalf(p: Poly, a: Pt, d: Pt): Poly {
	const out: Poly = [];
	const side = (q: Pt) => cross(d, sub(q, a));
	for (let i = 0; i < p.length; i++) {
		const u = p[i] as Pt, v = at(p, i + 1);
		const su = side(u), sv = side(v);
		if (su >= 0) out.push(u);
		if ((su >= 0) !== (sv >= 0)) out.push(lerp(u, v, su / (su - sv)));
	}
	return out;
}

// Cut a convex polygon in two along a line, leaving `gap` between the halves.
export function split(p: Poly, a: Pt, d: Pt, gap = 0): [Poly, Poly] {
	const n = scale(norm(perp(d)), gap / 2);
	return [clipHalf(p, add(a, n), d), clipHalf(p, sub(a, n), scale(d, -1))];
}

// Shrink a convex polygon by moving every side in by `w` (or by w[i] for side i).
export function inset(p: Poly, w: number | number[]): Poly {
	if (p.length < 3) return [];
	const ccw = area(p) > 0;
	let q = p.slice();
	for (let i = 0; i < p.length; i++) {
		const u = p[i] as Pt, v = at(p, i + 1);
		const d = ccw ? sub(v, u) : sub(u, v);
		const k = typeof w === 'number' ? w : (w[i] ?? 0);
		if (k <= 0) continue;
		const base = ccw ? u : v;
		q = clipHalf(q, add(base, scale(norm(perp(d)), k)), d);
		if (q.length < 3) return [];
	}
	return q;
}

// Grow or shrink about the centroid.
export function shrink(p: Poly, k: number): Poly {
	const c = centroid(p);
	return p.map((q) => lerp(c, q, k));
}

export function contains(p: Poly, q: Pt): boolean {
	let inside = false;
	for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
		const a = p[i] as Pt, b = p[j] as Pt;
		if (a.y > q.y !== b.y > q.y && q.x < ((b.x - a.x) * (q.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
	}
	return inside;
}

export function segDist(q: Pt, a: Pt, b: Pt): number {
	const ab = sub(b, a);
	const t = Math.max(0, Math.min(1, dot(sub(q, a), ab) / (dot(ab, ab) || 1)));
	return dist(q, lerp(a, b, t));
}

export function lineDist(q: Pt, line: Pt[]): number {
	let m = Infinity;
	for (let i = 0; i + 1 < line.length; i++) m = Math.min(m, segDist(q, line[i] as Pt, line[i + 1] as Pt));
	return m;
}

export function longestSide(p: Poly): number {
	let best = 0, bl = -1;
	for (let i = 0; i < p.length; i++) {
		const l = dist(p[i] as Pt, at(p, i + 1));
		if (l > bl) {
			bl = l;
			best = i;
		}
	}
	return best;
}

// Corner-cutting, for coasts and rivers that should not look like they were drawn with a ruler.
export function chaikin(line: Pt[], times = 2, closed = false): Pt[] {
	let p = line;
	for (let k = 0; k < times; k++) {
		const out: Pt[] = closed ? [] : [p[0] as Pt];
		const n = closed ? p.length : p.length - 1;
		for (let i = 0; i < n; i++) {
			const a = p[i] as Pt, b = at(p, i + 1);
			out.push(lerp(a, b, 0.25), lerp(a, b, 0.75));
		}
		if (!closed) out.push(p[p.length - 1] as Pt);
		p = out;
	}
	return p;
}

export function polyLength(line: Pt[]): number {
	let s = 0;
	for (let i = 0; i + 1 < line.length; i++) s += dist(line[i] as Pt, line[i + 1] as Pt);
	return s;
}

// The point and direction a given distance along a line.
export function along(line: Pt[], d: number): { p: Pt; dir: Pt } {
	for (let i = 0; i + 1 < line.length; i++) {
		const a = line[i] as Pt, b = line[i + 1] as Pt, l = dist(a, b);
		if (d <= l || i + 2 === line.length) return { p: lerp(a, b, l ? Math.min(1, d / l) : 0), dir: norm(sub(b, a)) };
		d -= l;
	}
	return { p: line[0] ?? pt(0, 0), dir: pt(1, 0) };
}

// A polygon with its sharp outward corners cut off: any corner narrower than `min` radians loses a tip
// `cut` long (or less, on short sides), so a lot cut into a sliver still reads as a building.
export function blunt(p: Poly, min: number, cut: number): Poly {
	const s = Math.sign(area(p));
	const out: Pt[] = [];
	p.forEach((v, i) => {
		const a = at(p, i - 1), b = at(p, i + 1);
		const da = sub(a, v), db = sub(b, v);
		const ang = Math.acos(Math.max(-1, Math.min(1, dot(norm(da), norm(db)))));
		const convex = Math.sign(cross(sub(v, a), sub(b, v))) === s;
		if (!convex || ang >= min) {
			out.push(v);
			return;
		}
		const la = Math.hypot(da.x, da.y), lb = Math.hypot(db.x, db.y);
		out.push(add(v, scale(norm(da), Math.min(cut, la * 0.4))), add(v, scale(norm(db), Math.min(cut, lb * 0.4))));
	});
	return out;
}
