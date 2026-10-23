// The latest editor release, for the Download page: src/data/generated/release.json.
//
// Where it comes from, in order:
// 1. downloads.crossfireengine.io/latest.json, which the editor's release workflow writes to R2
//    with the files it uploaded (their URLs are R2's).
// 2. GitHub's releases API for bcrowe306/crossfire-editor (pre-releases included; set GITHUB_TOKEN
//    to avoid its rate limit), when R2 has none yet. The files then link to GitHub.
// 3. A file left by an earlier run, or one saying there's no release, so the site still builds
//    offline.
//
// Each file is sorted into a platform (linux, windows, macos) and a kind (installer, archive,
// appimage, dmg) by its name.

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';

const OUT = 'src/data/generated/release.json';
const DOWNLOADS = process.env.DOWNLOADS_HOST ?? 'https://downloads.crossfireengine.io';
const REPO = 'bcrowe306/crossfire-editor';

// What a release file is, by its name
export function describe(name) {
	const n = name.toLowerCase();
	if (n.endsWith('.appimage')) return { platform: 'linux', kind: 'appimage', label: 'AppImage', note: 'Runs on most distributions: make it executable and run it' };
	if (n.includes('linux') && n.endsWith('.tar.gz')) return { platform: 'linux', kind: 'archive', label: 'tar.gz', note: 'Unpack anywhere and run crossfire-editor' };
	if (n.includes('windows') && n.endsWith('-setup.exe')) return { platform: 'windows', kind: 'installer', label: 'Installer', note: 'Installs for you, with a Start menu entry' };
	if (n.includes('windows') && n.endsWith('.zip')) return { platform: 'windows', kind: 'archive', label: 'Zip', note: 'Unzip anywhere and run crossfire-editor.exe' };
	if (n.endsWith('.dmg')) return { platform: 'macos', kind: 'dmg', label: 'Disk image', note: 'Apple Silicon. Drag to Applications; the first time, right-click > Open' };
	return null;
}

async function fromR2() {
	const res = await fetch(`${DOWNLOADS}/latest.json`, { headers: { 'cache-control': 'no-cache' } });
	if (!res.ok) throw new Error(`latest.json: HTTP ${res.status}`);
	const data = await res.json();
	return {
		tag: data.tag,
		date: data.date,
		notes: data.notes ?? `https://github.com/${REPO}/releases/tag/${data.tag}`,
		prerelease: data.prerelease ?? data.tag.includes('-'),
		source: 'r2',
		files: data.files
			.map((f) => ({ ...f, url: f.url ?? `${DOWNLOADS}/releases/${data.tag}/${f.name}`, ...describe(f.name) }))
			.filter((f) => f.platform),
	};
}

async function fromGitHub() {
	const headers = { accept: 'application/vnd.github+json' };
	if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
	const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=10`, { headers });
	if (!res.ok) throw new Error(`GitHub releases: HTTP ${res.status}`);
	const releases = (await res.json()).filter((r) => !r.draft && r.assets.length > 0);
	if (releases.length === 0) throw new Error('no published release with files');
	const r = releases[0];
	return {
		tag: r.tag_name,
		date: r.published_at,
		notes: r.html_url,
		prerelease: r.prerelease,
		source: 'github',
		files: r.assets
			.map((a) => ({ name: a.name, size: a.size, url: a.browser_download_url, ...describe(a.name) }))
			.filter((f) => f.platform),
	};
}

let release = null;
for (const [name, get] of [['R2', fromR2], ['GitHub', fromGitHub]]) {
	try {
		release = await get();
		console.log(`release-info: ${release.tag} from ${name} (${release.files.length} files)`);
		break;
	} catch (err) {
		console.warn(`release-info: ${name}: ${err.message}`);
	}
}

mkdirSync('src/data/generated', { recursive: true });
if (release) {
	writeFileSync(OUT, JSON.stringify(release, null, '\t') + '\n');
} else if (!existsSync(OUT)) {
	writeFileSync(OUT, JSON.stringify({ tag: null, files: [] }, null, '\t') + '\n');
	console.warn('release-info: no release found; the Download page says so');
} else {
	console.warn('release-info: keeping the earlier release.json');
}
