// Solo play on a dungeon: the rooms you have been in are seen, and so are the corridors and open
// ground that join them; every other room stays dark until you go through a door into it.

import { FIRST_ROOM, VOID, bounds, cellAt, idx, keyEntries, sideDelta, type Deck } from './ship/model';

export interface Explored {
	/** 1 for every cell that is seen, by idx(x, y) */
	seen: Uint8Array;
	/** the doors you can go through next: the dark side's square and the room's number */
	ways: { x: number; y: number; num: number }[];
	/** the ids of the rooms that have been explored */
	rooms: Set<number>;
}

/** What can be seen once the rooms numbered `nums` have been explored. Room 1, the way in, always has been. */
export function explore(d: Deck, nums: number[]): Explored {
	const b = bounds(d);
	const seen = new Uint8Array(d.cells.length);
	if (!b) return { seen, ways: [], rooms: new Set() };
	const keyed = new Map(keyEntries(d).map((e) => [e.id, e.num]));
	// every square belongs to a place: a keyed room by its id, anything else (corridors, a keep's yard
	// and towers) by the first square of its run, so each length of corridor is one place
	const place = new Int32Array(d.cells.length).fill(-1);
	const squares = new Map<number, number[]>();
	for (let y = b.y0; y < b.y1; y++)
		for (let x = b.x0; x < b.x1; x++) {
			const at = idx(x, y), c = cellAt(d, x, y);
			if (c === VOID || place[at] !== -1) continue;
			const id = c >= FIRST_ROOM && keyed.has(c) ? c : -2 - at;
			const list: number[] = [];
			const todo = [[x, y] as const];
			place[at] = id;
			while (todo.length) {
				const [px, py] = todo.pop()!;
				list.push(idx(px, py));
				for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
					const nx = px + dx, ny = py + dy;
					if (cellAt(d, nx, ny) !== c || place[idx(nx, ny)] !== -1) continue;
					place[idx(nx, ny)] = id;
					todo.push([nx, ny]);
				}
			}
			squares.set(id, list);
		}
	// doors join places; a secret door is only wall until someone finds it, and a window lets no one through
	const links = new Map<number, { to: number; x: number; y: number }[]>();
	for (const k of d.doors) {
		if (k.kind === 'secret' || k.kind === 'window') continue;
		const [dx, dy] = sideDelta(k.side);
		const a = place[idx(k.x, k.y)] as number, z = cellAt(d, k.x + dx, k.y + dy) === VOID ? -1 : (place[idx(k.x + dx, k.y + dy)] as number);
		if (a === -1 || z === -1 || a === z) continue;
		for (const [p, q, x, y] of [[a, z, k.x + dx, k.y + dy], [z, a, k.x, k.y]] as const) links.set(p, [...(links.get(p) ?? []), { to: q, x, y }]);
	}
	const been = new Set(nums.filter((n) => n !== 1));
	const open = new Set<number>();
	for (const [id, num] of keyed) if (num === 1 || been.has(num)) open.add(id);
	// from the rooms you've been in, out along every corridor and across open ground
	const todo = [...open];
	while (todo.length) {
		for (const l of links.get(todo.pop()!) ?? []) {
			if (open.has(l.to) || l.to >= FIRST_ROOM) continue;
			open.add(l.to);
			todo.push(l.to);
		}
	}
	const ways: Explored['ways'] = [];
	for (const id of open) {
		for (const i of squares.get(id) ?? []) seen[i] = 1;
		for (const l of links.get(id) ?? []) {
			const num = keyed.get(l.to);
			if (num !== undefined && !open.has(l.to) && !ways.some((w) => w.x === l.x && w.y === l.y)) ways.push({ x: l.x, y: l.y, num });
		}
	}
	return { seen, ways, rooms: new Set([...open].filter((id) => keyed.has(id))) };
}

/** The `explore:` line's numbers, or null when it is off. */
export function parseExplored(v: string): number[] | null {
	if (/^(off|no|none|false)$/i.test(v.trim())) return null;
	return [...new Set(v.split(/[\s,]+/).map(Number).filter((n) => Number.isInteger(n) && n >= 1))].sort((a, b) => a - b);
}
