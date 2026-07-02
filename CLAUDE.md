# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Fai Helpers is a browser-based agent framework centered around **Docmem**, a hierarchical document memory system. LLM agents maintain structured memory, delegate work to sub-agents, and operate with explicit context management.

## Running and Testing

Pure browser ES modules, no build step or bundler. Serve the directory over HTTP and open `index.html` (`file://` won't work — ES modules require HTTP): e.g. `npx serve .`, `python3 -m http.server`, or `php -S localhost:8000`. CDN dependencies: DuckDB WASM (dynamic import), gpt-tokenizer. Parser tests: open `js/bash/test_command_parser.html` and `js/pytool/test_pytool_parser.html` in the browser. No automated test suite.

**Regenerate parsers** after editing `.pegjs` grammars:
```
npx peggy --format es -o js/bash/command_parser.js js/bash/command.pegjs
npx peggy --format es -o js/pytool/pytool_parser.js js/pytool/pytool.pegjs
```

## Architecture

### Docmem (Core)

Hierarchical tree stored in DuckDB WASM (in-memory, single shared connection). Each docmem is identified by its root node ID (`parentId = null`).

**Key files:** `js/docmem_tools/docmem.js` (Docmem class), `docmem_sqlite.js` (DB interface), `docmem_types.js` (Node class, hash, optimistic locking)

**Node fields:** `id`, `parentId`, `text`, `order`, `tokenCount`, `contextType`, `contextName`, `contextValue`, `readonly`, `hash`. Nodes are differentiated by context metadata, not explicit types. Ordering uses 20%-weighted decimal interpolation. Readonly nodes (imported files) cannot be modified — agents create sibling "note" nodes instead.

### Agent System & Chat Flow

Agents delegate to sub-agents with separate context boundaries. Each agent identified by its chat docmem root ID. See `docs/SPEC_AGENTS.md` and `docs/SPEC_DELEGATE.md`.

**Execution flow:** User input → `chat.js:sendMessage()` → `AgentLoop.run()` → `DocmemChat.buildMessageList()` (constructs messages from docmem tree) → `OpenRouterAPI.chat()` (OpenRouter.ai, OpenAI-compatible protocol) → extract `` ```pytool `` blocks → `parsePytool()` → `commandRouter()` dispatches to `DocmemCommands` or `SystemCommands`. Loop iterates until no more tool calls or `complete()` is called.

**Special commands:** `delegate()` spawns a child agent with its own DocmemChat + AgentLoop. `complete()` signals task completion (delegated agents only).

### Command Parsers

Two PEG-based parsers (bash-style and Python-style tool calls):
- `js/bash/command.pegjs` → `command_parser.js` (generated — do not edit)
- `js/pytool/pytool.pegjs` → `pytool_parser.js` (generated — do not edit)
- **Regenerate with Peggy** when modifying `.pegjs` grammars

**Command handlers:** `js/docmem_tools/docmem_commands.js`, `js/system_tools/system_commands.js`

### Persistence

- **TOML** (`js/persist/toml.js`) — Full docmem state export/import (nodes default `readonly = 0`)
- **Line/Paragraph import** (`js/persist/line.js`, `paragraph.js`) — Text file import as readonly sibling nodes

Database is in-memory only — data lost on reload unless saved to TOML.

### UI

Four tabs in `js/index.js`: Chat (OpenRouter API + command parsing), Docmem (tree CRUD), View (read-only exploration), Persist (save/load/import).

## Specifications

`SPEC_*.md` files are the **authoritative source** for system behavior. When modifying core behavior, always consult and update relevant specs, which live in `docs/`: `SPEC_DOCMEM.md`, `SPEC_DOCMEM_ATOMICITY.md`, `SPEC_DOCMEM_SERIALIZATION.md`, `SPEC_DOCMEM_WIKI.md`, `SPEC_AGENTS.md`, `SPEC_DELEGATE.md`, `SPEC_CHAT.md` — plus the parser specs `js/bash/SPEC_COMMAND_PARSER.md` and `js/pytool/SPEC_PYTOOL_PARSER.md`.

## DuckDB WASM Patterns

Critical differences from SQLite:

- **No CASCADE deletes** — Manual recursive deletion via `deleteDescendantsBottomUp`
- **No `getRowsModified()`** — Use `RETURNING id` clause instead
- **Arrow results** — Convert with `result.toArray().map(row => row.toJSON())`
- **Parameters** — Spread args: `stmt.query(...params)`, not an array
- **All async** — Every Docmem method returns a Promise
- **Column name mapping** — SQL: `parent_id`, `order_value`, `token_count`, `context_type`, `context_name`, `context_value`; JS: camelCase (`parentId`, `order`, `tokenCount`, etc.)

## Common Pitfalls

1. **Never edit generated parsers** — `command_parser.js` and `pytool_parser.js` are generated from `.pegjs` via Peggy
2. **Readonly nodes** — Updates fail on readonly nodes; create note nodes as siblings instead
3. **Optimistic locking** — `OptimisticLockError` if node was concurrently modified
4. **Hash formula** — Must include: `parent_id|context_type|context_name|context_value|text|order` (NOT readonly)
5. **Order precision** — Repeated insertions eventually exhaust floating-point precision
6. **No persistence** — In-memory only; save to TOML before closing browser
