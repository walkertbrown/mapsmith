// Universal VTT (.dd2vtt): the file Dungeondraft writes and Roll20 imports and Foundry reads with the Universal Battlemap Importer module.
// Checked 29 Oct against two importers' source: Foundry's DD-Import and uvtt2fgu. Points are in grid squares from
// map_origin, y down; a wall is a polyline; a portal's bounds are the door's two ends, and closed: false is a window.
import { bounds, Deck, sideDelta, stampSize, vttWalls } from './ship/model';
import { blocksSight } from './ship/stamps';

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
