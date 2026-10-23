// The engine API reference: runs tools/docgen on the engine ($ENGINE_DIR) and writes Starlight
// pages into src/content/docs/api/ (deleted and made again each run): index.md (the package
// overview and the areas) and a page per area of scripts/api-groups.json.
//
//   ENGINE_DIR=../odin_sdl_engine node scripts/build-api.mjs
//
// docgen is built (odin build tools/docgen) when its binary is missing or older than its source.
// Its JSON is kept in src/data/generated/api.json.
//
// Each page: the area's description and its files' overviews, then `## Types`, `## Procedures`,
// `## Constants and variables`, a `### Name` per declaration (anchor: the name, lower-cased by
// Starlight) with its declaration (```odin nocheck: signatures aren't checked by
// check-examples.mjs), its doc comment as Markdown and a link to its source. Declarations keep the
// engine's source order (files in the area's order, then line order): each file is written to be
// read top to bottom (a type, its constructor, then its procedures), which alphabetical order
// would scatter (`CreateLine2D` far from `Line2D_SetPoints`).
//
// Inline code naming a public declaration (`Camera2D_Follow`, `e.Camera2D_Follow`) links to it.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mapProseText, escapeHtmlInProse, yamlString } from './lib/markdown.mjs';

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENGINE_DIR = path.resolve(SITE, process.env.ENGINE_DIR ?? '../odin_sdl_engine');
const OUT_DIR = path.join(SITE, 'src', 'content', 'docs', 'api');
const DATA_DIR = path.join(SITE, 'src', 'data', 'generated');
const DOCGEN_DIR = path.join(SITE, 'tools', 'docgen');
const DOCGEN = path.join(DOCGEN_DIR, process.platform === 'win32' ? 'docgen.exe' : 'docgen');
const REPO = 'https://github.com/bcrowe306/crossfire-engine';
const BRANCH = 'main';

const groups = JSON.parse(fs.readFileSync(path.join(SITE, 'scripts', 'api-groups.json'), 'utf8')).areas;

if (!fs.existsSync(path.join(ENGINE_DIR, 'doc.odin'))) {
	console.error(
		`build-api: the engine isn't at ${ENGINE_DIR} (no doc.odin).\n` +
			`Check out bcrowe306/crossfire-engine there, or set ENGINE_DIR to its folder (relative to ${SITE}).`,
	);
	process.exit(1);
}

// --- docgen -------------------------------------------------------------------------------------

function buildDocgen() {
	const sources = fs.readdirSync(DOCGEN_DIR).filter((f) => f.endsWith('.odin'));
	const newest = Math.max(...sources.map((f) => fs.statSync(path.join(DOCGEN_DIR, f)).mtimeMs));
	if (fs.existsSync(DOCGEN) && fs.statSync(DOCGEN).mtimeMs >= newest) return;
	console.log('build-api: building tools/docgen');
	execFileSync('odin', ['build', DOCGEN_DIR, `-out:${DOCGEN}`], { stdio: 'inherit' });
}

buildDocgen();
fs.mkdirSync(DATA_DIR, { recursive: true });
const jsonPath = path.join(DATA_DIR, 'api.json');
execFileSync(DOCGEN, [ENGINE_DIR, jsonPath], { stdio: ['ignore', 'inherit', 'inherit'] });
const api = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

// --- Files to areas -----------------------------------------------------------------------------

const areaOfFile = new Map();
const errors = [];
for (const g of groups) {
	for (const f of g.files) {
		if (areaOfFile.has(f)) errors.push(`${f} is in two areas: ${areaOfFile.get(f).slug} and ${g.slug}`);
		areaOfFile.set(f, g);
	}
}
const engineFiles = new Set(api.files.map((f) => f.file));
const unmapped = [...engineFiles].filter((f) => !areaOfFile.has(f));
const missing = [...areaOfFile.keys()].filter((f) => !engineFiles.has(f));
if (unmapped.length) errors.push(`engine files in no area (add them to scripts/api-groups.json): ${unmapped.join(', ')}`);
if (missing.length) errors.push(`files in scripts/api-groups.json that the engine doesn't have: ${missing.join(', ')}`);
if (errors.length) {
	for (const e of errors) console.error(`build-api: error: ${e}`);
	process.exit(1);
}

// Where each public name is documented, for links
const anchorOf = (name) => name.toLowerCase();
const declPage = new Map();
for (const f of api.files) for (const d of f.declarations) declPage.set(d.name, areaOfFile.get(f.file).slug);

// --- Markdown -----------------------------------------------------------------------------------

const sourceUrl = (file, line) => `${REPO}/blob/${BRANCH}/${file}${line ? `#L${line}` : ''}`;

const TYPE_KINDS = new Set(['struct', 'enum', 'union', 'bit_set', 'bit_field', 'distinct', 'type']);
const PROC_KINDS = new Set(['proc', 'proc_group']);
const KIND_LABEL = {
	proc: 'procedure',
	proc_group: 'procedure group',
	struct: 'struct',
	enum: 'enum',
	union: 'union',
	bit_set: 'bit_set',
	bit_field: 'bit_field',
	distinct: 'distinct type',
	type: 'type',
	constant: 'constant',
	variable: 'variable',
};

/** Prose (outside code spans) made safe, and code spans naming a declaration linked to it. */
function inline(text, pageSlug) {
	return mapProseText(
		text,
		(prose) => escapeHtmlInProse(prose).replace(/^(\s*)#/gm, '$1\\#'),
		(span) => {
			const m = /^`(?:e\.)?([A-Za-z]\w*)(\(\))?`$/.exec(span);
			if (!m || !declPage.has(m[1])) return span;
			const page = declPage.get(m[1]);
			const href = page === pageSlug ? `#${anchorOf(m[1])}` : `${pageSlug ? '../' : './'}${page}/#${anchorOf(m[1])}`;
			return `[${span}](${href})`;
		},
	);
}

const looksLikeOdin = (lines) => lines.some((l) => /::|:=|\bproc\b|\be\.\w|^\s*\w+\(.*\)\s*$/.test(l));

/**
 * A doc comment (Odin core style) as Markdown: paragraphs kept, `Inputs:` / `Returns:` lists with
 * bold names, the `Example:` block as a checked ```odin block, other tab-indented blocks as code.
 */
function docToMarkdown(doc, pageSlug) {
	if (!doc) return '';
	const lines = doc.split('\n');
	const out = [];
	let label = null; // the last `Label:` line, while its section runs
	let inList = false;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (line.startsWith('\t')) {
			// A tab-indented block: until a non-blank line that isn't indented
			const block = [];
			let j = i;
			for (; j < lines.length; j++) {
				if (lines[j].startsWith('\t')) block.push(lines[j]);
				else if (lines[j].trim() === '' && lines.slice(j + 1).find((l) => l.trim() !== '')?.startsWith('\t')) block.push('');
				else break;
			}
			i = j - 1;
			const code = dedent(block);
			const lang =
				label === 'Example'
					? 'odin'
					: code.find((l) => l.trim())?.trimStart().startsWith('<')
						? 'xml'
						: looksLikeOdin(code)
							? 'odin nocheck'
							: 'text';
			if (out.length && out[out.length - 1] !== '') out.push('');
			out.push('```' + lang, ...code, '```', '');
			inList = false;
			continue;
		}
		if (line.trim() === '') {
			out.push('');
			inList = false;
			if (label && label !== 'Inputs' && label !== 'Returns') label = null;
			continue;
		}
		const lab = /^([A-Z][A-Za-z ]*):\s*$/.exec(line);
		if (lab) {
			label = lab[1];
			if (out.length && out[out.length - 1] !== '') out.push('');
			out.push(`**${label}**`, '');
			inList = false;
			continue;
		}
		if (/^\s*[-*] /.test(line) || /^\s*\d+[.)] /.test(line)) {
			let item = line.trimStart();
			if (label === 'Inputs' || label === 'Returns') {
				item = item.replace(/^- ([\w.]+(?:, [\w.]+)*|\.\.\w+): /, (_, names) =>
					`- ${names.split(', ').map((n) => `**${n}**`).join(', ')}: `,
				);
			}
			const indent = /^\s*/.exec(line)[0].length > 0 && inList ? '  ' : '';
			out.push(indent + inline(item, pageSlug));
			inList = true;
			continue;
		}
		// Prose (continuation lines of a list item stay in it)
		out.push((inList ? '  ' : '') + inline(line.trim(), pageSlug));
		if (!(label === 'Inputs' || label === 'Returns')) label = label === 'Example' ? null : label;
	}
	return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Removes the leading tabs (and spaces) every non-blank line shares. */
function dedent(block) {
	const ws = block.filter((l) => l.trim()).map((l) => /^[\t ]*/.exec(l)[0]);
	let common = ws[0] ?? '';
	for (const w of ws) while (!w.startsWith(common)) common = common.slice(0, -1);
	return block.map((l) => (l.startsWith(common) ? l.slice(common.length) : l.trim()));
}

function frontmatter({ title, description, order, label }) {
	const fm = ['---', `title: ${yamlString(title)}`];
	if (description) fm.push(`description: ${yamlString(description)}`);
	fm.push('sidebar:');
	if (label) fm.push(`  label: ${yamlString(label)}`);
	fm.push(`  order: ${order}`);
	// Generated from the engine's source: no "Edit page" link into the site's repository
	fm.push('editUrl: false', '---', '', '');
	return fm.join('\n');
}

const fence = (lang, text) => {
	// A fence longer than any backtick run inside
	const runs = text.match(/`{3,}/g) ?? [];
	const ticks = '`'.repeat(Math.max(3, ...runs.map((r) => r.length + 1)));
	return `${ticks}${lang}\n${text}\n${ticks}`;
};

function buildTagNote(file) {
	const tags = file.buildTags.filter((t) => t.startsWith('build'));
	return tags.length ? tags.map((t) => `\`#+${t}\``).join(', ') : '';
}

function declMarkdown(d, file, slug) {
	const out = [`### ${d.name}`, ''];
	out.push(fence('odin nocheck', d.decl), '');
	const doc = docToMarkdown(d.doc, slug);
	if (doc) out.push(doc, '');
	const notes = [];
	if (d.when) notes.push(`declared when \`${d.when}\``);
	if (d.foreign) notes.push('a foreign (C) procedure');
	const tag = buildTagNote(file);
	if (tag) notes.push(`only in builds with ${tag}`);
	const src = `[Source: ${file.file}:${d.line}](${sourceUrl(file.file, d.line)})`;
	out.push(`<small>${KIND_LABEL[d.kind] ?? d.kind}${notes.length ? ', ' + notes.join(', ') : ''}. ${src}</small>`, '');
	return out.join('\n');
}

function areaPage(g) {
	const files = g.files.map((f) => api.files.find((x) => x.file === f));
	const out = [frontmatter({ title: g.title, description: g.description, order: g.order, label: g.label })];
	out.push(inline(g.description, g.slug), '');
	const fileList = files.map((f) => {
		const tag = buildTagNote(f);
		return `[\`${f.file}\`](${sourceUrl(f.file)})${tag ? ` (${tag})` : ''}`;
	});
	out.push(`Files: ${fileList.join(', ')}.`, '');

	const overviews = files.filter((f) => f.overview);
	if (overviews.length) {
		out.push('## File overviews', '');
		for (const f of overviews) {
			if (overviews.length > 1) out.push(`### ${f.file}`, '');
			else out.push(`From [\`${f.file}\`](${sourceUrl(f.file)}):`, '');
			out.push(docToMarkdown(f.overview, g.slug), '');
		}
	}

	const all = files.flatMap((f) => f.declarations.map((d) => ({ d, f })));
	const sections = [
		['Types', all.filter(({ d }) => TYPE_KINDS.has(d.kind))],
		['Procedures', all.filter(({ d }) => PROC_KINDS.has(d.kind))],
		['Constants and variables', all.filter(({ d }) => !TYPE_KINDS.has(d.kind) && !PROC_KINDS.has(d.kind))],
	];
	for (const [title, decls] of sections) {
		if (!decls.length) continue;
		out.push(`## ${title}`, '');
		for (const { d, f } of decls) out.push(declMarkdown(d, f, g.slug));
	}
	if (!all.length) out.push('These files declare nothing public.', '');
	return { markdown: out.join('\n').replace(/\n{3,}/g, '\n\n'), count: all.length };
}

// --- Pages --------------------------------------------------------------------------------------

fs.rmSync(OUT_DIR, { recursive: true, force: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

const counts = {};
for (const g of groups) {
	const { markdown, count } = areaPage(g);
	counts[g.slug] = count;
	fs.writeFileSync(path.join(OUT_DIR, `${g.slug}.md`), markdown);
}

const total = Object.values(counts).reduce((a, b) => a + b, 0);
const index = [
	frontmatter({
		title: 'Engine API reference',
		description: `Every public type, procedure and constant of the Crossfire Engine (package ${api.package}), from its doc comments.`,
		order: 0,
		label: 'Overview',
	}),
	`The Crossfire Engine's public API, generated from the doc comments in [its source](${REPO}) ` +
		`(package \`${api.package}\`, imported by games as \`import e "engine:."\`). ` +
		`${total} declarations in ${groups.length} areas.`,
	'',
	'## The package',
	'',
	docToMarkdown(api.packageOverview, ''),
	'',
	'## Areas',
	'',
	...groups.map((g) => `- [${g.title}](./${g.slug}/): ${inline(g.description, '')} (${counts[g.slug]})`),
	'',
].join('\n');
fs.writeFileSync(path.join(OUT_DIR, 'index.md'), index.replace(/\n{3,}/g, '\n\n'));

for (const e of api.errors ?? []) console.warn(`build-api: warning: docgen: ${e}`);
const undocumented = api.files.flatMap((f) => f.declarations.filter((d) => !d.doc).map((d) => `${f.file}:${d.line} ${d.name}`));
if (undocumented.length) console.warn(`build-api: ${undocumented.length} undocumented declarations:\n  ${undocumented.join('\n  ')}`);
console.log(`build-api: ${groups.length + 1} pages, ${total} declarations from ${api.files.length} files into ${path.relative(SITE, OUT_DIR)}`);
