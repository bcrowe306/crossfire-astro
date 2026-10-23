/*
docgen: the engine's public API as JSON, for the site's API reference (scripts/build-api.mjs).

	docgen <engine folder> <output.json>

Parses every `.odin` file at the top level of the engine folder (not `_test.odin` files, not
subfolders) with `core:odin/parser`, keeping comments, and writes for each file its build tags,
its overview (the first `/* */` block after the package line and imports that isn't attached to a
declaration; doc.odin's block above `package` is the package overview) and every public
top-level declaration: name, kind, line, doc comment (markers stripped, indentation normalized)
and declaration text (procedures: the signature only; types: the whole definition with its field
comments; constants and variables: their value).

Private declarations (`@(private)`, `@(private="file")`, `@(private="package")`, a foreign block's
`private`, a `#+private` file) and names starting with `_` are skipped.
*/
package main

import "core:encoding/json"
import "core:fmt"
import "core:odin/ast"
import "core:odin/parser"
import "core:odin/tokenizer"
import "core:os"
import "core:slice"
import "core:strings"

// A declaration in the JSON
Decl :: struct {
	name: string,
	// proc, proc_group, struct, enum, union, bit_set, bit_field, distinct, type, constant, variable
	kind: string,
	line: int,
	doc:  string,
	decl: string,
	// The `when` condition it's declared under ("" if none)
	when_cond: string `json:"when"`,
	// Declared in a `foreign` block
	in_foreign: bool `json:"foreign"`,
}

// A file in the JSON
File_Doc :: struct {
	file:       string,
	build_tags: []string `json:"buildTags"`,
	overview:   string,
	decls:      []Decl `json:"declarations"`,
}

Output :: struct {
	package_name:     string `json:"package"`,
	package_overview: string `json:"packageOverview"`,
	files:            []File_Doc,
	// Parse errors (the file is still documented as far as it parsed)
	errors:           []string,
}

MAX_CONSTANT_LINES :: 60

errors: [dynamic]string

parse_error :: proc(pos: tokenizer.Pos, msg: string, args: ..any) {
	append(&errors, fmt.aprintf("%s(%d:%d): %s", pos.file, pos.line, pos.column, fmt.aprintf(msg, ..args)))
}

parse_warning :: proc(pos: tokenizer.Pos, msg: string, args: ..any) {}

main :: proc() {
	if len(os.args) != 3 {
		fmt.eprintln("usage: docgen <engine folder> <output.json>")
		os.exit(2)
	}
	dir := os.args[1]
	out_path := os.args[2]

	infos, err := os.read_all_directory_by_path(dir, context.allocator)
	if err != nil {
		fmt.eprintfln("docgen: can't read %s: %v", dir, err)
		os.exit(1)
	}
	names: [dynamic]string
	for info in infos {
		if info.type != .Regular do continue
		if !strings.has_suffix(info.name, ".odin") || strings.has_suffix(info.name, "_test.odin") do continue
		append(&names, info.name)
	}
	slice.sort(names[:])
	if len(names) == 0 {
		fmt.eprintfln("docgen: no .odin files in %s", dir)
		os.exit(1)
	}

	out: Output
	files: [dynamic]File_Doc
	for name in names {
		path := strings.concatenate({dir, "/", name})
		src, rerr := os.read_entire_file(path, context.allocator)
		if rerr != nil {
			fmt.eprintfln("docgen: can't read %s: %v", path, rerr)
			os.exit(1)
		}
		file := ast.new(ast.File, tokenizer.Pos{}, tokenizer.Pos{})
		file.src = string(src)
		file.fullpath = path
		p := parser.default_parser()
		p.err = parse_error
		p.warn = parse_warning
		if !parser.parse_file(&p, file) {
			fmt.eprintfln("docgen: %s didn't parse", path)
		}
		if out.package_name == "" && file.pkg_decl != nil do out.package_name = file.pkg_decl.name
		if name == "doc.odin" && file.docs != nil {
			out.package_overview = comment_text(file.docs)
		}
		append(&files, document_file(file, name))
	}
	out.files = files[:]
	out.errors = errors[:]

	data, merr := json.marshal(out, {pretty = true, use_spaces = true, spaces = 1})
	if merr != nil {
		fmt.eprintfln("docgen: %v", merr)
		os.exit(1)
	}
	if werr := os.write_entire_file(out_path, data); werr != nil {
		fmt.eprintfln("docgen: can't write %s: %v", out_path, werr)
		os.exit(1)
	}
	for e in errors do fmt.eprintln("docgen: parse error:", e)
}

document_file :: proc(file: ^ast.File, name: string) -> File_Doc {
	fd := File_Doc{file = name}
	tags: [dynamic]string
	file_private := false
	for t in file.tags {
		text := strings.trim_space(strings.trim_prefix(t.text, "#+"))
		append(&tags, text)
		if text == "private" || strings.has_prefix(text, "private ") do file_private = true
	}
	fd.build_tags = tags[:]

	// Every comment group attached to a declaration, so the overview isn't one of them
	attached: map[^ast.Comment_Group]bool
	decls: [dynamic]Decl
	first_decl_line := max(int)
	for stmt in file.decls {
		#partial switch d in stmt.derived {
		case ^ast.Import_Decl, ^ast.Foreign_Import_Decl:
			continue
		}
		first_decl_line = min(first_decl_line, stmt.pos.line)
		collect(file, stmt, "", false, file_private, &decls, &attached)
	}
	fd.decls = decls[:]

	// The overview: the first /* */ block after the package line, before the first declaration
	// (or anywhere before it), not attached to a declaration
	for group in file.comments {
		if group == file.docs do continue
		if len(group.list) == 0 || group.pos.offset < file.pkg_decl.end.offset do continue
		if group.pos.line > first_decl_line do break
		if attached[group] do break
		if !strings.has_prefix(group.list[0].text, "/*") do continue
		fd.overview = comment_text(group)
		break
	}
	return fd
}

// Documents one top-level statement (recursing into `when` and `foreign` blocks)
collect :: proc(file: ^ast.File, stmt: ^ast.Stmt, when_cond: string, foreign_block: bool, file_private: bool, decls: ^[dynamic]Decl, attached: ^map[^ast.Comment_Group]bool) {
	#partial switch d in stmt.derived {
	case ^ast.When_Stmt:
		cond := source(file, d.cond.pos.offset, d.cond.end.offset)
		if when_cond != "" do cond = fmt.aprintf("(%s) && (%s)", when_cond, cond)
		collect(file, d.body, cond, foreign_block, file_private, decls, attached)
		if d.else_stmt != nil {
			collect(file, d.else_stmt, fmt.aprintf("!(%s)", cond), foreign_block, file_private, decls, attached)
		}
	case ^ast.Block_Stmt:
		for s in d.stmts do collect(file, s, when_cond, foreign_block, file_private, decls, attached)
	case ^ast.Foreign_Block_Decl:
		if d.docs != nil do attached[d.docs] = true
		if is_private(d.attributes[:]) do return
		if d.body != nil do collect(file, d.body, when_cond, true, file_private, decls, attached)
	case ^ast.Value_Decl:
		docs := d.docs
		if docs == nil do docs = docs_above(file, d)
		if docs != nil do attached[docs] = true
		if file_private || is_private(d.attributes[:]) do return
		for name_expr, i in d.names {
			ident, ok := name_expr.derived.(^ast.Ident)
			if !ok do continue
			name := ident.name
			if strings.has_prefix(name, "_") do continue
			value: ^ast.Expr
			if i < len(d.values) do value = d.values[i]
			else if len(d.values) == 1 do value = d.values[0]
			decl := Decl {
				name      = name,
				line      = ident.pos.line,
				when_cond = when_cond,
				in_foreign = foreign_block,
			}
			if docs != nil do decl.doc = comment_text(docs)
			decl.kind, decl.decl = describe(file, d, ident, value)
			append(decls, decl)
		}
	}
}

// The comment group ending on the line above a declaration (or its attributes), when the parser
// didn't attach it
docs_above :: proc(file: ^ast.File, d: ^ast.Value_Decl) -> ^ast.Comment_Group {
	line := d.pos.line
	for a in d.attributes do line = min(line, a.pos.line)
	for group in file.comments {
		if group.end.line == line - 1 do return group
		if group.pos.line >= line do break
	}
	return nil
}

is_private :: proc(attributes: []^ast.Attribute) -> bool {
	for attr in attributes {
		for elem in attr.elems {
			#partial switch e in elem.derived {
			case ^ast.Ident:
				if e.name == "private" do return true
			case ^ast.Field_Value:
				if id, ok := e.field.derived.(^ast.Ident); ok && id.name == "private" do return true
			}
		}
	}
	return false
}

// The kind and declaration text of one name of a value declaration
describe :: proc(file: ^ast.File, d: ^ast.Value_Decl, ident: ^ast.Ident, value: ^ast.Expr) -> (kind: string, text: string) {
	start := ident.pos.offset
	if len(d.names) > 1 {
		// `a, b :: ...`: the whole declaration
		start = d.names[0].pos.offset
	}
	end := d.end.offset
	if value != nil do end = max(end, value.end.offset)

	if d.is_mutable {
		kind = "variable"
	} else if value == nil {
		kind = "constant"
	} else {
		kind = value_kind(ident.name, value)
	}

	if kind == "proc" {
		lit := value.derived.(^ast.Proc_Lit)
		end = lit.type.end.offset
		if lit.type.results != nil do end = max(end, lit.type.results.end.offset)
		for w in lit.where_clauses do end = max(end, w.end.offset)
		if lit.body == nil {
			// A foreign procedure: `Name :: proc(...) ---`
			end = value.end.offset
		}
	}
	text = strings.trim_right_space(source(file, start, end))
	if kind == "proc" && strings.has_suffix(text, "---") do text = strings.trim_right_space(text[:len(text) - 3])
	if kind == "constant" || kind == "variable" {
		lines := strings.split_lines(text)
		if len(lines) > MAX_CONSTANT_LINES {
			text = fmt.aprintf("%s\n\t// ... %d more lines (see the source)", strings.join(lines[:MAX_CONSTANT_LINES], "\n"), len(lines) - MAX_CONSTANT_LINES)
		}
	}
	return
}

value_kind :: proc(name: string, value: ^ast.Expr) -> string {
	#partial switch v in value.derived {
	case ^ast.Proc_Lit:
		return "proc"
	case ^ast.Proc_Group:
		return "proc_group"
	case ^ast.Struct_Type:
		return "struct"
	case ^ast.Enum_Type:
		return "enum"
	case ^ast.Union_Type:
		return "union"
	case ^ast.Bit_Set_Type:
		return "bit_set"
	case ^ast.Bit_Field_Type:
		return "bit_field"
	case ^ast.Distinct_Type:
		return "distinct"
	case ^ast.Pointer_Type, ^ast.Multi_Pointer_Type, ^ast.Array_Type, ^ast.Dynamic_Array_Type,
	     ^ast.Map_Type, ^ast.Proc_Type, ^ast.Matrix_Type, ^ast.Typeid_Type, ^ast.Helper_Type,
	     ^ast.Poly_Type, ^ast.Relative_Type:
		return "type"
	case ^ast.Ident, ^ast.Selector_Expr:
		// `Color :: sdl.Color` is an alias; `MAX :: OTHER_MAX` a constant
		if is_screaming(name) do return "constant"
		return "type"
	}
	return "constant"
}

is_screaming :: proc(name: string) -> bool {
	has_letter := false
	for c in name {
		if c >= 'a' && c <= 'z' do return false
		if c >= 'A' && c <= 'Z' do has_letter = true
	}
	return has_letter
}

source :: proc(file: ^ast.File, start, end: int) -> string {
	return file.src[clamp(start, 0, len(file.src)):clamp(end, 0, len(file.src))]
}

// A comment group's text: markers stripped, the common indentation removed, blank edges trimmed
comment_text :: proc(group: ^ast.Comment_Group) -> string {
	lines: [dynamic]string
	for tok in group.list {
		text := tok.text
		if strings.has_prefix(text, "/*") {
			text = strings.trim_prefix(text, "/*")
			text = strings.trim_suffix(text, "*/")
			for line in strings.split_lines(text) do append(&lines, strings.trim_right_space(line))
		} else {
			text = strings.trim_prefix(text, "//")
			append(&lines, strings.trim_right_space(text))
		}
	}
	// `//` comments: drop the one space after the marker when every line has it
	all_line_comments := true
	for tok in group.list do if strings.has_prefix(tok.text, "/*") do all_line_comments = false
	if all_line_comments {
		every := true
		for l in lines do if l != "" && !strings.has_prefix(l, " ") do every = false
		if every do for &l in lines do l = strings.trim_prefix(l, " ")
	}
	// Common indentation (tabs and spaces as written)
	common := -1
	for l in lines {
		if strings.trim_space(l) == "" do continue
		n := 0
		for n < len(l) && (l[n] == ' ' || l[n] == '\t') do n += 1
		if common < 0 {
			common = n
		} else {
			// The shared prefix with the lines so far
			first := first_nonblank(lines[:])
			k := 0
			for k < min(n, common) && l[k] == first[k] do k += 1
			common = k
		}
	}
	if common > 0 {
		for &l in lines do if len(l) >= common do l = l[common:]
	}
	for len(lines) > 0 && strings.trim_space(lines[0]) == "" do ordered_remove(&lines, 0)
	for len(lines) > 0 && strings.trim_space(lines[len(lines) - 1]) == "" do pop(&lines)
	return strings.join(lines[:], "\n")
}

first_nonblank :: proc(lines: []string) -> string {
	for l in lines do if strings.trim_space(l) != "" do return l
	return ""
}
