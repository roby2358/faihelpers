# Fai Helpers

A browser-based agent framework centered around **Docmem**, a hierarchical document memory system. LLM agents keep their working memory in an explicit, inspectable tree, delegate work to sub-agents, and operate with explicit context management. The framework is aimed at long-form fiction: multiple passes over the same material with different editing lenses, run by small, cheap models.

## Getting Started

No build step required. Serve the project directory over HTTP and open `index.html`. ES modules require HTTP, so `file://` won't work.

```bash
npx serve . -l 8137
```

Then open `http://localhost:8137`.

With [`just`](https://github.com/casey/just) installed, `just up` and `just down` start and stop a background server on the same port.

### Chat Setup

1. Get an API key from [OpenRouter](https://openrouter.ai/)
2. Go to the **Chat** tab, paste your key, pick a model (DeepSeek V4 Pro is the default), and click **Start Chat**
3. The agent initializes its chat docmem and begins responding to messages

### Tabs

- **Chat** — Converse with an LLM agent that reads and writes docmems via tool calls
- **Docmem** — Directly create, inspect, and edit docmem trees
- **View** — Read-only exploration with token-budget expansion and serialization
- **Persist** — Save/load docmems as TOML files; import text files as readonly nodes

## Key Concepts

**Docmem** is a hierarchical tree of nodes stored in DuckDB WASM (in-memory). Each node carries text plus context metadata (`contextType`, `contextName`, `contextValue`). Every docmem is serialized into the agent's context each turn, so there is no read command; agents write with commands like `docmem_create_node` and `docmem_update_content`, narrow their view with `docmem_focus`, and locate content with `docmem_search` (literal, wildcard, or regex).

**Agents** run an agentic loop: the LLM emits `` ```pytool `` blocks containing function calls, which are parsed and executed as commands. The loop continues until the response contains no commands, the agent calls `complete()`, or the turn limit is reached.

**Delegation** lets an agent spawn a child agent with its own chat docmem and context boundary. The parent suspends until the child completes and returns a summary.

**Persistence** is manual. The in-memory database is lost on page reload, so use the Persist tab to save and load TOML snapshots.

## Documentation

- `docs/SPEC_*.md` — authoritative specifications of current behavior (docmem, chat, delegation, serialization, parsers)
- `docs/ARCHITECTURE_LOG.md` — append-only record of architectural decisions and their rationale
- `docs/WHITEPAPER_NARRATIVE_COHERENCE_ENGINE.md` — the fiction-generation design the framework is built toward
- `docs/FRAMEWORK_REVIEW.md` — architecture and code review, kept current as findings are resolved
- `CLAUDE.md` — orientation for coding agents working in this repo

## Dependencies

All loaded from CDN, no `npm install` needed:

- [DuckDB WASM](https://duckdb.org/docs/api/wasm) — in-memory database
- [gpt-tokenizer](https://www.npmjs.com/package/gpt-tokenizer) — token counting

Regenerating the PEG parsers after editing a `.pegjs` grammar needs [Peggy](https://peggyjs.org/) via `npx peggy` (see `CLAUDE.md`).
