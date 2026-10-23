// Copies the Crossfire Editor's user manual ($EDITOR_DIR/docs/manual/*.md) into
// src/content/docs/manual/ as Starlight pages (the folder is deleted and made again each run).
//
//   EDITOR_DIR=../odin_sdl_editor node scripts/sync-manual.mjs
//
// - README.md becomes index.md (/manual/); underscores in file names become dashes in slugs.
// - Frontmatter: title and description kept, `order: N` becomes `sidebar: { order: N }`, and
//   `editUrl` points at the file in the editor's repository.
// - The first `# Heading` is dropped when it repeats the title (Starlight shows the title).
// - Links: `foo_bar.md#x` becomes `../foo-bar/#x` (`./foo-bar/#x` from the index); other relative
//   links (repository files, images) become GitHub URLs in the editor's repository.
// - `<` before a letter in prose is escaped, so "<name>" isn't read as an HTML tag.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mapProse, escapeHtmlInProse, yamlString } from './lib/markdown.mjs';

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EDITOR_DIR = path.resolve(SITE, process.env.EDITOR_DIR ?? '../odin_sdl_editor');
const MANUAL_DIR = path.join(EDITOR_DIR, 'docs', 'manual');
const OUT_DIR = path.join(SITE, 'src', 'content', 'docs', 'manual');
const REPO = 'https://github.com/bcrowe306/crossfire-editor';
const BRANCH = 'main';

if (!fs.existsSync(MANUAL_DIR) || !fs.statSync(MANUAL_DIR).isDirectory()) {
	console.error(
		`sync-manual: the editor's manual isn't at ${MANUAL_DIR}.\n` +
			`Check out bcrowe306/crossfire-editor there, or set EDITOR_DIR to its folder (relative to ${SITE}).`,
	);
	process.exit(1);
}

const files = fs
	.readdirSync(MANUAL_DIR)
	.filter((f) => f.endsWith('.md'))
	.sort();
if (!files.includes('README.md')) {
	console.error(`sync-manual: ${MANUAL_DIR} has no README.md (the manual's index).`);
	process.exit(1);
}

/** The page's slug for a manual file name ('' for the index). */
const slugOf = (file) => (file === 'README.md' ? '' : path.basename(file, '.md').replaceAll('_', '-'));

fs.rmSync(OUT_DIR, { recursive: true, force: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

const problems = [];
for (const file of files) {
	const source = fs.readFileSync(path.join(MANUAL_DIR, file), 'utf8').replace(/\r\n/g, '\n');
	const { data, body } = parseFrontmatter(source, file);
	if (!data.title) problems.push(`${file}: no title in its frontmatter`);
	const isIndex = file === 'README.md';

	let text = body.replace(/^\n+/, '');
	// Starlight shows the title as the page's heading
	const h1 = /^#\s+(.+?)\s*#*\s*$/m.exec(text.split('\n', 1)[0]);
	if (h1 && normalize(h1[1]) === normalize(data.title ?? '')) text = text.slice(text.indexOf('\n') + 1).replace(/^\n+/, '');

	text = mapProse(text, (prose) => escapeHtmlInProse(rewriteLinks(prose, file, isIndex)));

	const fm = ['---', `title: ${yamlString(data.title ?? slugOf(file))}`];
	if (data.description) fm.push(`description: ${yamlString(data.description)}`);
	const order = Number(data.order);
	fm.push('sidebar:');
	if (isIndex) fm.push(`  label: "Overview"`);
	fm.push(`  order: ${Number.isFinite(order) ? order : 999}`);
	fm.push(`editUrl: ${yamlString(`${REPO}/edit/${BRANCH}/docs/manual/${file}`)}`);
	fm.push('---', '', '');

	const out = path.join(OUT_DIR, (isIndex ? 'index' : slugOf(file)) + '.md');
	fs.writeFileSync(out, fm.join('\n') + text.replace(/\s*$/, '\n'));
}

for (const p of problems) console.warn(`sync-manual: warning: ${p}`);
console.log(`sync-manual: ${files.length} pages from ${path.relative(SITE, MANUAL_DIR)} into ${path.relative(SITE, OUT_DIR)}`);

function normalize(s) {
	return s.replace(/[*_`]/g, '').trim().toLowerCase();
}

/** A tiny YAML subset: `key: value` lines (values optionally quoted). */
function parseFrontmatter(source, file) {
	const m = /^---\n([\s\S]*?)\n---\n?/.exec(source);
	if (!m) {
		problems.push(`${file}: no frontmatter`);
		return { data: {}, body: source };
	}
	const data = {};
	for (const line of m[1].split('\n')) {
		const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
		if (!kv) continue;
		let value = kv[2].trim();
		if (/^".*"$/.test(value)) value = JSON.parse(value);
		else if (/^'.*'$/.test(value)) value = value.slice(1, -1).replaceAll("''", "'");
		data[kv[1]] = value;
	}
	return { data, body: source.slice(m[0].length) };
}

/** Rewrites the relative targets of inline links and images in prose. */
function rewriteLinks(prose, file, isIndex) {
	// [text](target "title") and ![alt](target): the target is the first token in the parentheses
	return prose.replace(/(!?)\]\(\s*(<[^>]*>|[^\s)]+)([^)]*)\)/g, (all, bang, rawTarget, rest) => {
		const target = rawTarget.replace(/^<|>$/g, '');
		const rewritten = rewriteTarget(target, file, isIndex, bang === '!');
		return rewritten === target ? all : `${bang}](${rewritten}${rest})`;
	});
}

function rewriteTarget(target, file, isIndex, isImage) {
	if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#') || target.startsWith('/')) return target;
	const [pathPart, hash = ''] = target.split(/#(.*)/s);
	const anchor = hash ? `#${hash}` : '';
	const resolved = path.posix.normalize(path.posix.join('docs/manual', pathPart));
	const inManual = path.posix.dirname(resolved) === 'docs/manual' && resolved.endsWith('.md');
	if (inManual && !isImage) {
		const name = path.posix.basename(resolved);
		if (!files.includes(name)) problems.push(`${file}: link to a missing page ${target}`);
		const slug = slugOf(name);
		const base = isIndex ? './' : '../';
		return (slug ? `${base}${slug}/` : base) + anchor;
	}
	if (resolved.startsWith('..')) {
		problems.push(`${file}: link outside the editor's repository: ${target}`);
		return target;
	}
	const exists = fs.existsSync(path.join(EDITOR_DIR, resolved));
	if (!exists) problems.push(`${file}: link to a missing file ${target}`);
	const isDir = exists && fs.statSync(path.join(EDITOR_DIR, resolved)).isDirectory();
	if (isImage) return `https://raw.githubusercontent.com/bcrowe306/crossfire-editor/${BRANCH}/${resolved}`;
	return `${REPO}/${isDir ? 'tree' : 'blob'}/${BRANCH}/${resolved}${anchor}`;
}
