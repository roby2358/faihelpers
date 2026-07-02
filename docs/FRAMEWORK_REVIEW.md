# Framework Review

Reviewed 2026-07-02. Scope: architecture, correctness, spec conformance, robustness, and code quality of the Fai Helpers agent framework. Kept current as findings are resolved; file/line references are approximate as the code evolves.

## Executive Summary

Fai Helpers is a coherent, opinionated experiment: agents whose working memory is an explicit, inspectable tree (Docmem) rather than an opaque context window. The architecture is unusually disciplined for a project of this size — clean layering, a UI-free agent loop, specs as first-class artifacts, and a strings-only command parser that avoids `eval` entirely.

The main open issues are: **a cluster of spec–implementation divergences** (the specs are declared authoritative but drift from the code in several places), and **robustness gaps** typical of an early-stage framework (no request timeouts, no transactions, no automated tests, unbounded delegation cost).

## Strengths

1. **The core bet is well-executed.** Memory-as-tree with explicit compression (`addSummary` reparents originals under the summary — reversible, auditable) is genuinely implemented, not just described. `expandToLength` (`js/docmem_tools/docmem.js`) is a thoughtful algorithm — reverse-BFS priority favoring recency, no-holes budget consumption guaranteeing no orphaned children — and its implementation matches SPEC_DOCMEM exactly, with a good explanatory comment.

2. **Clean layering.** `Docmem` (tree logic) → `DocmemSQLite` (SQL) → `SharedDatabase` (connection singleton) is strictly respected. `AgentLoop` (`js/agent_loop.js`) honors SPEC_DELEGATE's "no UI dependencies" requirement — it takes callbacks and never touches the DOM, so it would work headless.

3. **Structural integrity is enforced.** All move operations validate against cycles before committing — self-moves, moves under a descendant, and sibling moves relative to the node's own children are all rejected — and `getRootOfNode` detects cycles in the parent chain and fails loudly rather than looping, so even corrupt imported data can't hang the tab.

4. **Safe command execution.** The pytool PEG grammar (`js/pytool/pytool.pegjs`) accepts only function names and string literals — no expressions, no interpolation, no eval path. Model output is structurally incapable of executing arbitrary JS. Unknown commands and parse errors are fed back to the model as correctable tool results rather than crashing the loop (`agent_loop.js:executeCallList`).

5. **Optimistic locking is real.** SHA-512 content hashing with compare-and-swap updates (`docmem_types.js:NodeHasher`, `docmem_sqlite.js:executeUpdateWithOptimisticLock`), and lock failures produce agent-readable messages telling the model to re-read and retry — a nice touch for LLM consumers.

6. **Specs as source of truth.** The SPEC_*.md discipline is rare and valuable. Where code and spec agree (expand algorithm, ordering interpolation, delegation lifecycle, cycle prevention), they agree precisely.

7. **Cost awareness exists.** `cache_control: ephemeral` breakpoints on the stable system messages (`docmem_chat.js`) show attention to prompt caching, the root prompt is included exactly once per turn, and the chat status line surfaces per-request context size and token limits.

## Correctness Findings

### C1 (LOW) — `docmem_structure` returns a JSON-escaped blob instead of the indented tree

`Docmem.structure()` returns a human-readable indented string, but `DocmemCommands.structure` (`docmem_commands.js`) wraps it in `JSON.stringify(..., null, 2)`, producing a single quoted line full of `\n` escapes. Three artifacts disagree: SPEC_DOCMEM says indented lines, `docmem_prompt.js` tells the model it gets "JSON array of node objects," and the code produces neither. The agent-facing output should be the raw indented string.

### C2 (LOW) — `reparentNodes` rollback leaves in-memory node corrupted

On failure, `reparentNodes` (`docmem.js`) restores `node.parentId` but not `node.hash`, which was already recomputed for the new parent. The DB is fine (the update failed), but the caller-held Node object now has a hash that matches neither the DB nor its own fields; a retry using it will mislead. Recompute the hash in the catch, or hash into a temp until the write succeeds.

### C3 (LOW) — Seeding and TOML import bypass `readonly` and validation paths

`seed.js:deleteExistingChildren` and `TomlSerializer` call `docmem.sqlite.deleteNodeById`/`insertNode` directly, skipping the readonly check and the delete-descendants logic that `Docmem.delete` provides. Today the seeds are shallow so it works, but a two-level seed would orphan grandchildren. Prefer going through the `Docmem` API.

## Spec–Implementation Divergences

CLAUDE.md declares the specs authoritative; these should be reconciled in one direction or the other.

| # | Divergence | Spec says | Code does |
|---|-----------|-----------|-----------|
| S1 | Docmem context budget | `expandToLength(id, 20000)` (SPEC_CHAT.md) | `DEFAULT_EXPAND_MAX_TOKENS = 10000` (`docmem_chat.js`) |
| S2 | Atomicity | Explicit transactions, WAL, rollback for all multi-node ops (SPEC_DOCMEM_ATOMICITY) | **No transactions anywhere.** Every statement auto-commits; `delete` subtree and `addSummary` reparenting can fail halfway and leave partial state. Spec also discusses SQLite/WAL while the implementation is DuckDB WASM in-memory — much of the spec is aspirational for a different engine |
| S3 | Agent model | Read-only predecessor docmems, working vs. work-product docmems, `start_contract`/`end_contract`, agent prompting its parent (SPEC_AGENTS) | Only `delegate`/`complete` exist; no scoping — every agent has full write access to every docmem (which SPEC_DELEGATE, more recent, embraces). SPEC_AGENTS reads as an outdated vision doc |
| S4 | `docmem_structure` output format | Indented metadata lines | JSON-escaped string (see C1) |

Recommendation: update SPEC_CHAT (or the constant) for S1; add a "Current Implementation" section to SPEC_DOCMEM_ATOMICITY acknowledging the no-transaction reality and what that means for multi-node ops; either mark SPEC_AGENTS as superseded by SPEC_DELEGATE or trim it to what exists.

## Robustness & Cost

### R1 (HIGH) — No timeout, no abort, no retry on API calls

`OpenRouterAPI.performRequest` (`OpenRouterAPI.js`) is a bare `fetch`. A hung connection stalls the agent loop forever ("Working…" indefinitely) with no way to cancel — and a delegated child hanging blocks its entire parent chain, since delegation is synchronous. Minimum viable fix: `AbortSignal.timeout(...)`, surfaced as a normal command error the loop can react to. A Stop button wired to an `AbortController` would materially improve the UX.

### R2 (MEDIUM) — Token costs compound quietly

Three multipliers stack: every non-chat docmem is expanded into **every turn** of **every agent** (up to 10k tokens each, `buildNonChatDocmemSystemMessages`); loops run up to 100 turns; and recursive delegation is explicitly unbounded (SPEC_DELEGATE). A single user message can legitimately fan out to hundreds of model calls, each carrying the full docmem corpus. The status line helps visibility; consider also a per-run token accumulator and a configurable delegation depth cap.

Related detail: the expanded docmem system messages embed `updated_at` per node, so any docmem write changes those messages on the next turn. They sit after the `cache_control` breakpoints, so the stable prefix still caches — but the docmem messages themselves never will. Worth knowing when reading OpenRouter bills.

### R3 (LOW) — Token estimate vs. token budget

`Node.countTokens` is `chars/4` (spec-sanctioned), but `expandToLength` treats those estimates as a hard budget, and gpt-tokenizer is already loaded in `index.html`. For prose the estimate is decent; for code or CJK text it can be off 2×, meaning "20000-token" contexts may be far larger in reality. Swapping in the real tokenizer inside `countTokens` is a one-line change that makes budgets honest.

## Code Quality

- **Dead weight: the entire `js/bash/` directory.** Nothing outside it imports `command.js` or `command_parser.js` (~2,240 lines), and `bash_prompt.js` is unused. Only pytool is live. Either delete it (git preserves history) or add a README note that it's a retained alternative syntax; today it silently misleads readers (SPEC_DELEGATE still lists `command_parser.js` as a dependency).
- **`validateLeafNodes`** (`docmem.js`) is an accidental O(n²): the outer loop detects one violation, then an inner loop re-scans *all* nodes to build the error message. Collect violators in one pass.
- **Duplication:** `getSortedChildren` exists in both `Docmem` and `DocmemChat`; `deleteExistingRoot`/`createChatRootNode` in `DocmemChat` partially reimplement `Docmem.createRoot`; `DocmemSQLite.getAllRoots` exists as both instance and static with different return shapes (Node vs plain object). Minor, but the kind of drift that breeds bugs.
- **Illusory scoping:** `Docmem` takes a `docmemId` but every method operates on the shared table with no root check — `new Docmem('a').getNode(nodeOfB)` works fine. That's a deliberate design (SPEC_DELEGATE: no access control), but the constructor parameter implies a boundary that doesn't exist; a comment on the class would prevent false assumptions.
- **`index.js` at 1,075 lines** is the largest hand-written file and mixes four tabs' worth of UI. Fine for now; first candidate to split when it grows.

## Security Posture

Good for the threat model (a local single-user tool):

- No `eval`/`Function` anywhere; the parser grammar is the security boundary and it only yields strings.
- Chat output is rendered into a `<textarea>` (`chat.js:appendToChatDisplay`) — no HTML injection surface from model output.
- All SQL is parameterized via prepared statements.
- API key lives in `sessionStorage` (cleared on tab close) and is masked in request logging.

Two things to be aware of: `logRequest`/`logSuccessResponse` print the full prompt and response to the console (fine locally; a leak vector if anyone hosts this), and the `HTTP-Referer` header sends the page URL to OpenRouter (by design, it's their attribution convention).

## Testing

There is no automated test suite; the two parser test pages (`js/bash/test_command_parser.html`, `js/pytool/test_pytool_parser.html`) are manual, and one of them tests dead code. The most valuable target is `Docmem` itself: its operations are pure logic over a database and would be straightforward to test in Node with an in-memory DuckDB (or a stub `DocmemSQLite`) — move/copy/summary/delete edge cases are exactly where small property tests pay off. Even a single `test_docmem.html` page in the existing style would be a large step up.

## Prioritized Recommendations

1. **Add a fetch timeout/abort to `OpenRouterAPI`** (R1) and surface a Stop control — the loop currently has no escape hatch.
2. **Reconcile the spec divergences** (S1–S4) — the "specs are authoritative" discipline only pays off if they're kept true.
3. **Add a Docmem test page** covering move/copy/addSummary/delete edge cases.
4. **Delete or explicitly shelve `js/bash/`**.
5. **Adopt gpt-tokenizer for `countTokens`** (R3) — cheap honesty for every budget decision.
6. Longer-term, in line with the specs' own roadmap: IndexedDB persistence (the "all work lost on reload" footgun looms over everything else), then wrap multi-node operations in transactions to close the S2 gap for real.

## Closing Note

The framework's distinctive idea — that an agent's thinking should live in persistent, visible, manipulable memory rather than ephemeral context — is carried through consistently, from the schema to the delegation model to the deliberate choice to keep reasoning artifacts out of hidden channels. The issues above are almost all maintenance debt around a sound core, not flaws in the core itself.
