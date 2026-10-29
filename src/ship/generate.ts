// One-click ship generator. Seeded, deterministic, and only ever produces
// states the editor could have produced by hand: rooms off a spine
// corridor, doors where rooms meet the corridor, fixtures on floor.

import { CORRIDOR, FIRST_ROOM, GRID_H, GRID_W, VOID, badgeSpots, cellAt, cutOffRooms, idx, isWallEdge, roomCentres, newDeck, pruneDoors, sideDelta, stampCells, type Deck, type RoomInfo, type Side, type StampKind } from './model'

export type ShipSize = 'shuttle' | 'corvette' | 'freighter' | 'station'
export type Mood = 'intact' | 'derelict'

// Small deterministic PRNG (mulberry32) so a seed reproduces a ship.
function rng(seed: number) {
  let a = seed >>> 0
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

interface Role { name: string; tint: number; w: [number, number]; h: [number, number]; notes: string[]; dead?: string[]; furnish: (p: Placer, w: number, h: number) => void }
interface Placer { st: (x: number, y: number, kind: StampKind, rot?: 0 | 1 | 2 | 3) => void; r: () => number }

const rowOf = (p: Placer, y: number, w: number, kind: StampKind, step = 1, x0 = 0) => { for (let x = x0; x < w; x += step) p.st(x, y, kind) }

const ROLES: Record<string, Role> = {
  bridge: { name: 'Bridge', tint: 1, w: [4, 6], h: [3, 5], notes: ['Consoles forward; one chair is bolted at a strange angle.', 'Nav plot still shows the last jump.', 'Viewports forward. Someone scratched a tally into the frame.'], dead: ['Consoles dark. One chair is turned to face the door.', 'Nav plot frozen on the last fix. Somebody wrote the numbers on the glass.'],
    furnish: (p, w, h) => { rowOf(p, 0, Math.min(w, 5), 'console'); p.st(1, 1, 'chair'); if (w > 3) p.st(3, 1, 'chair'); if (h > 3) p.st(Math.floor(w / 2), h - 2, 'chair') } },
  crew: { name: 'Crew quarters', tint: 2, w: [5, 8], h: [3, 5], notes: ['Bunks for the crew. Lockers, most of them locked.', 'Smells of coffee and hydraulic fluid.', 'Two bunks stripped; nobody says why.'], dead: ['Bunks stripped. One is made, tight, the way the service teaches it.', 'Lockers open. Whatever was worth taking has been taken.'],
    furnish: (p, w, h) => { for (let x = 0; x < w - 1; x++) p.st(x, 0, h >= 4 ? 'bunk2' : 'bunk'); p.st(w - 1, 0, 'locker', 1); if (h >= 5) for (let x = 0; x < w - 1; x++) p.st(x, h - 2, 'bunk2'); else if (h > 3) { p.st(Math.floor(w / 2) - 1, h - 1, 'table'); p.st(Math.floor(w / 2), h - 1, 'chair', 3) } } },
  galley: { name: 'Galley', tint: 5, w: [4, 6], h: [3, 4], notes: ['Ration printer and a working coffee machine.', 'Long table. Someone always leaves a mug out.'], dead: ['The coffee machine is still warm. The rations are gone.', 'Table set for {crew}. Frost on the plates.'],
    furnish: (p, w, h) => { p.st(0, 0, 'console'); p.st(1, 0, 'locker'); p.st(2, 0, 'locker'); const ty = Math.min(h - 1, 2); for (let x = 1; x < w - 1; x++) p.st(x, ty, 'table'); if (ty > 0) p.st(0, ty, 'chair', 1); p.st(w - 1, ty, 'chair', 3) } },
  medbay: { name: 'Medbay', tint: 4, w: [4, 6], h: [3, 5], notes: ['Autodoc and beds. Supplies: half.', 'Runs on battery. Something was treated here recently.'], dead: ['Autodoc stopped mid-cycle. The patient is not in it.', 'Battery light blinking. The last treatment is still on the screen.'],
    furnish: (p, w, h) => { p.st(0, 0, 'medbed'); if (w > 3) p.st(2, 0, 'medbed'); p.st(w - 1, 0, 'console'); if (h >= 4 && w >= 4) p.st(0, h - 2, 'cryobank'); else if (h > 2) p.st(0, h - 1, 'cryopod') } },
  cargo: { name: 'Cargo hold', tint: 6, w: [6, 12], h: [4, 6], notes: ['Sealed containers. The manifest says "agricultural".', 'Ladder down. Crates torn open from inside.', 'Netting, straps, one crate not on any list.'], dead: ['Containers cut open, not unlocked.', 'Manifest on the wall, half the lines crossed out in marker.', 'Straps cut. Whatever was lashed here left in a hurry.'],
    furnish: (p, w, h) => { for (let x = 0; x + 1 < w - 2; x += 2) { p.st(x, 0, 'container'); if (h > 4) p.st(x, 1, 'container') } for (let x = 0; x < Math.min(3, w - 2); x++) p.st(x, h - 1, 'crate'); p.st(w - 1, h - 1, 'vent') } },
  engineering: { name: 'Engineering', tint: 3, w: [5, 8], h: [4, 6], notes: ['Reactor hums. The engineer sleeps here.', 'Backup reactor, cold. Manual start: twenty minutes, two people.'], dead: ['Reactor cold. Tools laid out for a repair nobody finished.', 'Scram lever pulled and wired down so it stays pulled.', 'Panels off, parts sorted on the deck by someone who ran out of time.'],
    furnish: (p, w, h) => { p.st(Math.floor(w / 2) - 1, Math.floor(h / 2) - 1, 'reactor2'); p.st(0, 0, 'console'); p.st(1, 0, 'console'); p.st(w - 1, h - 1, 'locker'); if (h > 4) p.st(0, h - 1, 'bunk', 1) } },
  drive: { name: 'Drive section', tint: 3, w: [3, 5], h: [4, 8], notes: ['Main engines. Loud, hot, hostile.', 'Cold. The torch has not fired in weeks.'], dead: ['Cold. The torch has not fired in weeks.', 'Fuel gauges at zero. The log says they were not.'],
    furnish: (p, w, h) => { for (let y = 0; y < h; y += 4) p.st(w - 1, y, 'engine', 1); p.st(0, 0, 'pillar'); p.st(0, h - 1, 'pillar'); if (h > 5) p.st(1, Math.floor(h / 2), 'tank') } },
  armoury: { name: 'Armoury', tint: 3, w: [3, 5], h: [3, 5], notes: ['Locked. Rifles racked, one missing.', 'Empty racks. One rifle, no magazine.'], dead: ['Racks empty. The lock was cut from the inside.', 'Rack half empty. The sign-out sheet stops mid-line.'],
    furnish: (p, w, h) => { p.st(0, 0, 'locker', 1); p.st(0, h - 1, 'locker', 1); p.st(w - 1, 0, 'locker', 1); p.st(Math.floor(w / 2), Math.floor(h / 2), 'table') } },
  lab: { name: 'Lab', tint: 4, w: [4, 6], h: [3, 5], notes: ['Sample cases, a sealed cabinet, a log nobody finished.', 'Quarantine sign on the door. Inside, everything is very clean.'], dead: ['Sample cases open. The freezer is warm.', 'The notes stop mid-word. The pen is on the floor.', 'One sample tray labelled and signed. The rest are blank.'],
    furnish: (p, w, h) => { if (w >= 3) p.st(0, 0, 'bench'); p.st(w - 1, 0, 'console'); if (h > 2) { p.st(0, h - 1, 'cryopod'); p.st(1, h - 1, 'cryopod') } } },
  hangar: { name: 'Hangar', tint: 6, w: [7, 10], h: [5, 7], notes: ['One shuttle, fuelled. Bay doors are manual.', 'Empty cradle. Scorch marks.'], dead: ['Empty cradle. Scorch marks.', 'Shuttle still here, hatch open, seats empty.'],
    furnish: (p, w, h) => { p.st(Math.floor(w / 2) - 1, Math.floor(h / 2) - 1, 'shuttle'); p.st(0, 0, 'crate'); p.st(1, 0, 'crate'); p.st(w - 1, h - 1, 'locker') } },
  lifesupport: { name: 'Life support', tint: 4, w: [5, 8], h: [3, 5], notes: ['Scrubbers and water reclaim. Pump 2 knocks.', 'Air is thin here. The gauges disagree with each other.'], dead: ['Scrubbers dead. The air is whatever is left.', 'Water reclaim tank split; the deck is ice.', 'New filters stacked by the door, still in their wrap.'],
    furnish: (p, w, h) => { p.st(0, 0, 'tank'); p.st(1, 0, 'tank'); for (let x = 3; x < w - 1; x++) p.st(x, 0, 'vent'); p.st(w - 1, h - 1, 'console') } },
  pods: { name: 'Escape pods', tint: 2, w: [3, 6], h: [3, 4], notes: ['Pods along one wall. Not all of them show green.', 'Every pod green. Last drill logged nine days ago.'], dead: ['All pods gone.', 'Every pod still docked. Nobody left.'],
    furnish: (p, w) => { for (let x = 0; x < w; x++) p.st(x, 0, 'cryopod') } },
}

const PLANS: Record<ShipSize, { fore: string[]; mid: string[]; aft: string[]; spine: [number, number]; decks: number; extra?: [string[], number, number] }> = {
  shuttle: { fore: ['bridge'], mid: ['crew', 'cargo'], aft: ['drive'], spine: [8, 12], decks: 1, extra: [['galley', 'medbay', 'lifesupport', 'pods', 'lab', 'armoury'], 0, 2] },
  corvette: { fore: ['bridge'], mid: ['crew', 'engineering'], aft: ['drive'], spine: [18, 26], decks: 1, extra: [['galley', 'medbay', 'cargo', 'armoury', 'lab', 'lifesupport', 'pods', 'hangar'], 3, 5] },
  freighter: { fore: ['bridge'], mid: ['crew', 'galley', 'cargo', 'engineering'], aft: ['drive'], spine: [28, 40], decks: 2, extra: [['medbay', 'cargo', 'lab', 'pods', 'lifesupport', 'hangar', 'armoury'], 3, 6] },
  station: { fore: [], mid: [], aft: [], spine: [0, 0], decks: 2 },
}

// Until 29 Sep each size had one fixed room list in one fixed order, so every corvette was
// the same corvette with its holes moved, and the daily (which cycles the sizes) repeated
// every four days. The seed now draws the rooms past a required core and shuffles their order.
function shuffle<T>(a: T[], r: () => number): T[] {
  const b = [...a]
  for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [b[i], b[j]] = [b[j] as T, b[i] as T] }
  return b
}
function rollPlan(plan: typeof PLANS[ShipSize], r: () => number, int: (a: number, b: number) => number) {
  if (!plan.extra) return plan
  const [pool, lo, hi] = plan.extra
  return { ...plan, mid: shuffle([...plan.mid, ...shuffle(pool, r).slice(0, int(lo, hi))], r) }
}

// Fifteen names gave the daily derelict a repeat every few days (Sable, Vantage and
// Osprey twice in the first nine) and reused the names of the free packs' ships.
// pick() draws one number whatever the length, so a longer list changes names only.
// No famous fictional ships.
const NAMES = ['Kestrel', 'Halcyon', 'Corvid', 'Anvil', 'Wren', 'Meridian', 'Cassandra', 'Threshold', 'Lantern', 'Tamarind', 'Osprey', 'Vantage', 'Gallowglass', 'Nimbus', 'Sable',
  'Ardent', 'Bellwether', 'Cairn', 'Candlemas', 'Cinder', 'Coldharbour', 'Dunmore', 'Ember', 'Farthing', 'Fieldfare', 'Gannet', 'Gossamer', 'Greyling', 'Harrow', 'Heron',
  'Hollis', 'Ironbark', 'Juniper', 'Kittiwake', 'Larkspur', 'Lodestar', 'Magpie', 'Marrow', 'Merlin', 'Mistral', 'Morrow', 'Nettle', 'Oriel', 'Palisade', 'Pelican',
  'Peregrine', 'Petrel', 'Quillon', 'Rook', 'Rowan', 'Saltmarsh', 'Sandpiper', 'Sextant', 'Shrike', 'Solace', 'Sparrowhawk', 'Starling', 'Tallow', 'Teal', 'Tern',
  'Thistle', 'Tolliver', 'Umber', 'Wayfarer', 'Whimbrel', 'Willet', 'Winnow', 'Yarrow', 'Zephyr', 'Albatross', 'Brigid', 'Calloway', 'Dray', 'Esker']
const PREFIX = ['ISV', 'ICV', 'MSV', 'FTV', 'RSV']

export interface GenResult { name: string; decks: Deck[]; brief: string }

export function generate(size: ShipSize, mood: Mood, seed = Date.now() & 0xffff): GenResult {
  const r = rng(seed)
  const pick = <T>(a: T[]): T => a[Math.floor(r() * a.length)] as T
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1))
  const name = size === 'station' ? `${pick(NAMES)} Station` : `${pick(PREFIX)} ${pick(NAMES)}${r() < 0.3 ? ' ' + pick(['Drift', 'Reach', 'Dawn', 'Verge']) : ''}`
  const decks: Deck[] = []
  if (size === 'station') decks.push(genStation(r, int, mood, 'Hub deck'), genStation(r, int, mood, 'Ring deck', true))
  else {
    let plan = rollPlan(PLANS[size], r, int)
    const deckName = plan.decks > 1 ? 'Upper deck' : 'Main deck'
    let top = genShip(r, int, pick, plan, mood, deckName)
    // A long draw of extras can run out the spine before a core room is placed (crew or galley, about one
    // ship in twenty), so drop the last extra and lay the deck out again until every core room is on it.
    const has = (d: Deck, k: string) => Object.values(d.key).some((e) => e.name === (ROLES[k] as Role).name)
    for (;;) {
      const core = [...PLANS[size].mid]
      if (core.every((k) => has(top, k))) break
      const extras = plan.mid.map((k, i) => { const j = core.indexOf(k); if (j >= 0) { core.splice(j, 1); return -1 } return i }).filter((i) => i >= 0)
      if (!extras.length) break
      plan = { ...plan, mid: plan.mid.filter((_, i) => i !== extras[extras.length - 1]) }
      top = genShip(r, int, pick, plan, mood, deckName)
    }
    decks.push(top)
    if (plan.decks > 1) decks.push(genShip(r, int, pick, { ...plan, fore: [], aft: [], mid: shuffle(['cargo', 'lifesupport', 'pods', 'engineering', 'lab', 'hangar'], r).slice(0, int(4, 6)) }, mood, 'Lower deck'))
  }
  // Link the decks with a ladder pair at the same coordinates
  if (decks.length === 2) {
    const a = decks[0] as Deck, b = decks[1] as Deck
    const spot = findFloor(a, b)
    if (spot) {
      a.stamps.push({ x: spot[0], y: spot[1], kind: 'ladder', rot: 0, link: b.name })
      b.stamps.push({ x: spot[0], y: spot[1], kind: 'ladder', rot: 0, link: a.name })
    }
  }
  for (const d of decks) { pruneDoors(d); clearDoorways(d); clearLabels(d) }
  const g: GenResult = { name: mood === 'derelict' ? `Derelict — ${name}` : name, decks, brief: '' }
  g.brief = mood === 'derelict' ? storify(g, name, r, pick, size === 'station') : liven(g, name, r, pick, size === 'station')
  return g
}

// Nothing stands in a doorway. A reader on r/traveller found crates and chairs
// parked in front of doors on a published daily; furniture was placed room by
// room, before the corridor and neighbouring doors existed, so no single step
// could see the clash. This runs last, over every door, and uses no random
// numbers, so a seed still gives the same ship.
const WALK_ON = new Set<string>(['ladder', 'lift', 'stairs'])
function clearDoorways(d: Deck) {
  const blocked = new Set<string>()
  for (const dr of d.doors) {
    if (dr.kind === 'window') continue
    const [dx, dy] = sideDelta(dr.side)
    blocked.add(`${dr.x},${dr.y}`); blocked.add(`${dr.x + dx},${dr.y + dy}`)
  }
  d.stamps = d.stamps.filter((s) => WALK_ON.has(s.kind) || !stampCells(s).some(([x, y]) => blocked.has(`${x},${y}`)))
}

/** Move each label up to the nearest row of its room with no furniture, breach or wall under the text. */
function clearLabels(d: Deck) {
  const taken = new Set<string>()
  for (const s of d.stamps) for (const [x, y] of stampCells(s)) taken.add(`${x},${y}`)
  for (const [bx, by] of d.breaches) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) taken.add(`${bx + dx},${by + dy}`) // the torn edge spills over
  const badges = [...badgeSpots(d, roomCentres(d), []).values()].map((b) => ({ x: b.x, y: b.y - 0.45 })) // where the circle is drawn; labels then step round it, so the renderer, which does
  // check labels, lands on the same spot
  for (const l of d.labels) {
    const half = (l.text.length * l.size * 0.62) / 2, y0 = Math.floor(l.y)
    let room = VOID
    for (let y = y0; y > y0 - 12 && room === VOID; y--) { const c = cellAt(d, Math.floor(l.x), y); if (c !== CORRIDOR) room = c }
    if (room === VOID) continue
    let best = { x: l.x, y: y0 }, cost = Infinity
    rows: for (let y = y0; y > y0 - 12; y--) {
      const mid = cellAt(d, Math.floor(l.x), y)
      if (mid !== room && mid !== VOID) break // walked out of the room
      for (const dx of [0, -0.5, 0.5, -1, 1, -1.5, 1.5, -2, 2]) {
        const cx = l.x + dx
        let c = Math.abs(dx) * 0.1 + (badges.some((b) => Math.abs(b.y - (y + 0.5)) < 0.3 + l.size / 2 && Math.abs(b.x - cx) < half + 0.3) ? 3 : 0)
        for (let x = Math.floor(cx - half); x <= Math.ceil(cx + half) - 1; x++) c += cellAt(d, x, y) !== room ? 10 : taken.has(`${x},${y}`) ? 1 : 0
        if (c < cost) { cost = c; best = { x: cx, y } }
        if (c < 0.5) break rows
      }
    }
    l.x = best.x; l.y = best.y + 0.5
  }
}

const OX = GRID_W / 2 - 20, OY = GRID_H / 2 - 15 // the editor's visible origin

function genShip(r: () => number, int: (a: number, b: number) => number, pick: <T>(a: T[]) => T, plan: { fore: string[]; mid: string[]; aft: string[]; spine: [number, number] }, mood: Mood, deckName: string): Deck {
  const d = newDeck(deckName)
  const put = (x: number, y: number, v: number) => { d.cells[idx(OX + x, OY + y)] = v }
  let spineLen = int(plan.spine[0], plan.spine[1])
  const spineY = 10, spineX0 = 6
  for (let x = spineX0; x < spineX0 + spineLen; x++) { put(x, spineY, CORRIDOR); put(x, spineY + 1, CORRIDOR) }
  let num = 0
  const addRoom = (roleKey: string, x: number, y: number, w: number, h: number, doorSide: Side, doorAt: [number, number][]) => {
    const role = ROLES[roleKey] as Role
    const id = d.nextRoom++
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) put(xx, yy, id)
    d.tints[id] = role.tint
    d.key[id] = { num: ++num, name: role.name, notes: pick(role.notes) }
    for (const [dx, dy] of doorAt) d.doors.push({ x: OX + dx, y: OY + dy, side: doorSide, kind: 'door' })
    const placer: Placer = {
      st: (sx, sy, kind, rot = 0) => {
        const st = { x: OX + x + sx, y: OY + y + sy, kind, rot }
        const cells = stampCells(st)
        const inside = cells.every(([cx, cy]) => cx >= OX + x && cx < OX + x + w && cy >= OY + y && cy < OY + y + h)
        const clear = cells.every(([cx, cy]) => !d.stamps.some((o) => stampCells(o).some(([ox, oy]) => ox === cx && oy === cy)))
        if (inside && clear) d.stamps.push(st)
      }, r,
    }
    role.furnish(placer, w, h)
    d.labels.push({ x: OX + x + w / 2, y: OY + y + h - 0.5, text: role.name.toUpperCase().replace(' SECTION', '').replace(' QUARTERS', ''), size: Math.min(0.45, (w * 0.9) / Math.max(4, role.name.length)) })
    if (mood === 'intact' || r() < 0.4) d.lights.push({ x: OX + x + w / 2, y: OY + y + h / 2, range: Math.max(3, Math.min(w, h)), color: '#ffe08a' })
    return id
  }
  // Fore rooms: west of the spine
  let foreX = spineX0
  for (const key of plan.fore) {
    const role = ROLES[key] as Role; const w = int(role.w[0], role.w[1]), h = int(role.h[0], role.h[1])
    const y = spineY + 1 - Math.floor(h / 2)
    foreX -= w
    addRoom(key, foreX, y, w, h, 'W', [[foreX + w, spineY]])
    if (key === 'bridge') for (let yy = y; yy < y + h; yy++) if (r() < 0.8) d.doors.push({ x: OX + foreX, y: OY + yy, side: 'W', kind: 'window' })
  }
  // Cross corridors. Until 15 Oct every corvette and freighter was one straight spine with
  // rooms packed along it, so two ships of a size differed only in their rooms (four new
  // freighters side by side showed it). One or two corridors now cross the spine with a
  // room at each end, which changes the outline. Shuttles are too short for one and draw
  // no number here, so a shuttle's seed gives the same shuttle as before.
  const crosses: number[] = []
  const mids = [...plan.mid]
  if (spineLen >= 18) {
    const n = spineLen >= 28 ? pick([0, 1, 2, 2]) : pick([0, 1, 1])
    const at = (lo: number, hi: number) => spineX0 + int(Math.floor(spineLen * lo), Math.floor(spineLen * hi))
    if (n === 1) crosses.push(at(0.35, 0.6))
    if (n === 2) crosses.push(at(0.2, 0.35), at(0.6, 0.75))
  }
  // A lower deck has no fore or aft rooms, so it keeps four on its spine, not two.
  const wingKeys = crosses.length ? mids.splice(mids.length - Math.max(0, Math.min(mids.length - (plan.fore.length ? 2 : 4), crosses.length * 2))) : []
  // Mid rooms alternate above/below the spine, packed along it
  const botFirst = r() < 0.5
  let topX = spineX0 + (botFirst ? 1 : 0), botX = spineX0
  const placed: { x: number; w: number; h: number; above: boolean }[] = []
  for (const key of mids) {
    const role = ROLES[key] as Role; const w = Math.min(int(role.w[0], role.w[1]), spineX0 + spineLen - Math.min(topX, botX)); const h = int(role.h[0], role.h[1])
    if (w < 3) break
    const above = topX <= botX
    let x = above ? topX : botX
    for (const cx of crosses) if (x < cx + 2 && x + w > cx) x = cx + 2 // rooms stop at a cross corridor and go on past it
    if (x + w > spineX0 + spineLen) { if (above) topX = 999; else botX = 999; if (topX === 999 && botX === 999) break; continue }
    const y = above ? spineY - h : spineY + 2
    const doorX = x + Math.floor(w / 2)
    addRoom(key, x, y, w, h, 'N', above ? [[doorX, spineY]] : [[doorX, spineY + 2]])
    if (w > 6 && r() < 0.6) d.doors.push({ x: OX + doorX + 1, y: OY + (above ? spineY : spineY + 2), side: 'N', kind: 'door' })
    placed.push({ x, w, h, above })
    if (above) topX = x + w; else botX = x + w
  }
  // Each cross corridor runs just past the mid rooms beside it and ends in a room.
  // A room that would land on another is left off, and its corridor with it.
  let wi = 0
  const built: number[] = [] // crosses that got a room; one that got none was never drawn
  for (const cx of crosses) for (const above of [true, false]) {
    const key = wingKeys[wi]
    if (!key) break
    const role = ROLES[key] as Role; const w = int(role.w[0], role.w[1]), h = int(role.h[0], role.h[1])
    const x = cx + 1 - Math.floor(w / 2)
    const reach = Math.max(2, ...placed.filter((q) => q.above === above && q.x < x + w && q.x + q.w > x).map((q) => q.h)) + int(0, 1)
    const y = above ? spineY - reach - h : spineY + 2 + reach
    const cor: [number, number][] = []
    for (let k = 0; k < reach; k++) cor.push([cx, above ? spineY - 1 - k : spineY + 2 + k], [cx + 1, above ? spineY - 1 - k : spineY + 2 + k])
    const room: [number, number][] = []
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) room.push([xx, yy])
    if (![...cor, ...room].every(([a, b]) => (d.cells[idx(OX + a, OY + b)] as number) === VOID)) continue
    wi++; built.push(cx)
    for (const [a, b] of cor) put(a, b, CORRIDOR)
    addRoom(key, x, y, w, h, 'N', [[cx + (r() < 0.5 ? 0 : 1), above ? spineY - reach : spineY + 2 + reach]])
  }
  // The spine can run on past the last room (wings took some, or a lower deck had few to
  // place); cut it back. Until 15 Oct most lower decks ended in a long bare corridor.
  if (spineLen >= 18 && placed.length) {
    const end = Math.max(...placed.map((q) => q.x + q.w), ...built.map((c) => c + 2)) + 1
    if (end < spineX0 + spineLen) { for (let x = end; x < spineX0 + spineLen; x++) { put(x, spineY, VOID); put(x, spineY + 1, VOID) } spineLen = end - spineX0 }
  }
  // Aft rooms: east of the spine
  let aftX = spineX0 + spineLen
  for (const key of plan.aft) {
    const role = ROLES[key] as Role; const w = int(role.w[0], role.w[1]), h = int(role.h[0], role.h[1])
    const y = spineY + 1 - Math.floor(h / 2)
    addRoom(key, aftX, y, w, h, 'W', [[aftX, spineY], [aftX, spineY + 1]])
    aftX += w
  }
  // Airlock on a hull edge of the spine or a mid room
  const ax = spineX0 + int(2, Math.max(2, spineLen - 3))
  for (const [x, y, side] of [[ax, spineY + 2, 'N'], [ax, spineY, 'N']] as [number, number, Side][]) {
    const a = (d.cells[idx(OX + x, OY + y)] as number), b = (d.cells[idx(OX + x, OY + y - 1)] as number)
    if ((a === VOID) !== (b === VOID)) { d.doors.push({ x: OX + x, y: OY + y, side, kind: 'airlock' }); break }
  }
  // When rooms close in both sides of the spine there, the try above misses, and 51 in 60
  // shuttles had no way aboard but a hole while the one-shot said "Through the airlock".
  // Take the hull edge nearest mid-spine instead: corridor first, never the bridge's windows. No r(),
  // so a ship that already had its airlock comes out the same.
  if (!d.doors.some((k) => k.kind === 'airlock')) {
    const bridge = new Set(Object.entries(d.key).filter(([, k]) => k.name === 'Bridge').map(([id]) => Number(id)))
    const taken = new Set(d.doors.map((k) => `${k.x},${k.y},${k.side}`))
    const furnished = new Set(d.stamps.flatMap((s) => stampCells(s).map(([x, y]) => `${x},${y}`))) // clearDoorways would drop it
    let best: { x: number; y: number; side: Side; score: number } | undefined
    for (let y = -10; y < 40; y++) for (let x = -30; x < 80; x++) for (const [side, nx, ny] of [['N', x, y - 1], ['W', x - 1, y]] as [Side, number, number][]) {
      const a = (d.cells[idx(OX + x, OY + y)] as number), b = (d.cells[idx(OX + nx, OY + ny)] as number)
      if ((a === VOID) === (b === VOID) || taken.has(`${OX + x},${OY + y},${side}`)) continue
      const inside = a === VOID ? b : a
      if (bridge.has(inside)) continue
      const at = a === VOID ? [OX + nx, OY + ny] : [OX + x, OY + y]
      const score = (inside === CORRIDOR ? 0 : 1000) + (furnished.has(`${at[0]},${at[1]}`) ? 5000 : 0) + Math.abs(x - (spineX0 + spineLen / 2)) + Math.abs(y - (spineY + 1))
      if (!best || score < best.score) best = { x: OX + x, y: OY + y, side, score }
    }
    if (best) d.doors.push({ x: best.x, y: best.y, side: best.side, kind: 'airlock' })
  }
  if (mood === 'derelict') breach(d, r, int)
  return d
}

function genStation(r: () => number, int: (a: number, b: number) => number, mood: Mood, deckName: string, ring = false): Deck {
  const d = newDeck(deckName)
  const put = (x: number, y: number, v: number) => { d.cells[idx(OX + x, OY + y)] = v }
  let num = 0
  const room = (key: string, x: number, y: number, w: number, h: number) => {
    const role = ROLES[key] as Role; const id = d.nextRoom++
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) put(xx, yy, id)
    d.tints[id] = role.tint; d.key[id] = { num: ++num, name: role.name, notes: role.notes[Math.floor(r() * role.notes.length)] as string }
    const placer: Placer = { st: (sx, sy, kind, rot = 0) => { const st = { x: OX + x + sx, y: OY + y + sy, kind, rot }; if (stampCells(st).every(([cx, cy]) => cx >= OX + x && cx < OX + x + w && cy >= OY + y && cy < OY + y + h && !d.stamps.some((o) => stampCells(o).some(([ox, oy]) => ox === cx && oy === cy)))) d.stamps.push(st) }, r }
    role.furnish(placer, w, h)
    d.labels.push({ x: OX + x + w / 2, y: OY + y + h - 0.5, text: role.name.toUpperCase(), size: 0.4 })
    if (mood === 'intact' || r() < 0.4) d.lights.push({ x: OX + x + w / 2, y: OY + y + h / 2, range: Math.max(3, Math.min(w, h)), color: '#ffe08a' })
    return id
  }
  // Until 15 Oct every station was the same plus: a square hub and four arms, each ending in
  // a room of one fixed size, so two stations differed only in arm length (Ember and Cairn).
  // Now the hub is a rectangle, each arm leaves it at its own place, end rooms vary in size,
  // and a long arm can have a room along it. The lift stays on the middle of both decks.
  const hubW = int(8, 12), hubH = int(7, 10), cx = 15, cy = 15
  const hx = cx - Math.floor(hubW / 2), hy = cy - Math.floor(hubH / 2)
  const hubId = d.nextRoom++
  for (let y = hy; y < hy + hubH; y++) for (let x = hx; x < hx + hubW; x++) put(x, y, hubId)
  d.tints[hubId] = 1; d.key[hubId] = { num: ++num, name: ring ? 'Lift lobby' : 'Central hub', notes: ring ? 'Lift and stairs up to the hub.' : 'Traffic control, customs, the only working coffee machine.' }
  d.stamps.push({ x: OX + cx - 1, y: OY + cy, kind: 'lift', rot: 0, link: ring ? 'Hub deck' : 'Ring deck' }, { x: OX + cx, y: OY + cy, kind: 'stairs', rot: 0, link: ring ? 'Hub deck' : 'Ring deck' })
  for (const [px, py] of [[hx + 1, hy + 1], [hx + hubW - 2, hy + 1], [hx + 1, hy + hubH - 2], [hx + hubW - 2, hy + hubH - 2]] as [number, number][]) d.stamps.push({ x: OX + px, y: OY + py, kind: 'pillar', rot: 0 })
  d.labels.push({ x: OX + cx, y: OY + hy + hubH - 1.5, text: ring ? 'LOBBY' : 'CENTRAL HUB', size: 0.45 })
  d.lights.push({ x: OX + cx, y: OY + cy, range: Math.max(hubW, hubH), color: '#ffe08a' })
  // four spokes with a room at each end
  // Each spoke has its own length, and the seed decides which room ends which spoke (fixed until 29 Sep).
  const pool = ring ? shuffle(['crew', 'galley', 'lifesupport', 'medbay', 'lab', 'pods'], r) : shuffle(['cargo', 'medbay', 'lab', 'armoury', 'hangar', 'cargo'], r)
  const roles = ring ? shuffle(['crew', ...pool.slice(0, 3)], r) : shuffle(['bridge', 'engineering', ...pool.slice(0, 2)], r)
  const spare = pool.slice(ring ? 3 : 2).filter((k) => k !== 'hangar')
  const off = (half: number) => int(-Math.max(0, half - 3), Math.max(0, half - 3)) // where the arm leaves the hub's side
  // Lay out each arm before drawing any of it. An arm can be cut to nothing (its room sits on
  // the hub wall), which turns the plus into a T, an L or a line.
  type Arm = { dir: 'E' | 'W' | 'S' | 'N'; across: boolean; c: number; len: number; w: number; h: number; x: number; y: number }
  const place = (a: Arm) => {
    a.x = a.dir === 'E' ? hx + hubW + a.len : a.dir === 'W' ? hx - a.len - a.w : a.c - 1 - Math.floor((a.w - 2) / 2)
    a.y = a.dir === 'S' ? hy + hubH + a.len : a.dir === 'N' ? hy - a.len - a.h : a.c - 1 - Math.floor((a.h - 2) / 2)
  }
  const cut = new Set(shuffle(['E', 'W', 'S', 'N'], r).slice(0, [0, 0, 1, 1, 2][int(0, 4)]))
  const arms: Arm[] = (['E', 'W', 'S', 'N'] as const).map((dir) => {
    const across = dir === 'E' || dir === 'W', len = int(3, 9)
    const c = across ? cy + off(Math.floor(hubH / 2)) : cx + off(Math.floor(hubW / 2))
    const a: Arm = { dir, across, c, len: cut.has(dir) ? 0 : len, w: across ? int(6, 9) : int(7, 10), h: across ? int(5, 8) : int(4, 6), x: 0, y: 0 }
    place(a); return a
  })
  // rectangles that must not touch: every spoke and every end room
  type Rect = [number, number, number, number]
  const hit = (p: Rect, q: Rect) => p[0] < q[0] + q[2] && q[0] < p[0] + p[2] && p[1] < q[1] + q[3] && q[1] < p[1] + p[3]
  const grow = (a: Arm): Rect => [a.x - 1, a.y - 1, a.w + 2, a.h + 2]
  const spoke = (a: Arm): Rect => a.dir === 'E' ? [hx + hubW, a.c - 1, a.len, 2] : a.dir === 'W' ? [hx - a.len, a.c - 1, a.len, 2] : a.dir === 'S' ? [a.c - 1, hy + hubH, 2, a.len] : [a.c - 1, hy - a.len, 2, a.len]
  const clash = (i: number) => arms.some((b, j) => j !== i && (hit(grow(arms[i] as Arm), [b.x, b.y, b.w, b.h]) || (b.len > 0 && hit(grow(arms[i] as Arm), spoke(b)))))
  // a room that would touch another gets the old fixed size and, if that is not enough, a longer spoke
  for (let i = 0; i < 4; i++) {
    const a = arms[i] as Arm
    if (!clash(i)) continue
    a.w = a.across ? 7 : 8; a.h = a.across ? 6 : 5; place(a)
    while (clash(i) && a.len < 14) { a.len = Math.max(3, a.len + 1); place(a) }
  }
  for (const [i, a] of arms.entries()) {
    const at = a.dir === 'E' ? hx + hubW : a.dir === 'W' ? hx - 1 : a.dir === 'S' ? hy + hubH : hy - 1
    const step = a.dir === 'E' || a.dir === 'S' ? 1 : -1
    for (let k = 0; k < a.len; k++) {
      const p = at + step * k
      if (a.across) { put(p, a.c - 1, CORRIDOR); put(p, a.c, CORRIDOR) } else { put(a.c - 1, p, CORRIDOR); put(a.c, p, CORRIDOR) }
    }
    room(roles[i] as string, a.x, a.y, a.w, a.h)
    // a door where the spoke leaves the hub and where it meets its room (one door when there is no spoke)
    const ends = a.dir === 'E' ? [hx + hubW, hx + hubW + a.len] : a.dir === 'W' ? [hx, hx - a.len] : a.dir === 'S' ? [hy + hubH, hy + hubH + a.len] : [hy, hy - a.len]
    for (const p of a.len ? ends : ends.slice(0, 1)) {
      if (a.across) d.doors.push({ x: OX + p, y: OY + a.c - 1, side: 'W', kind: 'door' }, { x: OX + p, y: OY + a.c, side: 'W', kind: 'door' })
      else d.doors.push({ x: OX + a.c - 1, y: OY + p, side: 'N', kind: 'door' }, { x: OX + a.c, y: OY + p, side: 'N', kind: 'door' })
    }
  }
  const free = (x: number, y: number, w: number, h: number) => { for (let yy = y - 1; yy <= y + h; yy++) for (let xx = x - 1; xx <= x + w; xx++) if ((d.cells[idx(OX + xx, OY + yy)] as number) !== VOID) return false; return true }
  // A room along a long spoke, on whichever side has space.
  for (const a of arms) {
    if (a.len < 6 || !spare.length || r() < 0.4) continue
    const depth = int(3, 5), along = a.len - 2
    const s0 = a.dir === 'E' ? hx + hubW + 1 : a.dir === 'W' ? hx - a.len + 1 : a.dir === 'S' ? hy + hubH + 1 : hy - a.len + 1
    for (const side of r() < 0.5 ? [0, 1] : [1, 0]) {
      const [x, y, w, h] = a.across ? [s0, side ? a.c + 1 : a.c - 1 - depth, along, depth] : [side ? a.c + 1 : a.c - 1 - depth, s0, depth, along]
      // free() looks a cell past the room, which on the spoke side is the spoke itself
      const [fx, fy, fw, fh] = a.across ? [x, side ? y + 1 : y, w, h - 1] : [side ? x + 1 : x, y, w - 1, h]
      if (!free(fx, fy, fw, fh)) continue
      room(spare.shift()!, x, y, w, h)
      const mid = Math.floor(along / 2)
      if (a.across) d.doors.push({ x: OX + x + mid, y: OY + (side ? a.c + 1 : a.c - 1), side: 'N', kind: 'door' })
      else d.doors.push({ x: OX + (side ? a.c + 1 : a.c - 1), y: OY + y + mid, side: 'W', kind: 'door' })
      break
    }
  }
  if (!ring) {
    // two docking airlocks, on the outer walls of the two rooms furthest out
    const far = [...arms].sort((p, q) => q.len - p.len).slice(0, 2)
    for (const a of far) d.doors.push(a.dir === 'E' ? { x: OX + a.x + a.w, y: OY + a.c - 1, side: 'W', kind: 'airlock' } : a.dir === 'W' ? { x: OX + a.x, y: OY + a.c, side: 'W', kind: 'airlock' } : a.dir === 'S' ? { x: OX + a.c - 1, y: OY + a.y + a.h, side: 'N', kind: 'airlock' } : { x: OX + a.c, y: OY + a.y, side: 'N', kind: 'airlock' })
  }
  if (mood === 'derelict') breach(d, r, int)
  return d
}

/** Punch a few holes in the hull and dim things. */
export const WAY_IN = 'Way in: only across the breach. The way that led here went with the hull, so getting in means crossing open space.'

function breach(d: Deck, r: () => number, int: (a: number, b: number) => number) {
  const holes: [number, number][][] = []
  HULL.set(d, { cells: d.cells.slice(), doors: [...d.doors], partitions: [...d.partitions], holes, keyed: new Set(Object.keys(d.key).map(Number)) })
  const floor: [number, number][] = []
  for (let y = 0; y < GRID_H; y++) for (let x = 0; x < GRID_W; x++) if ((d.cells[idx(x, y)] as number) !== VOID && (d.cells[idx(x, y)] as number) !== CORRIDOR) floor.push([x, y])
  const n = int(2, 4)
  for (let i = 0; i < n && floor.length; i++) {
    const [bx, by] = floor[Math.floor(r() * floor.length)] as [number, number]
    const w = int(1, 3), h = int(1, 3)
    const hole: [number, number][] = []
    for (let y = by; y < by + h; y++) for (let x = bx; x < bx + w; x++) if (x < GRID_W && y < GRID_H) { d.cells[idx(x, y)] = VOID; d.breaches.push([x, y]); hole.push([x, y]) }
    holes.push(hole)
  }
  d.lights = d.lights.filter(() => r() < 0.5)
  for (const k of Object.values(d.key)) {
    const role = Object.values(ROLES).find((x) => x.name === k.name) // a dead ship's rooms read dead: no humming reactors, no one asleep
    if (role?.dead) k.notes = role.dead[int(0, role.dead.length - 1)] as string
    else if (k.name === 'Central hub') k.notes = 'Traffic control dark. The customs desk still has a queue rope up.'
    if (r() < 0.5) k.notes = ['Dark. Emergency lighting only.', 'Vacuum. Suit up.', 'Something moved in here — recently.', 'Cold. Frost on every surface.'][int(0, 3)] + ' ' + k.notes
  }
}

// The holes are punched before the story is chosen, so a ship whose crew "sealed
// the seals from outside" came out as open to space as one that flew through
// debris. The story cannot be chosen first without changing every seed's ship, and
// the card links carry the seed, so breach() keeps the hull as it was and each
// hole it cut, and the story puts back the holes it does not account for (holesKept). No random numbers are drawn:
// rooms, notes and brief stay exactly as the seed made them. Furniture lost to a
// hole stays lost, since the crew count in the brief was taken from the bunks.
const HULL = new WeakMap<Deck, { cells: Uint16Array; doors: Deck['doors']; partitions: Deck['partitions']; holes: [number, number][][]; keyed: Set<number> }>()
// Which holes a story keeps. Quarantine, power loss and the specimen keep none. A
// reactor death keeps the ones aft of the deck's middle, where its brief puts the
// damage (a station has no aft and keeps them all). A mutiny keeps its first: a
// firefight, not a hull torn open. The rest are as the seed made them.
type Keep = (hole: [number, number][], i: number, midX: () => number) => boolean
function holesKept(cause: number, station: boolean): Keep | null {
  if ([2, 6, 7].includes(cause)) return () => false // quarantine, power, specimen
  if (cause === 3) return (_, i) => i === 0 // mutiny
  if (cause === 1 && !station) return (hole, _, midX) => hole.reduce((a, [x]) => a + x, 0) / hole.length >= midX() // reactor
  return null
}
function mend(d: Deck, keep: Keep) {
  const was = HULL.get(d)
  if (!was) return
  let mid = -1
  const midX = () => { // the middle of the deck's hull, fore to aft, before any hole
    if (mid < 0) { let x0 = GRID_W, x1 = 0; for (let i = 0; i < was.cells.length; i++) if ((was.cells[i] as number) !== VOID) { const x = i % GRID_W; if (x < x0) x0 = x; if (x > x1) x1 = x } mid = (x0 + x1) / 2 }
    return mid
  }
  const kept = was.holes.filter((h, i) => h.length && keep(h, i, midX))
  if (kept.length === was.holes.filter((h) => h.length).length) return // nothing to mend
  const cells = was.cells.slice()
  for (const h of kept) for (const [x, y] of h) cells[idx(x, y)] = VOID
  // A mended hole must not bring back a room whose key entry went with it.
  const lost = (id: number) => id >= FIRST_ROOM && was.keyed.has(id) && !(id in d.key)
  if (was.holes.some((h) => h.some(([x, y]) => (cells[idx(x, y)] as number) !== VOID && lost((cells[idx(x, y)] as number))))) return
  d.cells.set(cells)
  const open = new Set(kept.flat().map(([x, y]) => idx(x, y)))
  d.breaches = d.breaches.filter(([x, y]) => open.delete(idx(x, y))) // once each: two holes can share a cell
  d.doors = was.doors.filter((k) => isWallEdge(d, k.x, k.y, k.side))
  d.partitions = was.partitions.filter((p) => { const [dx, dy] = sideDelta(p.side); return cellAt(d, p.x, p.y) !== VOID && cellAt(d, p.x + dx, p.y + dy) !== VOID })
  clearDoorways(d)
}

function findFloor(a: Deck, b: Deck): [number, number] | null {
  const occupied = (d: Deck, x: number, y: number) => d.stamps.some((s) => stampCells(s).some(([sx, sy]) => sx === x && sy === y))
  for (let y = 0; y < GRID_H; y++) for (let x = 0; x < GRID_W; x++) {
    const i = idx(x, y)
    if ((a.cells[i] as number) > CORRIDOR && (b.cells[i] as number) > CORRIDOR && !occupied(a, x, y) && !occupied(b, x, y)) return [x, y]
  }
  return null
}



/** The ship's bare hull name: a derelict carries a "Derelict — " prefix its brief does not,
 *  and the registry letters in front of the hull change while the hull stays the same. */
export const hullOf = (x: GenResult) => x.name.replace(/^Derelict — /, '').replace(/^[A-Z]{2,4} /, '').split(' ')[0] ?? '' // "Wren" and "Wren Reach" read as one ship in a fleet list

/** The story a brief opens with, keyed so two ships with the same cause match. */
// A cause has more than one opening, so the brief's first words alone would count
// a quarantine and a quarantine told another way as two stories. Every opening, in
// ship and station wording, maps back to the cause that wrote it. The daily script
// runs under plain node and reads the same table from scripts/lib/causes.json.
const opening = (brief: string, name: string) => (brief.split('\n')[0] ?? '').replace(name, '').slice(0, 24)
export function causeOpenings(): Record<string, number> {
  const out: Record<string, number> = {}
  CAUSES.forEach((c, i) => [c.brief, ...(c.alt || [])].forEach((b) => {
    out[opening(b('X'), 'X')] = i
    out[opening(STATION_WORDS.reduce((a, [re, to]) => a.replace(re, to), b('X')), 'X')] = i
  }))
  return out
}
let OPENINGS: Record<string, number> | undefined
export const causeOf = (x: GenResult) => {
  const first = opening(x.brief || '', x.name.replace(/^Derelict — /, ''))
  const i = (OPENINGS ??= causeOpenings())[first]
  return i === undefined ? first : `cause ${i}`
}

/** A fleet's worth of ships with the stories spread as far as the material allows.
 *  There are eight causes, so ten ships must repeat some of them; five must not.
 *  Each slot rolls candidates and keeps the least-used story and hull. Seeds are
 *  explicit: generate() defaults to the clock, and a tight loop rolls the same
 *  millisecond over and over, which would hand back the same ship every time. */
export function generateSpread(n: number, size: ShipSize, mood: Mood, rand: () => number = Math.random): GenResult[] {
  const usedCause = new Map<string, number>(), usedHull = new Set<string>(), usedOpening = new Set<string>(), out: GenResult[] = []
  // When a cause has to come round again, it comes round told the other way.
  const told = (x: GenResult) => opening(x.brief || '', x.name.replace(/^Derelict — /, ''))
  const cost = (x: GenResult) => 2 * (usedCause.get(causeOf(x)) ?? 0) + (usedOpening.has(told(x)) ? 1 : 0) + (usedHull.has(hullOf(x)) ? 2 : 0)
  const roll = () => generate(size, mood, (rand() * 0x10000) | 0)
  for (let i = 0; i < n; i++) {
    let g = roll()
    for (let t = 0; t < 30 && cost(g) > 0; t++) { const c = roll(); if (cost(c) < cost(g)) g = c }
    usedCause.set(causeOf(g), (usedCause.get(causeOf(g)) ?? 0) + 1); usedHull.add(hullOf(g)); usedOpening.add(told(g))
    out.push(g)
  }
  return out
}

// ---- derelict story ---------------------------------------------------------
// A derelict gets a cause of death, hazards, log fragments and salvage, written
// into the room notes (GM only) and a ship brief. System-neutral on purpose.

interface Placed { at?: string[]; first?: true; lock?: true; text: string } // lock: only a room an airlock opens into; first: only the first room in at that the ship has
// unsay: words a dead room's note must not say in this story. A reactor that is "still warm aft" had an
// engineering that read "Reactor cold." (RSV Esker Reach, 2 Oct); the cold story's autodoc keeps its patient.
// kept: a note the brief promises, in the first room of at the ship has: Candlemas Station's brief (2 Oct)
// welded the medbay shut, and nothing in the medbay said so; ICV Morrow's sealed engineering, the same.
interface Cause { brief: (name: string) => string; alt?: ((name: string) => string)[]; hazards: Placed[]; logs: Placed[]; loot: Placed[]; hooks: string[]; unsay?: { at: string[]; was: string; now: string }[]; kept?: { when: RegExp; at: string[]; text: string; unless?: RegExp }[] }

const CREW = ['Okafor', 'Reyes', 'Lindqvist', 'Tamura', 'Adeyemi', 'Kowalczyk', 'Moreau', 'Petrov', 'Nakamura', 'Haddad']
const RANK = ['Cpt.', 'XO', 'Eng.', 'Dr.', 'Cpl.', 'Tech', 'Nav', 'Deckhand']

const CAUSES: Cause[] = [
  { brief: (n) => `${n} took a micrometeoroid swarm broadside about six weeks ago. Half the hull is open to space, the rest is holding by habit. Crew of {crew}. One pod launched; the bodies aboard do not account for the rest.`,
    alt: [(n) => `${n} went through a debris field that was not on the chart and came out the other side with holes in it. The air went in stages, one compartment at a time, and the crew moved forward ahead of it until there was no more forward. Six weeks, give or take.`],
    hazards: [{ at: ['Cargo hold', 'Hangar'], text: 'Hazard: loose cargo drifting in vacuum. Anything not tied down moves when the ship does.' }, { at: ['Life support'], text: 'Hazard: cracked O2 line. Sparks here mean fire, then no fire, then nothing at all.' }, { text: 'Hazard: hull plate hanging by two rivets. Touch it and it goes, with whoever is holding it.' }, { at: ['Bridge'], text: 'Hazard: shattered viewport, edges razor-fine. Suit tears on contact.' }, { text: 'Hazard: floor buckled; the lower half of this room is a drop into the void.' }],
    logs: [{ at: ['Bridge'], text: 'Log fragment (Nav): "Debris field not on any chart. Cpt. says ride it out. We are riding it out."' }, { at: ['Engineering', 'Drive section'], text: 'Log fragment (Eng.): "Patched the aft seam twice. It will not hold a third time. Told her. She knows."' }, { at: ['Crew quarters', 'Galley'], text: 'Log fragment, handwritten: "If you find this, the pod took Reyes and the kid. Do not look for us in the hull."' }, { at: ['Escape pods'], text: 'Log fragment (pod bay panel): one launch, 41 days ago, heading logged and then wiped by someone with the Cpt. code.' }, { at: ['Galley'], text: 'Log fragment (Cook): "Six weeks of air on the board. Cpt. says four. I am not asking who is right."' }, { at: ['Life support'], text: 'Log fragment (Tech): "Sealed sections 3 through 7. If anyone is in there, they are not answering the comm."' }],
    loot: [{ at: ['Cargo hold'], text: 'Salvage: forty crates of machine parts, twelve of them worth carrying. One is marked with a shipping line that no longer exists.' }, { at: ['Medbay'], text: 'Salvage: autodoc still charged. Two courses of trauma meds, one vial with the label scraped off.' }, { at: ['Armoury'], text: 'Salvage: one rifle, no magazine, and a flare pistol with three flares.' }],
    hooks: ['The pod\'s heading was wiped, but the drive core still remembers the last vector.', 'A distress beacon is still running. It is not the ship\'s.', 'The salvage claim on this hull was filed two days ago by someone who has not been here.', 'The insurer paid out on this hull a month ago. It is not supposed to exist.', 'One of the bodies is wearing a suit from a different ship.', 'The debris that did this is on a known orbit, and it comes back through in nine days.'] },
  { brief: (n) => `${n} is dead of its own reactor. The scram held, the coolant did not. The crew sealed {Engineering?engineering|the drive section}, then sealed themselves in, then stopped answering. Everything aft of the mid-frame is warm in the wrong way.`,
    alt: [(n) => `${n} is still warm aft. The reactor tripped, the coolant loop failed a day later, and the engineer sealed the drive section with herself inside it. The rest of the crew waited at the mid-frame door for word. The word never came, and neither did the rescue.`],
    hazards: [{ at: ['Engineering'], text: 'Hazard: coolant fog. Corrosive, heavier than air, pooled knee-deep. Suits last minutes, skin does not.' }, { at: ['Drive section'], text: 'Hazard: radiation. Dosimeters climb fast here: every minute in this room is a dose.' }, { text: 'Hazard: deck plating hot enough to blister through boots. Something below is still cooking.' }, { at: ['Life support'], text: 'Hazard: scrubbers running backwards. The air here is thick, sweet and wrong: anyone breathing it unfiltered is dizzy and slow at everything until they get clear.' }, { at: ['Galley', 'Crew quarters'], text: 'Hazard: the bulkhead door is welded shut from the far side. Cutting through takes time, light and noise: roll for an encounter when they start.' }],
    logs: [{ at: ['Engineering'], text: 'Log fragment (Eng.): "Scram at 0340. Coolant loop 2 gone. If we can hold the core under 900 for a day we live. Doing the math again."' }, { at: ['Bridge'], text: 'Log fragment (Cpt.): "Ordered the aft sections sealed. Lindqvist stayed behind the door. That was her call. I am writing it down so nobody says otherwise."' }, { at: ['Medbay'], text: 'Log fragment (Dr.): "Dosages are past what the manual covers. Giving what I have to whoever asks. Nobody is asking anymore."' }, { at: ['Crew quarters'], text: 'Log fragment, on a bunk wall in marker: "DAY 6. WARM AGAIN. DON\'T OPEN AFT."' }, { at: ['Galley'], text: 'Log fragment (Cook): "Fed everyone at the mid-frame door. Eng. did not come forward for hers. Left it by the seal."' }, { at: ['Life support'], text: 'Log fragment (Tech): "Scrubbers pulling something the filters are not rated for. Changed them twice. Not changing them again."' }],
    loot: [{ at: ['Cargo hold'], text: 'Salvage: sealed reactor fuel canisters, intact, worth more than the hull. Warm to the touch.' }, { at: ['Lab'], text: 'Salvage: a case of unlabelled sample vials, refrigeration failed weeks ago.' }, { at: ['Engineering'], text: 'Salvage: the spare coolant loop, still crated. Never fitted. Somebody will want to know why.' }],
    hooks: ['The core is stable now. Someone stabilised it, recently, and left.', 'The manifest lists a passenger. Nobody on the crew roster mentions one.', 'A salvage tug is inbound; its transponder says it has been inbound for three months.', 'The engineer\'s last message went to a private address, not the company. Someone off-ship knew first.', 'The reactor logs show a second scram, three days after the crew stopped writing.', 'A second coolant loop was ordered, paid for and never delivered; the invoice names the port you just left.'],
    unsay: [{ at: ['Engineering', 'Drive section'], was: 'Cold. Frost on every surface. ', now: '' }, { at: ['Engineering'], was: 'Reactor cold. ', now: '' },
      { at: ['Drive section'], was: 'Cold. The torch has not fired in weeks.', now: 'The torch has not fired in weeks, and the deck is still warm underfoot.' }],
    kept: [{ when: /\bsealed \{Engineering\b/, at: ['Engineering', 'Drive section'], text: 'Hazard: the door is sealed, and the seal is still good. Breaking it takes time and noise, and lets out the heat behind it: roll for an encounter when they start.' }, { when: /\bsealed the drive section\b/, at: ['Drive section', 'Engineering'], text: 'Hazard: the door is sealed, and the seal is still good. Breaking it takes time and noise, and lets out the heat behind it: roll for an encounter when they start.' }] },
  { brief: (n) => `${n} is under quarantine, by its own crew, in the end by whoever was left. Something came aboard in a cargo lot and moved through the ship in days. {Medbay?Medbay is sealed|The crew quarters are sealed}. There are marks on the doors, from the inside.`,
    alt: [(n) => `${n} sealed itself. Whatever came aboard with the cargo took the doctor first and the captain last, and in between somebody welded the {Medbay?medbay|crew quarters} shut and painted a warning on the outer hull that has since flaked away. The beacon is still set to WARN OFF.`],
    hazards: [{ at: ['Medbay'], text: 'Hazard: contagion. The isolation field failed with the power. Anyone who breathes here unfiltered rolls against it, and a failure is the fever that comes before the calm.' }, { at: ['Lab'], text: 'Hazard: broken sample cases. The floor is wet and it is not water. It soaks through boots: anyone who walks through it rolls against the contagion.' }, { text: 'Hazard: bodies, arranged. Someone took care over this. Disturb them and a grey dust lifts into the air: anyone unfiltered rolls against the contagion.' }, { at: ['Life support'], text: 'Hazard: the filters are grey with growth. Breathable, for now. Every twenty minutes here without a filter is a roll against the contagion.' }, { at: ['Crew quarters'], text: 'Hazard: one bunk is still occupied and the occupant is still warm. They are calm, and they reach for the nearest hand: a touch is a roll against the contagion.' }],
    logs: [{ at: ['Medbay'], text: 'Log fragment (Dr.): "Fever, then the calm. The calm is the dangerous part. Adeyemi was fine at breakfast."' }, { at: ['Cargo hold'], text: 'Log fragment (Deckhand): "Lot 14 was breathing when we loaded it. Told the XO. XO said crates don\'t breathe."' }, { at: ['Bridge'], text: 'Log fragment (Cpt.): "Set the beacon to WARN OFF. If anyone docks anyway, they were warned."' }, { at: ['Galley'], text: 'Log fragment, scratched into the table: "we kept it out of {Galley?the galley|the crew quarters} for nine days"' }, { at: ['Crew quarters'], text: 'Log fragment (XO): "Kowalczyk is calm now. I have locked her in. I have told her it is for the fever."' }, { at: ['Life support'], text: 'Log fragment (Tech): "Air is fine. Air is fine. Doctor says stop testing the air."' }],
    loot: [{ at: ['Medbay'], text: 'Salvage: full trauma kit, sealed, and a case of broad-spectrum antivirals that did not work.' }, { at: ['Cargo hold'], text: 'Salvage: forty crates. Lot 14 is open. The others are worth a fortune to someone who does not ask where they came from.' }, { at: ['Lab'], text: 'Salvage: the doctor\'s notes, complete, on a data slate. They end mid-sentence.' }],
    hooks: ['The beacon says WARN OFF. Somebody switched it back to MAYDAY an hour ago.', 'Two crew are missing and the pods are all here.', 'A buyer is already paying for Lot 14, sight unseen, and will pay more for silence.', 'Lot 14\'s shipper has a second consignment on the way to a colony of forty thousand.', 'The doctor\'s slate has a cure on it. It works. It needs a living carrier.', 'Someone has been eating from {Galley?the galley stores|the ration stores} this week.'],
    kept: [{ when: /\bwelded the\b/, at: ['Medbay', 'Crew quarters'], text: 'Hazard: the door is welded shut from outside, and someone scratched a warning into the weld. Cutting through takes time, light and noise: roll for an encounter when they start.' }] },
  { brief: (n) => `${n} died of a mutiny that neither side won. The bridge held the doors, {Engineering?engineering|the drive section} held the power, and the ship drifted while they argued. Both sides left notes. Both sides are still aboard.`,
    alt: [(n) => `${n} split down the middle and stayed split. {Most} of the crew wanted to turn back, {few} wanted to press on, and the ship drifted while the argument went from words to doors to worse. By the end the bridge held the doors and {Engineering?engineering|the drive section} held the power. Both factions kept logs. Both logs end the same week.`],
    hazards: [{ at: ['Bridge'], text: 'Hazard: improvised tripwire on the door, wired to a flare. Loud, bright, and it draws whatever is still moving.' }, { at: ['Engineering'], text: 'Hazard: live cable stripped and laid across the deck. The mutineers\' idea of a lock: anyone who steps on it takes a hard hit, and a loud one.' }, { text: 'Hazard: a jammed hatch with a body on the far side, holding it shut from habit. Move the body and the hatch swings open at once, onto whatever is waiting behind it.' }, { at: ['Armoury'], text: 'Hazard: a rigged locker. Open it wrong and the last grenade aboard finishes the argument.' }, { at: ['Galley', 'Crew quarters'], text: 'Hazard: the food printer was poisoned. Both sides say the other did it. Anyone who eats from it is sick for the rest of the session.' }],
    logs: [{ at: ['Bridge'], text: 'Log fragment (Cpt.): "They have the reactor. We have the air. I intend to see who blinks."' }, { at: ['Engineering'], text: 'Log fragment (Eng.): "She will not take us home. We take the ship or we take nothing. Vote was {most} to {few}. The losing side is locked in {Galley?the galley|the crew quarters}."' }, { at: ['Medbay'], text: 'Log fragment (Dr.): "Treated one from each side today. Neither said thank you. Both said sorry."' }, { at: ['Crew quarters'], text: 'Log fragment, under a bunk: a list of names with lines through them, in two different hands.' }, { at: ['Galley'], text: 'Log fragment (one of the two): "They pass food under the door. They do not speak. Day nine."' }, { at: ['Cargo hold'], text: 'Log fragment (Deckhand): "Moved the cargo before either side could claim it. Neither side has asked me. Yet."' }],
    loot: [{ at: ['Armoury'], text: 'Salvage: three rifles, spent; one pistol, loaded, in a dead man\'s hand.' }, { at: ['Cargo hold'], text: 'Salvage: the cargo is what they were fighting over. It is worth exactly what someone will pay to keep it quiet.' }, { at: ['Bridge'], text: 'Salvage: the flight recorder, intact. It shows who fired first, and whoever is left on either side will want it.' }],
    hooks: ['The XO\'s pod is gone and the XO is still aboard.', 'Someone is still keeping the log, in a third hand.', 'The company that owns the hull wants the recorder, and only the recorder, and will pay for it to be lost.', 'The two locked in {Galley?the galley|the crew quarters} are alive, and they know where the cargo went.', 'The company\'s recovery contract pays double if the recorder is destroyed on site.', 'There was one more crewmember, on neither list.'] },
  { brief: (n) => `${n} was boarded. The airlock was cut, not opened; the crew fought a retreat from the bridge aft and lost. The boarders took the cargo and the pods and left the ship spinning. Whatever they were really after was in one crate, and they did not find it.`,
    alt: [(n) => `${n} was taken at the airlock by a cutter with no transponder. The crew held the bridge for an hour and {Cargo hold?the hold|the corridors} for less. The boarders tore the cargo apart looking for one crate, left without it, and vented the ship on the way out. The crate is still aboard.`],
    hazards: [{ lock: true, text: 'Hazard: cut airlock; the frame is scored and the inner door will not seal. This room is vacuum.' }, { at: ['Bridge'], text: 'Hazard: a boarder\'s breaching charge, unfired, taped to the console. Old, unstable, very much still a charge.' }, { at: ['Cargo hold'], text: 'Hazard: cargo netting rigged as a snare across the door. Somebody was expecting the boarders to come back. Walk into it and it hauls them off their feet: a hard hit, and stuck until someone cuts them free.' }, { at: ['Life support'], text: 'Hazard: the boarders vented this section. It has been in vacuum long enough that everything inside is brittle. Handholds snap, and a hard knock cracks a visor as easily as a cup.' }, { text: 'Hazard: the boarders cut the door controls on their way through. Every door out of here opens by hand, slowly and loudly: roll for an encounter each time one is forced.' }, { text: 'Hazard: a cornered crewmember\'s last stand. Spent brass, a welded door, a body on each side of it. The weld is all that holds the far room\'s air: cut it and that room vents towards them.' }],
    logs: [{ at: ['Bridge'], text: 'Log fragment (Cpt.): "Unregistered cutter on our port side. They are not answering. They are matching. Sound the alarm."' }, { at: ['Armoury'], text: 'Log fragment (Cpl.): "Issued everything. Eleven rounds each. Told them to make them count. They did not count."' }, { at: ['Cargo hold'], text: 'Log fragment (Deckhand): "They knew which crate. They went straight to it. It wasn\'t there. Petrov moved it a week ago and never said where."' }, { at: ['Engineering'], text: 'Log fragment (Eng.): "Hid in the coolant trunk. Heard them tearing {Cargo hold?the hold|the cargo} apart for an hour. Then quiet. Still quiet."' }, { at: ['Crew quarters'], text: 'Log fragment (Nav): "They took the pods so we could not tell anyone. They did not take the beacon. They should have."' }, { at: ['Life support'], text: 'Log fragment (Tech): "Vented the aft section from the console before they reached it. My people were in the aft section. I know."' }],
    loot: [{ at: ['Engineering', 'Drive section'], text: 'Salvage: a crate, hidden behind the coolant trunk, marked as spares. It is not spares. It is what the boarders came for.' }, { at: ['Armoury'], text: 'Salvage: empty racks, a boarder\'s dropped cutting torch with half a charge.' }, { at: ['Medbay'], text: 'Salvage: the autodoc logged a patient after the fight — not a crewmember. The boarders left one of their own.' }],
    hooks: ['The boarders\' cutter is still out there, and it knows this hull\'s beacon.', 'The crate is worth a hull and a half, and everyone who knew that is dead — nearly everyone.', 'One survivor in the coolant trunk, three weeks on emergency rations, very quiet.', 'The autodoc\'s patient is a boarder, alive, and willing to talk about the buyer.', 'The cutter\'s crew left a marker beacon {Cargo hold?in the hold|in one of the torn-open crates}; it started transmitting when you docked.', 'Petrov\'s hiding place holds two crates, and the manifest only ever listed one.'],
    // The medbay's patient is the twist here too (Willet Station, 2 Oct).
    unsay: [{ at: ['Medbay'], was: ' The patient is not in it.', now: '' }] },
  { brief: (n) => `${n} misjumped. The drive fired with the nav plot half-loaded and the ship came out somewhere with no stars in the right places. The crew rationed, then argued, then stopped. The drive is cold. The plot is still half-loaded.`,
    alt: [(n) => `${n} jumped with a bad plot and arrived nowhere. The stars outside match no chart. The crew rationed for a month, then the pods went, one at a time, each in a different direction. The drive has one charge left and a destination someone already loaded.`],
    hazards: [{ at: ['Drive section'], text: 'Hazard: the drive core is cold but not empty. Charge is bleeding off as static; metal tools jump in your hand.' }, { at: ['Galley'], text: 'Hazard: the ration printer was run on anything that fit. Whatever it printed last is still in the tray. Anyone who eats it is sick for the rest of the session.' }, { text: 'Hazard: the lights come on when you enter and go out behind you. There is no automation on this deck. Anyone who falls behind is alone in the dark: roll for an encounter.' }, { at: ['Bridge'], text: 'Hazard: the nav plot, if touched, tries to complete the jump. The drive answers, and whoever is aboard when it fires goes with it.' }, { at: ['Crew quarters'], text: 'Hazard: a crewmember\'s tally scratched into every surface. Stare too long and you lose your own count. Anyone who reads it through loses an hour.' }],
    logs: [{ at: ['Bridge'], text: 'Log fragment (Nav): "Plot says we are eleven light-years from where the plot says we are. Both readings agree with each other."' }, { at: ['Galley'], text: 'Log fragment (Cpt.): "Rations to half. Then to a third. Tamura suggested what comes after a third. I dismissed him."' }, { at: ['Drive section'], text: 'Log fragment (Eng.): "The core will fire once more. Once. Either we pick a direction or the ship does."' }, { at: ['Escape pods'], text: 'Log fragment (pod panel): pods launched one by one, every heading different, none of them toward anything.' }, { at: ['Crew quarters'], text: 'Log fragment (Cpl.): "Nobody sleeps. The stars are wrong and everyone checks them every hour to be sure."' }, { at: ['Lab'], text: 'Log fragment (Dr.): "Catalogued the sky. Nothing matches. One of the stars has moved since yesterday."' }],
    loot: [{ at: ['Bridge'], text: 'Salvage: the nav core, holding a jump plot no charts contain. Worth a career to the right astrogator.' }, { at: ['Cargo hold'], text: 'Salvage: intact cargo, untouched; the crew were too disciplined, or too frightened, to open it.' }, { at: ['Lab'], text: 'Salvage: star-field plates from the wrong sky, carefully filed.' }],
    hooks: ['The drive will fire once more, and somebody has already loaded a destination.', 'The tally in the crew quarters is still being added to.', 'The wrong sky outside has one star that is getting closer.', '{Lab?The plates in the lab|The nav plates on the bridge} show a planet in the wrong sky, and it has lights on the night side.', 'Rations went to half, then to a third, then Tamura made a suggestion. {Galley?The galley log|The cook\'s log} says it was carried out.', 'The nav plot completes itself if the drive is powered, and it has been quietly charging.'],
    unsay: [{ at: ['Drive section'], was: 'Fuel gauges at zero. The log says they were not.', now: 'Fuel gauges at zero. The charge gauge is not.' }] },
  { brief: (n) => `${n} lost power, then heat, then everyone. A cascade fault dropped the bus in the middle of a long haul and the crew could not bring it back. They gathered in the warmest room and waited. The ship has been at minus sixty for a long time.`,
    alt: [(n) => `${n} went dark on a long haul when the main bus dropped and would not come back. The crew pulled every blanket aboard into {Galley?the galley|the crew quarters} and ran one heater off the battery. The battery lasted sixty hours. The cold has lasted longer.`],
    hazards: [{ text: 'Hazard: frost on every surface, thick enough to hide the floor. Grates, drops and open hatches are all the same white.' }, { at: ['Life support'], text: 'Hazard: frozen water reclaim. The tanks split; the ice is the room now. Crossing it is a climb, and it cracks under weight into the water below.' }, { at: ['Engineering'], text: 'Hazard: the bus is one bad contact from live. Bringing power back brings everything back, including whatever tripped it, and a bare hand on the wrong contact takes a hard shock.' }, { at: ['Galley', 'Crew quarters'], first: true, text: 'Hazard: the crew, together, under every blanket aboard. They were breathing until quite recently. Lifting the blankets lets the last pocket of air out: everyone here checks against the cold at once.' }, { at: ['Medbay'], text: 'Hazard: the autodoc is frozen mid-cycle with a patient still inside. Its battery is spiking: a bare hand on the casing takes a hard shock.' }],
    logs: [{ at: ['Engineering'], text: 'Log fragment (Eng.): "Bus dropped. Not the reactor — the reactor is fine. Something between the reactor and us said no."' }, { at: ['Galley'], text: 'Log fragment (Cpt.): "Moved everyone to the galley. One heater on the battery. Sixty hours, the engineer says. Then the battery."' }, { at: ['Crew quarters'], text: 'Log fragment, on a slate held in a frozen hand: "hour 58. still here. tell Moreau\'s mother"' }, { at: ['Bridge'], text: 'Log fragment (Nav): "Sent the mayday on the last of the capacitor. If anyone heard, they have not said."' }, { at: ['Life support'], text: 'Log fragment (Tech): "Reclaim froze at hour 30. Melting ice on the heater for water. The heater is for people."' }, { at: ['Escape pods'], text: 'Log fragment (pod panel): pods checked at hour 40, all present. Cpt. code. Nobody launched.' }],
    loot: [{ at: ['Cargo hold'], text: 'Salvage: perishables, perfectly preserved. A fortune in frozen produce for anyone who can get it to port frozen.' }, { at: ['Engineering'], text: 'Salvage: the fault. A single component, expensive, sabotaged. Fit a spare and the ship lives.' }, { at: ['Medbay'], text: 'Salvage: the patient in the autodoc is in cryostasis, not dead. The autodoc did what it could.' }],
    hooks: ['Bring the bus back and the ship comes back — and the mayday resends, and someone answers.', 'The sabotaged part was fitted at the last port by a contractor who is still there.', 'Somebody in {Galley?the galley|the crew quarters} did not freeze; the blankets have been counted and one is missing.', 'Moreau\'s mother filed a claim, and the company told her the ship was never lost.', 'The heater in {Galley?the galley|the crew quarters} was switched off, not exhausted.', 'The contractor who fitted the fault has three more ships booked this month.'],
    unsay: [{ at: ['Medbay'], was: ' The patient is not in it.', now: '' }],
    // The one-shot's d6 and ending B wake "the patient in the autodoc", and ICV Shrike's medbay had no patient (3 Oct).
    kept: [{ when: /./, at: ['Medbay'], unless: /patient/i, text: 'The autodoc is frozen mid-cycle, and the patient is still in it, under a skin of frost.' }] },
  { brief: (n) => `${n} carried a specimen and the specimen did not stay in its crate. The crew tracked it room by room, sealed what they could, and lost. The log stops. The seals are intact, from outside; whatever is inside them is not the crew.`,
    alt: [(n) => `${n} was carrying something alive in a crate marked as ore. It got out between one watch and the next. The crew sealed the aft sections with some of their own still inside, then the fore sections, then the log stops. The seals are intact. Something is still using the ducts.`],
    hazards: [{ at: ['Cargo hold'], text: 'Hazard: the crate, open from the inside. The interior is wet and there are marks on the lid that were made slowly. It still comes back here to rest: anyone who stays in this room rolls for an encounter.' }, { text: 'Hazard: the ventilation grille is off and the duct beyond is scored. Something uses the ducts, and anyone who stands under an open grille is within its reach.' }, { at: ['Lab'], text: 'Hazard: a sealed door with the seal on the inside. Whoever sealed it wanted out kept out, and is still here. Breaking the seal opens the one room it has never been into.' }, { at: ['Life support'], text: 'Hazard: the scrubbers are clogged with something fibrous and pale that grows back overnight. It fouls suit filters: in this room they last minutes.' }, { at: ['Crew quarters'], text: 'Hazard: the mattresses are stacked against the door, from the inside. Moving them makes enough noise to bring it: roll for an encounter.' }],
    logs: [{ at: ['Lab'], text: 'Log fragment (Dr.): "It is not hostile. It is curious. I am no longer sure those are different things."' }, { at: ['Bridge'], text: 'Log fragment (Cpt.): "Sealed everything aft of frame 12. Nakamura is aft of frame 12. I have written to his family in my head a dozen times."' }, { at: ['Cargo hold'], text: 'Log fragment (Deckhand): "Crate was fine at loading. Crate was fine at the jump. Crate is not fine."' }, { at: ['Engineering'], text: 'Log fragment (Eng.): "It is in the ducts. It likes the warm ones. I have turned the heat off in the ducts. I have turned the heat off everywhere."' }, { at: ['Galley'], text: 'Log fragment (Cook): "Something in the ducts above the galley. Hear it at night. Have stopped cooking with the fan on."' }, { at: ['Armoury'], text: 'Log fragment (Cpl.): "Flechettes slowed it. Slowed. Twelve rounds left and it knows what the rifle sounds like now."' }],
    loot: [{ at: ['Lab'], text: 'Salvage: the specimen file, biometric-locked to the doctor. The doctor is in the lab. Most of the doctor.' }, { at: ['Cargo hold'], text: 'Salvage: the rest of the consignment, sealed and worth a great deal, to a buyer who must not know about the open crate.' }, { at: ['Armoury'], text: 'Salvage: two rifles and a box of flechette rounds, the only thing the log says slowed it down.' }],
    hooks: ['The seals are intact and the thing is not inside them.', 'The buyer for the consignment is already docked at the port you were heading for.', 'The doctor\'s file says the specimen was pregnant.', 'The consignment buyer already knows about the open crate and is paying for it to arrive that way.', 'There were two crates marked as ore. The manifest lists one.'] },
]

// Stations have no drive and no voyage; these causes only make sense on a ship.
const SHIP_ONLY = new Set([5]) // misjump
// Ship wording that reads wrong on a station.
const SPARE: { hazards: Placed[]; logs: Placed[]; loot: Placed[] } = {
  hazards: [{ text: 'Hazard: the deck grating is loose, and the cable run under it is a body deep. A misstep is a fall into it: a hard hit, and a climb out in the dark.' },
    { text: 'Hazard: a ceiling panel hangs by its cables and one end is live. Anyone tall, or careless with a lamp, brushes it: a hard shock.' }],
  logs: [{ text: 'Log fragment (unsigned): "Whoever reads this: she was ours, and we kept her going as long as we could. Tell the company that much."' }],
  loot: [{ text: 'Salvage: a crew locker, still locked. A month\'s pay in hard chits and a photograph nobody is coming back for.' },
    { text: 'Salvage: six suit batteries in a charging rack, all still holding charge. Worth more out here than anything on the manifest.' }],
}
const STATION_WORDS: [RegExp, string][] = [[/still shows the last jump/g, 'still shows the last docking approach'], [/\bthe ship\b/g, 'the station'], [/\bThe ship\b/g, 'The station'], [/\bthis ship\b/g, 'this station'], [/\ba ship\b/g, 'a station'], [/\bship's\b/g, "station's"], [/\bwhen the ship does\b/g, 'when the spin does'], [/\bthe last port\b/g, 'the last resupply'], [/\bin the middle of a long haul\b/g, 'mid-shift, with the tender a week out'], [/\bon a long haul\b/g, 'a week before the tender was due'], [/\bwent through a debris field that was not on the chart\b/g, 'took a debris field the tracking plot never saw'], [/\bcame out the other side with holes in it\b/g, 'came out of it with holes in it'], [/\bno more forward\b/g, 'no more spin-ward'], [/\bwanted to turn back, (\w+) wanted to press on\b/g, 'wanted to evacuate, $1 wanted to hold the station'],
  // Fore, aft and frames are a hull's words. Candlemas Station's brief (26 Sep) was
  // "still warm aft" with a "drive section" and a "mid-frame door".
  // A station never left port, and has no aft (Willet Station, 2 Oct). "the ship" is already "the station" here.
  [/\bbefore we left port\b/g, 'the day it came aboard'], [/\bdied before the station left port\b/g, 'died before the courier set out'], [/\bthe aft section\b/g, 'the outer ring'],
  // A sweep of 300 stations' one-shots (2 Oct) found these left: the hub is a station's "forward", the ring its "aft".
  [/\bthrough the forward lock\b/g, 'through the hub lock'], [/\bThe forward airlock\b/g, 'The hub airlock'], [/\bthe forward rooms\b/g, 'the hub rooms'],
  [/\bthrough the hull aft\b/g, 'through the ring hull'], [/\bfrom the bridge aft\b/g, 'from the bridge out to the ring'],
  [/\bthe drive core still remembers the last vector\b/g, 'the traffic plot still has its last vector'],
  [/\bConsoles forward;/g, 'Consoles along the window;'], [/\bViewports forward\./g, 'Viewports all round.'],
  [/\bmoved forward ahead of it\b/g, 'moved spin-ward ahead of it'], [/\bis still warm aft\b/g, 'is still warm at the core'],
  [/\bthe drive section\b/g, 'the reactor ring'], [/\bthe mid-frame door\b/g, 'the spoke hatch'], [/\baft of the mid-frame\b/g, 'past the spoke hatch'],
  [/\bPatched the aft seam\b/g, 'Patched the ring seam'], [/\bon our port side\b/g, 'on docking arm two'],
  [/\bSealed everything aft of frame 12\b/g, 'Sealed the ring past spoke 3'], [/\bis aft of frame 12\b/g, 'is past spoke 3'],
  [/\bCrate was fine at the jump\b/g, 'Crate was fine off the tender'], [/\bdid not come forward\b/g, 'did not come up the spoke'],
  [/\bDON'T OPEN AFT\b/g, "DON'T OPEN THE RING"], [/\bOrdered the aft sections sealed\b/g, 'Ordered the reactor ring sealed'],
  [/\bsealed the aft sections\b/g, 'sealed the ring deck'], [/\bthen the fore sections\b/g, 'then the hub'], [/\boff-ship\b/g, 'off-station']]

/** Station wording for text written for a hull. */
export const stationWords = (t: string) => STATION_WORDS.reduce((a, [re, to]) => a.replace(re, to), t)

/** Which cause wrote this brief, found by the words after the hull name, so a
 *  ship renamed in the editor still matches. -1 for a brief no cause wrote. */
export function causeIndexOf(brief: string): number {
  const first = (brief || '').split('\n')[0] ?? ''
  for (const [i, c] of CAUSES.entries()) for (const b of [c.brief, ...(c.alt || [])]) {
    for (const form of [b('\u0001'), stationWords(b('\u0001'))]) {
      const after = (form.split('\u0001')[1] ?? '').replace(/\{\w+\}.*$/, '').slice(0, 40)
      if (after.trim().length > 10 && first.includes(after)) return i
    }
  }
  return -1
}

// Intact ships get a job, a complication and a hook: enough to run a session without a wreck in it.
interface Job { ship?: boolean; brief: (name: string) => string; details: Placed[]; hooks: string[] }
const JOBS: Job[] = [
  { ship: true, brief: (n) => `${n} is eleven days into a fourteen-day cargo run, on schedule, with one hold sealed under a customs bond the crew has not been told the reason for.`,
    details: [{ at: ['Cargo hold'], text: 'One container carries a bonded seal and a second, older seal underneath it.' }, { at: ['Bridge'], text: 'The route plot has a detour nobody on the bridge remembers filing.' }, { at: ['Galley', 'Crew quarters'], text: 'A betting pool on what is in the bonded container. Current favourite: "someone".' }, { at: ['Engineering'], text: 'Fuel margin is thin. The detour was not in the budget.' }],
    hooks: ['The bonded container is ticking, faintly, and it was not ticking yesterday.', 'The consignee does not exist. The port where they are supposed to be does.', 'A second ship has matched course and is keeping exactly out of sensor range.', 'The bond paperwork is real and the ship it names is not this one.'] },
  { ship: true, brief: (n) => `${n} is carrying {passengers} and a crew of {hands}, three days out from the last port, and one of the passengers has not left their cabin since departure.`,
    details: [{ at: ['Crew quarters'], text: 'Cabin 3 is locked from inside. Meals are taken from the tray outside the door when nobody is watching.' }, { at: ['Medbay'], text: 'The passenger manifest lists a medical flag for one traveller. The autodoc has no record of them.' }, { at: ['Galley'], text: 'Every meal, one place setting fewer than the manifest says.' }, { at: ['Bridge'], text: 'A private message came in for cabin 3 on the ship\'s channel. It was read and deleted.' }],
    hooks: ['The passenger in cabin 3 is not on any manifest the port ever issued.', 'Someone on the crew was paid to make sure cabin 3 arrives. Someone else was paid to make sure it does not.', 'The port ahead has closed to all traffic as of an hour ago. No reason given.', 'Cabin 3 has asked, politely, for a suit.'] },
  { brief: (n) => `${n} is mid-refit. Half the systems are on temporary power, the yard crew left this morning, and the work order does not match what was actually done.`,
    details: [{ at: ['Engineering'], text: 'A new coolant loop, fitted, not on the work order. The old one is gone.' }, { at: ['Life support'], text: 'Scrubber 2 is a different make from the other three and a different make from the invoice.' }, { at: ['Cargo hold'], text: 'A yard crate, unlabelled, that nobody has claimed and nobody will sign for.' }, { at: ['Bridge', 'Central hub'], text: 'The yard left a diagnostic tap on the main bus. It is still transmitting.' }],
    hooks: ['The yard was paid twice: once by the owner, once by someone else.', 'The unlisted coolant loop has a serial number from a ship that was scrapped last year.', 'The diagnostic tap is reporting to an address the crew can trace, and it is close.', 'The yard foreman has asked for a private word before the ship leaves. Off the record.'] },
  { ship: true, brief: (n) => `${n} is a survey ship on station at an unnamed rock, twelve weeks into a twenty-week contract, and the samples are not what the contract said they would find.`,
    details: [{ at: ['Lab'], text: 'The sample cases are full. The assay results are locked to the mission lead\'s key.' }, { at: ['Cargo hold'], text: 'Twenty core samples, tagged and sealed. Number 14 is heavier than the others.' }, { at: ['Bridge'], text: 'The contract says report weekly. The log shows the last three reports were sent, then recalled.' }, { at: ['Crew quarters'], text: 'Someone has been drafting a resignation. Four versions, none sent.' }],
    hooks: ['The company is sending a second ship. It was dispatched before the recalled reports.', 'The rock is claimed. The claim was filed the day after the survey began, by a name nobody recognises.', 'Core 14 is warm.', 'The mission lead has proposed that the crew simply not tell anyone.'] },
  { brief: (n) => `${n} is the last stop on a supply run: fuel, water, mail and a medical courier who is late.`,
    details: [{ at: ['Medbay'], text: 'A refrigerated courier case, sealed, addressed to a name on the crew list. Nobody has opened it.' }, { at: ['Cargo hold', 'Central hub'], text: 'Mail sacks for three ships. One of them stopped answering hails a month ago.' }, { at: ['Galley'], text: 'The good coffee came in on this run. Rationing starts tomorrow.' }, { at: ['Bridge', 'Lift lobby'], text: 'The courier\'s transponder is on the plot. It has been in the same place for six hours.' }],
    hooks: ['The courier case is for someone who died before the ship left port.', 'The mail for the silent ship includes a letter that answers a question nobody here has asked yet.', 'The courier is not late. The courier has been waiting for an escort that is not coming.', 'Whatever is in the case, the supplier has asked for it back, urgently and with money.'] },
  { ship: true, brief: (n) => `${n} is running a passage under a false transponder, carrying nothing illegal and a crew that would rather not explain why.`,
    details: [{ at: ['Bridge'], text: 'Two transponder cores in the rack. Only one is plugged in.' }, { at: ['Crew quarters'], text: 'Everyone aboard has a second set of papers. They are all quite good.' }, { at: ['Cargo hold'], text: 'The hold is empty and freshly scrubbed, which is its own kind of evidence.' }, { at: ['Armoury'], text: 'The racks are full and the log of who signed what out is honest, which is unusual.' }],
    hooks: ['The ship whose name they are borrowing has just arrived in the same system.', 'A patrol is running inspections at the next jump. Random, they say.', 'One of the crew is not who their second papers say either.', 'The person who arranged the false name has been found, and they talked.'] },
  { ship: true, brief: (n) => `${n} is fully crewed and going nowhere: a quarantine hold, day four, no symptoms, no explanation, and the port is not answering questions.`,
    details: [{ at: ['Medbay'], text: 'Everyone has been scanned twice. Everyone is fine. The scanner has been asked to check itself and says it is fine too.' }, { at: ['Life support'], text: 'The port ordered the air recycled through the new filters. The new filters arrived sealed and unlabelled.' }, { at: ['Galley'], text: 'Eleven days of food if nobody does anything stupid.' }, { at: ['Bridge', 'Central hub'], text: 'Every other ship in the hold pattern has gone quiet, one by one, over four days.' }],
    hooks: ['The port lifted the hold for one ship this morning. That ship had paid.', 'The unlabelled filters are catching something. It is not from the crew.', 'A tug is coming to tow the ship into the port\'s dock. The crew did not ask for one.', 'One of the quiet ships has started drifting.'] },
  { brief: (n) => `${n} has a crew of {crew}, a hold full of a colony's first year, and a colony that has stopped transmitting.`,
    details: [{ at: ['Cargo hold', 'Hangar'], text: 'Seed stock, a fabricator, forty tonnes of shelter, three cases marked FRAGILE and addressed to a name, not the colony.' }, { at: ['Bridge', 'Lift lobby'], text: 'The last colony message is a schedule. It was sent on time and says nothing.' }, { at: ['Crew quarters'], text: 'Two of the crew have family on the colony. They have not been told it went quiet.' }, { at: ['Medbay'], text: 'The colony\'s medical requisition is here and it is three times the size of last year\'s.' }],
    hooks: ['The colony is transmitting again. In a different voice.', 'The FRAGILE cases are for someone who was never on the colony roster.', 'A second supply ship is inbound from a rival company, and it is faster.', 'The colony\'s last schedule lists an arrival that is not this ship.'] },
]
// Crew numbers come from the beds on the plan. The stories used to say "crew of
// nine" over a ship with two bunks, and a reader counted. Spoken as words, in the
// story's own voice; every ship sleeps at least two.
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve']
const word = (n: number) => WORDS[n] ?? String(n)
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)
export const berthsOf = (g: GenResult) => g.decks.flatMap((d) => d.stamps).filter((s) => s.kind === 'bunk' || s.kind === 'bunk2').length
function crewTokens(g: GenResult) {
  const crew = Math.max(2, berthsOf(g)), few = Math.max(1, Math.floor(crew / 3)), pax = Math.max(1, Math.floor(crew / 2))
  const t: Record<string, string> = { crew: word(crew), most: word(crew - few), few: word(few), hands: word(crew - pax), passengers: `${word(pax)} passenger${pax > 1 ? 's' : ''}` }
  for (const [k, v] of Object.entries(t)) t[cap(k)] = cap(v)
  return (s: string) => s.replace(/\{(\w+)\}/g, (m: string, k: string) => t[k] ?? m)
}
export function liven(g: GenResult, name: string, r: () => number, pick: <T>(a: T[]) => T, station = false): string {
  const job = pick(station ? JOBS.filter((j) => !j.ship) : JOBS)
  const nums = crewTokens(g)
  const fix = (t: string) => (station ? STATION_WORDS.reduce((a, [re, to]) => a.replace(re, to), nums(t)) : nums(t))
  const rooms = g.decks.flatMap((d) => Object.values(d.key).map((k) => ({ k, deck: d })))
  settle(g, JSON.stringify(job) + job.brief(name), station)
  const pool = job.details.filter((it) => !it.at || rooms.some((x) => it.at!.includes(x.k.name)))
  const used = new Set<RoomInfo>()
  for (let i = 0; i < 2 && pool.length; i++) {
    const it = pool.splice(Math.floor(r() * pool.length), 1)[0] as (typeof pool)[number]
    const fit = rooms.filter((x) => (!it.at || it.at.includes(x.k.name)) && !used.has(x.k))
    if (!fit.length) continue
    const room = fit[Math.floor(r() * fit.length)] as (typeof fit)[number]
    used.add(room.k)
    room.k.notes = room.k.notes + (room.k.notes ? '\n' : '') + fix(it.text)
  }
  return `${fix(job.brief(name))}\n\nHook: ${fix(pick(job.hooks))}`
}

// One thread through the ship. A reader said every room had "a brand new clue
// and none of them seem to be related", and that was true: each note fitted the
// cause but none pointed anywhere. The trail follows whoever wrote the last log
// entry across three rooms, each note naming the next room by its key number,
// so the players have a route and the GM has an order to reveal things in.
const TRAILS: ((who: string, n: string, b: string, c: string, cName: string) => [string, string, string])[] = [
  (who, n, b, c) => [`${who}'s slate, screen cracked. The last entry: "Going to ${b}. Back in ten." Nothing after it.`,
    `${n} got this far. One set of boot prints in the dust, heading for ${c}, and a door code scratched into the frame.`,
    `The code from the last room opens the locker here. Inside, ${n}'s own recording of the last day, start to finish.`],
  (who, n, b, c, cName) => [`A glove on the deck just inside the door, ${n}'s by the name stitched in the cuff. The other one is in ${b}.`,
    `${n}'s other glove. Scratched into the bulkhead beside it at hand height: "${cName.toUpperCase()}. DON'T." That is ${c}.`,
    `${who} is here, or what is left of them. The recorder on their suit is still running and covers the last day.`],
  (who, n, b, c) => [`A note taped up at eye height, signed ${n}: "If you are reading this, check ${b} before you trust anything in the log."`,
    `A second log hidden behind a panel, kept by ${n}. It disagrees with the official one about one thing, and that thing is ${/^the bridge\b/.test(c) ? 'on' : 'in'} ${c}.`,
    `Where ${n}'s private log pointed. Under a deck plate, in a sealed sample bag: ${who}'s recorder. It covers the last day, all of it, from someone who was there.`],
  // Three were too few: a GM who made six one-shots on 3 Oct got the taped note four times, word for word.
  (who, n, b, c) => [`Chalk marks on the door frame, ${n}'s tally of the days. Below the last mark, an arrow and two words: "${b}".`,
    `More chalk. ${n} slept here at least one night: a bedroll, ration wrappers, and the same arrow, pointing to ${c}.`,
    `The arrows stop here. ${who}'s recorder is wedged behind a pipe where nobody passing would see it. It holds the last day, start to finish.`],
  (who, n, b, c) => [`A sound-powered handset hanging off its hook, the line still open to ${b}. It needs no power, and someone at the other end kept talking long after anyone answered.`,
    `The other end of the line. ${n}'s helmet sits under the handset, and on the bulkhead beside it, chalked in ${n}'s hand, the next room: ${c}.`,
    `${n}'s last call went here. The recorder clipped under the console is ${who}'s. It caught both ends of the call, and everything after, to the end of the last day.`],
  (who, n, b, c, cName) => [`A keycard on a lanyard by the door, ${n}'s face on it. The door log says it last opened ${b}.`,
    `The card's last door. On the wall in grease pencil, in ${n}'s hand: "${cName.toUpperCase()}, BOTTOM LOCKER." That is ${c}.`,
    `The bottom locker, its seal unbroken. Inside: ${who}'s recorder, with the last day on it, all of it.`],
]
function trail(g: GenResult, rooms: { k: RoomInfo; deck: Deck }[], who: string, n: string, r: () => number) {
  if (rooms.length < 3) return
  // Not through the room the story sealed with someone inside: ICV Sextant's trail (3 Oct) began in the
  // drive section the engineer had sealed, so the players had to break the seal, one of the endings, to start.
  // A ship with an engineering on each deck seals one, and the brief only says "sealed engineering", so keep out of both.
  const shut = new Set(rooms.filter((x) => /the door is sealed, and the seal is still good/.test(x.k.notes)).map((x) => x.k.name))
  const open = rooms.filter((x) => !shut.has(x.k.name))
  const pool = open.length >= 3 ? open : [...rooms], at: typeof rooms = []
  for (let i = 0; i < 3; i++) at.push(pool.splice(Math.floor(r() * pool.length), 1)[0] as (typeof pool)[number])
  const many = g.decks.length > 1
  const bare = (x: typeof rooms[0]) => (/^(life support|engineering)$/i.test(x.k.name) ? '' : 'the ') + x.k.name.toLowerCase()
  const label = (x: typeof rooms[0]) => `${bare(x)} (${x.k.num}${many ? ', ' + x.deck.name.toLowerCase() : ''})`
  const trail = TRAILS[Math.floor(r() * TRAILS.length)] as (typeof TRAILS)[number]
  const [, one, two] = at as [typeof rooms[0], typeof rooms[0], typeof rooms[0]]
  const notes = trail(who, n, label(one), label(two), bare(two))
  at.forEach((x, i) => { x.k.notes = x.k.notes + (x.k.notes ? '\n' : '') + `Trail ${i + 1}/3: ${notes[i]}` })
}

// One ship, one set of facts. The dead-ship notes were drawn room by room, so a
// freighter with three cargo holds could say the same line three times, and one
// pod bay could read "All pods gone" while the other said "every pod still
// docked" under a brief that launched exactly one. This runs before the story
// is placed, knows the story, and uses no random numbers.
const CONDITIONS = ['Dark. Emergency lighting only.', 'Vacuum. Suit up.', 'Something moved in here — recently.', 'Cold. Frost on every surface.']
const POD_STATE: [RegExp, string, string][] = [
  [/pods are all here|all present/i, 'Every pod still docked. Nobody got out.', 'These pods never launched either.'],
  [/one pod launched|one launch|the pod took/i, 'One cradle empty. The rest still docked, cold.', 'Every pod in this bay still docked.'],
  [/took the pods|pods went|pods launched/i, 'All pods gone. Empty cradles.', 'Empty cradles, same as the other bay.'],
]
// A room note the story makes impossible: warm coffee on a ship that froze.
const CLASHES: [RegExp, RegExp][] = [[/\bcold\b|frost|heater|froze/i, /still warm/i]]
function settle(g: GenResult, told: string, station = false) {
  const seen = new Set<string>(), bare = (t: string) => t.replace(/^Ladder down\. /, '')
  const dead = g.name.startsWith('Derelict')
  const pods = POD_STATE.find(([re]) => re.test(told))
  const clash = (t: string) => CLASHES.some(([story, note]) => story.test(told) && note.test(t))
  let firstPod: string | null = null
  g.decks.forEach((d, i) => {
    // "Ladder down." only where a ladder in that room leads to a deck below this one.
    const below = new Set(d.stamps.filter((s) => s.kind === 'ladder' && g.decks.findIndex((x) => x.name === s.link) > i).map((s) => cellAt(d, s.x, s.y)))
    for (const [id, k] of Object.entries(d.key)) {
      if (!below.has(Number(id))) k.notes = k.notes.replace(/Ladder down\. ?/, '')
      let cond = CONDITIONS.find((c) => k.notes.startsWith(c + ' ')) ?? ''
      let base = cond ? k.notes.slice(cond.length + 1) : k.notes
      if (cond && seen.has(cond)) cond = ''
      if (k.name === 'Escape pods') {
        if (firstPod === null) base = firstPod = pods ? pods[1] : base
        else base = pods ? pods[2] : /gone/i.test(firstPod) ? 'Empty cradles, same as the other bay.' : /docked/i.test(firstPod) ? 'These pods never launched either.' : 'More pods, all green.'
      } else if (seen.has(bare(base)) || clash(base)) {
        const role = Object.values(ROLES).find((x) => x.name === k.name)
        base = ((dead ? role?.dead : role?.notes) ?? []).find((t) => !seen.has(bare(t)) && !clash(t) && !(t.startsWith('Ladder down') && !below.has(Number(id)))) ?? ''
      }
      if (cond) seen.add(cond)
      seen.add(bare(base))
      k.notes = [cond, base].filter(Boolean).join(' ')
      if (station) k.notes = STATION_WORDS.reduce((a, [re, to]) => a.replace(re, to), k.notes)
    }
  })
}

export function storify(g: GenResult, name: string, r: () => number, pick: <T>(a: T[]) => T, station = false): string {
  // A hole can take the only airlock (6 in 1200, 2 Oct), and then "taken at the airlock" is a
  // story about a door the map lacks. pick() is one r() either way, so ships with a lock roll as before.
  const lockless = !g.decks.some((d) => d.doors.some((k) => k.kind === 'airlock'))
  const atLock = (c: Cause) => [c.brief, ...(c.alt || [])].some((b) => /\bairlock\b/i.test(b('X')))
  const cause = pick((station ? CAUSES.filter((_, i) => !SHIP_ONLY.has(i)) : CAUSES).filter((c) => !lockless || !atLock(c)))
  const rooms = g.decks.flatMap((d) => Object.values(d.key).map((k) => ({ k, deck: d })))
  // A ship with no pod bay cannot have launched a pod. Anything that says it did is
  // dropped; the list is only filtered when there is something to drop, so ships
  // that do have pods roll exactly as before.
  const podless = !rooms.some((x) => x.k.name === 'Escape pods')
  const sayable = <T>(a: T[], text: (x: T) => string) => { const ok = podless ? a.filter((x) => !/\bpods?\b/i.test(text(x))) : a; return ok.length ? ok : a }
  const brief = pick(sayable([cause.brief, ...(cause.alt || [])], (b) => b('X')))
  const nums = crewTokens(g)
  // As in the one-shot: {Room?if aboard|if not}, so the story never sends anyone to a room the map lacks.
  const aboardRooms = new Set(rooms.map((x) => x.k.name))
  const aboard = (t: string) => nums(t).replace(/\{([^?}]+)\?([^|}]*)\|([^}]*)\}/g, (_: string, room: string, yes: string, no: string) => (aboardRooms.has(room) ? yes : no))
  const fix = (t: string) => (station ? STATION_WORDS.reduce((a, [re, to]) => a.replace(re, to), aboard(t)) : aboard(t))
  if (!rooms.length) return fix(brief(name))
  settle(g, JSON.stringify(cause) + brief(name), station)
  const used = new Set<RoomInfo>()
  // "Cut airlock... this room is vacuum" went in any room, so the key put the airlock where
  // the map had none. It goes in a room an airlock opens into, or, when the lock opens on a
  // corridor or a hole took it, nowhere.
  const locked = new Set(g.decks.flatMap((d) => d.doors.filter((k) => k.kind === 'airlock').flatMap((k) => {
    const [nx, ny] = k.side === 'N' ? [k.x, k.y - 1] : [k.x - 1, k.y]
    return [(d.cells[idx(k.x, k.y)] as number), (d.cells[idx(nx, ny)] as number)].map((id) => d.key[id]).filter((k): k is RoomInfo => !!k)
  })))
  // The brief sends the crew under the blankets in {Galley?the galley|the crew quarters}; Fieldfare Station's
  // hazard (2 Oct) put them in the crew quarters next to a galley where the captain's log says they went.
  const fits = (it: Placed, x: { k: RoomInfo }) => (!it.at || (it.first ? it.at.find((n) => rooms.some((y) => y.k.name === n)) === x.k.name : it.at.includes(x.k.name))) && (!it.lock || locked.has(x.k))
  const has = (it: Placed) => rooms.some((x) => fits(it, x))
  // A cause's notes are mostly tagged to rooms, so a small ship ran out: 12 in 600 derelicts
  // had no salvage at all and 33 had two hazards (2 Oct). When the pool is empty and the count
  // is under its floor, a spare that fits any cause and any room tops it up. A ship that was
  // never short draws no spare, so it comes out the same.
  const place = (items: Placed[], n: number, floor: number, spare: Placed[]) => {
    const pool = sayable(items.filter(has), (x) => x.text) // a note written for a room this ship lacks is dropped, never misplaced
    const spares = spare.slice()
    for (let i = 0; i < n; i++) {
      if (!pool.length) { if (i >= floor || !spares.length) break; pool.push(spares.splice(Math.floor(r() * spares.length), 1)[0] as Placed) }
      const it = pool.splice(Math.floor(r() * pool.length), 1)[0] as Placed
      const fit = rooms.filter((x) => fits(it, x))
      const fresh = fit.filter((x) => !used.has(x.k))
      const from = fresh.length ? fresh : fit // a tagged note stays in its room even if that room already has one
      const room = from[Math.floor(r() * from.length)] as (typeof from)[number]
      used.add(room.k)
      room.k.notes = room.k.notes + (room.k.notes ? '\n' : '') + fix(it.text)
    }
  }
  place(cause.hazards, 3 + Math.floor(r() * 3), 3, SPARE.hazards) // 3–5
  place(cause.logs, 3, 3, SPARE.logs)
  place(cause.loot, 2 + Math.floor(r() * 2), 2, SPARE.loot) // 2–3
  // Words only, no r(): the cold story's medbay said "The patient is not in it." beside its patient (Fieldfare Station, 2 Oct).
  for (const u of cause.unsay || []) for (const x of rooms) if (u.at.includes(x.k.name)) x.k.notes = x.k.notes.replace(u.was, u.now)
  for (const m of cause.kept || []) {
    const room = m.when.test(brief(name)) && m.at.map((n) => rooms.find((x) => x.k.name === n)).find(Boolean)
    if (room && !m.unless?.test(room.k.notes)) room.k.notes = room.k.notes + (room.k.notes ? '\n' : '') + fix(m.text)
  }
  // The trail's owner must not be someone the story already placed: "the pod took
  // Reyes" then a trail that follows Reyes round the ship reads as a mistake,
  // and so does a trail for "Eng." when the brief sealed the engineer aft.
  const told = JSON.stringify(cause) + brief(name)
  const ROLE_WORD: Record<string, RegExp> = { 'Eng.': /engineer/i, 'Dr.': /doctor/i, 'Cpt.': /captain/i }
  const ranks = RANK.filter((x) => !ROLE_WORD[x]?.test(brief(name))), names = CREW.filter((x) => !told.includes(x))
  const rank = pick(ranks.length ? ranks : RANK), surname = pick(names.length ? names : CREW), who = `${rank} ${surname}`
  trail(g, rooms, who, surname, r)
  for (const x of rooms) x.k.notes = nums(x.k.notes) // the dead-ship notes were written before the story knew its crew
  // A hook that names crew ("Moreau's mother") only makes sense if a placed log names them too.
  const placed = rooms.map((x) => x.k.notes).join('\n')
  const known = cause.hooks.filter((h) => CREW.every((c) => !h.includes(c) || placed.includes(c)))
  const hook = fix(pick(sayable(known.length ? known : cause.hooks, (h) => h)))
  const keep = holesKept(CAUSES.indexOf(cause), station)
  if (keep) for (const d of g.decks) mend(d, keep)
  // A hole that took a room's only way in leaves the room reached across the gap
  // (8 of 24 small derelicts, 1 Oct). The picture shows the hole; the key is what the
  // GM reads out, so it says so too. No dice: every ship still rolls the same.
  // A second such room points back at the one before, so no line is said twice. In key order, so the
  // full line comes first on the page and the others point up to it, not down.
  let prev = ''
  for (const d of g.decks) for (const k of [...cutOffRooms(d)].map((id) => d.key[id]).filter((k): k is RoomInfo => !!k).sort((a, b) => a.num - b.num)) {
    k.notes += (k.notes ? '\n' : '') + (prev ? `Way in: only across the breach, like the ${prev}.` : fix(WAY_IN))
    prev = `${k.name} (${k.num}${g.decks.length > 1 ? `, ${d.name.toLowerCase()}` : ''})`
  }
  return `${fix(brief(name))}\n\nLast log entry: ${who}. Their trail runs through three rooms.\n\nHook: ${hook}`
}
