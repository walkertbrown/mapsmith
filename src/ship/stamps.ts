// Furniture / fixtures drawn in code so the single-file build carries no
// image assets. Each stamp is drawn into a unit square (0..1) facing "up";
// the Surface handles rotation and scaling, and is implemented for both the
// canvas (screen, PNG, UVTT image) and the PDF writer, so all exports agree.

import { footprint, imageLookup, type Stamp, type StampKind } from './model'

export interface Surface {
  /** Draw a raster (data URL) filling the unit box; PDF draws a placeholder. */
  image(src: string, w: number, h: number, fallbackStroke: string): void
  rect(x: number, y: number, w: number, h: number, fill?: string, stroke?: string, lw?: number): void
  line(x1: number, y1: number, x2: number, y2: number, stroke: string, lw: number): void
  circle(cx: number, cy: number, r: number, fill?: string, stroke?: string, lw?: number): void
  poly(points: [number, number][], fill?: string, stroke?: string, lw?: number): void
}

export interface StampColors { stroke: string; fill: string; accent: string }

export const STAMP_LABELS: Record<StampKind, string> = {
  console: 'Console', chair: 'Chair', bunk: 'Bunk', table: 'Table', crate: 'Crate', cryopod: 'Cryopod',
  locker: 'Lockers', reactor: 'Reactor', turret: 'Turret', medbed: 'Med bed', ladder: 'Ladder', lift: 'Lift',
  stairs: 'Stairs', vent: 'Vent', pillar: 'Pillar', engine: 'Engine',
  bunk2: 'Bunk 1×2', reactor2: 'Reactor 2×2', container: 'Container 2×1', cryobank: 'Cryo bank 2×2', bench: 'Workbench 3×1',
  airlockroom: 'Airlock 2×2', shuttle: 'Shuttle 3×2', tank: 'Tank 1×2',
  altar: 'Altar 2×1', statue: 'Statue', chest: 'Chest', sarcophagus: 'Sarcophagus 1×2', well: 'Well', brazier: 'Brazier', bookcase: 'Bookcase 2×1',
  barrel: 'Barrel', rubble: 'Rubble', throne: 'Throne', bed: 'Bed 1×2', trapdoor: 'Trapdoor', rack: 'Weapon rack 2×1', bones: 'Bones',
}
export const STAMP_KINDS = Object.keys(STAMP_LABELS) as StampKind[]

/** Stamps that tokens cannot see through — exported as objects_line_of_sight. */
export const blocksSight = (kind: Stamp['kind']) => kind.startsWith('img:') ? (imageLookup(kind.slice(4))?.blocks ?? false) : BLOCKS_SIGHT.has(kind as StampKind)
export const BLOCKS_SIGHT = new Set<StampKind>(['crate', 'locker', 'reactor', 'pillar', 'engine', 'cryopod', 'lift', 'reactor2', 'container', 'cryobank', 'shuttle', 'tank', 'statue', 'bookcase'])
/** Stamps that connect decks. */
export const LINKS_DECKS = new Set<string>(['ladder', 'lift', 'stairs'])

const LW = 0.06

export function drawStamp(s: Surface, kind: Stamp['kind'], c: StampColors) {
  const { stroke, fill, accent } = c
  const [W, H] = footprint(kind)
  if (kind.startsWith('img:')) {
    const im = imageLookup(kind.slice(4))
    if (im) s.image(im.data, W, H, stroke); else s.rect(0.1, 0.1, W - 0.2, H - 0.2, undefined, stroke, LW)
    return
  }
  switch (kind as StampKind) {
    case 'bunk2':
      s.rect(0.15, 0.08, 0.7, H - 0.16, fill, stroke, LW)
      s.rect(0.22, 0.15, 0.56, 0.28, accent, stroke, LW)
      s.line(0.15, 0.55, 0.85, 0.55, stroke, LW)
      break
    case 'reactor2':
      s.rect(0.08, 0.08, W - 0.16, H - 0.16, fill, stroke, LW)
      s.circle(1, 1, 0.8, fill, stroke, LW)
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; s.line(1 + Math.cos(a) * 0.35, 1 + Math.sin(a) * 0.35, 1 + Math.cos(a) * 0.78, 1 + Math.sin(a) * 0.78, stroke, LW * 0.7) }
      s.circle(1, 1, 0.3, accent, stroke, LW)
      break
    case 'container':
      s.rect(0.06, 0.15, W - 0.12, 0.7, fill, stroke, LW)
      s.line(0.06, 0.15, W - 0.06, 0.85, stroke, LW * 0.6)
      s.line(W - 0.06, 0.15, 0.06, 0.85, stroke, LW * 0.6)
      for (const x of [0.5, 1, 1.5]) s.line(x, 0.15, x, 0.85, stroke, LW * 0.5)
      break
    case 'cryobank':
      for (const [x, y] of [[0.1, 0.05], [1.05, 0.05], [0.1, 1.05], [1.05, 1.05]] as [number, number][]) {
        s.rect(x + 0.12, y, 0.6, 0.9, fill, stroke, LW)
        s.circle(x + 0.42, y + 0.28, 0.14, accent, stroke, LW)
      }
      break
    case 'bench':
      s.rect(0.06, 0.25, W - 0.12, 0.5, fill, stroke, LW)
      s.rect(0.2, 0.32, 0.5, 0.36, accent, stroke, LW * 0.7)
      s.circle(2.3, 0.5, 0.15, accent, stroke, LW * 0.7)
      s.line(1.1, 0.4, 1.9, 0.4, stroke, LW * 0.6); s.line(1.1, 0.6, 1.9, 0.6, stroke, LW * 0.6)
      break
    case 'airlockroom':
      s.rect(0.08, 0.08, W - 0.16, H - 0.16, fill, stroke, LW * 1.4)
      s.line(0.08, 1, W - 0.08, 1, stroke, LW * 0.6); s.line(1, 0.08, 1, H - 0.08, stroke, LW * 0.6)
      s.line(0.4, 0.4, W - 0.4, H - 0.4, accent, LW); s.line(W - 0.4, 0.4, 0.4, H - 0.4, accent, LW)
      break
    case 'shuttle':
      s.poly([[0.1, 0.5], [0.9, 0.1], [2.9, 0.4], [2.9, 1.6], [0.9, 1.9], [0.1, 1.5]], fill, stroke, LW)
      s.rect(1.4, 0.7, 0.8, 0.6, accent, stroke, LW * 0.7)
      s.line(2.9, 0.7, 2.6, 0.7, stroke, LW); s.line(2.9, 1.3, 2.6, 1.3, stroke, LW)
      break
    case 'tank':
      s.rect(0.15, 0.1, 0.7, H - 0.2, fill, stroke, LW)
      s.circle(0.5, 0.45, 0.22, accent, stroke, LW * 0.7); s.circle(0.5, H - 0.45, 0.22, accent, stroke, LW * 0.7)
      break
    case 'console':
      s.rect(0.1, 0.5, 0.8, 0.35, fill, stroke, LW)          // desk
      s.rect(0.2, 0.15, 0.6, 0.3, accent, stroke, LW)        // screen
      s.line(0.3, 0.68, 0.7, 0.68, stroke, LW)               // keys
      break
    case 'chair':
      // An armchair from above. It was a round seat under a bar, and a reader
      // on r/Star_Wars_Maps (20 Oct) read the bridge chairs as toilets.
      s.rect(0.32, 0.36, 0.36, 0.4, fill, stroke, LW)        // seat
      s.rect(0.18, 0.34, 0.13, 0.4, accent, stroke, LW)      // arms
      s.rect(0.69, 0.34, 0.13, 0.4, accent, stroke, LW)
      s.rect(0.16, 0.16, 0.68, 0.18, fill, stroke, LW)       // backrest
      break
    case 'bunk':
      s.rect(0.15, 0.05, 0.7, 0.9, fill, stroke, LW)
      s.rect(0.22, 0.12, 0.56, 0.18, accent, stroke, LW)     // pillow
      s.line(0.15, 0.4, 0.85, 0.4, stroke, LW)
      break
    case 'table':
      s.rect(0.1, 0.28, 0.8, 0.44, fill, stroke, LW)
      break
    case 'crate':
      s.rect(0.15, 0.15, 0.7, 0.7, fill, stroke, LW)
      s.line(0.15, 0.15, 0.85, 0.85, stroke, LW * 0.7)
      s.line(0.85, 0.15, 0.15, 0.85, stroke, LW * 0.7)
      break
    case 'cryopod':
      s.rect(0.22, 0.05, 0.56, 0.9, fill, stroke, LW)
      s.circle(0.5, 0.3, 0.14, accent, stroke, LW)           // viewport
      s.line(0.22, 0.55, 0.78, 0.55, stroke, LW * 0.7)
      break
    case 'locker':
      s.rect(0.08, 0.3, 0.84, 0.4, fill, stroke, LW)
      s.line(0.36, 0.3, 0.36, 0.7, stroke, LW * 0.7)
      s.line(0.64, 0.3, 0.64, 0.7, stroke, LW * 0.7)
      break
    case 'reactor':
      s.circle(0.5, 0.5, 0.42, fill, stroke, LW)
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2
        s.line(0.5 + Math.cos(a) * 0.2, 0.5 + Math.sin(a) * 0.2, 0.5 + Math.cos(a) * 0.4, 0.5 + Math.sin(a) * 0.4, stroke, LW * 0.7)
      }
      s.circle(0.5, 0.5, 0.17, accent, stroke, LW)
      break
    case 'turret':
      s.rect(0.44, 0.02, 0.12, 0.5, fill, stroke, LW)        // barrel
      s.circle(0.5, 0.58, 0.3, fill, stroke, LW)
      s.circle(0.5, 0.58, 0.1, accent, stroke, LW * 0.7)
      break
    case 'medbed':
      s.rect(0.2, 0.05, 0.6, 0.9, fill, stroke, LW)
      s.line(0.5, 0.18, 0.5, 0.42, accent, LW * 1.6)         // cross
      s.line(0.38, 0.3, 0.62, 0.3, accent, LW * 1.6)
      break
    case 'ladder':
      s.line(0.3, 0.08, 0.3, 0.92, stroke, LW)
      s.line(0.7, 0.08, 0.7, 0.92, stroke, LW)
      for (let y = 0.2; y < 0.9; y += 0.17) s.line(0.3, y, 0.7, y, stroke, LW * 0.8)
      break
    case 'lift':
      s.rect(0.1, 0.1, 0.8, 0.8, fill, stroke, LW)
      s.poly([[0.5, 0.2], [0.34, 0.42], [0.66, 0.42]], accent, stroke, LW * 0.6)   // up
      s.poly([[0.5, 0.8], [0.34, 0.58], [0.66, 0.58]], accent, stroke, LW * 0.6)   // down
      break
    case 'stairs':
      s.rect(0.1, 0.1, 0.8, 0.8, fill, stroke, LW)
      for (let y = 0.26; y < 0.9; y += 0.16) s.line(0.1, y, 0.9, y, stroke, LW * 0.7)
      s.line(0.5, 0.85, 0.5, 0.2, accent, LW)
      s.poly([[0.5, 0.14], [0.4, 0.3], [0.6, 0.3]], accent)
      break
    case 'vent':
      s.rect(0.2, 0.2, 0.6, 0.6, fill, stroke, LW)
      for (let y = 0.32; y < 0.8; y += 0.12) s.line(0.26, y, 0.74, y, stroke, LW * 0.7)
      break
    case 'pillar':
      s.circle(0.5, 0.5, 0.24, stroke, stroke, LW)
      break
    case 'altar':
      s.rect(0.15, 0.2, W - 0.3, 0.6, fill, stroke, LW)
      s.rect(0.3, 0.32, W - 0.6, 0.36, accent, stroke, LW * 0.7)
      s.circle(0.55, 0.5, 0.07, stroke); s.circle(W - 0.55, 0.5, 0.07, stroke) // candles
      break
    case 'statue':
      s.rect(0.14, 0.14, 0.72, 0.72, fill, stroke, LW)       // plinth
      s.circle(0.5, 0.5, 0.2, accent, stroke, LW)            // the figure, from above
      s.circle(0.5, 0.5, 0.08, stroke)
      break
    case 'chest':
      s.rect(0.18, 0.28, 0.64, 0.44, fill, stroke, LW)
      s.line(0.18, 0.42, 0.82, 0.42, stroke, LW * 0.7)       // lid
      s.rect(0.44, 0.38, 0.12, 0.12, accent, stroke, LW * 0.6) // lock
      break
    case 'sarcophagus':
      s.poly([[0.2, 0.08], [0.8, 0.08], [0.86, 0.6], [0.72, H - 0.08], [0.28, H - 0.08], [0.14, 0.6]], fill, stroke, LW)
      s.circle(0.5, 0.36, 0.14, accent, stroke, LW * 0.7)    // carved head
      s.line(0.5, 0.56, 0.5, H - 0.3, stroke, LW * 0.6)
      break
    case 'well':
      s.circle(0.5, 0.5, 0.4, fill, stroke, LW)
      s.circle(0.5, 0.5, 0.26, stroke, stroke, LW)
      break
    case 'brazier':
      s.circle(0.5, 0.5, 0.26, fill, stroke, LW)
      s.circle(0.5, 0.5, 0.13, accent, stroke, LW * 0.6)
      for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2 + 0.5; s.line(0.5 + Math.cos(a) * 0.26, 0.5 + Math.sin(a) * 0.26, 0.5 + Math.cos(a) * 0.38, 0.5 + Math.sin(a) * 0.38, stroke, LW) }
      break
    case 'bookcase':
      s.rect(0.06, 0.1, W - 0.12, 0.34, fill, stroke, LW)
      for (let x = 0.22; x < W - 0.1; x += 0.16) s.line(x, 0.14, x, 0.4, stroke, LW * 0.5)
      break
    case 'barrel':
      s.circle(0.5, 0.5, 0.32, fill, stroke, LW)
      s.circle(0.5, 0.5, 0.18, undefined, stroke, LW * 0.6)
      break
    case 'rubble':
      s.poly([[0.12, 0.6], [0.3, 0.3], [0.5, 0.42], [0.42, 0.75]], fill, stroke, LW)
      s.poly([[0.5, 0.25], [0.75, 0.18], [0.85, 0.45], [0.6, 0.5]], fill, stroke, LW)
      s.poly([[0.55, 0.65], [0.8, 0.6], [0.78, 0.85], [0.6, 0.86]], accent, stroke, LW * 0.7)
      break
    case 'throne':
      s.rect(0.2, 0.1, 0.6, 0.24, accent, stroke, LW)        // high back
      s.rect(0.26, 0.34, 0.48, 0.44, fill, stroke, LW)       // seat
      s.rect(0.14, 0.3, 0.12, 0.5, accent, stroke, LW)
      s.rect(0.74, 0.3, 0.12, 0.5, accent, stroke, LW)
      break
    case 'bed':
      s.rect(0.15, 0.08, 0.7, H - 0.16, fill, stroke, LW)
      s.rect(0.24, 0.16, 0.52, 0.3, accent, stroke, LW)
      s.line(0.15, 0.7, 0.85, 0.7, stroke, LW * 0.7)         // turned-down blanket
      break
    case 'trapdoor':
      s.rect(0.18, 0.18, 0.64, 0.64, fill, stroke, LW)
      s.line(0.18, 0.5, 0.82, 0.5, stroke, LW * 0.6)
      s.circle(0.5, 0.66, 0.06, stroke)
      break
    case 'rack':
      s.rect(0.08, 0.12, W - 0.16, 0.2, fill, stroke, LW)
      for (let x = 0.3; x < W - 0.1; x += 0.35) s.line(x, 0.32, x - 0.08, 0.7, stroke, LW * 0.8) // spears leant on it
      break
    case 'bones':
      // crossed bones, a knob at each end, under a skull
      s.line(0.24, 0.5, 0.76, 0.88, stroke, LW)
      s.line(0.76, 0.5, 0.24, 0.88, stroke, LW)
      for (const [x, y] of [[0.24, 0.5], [0.76, 0.5], [0.24, 0.88], [0.76, 0.88]] as const) s.circle(x, y, 0.05, stroke)
      s.circle(0.5, 0.34, 0.17, fill, stroke, LW * 0.8)
      s.circle(0.44, 0.33, 0.035, stroke); s.circle(0.56, 0.33, 0.035, stroke)
      break
    case 'engine':
      s.rect(0.1, 0.1, 0.8, 0.8, fill, stroke, LW)
      s.circle(0.5, 0.45, 0.28, accent, stroke, LW)
      s.circle(0.5, 0.45, 0.1, fill, stroke, LW * 0.7)
      for (const x of [0.3, 0.5, 0.7]) s.line(x, 0.78, x, 0.92, stroke, LW * 0.8)
      break
  }
}

