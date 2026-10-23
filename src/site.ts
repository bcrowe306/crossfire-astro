// What the whole site shares: its pages, its repositories, where downloads live.

export const SITE_LINKS = [
	{ label: 'Docs', href: '/getting-started/' },
	{ label: 'Download', href: '/download/' },
	{ label: 'About', href: '/about/' },
	{ label: 'Contribute', href: '/contribute/' },
];

export const REPOS = {
	editor: 'https://github.com/bcrowe306/crossfire-editor',
	engine: 'https://github.com/bcrowe306/crossfire-engine',
	website: 'https://github.com/bcrowe306/crossfire-astro',
	skald: 'https://github.com/bcrowe306/Skald',
};

export const ISSUES = `${REPOS.editor}/issues`;

// Release files: R2, served from this host (scripts/release-info.mjs reads latest.json there)
export const DOWNLOADS_HOST = 'https://downloads.crossfireengine.io';
