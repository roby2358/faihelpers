# Framework Review

Reviewed at commit `1f8eaba` (2026-07-02). Scope: architecture, correctness, spec conformance, robustness, and code quality of the Fai Helpers agent framework. All file/line references are to that commit.

## Executive Summary

Fai Helpers is a coherent, opinionated experiment: agents whose working memory is an explicit, inspectable tree (Docmem) rather than an opaque context window. The architecture is unusually disciplined for a project of this size — clean layering, a UI-free agent loop, specs as first-class artifacts, and a strings-only command parser that avoids `eval` entirely.

The main issues found are: **one real correctness bug** (sibling moves can create a parent cycle), **a cluster of spec–implementation divergences** (the specs are declared authoritative but drift from the code in several places), and **robustness gaps** typical of an early-stage framework (no request timeouts, no transactions, no automated tests, unbounded delegation cost).

## Strengths

1. **The core bet is well-executed.** Memory-as-tree with explicit compression (`addSummary` reparents originals under the summary — reversible, auditable) is genuinely implemented, not just described. `expandToLength` (`js/docmem_tools/docmem.js:542`) is a thoughtful algorithm — reverse-BFS priority favoring recency, no-holes budget consumption guaranteeing no orphaned children — and its implementation matches SPEC_DOCMEM exactly, with a good explanatory comment.

2. **Clean layering.** `Docmem` (tree logic) → `DocmemSQLite` (SQL) → `SharedDatabase` (connection singleton) is strictly respected. `AgentLoop` (`js/agent_loop.js`) honors SPEC_DELEGATE's "no UI dependencies" requirement — it takes callbacks and never touches the DOM, so it would work headless.

3. **Safe command execution.** The pytool PEG grammar (`js/pytool/pytool.pegjs`) accepts only function names and string literals — no expressions, no interpolation, no eval path. Model output is structurally incapable of executing arbitrary JS. Unknown commands and parse errors are fed back to the model as correctable tool results rather than crashing the loop (`agent_loop.js:executeCallList`).

4. **Optimistic locking is real.** SHA-512 content hashing with compare-and-swap updates (`docmem_types.js:NodeHasher`, `docmem_sqlite.js:executeUpdateWithOptimisticLock`), and lock failures produce agent-readable messages telling the model to re-read and retry — a nice touch for LLM consumers.

5. **Specs as source of truth.** The SPEC_*.md discipline is rare and valuable. Where code and spec agree (expand algorithm, ordering interpolation, delegation lifecycle), they agree precisely.

6. **Cost awareness exists.** `cache_control: ephemeral` breakpoints on the stable system messages (`docmem_chat.js:146,153`) show attention to prompt caching.

## Correctness Findings

### C1 (HIGH) — Sibling move can create a parent cycle, then hang the system — **FIXED** post-review

*Fixed immediately after this review: `validateCycleBeforeMoveSibling` now rejects targets that are direct children of the moved node, and `getRootOfNode` detects cycles in the parent chain instead of looping forever. The description below documents the original bug.*

`validateCycleBeforeMoveSibling` (`js/docmem_tools/docmem.js:262`) checks whether the target's parent is a **descendant** of the moved node, but not whether it is **the moved node itself**. `getAllDescendants` excludes the starting node, so:

```
moveBefore(A, B)  where B is a direct child of A
→ target.parentId === A; descendants(A) does not contain A → check passes
→ A.parentId = A   (node becomes its own parent)
```

The subtree is silently detached from the tree, and any subsequent `getRootOfNode(A)` (`docmem.js:113`) walks `A → A → A…` in an infinite loop, hanging the tab. `docmem_move_node` with mode `before`/`after` is directly reachable by agents, so a confused model can trigger this.

**Fix:** add `if (descendantIds.has(targetNode.parentId) || targetNode.parentId === nodeId)` — and consider a visited-set guard in `getRootOfNode` as defense in depth. (`moveAppendChild`'s check at `docmem.js:248` handles its equivalent case correctly.)

### C2 (LOW) — `docmem_structure` returns a JSON-escaped blob instead of the indented tree

`Docmem.structure()` returns a human-readable indented string, but `DocmemCommands.structure` (`docmem_commands.js:145`) wraps it in `JSON.stringify(..., null, 2)`, producing a single quoted line full of `\n` escapes. Three artifacts disagree: SPEC_DOCMEM says indented lines, `docmem_prompt.js` tells the model it gets "JSON array of node objects," and the code produces neither. The agent-facing output should be the raw indented string.

### C3 (LOW) — `reparentNodes` rollback leaves in-memory node corrupted

On failure, `reparentNodes` (`docmem.js:626`) restores `node.parentId` but not `node.hash`, which was already recomputed for the new parent. The DB is fine (the update failed), but the caller-held Node object now has a hash that matches neither the DB nor its own fields; a retry using it will mislead. Recompute the hash in the catch, or hash into a temp until the write succeeds.

### C4 (LOW) — Seeding and TOML import bypass `readonly` and validation paths

`seed.js:deleteExistingChildren` and `TomlSerializer` call `docmem.sqlite.deleteNodeById`/`insertNode` directly, skipping the readonly check and the delete-descendants logic that `Docmem.delete` provides. Today the seeds are shallow so it works, but a two-level seed would orphan grandchildren. Prefer going through the `Docmem` API.

## Spec–Implementation Divergences

CLAUDE.md declares the specs authoritative; these should be reconciled in one direction or the other.

| # | Divergence | Spec says | Code does |
|---|-----------|-----------|-----------|
| S1 | Docmem context budget | `expandToLength(id, 20000)` (SPEC_CHAT.md:27) | `DEFAULT_EXPAND_MAX_TOKENS = 10000` (`docmem_chat.js:10`) |
| S2 | Atomicity | Explicit transactions, WAL, rollback for all multi-node ops (SPEC_DOCMEM_ATOMICITY) | **No transactions anywhere.** Every statement auto-commits; `delete` subtree and `addSummary` reparenting can fail halfway and leave partial state. Spec also discusses SQLite/WAL while the implementation is DuckDB WASM in-memory — much of the spec is aspirational for a different engine |
| S3 | Agent model | Read-only predecessor docmems, working vs. work-product docmems, `start_contract`/`end_contract`, agent prompting its parent (SPEC_AGENTS) | Only `delegate`/`complete` exist; no scoping — every agent has full write access to every docmem (which SPEC_DELEGATE, more recent, embraces). SPEC_AGENTS reads as an outdated vision doc |
| S4 | `docmem_structure` output format | Indented metadata lines | JSON-escaped string (see C2) |

Recommendation: update SPEC_CHAT (or the constant) for S1; add a "Current Implementation" section to SPEC_DOCMEM_ATOMICITY acknowledging the no-transaction reality and what that means for multi-node ops; either mark SPEC_AGENTS as superseded by SPEC_DELEGATE or trim it to what exists.

## Robustness & Cost

### R1 (HIGH) — No timeout, no abort, no retry on API calls

`OpenRouterAPI.performRequest` (`OpenRouterAPI.js:127`) is a bare `fetch`. A hung connection stalls the agent loop forever ("Working…" indefinitely) with no way to cancel — and a delegated child hanging blocks its entire parent chain, since delegation is synchronous. Minimum viable fix: `AbortSignal.timeout(...)`, surfaced as a normal command error the loop can react to. A Stop button wired to an `AbortController` would materially improve the UX.

### R2 (MEDIUM) — Token costs compound quietly

Three multipliers stack: every non-chat docmem is expanded into **every turn** of **every agent** (up to 10k tokens each, `buildNonChatDocmemSystemMessages`); loops run up to 100 turns; and recursive delegation is explicitly unbounded (SPEC_DELEGATE:197). A single user message can legitimately fan out to hundreds of model calls, each carrying the full docmem corpus. The new status line helps visibility; consider also a per-run token accumulator and a configurable delegation depth cap.

Related detail: the expanded docmem system messages embed `updated_at` per node, so any docmem write changes those messages on the next turn. They sit after the `cache_control` breakpoints, so the stable prefix still caches — but the docmem messages themselves never will. Worth knowing when reading OpenRouter bills.

### R3 (MEDIUM) — Root prompt is included twice

`buildSystemMessages` (`docmem_chat.js:339`) adds the root prompt via `buildRootPromptSystemMessage`, then `buildNonChatDocmemSystemMessages` includes the `root-prompt` docmem *again* (its ID doesn't start with `chat_`, so `isIncludableDocmem` passes it) — this time with full node metadata. Every turn carries the root prompt twice in two formats. Exclude `ROOT_PROMPT_DOCMEM_ID` from the includable set.

### R4 (LOW) — Token estimate vs. token budget

`Node.countTokens` is `chars/4` (spec-sanctioned), but `expandToLength` treats those estimates as a hard budget, and gpt-tokenizer is already loaded in `index.html`. For prose the estimate is decent; for code or CJK text it can be off 2×, meaning "20000-token" contexts may be far larger in reality. Swapping in the real tokenizer inside `countTokens` is a one-line change that makes budgets honest.

## Code Quality

- **Dead weight: the entire `js/bash/` directory.** Nothing outside it imports `command.js` or `command_parser.js` (~2,240 lines), and `bash_prompt.js` is unused. Only pytool is live. Either delete it (git preserves history) or add a README note that it's a retained alternative syntax; today it silently misleads readers (SPEC_DELEGATE:225 still lists `command_parser.js` as a dependency).
- **`validateLeafNodes`** (`docmem.js:228`) is an accidental O(n²): the outer loop detects one violation, then an inner loop re-scans *all* nodes to build the error message. Collect violators in one pass.
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

There is no automated test suite; the two parser test pages (`js/bash/test_command_parser.html`, `js/pytool/test_pytool_parser.html`) are manual, and one of them tests dead code. The most valuable target is `Docmem` itself: its operations are pure logic over a database and would be straightforward to test in Node with an in-memory DuckDB (or a stub `DocmemSQLite`). The C1 cycle bug is exactly the class of error a small move/copy/summary property test would have caught. Even a single `test_docmem.html` page in the existing style would be a large step up.

## Prioritized Recommendations

1. **Fix C1** (sibling-move cycle) — small change, prevents data corruption and a hard hang.
2. **Add a fetch timeout/abort to `OpenRouterAPI`** (R1) and surface a Stop control — the loop currently has no escape hatch.
3. **Reconcile the spec divergences** (S1–S4) — the "specs are authoritative" discipline only pays off if they're kept true.
4. **Deduplicate the root prompt** (R3) — free token savings on every turn of every agent.
5. **Add a Docmem test page** covering move/copy/addSummary/delete edge cases.
6. **Delete or explicitly shelve `js/bash/`**.
7. **Adopt gpt-tokenizer for `countTokens`** (R4) — cheap honesty for every budget decision.
8. Longer-term, in line with the specs' own roadmap: IndexedDB persistence (the "all work lost on reload" footgun looms over everything else), then wrap multi-node operations in transactions to close the S2 gap for real.

## Closing Note

The framework's distinctive idea — that an agent's thinking should live in persistent, visible, manipulable memory rather than ephemeral context — is carried through consistently, from the schema to the delegation model to the deliberate choice to keep reasoning artifacts out of hidden channels. The issues above are almost all maintenance debt around a sound core, not flaws in the core itself.
