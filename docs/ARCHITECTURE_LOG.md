# Architecture Log

Append-only. Entries are added at the end and never edited or removed; a later entry may supersede an earlier one by saying so.

This log holds the deltas and the rationale: what changed, what it replaced, and why. Specs, code, and comments describe the system as built, in its current state, and do not carry history or justification. If you want to know why something is the way it is, look here.

Entry format: date, title, decision, rationale, supersedes (if any).

---

## 2026-09-07 — Everything is a docmem: tasks, lenses, and workers

**Decision.** Agent orchestration is built from existing primitives rather than new abstractions. An editing lens is a readonly system-prompt docmem. A task is a node in a task docmem. A worker is an AgentLoop run seeded from a task node. The runner that picks up tasks is plain JavaScript, not an LLM.

**Rationale.** Repeated attempts to design delegation, task management, and loop running as separate generic abstractions stalled. They are one thing seen from three angles. Anchoring on the concrete fiction workflow (multiple editing passes over the same material) makes the shapes obvious and keeps the command surface small for the small models this framework targets.

---

## 2026-09-07 — Task queue instead of a master agent

**Decision.** There is no master agent. Work is a queue of task nodes with a status in `context_value` (queued, claimed, done, failed). The runner takes the first queued node, marks it claimed, runs an AgentLoop, records the result under the task, marks it done, and repeats. Workers continue multi-round work only by enqueueing new task nodes. The synchronous `delegate()` command stays for sub-questions inside a task.

**Rationale.** A master agent is a single point of context growth and cost, and an LLM is a poor scheduler. A queue that lives in a docmem is visible and editable in the Docmem tab while it runs, and chaining passes (draft, then continuity check, then dialogue pass) falls out of "finish by enqueueing". No parallelism means claiming is trivial with no races.

**Supersedes.** The `start_contract` / `end_contract` model in SPEC_AGENTS.md, which SPEC_DELEGATE.md had already partly replaced. SPEC_AGENTS.md is to be marked superseded when SPEC_TASKS.md is written.

---

## 2026-09-07 — Scoped read-sets are the prerequisite for the queue

**Decision.** A task carries an explicit read-set (the docmem roots or nodes the worker may see). `buildMessageList` will expand only the read-set for a worker; the root chat keeps expand-all behaviour. This is scheduled before the runner.

**Rationale.** Today every non-chat docmem is expanded into every turn of every agent (FRAMEWORK_REVIEW.md, R2). For fiction that means a full manuscript plus character and timeline docmems on every worker turn. A runner built before scoping would just burn tokens faster. The idea already existed as "working" versus "work product" docmems in SPEC_AGENTS.md; the read-set makes it concrete.

---

## 2026-09-07 — Search: literal, wildcard, regex now; semantic deferred

**Decision.** `docmem_search(node_id, pattern, mode="literal")` searches a subtree over text and all context fields, case-insensitive and unanchored, using DuckDB `LIKE` (with escaping) and `regexp_matches` inside a recursive CTE. Hits return the standard metadata line, the ancestor ID path, and a snippet, capped at 50. Semantic search is deferred.

**Rationale.** Literal search is small, standalone, and needed by everything that follows. All three modes match anywhere so small models learn one behaviour. Output reuses the `docmem_structure` line format for the same reason. Semantic search in DuckDB WASM needs embeddings and either a vector column or a JS index; once tasks carry explicit read-sets, a worker rarely needs to discover context by similarity, so the payoff is uncertain. The earlier full-text-search task assumed sql.js and SQLite FTS5, which no longer apply.

---

## 2026-09-07 — Model list tracks OpenRouter; DeepSeek Flash is the default

**Decision.** The model dropdown in `index.html` is reconciled against the published OpenRouter model list. Dead entries are removed, current flash and small-tier models from each vendor are listed, and the newest DeepSeek Flash is the default.

**Rationale.** Eight of twenty entries had disappeared from OpenRouter. The framework targets small, cheap models, so the default should be the cheapest capable one, and the list should be revisited periodically since it drifts.

---

## 2026-09-07 — Stop and budget controls before unattended runs

**Decision.** A Stop control (AbortController), retry with backoff on transient API errors, and a per-run token budget are scheduled before the task runner is allowed to run unattended.

**Rationale.** FRAMEWORK_REVIEW.md R1 and R2: loops cannot be cancelled from the UI and costs compound quietly. A queue without a stop is a money pit.

---

## 2026-09-07 — Documentation split: as-built versus log

**Decision.** Specs, code, and comments describe the current state only, with no deltas or rationale. Deltas and rationale live in this append-only log.

**Rationale.** Rationale interleaved with specification goes stale and makes the spec harder to read as a contract. Keeping history in one place makes both documents honest.

---

## 2026-09-07 — Message list ends on a `$ System.turn()` user message

**Decision.** `buildMessageList` appends a byte-stable user-role message, `$ System.turn()` plus a one-line instruction, after the docmem context messages. Reasoning is sent as `reasoning.enabled` (off by default) and the completion ceiling is 32000 tokens. An empty completed response is retried once with the responding provider excluded.

**Rationale.** DeepSeek V4 Flash, on two different OpenRouter hosts, returned a single end-of-turn token with null content when the prompt ended with a system-role docmem expansion. GLM tolerated that shape. The docmem expansions must stay last for prompt-cache stability, so the fix is a trailing user turn rather than reordering. The message is byte-stable so it never invalidates cache, and it is the natural place for the planned per-turn status readout. The provider retry was added while diagnosing and stays as a safety net for flaky hosts.

---

## 2026-09-07 — Pro-tier default for the interactive chat; Flash for narrow passes

**Decision.** The model dropdown defaults to DeepSeek V4 Pro. DeepSeek V4 Flash stays listed as a worker model for single-lens tasks once per-task model overrides exist.

**Rationale.** On the same requests, Flash dropped required arguments and misread tool results, while Pro handled them. The interactive chat needs multi-step planning over a large tool prompt; queued passes do not. This supersedes the "DeepSeek Flash is the default" entry above.

---

## 2026-09-07 — Tools own their display string; the loop labels only errors

**Decision.** A successful command's `result` is the whole text the model sees, led by the function name as the model typed it (`docmem_create_node: appended child qjjp9a36`). The loop no longer echoes the call or prefixes `result>`; it prefixes `error <name>:` on failures and on pre-execution errors (`pytool`). Command labels use underscores to match the function names; the hyphenated labels are gone.

**Rationale.** A fork of the project saw the model conclude it had called a tool twice, because its call appeared once in its own turn and again echoed in the result. faipredict never echoed the call and never hit that confusion. Putting the string in the tool also places any future summarization of long results in the one place that knows the data. The hyphen/underscore mismatch was a needless second name for a small model to reconcile.

---

## 2026-09-07 — Run summaries only for runs with tool rounds; status records the termination reason

**Decision.** The run container node's text is set only when the run made two or more model calls, meaning commands ran between them. A single-exchange run leaves the text empty. On termination the container's `contextValue` changes from `working` to the termination reason.

**Rationale.** The run container arrived with the shared AgentLoop, where a delegated child's many tool rounds collapse to one summary. The interactive chat inherited it, so every ordinary reply was stored twice, once as the message and once as the "summary" of a run that had nothing to compress. The rule is about the run's shape rather than who started it. The status value had never been updated, so finished runs read as `working` in the tree.

---

## 2026-09-07 — Turns hang off the chat root; runs are wrapped only when compressed

**Decision.** Messages are appended directly to the chat docmem root. No container is created up front. When a run ends after two or more model calls, its messages are wrapped after the fact with `addSummary` into a `summary:status:<reason>` node carrying the run summary. Single-exchange runs are left flat. This supersedes the entry above about empty run summaries.

**Rationale.** An empty container per exchange was structure with no content. Wrapping at the end, using the same operation the agent uses to compress chat history, means a summary node exists exactly when there is something it stands for.

---

## 2026-09-07 — No automatic chat summaries; compression is explicit

**Decision.** The agent loop records turns flat under the chat root and never creates a summary node. Chat history is compressed only when the model calls `docmem_add_summary` on its own messages or the user does so from the UI. A size-triggered prompt to summarize is planned as a separate feature. This supersedes both run-summary entries above; the run container is gone entirely, and message building no longer special-cases `status` summary nodes.

**Rationale.** Wrapping on the second model call tied compression to an accident of the turn shape rather than to context pressure. Summaries should happen when the transcript is long enough to need them, at a point the model or user chooses.

