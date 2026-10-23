// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// The site: a hand-built landing, About, Download and Contribute (src/pages), and the docs
// (Starlight: src/content/docs). The manual and the engine API reference are generated from the
// engine's and editor's repositories at build time (scripts/sync-manual.mjs, scripts/build-api.mjs).
// A static site: Cloudflare Pages serves dist/ (no adapter).
export default defineConfig({
	site: 'https://crossfireengine.io',
	integrations: [
		starlight({
			title: 'Crossfire',
			description:
				'A 2D game engine and editor written entirely in Odin: scenes, physics, particles, lighting, tilemaps, scripting and exports to desktop and the web.',
			logo: { src: './src/assets/logo.png', alt: 'Crossfire' },
			favicon: '/favicon.png',
			customCss: [
				'@fontsource/chakra-petch/600.css',
				'@fontsource/chakra-petch/700.css',
				'@fontsource-variable/inter',
				'@fontsource-variable/jetbrains-mono',
				'./src/styles/theme.css',
			],
			social: [
				{ icon: 'github', label: 'GitHub', href: 'https://github.com/bcrowe306/crossfire-editor' },
			],
			editLink: { baseUrl: 'https://github.com/bcrowe306/crossfire-astro/edit/main/' },
			lastUpdated: true,
			components: {
				// The site's own links (Download, About, Contribute) beside the social icons
				SocialIcons: './src/components/HeaderLinks.astro',
				Footer: './src/components/DocsFooter.astro',
			},
			expressiveCode: {
				themes: ['github-dark-default', 'github-light-default'],
				styleOverrides: { borderRadius: '0', codeFontFamily: "'JetBrains Mono Variable', monospace" },
			},
			sidebar: [
				{ label: 'Getting started', items: [{ autogenerate: { directory: 'getting-started' } }] },
				{ label: 'Examples', items: [{ autogenerate: { directory: 'examples' } }] },
				{ label: 'Editor manual', items: [{ autogenerate: { directory: 'manual' } }] },
				{ label: 'Engine API', collapsed: true, items: [{ autogenerate: { directory: 'api' } }] },
			],
		}),
	],
});
