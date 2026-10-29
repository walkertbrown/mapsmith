import obsidianmd from 'eslint-plugin-obsidianmd';
import tseslint from 'typescript-eslint';
import { DEFAULT_BRANDS } from 'eslint-plugin-obsidianmd/dist/lib/rules/ui/brands.js';

export default tseslint.config(
	{ ignores: ['main.js', 'node_modules/**', 'test/**'] },
	...obsidianmd.configs.recommended,
	{
		files: ['src/**/*.ts'],
		languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
		// the plugin's own name
		rules: { 'obsidianmd/ui/sentence-case': ['warn', { brands: [...DEFAULT_BRANDS, 'Mapsmith'] }] },
	},
);
