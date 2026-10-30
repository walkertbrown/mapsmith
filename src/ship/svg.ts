// A ship deck as SVG, drawn the way Bulkhead draws it on canvas: floors, the grid, walls with the hull on top,
// torn breaches, fixtures, doors, numbers and room names. Grid units are scaled by S into the picture.

import { el, f, g, type Node } from '../render';
import { CORRIDOR, VOID, badgeSpots, bounds, cellAt, derived, footprint, idx, keyEntries, sideDelta, type Deck, type Door } from './model';
import type { Explored } from '../explore';
import { drawStamp, type Surface } from './stamps';

export interface ShipPalette {
	bg: string;
	floor: string;
	corridor: string;
	grid: string;
	wall: string;
	hull: string;
	door: string;
	airlock: string;
	hatch: string;
	window: string;
	text: string;
	stamp: string;
	stampFill: string;
	stampAccent: string;
	badge: string;
	badgeInk: string;
	tints: string[];
	hullWidth: number;
	wallWidth: number;
	/** hatching round the floors, for rock */
	rock?: string;
}

// Bulkhead's dungeon look on parchment, and its blueprint in the dark
export const SHIP_LIGHT: ShipPalette = {
	bg: '#e9dfc9', floor: '#f6efdf', corridor: '#efe6d2', grid: 'rgba(60,40,20,0.14)',
	wall: '#4a3826', hull: '#1e150d', door: '#6b4a2b', airlock: '#8a4b2b', hatch: '#6b4a2b', window: '#8fa7b8',
	text: '#2b2118', stamp: '#3d2e1f', stampFill: '#f6efdf', stampAccent: '#c9b89a', badge: '#fffaf0', badgeInk: '#7a2e1f',
	tints: ['#f6efdf', '#efe3cf', '#e6dccb', '#f0e0d0', '#e3e9d6', '#f3ecd0', '#e8e0d8', '#eadad0'],
	hullWidth: 0.2, wallWidth: 0.09,
};

export const SHIP_DARK: ShipPalette = {
	bg: '#0b2a4a', floor: '#123a63', corridor: '#0f3358', grid: 'rgba(140,190,240,0.18)',
	wall: '#cfe6ff', hull: '#ffffff', door: '#ffd166', airlock: '#ff7b54', hatch: '#9be7ff', window: '#9be7ff',
	text: '#e8f3ff', stamp: '#9fc4ea', stampFill: '#0d2f52', stampAccent: '#2f6fa8', badge: '#ffd166', badgeInk: '#1a1400',
	tints: ['#123a63', '#1d3f5a', '#3a2f5e', '#5a2a3e', '#1f4a44', '#4a3d1f', '#2b3a4f', '#3f2f2f'],
	hullWidth: 0.18, wallWidth: 0.08,
};

// stone for dungeons: parchment and ink, and a cold dark
export const DUNGEON_LIGHT: ShipPalette = {
	bg: '#ddd4c1', floor: '#f8f3e8', corridor: '#f2ebdb', grid: 'rgba(50,40,30,0.12)',
	wall: '#3a322a', hull: '#221d18', door: '#6b4a2b', airlock: '#6b4a2b', hatch: '#6b4a2b', window: '#8fa7b8',
	text: '#2b2118', stamp: '#3a3028', stampFill: '#f8f3e8', stampAccent: '#cbbfa6', badge: '#fffaf0', badgeInk: '#7a2e1f',
	tints: ['#f8f3e8', '#f1e9d7', '#eee7de', '#f4e7d9', '#e9eddd', '#f5efd5', '#ece6e1', '#f0e3d7', '#dfe0c6'],
	hullWidth: 0.24, wallWidth: 0.1, rock: 'rgba(40,30,20,0.4)',
};

export const DUNGEON_DARK: ShipPalette = {
	bg: '#121418', floor: '#2c3038', corridor: '#262a31', grid: 'rgba(210,200,180,0.10)',
	wall: '#b9b2a2', hull: '#ddd6c4', door: '#d9a441', airlock: '#d9a441', hatch: '#d9a441', window: '#9be7ff',
	text: '#ece6d8', stamp: '#cfc6b2', stampFill: '#2c3038', stampAccent: '#5c5648', badge: '#d9a441', badgeInk: '#1a1400',
	tints: ['#2c3038', '#31343b', '#2e3540', '#39312f', '#2c3732', '#37352b', '#32313b', '#353030', '#232a22'],
	hullWidth: 0.22, wallWidth: 0.09, rock: 'rgba(220,210,190,0.2)',
};

const S = 24; // px per grid square

// Collects a fixture's shapes in its own unit square; the group around them places, turns and scales it.
class SvgSurface implements Surface {
	kids: Node[] = [];
	private paint(a: Record<string, string | number>, fill?: string, stroke?: string, lw?: number) {
		a.fill = fill ?? 'none';
		if (stroke && lw) {
			a.stroke = stroke;
			a['stroke-width'] = f(Math.max(1 / S, lw) * 1000) / 1000;
		}
		return a;
	}
	image(_src: string, w: number, h: number, stroke: string) {
		this.kids.push(el('rect', this.paint({ x: 0.1, y: 0.1, width: w - 0.2, height: h - 0.2 }, undefined, stroke, 0.06)));
	}
	rect(x: number, y: number, w: number, h: number, fill?: string, stroke?: string, lw?: number) {
		this.kids.push(el('rect', this.paint({ x: n(x), y: n(y), width: n(w), height: n(h) }, fill, stroke, lw)));
	}
	line(x1: number, y1: number, x2: number, y2: number, stroke: string, lw: number) {
		this.kids.push(el('line', { ...this.paint({ x1: n(x1), y1: n(y1), x2: n(x2), y2: n(y2) }, undefined, stroke, lw), 'stroke-linecap': 'round' }));
	}
	circle(cx: number, cy: number, r: number, fill?: string, stroke?: string, lw?: number) {
		this.kids.push(el('circle', this.paint({ cx: n(cx), cy: n(cy), r: n(r) }, fill, stroke, lw)));
	}
	poly(points: [number, number][], fill?: string, stroke?: string, lw?: number) {
		this.kids.push(el('polygon', this.paint({ points: points.map(([x, y]) => `${n(x)},${n(y)}`).join(' ') }, fill, stroke, lw)));
	}
}
// unit-square coordinates keep three places
const n = (v: number) => Math.round(v * 1000) / 1000;

export interface ShipRenderOptions {
	palette?: ShipPalette;
	/** the grid on the floors */
	grid?: boolean;
	/** an id prefix, so two maps in one note don't share patterns */
	id?: string;
	/** the map players see in a VTT: no numbers, and a secret door is only wall */
	players?: boolean;
	/** solo play: only what has been seen, with a mark on each door into the dark */
	fog?: Explored;
}

export function renderDeck(d: Deck, o: ShipRenderOptions = {}): Node {
	const P = o.palette ?? SHIP_LIGHT;
	const id = o.id ?? 'ship';
	const b = bounds(d) ?? { x0: 0, y0: 0, x1: 1, y1: 1 };
	const pad = 1;
	const x0 = b.x0 - pad, y0 = b.y0 - pad, w = b.x1 - b.x0 + pad * 2, h = b.y1 - b.y0 + pad * 2;
	const X = (gx: number) => f((gx - x0) * S);
	const Y = (gy: number) => f((gy - y0) * S);
	const kids: Node[] = [el('rect', { width: w * S, height: h * S, fill: P.bg })];

	// floors, one rect per run of the same region along a row
	const floors = new Map<string, string[]>();
	const runs: string[] = [];
	for (let y = b.y0; y < b.y1; y++) {
		let x = b.x0;
		while (x < b.x1) {
			const c = cellAt(d, x, y);
			let e = x + 1;
			while (e < b.x1 && cellAt(d, e, y) === c) e++;
			if (c !== VOID) {
				const tint = d.tints[c];
				const fill = c === CORRIDOR ? P.corridor : tint !== undefined ? (P.tints[tint] ?? P.floor) : P.floor;
				const run = `M${X(x)} ${Y(y)}h${(e - x) * S}v${S}h${-(e - x) * S}Z`;
				floors.set(fill, [...(floors.get(fill) ?? []), run]);
				runs.push(run);
			}
			x = e;
		}
	}
	if (P.rock) {
		// a band of hatching round every floor, the way rock is drawn on a hand-made dungeon
		kids.push(
			el('defs', {}, [
				el('pattern', { id: `${id}-rock`, width: 5, height: 5, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, [
					el('path', { d: 'M0 0V5', stroke: P.rock, 'stroke-width': 1.2 }),
				]),
			]),
		);
		kids.push(el('path', { d: runs.join(''), fill: 'none', stroke: `url(#${id}-rock)`, 'stroke-width': f(S * 1.4), 'stroke-linejoin': 'round' }));
	}
	for (const [fill, parts] of floors) kids.push(el('path', { d: parts.join(''), fill }));
	if (o.grid !== false) {
		kids.push(
			el('defs', {}, [
				el('pattern', { id: `${id}-grid`, width: S, height: S, patternUnits: 'userSpaceOnUse' }, [
					el('path', { d: `M${S} 0H0V${S}`, fill: 'none', stroke: P.grid, 'stroke-width': 1 }),
				]),
			]),
		);
		kids.push(el('path', { d: runs.join(''), fill: `url(#${id}-grid)` }));
	}

	// walls, then the hull over them
	const { segs, centres } = derived(d);
	for (const hull of [false, true]) {
		const path = segs
			.filter((s) => s.hull === hull)
			.map((s) => `M${X(s.x1)} ${Y(s.y1)}L${X(s.x2)} ${Y(s.y2)}`)
			.join('');
		if (path) kids.push(el('path', { d: path, fill: 'none', stroke: hull ? P.hull : P.wall, 'stroke-width': f(Math.max(1, (hull ? P.hullWidth : P.wallWidth) * S)), 'stroke-linecap': 'square' }));
	}

	if (d.breaches.length) kids.push(drawBreaches(d, P, X, Y));

	// fixtures
	const sc = { stroke: P.stamp, fill: P.stampFill, accent: P.stampAccent };
	for (const st of d.stamps) {
		const [fw, fh] = footprint(st.kind);
		const rw = st.rot % 2 ? fh : fw, rh = st.rot % 2 ? fw : fh;
		const s = new SvgSurface();
		drawStamp(s, st.kind, sc);
		const cx = X(st.x) + (rw * S) / 2, cy = Y(st.y) + (rh * S) / 2;
		kids.push(g({ transform: `translate(${f(cx)} ${f(cy)}) rotate(${st.rot * 90}) translate(${f((-fw * S) / 2)} ${f((-fh * S) / 2)}) scale(${S})` }, s.kids));
	}

	// in solo play a secret door is wall until a search finds it
	d.doors.forEach((k, i) => kids.push(door(k, P, X, Y, o.players || (!!o.fog && !o.fog.found.has(i)))));

	// room names
	kids.push(
		g(
			{ 'font-family': 'system-ui, sans-serif', 'font-weight': 600, 'text-anchor': 'middle', 'dominant-baseline': 'central', fill: P.text, stroke: P.floor, 'stroke-linejoin': 'round', 'paint-order': 'stroke' },
			d.labels.map((l) => el('text', { x: X(l.x), y: Y(l.y), 'font-size': f(Math.max(4, l.size * S)), 'stroke-width': f(Math.max(2, l.size * S * 0.3)) }, [l.text])),
		),
	);

	if (o.players) return el('svg', { xmlns: 'http://www.w3.org/2000/svg', viewBox: `0 0 ${w * S} ${h * S}`, width: w * S, height: h * S }, kids);

	// numbers, clickable like a town's places
	const spots = badgeSpots(d, centres);
	const r = S * 0.34;
	kids.push(
		g(
			{ 'font-family': 'Georgia, serif', 'font-size': f(r * 1.2), 'font-weight': 'bold', 'text-anchor': 'middle' },
			keyEntries(d).flatMap((e, i) => {
				const c = spots.get(e.id);
				if (!c || (o.fog && !o.fog.rooms.has(e.id))) return [];
				const cx = X(c.x), cy = f(Y(c.y) - S * 0.45);
				return [
					g({ class: 'mapsmith-badge', 'data-place': i }, [
						el('circle', { class: 'mapsmith-ring', cx, cy, r: f(r * 2.2), fill: 'none', stroke: P.badgeInk, 'stroke-width': 3, visibility: 'hidden', 'pointer-events': 'none' }),
						el('circle', { cx, cy, r: f(r), fill: P.badge, stroke: P.badgeInk, 'stroke-width': 1.5 }),
						el('text', { x: cx, y: f(cy + r * 0.42), fill: P.badgeInk }, [String(e.num)]),
					]),
				];
			}),
		),
	);

	if (o.fog) {
		// dark over everything not seen yet; the walls and rock round a seen floor still show
		const holes: string[] = [];
		const m = S * 0.3;
		for (let y = b.y0; y < b.y1; y++)
			for (let x = b.x0; x < b.x1; x++) {
				if (!o.fog.seen[idx(x, y)]) continue;
				let e = x + 1;
				while (e < b.x1 && o.fog.seen[idx(e, y)]) e++;
				holes.push(`M${f(X(x) - m)} ${f(Y(y) - m)}h${f((e - x) * S + m * 2)}v${f(S + m * 2)}h${f(-(e - x) * S - m * 2)}Z`);
				x = e;
			}
		kids.push(
			el('defs', {}, [el('mask', { id: `${id}-fog` }, [el('rect', { width: w * S, height: h * S, fill: '#fff' }), el('path', { d: holes.join(''), fill: '#000' })])]),
			el('rect', { width: w * S, height: h * S, fill: P.bg, mask: `url(#${id}-fog)`, 'pointer-events': 'none' }),
			g(
				{ 'font-family': 'Georgia, serif', 'font-size': f(r * 1.4), 'font-weight': 'bold', 'text-anchor': 'middle' },
				o.fog.ways.map((k) =>
					g({ class: 'mapsmith-way', 'data-enter': k.num }, [
						el('title', {}, ['Go in']),
						el('circle', { cx: X(k.x + 0.5), cy: Y(k.y + 0.5), r: f(r * 1.2), fill: P.badge, stroke: P.badgeInk, 'stroke-width': 1.5, 'stroke-dasharray': '3 2' }),
						el('text', { x: X(k.x + 0.5), y: f(Y(k.y + 0.5) + r * 0.5), fill: P.badgeInk }, ['?']),
					]),
				),
			),
		);
	}

	return el('svg', { xmlns: 'http://www.w3.org/2000/svg', viewBox: `0 0 ${w * S} ${h * S}`, role: 'img', 'aria-label': d.name }, kids);
}

function door(k: Door, P: ShipPalette, X: (x: number) => number, Y: (y: number) => number, players = false): Node {
	// a door sits on the N or W edge of its cell
	const [, dy] = sideDelta(k.side);
	const horiz = dy !== 0;
	const cx = X(k.x + (horiz ? 0.5 : 0)), cy = Y(k.y + (horiz ? 0 : 0.5));
	const len = S * 0.8;
	const thick = S * (k.kind === 'airlock' ? 0.34 : k.kind === 'hatch' ? 0.2 : k.kind === 'window' ? 0.12 : 0.26);
	const color = k.kind === 'airlock' ? P.airlock : k.kind === 'hatch' ? P.hatch : k.kind === 'window' ? P.window : P.door;
	const at = { transform: `translate(${f(cx)} ${f(cy)})${horiz ? '' : ' rotate(90)'}` };
	const sw = f(Math.max(1, S * 0.06));
	if (k.kind === 'arch') return g(at, [-1, 1].map((e) => el('rect', { x: f((e * len) / 2 - S * 0.13), y: f(-S * 0.13), width: f(S * 0.26), height: f(S * 0.26), fill: P.hull })));
	if (k.kind === 'bars')
		return g(at, [
			el('path', { d: `M${f(-len / 2)} 0H${f(len / 2)}`, stroke: P.door, 'stroke-width': sw }),
			...[-2, -1, 0, 1, 2].map((i) => el('circle', { cx: f((i * len) / 5), cy: 0, r: f(S * 0.07), fill: P.door })),
		]);
	if (k.kind === 'secret')
		// the wall carries on; only the S gives it away
		return g({}, [
			g(at, [el('path', { d: `M${f(-S / 2)} 0H${f(S / 2)}`, stroke: P.wall, 'stroke-width': f(Math.max(1, P.wallWidth * S)) })]),
			...(players ? [] : [el('text', { x: f(cx), y: f(cy), 'font-family': 'Georgia, serif', 'font-size': f(S * 0.55), 'font-weight': 'bold', 'text-anchor': 'middle', 'dominant-baseline': 'central', fill: P.door, stroke: P.floor, 'stroke-width': 3, 'paint-order': 'stroke' }, ['S'])]),
		]);
	const box = (h: number, fill: string, stroke?: string) => el('rect', { x: f(-len / 2), y: f(-h / 2), width: f(len), height: f(h), fill, ...(stroke ? { stroke, 'stroke-width': f(Math.max(1, S * 0.06)) } : {}) });
	if (k.kind === 'window') {
		const gap = S * 0.22;
		return g(at, [
			box(gap, P.bg),
			box(thick, color),
			el('path', { d: `M${f(-len / 2)} ${f(-gap / 2)}v${f(gap)}M${f(len / 2)} ${f(-gap / 2)}v${f(gap)}`, stroke: P.hull, 'stroke-width': f(Math.max(1, S * 0.04)) }),
		]);
	}
	const mark =
		k.kind === 'airlock'
			? el('path', { d: `M${f(-len / 2)} 0H${f(len / 2)}` })
			: k.kind === 'hatch'
				? el('circle', { r: f(thick * 0.5), fill: 'none' })
				: el('path', { d: `M0 ${f(-thick / 2)}V${f(thick / 2)}` });
	return g(at, [box(thick, P.floor, color), g({ stroke: color, 'stroke-width': f(Math.max(1, S * 0.06)) }, [mark])]);
}

type Pt2 = [number, number];
// the same numbers for the same square every time, so a plan always draws the same
const jit = (x: number, y: number, k: number) => {
	const v = Math.sin(x * 127.1 + y * 311.7 + k * 74.7) * 43758.5453;
	return v - Math.floor(v);
};

// A hole in the hull: the straight wall ripped out, a ragged edge biting into the floor,
// plating bent out toward space, and shards on the floor beside it.
function drawBreaches(d: Deck, P: ShipPalette, X: (x: number) => number, Y: (y: number) => number): Node {
	const erase: string[] = [], bites: string[] = [], edges: string[] = [], debris: string[] = [];
	const path = (pts: Pt2[], close: boolean) => `M${pts.map(([x, y]) => `${X(x)} ${Y(y)}`).join('L')}${close ? 'Z' : ''}`;
	const SIDES = [[0, -1, 0, 0, 1, 0], [1, 0, 1, 0, 1, 1], [0, 1, 0, 1, 1, 1], [-1, 0, 0, 0, 0, 1]] as const;
	for (const [x, y] of d.breaches) {
		if (cellAt(d, x, y) !== VOID) continue;
		SIDES.forEach(([dx, dy, ax, ay, bx, by], si) => {
			if (cellAt(d, x + dx, y + dy) === VOID) return;
			const k = si * 10;
			const x1 = x + ax, y1 = y + ay, x2 = x + bx, y2 = y + by;
			erase.push(path([[x1, y1], [x2, y2]], false));
			const pts: Pt2[] = [];
			for (let i = 0; i <= 6; i++) {
				const t = i / 6, bite = i === 0 || i === 6 ? 0 : 0.04 + jit(x, y, k + i) * 0.2;
				pts.push([x1 + (x2 - x1) * t + dx * bite, y1 + (y2 - y1) * t + dy * bite]);
			}
			bites.push(path(pts, true));
			edges.push(path(pts, false));
			for (let i = 1; i <= 2; i++) {
				const [gx, gy] = pts[1 + Math.floor(jit(x, y, k + 20 + i) * 5)] as Pt2;
				const len = 0.12 + jit(x, y, k + 30 + i) * 0.22, skew = (jit(x, y, k + 40 + i) - 0.5) * 0.3;
				edges.push(path([[gx, gy], [gx - dx * len + dy * skew, gy - dy * len + dx * skew]], false));
			}
			for (let i = 0; i < 3; i++) {
				const along = 0.15 + jit(x, y, k + 50 + i) * 0.7, into = 0.3 + jit(x, y, k + 60 + i) * 0.45;
				const cx = x1 + (x2 - x1) * along + dx * into, cy = y1 + (y2 - y1) * along + dy * into;
				const r = 0.04 + jit(x, y, k + 70 + i) * 0.06, a = jit(x, y, k + 80 + i) * Math.PI * 2;
				debris.push(path([0, 1, 2].map((j): Pt2 => [cx + Math.cos(a + j * 2.1) * r * (j ? 1 : 1.8), cy + Math.sin(a + j * 2.1) * r * (j ? 1 : 1.8)]), true));
			}
		});
	}
	return g({}, [
		el('path', { d: erase.join(''), stroke: P.bg, 'stroke-width': f(Math.max(2, P.hullWidth * S + 2)), fill: 'none' }),
		el('path', { d: bites.join(''), fill: P.bg }),
		el('path', { d: edges.join(''), fill: 'none', stroke: P.hull, 'stroke-width': f(Math.max(1, P.wallWidth * S)), 'stroke-linecap': 'round' }),
		el('path', { d: debris.join(''), fill: P.wall, opacity: 0.8 }),
	]);
}
