// Small Markdown helpers shared by the docs scripts (sync-manual.mjs, build-api.mjs,
// check-examples.mjs). Plain string work, no dependencies.

/**
 * Splits Markdown into fenced code blocks and the text between them.
 * Returns [{ type: 'text', text }, { type: 'fence', open, info, body, close, line }] where `line`
 * is the 1-based line of the opening fence in the input.
 */
export function splitFences(markdown) {
	const lines = markdown.split('\n');
	const parts = [];
	let text = [];
	for (let i = 0; i < lines.length; i++) {
		const m = /^(\s*)(`{3,}|~{3,})(.*)$/.exec(lines[i]);
		if (!m) {
			text.push(lines[i]);
			continue;
		}
		const [, indent, marker, info] = m;
		const body = [];
		let j = i + 1;
		let close = null;
		for (; j < lines.length; j++) {
			const c = /^(\s*)(`{3,}|~{3,})\s*$/.exec(lines[j]);
			if (c && c[2][0] === marker[0] && c[2].length >= marker.length) {
				close = lines[j];
				break;
			}
			body.push(lines[j]);
		}
		if (text.length) parts.push({ type: 'text', text: text.join('\n') });
		text = [];
		parts.push({ type: 'fence', open: lines[i], indent, marker, info: info.trim(), body, close, line: i + 1 });
		i = close === null ? lines.length : j;
	}
	if (text.length) parts.push({ type: 'text', text: text.join('\n') });
	return parts;
}

/** Joins what splitFences returned (after changes to the text parts). */
export function joinFences(parts) {
	return parts
		.map((p) =>
			p.type === 'text' ? p.text : [p.open, ...p.body, ...(p.close === null ? [] : [p.close])].join('\n'),
		)
		.join('\n');
}

/**
 * Runs `transform` over the prose of a Markdown text (not fenced code, not inline code spans),
 * returning the text with the prose replaced. Code spans follow CommonMark: a run of N backticks
 * closes at the next run of exactly N; an unclosed run is literal.
 */
export function mapProse(markdown, transform, spanTransform = (span) => span) {
	return joinFences(
		splitFences(markdown).map((p) =>
			p.type === 'text' ? { ...p, text: mapProseText(p.text, transform, spanTransform) } : p,
		),
	);
}

/** Like mapProse, for text known to have no fences. `spanTransform` gets each code span, backticks included. */
export function mapProseText(text, transform, spanTransform = (span) => span) {
	let out = '';
	let prose = '';
	let i = 0;
	while (i < text.length) {
		if (text[i] === '`') {
			let n = 0;
			while (text[i + n] === '`') n++;
			const run = '`'.repeat(n);
			// The closing run: exactly n backticks
			let j = i + n;
			let close = -1;
			while (j < text.length) {
				const k = text.indexOf(run, j);
				if (k < 0) break;
				let m = 0;
				while (text[k + m] === '`') m++;
				if (m === n) {
					close = k;
					break;
				}
				j = k + m;
			}
			if (close < 0) {
				prose += run;
				i += n;
				continue;
			}
			out += transform(prose) + spanTransform(text.slice(i, close + n));
			prose = '';
			i = close + n;
			continue;
		}
		prose += text[i++];
	}
	return out + transform(prose);
}

/** Escapes what Markdown would read as HTML in prose: `<` before a letter, `/`, `!` or `?` (autolinks kept). */
export function escapeHtmlInProse(prose) {
	return prose.replace(/<(?!https?:\/\/[^>\s]*>)(?=[A-Za-z/!?])/g, '&lt;');
}

/** A YAML scalar: JSON strings are valid YAML. */
export function yamlString(s) {
	return JSON.stringify(String(s));
}
