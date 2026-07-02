# Fai Helpers

A browser-based agent framework centered around **Docmem**, a hierarchical document memory system. LLM agents maintain structured memory, delegate work to sub-agents, and operate with explicit context management.

## Getting Started

No build step required. Serve the project directory with any local HTTP server and open `index.html`. ES modules require HTTP — `file://` won't work.

With [`just`](https://github.com/casey/just):

```bash
just up     # start a local server at http://localhost:8000
just down   # stop it
```

Or serve it yourself with any of:

```bash
npx serve .
python3 -m http.server
php -S localhost:8000
```

Then open `http://localhost:8000` (or whichever port your server uses).

### Chat Setup

1. Get an API key from [OpenRouter](https://openrouter.ai/)
2. Go to the **Chat** tab, paste your key, pick a model, and click **Start Chat**
3. The agent will initialize a docmem and begin responding to messages

### Tabs

- **Chat** — Converse with an LLM agent that can read/write its own docmem via tool calls
- **Docmem** — Directly create, inspect, and edit docmem trees
- **View** — Read-only exploration with token-budget expansion and serialization
- **Persist** — Save/load docmems as TOML files; import text files as readonly nodes

## Key Concepts

**Docmem** is a hierarchical tree of nodes stored in DuckDB WASM (in-memory). Each node carries text content plus context metadata (`contextType`, `contextName`, `contextValue`). Agents read and write their own docmem to maintain working memory across a conversation.

**Agents** use an agentic loop: the LLM emits `` ```pytool `` blocks containing function calls, which are parsed and executed as commands (e.g. `docmem_create_node`, `docmem_find`, `delegate`). The loop continues until the agent calls `complete()` or runs out of tool calls.

**Delegation** lets an agent spawn a child agent with its own separate docmem and context boundary.

**Persistence** is manual — the in-memory database is lost on page reload. Use the Persist tab to save/load TOML snapshots.

## Dependencies

All loaded from CDN, no `npm install` needed:

- [DuckDB WASM](https://duckdb.org/docs/api/wasm) — in-memory database
- [gpt-tokenizer](https://www.npmjs.com/package/gpt-tokenizer) — token counting
