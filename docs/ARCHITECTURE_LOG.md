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


---

## 2026-09-07 — Docmem context messages are bare node blocks

**Decision.** The `$ System.docmem_expand_to_context(...)` header is removed from docmem context messages and from the root prompt message; a docmem message starts with its focus/partial markers, if any, then the node blocks. Each node is rendered as its `docmem_structure` metadata line (`id type:name:value updated_at`, indented by depth) followed by its text, with blocks separated by a blank line. The former `id: ..., parent_id: ..., context_type: ..., order: ..., token_count: ...` field list and `---` separators are gone, and the spec no longer bars `updated_at` from expansions.

**Rationale.** The header was noise: the first node block already names the start node, and the field list beneath it read as a raw record dump, as though a command had been echoed rather than evaluated. One format for node identity across structure output and expansion keeps the model's picture consistent, and indentation carries the hierarchy that `parent_id` used to. `updated_at` changes only when the node changes, so it does not disturb prompt caching.

---

## 2026-09-07 — Docmem context precedes the conversation

**Decision.** The message list is: tool prompts, root prompt, roster, docmem context messages, chat history. Previously the docmem messages sat between the chat history and a trailing `$ System.turn()` user message; that message is dropped, superseding the entry above that introduced it, because the chat history now ends the list and always closes on a user-role message.

**Rationale.** Placing the docmems after the conversation put the material under discussion below the question about it, which read backwards to the model and the user. With docmems first the conversation is grounded in state that is already in view. The cost is that a docmem edit now invalidates the cached prefix ahead of the chat history rather than only the tail; the docmem messages are still ordered least-recently-updated first, so a single edit invalidates as little as the order allows.

---

## 2026-09-12 — Task harness replaces delegate/complete

**Decision.** `delegate()` and `complete()` are removed. Work is a tree of task nodes in a task docmem, run by `TaskHarness` per TASK_DELEGATION_SPEC: preorder selection, a `{key=value}` state block at the start of each task's text, `suspend()`/`finish(summary)` as the only run-ending commands, a fixed nudge for tool-less responses, Stop via AbortController, and folding of finished or failed tasks under a summary node. Workers see only the root prompt, their lens, the task docmem, and their read-set; the chat agent still sees every non-chat docmem. The command router moved out of `chat.js` into `command_router.js` so the harness and the chat share it.

**Rationale.** Synchronous delegation put the plan in a call stack that vanished on reload and could not be inspected or edited. A tree in a docmem is visible in the Tasks and View tabs while it runs, round-trips through TOML, and lets a worker reshape the plan with the same move and create commands it already has. See the 2026-09-07 entries on tasks, lenses, and workers for the earlier steps toward this.

**Supersedes.** SPEC_DELEGATE's delegate and complete sections (the file now specifies only the agent loop); SPEC_AGENTS entirely; the 2026-09-07 "Task queue instead of a master agent" entry's status-in-`context_value` scheme, replaced by the state block.

---

## 2026-09-12 — Summaries fold subtrees; expansion stops at a summary

**Decision.** `docmem_add_summary` accepts nodes with children, and a range may be a single node. `expandToLength` no longer descends into a summary node (other than the start node), so a summary's subtree is omitted from context and from `totalCount`. Context fields may be empty strings; `Node` and `DocmemCommands` only reject null.

**Rationale.** The harness folds a task by summarizing it in place, and a task may have child tasks, so the leaf restriction had to go. Once a summary can hide an arbitrary subtree, expansion has to honor it or the tree never compresses; the open question in SPEC_DOCMEM about summary expansion is thereby settled in favor of keeping the summary as a header and dropping its children. Empty context fields let a task node carry no lens without a placeholder token.

---

## 2026-09-12 — Failure after a terminator cancels it; two routers instead of a mode flag

**Decision.** In `AgentLoop.executeCalls`, a command that fails after `suspend()` or `finish()` in the same pytool block cancels the termination and the run continues. `createCommandRouter({ isTaskRun })` is replaced by `createChatCommandRouter()` and `createTaskCommandRouter()`, both built from one dispatch over a terminator lookup. `AgentLoop`, `DocmemChat`, and `OpenRouterAPI.chat` take every argument explicitly; missing options throw.

**Rationale.** Folding a task as done while its final block partly failed hid the error under a summary. A mode flag re-tested inside the router is a discriminator conditional; a lookup keyed by command name keeps each variant in one place. Default parameters multiply the call shapes to test, so callers state every value.

---

## 2026-09-12 — Harness termination as a table; no default options

**Decision.** `TaskHarness` termination is a lookup table keyed by how the run ended (`TERMINATION`) applied by a pure `applyTermination(state, hasChildTasks, outcome)`; `finish` and `aborted` are the two early-exit rows. The harness takes a `credentials` accessor instead of an API factory plus default model, and every constructor option is required. Counters (`attempts`, `failures`) are written explicitly on a task's first run instead of being defaulted at each read; `retry_limit` remains the one optional key, read in a single `retryLimit()` function. A malformed state block logs a warning. The `chat` key is reused only when it names a chat root. Tree walks use a shared `Docmem.preorder(rootId, descend)` generator.

**Rationale.** Branching on the outcome kind in several places smeared each row of the spec's termination table across the function; a table keeps each row in one place and lets the table be tested without DuckDB. Default parameters multiply the conditions a test has to cover, so callers now pass every value.

## 2026-09-12 — Unterminated pytool blocks run; created docmems join the read-set

**Decision.** A ```` ```pytool ```` block with no closing fence runs to the end of the response (`extractPytoolCalls`, exported and tested). When a worker's `docmem_create` succeeds, the harness adds the new root to the live read-set and to the task's `read` key.

**Rationale.** A dump of a five-task run showed two workers whose closing fence was missing after a long `docmem_update_content`; both the edit and the `finish()` were dropped and the model was nudged for "no commands". Another worker created the story docmem and could never see it, because the read-set is built from `read` keys the user never set; it spent 78 turns reconstructing chapters from search snippets. Both are wasted spend that the framework can prevent.

## 2026-09-12 — docmem_create refuses an existing root; chat reuse check fixed

**Decision.** `docmem_create` fails when the id already names a docmem, with a message that points to `docmem_create_node` for adding to it and to the roster for picking a fresh id. The harness's chat-reuse test is `isChatRoot`, keyed on `chat_session`, the context type chat roots actually carry.

**Rationale.** A worker called `docmem_create("story")`, the id of its own task docmem, was told it succeeded, and wrote eleven paragraphs into the task tree. Opening an existing root silently is right for the framework's own constructor but wrong for a model command. The reuse check compared against `chat`, so no rerun ever continued its conversation and each attempt left an orphan chat.

## 2026-09-12: Created docmems are recorded on the task root

**Delta:** When a worker's `docmem_create` succeeds, the new root is appended to the `read` key of the task root, not of the running task.

**Rationale:** Writing to the running task only reached that task and its children. Sibling tasks queued after it (the normal pipeline: create, then revise passes) inherited nothing and ran with the story docmem outside their context; one worker rewrote the whole story from search snippets. The task root is an ancestor of every task in the docmem, so a key there reaches all later tasks. At short-story scale full visibility is the intent.

## 2026-09-12: Nudge names native tool-call markup

**Delta.** `AgentLoop`'s `nudge.message` is a function of the tool-less response. The task harness returns a markup-specific nudge when the response contains a native tool-call syntax (`<｜DSML｜>`, `<tool_call>`, `<function_calls>`, `<invoke>`), telling the model that only fenced pytool blocks run.

**Rationale.** A Flash 4.1 worker wrote every call in DeepSeek's DSML markup, including six story rewrites and repeated `finish()` calls, and never left that format across three attempts and ten generic nudges. Naming the mistake costs nothing and gives a stuck small model a way out.

## 2026-09-12: System.task advice leads with doing the work

**Delta.** The fixed instruction block after `System.task` now opens with "do the instruction yourself, then call finish(summary)". Splitting into child tasks is presented as the exception for work too large for one run, and a child must do a part of the parent's instruction, never restate it. The "around advice" framing is dropped from the worker-facing text; the mechanics (children run next, parent reruns when they fold) stay. Same length as before.

**Rationale.** A Dolphin Mistral 24B run finished every task with two story edits: each worker created a child restating its own instruction, suspended, then finished on "created a subtask". The old text led with splitting, so a small model read it as the instruction rather than an option.
