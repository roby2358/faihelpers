# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Fai Helpers is a browser-based agent framework centered around **Docmem**, a hierarchical document memory system. The framework enables LLM agents to maintain structured memory, delegate work to sub-agents, and operate with explicit context management.

**Key Insight**: LLM output is linear and hierarchical, but memory is high-dimensional and associative. Docmem makes the compression between these representations explicit and controllable.

## Running the Application

This is a pure browser-based JavaScript application with no build step:

1. Open `index.html` in a web browser
2. The application uses external CDN dependencies (DuckDB WASM, gpt-tokenizer)
3. No npm, webpack, or build tooling is required

## Architecture

### Core System: Docmem

The docmem system stores information in a hierarchical tree structure backed by DuckDB WASM running in browser. All docmem instances share a single in-memory database connection.

**Key files:**
- `js/docmem_tools/docmem.js` - Main Docmem class and operations
- `js/docmem_tools/docmem_sqlite.js` - DuckDB WASM database interface
- `js/docmem_tools/docmem_types.js` - Node class, hash computation, optimistic locking

**Node structure:**
- Each node has: `id`, `parentId`, `text`, `order`, `tokenCount`, `contextType`, `contextName`, `contextValue`, `readonly`, `hash`
- Nodes are differentiated by context metadata (type/name/value) rather than explicit node types
- Ordering uses decimal interpolation (20% weighted) to allow insertion without reindexing
- Optimistic locking via SHA-512 hash prevents concurrent modification conflicts
- Readonly nodes (imported text files) cannot be modified; agents create "note" nodes as siblings instead

**Core operations:**
- `appendChild()`, `insertBefore()`, `insertAfter()` - Add nodes
- `updateContent()`, `updateContext()` - Modify nodes (fails on readonly nodes)
- `delete()` - Remove node and descendants
- `addSummary()` - Create summary node and reparent children
- `serialize()` - Depth-first traversal returning flat array
- `expandToLength()` - Token-limited context construction via breadth-first expansion
- `structure()` - Tree structure without text content

**Important patterns:**
- Each docmem is identified by its root node ID
- Root nodes have `parentId = null`
- Use `Docmem.getAllRoots()` to list all docmem instances
- Token counting uses gpt-tokenizer when available, falls back to char/4 approximation

### Agent System

Agents can delegate work to sub-agents and maintain separate context boundaries. Each agent has:
- A root system prompt (readonly)
- Capability/personality docmems (readonly)
- A predecessor docmem representing the spawning chat (readonly)
- Working docmems for input (readonly)
- Work product docmems (read/write)
- Its own chat docmem (read/write)

Agents are identified by their chat docmem root ID. See `SPEC_AGENTS.md` for details.

### Command System

The chat interface includes a bash-like command parser for structured operations:

**Key files:**
- `js/bash/command.pegjs` - PEG grammar definition (source)
- `js/bash/command_parser.js` - Generated parser (do not edit manually)
- `js/bash/command.js` - Command AST and utilities

**Command handlers:**
- `js/docmem_tools/docmem_commands.js` - Docmem operations (append, insert, update, delete, summarize, etc.)
- `js/system_tools/system_commands.js` - System operations (list roots, export, clear, etc.)

**To regenerate parser:** Use Peggy to compile `command.pegjs` to `command_parser.js`

### Persistence

Three persistence mechanisms:

1. **TOML** (`js/persist/toml.js`) - Structured export/import preserving full docmem state (nodes default to `readonly = 0`)
2. **Line import** (`js/persist/line.js`) - Import text files line-by-line as sibling nodes (nodes marked `readonly = 1`)
3. **Paragraph import** (`js/persist/paragraph.js`) - Import text files paragraph-by-paragraph (nodes marked `readonly = 1`)

Note: Database does NOT persist to IndexedDB; data is lost on page reload unless explicitly saved to TOML.

### UI Structure

Four main tabs implemented in `js/index.js`:

1. **Chat** - LLM chat interface using OpenRouter API with command parsing
2. **Docmem** - Direct manipulation of docmem tree structure with CRUD operations
3. **View** - Read-only exploration and serialization of docmem trees
4. **Persist** - Save/load TOML files, import text files, remove docmems

### System Prompts

Preconfigured docmems providing agent capabilities:

- `js/system_prompts/root_prompt.js` - Base agent prompt
- `js/system_prompts/seed.js` - Seeds system docmems on initialization
- `js/bash/bash_prompt.js` - Command system documentation
- `js/system_tools/system_prompt.js` - System commands documentation
- `js/docmem_tools/docmem_prompt.js` - Docmem operations documentation

## Specifications

The `SPEC_*.md` files are the authoritative source for system behavior:

- `SPEC_DOCMEM.md` - Comprehensive docmem specification (tree structure, operations, database schema)
- `SPEC_DOCMEM_ATOMICITY.md` - Optimistic locking and concurrent modification handling
- `SPEC_DOCMEM_SERIALIZATION.md` - Serialization and expansion algorithms
- `SPEC_DOCMEM_WIKI.md` - Extended examples and usage patterns
- `SPEC_AGENTS.md` - Agent delegation and context management
- `SPEC_CHAT.md` - Chat interface behavior
- `js/bash/SPEC_COMMAND_PARSER.md` - Command parser specification

**When modifying core behavior, always consult and update relevant SPEC files.**

## Key Design Principles

1. **Separation of concerns**: Docmem handles memory/context construction; LLM handles decisions/generation
2. **Tree as document**: Serialization through traversal, no generation logic needed
3. **Visible compression**: Summarization is explicit and auditable; original nodes preserved
4. **Readonly protection**: Imported content cannot be modified; agents append notes as siblings
5. **Optimistic locking**: Hash-based versioning prevents concurrent modification conflicts
6. **No implicit operations**: All memory operations are explicit and traceable

## Testing

- Manual testing via `index.html` in browser
- Parser test: `js/bash/test_command_parser.html`
- No automated test suite currently

## Common Pitfalls

1. **Do not edit `command_parser.js` directly** - Regenerate from `command.pegjs` using Peggy
2. **Remember readonly nodes** - Update operations fail on readonly nodes; create note nodes instead
3. **Optimistic locking** - Operations may fail with `OptimisticLockError` if node was concurrently modified
4. **No persistence** - Database is in-memory only; save to TOML before closing browser
5. **Order value precision** - Repeated insertions eventually exhaust floating-point precision
6. **Hash calculation** - Must include: `parent_id|context_type|context_name|context_value|text|order` (NOT readonly field)

## Future Enhancements (Not Yet Implemented)

- Vector database for semantic search
- Automatic LLM-based summarization
- IndexedDB persistence across page reloads
- Semantic prioritization in expandToLength
- Agent parallelization

## Related Documentation

- `WHITEPAPER_NARRATIVE_COHERENCE_ENGINE.md` - Theoretical foundation
- `pjpd/` directory - Project planning and development notes
