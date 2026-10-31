// Which painted textures go where. The pictures themselves are in textures.ts.

import type { DungeonKind } from './dungeon';
import type { Paint } from './ship/svg';
import type { TownPaint } from './render';
import { CAVE, COBBLE, GRASS, ROCK, STONE, WATER, WOOD } from './textures';

const DIM = 0.38;

export function dungeonPaint(kind: DungeonKind, dark: boolean): Paint {
	const dim = dark ? DIM : 0;
	if (kind === 'keep') return { floor: STONE, byTint: { 8: CAVE }, around: GRASS, dim };
	return { floor: kind === 'mine' ? CAVE : STONE, around: ROCK, sunk: true, dim };
}

/** a building's floors are boards, and a cellar's are stone with rock round it */
export function buildingPaint(cellar: boolean, dark: boolean): Paint {
	const dim = dark ? DIM : 0;
	return cellar ? { floor: STONE, around: ROCK, sunk: true, dim } : { floor: WOOD, around: COBBLE, dim };
}

export function townPaint(dark: boolean): TownPaint {
	return { grass: GRASS, cobble: COBBLE, water: WATER, strength: dark ? 0.45 : 1 };
}
