// The town as SVG: a small tree of nodes that can become a string (for export and tests) or real DOM.

import { add, along, norm, perp, polyLength, pt, scale, sub, type Poly, type Pt } from './geom';
import { hashSeed, makeRng, range } from './rng';
import type { Town } from './town';

export interface Node {
	tag: string;
	a: Record<string, string | number>;
	kids?: (Node | string)[];
}

export interface Palette {
	paper: string;
	land: string;
	meadow: string;
	field: string[];
	hedge: string;
	street: string;
	garden: string;
	plaza: string;
	water: string;
	waterInk: string;
	wave: string;
	bank: string; // the sand or mud along the water
	road: string;
	roadInk: string;
	roof: string[];
	slate: string[]; // some quarters roof in slate
	hall: string;
	temple: string;
	keep: string;
	ink: string;
	wall: string;
	tree: string;
	treeDark: string;
	treeLight: string;
	green: string;
	label: string;
	badge: string;
	badgeInk: string;
	country?: Partial<Palette>; // what changes when the country is painted green
}

export const LIGHT: Palette = {
	paper: '#efe7d2',
	land: '#e7dfc4',
	meadow: '#dfdcb6',
	field: ['#e2d9b0', '#d9d4a6', '#e8dcb4', '#d2cf9e'],
	hedge: '#b9b07f',
	street: '#efe6cf',
	garden: '#e3dfbd',
	plaza: '#e9dcc0',
	water: '#97b9bf',
	waterInk: '#466a70',
	wave: '#b9d2d3',
	bank: '#e6d39f',
	road: '#f2ead6',
	roadInk: '#b3a37f',
	roof: ['#b9805f', '#a9745a', '#c08d68', '#9c6f5c', '#b48468'],
	slate: ['#8c9296', '#7e868b', '#969a98'],
	hall: '#8f6a58',
	temple: '#c9b9a0',
	keep: '#a3958a',
	ink: '#3f3229',
	wall: '#5e5146',
	tree: '#93a476',
	treeDark: '#5f7148',
	treeLight: '#b2c08f',
	green: '#cfd3a6',
	label: '#3f3229',
	badge: '#fbf6e9',
	badgeInk: '#7a2e1f',
	country: {
		land: '#cbd49c',
		meadow: '#c0cc8e',
		field: ['#d2d69e', '#c4ce8c', '#dad8a3', '#bccb88'],
		hedge: '#97a866',
		garden: '#d3d8a7',
		tree: '#80985f',
		treeDark: '#4b6136',
		treeLight: '#a5b97c',
	},
};

export const DARK: Palette = {
	paper: '#22211d',
	land: '#2b2a24',
	meadow: '#2e2f26',
	field: ['#33322a', '#2f3127', '#36342b', '#2c2e25'],
	hedge: '#45452f',
	street: '#3a372f',
	garden: '#2f3026',
	plaza: '#423d33',
	water: '#1f3537',
	waterInk: '#6f9599',
	wave: '#2f4d50',
	bank: '#4a4330',
	road: '#4a4538',
	roadInk: '#6d6450',
	roof: ['#8a5e47', '#7d5745', '#94694f', '#735446', '#86624e'],
	slate: ['#5d6468', '#555c61', '#646866'],
	hall: '#6e5244',
	temple: '#8f8676',
	keep: '#7a7068',
	ink: '#141210',
	wall: '#b8a891',
	tree: '#4c5a3c',
	treeDark: '#2d3824',
	treeLight: '#617050',
	green: '#384230',
	label: '#e8dfc8',
	badge: '#2b2620',
	badgeInk: '#f0b49a',
	country: {
		land: '#262f21',
		meadow: '#29342a',
		field: ['#2e3826', '#2a3423', '#333b29', '#283222'],
		hedge: '#3f4c2e',
		garden: '#2c3527',
		tree: '#465a37',
		treeDark: '#1f2a19',
		treeLight: '#5c7049',
	},
};

const f = (n: number) => Math.round(n * 10) / 10;
const d = (p: Pt[], close = true) => (p.length ? `M${p.map((q) => `${f(q.x)} ${f(q.y)}`).join('L')}${close ? 'Z' : ''}` : '');
const el = (tag: string, a: Record<string, string | number>, kids?: (Node | string)[]): Node => ({ tag, a, kids });
const g = (a: Record<string, string | number>, kids: (Node | string)[]) => el('g', a, kids);

export interface RenderOptions {
	palette?: Palette;
	labels?: boolean; // place numbers
	names?: boolean; // streets, quarters and where the roads go
	title?: boolean; // the town's name
	scaleBar?: boolean;
}

export function renderTown(t: Town, o: RenderOptions = {}): Node {
	const base = o.palette ?? LIGHT;
	const P: Palette = t.opts.land === 'green' ? { ...base, ...base.country } : base;
	const r = makeRng(`${t.opts.seed}:paint`);
	const u = (m: number) => m / t.mpu;
	const kids: Node[] = [];

	kids.push(el('rect', { x: 0, y: 0, width: t.w, height: t.h, fill: P.land }));
	const meadows = t.wards.filter((w) => w.kind === 'meadow' || w.kind === 'wood');
	kids.push(g({ fill: P.meadow }, meadows.map((w) => el('path', { d: d(w.poly) }))));
	kids.push(
		g(
			{ stroke: P.hedge, 'stroke-width': f(u(1.2)) },
			t.fields.map((x) => el('path', { d: d(x.poly), fill: P.field[x.tone % P.field.length] as string })),
		),
	);

	// water
	if (t.water.length) {
		kids.push(g({ fill: 'none', stroke: P.bank, 'stroke-width': f(u(18)), 'stroke-linejoin': 'round' }, t.water.map((w) => el('path', { d: d(w) }))));
	}
	// streets under the town, roads over the land
	kids.push(g({ fill: P.garden }, t.wards.filter((w) => w.kind === 'sparse').map((w) => el('path', { d: d(w.poly) }))));
	kids.push(g({ fill: P.street, stroke: P.street, 'stroke-width': 1 }, t.streets.map((s) => el('path', { d: d(s) }))));
	if (t.river) {
		const line = { d: d(t.river, false), fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
		kids.push(el('path', { ...line, stroke: P.bank, 'stroke-width': f(t.riverW + 4 + u(11)) }));
		kids.push(el('path', { ...line, stroke: P.waterInk, 'stroke-width': f(t.riverW + 4) }));
		kids.push(el('path', { ...line, stroke: P.water, 'stroke-width': f(t.riverW) }));
		// the current: a paler thread down the middle
		kids.push(el('path', { ...line, stroke: P.wave, 'stroke-width': f(t.riverW * 0.28), opacity: 0.8 }));
	}
	// the sea or lake over the river's end, so the river runs into it
	if (t.water.length) {
		kids.push(g({ fill: P.water, stroke: P.waterInk, 'stroke-width': 2 }, t.water.map((w) => el('path', { d: d(w) }))));
		kids.push(g({ fill: 'none', stroke: P.wave, 'stroke-width': 1.5, 'stroke-linecap': 'round' }, waves(t, r)));
	}

	kids.push(g({ fill: P.street }, t.wards.filter((w) => w.kind === 'dense' || w.kind === 'docks').map((w) => el('path', { d: d(w.poly) }))));
	kids.push(g({ fill: 'none', stroke: P.roadInk, 'stroke-width': f(t.roadW + 2.5), 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, t.roads.map((l) => el('path', { d: d(l, false) }))));
	kids.push(g({ fill: 'none', stroke: P.road, 'stroke-width': f(t.roadW), 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, t.roads.map((l) => el('path', { d: d(l, false) }))));
	kids.push(g({ fill: P.plaza, stroke: P.roadInk, 'stroke-width': 0.8 }, t.wards.filter((w) => w.kind === 'market').map((w) => el('path', { d: d(w.poly) }))));
	kids.push(g({ fill: P.green }, t.wards.filter((w) => w.kind === 'park' || w.kind === 'temple' || w.kind === 'keep').map((w) => el('path', { d: d(w.poly) }))));

	// bridges and piers
	kids.push(
		g(
			{ fill: P.road, stroke: P.ink, 'stroke-width': 1 },
			t.bridges.map((b) => el('path', { d: d(rectAt(b.p, b.dir, t.riverW + u(10), t.roadW + u(2))) })),
		),
	);
	kids.push(g({ fill: P.hall, stroke: P.ink, 'stroke-width': 0.8 }, t.piers.map((p) => el('path', { d: d(p) }))));

	// trees: a dark shadow then the crown
	const trees = t.trees;
	// a dark rim that runs together into the outline of a wood, the crowns, and a glint of light on each
	kids.push(dots(trees, P.treeDark, 1.18, 0.18, 0.24));
	kids.push(dots(trees, P.tree, 0.92, 0, 0));
	kids.push(dots(trees, P.treeLight, 0.4, -0.3, -0.32));

	// buildings
	// each ward has its own share of slate roofs among the tiles
	const slateShare = new Map<number, number>();
	const tone = (b: Town['buildings'][number]) => {
		if (!slateShare.has(b.ward)) slateShare.set(b.ward, r() < 0.4 ? range(r, 0.2, 0.8) : range(r, 0, 0.12));
		const list = r() < (slateShare.get(b.ward) as number) ? P.slate : P.roof;
		return list[Math.floor(r() * list.length)] as string;
	};
	const roofs = t.buildings.map((b) => {
		const fill = b.kind === 'temple' ? P.temple : b.kind === 'keep' ? P.keep : b.kind === 'hall' || b.kind === 'warehouse' ? P.hall : tone(b);
		const a: Record<string, string | number> = { d: d(b.poly), fill };
		if (b.place !== undefined) {
			a['data-place'] = b.place;
			a.class = 'mapsmith-place';
		}
		return el('path', a);
	});
	kids.push(g({ stroke: P.ink, 'stroke-width': f(Math.max(0.6, u(0.5))), 'stroke-linejoin': 'round' }, roofs));
	// ridge lines on big roofs
	kids.push(
		g(
			{ stroke: P.ink, 'stroke-width': 0.5, opacity: 0.45 },
			t.buildings
				.filter((b) => b.kind === 'temple' || b.kind === 'hall' || b.kind === 'keep' || b.kind === 'warehouse' || b.kind === 'farmhouse')
				.map((b) => ridge(b.poly))
				.filter((x): x is Node => !!x),
		),
	);

	// wall, towers, gates
	if (t.walls.length) {
		kids.push(g({ fill: 'none', stroke: P.wall, 'stroke-width': f(u(3.5)), 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, t.walls.map((w) => el('path', { d: d(w, false) }))));
		kids.push(g({ fill: P.wall, stroke: P.ink, 'stroke-width': 0.8 }, t.towers.map((p) => el('circle', { cx: f(p.x), cy: f(p.y), r: f(u(4)) }))));
		kids.push(
			g(
				{ fill: P.wall, stroke: P.ink, 'stroke-width': 0.8 },
				t.gates.flatMap((gt) => {
					const s = perp(gt.dir);
					return [
						el('path', { d: d(rectAt(gt.p, gt.dir, u(6), t.roadW)), fill: P.road, stroke: 'none' }),
						...[-1, 1].map((k) => el('path', { d: d(rectAt(add(gt.p, scale(s, k * (t.roadW / 2 + u(2.5)))), gt.dir, u(8), u(5))) })),
					];
				}),
			),
		);
	}

	// street and quarter names, under the numbers, with a halo of land so they read over roofs
	if (o.names !== false && t.labels.length) {
		const id = `ms${hashSeed(`${t.opts.seed}:${t.opts.size}:${t.opts.water}:${t.name}`).toString(36)}`;
		// streets and quarters sit in the town, so their halo is paving; where the roads go is out in the country
		const halo = { stroke: P.street, 'stroke-width': 3, 'stroke-linejoin': 'round', 'paint-order': 'stroke' };
		const out = { ...halo, stroke: P.land };
		const defs: Node[] = [];
		const words: Node[] = [];
		t.labels.forEach((l, i) => {
			if (l.kind === 'street' && l.line) {
				defs.push(el('path', { id: `${id}-${i}`, d: d(l.line, false) }));
				words.push(
					el('text', { 'font-size': l.size ?? 11, 'font-style': 'italic', dy: 3.5, ...halo }, [
						el('textPath', { href: `#${id}-${i}`, startOffset: '50%', 'text-anchor': 'middle' }, [l.text]),
					]),
				);
			} else if (l.kind === 'quarter') {
				words.push(el('text', { x: f(l.at.x), y: f(l.at.y + 4), 'font-size': 12, 'letter-spacing': 2.5, 'text-anchor': 'middle', opacity: 0.85, ...halo }, [l.text]));
			} else {
				words.push(el('text', { x: f(l.at.x), y: f(l.at.y + 4), 'font-size': 11, 'font-style': 'italic', 'text-anchor': 'middle', ...out }, [l.text]));
			}
		});
		kids.push(el('defs', {}, defs));
		kids.push(g({ class: 'mapsmith-names', 'font-family': 'Georgia, serif', fill: P.label }, words));
	}

	// numbers on the places
	if (o.labels !== false) {
		const rad = 10;
		kids.push(
			g(
				{ 'font-family': 'Georgia, serif', 'font-size': 11, 'font-weight': 'bold', 'text-anchor': 'middle' },
				t.places.map((p) =>
					g({ class: 'mapsmith-badge', 'data-place': p.n - 1 }, [
						el('circle', { cx: f(p.at.x), cy: f(p.at.y), r: rad, fill: P.badge, stroke: P.badgeInk, 'stroke-width': 1.5 }),
						el('text', { x: f(p.at.x), y: f(p.at.y + 4), fill: P.badgeInk }, [String(p.n)]),
					]),
				),
			),
		);
	}

	if (o.title !== false) {
		const w = t.name.length * 15 + 40;
		kids.push(
			g({}, [
				el('rect', { x: f(t.w / 2 - w / 2), y: 18, width: w, height: 40, rx: 3, fill: P.badge, stroke: P.ink, 'stroke-width': 1.2 }),
				el('text', { x: t.w / 2, y: 46, 'text-anchor': 'middle', 'font-family': 'Georgia, serif', 'font-size': 24, 'letter-spacing': 2, fill: P.label }, [t.name.toUpperCase()]),
			]),
		);
	}
	if (o.scaleBar !== false) kids.push(scaleBar(t, P));
	kids.push(compass(t, P));
	kids.push(el('rect', { x: 1, y: 1, width: t.w - 2, height: t.h - 2, fill: 'none', stroke: P.ink, 'stroke-width': 2 }));

	return el('svg', { xmlns: 'http://www.w3.org/2000/svg', viewBox: `0 0 ${t.w} ${t.h}`, class: 'mapsmith-svg' }, kids);
}

function rectAt(c: Pt, dir: Pt, l: number, w: number): Poly {
	const a = scale(norm(dir), l / 2), b = scale(perp(norm(dir)), w / 2);
	return [add(add(c, a), b), add(sub(c, a), b), sub(sub(c, a), b), sub(add(c, a), b)];
}

// Round dots for many trees, a few paths instead of thousands of circles: each dot is a zero-length line with
// round ends, and dots of about the same size share one path.
function dots(list: { x: number; y: number; r: number }[], color: string, k: number, dx: number, dy: number): Node {
	const by = new Map<number, string[]>();
	for (const c of list) {
		const w = Math.max(0.5, Math.round(c.r * k * 4) / 2);
		by.set(w, [...(by.get(w) ?? []), `M${f(c.x + c.r * dx)} ${f(c.y + c.r * dy)}h0`]);
	}
	return g(
		{ fill: 'none', stroke: color, 'stroke-linecap': 'round' },
		[...by].map(([w, ds]) => el('path', { d: ds.join(''), 'stroke-width': w })),
	);
}

// A roof ridge: the line down the middle of the long side.
function ridge(p: Poly): Node | null {
	if (p.length !== 4) return null;
	const [a, b, c, e] = p as [Pt, Pt, Pt, Pt];
	const l1 = Math.hypot(b.x - a.x, b.y - a.y), l2 = Math.hypot(c.x - b.x, c.y - b.y);
	const m = (x: Pt, y: Pt) => pt((x.x + y.x) / 2, (x.y + y.y) / 2);
	const [s, t] = l1 > l2 ? [m(a, e), m(b, c)] : [m(a, b), m(e, c)];
	return el('path', { d: `M${f(s.x)} ${f(s.y)}L${f(t.x)} ${f(t.y)}` });
}

function waves(t: Town, r: () => number): Node[] {
	const out: Node[] = [];
	for (const w of t.water) {
		const L = polyLength(w);
		for (let s = 30; s < L; s += 55) {
			const { p, dir } = along(w, s);
			const n = perp(dir);
			for (const k of [12, 24]) {
				if (r() < 0.35) continue;
				const q = add(p, scale(n, -k));
				const a = add(q, scale(dir, -9)), b = add(q, scale(dir, 9));
				out.push(el('path', { d: `M${f(a.x)} ${f(a.y)}Q${f(q.x + n.x * -3)} ${f(q.y + n.y * -3)} ${f(b.x)} ${f(b.y)}` }));
			}
		}
	}
	void range;
	return out;
}

function scaleBar(t: Town, P: Palette): Node {
	const step = t.opts.size === 'hamlet' || t.opts.size === 'village' ? 50 : 100; // metres
	const seg = step / t.mpu;
	const x0 = 30, y0 = t.h - 34;
	const kids: Node[] = [];
	for (let i = 0; i < 2; i++) kids.push(el('rect', { x: f(x0 + i * seg), y: y0, width: f(seg), height: 6, fill: i % 2 ? P.badge : P.ink, stroke: P.ink, 'stroke-width': 1 }));
	for (let i = 0; i <= 2; i++) kids.push(el('text', { x: f(x0 + i * seg), y: y0 - 6, 'text-anchor': 'middle' }, [String(i * step)]));
	kids.push(el('text', { x: f(x0 + 2 * seg + 10), y: y0 + 7 }, ['m']));
	// a halo of land, since woods can run under the numbers
	return g({ 'font-family': 'Georgia, serif', 'font-size': 12, fill: P.label, stroke: P.land, 'stroke-width': 3, 'stroke-linejoin': 'round', 'paint-order': 'stroke' }, kids);
}

function compass(t: Town, P: Palette): Node {
	const c = pt(t.w - 50, t.h - 60);
	return g({}, [
		el('circle', { cx: c.x, cy: c.y, r: 22, fill: P.badge, stroke: P.ink, 'stroke-width': 1 }),
		el('path', { d: `M${c.x} ${c.y - 18}L${c.x + 6} ${c.y}L${c.x} ${c.y + 18}L${c.x - 6} ${c.y}Z`, fill: P.ink }),
		el('path', { d: `M${c.x} ${c.y - 18}L${c.x + 6} ${c.y}L${c.x} ${c.y}Z`, fill: P.badgeInk }),
		el('text', { x: c.x, y: c.y - 26, 'text-anchor': 'middle', 'font-family': 'Georgia, serif', 'font-size': 12, fill: P.label }, ['N']),
	]);
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function toString(n: Node | string): string {
	if (typeof n === 'string') return esc(n);
	const attrs = Object.entries(n.a)
		.map(([k, v]) => ` ${k}="${esc(String(v))}"`)
		.join('');
	if (!n.kids?.length) return `<${n.tag}${attrs}/>`;
	return `<${n.tag}${attrs}>${n.kids.map(toString).join('')}</${n.tag}>`;
}

// Build the tree under `parent` with Obsidian's own element helpers.
export function toDom(n: Node, parent: Element): SVGElement {
	const attr: Record<string, string> = {};
	for (const [k, v] of Object.entries(n.a)) if (k !== 'xmlns') attr[k] = String(v);
	const e = parent.createSvg(n.tag as keyof SVGElementTagNameMap, { attr });
	for (const k of n.kids ?? []) {
		if (typeof k === 'string') e.appendText(k);
		else toDom(k, e);
	}
	return e;
}
