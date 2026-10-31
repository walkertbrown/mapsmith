// Which painted textures go where. The pictures themselves are in textures.ts.

import type { DungeonKind } from './dungeon';
import { SHIP_LIGHT, type Paint, type ShipPalette } from './ship/svg';
import type { TownPaint } from './render';
import { BAY, CAVE, COBBLE, GRASS, GRATE, PLATE, ROCK, STONE, WATER, WOOD } from './textures';

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

/** A ship in steel: plated rooms, grated corridors, heavy plate in the engine rooms and holds, out in black space. */
export function shipPainted(dark: boolean): ShipPalette {
	const paint: Paint = { floor: PLATE, corridor: GRATE, byTint: { 3: BAY, 6: BAY }, space: true, dim: dark ? 0.3 : 0, fittings: { stroke: '#15191e', fill: '#7d8793', accent: '#4e5761' } };
	return {
		...SHIP_LIGHT,
		bg: '#05070d', floor: '#c9ced4', corridor: '#9aa1a9', grid: 'rgba(10,14,20,0.22)',
		wall: '#1b1f24', hull: '#b9c3ce', door: '#e0a030', airlock: '#e0603a', hatch: '#e0a030', window: '#8fd0ff',
		text: '#0e1216', badge: '#fffaf0', badgeInk: '#7a2e1f',
		paint,
	};
}
