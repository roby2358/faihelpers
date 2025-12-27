## 📘 Canonical Plain‑Text Docmem Serialization (v6)

### 1. Overview
A plain‑text, fully reversible format for storing **docmem** node trees.  
It uses line‑oriented `name=value` pairs followed by a clear content block, and a terminating line of three hyphens.

---

### 2. Record Structure

Each **node record** consists of:

1.One or more `name=value` header pairs
- each header ends at newline; no end delimiter required  
  2.A **content section**, which begins one of three ways:
- a **blank line** (normal case: unquoted multiline body)
- a line containing only`""`→ empty string
- a line starting with`"`or`'` →quotedscalarcontent (endsatmatchingquote)
  3.A line containing exactly`---`marks the **end of the record**  
  4.Oneormore blank lines separate node records

```
headers...
<blank line | "" | '...' | "..." >
<optional multiline content>
---
```

---

### 3. Semantics of content openers

| First content line | Meaning |
|:--------------------|:---------|
| *blank line* | following lines (up to`---`)=body content |
| `""` | empty content (no body) |
| `'something'` | single‑quotedscalar content; closes on matching `'` |
| `"something"` | double‑quotedscalar content; closes on matching `"` |

After any quoted form, the next line must be`---`.

---

### 4. Example — *ThreeStooges(root+1 child)*

```
id=three-stooges
parent=
context=root:purpose:document

""
---

id=cppzr9xv
parent=three-stooges
context=character:name:moe

MoeHowardwastheleaderoftheStooges.
BornMosesHarryHorwitz,hereprisedtherolethroughdecadesofcomedy.
---
```

or using a quoted scalar:

```
id=pekx4ci2
parent=cppzr9xv
context=attribute:years_active:moe_years
"1920s–1970s"
---
```

---

### 5. Formal grammar(EBNF‑style, informal)

```
record     ::= 1*( header ) content-section "---" newline
header     ::= name "=" value newline
name       ::= 1*( ALPHA / DIGIT / "_" / "-" )
value      ::= *( any-char-except-newline )
content-section
            ::= ( newline body | newline quoted | newline empty )
empty      ::= '""' newline
quoted     ::= ('"' *?(not-quote) '"' / "'" *?(not-quote) "'") newline
body       ::= *?( line-without("---") )    ; stops before line==="---"
```

---

### 6. Parsing notes

- Headers are always **unquoted** simple lines
- Parser reads headers until it encounters one of:
    - a blank line → body content follows
    - a line==`""`→ empty content
    - a quoted line→ extract scalar→ expect`---`
- `---` always terminates a record, even after quoted or empty content
- Nodes separated by ≥1blank line
- Unescaping of quotes may be handled in later revisions (outofscopeforv6)

---

### 7. Advantages ofv6
✅Trivial to parse(three entry types for content)  
✅Human‑friendly neutral syntax(no sentinel keywords)  
✅Supports single‑lineandmultiline content naturally  
✅Deterministicdelimiter (`---`)=simple diffing  
✅Compact(no redundant `content=`tags)

---

### 8. Limitations(acknowledged)
- A literal line`---`can’t currently exist in content
- No escapes or triple‑quote multiline quoting — futurework
- First line of unquoted content can’t be blank  