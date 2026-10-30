import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// `obsidian` ships types only; tests run main.ts against the shim in test/.
export default defineConfig({
	resolve: { alias: { obsidian: fileURLToPath(new URL('./test/obsidian-shim.ts', import.meta.url)) } },
	// the tests that generate dozens of maps take a few seconds, longer when the machine is busy
	test: { environment: 'node', testTimeout: 30000 },
});
