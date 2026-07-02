## 📘 Canonical Plain‑Text Docmem Serialization (v6)

### 1. Overview
A plain‑text format for storing **docmem** node trees. Each record contains optional headers (`name=value` pairs) and a content block. Records end with `---` and are separated by blank lines.

---

### 2. Record Structure

Each record contains:

1. **Headers** (optional): Zero or more `name=value` pairs, one per line. Common headers include:
   - `id`: Unique node identifier
   - `parent`: Parent node ID (empty string for root)
   - `context`: Context metadata in format `type:name:value`
   - `readonly`: Readonly flag (0 or 1, defaults to 0 if omitted)
2. **Content section**, indicated by one of:
   - `""` → empty content
   - Blank line → multiline content (ends at `---`)
   - 12-character alphanumeric delimiter → multiline content (ends at matching delimiter, then `---`)
3. **Record terminator**: `---` on a line by itself (optional for the last record in a file)
4. **Record separator**: One or more blank lines between records

```
headers...
<"" | blank line | 12-char-delimiter>
<optional multiline content>
<12-char-delimiter (if used)>
---
```

---

### 3. Semantics of content openers

| First content line | Content structure | Record terminator |
|:--------------------|:------------------|:------------------|
| `""` | empty (no body) | `---` |
| *blank line* | multiline body content | `---` |
| `[12 alphanumeric chars]` | multiline body content (between matching delimiters) | matching delimiter, then `---` |

The 12-character delimiter must be exactly 12 alphanumeric characters (A-Z, a-z, 0-9). Records end with `---` on a line by itself (the final `---` in a file is optional).

---

### 4. Example — *ThreeStooges(root+1 child)*

```
id=three-stooges
parent=
context=root:purpose:document
readonly=0
""
---

id=cppzr9xv
parent=three-stooges
context=character:name:moe
readonly=0

Moe Howard was the leader of the Stooges.
Born Moses Harry Horwitz, he reprised the role through decades of comedy.
---
```

or using a 12-character delimiter:

```
id=pekx4ci2
parent=cppzr9xv
context=attribute:years_active:moe_years
readonly=1
a1b2c3d4e5f6
"1920s–1970s" with quotes and --- delimiters
a1b2c3d4e5f6
---
```

---

### 5. Formal Grammar (EBNF-style, informal)

Note: The final `---` in a file is optional.

```
record     ::= *( header ) content-section "---" newline
header     ::= name "=" value newline
name       ::= 1*( ALPHA / DIGIT / "_" / "-" )
value      ::= *( any-char-except-newline )
content-section
            ::= ( empty | blank-body | delimited-body )
empty      ::= '""' newline
blank-body ::= newline *?( line-without("---") ) newline
delimited-body
            ::= delimiter12 newline *?( line-not-equal(delimiter12) ) newline delimiter12 newline
delimiter12::= 12*( ALPHA / DIGIT )
```

---

### 6. Parsing Notes

1. Read headers (unquoted `name=value` lines) until encountering:
   - `""` → empty content, then `---`
   - Blank line → read content until `---`
   - 12 alphanumeric characters → save as delimiter, read content until matching delimiter, then `---`

2. Records are separated by one or more blank lines.

3. The 12-character delimiter allows content to contain `---`, quotes, and any characters (since `---` appears after the delimiter).

4. The `readonly` header field MUST be 0 or 1. If omitted, it defaults to 0. When deserializing:
   - Nodes from TOML files default to `readonly=0` if not specified.
   - Nodes from file uploads (non-TOML) MUST be marked as `readonly=1`.

---

### 7. Advantages

- Uniform record termination (`---` marks record end)
- Simple parsing (three content types, consistent terminator)
- Human-readable (no special keywords)
- Supports single-line and multiline content
- Deterministic delimiters enable simple diffing
- Compact (no redundant `content=` tags)
- 12-character delimiter allows any content, including `---` and quotes

---

### 8. Limitations

- A literal `---` line cannot appear in blank-line-delimited content (use 12-character delimiter instead)
- The 12-character delimiter must not appear within the content itself (extremely unlikely with randomly generated delimiters)
- The first line of blank-line-delimited content cannot be blank  