// Bulkhead data model. Everything is grid-based: a deck is a W×H grid of
// cells, each holding a region id. 0 = void (space / hull). 1 = corridor
// (all corridors share one region so they join seamlessly). ≥2 = a room.
// Walls are never stored — they are derived wherever two adjacent cells hold
// different ids. Doors sit on a wall edge between two cells.

export const VOID = 0
export const CORRIDOR = 1
export const FIRST_ROOM = 2

export const GRID_W = 512
export const GRID_H = 512

export type Side = 'N' | 'E' | 'S' | 'W'
export type DoorKind = 'door' | 'airlock' | 'hatch' | 'window'

export interface Door {
  x: number
  y: number
  side: Side // edge between (x,y) and its neighbour on this side
  kind: DoorKind
}

export interface Label {
  x: number // grid coords, may be fractional (centre of the text)
  y: number
  text: string
  size: number // in grid units (height)
}

export interface Light {
  x: number // grid coords (centre)
  y: number
  range: number // grid units
  color: string // hex
}

export type StampKind =
  | 'console' | 'chair' | 'bunk' | 'table' | 'crate' | 'cryopod' | 'locker' | 'reactor'
  | 'turret' | 'medbed' | 'ladder' | 'lift' | 'stairs' | 'vent' | 'pillar' | 'engine'
  | 'bunk2' | 'reactor2' | 'container' | 'cryobank' | 'bench' | 'airlockroom' | 'shuttle' | 'tank'

/** Footprint in cells before rotation (w across, h down). */
export const FOOTPRINT: Partial<Record<StampKind, [number, number]>> = {
  bunk2: [1, 2], reactor2: [2, 2], container: [2, 1], cryobank: [2, 2], bench: [3, 1], airlockroom: [2, 2], shuttle: [3, 2], tank: [1, 2],
}
/** Image footprints are looked up here; set by the app when a ship loads. */
export let imageLookup: (id: string) => ImageDef | undefined = () => undefined
export const setImageLookup = (f: typeof imageLookup) => { imageLookup = f }
export const footprint = (kind: Stamp['kind']): [number, number] => {
  if (kind.startsWith('img:')) { const im = imageLookup(kind.slice(4)); return im ? [im.w, im.h] : [1, 1] }
  return FOOTPRINT[kind as StampKind] ?? [1, 1]
}
/** Footprint after rotation. */
export function stampSize(st: { kind: Stamp['kind']; rot: number }): [number, number] {
  const [w, h] = footprint(st.kind)
  return st.rot % 2 ? [h, w] : [w, h]
}
/** Every cell a stamp covers. */
export function stampCells(st: { x: number; y: number; kind: Stamp['kind']; rot: number }): [number, number][] {
  const [w, h] = stampSize(st)
  const out: [number, number][] = []
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) out.push([st.x + dx, st.y + dy])
  return out
}

export interface ImageDef { id: string; name: string; data: string; w: number; h: number; blocks: boolean }

export interface Stamp {
  x: number // cell
  y: number
  kind: StampKind | `img:${string}` // built-in, or a ship image by id
  rot: 0 | 1 | 2 | 3 // quarter turns clockwise
  link?: string // ladder / lift / stairs: name of the deck it leads to
  note?: string // GM note for this fixture; printed with the key
}

export interface RoomInfo { num: number; name: string; notes: string }

/** A wall segment drawn on a cell edge inside a room (canonical N/W). */
export interface Partition { x: number; y: number; side: 'N' | 'W' }

export interface Deck {
  name: string
  cells: Uint16Array // GRID_W * GRID_H, row-major
  nextRoom: number
  doors: Door[]
  labels: Label[]
  lights: Light[]
  stamps: Stamp[]
  key: Record<number, RoomInfo> // region id → key entry
  tints: Record<number, number> // region id → palette index
  partitions: Partition[]
  /** Squares torn open to space. Empty cells drawn as damage rather than as a clean gap; purely visual. */
  breaches: [number, number][]
}

export interface Ship {
  name: string
  unit: string // e.g. "5 ft", "1.5 m"
  style: 'blueprint' | 'print' | 'dungeon'
  decks: Deck[]
  images: ImageDef[] // custom stamps, embedded as data URLs
  brief?: string // GM brief: what happened here, the hook. Never on the player map.
}

export const idx = (x: number, y: number) => y * GRID_W + x
export const inBounds = (x: number, y: number) => x >= 0 && y >= 0 && x < GRID_W && y < GRID_H

export function newDeck(name = 'Deck 1'): Deck {
  return { name, cells: new Uint16Array(GRID_W * GRID_H), nextRoom: FIRST_ROOM, doors: [], labels: [], lights: [], stamps: [], key: {}, tints: {}, partitions: [], breaches: [] }
}

export function newShip(): Ship {
  return { name: 'Untitled vessel', unit: '5 ft', style: 'blueprint', decks: [newDeck()], images: [] }
}

export function cellAt(d: Deck, x: number, y: number): number {
  return inBounds(x, y) ? (d.cells[idx(x, y)] as number) : VOID
}

const SIDE_DELTA: Record<Side, [number, number]> = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] }
export const sideDelta = (s: Side) => SIDE_DELTA[s]
export const OPPOSITE: Record<Side, Side> = { N: 'S', S: 'N', E: 'W', W: 'E' }

/** Normalise a door so that it is always stored on the N or W side of the
 *  lower-right cell — i.e. every edge has one canonical (x, y, side). */
export function canonicalEdge(x: number, y: number, side: Side): { x: number; y: number; side: 'N' | 'W' } {
  if (side === 'S') return { x, y: y + 1, side: 'N' }
  if (side === 'E') return { x: x + 1, y, side: 'W' }
  return { x, y, side }
}

export function hasPartition(d: Deck, x: number, y: number, side: Side): boolean {
  const c = canonicalEdge(x, y, side)
  return d.partitions.some((p) => p.x === c.x && p.y === c.y && p.side === c.side)
}

/** Is there a wall on this edge? True when the two cells differ, or a
 *  partition is drawn on it between two floor cells. */
export function isWallEdge(d: Deck, x: number, y: number, side: Side): boolean {
  const [dx, dy] = SIDE_DELTA[side]
  const a = cellAt(d, x, y), b = cellAt(d, x + dx, y + dy)
  if (a !== b) return true
  return a !== VOID && hasPartition(d, x, y, side)
}

/** Room ids no one can walk into: every square of the room is off the deck's main
 *  walk (the part holding the most room squares), moving through doors, airlocks and
 *  hatches but not windows. On a derelict these are rooms whose way in a hull hole
 *  took; they open onto the hole instead (a test holds the generator to that). */
export function cutOffRooms(d: Deck): Set<number> {
  const part = new Int32Array(d.cells.length).fill(-1), size: number[] = []
  for (let s0 = 0; s0 < d.cells.length; s0++) {
    if ((d.cells[s0] as number) === VOID || (part[s0] as number) >= 0) continue
    const n = size.length, q = [s0]; part[s0] = n; size.push(0)
    while (q.length) {
      const i = q.pop()!, x = i % GRID_W, y = (i / GRID_W) | 0
      if ((d.cells[i] as number) >= FIRST_ROOM) size[n] = (size[n] ?? 0) + 1
      for (const side of ['N', 'E', 'S', 'W'] as const) {
        const [dx, dy] = SIDE_DELTA[side], nx = x + dx, ny = y + dy
        if (!inBounds(nx, ny)) continue
        const j = idx(nx, ny)
        if ((d.cells[j] as number) === VOID || (part[j] as number) >= 0) continue
        const k = findDoor(d, x, y, side)
        if (((d.cells[i] as number) === (d.cells[j] as number) && !hasPartition(d, x, y, side)) || (k >= 0 && d.doors[k]?.kind !== 'window')) { part[j] = n; q.push(j) }
      }
    }
  }
  const main = size.indexOf(Math.max(0, ...size))
  const reached = new Set<number>(), all = new Set<number>()
  for (let i = 0; i < d.cells.length; i++) if ((d.cells[i] as number) >= FIRST_ROOM) { all.add((d.cells[i] as number)); if ((part[i] as number) === main) reached.add((d.cells[i] as number)) }
  return new Set([...all].filter((id) => !reached.has(id)))
}

/** Whether a door goes into Owlbear's Dynamic Fog open. Dynamic Fog has no window: it
 *  cuts an open door out of the wall, sight and movement alike (owlbear-rodeo/dynamic-fog,
 *  WallHelpers), and its walls block tokens. A window on the hull sent open let a token
 *  walk off the bridge into space, so it goes closed (the GM can open it); a window
 *  between two rooms stays open, for the sight line. Doors, airlocks, hatches go closed. */
export function opensInFog(d: Deck, k: Door): boolean {
  return k.kind === 'window' && !isHullEdge(d, k.x, k.y, k.side)
}

/** Is this edge a hull edge (one side is void)? */
export function isHullEdge(d: Deck, x: number, y: number, side: Side): boolean {
  const [dx, dy] = SIDE_DELTA[side]
  const a = cellAt(d, x, y)
  const b = cellAt(d, x + dx, y + dy)
  return a !== b && (a === VOID || b === VOID)
}

export function findDoor(d: Deck, x: number, y: number, side: Side): number {
  const c = canonicalEdge(x, y, side)
  return d.doors.findIndex((k) => k.x === c.x && k.y === c.y && k.side === c.side)
}

/** Bounding box of all non-void cells, doors, labels and lights. Null if empty. */
export function bounds(d: Deck): { x0: number; y0: number; x1: number; y1: number } | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  const c = d.cells
  for (let y = 0; y < GRID_H; y++) {
    const row = y * GRID_W
    for (let x = 0; x < GRID_W; x++) {
      if (c[row + x] !== VOID) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  for (const st of d.stamps) { const [w, h] = stampSize(st); x0 = Math.min(x0, st.x); x1 = Math.max(x1, st.x + w - 1); y0 = Math.min(y0, st.y); y1 = Math.max(y1, st.y + h - 1) }
  for (const l of d.labels) {
    x0 = Math.min(x0, Math.floor(l.x - 2)); x1 = Math.max(x1, Math.ceil(l.x + 2))
    y0 = Math.min(y0, Math.floor(l.y - 1)); y1 = Math.max(y1, Math.ceil(l.y))
  }
  if (!isFinite(x0)) return null
  return { x0, y0, x1: x1 + 1, y1: y1 + 1 } // exclusive max
}

export interface Segment { x1: number; y1: number; x2: number; y2: number; hull: boolean }

/** Every wall edge in the deck as unit segments in grid coordinates, with
 *  doors removed. Collinear runs are merged so VTTs get few, long walls. */
export const wallSegments = (d: Deck): Segment[] => derived(d).segs

/** The walls a VTT gets: wallSegments without the edges of a hull breach. The
 *  picture tears the wall out there, and a party crosses the hole in suits; a wall
 *  on it sealed the rooms a hole cut off (24 of 150 derelict decks, 1 Oct). */
export function vttWalls(d: Deck): Segment[] {
  const segs = wallSegments(d)
  if (!d.breaches.length) return segs
  const hole = new Set(d.breaches.filter(([x, y]) => cellAt(d, x, y) === VOID).map(([x, y]) => `${x},${y}`))
  const out: Segment[] = []
  for (const s of segs) {
    const horiz = s.y1 === s.y2
    let run: Segment | null = null
    for (let i = horiz ? s.x1 : s.y1; i < (horiz ? s.x2 : s.y2); i++) {
      const [ax, ay, bx, by] = horiz ? [i, s.y1 - 1, i, s.y1] : [s.x1 - 1, i, s.x1, i] // the cells either side
      if (hole.has(`${ax},${ay}`) || hole.has(`${bx},${by}`)) { if (run) out.push(run); run = null; continue }
      if (run) { if (horiz) run.x2 = i + 1; else run.y2 = i + 1 }
      else run = horiz ? { x1: i, y1: s.y1, x2: i + 1, y2: s.y1, hull: s.hull } : { x1: s.x1, y1: i, x2: s.x1, y2: i + 1, hull: s.hull }
    }
    if (run) out.push(run)
  }
  return out
}

function wallSegmentsRaw(d: Deck): Segment[] {
  const b = bounds(d)
  if (!b) return []
  const doorSet = new Set(d.doors.map((k) => `${k.x},${k.y},${k.side}`))
  const segs: Segment[] = []
  // Horizontal edges (N side of each cell) — scan rows, merge along x.
  for (let y = b.y0; y <= b.y1; y++) {
    let run: Segment | null = null
    for (let x = b.x0; x <= b.x1; x++) {
      const wall = isWallEdge(d, x, y, 'N') && !doorSet.has(`${x},${y},N`)
      const hull = wall && isHullEdge(d, x, y, 'N')
      if (wall && run && run.hull === hull && run.x2 === x) run.x2 = x + 1
      else {
        if (run) segs.push(run)
        run = wall ? { x1: x, y1: y, x2: x + 1, y2: y, hull } : null
      }
    }
    if (run) segs.push(run)
  }
  // Vertical edges (W side) — scan columns, merge along y.
  for (let x = b.x0; x <= b.x1; x++) {
    let run: Segment | null = null
    for (let y = b.y0; y <= b.y1; y++) {
      const wall = isWallEdge(d, x, y, 'W') && !doorSet.has(`${x},${y},W`)
      const hull = wall && isHullEdge(d, x, y, 'W')
      if (wall && run && run.hull === hull && run.y2 === y) run.y2 = y + 1
      else {
        if (run) segs.push(run)
        run = wall ? { x1: x, y1: y, x2: x, y2: y + 1, hull } : null
      }
    }
    if (run) segs.push(run)
  }
  return segs
}

/** Drop doors that no longer sit on a wall (e.g. after erasing a room). */
export function pruneDoors(d: Deck) {
  d.doors = d.doors.filter((k) => isWallEdge(d, k.x, k.y, k.side))
  d.stamps = d.stamps.filter((s) => stampCells(s).every(([x, y]) => cellAt(d, x, y) !== VOID))
  d.breaches = d.breaches.filter(([x, y]) => cellAt(d, x, y) === VOID) // painted over: no longer a hole
  d.partitions = d.partitions.filter((p) => { const [dx, dy] = SIDE_DELTA[p.side]; return cellAt(d, p.x, p.y) !== VOID && cellAt(d, p.x + dx, p.y + dy) !== VOID })
  const present = new Set<number>()
  for (let i = 0; i < d.cells.length; i++) if ((d.cells[i] as number) >= FIRST_ROOM) present.add((d.cells[i] as number))
  for (const id of Object.keys(d.key)) if (!present.has(Number(id))) delete d.key[Number(id)]
  for (const id of Object.keys(d.tints)) if (!present.has(Number(id))) delete d.tints[Number(id)]
}

/** Key entries in number order. */
export function keyEntries(d: Deck): (RoomInfo & { id: number })[] {
  return Object.entries(d.key).map(([id, r]) => ({ id: Number(id), ...r })).sort((a, b) => a.num - b.num)
}

/** Centres of every room region in one pass over the bounding box. */
export function roomCentres(d: Deck): Map<number, { x: number; y: number }> {
  const b = bounds(d)
  const acc = new Map<number, { sx: number; sy: number; n: number }>()
  if (b) for (let y = b.y0; y < b.y1; y++) for (let x = b.x0; x < b.x1; x++) {
    const v = (d.cells[idx(x, y)] as number)
    if (v < FIRST_ROOM) continue
    let a = acc.get(v); if (!a) { a = { sx: 0, sy: 0, n: 0 }; acc.set(v, a) }
    a.sx += x; a.sy += y; a.n++
  }
  const out = new Map<number, { x: number; y: number }>()
  for (const [id, a] of acc) out.set(id, { x: a.sx / a.n + 0.5, y: a.sy / a.n + 0.5 })
  return out
}
/** Where each room's number badge goes. The badge is drawn 0.45 cells above the
 *  anchor returned here, radius 0.3. The room's centre is the natural spot, but a
 *  generated engineering room puts its reactor exactly there, so the number sat on
 *  the reactor in every one. If the centre is covered by furniture or falls outside
 *  the room, take the nearest half-cell step where the badge lands on bare floor of
 *  its own room; if there is none within three cells, keep the centre. Recomputed
 *  per call because stamps move without bumping the deck's rev. */
export function badgeSpots(d: Deck, centres = derived(d).centres, labels = d.labels): Map<number, { x: number; y: number }> {
  const taken = new Set<number>()
  for (const st of d.stamps) for (const [x, y] of stampCells(st)) taken.add(idx(x, y))
  const clear = (id: number, x: number, y: number) => {
    const by = y - 0.45
    // A saved map's labels stay where they are, so the badge steps round them too.
    if (labels.some((l) => Math.abs(l.y - by) < 0.3 + l.size / 2 && Math.abs(l.x - x) < (l.text.length * l.size * 0.62) / 2 + 0.3)) return false
    for (const [px, py] of [[x, by], [x - 0.28, by - 0.28], [x + 0.28, by - 0.28], [x - 0.28, by + 0.28], [x + 0.28, by + 0.28]] as [number, number][]) {
      const cx = Math.floor(px), cy = Math.floor(py)
      if (cellAt(d, cx, cy) !== id || taken.has(idx(cx, cy))) return false
    }
    return true
  }
  const steps: [number, number][] = []
  for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) steps.push([dx / 2, dy / 2])
  steps.sort((a, b) => Math.hypot(...a) - Math.hypot(...b))
  const out = new Map<number, { x: number; y: number }>()
  for (const [id, c] of centres) {
    const step = steps.find(([dx, dy]) => clear(id, c.x + dx, c.y + dy))
    out.set(id, step ? { x: c.x + step[0], y: c.y + step[1] } : c)
  }
  return out
}
export function roomCentre(d: Deck, id: number): { x: number; y: number } | null {
  return derived(d).centres.get(id) ?? null
}

// ---- per-deck derived data, recomputed only after an edit ----------------
// Callers bump `rev` whenever cells/doors/partitions change (changed() in the
// editor does; painting during a drag does too).
const REV = new WeakMap<Deck, number>()
const CACHE = new WeakMap<Deck, { rev: number; segs: Segment[]; centres: Map<number, { x: number; y: number }>; bounds: ReturnType<typeof bounds> }>()
export const bump = (d: Deck) => { REV.set(d, (REV.get(d) ?? 0) + 1) }
export function derived(d: Deck) {
  const rev = REV.get(d) ?? 0
  const c = CACHE.get(d)
  if (c && c.rev === rev) return c
  const fresh = { rev, segs: wallSegmentsRaw(d), centres: roomCentres(d), bounds: bounds(d) }
  CACHE.set(d, fresh)
  return fresh
}

// ---- serialisation -------------------------------------------------------

interface DeckJSON {
  name: string
  nextRoom: number
  // run-length encoded cells: [value, count, value, count, ...]
  rle: number[]
  doors: Door[]
  labels: Label[]
  lights: Light[]
  stamps?: Stamp[]
  key?: Record<number, RoomInfo>
  tints?: Record<number, number>
  partitions?: Partition[]
  breaches?: [number, number][]
}
export interface ShipJSON {
  app: 'bulkhead'
  version: 1 | 2
  name: string
  unit: string
  style: Ship['style']
  grid: [number, number]
  decks: DeckJSON[]
  images?: ImageDef[]
  brief?: string
}

export function serialize(s: Ship): ShipJSON {
  return {
    app: 'bulkhead', version: 2, name: s.name, unit: s.unit, style: s.style, grid: [GRID_W, GRID_H], images: s.images, brief: s.brief || undefined,
    decks: s.decks.map((d) => {
      const rle: number[] = []
      let v = (d.cells[0] as number), n = 0
      for (let i = 0; i < d.cells.length; i++) {
        if ((d.cells[i] as number) === v) n++
        else { rle.push(v, n); v = (d.cells[i] as number); n = 1 }
      }
      rle.push(v, n)
      return { name: d.name, nextRoom: d.nextRoom, rle, doors: d.doors, labels: d.labels, lights: d.lights, stamps: d.stamps, key: d.key, tints: d.tints, partitions: d.partitions, breaches: d.breaches.length ? d.breaches : undefined }
    }),
  }
}

export function deserialize(j: ShipJSON): Ship {
  if (j?.app !== 'bulkhead') throw new Error('Not a Bulkhead file')
  const [gw, gh] = j.grid
  return {
    name: j.name, unit: j.unit, style: j.style, images: j.images ?? [], brief: j.brief ?? '',
    decks: j.decks.map((dj) => {
      const d = newDeck(dj.name)
      d.nextRoom = dj.nextRoom
      d.doors = dj.doors ?? []; d.labels = dj.labels ?? []; d.lights = dj.lights ?? []
      d.stamps = dj.stamps ?? []; d.key = dj.key ?? {}; d.tints = dj.tints ?? {}; d.partitions = dj.partitions ?? []
      d.breaches = dj.breaches ?? []
      // Decode into the file's grid size, then copy into ours (top-left aligned).
      const src = new Uint16Array(gw * gh)
      let i = 0
      for (let k = 0; k < dj.rle.length; k += 2) { const v = dj.rle[k] as number, n = dj.rle[k + 1] as number; src.fill(v, i, i + n); i += n }
      for (let y = 0; y < Math.min(gh, GRID_H); y++)
        for (let x = 0; x < Math.min(gw, GRID_W); x++) d.cells[idx(x, y)] = src[y * gw + x] as number
      return d
    }),
  }
}

export function cloneDeck(d: Deck): Deck {
  return {
    name: d.name, cells: new Uint16Array(d.cells), nextRoom: d.nextRoom,
    doors: d.doors.map((k) => ({ ...k })), labels: d.labels.map((l) => ({ ...l })), lights: d.lights.map((l) => ({ ...l })),
    stamps: d.stamps.map((s) => ({ ...s })), key: Object.fromEntries(Object.entries(d.key).map(([k, v]) => [k, { ...v }])),
    tints: { ...d.tints }, partitions: d.partitions.map((p) => ({ ...p })), breaches: d.breaches.map(([x, y]) => [x, y] as [number, number]),
  }
}
