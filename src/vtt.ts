// Universal VTT (.dd2vtt): the file Dungeondraft writes and Roll20 imports and Foundry reads with the Universal Battlemap Importer module.
// Checked 29 Oct against two importers' source: Foundry's DD-Import and uvtt2fgu. Points are in grid squares from
// map_origin, y down; a wall is a polyline; a portal's bounds are the door's two ends, and closed: false is a window.
import { bounds, Deck, sideDelta, stampSize, vttWalls } from './ship/model';
import { blocksSight } from './ship/stamps';
import { add, dist, mean, norm, scale, segDist, sub, type Pt as P } from './geom';
import type { Town } from './town';
import type { Region } from './region';

interface Pt {
	x: number;
	y: number;
}

export interface UVTT {
	format: number;
	resolution: { map_origin: Pt; map_size: Pt; pixels_per_grid: number };
	line_of_sight: Pt[][];
	objects_line_of_sight: Pt[][];
	portals: { position: Pt; bounds: Pt[]; rotation: number; closed: boolean; freestanding: boolean }[];
	environment: { baked_lighting: boolean; ambient_light: string };
	lights: { position: Pt; range: number; intensity: number; color: string; shadows: boolean }[];
	image: string;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Everything but the picture. The frame matches renderDeck's: one square of margin round the map. */
export function uvttData(d: Deck, pixelsPerGrid: number): UVTT {
	const b = bounds(d) ?? { x0: 0, y0: 0, x1: 1, y1: 1 };
	const ox = b.x0 - 1, oy = b.y0 - 1;
	const at = (x: number, y: number): Pt => ({ x: r3(x - ox), y: r3(y - oy) });
	const line_of_sight = vttWalls(d).map((s) => [at(s.x1, s.y1), at(s.x2, s.y2)]);
	const portals: UVTT['portals'] = [];
	for (const k of d.doors) {
		const horiz = sideDelta(k.side)[1] !== 0;
		const a = at(k.x, k.y), e = horiz ? at(k.x + 1, k.y) : at(k.x, k.y + 1);
		if (k.kind === 'arch') continue; // an open way through
		if (k.kind === 'secret') { line_of_sight.push([a, e]); continue; } // wall until the party finds it
		portals.push({
			position: at(k.x + (horiz ? 0.5 : 0), k.y + (horiz ? 0 : 0.5)),
			bounds: [a, e],
			rotation: horiz ? 0 : r3(Math.PI / 2),
			closed: k.kind !== 'window' && k.kind !== 'bars', // see through, can't walk through
			freestanding: false,
		});
	}
	const objects_line_of_sight = d.stamps.filter((st) => blocksSight(st.kind)).map((st) => {
		const [w, h] = stampSize(st);
		return [at(st.x + 0.1, st.y + 0.1), at(st.x + w - 0.1, st.y + 0.1), at(st.x + w - 0.1, st.y + h - 0.1), at(st.x + 0.1, st.y + h - 0.1), at(st.x + 0.1, st.y + 0.1)];
	});
	const lights = [
		...d.lights.map((l) => ({ x: l.x, y: l.y, range: l.range, color: l.color })),
		...d.stamps.filter((st) => st.kind === 'brazier').map((st) => ({ x: st.x + 0.5, y: st.y + 0.5, range: 4, color: '#ffb35c' })),
	].map((l) => ({ position: at(l.x, l.y), range: l.range, intensity: 1, color: 'ff' + l.color.replace('#', '').toLowerCase(), shadows: true }));
	return {
		format: 0.3,
		resolution: { map_origin: { x: 0, y: 0 }, map_size: { x: b.x1 - b.x0 + 2, y: b.y1 - b.y0 + 2 }, pixels_per_grid: pixelsPerGrid },
		line_of_sight,
		objects_line_of_sight,
		portals,
		environment: { baked_lighting: false, ambient_light: 'ffffffff' },
		lights,
		image: '',
	};
}

/** Metres a square on a town: five, or ten on the big ones, so the picture stays one a phone can draw. */
export function townMetres(t: Town): number {
	return t.w * t.mpu > 1000 ? 10 : 5;
}

/** A town for a virtual tabletop: every building and the town wall are walls, with a door in each gate and one into
 *  the keep. Points are in squares from the map's top left corner. */
export function townUvttData(t: Town, pixelsPerGrid: number): UVTT {
	const k = t.mpu / townMetres(t);
	const at = (q: P): Pt => ({ x: r3(q.x * k), y: r3(q.y * k) });
	const line_of_sight: Pt[][] = t.buildings.map((b) => [...b.poly, b.poly[0] as P].map(at));
	const portals: UVTT['portals'] = [];
	const door = (a: P, e: P) => {
		const d = sub(e, a);
		portals.push({ position: at(mean([a, e])), bounds: [at(a), at(e)], rotation: r3(Math.atan2(d.y, d.x)), closed: true, freestanding: false });
	};
	for (const w of t.walls) {
		const loop = w.length > 3 && dist(w[0] as P, w[w.length - 1] as P) < 1e-6;
		// a wall is cut where a gate stands in it, and the gate is a door across the gap
		const gaps = new Map<number, P[]>();
		for (const g of t.gates) {
			let best = -1, bd = t.roadW;
			for (let i = 0; i + 1 < w.length; i++) {
				const dd = segDist(g.p, w[i] as P, w[i + 1] as P);
				if (dd < bd) [best, bd] = [i, dd];
			}
			if (best < 0) continue;
			const along = norm(sub(w[best + 1] as P, w[best] as P)), half = t.roadW / 2 + 1 / t.mpu;
			gaps.set(best, [sub(g.p, scale(along, half)), add(g.p, scale(along, half))]);
		}
		// a keep stands closed all round, so its side nearest the middle of town gets a door
		if (loop && !gaps.size) {
			let best = 0, bd = Infinity;
			for (let i = 0; i + 1 < w.length; i++) {
				const dd = dist(mean([w[i] as P, w[i + 1] as P]), t.center);
				if (dd < bd) [best, bd] = [i, dd];
			}
			const a = w[best] as P, e = w[best + 1] as P, m = mean([a, e]), along = norm(sub(e, a)), half = Math.min(2 / t.mpu, dist(a, e) / 3);
			gaps.set(best, [sub(m, scale(along, half)), add(m, scale(along, half))]);
		}
		let run: P[] = [w[0] as P];
		for (let i = 0; i + 1 < w.length; i++) {
			const gap = gaps.get(i);
			if (gap) {
				const [a, e] = gap as [P, P];
				run.push(a);
				line_of_sight.push(run.map(at));
				door(a, e);
				run = [e];
			}
			run.push(w[i + 1] as P);
		}
		if (run.length > 1) line_of_sight.push(run.map(at));
	}
	return {
		format: 0.3,
		resolution: { map_origin: { x: 0, y: 0 }, map_size: { x: Math.ceil(t.w * k), y: Math.ceil(t.h * k) }, pixels_per_grid: pixelsPerGrid },
		line_of_sight,
		objects_line_of_sight: [],
		portals,
		environment: { baked_lighting: false, ambient_light: 'ffffffff' },
		lights: [],
		image: '',
	};
}

/** A region for a virtual tabletop: an overland map, one square a kilometre, open country with no walls. */
export function regionUvttData(R: Region, pixelsPerGrid: number): UVTT {
	return {
		format: 0.3,
		resolution: { map_origin: { x: 0, y: 0 }, map_size: { x: R.km, y: Math.round((R.km * R.h) / R.w) }, pixels_per_grid: pixelsPerGrid },
		line_of_sight: [],
		objects_line_of_sight: [],
		portals: [],
		environment: { baked_lighting: false, ambient_light: 'ffffffff' },
		lights: [],
		image: '',
	};
}

/** 70 pixels a square, the usual size, unless that makes a picture bigger than a phone will draw (about 16 million pixels). */
export function gridPixels(w: number, h: number): number {
	return Math.max(20, Math.min(70, Math.floor(Math.sqrt(16e6 / (w * h)))));
}

/** Draws an SVG string onto a canvas `w` by `h` pixels and gives back the PNG, base64 without the data: prefix. */
export async function svgToPng(svg: string, w: number, h: number): Promise<string> {
	const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
	try {
		const img = new Image();
		await new Promise<void>((ok, fail) => {
			img.onload = () => ok();
			img.onerror = () => fail(new Error('The map would not draw.'));
			img.src = url;
		});
		const c = createEl('canvas');
		c.width = w;
		c.height = h;
		const ctx = c.getContext('2d');
		if (!ctx) throw new Error('No canvas to draw on.');
		ctx.drawImage(img, 0, 0, w, h);
		const data = c.toDataURL('image/png');
		return data.slice(data.indexOf(',') + 1);
	} finally {
		URL.revokeObjectURL(url);
	}
}
