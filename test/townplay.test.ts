import { describe, expect, it } from 'vitest';
import { parseBlock } from '../src/block';
import { renderTown, toString } from '../src/render';
import { generateTown } from '../src/town';
import { onTheWay, walk } from '../src/townplay';

describe('solo play in a town', () => {
	it('starts at place 1 and can walk to every place in the end', () => {
		for (const size of ['hamlet', 'town', 'city'] as const) {
			const t = generateTown({ seed: 'walk', size });
			let nums: number[] = [];
			for (let i = 0; i < t.places.length; i++) {
				const w = walk(t, nums);
				expect(w.seen.has(1)).toBe(true);
				if (w.seen.size === t.places.length) break;
				expect(w.ways.length).toBeGreaterThan(0);
				for (const n of w.ways) expect(w.seen.has(n)).toBe(false);
				nums = [...nums, w.ways[0]!];
			}
			expect(walk(t, nums).seen.size).toBe(t.places.length);
			expect(walk(t, nums).ways).toEqual([]);
		}
	});

	it('numbers only the places walked to, and marks the next ones', () => {
		const t = generateTown({ seed: 'walk', size: 'town' });
		const w = walk(t, []);
		const svg = toString(renderTown(t, { walked: w }));
		expect(svg.match(/class="mapsmith-badge"/g)).toHaveLength(1);
		expect(svg.match(/class="mapsmith-way"/g)).toHaveLength(w.ways.length);
		expect(svg.match(/data-place="(\d+)"/g)!.every((m) => m.endsWith('"0"'))).toBe(true);
		expect(toString(renderTown(t)).match(/class="mapsmith-badge"/g)).toHaveLength(t.places.length);
	});

	it('has the same thing on the way each time, and reads explore from a town block', () => {
		expect(onTheWay('a', 3)).toBe(onTheWay('a', 3));
		expect(new Set(['a', 'b', 'c', 'd', 'e', 'f'].map((s) => onTheWay(s, 2))).size).toBeGreaterThan(2);
		expect(parseBlock('seed: x\nexplore: 2, 5').explore).toEqual([2, 5]);
		expect(parseBlock('seed: x').explore).toBeNull();
	});
});
