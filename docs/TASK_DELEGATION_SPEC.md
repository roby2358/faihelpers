# TASK_DELEGATION_SPEC: Task Docmem and Harness

## Purpose

Replace synchronous delegation (a parent agent blocking on a child agent) with a job model patterned after Sidekiq. Work to be done lives in a single task docmem as a tree of task nodes. A harness owns that docmem for its lifetime, repeatedly picks the next task in depth-first order, runs a worker on it, and hands control back to the tree. Workers shape the tree as they go: they decompose a task by adding child tasks, defer a task by moving it, and finish a task by folding it under a summary node. There is no call stack and no master agent; all state is in the docmem. See Supersedes for what this replaces.

## Concepts

- **Task docmem**: one docmem whose nodes are tasks. The harness is bound to exactly one task docmem for its lifetime. The root is not a task.
- **Task node**: a node with `context_type = task`. Its text begins with a state block, then the instruction. Children are subtasks.
- **Summary node**: a node with `context_type = summary` inserted above a finished task by folding. The original task subtree is preserved beneath it. The harness never descends into a summary node, and context serialization omits its children, so the tree compresses as work completes.
- **Fold**: the docmem summarize operation (SPEC_DOCMEM, Summary Operations; it accepts non-leaf nodes) applied to a task node. Folding is what removes a task from the harness's traversal.
- **State block**: a `{key=value, ...}` block at the start of a task node's text, read and written by both the harness and workers. Specified under Task Docmem Structure.
- **Harness**: plain JavaScript (`TaskHarness` in `js/task_harness.js`) that selects the next task, constructs an AgentLoop for it, and updates the state block around the run. It is the only component that dequeues.
- **Worker**: the agent the harness runs on a task, as distinct from the user-facing chat agent. A worker is an AgentLoop over the task's chat docmem.
- **Run**: one execution of a worker on one task, from the harness writing `status=running` to the harness writing the terminal state. `attempts` counts runs. Every run ends in exactly one of the ways listed under Termination.
- **Chat docmem**: the conversation docmem for one task, created on the task's first run and reused on every later run, so a revisited task remembers what it planned.
- **Lens**: a docmem included as a system prompt for the worker, named by the task node's `context_name`. Lens docmems are specified elsewhere; the harness passes the name through.
- **Around advice**: a worker treats its task node as advice wrapped around the subtree beneath it. On first run it MAY plan: create child tasks, then suspend. Children then run in order. When every child has been folded, the parent runs again and finishes with the children's summaries in view. A task with no children runs once.
- **Read-set**: the nodes expanded into a worker's context beyond the defaults, named in the `read` key. Specified under Worker Context.

## Task Docmem Structure

```
root            context_type=task_list  context_name=<name>  context_value=<ISO8601 created>
├── summary     context_name=task  context_value=done   (folded: children hidden in context)
│   └── task    {status=done ...}   original task and any subtasks beneath
├── task        {status=queued, attempts=0, failures=0}
│   ├── task    {status=queued ...}
│   └── task    {status=queued ...}
└── task        {status=queued ...}
```

- Root: `context_type = task_list`, `context_name` a human label, `context_value` the ISO8601 creation timestamp.
- Task: `context_type = task`, `context_name` the lens name (MAY be empty), `context_value` unused (reserved).
- Summary: `context_type = summary`, `context_name = task`, `context_value = done` or `failed`. The summary node is the authoritative record that a task finished and how; the `status` left on the task node beneath it is archival. Nothing beneath a summary is ever executed: the harness does not descend into summaries, and anything that does is outside this spec.
- Task nodes MUST be written with `readonly = 0`. The harness and workers both update them.

### State block

- The state block MUST be the first thing in the task text: an opening `{`, zero or more `key=value` pairs separated by commas, a closing `}`. Whitespace around commas and `=` is insignificant. The instruction follows after a newline.
- Keys are lowercase identifiers. Values are integers or short tokens with no commas or braces. The format is deliberately informal because agents interpret it; only the key names are conventional.
- A list value is space-separated: `read=abc123 def456`. Commas are reserved for separating pairs. Example: `{status=queued, attempts=0, read=abc123 def456}`.
- The harness MUST parse the block leniently: unknown keys are preserved untouched, a missing block is treated as `{status=queued}`, and a malformed block is treated as empty with a warning.
- The harness MUST rewrite the block in place (same position, same unknown keys) when it updates its own keys, and MUST NOT touch the instruction text.

Conventional keys:

| key           | written by      | meaning                                                          |
|---------------|-----------------|------------------------------------------------------------------|
| `status`      | harness, worker | `queued`, `running`, `waiting`, `done`, `failed`                  |
| `attempts`    | harness         | number of runs started; informational, no rule reads it           |
| `failures`    | harness         | consecutive runs that ended without progress (error, depth limit, or plain yield) |
| `retry_limit` | worker, user    | per-task limit on `failures` (default 3)                          |
| `model`       | worker, user    | OpenRouter model id override for this task                        |
| `chat`        | harness         | chat docmem root id for this task; reused on every run            |
| `read`        | worker, user    | read-set: space-separated node ids to expand                      |
| `updated`     | harness         | ISO8601 time of the harness's last write to this block            |

Workers MAY add keys of their own (for example a `notes` counter or a `phase` token); the harness carries them along.

`attempts` counts every run, including the planned revisit of a `waiting` parent, so it is not a retry counter; `failures` is.

### Who writes when

The harness and the worker never write the task docmem at the same time. The harness is single-threaded: it writes the state block before the run, hands the docmem to the worker, and does not touch it again until the run ends. During the run the worker is the only writer, through the docmem tools. When the run ends the harness re-reads the task node (the worker may have moved it, added keys, or created children) and rewrites only its own keys. The `status` the harness writes at termination takes precedence over any `status` the worker wrote.

## Task Selection

- The harness MUST select the first eligible task in preorder depth-first traversal of the task docmem, honoring node order. Preorder reaches a parent before its children, which is what makes around advice work.
- The traversal MUST NOT descend into summary nodes.
- A task is eligible when either:
  - `status` is `queued` (a missing status counts as `queued`); or
  - `status` is `waiting` and every child task has been folded (no child with `context_type = task` remains).
- Tasks with `status` `running`, `done`, or `failed` are not eligible. A `waiting` task with unfinished children is skipped, but its children are traversed.
- `waiting` is the only status whose eligibility depends on the tree shape. It exists to distinguish a parent that suspended cleanly after planning children (run after them) from a task whose interrupted run left children behind (run before them, see Termination).
- If no task is eligible the harness MUST go idle and report it.

## Running a Task

For the selected task the harness MUST:

1. Set `status=running`, increment `attempts`, set `updated`, and write the state block.
2. Resolve the chat docmem: reuse the root id in `chat` if present and it still exists; otherwise create a fresh chat docmem (id prefixed `chat_`) and record it in `chat`. Chat docmems are retained after the task folds; a retention policy is out of scope for this spec.
3. Resolve the API client: use `model` from the state block when present, otherwise the harness's default model.
4. Build the worker's context (see Worker Context) and run an AgentLoop seeded with the task message.
5. Write the state block according to Termination.
6. Return to Task Selection.

### Worker context

The worker's message list follows SPEC_CHAT with these differences:

- The docmem context messages MUST include the whole task docmem, expanded from its root, with summary nodes shown but their children omitted (the normal summary rule). The worker therefore sees where the work stands: what is folded, what is queued, and its own position in the tree.
- The docmem context messages MUST include every node named in the task's `read` key and in the `read` keys of its ancestors up to and including the task docmem root, expanded from the named node. This is the read-set. A named node inside a summary MUST be expanded even though the summary rule would otherwise omit it, so a task can peek inside folded work when it needs the detail.
- The lens named in `context_name`, if any, is included as a system prompt docmem after the root prompt.
- Other docmems are NOT included: a worker sees only the root prompt, its lens, the task docmem, and its read-set. The roster message still lists every non-chat root so a worker can address any docmem by id.

### Task message

The seeded user message MUST be a pretend invocation in the established style:

```
$ System.task("<task_node_id>", chat="<chat_root_id>")
```

followed by a short fixed instruction block explaining around advice, the state block, and the `suspend` and `finish` commands. The task node itself, with its state block and instruction, is not repeated because it is already visible in the task docmem context; the message carries the two ids so the worker can address its own node and its own chat with the docmem tools.

## Suspend and Finish Commands

`suspend()` and `finish(summary)` replace both `delegate` and `complete`.

- `suspend()` ends the current run without folding. Use it after planning children, after moving the task to run later, or to yield after a bounded chunk of work so the tree is re-evaluated.
- `finish(summary)` ends the run and folds the task. `summary` is required. Its content is at the worker's discretion; it SHOULD say what was done in enough detail that later tasks and the parent need not peek beneath the summary.
- Both MUST take effect after the remaining commands in the same pytool block have executed. A failing command later in the block cancels the termination (see SPEC_DELEGATE).

### Deferring

A worker defers a task by calling `docmem_move_node` on its own task node (for example `after` a later sibling, or `append-child` under a later task) and then `suspend()`. The task stays `queued` and is picked up when the traversal reaches its new position. Selection always restarts from the root, so a task deferred to an earlier position simply runs again next; defer by moving later. Moving a task under a summary node hides it from the harness permanently. Moving a child out from under a `waiting` parent makes the parent eligible if no other child tasks remain.

### Decomposing

A worker decomposes by creating child task nodes under its own task node (each with a state block, typically `{status=queued}`), then `suspend()`. The harness marks the parent `waiting`, runs the children in order, and runs the parent again once all children are folded.

## Termination

Every run ends in exactly one of these ways. The harness writes the state block accordingly and, where noted, folds the task.

| how the run ended                          | counters                        | resulting status                     | fold            |
|--------------------------------------------|---------------------------------|--------------------------------------|-----------------|
| `finish(summary)`                          | `failures=0`                    | `done`                               | `done`, summary |
| `suspend()` after other commands           | `failures=0`                    | `waiting` if child tasks, else `queued` | none         |
| bare `suspend()` (only command in the run) | `failures+1`                    | as above                             | none            |
| three consecutive tool-less responses      | `failures+1`                    | as above                             | none            |
| Stop (AbortController)                     | none                            | `queued`                             | none            |
| API error, execution error, depth limit    | `failures+1`                    | `queued`                             | none            |
| `failures` reaches the retry limit         |                                 | `failed`                             | `failed`, reason |

- The retry limit defaults to 3 and MAY be overridden per task with the `retry_limit` key. `failures` counts consecutive unproductive runs; a run that does work resets it, so a task that alternates progress and errors is not folded as failed.
- The `failed` summary's reason is the error text when the last run ended in an error or depth limit, and "no progress" when it ended as a plain yield.
- Folding inserts a summary node above the task node with `context_type=summary`, `context_name=task`, and `context_value` as shown. Failed tasks are folded so the tree still compresses and later tasks see what went wrong.
- A task returned to `queued` runs before its own children (preorder), even if the interrupted or failed run created some. Its `chat` key is kept, so the worker continues the same conversation and sees what it already did. The harness reuses the `chat` key only when it names an existing chat root; otherwise it starts a new chat and rewrites the key.
- A `failed` task is never selected again unless the user or an agent resets its status.
- `suspend()` does not count as work: `docmem_create_node(...)` then `suspend()` is progress; `suspend()` alone three runs in a row folds the task as failed. This is the guard against a task that reruns forever without acting.

### Tool-less responses

A response with no pytool block does not end the run by itself. The harness MUST reply with a fixed nudge (a `$ System.turn()`-style user message reminding the worker to act or call `suspend`/`finish`) and let the model continue. After a configurable number of consecutive tool-less responses (default 3) the run ends as a plain yield per the table. The nudge messages and the model's tool-less replies are recorded in the task's chat docmem like any other turn.

## Start and Stop

- The harness has three states: started (a run is in progress), idle (started but no task is eligible), and stopped. Start begins the selection loop; Stop halts it. Both live on the Tasks panel.
- Stop MUST abort the in-flight AgentLoop at the next safe point via an AbortController, which also cancels any in-flight OpenRouter request. The aborted run terminates per the table.
- Start MUST re-read the task docmem before selecting, so edits made while stopped (by the user or by the chat agent) take effect.
- Start MUST reset every task with `status=running` to `queued` before selecting. A `running` status at that point can only be stale: left by a TOML snapshot taken mid-run, a reload, or a crash. Without this reset such a task would never be eligible again.
- When no task is eligible the harness goes idle; Start after adding tasks resumes selection.

## Relationship to the Chat Agent

The user-facing chat agent is not run by the harness. It MAY enqueue work by creating task nodes in the task docmem with `docmem_create_node`; it finds the task docmem's root id in its own context, where the task docmem appears like any other docmem. The user then starts the harness. The chat agent can read the summaries as they appear.

## Worker Permissions

Every worker has every command. There is no per-task capability restriction: child tasks are expected to edit the same docmems their parents edit, and a worker MAY write to any docmem by id, including ones outside its read-set. A worker MAY also create sibling tasks after itself to enqueue follow-up work, in addition to creating children.

## Supersedes

- SPEC_DELEGATE: the `delegate` and `complete` commands are removed. AgentLoop is retained except that `complete` handling becomes `suspend`/`finish` handling and tool-less responses are nudged before yielding.
- SPEC_AGENTS: superseded by this spec for agent orchestration.

## Non-Functional Requirements

- The harness MUST NOT depend on DOM elements; the Tasks panel drives it through method calls and callbacks.
- The harness MUST run tasks strictly sequentially.
- The task docmem MUST round-trip through TOML save and load with no harness-specific side tables; everything the harness needs is in node text and context fields.
