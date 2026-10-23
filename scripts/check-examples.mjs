// Type-checks every ```odin block of the docs against the engine with `odin check`.
//
//   ENGINE_DIR=../odin_sdl_engine node scripts/check-examples.mjs [--verbose] [--keep]
//
// Pages: src/content/docs/{manual,api,getting-started,examples} (.md and .mdx; run `npm run docs`
// first for the generated ones). The engine is the `engine` collection (`import e "engine:."`).
//
// Blocks, by how they start:
// - ```odin nocheck: skipped (the API pages' declaration blocks are generated that way).
// - Code starting with `package <name>` (after comments) is a complete file:
//   - `package scripts`: a file of the page's game scripts package (below), as written, so the
//     other blocks on the page can use what it declares (assets, types).
//   - any other package: its own package, checked alone. Blocks on one page with a `title="dir/x.odin"`
//     meta in the same folder and the same package are files of one package.
// - Code with top-level declarations (a line at column 0 like `Name :: ...`, `@(...)`, `import`)
//   and no other statements at column 0: file-level code of the page's `scripts` package, in a
//   file of its own with the imports it uses added (e, sdl, fmt, math, linalg, log, strings...).
// - Anything else is statements: the body of a procedure in the page's scripts package, whose
//   locals (zero values, so a snippet may assign them) are the names a `// Given: a: T, b: U` line declares plus the defaults the engine's
//   docs assume when not given: self: ^e.Script (snippets "from a script"), scene: ^e.Scene,
//   game: ^e.Game, node: ^e.Node,
//   renderer: ^sdl.Renderer, dt: f64, deltaTime: f64, events: []sdl.Event (the body is a nested
//   block, so it may redeclare them).
//
// A page's scripts package holds all its file-level and statement blocks, so later blocks can use
// earlier blocks' types (a page building up a game). When a block declares a name an earlier block
// in the package already declared (a page showing a second version of `Player`), a new package
// starts there, seeded with copies of the earlier blocks that don't clash (copies aren't reported
// twice).
//
// Leniency: imports of the engine by relative path (`import e "../engine"`, "odin_sdl_engine")
// become "engine:." (the engine's docs still have some; reported with --verbose).
//
// Every package is imported by one root package, so a single `odin check` (with -json-errors)
// checks them all; errors are mapped back to blocks by file and line. Blocks with syntax errors
// (which stop the compiler before type checking) are taken out and the check runs again.
//
// Known-broken upstream examples can be listed in scripts/check-examples-allow.json:
//   [{ "page": "manual/foo.md", "match": "a line of the block", "reason": "why; fix upstream" }]
// They are reported as known and don't fail the run; an allowed block that passes is reported so
// its entry can go.
//
// The generated packages are in .examples-check/ (deleted each run unless --keep).

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { splitFences } from './lib/markdown.mjs';

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENGINE_DIR = path.resolve(SITE, process.env.ENGINE_DIR ?? '../odin_sdl_engine');
const EDITOR_DIR = path.resolve(SITE, process.env.EDITOR_DIR ?? '../odin_sdl_editor');
// The editor's plugin API (the manual's plugin examples import "plugin_api:.")
const PLUGIN_API = path.join(EDITOR_DIR, 'plugin_api');
const HAS_PLUGIN_API = fs.existsSync(PLUGIN_API);
const DOCS = path.join(SITE, 'src', 'content', 'docs');
const SECTIONS = ['manual', 'api', 'getting-started', 'examples'];
const WORK = path.join(SITE, '.examples-check');
const ALLOW_FILE = path.join(SITE, 'scripts', 'check-examples-allow.json');
const VERBOSE = process.argv.includes('--verbose');
const KEEP = process.argv.includes('--keep');

const DEFAULT_PARAMS = [
	['self', '^e.Script'],
	['scene', '^e.Scene'],
	['game', '^e.Game'],
	['node', '^e.Node'],
	['renderer', '^sdl.Renderer'],
	['dt', 'f64'],
	['deltaTime', 'f64'],
	['events', '[]sdl.Event'],
];

// A top-level declaration's first line
const DECL_LINE = /^(?:[A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*\s*::|@\(|@[a-z]|import\s|foreign\s|#\+)/;

// Imports added to generated files when the block uses the name
const IMPORTS = [
	['e', 'import e "engine:."'],
	['sdl', 'import sdl "vendor:sdl3"'],
	['fmt', 'import "core:fmt"'],
	['math', 'import "core:math"'],
	['linalg', 'import "core:math/linalg"'],
	['rand', 'import "core:math/rand"'],
	['log', 'import "core:log"'],
	['strings', 'import "core:strings"'],
	['strconv', 'import "core:strconv"'],
	['slice', 'import "core:slice"'],
	['mem', 'import "core:mem"'],
	['time', 'import "core:time"'],
	['json', 'import "core:encoding/json"'],
	['runtime', 'import "base:runtime"'],
	['os', 'import "core:os"'],
	['filepath', 'import "core:path/filepath"'],
	['b2', 'import b2 "engine:box2d"'],
	['mix', 'import mix "vendor:sdl3/mixer"'],
	...(HAS_PLUGIN_API ? [['api', 'import api "plugin_api:."']] : []),
];

if (!fs.existsSync(path.join(ENGINE_DIR, 'doc.odin'))) {
	console.error(`check-examples: the engine isn't at ${ENGINE_DIR}. Set ENGINE_DIR (relative to ${SITE}).`);
	process.exit(1);
}

// --- Blocks -------------------------------------------------------------------------------------

function pagesIn(dir) {
	if (!fs.existsSync(dir)) return [];
	return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
		const p = path.join(dir, d.name);
		if (d.isDirectory()) return pagesIn(p);
		return /\.mdx?$/.test(d.name) ? [p] : [];
	});
}

const blocks = [];
let skipped = 0;
for (const section of SECTIONS) {
	for (const file of pagesIn(path.join(DOCS, section)).sort()) {
		const page = path.relative(DOCS, file).split(path.sep).join('/');
		const parts = splitFences(fs.readFileSync(file, 'utf8'));
		for (const p of parts) {
			if (p.type !== 'fence') continue;
			const [lang, ...metaWords] = p.info.split(/\s+/);
			if (lang !== 'odin') continue;
			const meta = metaWords.join(' ');
			if (/(^|\s)nocheck(\s|$)/.test(meta)) {
				skipped++;
				continue;
			}
			const title = /title=(["'])(.*?)\1/.exec(meta)?.[2] ?? null;
			const code = dedent(p.body.map((l) => (l.startsWith(p.indent) ? l.slice(p.indent.length) : l)));
			blocks.push({ id: blocks.length, page, line: p.line, title, code, ...classify(code) });
		}
	}
}

function dedent(lines) {
	const ws = lines.filter((l) => l.trim()).map((l) => /^[\t ]*/.exec(l)[0]);
	let common = ws[0] ?? '';
	for (const w of ws) while (!w.startsWith(common)) common = common.slice(0, -1);
	return lines.map((l) => (l.startsWith(common) ? l.slice(common.length) : l.trimStart()));
}

/** The code without comments (line and block), for looking at its shape. */
function stripComments(lines) {
	let inBlock = 0;
	return lines.map((l) => {
		let out = '';
		for (let i = 0; i < l.length; i++) {
			if (inBlock) {
				if (l.startsWith('*/', i)) inBlock--, i++;
				else if (l.startsWith('/*', i)) inBlock++, i++;
				continue;
			}
			if (l.startsWith('//', i)) break;
			if (l.startsWith('/*', i)) {
				inBlock++, i++;
				continue;
			}
			if (l[i] === '"' || l[i] === '`') {
				const q = l[i];
				const j = l.indexOf(q, i + 1);
				out += l.slice(i, j < 0 ? l.length : j + 1);
				i = j < 0 ? l.length : j;
				continue;
			}
			out += l[i];
		}
		return out;
	});
}

function classify(code) {
	const bare = stripComments(code);
	const first = bare.find((l) => l.trim());
	if (first && /^package\s+\w+/.test(first.trim())) {
		return { kind: 'file', pkg: /^package\s+(\w+)/.exec(first.trim())[1], names: declaredNames(bare) };
	}
	const col0 = bare.filter((l) => /^\S/.test(l));
	const decls = col0.filter((l) => DECL_LINE.test(l));
	const others = col0.filter((l) => !DECL_LINE.test(l) && !/^[})\]]/.test(l));
	if (decls.length && !others.length) return { kind: 'decls', names: declaredNames(bare) };
	return { kind: 'stmts', names: [] };
}

function declaredNames(bare) {
	const names = [];
	for (const l of bare) {
		const m = /^([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\s*::/.exec(l);
		if (m) names.push(...m[1].split(',').map((s) => s.trim()).filter((n) => n !== '_'));
	}
	return names;
}

/** `// Given: a: T, b, c: U` as [[name, type]...] */
function givenParams(code) {
	const params = [];
	for (const line of code) {
		const m = /^\s*\/\/\s*Given:\s*(.*)$/.exec(line);
		if (!m) continue;
		// Split at top-level commas
		const parts = [];
		let depth = 0;
		let cur = '';
		for (const ch of m[1]) {
			if ('([{'.includes(ch)) depth++;
			if (')]}'.includes(ch)) depth--;
			if (ch === ',' && depth === 0) {
				parts.push(cur.trim());
				cur = '';
			} else cur += ch;
		}
		if (cur.trim()) parts.push(cur.trim());
		let pending = [];
		for (const part of parts) {
			const kv = /^([A-Za-z_]\w*)\s*:\s*(.+)$/.exec(part);
			if (kv) {
				for (const n of [...pending, kv[1]]) params.push([n, givenType(kv[2])]);
				pending = [];
			} else if (/^[A-Za-z_]\w*$/.test(part)) pending.push(part);
		}
	}
	return params;
}

/** The type at the start of a Given entry; words after it are commentary ("^e.Node (from X)", "^e.Sprite with Y"). */
function givenType(text) {
	const m = /^\s*((?:\^|\[\]|\[\d*\]|\[dynamic\]|\[\^\]|map\[[^\]]*\])*(?:proc\s*\([^)]*\)(?:\s*->\s*[\w.^\[\]]+)?|[A-Za-z_][\w.]*(?:\([^)]*\))?))/.exec(text);
	return m ? m[1].trim() : text.replace(/[.;]\s*$/, '');
}

function importsFor(text, own = []) {
	const ownNames = new Set(own);
	return IMPORTS.filter(([name]) => !ownNames.has(name) && new RegExp(`\\b${name}\\.`).test(text)).map(([, imp]) => imp);
}

/** Engine imports by relative path, made "engine:." */
const lenient = [];
function fixEngineImports(lines, block) {
	return lines.map((l) => {
		const m = /^(\s*import\s+\w+\s+)"((?:\.\.\/)*(?:engine|odin_sdl_engine|crossfire-engine))"/.exec(l);
		if (!m) return l;
		lenient.push(`${block.page}:${block.line}: import "${m[2]}" (use "engine:.")`);
		return l.replace(`"${m[2]}"`, '"engine:."');
	});
}

// --- Packages -----------------------------------------------------------------------------------

/** A package: its folder name, its package name and its files ({ name, lines, block, offset, copy }). */
const packages = [];
let pkgCounter = 0;
function newPackage(pkgName) {
	const dir = `p${String(++pkgCounter).padStart(4, '0')}`;
	// Package names must be unique in a build: each gets its folder's number
	const p = { dir, name: pkgName, ident: `${pkgName}_${dir}`, files: [], names: new Set() };
	packages.push(p);
	return p;
}

function fileFor(block, pkg, copy = false) {
	const code = fixEngineImports(block.code, block);
	const text = code.join('\n');
	const header = [`// ${block.page}:${block.line}${copy ? ' (copy for context)' : ''}`];
	let lines;
	let offset;
	if (block.kind === 'file') {
		// The block's own package line, renamed (same line count)
		let renamed = false;
		lines = code.map((l) => {
			if (renamed || !/^\s*package\s+\w+/.test(l)) return l;
			renamed = true;
			return l.replace(/package\s+\w+/, `package ${pkg.ident}`);
		});
		offset = 0;
		return { name: `b${block.id}.odin`, lines, block, offset, copy };
	}
	const ownImports = [...text.matchAll(/^import\s+(\w+)\s/gm)].map((m) => m[1]);
	const ownPathImports = [...text.matchAll(/^import\s+"[^"]*?([\w]+)"/gm)].map((m) => m[1]);
	const imports = importsFor(text, [...ownImports, ...ownPathImports]);
	if (block.kind === 'decls') {
		lines = [...header, `package ${pkg.ident}`, '', ...imports, ''];
		offset = lines.length;
		lines.push(...code);
	} else {
		const given = givenParams(code);
		const givenNames = new Set(given.map(([n]) => n));
		const params = [...given, ...DEFAULT_PARAMS.filter(([n]) => !givenNames.has(n))];
		const allImports = importsFor(text + ' e. sdl.', ownImports);
		lines = [
			...header,
			`package ${pkg.ident}`,
			'',
			...allImports,
			'',
			// Locals rather than parameters, so a snippet may assign to them
			`example_${block.id} :: proc() {`,
			...params.map(([n, t]) => `\t${n}: ${t}`),
			'{',
		];
		offset = lines.length;
		lines.push(...code, '}', '}');
	}
	return { name: `b${block.id}.odin`, lines, block, offset, copy };
}

const byPage = new Map();
// page -> name -> { cands, idx }: other pages' blocks declaring a name it needs (filled by the run)
const pageContext = new Map();
for (const b of blocks) {
	if (!byPage.has(b.page)) byPage.set(b.page, []);
	byPage.get(b.page).push(b);
}

function buildPackages(active) {
	packages.length = 0;
	pkgCounter = 0;
	for (const [, pageBlocks] of byPage) {
		const live = pageBlocks.filter((b) => active.has(b.id));
		// Complete files of other packages: alone, or grouped by title folder
		const groups = new Map();
		for (const b of live.filter((b) => b.kind === 'file' && b.pkg !== 'scripts')) {
			const key = b.title ? `${path.posix.dirname(b.title)}|${b.pkg}` : `#${b.id}`;
			if (!groups.has(key)) groups.set(key, newPackage(b.pkg));
			const p = groups.get(key);
			const f = fileFor(b, p);
			if (b.title) f.name = `${path.posix.basename(b.title, '.odin')}_${b.id}.odin`;
			p.files.push(f);
		}
		// The page's scripts package (split where a name is declared again)
		let current = null;
		const history = [];
		const pagePackages = new Set();
		for (const b of live.filter((b) => !(b.kind === 'file' && b.pkg !== 'scripts'))) {
			if (!current || b.names.some((n) => current.names.has(n))) {
				current = newPackage('scripts');
				// Earlier blocks that don't clash with this one, for context
				const clash = new Set(b.names);
				const seeded = new Set();
				for (let i = history.length - 1; i >= 0; i--) {
					const h = history[i];
					if (h.names.some((n) => clash.has(n) || seeded.has(n))) continue;
					h.names.forEach((n) => seeded.add(n));
					current.files.push(fileFor(h, current, true));
					h.names.forEach((n) => current.names.add(n));
				}
			}
			current.files.push(fileFor(b, current));
			b.names.forEach((n) => current.names.add(n));
			if (b.kind !== 'stmts') history.push(b);
			pagePackages.add(current);
		}
		// Blocks of other pages this page needs (see pageContext), where they don't clash
		for (const { cands, idx } of pageContext.get(live[0]?.page)?.values() ?? []) {
			const d = cands[idx];
			for (const p of pagePackages) {
				if (d.names.some((n) => p.names.has(n))) continue;
				p.files.push(fileFor(d, p, true));
				d.names.forEach((n) => p.names.add(n));
			}
		}
	}
}

function writePackages() {
	fs.rmSync(WORK, { recursive: true, force: true });
	fs.mkdirSync(path.join(WORK, 'root'), { recursive: true });
	const fileMap = new Map();
	for (const p of packages) {
		fs.mkdirSync(path.join(WORK, p.dir));
		for (const f of p.files) {
			const full = path.join(WORK, p.dir, f.name);
			fs.writeFileSync(full, f.lines.join('\n') + '\n');
			fileMap.set(full, f);
		}
	}
	fs.writeFileSync(
		path.join(WORK, 'root', 'root.odin'),
		['package examples_root', '', ...packages.map((p) => `import ${p.dir} "checks:${p.dir}"`), ''].join('\n'),
	);
	return fileMap;
}

function runCheck() {
	const r = spawnSync(
		'odin',
		[
			'check',
			path.join(WORK, 'root'),
			'-no-entry-point',
			`-collection:engine=${ENGINE_DIR}`,
			`-collection:checks=${WORK}`,
			...(HAS_PLUGIN_API ? [`-collection:plugin_api=${PLUGIN_API}`] : []),
			'-json-errors',
			'-max-error-count:100000',
		],
		{ encoding: 'utf8', maxBuffer: 1 << 28 },
	);
	if (r.error) throw r.error;
	const out = (r.stderr || '') + (r.stdout || '');
	const start = out.indexOf('{');
	let errors = [];
	if (start >= 0) {
		try {
			errors = JSON.parse(out.slice(start)).errors ?? [];
		} catch {
			errors = [{ pos: { file: '', line: 0 }, msgs: [out.trim()] }];
		}
	} else if (r.status !== 0) {
		errors = [{ pos: { file: '', line: 0 }, msgs: [out.trim() || `odin check exited with ${r.status}`] }];
	}
	return { status: r.status, errors };
}

// --- Run ----------------------------------------------------------------------------------------

const t0 = Date.now();
const active = new Set(blocks.map((b) => b.id));
let failures = new Map(); // block id -> { message, line, syntax }
let unattributed = [];
let runs = 0;

/** Checks every active block (again without syntax-error blocks, which stop the compiler). */
const syntaxFailures = new Map();
function checkAll() {
	failures = new Map(syntaxFailures);
	for (;;) {
		runs++;
		unattributed = [];
		buildPackages(active);
		const fileMap = writePackages();
		const { errors } = runCheck();
		for (const err of errors) {
			if (err.type === 'warning') continue;
			const f = fileMap.get(path.resolve(err.pos.file || ''));
			const msg = (err.msgs ?? []).join(' ').split('\n')[0].replace(/\s+/g, ' ');
			if (!f) {
				unattributed.push(`${err.pos.file}(${err.pos.line}): ${msg}`);
				continue;
			}
			if (f.copy) continue;
			const blockLine = err.pos.line - f.offset;
			if (!failures.has(f.block.id)) {
				failures.set(f.block.id, { message: msg, line: f.block.line + Math.max(1, blockLine), syntax: /Syntax Error/i.test(msg), all: [] });
			}
			failures.get(f.block.id).all.push(msg);
		}
		const syntaxBlocks = [...failures].filter(([id, f]) => active.has(id) && f.syntax).map(([id]) => id);
		if (!syntaxBlocks.length || runs >= 12) break;
		for (const id of syntaxBlocks) {
			active.delete(id);
			syntaxFailures.set(id, failures.get(id));
		}
	}
}

// Names a block uses that another page of its section declares (the manual's pages share one
// game: `Hero` from the physics page, assets from scripts/assets.odin): those blocks are added to
// the page's packages as context, and everything is checked again.
const definers = new Map(); // name -> blocks declaring it at file level
for (const b of blocks) {
	if (b.kind === 'stmts' || (b.kind === 'file' && b.pkg !== 'scripts')) continue;
	for (const n of b.names) {
		if (!definers.has(n)) definers.set(n, []);
		definers.get(n).push(b);
	}
}
checkAll();
// The name a failure is about, when it may come from missing context
const nameIn = (msg) =>
	/^Undeclared name: (\w+)/.exec(msg)?.[1] ?? /of type '\^?(\w+)' has no field/.exec(msg)?.[1] ?? /'(\w+)' is not a type/.exec(msg)?.[1];
for (let round = 0; round < 8; round++) {
	let changed = false;
	for (const [id, f] of failures) for (const message of f.all ?? [f.message]) {
		const name = nameIn(message);
		if (!name) continue;
		const b = blocks[id];
		const section = b.page.split('/')[0];
		if (!pageContext.has(b.page)) pageContext.set(b.page, new Map());
		const ctx = pageContext.get(b.page);
		const entry = ctx.get(name);
		if (!entry) {
			const cands = (definers.get(name) ?? []).filter((d) => d.page !== b.page && d.page.split('/')[0] === section);
			if (!cands.length) continue;
			ctx.set(name, { cands, idx: 0 });
			changed = true;
		} else if (!entry.tried?.has(round) && entry.idx + 1 < entry.cands.length) {
			// The one tried didn't do: the next page's definition
			entry.idx++;
			entry.tried = new Set([round]);
			changed = true;
		}
	}
	if (!changed) break;
	checkAll();
}

const allow = fs.existsSync(ALLOW_FILE) ? JSON.parse(fs.readFileSync(ALLOW_FILE, 'utf8')) : [];
const allowed = (b) => allow.find((a) => a.page === b.page && b.code.some((l) => l.includes(a.match)));
const failing = [];
const known = [];
const stale = [];
for (const b of blocks) {
	const f = failures.get(b.id);
	const a = allowed(b);
	if (f && a) known.push({ b, f, a });
	else if (f) failing.push({ b, f });
	else if (a) stale.push({ b, a });
}

const counts = { manual: 0, api: 0, 'getting-started': 0, examples: 0 };
for (const b of blocks) counts[b.page.split('/')[0]]++;
console.log(
	`check-examples: ${blocks.length} blocks (${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ')}; ` +
		`${skipped} nocheck skipped) in ${packages.length} packages, ${runs} odin check run(s), ${((Date.now() - t0) / 1000).toFixed(1)} s`,
);
for (const { b, f } of failing) console.log(`FAIL src/content/docs/${b.page}:${f.line}: ${f.message}`);
for (const { b, f, a } of known) {
	if (VERBOSE) console.log(`known src/content/docs/${b.page}:${f.line}: ${f.message} (allowed: ${a.reason})`);
}
for (const { b, a } of stale) console.log(`passes now, remove from check-examples-allow.json: ${b.page} "${a.match}"`);
// Errors outside the blocks (in the runtime's generics, say) follow from a failing block's
// undeclared type: notes when some block failed, errors otherwise
for (const u of unattributed) console.log(`${failures.size ? 'note (follows from a failing block)' : 'ERROR (not in a block)'}: ${u}`);
if (VERBOSE) for (const l of lenient) console.log(`lenient: ${l}`);
console.log(
	`check-examples: ${blocks.length - failing.length - known.length} passed, ${failing.length} failed, ${known.length} known failures (allow list)`,
);
const failed = failing.length > 0 || (unattributed.length > 0 && failures.size === 0);
if (!KEEP && !failed) fs.rmSync(WORK, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
