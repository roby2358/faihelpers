# TASK_DELEGATION_SPEC: Task Docmem and Harness

Status: DRAFT. Open questions are collected at the end.

## Purpose

Replace synchronous delegation (a parent agent blocking on a child agent, see SPEC_DELEGATE) with a job model patterned after Sidekiq. Work to be done lives in a single task docmem as a tree of task nodes. A harness owns that docmem for its lifetime, repeatedly picks the next task in depth-first order, runs an agent on it, and hands control back to the tree. Agents shape the tree as they go: they decompose a task by adding child tasks, defer a task by moving it, and finish a task by folding it under a summary node. There is no call stack and no master agent; all state is in the docmem.

## Concepts

### Task docmem

One docmem whose nodes are tasks. The harness is bound to exactly one task docmem for its lifetime and always looks there for work. The root is not a task.

### Task node

A node with `context_type = task`. Its text begins with a state block, then the instruction. A task node MAY have child task nodes; children are subtasks that run before the parent is revisited.

### Summary node

A node with `context_type = summary` inserted above a finished task, using the docmem summarize operation (SPEC_DOCMEM, Summary Operations; the operation accepts non-leaf nodes). Its text is the result summary; the original task subtree is preserved beneath it. The harness never descends into a summary node, and context serialization omits its children, so the tree compresses as work completes.

### State block

A loose `{key=value, key=value}` block at the start of a task node's text. Both the harness and agents read and write it. The format is deliberately informal because agents interpret it; only the key names are conventional.

### Harness

Plain JavaScript that owns the task docmem, selects the next task, constructs an AgentLoop for it, and updates the state block around the run. It is the only component that dequeues.

### Around advice

An agent treats its task node as advice wrapped around the subtree beneath it. On first visit it MAY plan: create child tasks, then suspend. Children then run in order. When every child has been folded into a summary, the parent is visited again and finishes with the children's summaries in view. A task with no children is visited once.

### Read-set

The list of docmems or nodes expanded into a worker's context beyond the defaults. Its two uses:

- Scoping: today every non-chat docmem is expanded into every turn (SPEC_CHAT). Under this spec a worker sees only the root prompt, its lens, the task docmem, and what its read-set names.
- Peeking: summary nodes are normally shown without their children. Naming a summary node (or any node beneath one) in the read-set expands that subtree, so a task can look inside folded work when it needs the detail.

A task inherits the read-sets of its ancestors.

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
- Task: `context_type = task`, `context_name` the lens or pass name (MAY be empty), `context_value` unused (reserved).
- Summary: `context_type = summary`, `context_name = task`, `context_value = done` or `failed`.
- Task nodes MUST be written with `readonly = 0`. The harness and agents both update them.
- Each task's `context_name` names a lens (optional). The harness passes it through; lens docmems are specified elsewhere.

### State block

- The state block MUST be the first thing in the task text: an opening `{`, zero or more `key=value` pairs separated by commas, a closing `}`. Whitespace around commas and `=` is insignificant. The instruction follows after a newline.
- Keys are lowercase identifiers. Values are integers or short tokens with no commas or braces.
- A list value is space-separated: `read=abc123 def456`. Commas are reserved for separating pairs. Example: `{status=queued, attempts=0, read=abc123 def456}`.
- The harness MUST parse the block leniently: unknown keys are preserved untouched, a missing block is treated as `{status=queued}`, and a malformed block is treated as empty with a warning.
- The harness MUST rewrite the block in place (same position, same unknown keys) when it updates its own keys, and MUST NOT touch the instruction text.

Conventional keys:

| key        | written by      | meaning                                                          |
|------------|-----------------|------------------------------------------------------------------|
| `status`   | harness, agent  | `queued`, `running`, `waiting`, `done`, `failed`                  |
| `attempts` | harness         | number of times the harness has started this task                 |
| `failures` | harness         | number of runs that ended in an error or depth limit              |
| `model`    | agent, user     | OpenRouter model id override for this task                        |
| `chat`     | harness         | chat docmem root id used for this task; reused on revisit         |
| `read`     | agent, user     | read-set: space-separated docmem root or node ids to expand       |
| `yields`   | harness         | consecutive runs that ended as a plain yield (no work done)       |
| `updated`  | harness         | ISO8601 time of the harness's last write to this block            |

Agents MAY add keys of their own (for example a `notes` counter or a `phase` token); the harness carries them along.

`attempts` counts every harness start of the task, including the planned revisit of a `waiting` parent, so it is not a retry counter; `failures` and `yields` are.

### Who writes when

The harness and the agent never write the task docmem at the same time. The harness is single-threaded: it writes the state block before the run, hands the docmem to the agent, and does not touch it again until the run ends. During the run the agent is the only writer, through the docmem tools. When the run ends the harness re-reads the task node (the agent may have moved it, added keys, or created children) and rewrites only its own keys. The `status` the harness writes at termination takes precedence over any `status` the agent wrote.

## Task Selection

- The harness MUST select the first eligible task in preorder depth-first traversal of the task docmem, honoring node order.
- The traversal MUST NOT descend into summary nodes.
- A task is eligible when either:
  - `status` is `queued` (a missing status counts as `queued`); or
  - `status` is `waiting` and every child task has been folded into a summary node (no child with `context_type = task` remains).
- Tasks with `status` `running`, `done`, or `failed` are not eligible. A `waiting` task with unfinished children is skipped, but its children are traversed.
- If no task is eligible the harness MUST go idle and report it.

Preorder means a parent is reached before its children. This is what makes around-advice work: the parent plans on first visit, then its children run, then the parent is reached again as `waiting` and finishes.

## Running a Task

For the selected task the harness MUST:

1. Set `status=running`, increment `attempts`, set `updated`, and write the state block.
2. Resolve the chat docmem: reuse the root id in `chat` if present and it still exists; otherwise create a fresh chat docmem (id prefixed `chat_`) and record it in `chat`. A revisited task continues its own conversation and remembers what it planned. Chat docmems are retained after the task folds; a retention policy is out of scope for this spec.
3. Resolve the API client: use `model` from the state block when present, otherwise the harness's default model.
4. Build the worker's context (see Worker Context) and run an AgentLoop seeded with the task message.
5. Interpret the termination (see Termination) and write the resulting state block.
6. Return to Task Selection.

### Worker context

The worker's message list follows SPEC_CHAT with these differences:

- The docmem context messages MUST include the whole task docmem, expanded from its root, with summary nodes shown but their children omitted (the normal summary rule). The agent therefore sees where the work stands: what is folded, what is queued, and its own position in the tree.
- The docmem context messages MUST include every docmem or node named in the task's `read` key, and the `read` keys of its ancestors, expanded from the named node. A named node inside a summary MUST be expanded even though the summary rule would otherwise omit it (peeking). If no `read` key is present anywhere on the path, the worker sees only the root prompt and the task docmem.
- The lens named in `context_name`, if any, is included as a system prompt docmem after the root prompt (lens docmems are specified elsewhere).
- Other docmems are NOT included. This is the read-set scoping described under Concepts.

### Task message

The seeded user message MUST be a pretend invocation in the established style:

```
$ System.task("<task_node_id>")

<task_node_id> task:<lens>:
{status=running, attempts=1, chat=chat_..., ...}
<instruction text>
```

followed by a short fixed instruction block explaining around-advice, the state block, and the `suspend` and `finish` commands. The task node id and the chat docmem root id appear in the message so the agent can address its own node and its own chat with the docmem tools. Ancestor tasks are not repeated in the message because they are already visible in the task docmem context.

## Suspend and Finish Commands

`suspend()` and `finish(summary)` replace both `delegate` and `complete`.

- `suspend()` MUST end the current run without folding. The harness then sets `status` according to the tree: `waiting` if the task now has child tasks, otherwise `queued`. Use it after planning children, after moving the task to run later, or to yield when the agent has done a bounded chunk of work and wants the tree re-evaluated.
- `finish(summary)` MUST end the run and fold the task: the harness inserts a summary node above the task node with the summary text, `context_type=summary`, `context_name=task`, `context_value=done`, and sets the task's `status=done`. The task subtree is preserved beneath the summary. `summary` is required. Its content is at the agent's discretion; it SHOULD say what was done in enough detail that later tasks and the parent need not peek beneath the summary.
- Both MUST take effect after the remaining commands in the same pytool block have executed, mirroring today's `complete`.
- A run that ends without either command is a plain yield, equivalent to `suspend()` (see Yield Without Suspend).

### Deferring

An agent defers a task by calling `docmem_move_node` on its own task node (for example `after` a later sibling, or `append-child` under a later task) and then `suspend()`. The task stays `queued` and is picked up when the traversal reaches its new position. Selection always restarts from the root, so a task deferred to an earlier position simply runs again next; defer by moving later. Moving a task under a summary node hides it from the harness permanently. Moving a child out from under a `waiting` parent makes the parent eligible if no other child tasks remain.

### Decomposing

An agent decomposes by creating child task nodes under its own task node (each with a state block, typically `{status=queued}`), then `suspend()`. The harness marks the parent `waiting`, runs the children in order, and revisits the parent once all children are folded.

## Termination and Failure

- `finish(summary)` → `done` (folded).
- `suspend()` or a yield without suspend → `queued` or `waiting` as above.
- API error, execution error, or AgentLoop depth limit → increment `failures`. If `failures` is below the retry limit set `status=queued`, so the task is retried on a later pass. A task reset to `queued` runs before its own children (preorder), even if the failed run created some; the reused chat lets the agent see what it already did; otherwise set `status=failed` and fold the task under a summary node whose `context_value=failed` and whose text is the error.
- Default retry limit is 3. It MAY be overridden per task with a `retries` key.
- A `failed` task is never selected again unless the user or an agent resets its status.

Failed tasks are folded so that the tree still compresses and later tasks still see what went wrong.

### Yield without suspend

A response with no pytool block does not end the run by itself. The harness MUST reply with a fixed nudge (a `$ System.turn()`-style user message reminding the agent to act or call `suspend`/`finish`) and let the model continue. After a configurable number of consecutive tool-less responses (default 3) the run ends as a plain yield: the task is set to `queued` or `waiting` exactly as for `suspend()`, `yields` is incremented, and it is not counted as a failure. The nudge messages and the model's tool-less replies are recorded in the task's chat docmem like any other turn.

A task whose `yields` reaches the retry limit is folded under a summary with `context_value=failed` and text noting no progress, exactly as a failed task. This is the guard against a task that reruns forever without acting.

`suspend()` does not count as work. A run in which the only command executed was `suspend()` is a plain yield and increments `yields`. A run that executed any other command before suspending resets `yields` to 0, as does `finish()`. So `docmem_create_node(...)` then `suspend()` is progress; `suspend()` alone three runs in a row folds the task as failed.

## Stop and Run

- The harness has two states: running and stopped. Run starts the selection loop; Stop halts it.
- Stop MUST abort the in-flight AgentLoop at the next safe point via an AbortController, which also cancels any in-flight OpenRouter request. The interrupted task's `status` MUST be reset from `running` to `queued`; its `chat` key is kept so the next Run picks it up first and continues the same conversation where it left off. Children created before the interruption stay in place and run after the parent, as in the failure case.
- Run MUST re-read the task docmem before selecting, so edits made while stopped (by the user or by the chat agent) take effect.
- Run MUST reset every task with `status=running` to `queued` before selecting. A `running` status can only be stale: left by a TOML snapshot taken mid-run, a reload, or a crash. Without this reset such a task would never be eligible again.
- When no task is eligible the harness goes idle but remains in the running state; Run after adding tasks resumes selection.
- Stop and Run live on the Tasks panel.

## Relationship to the Chat Agent

The user-facing chat agent is not run by the harness. It MAY enqueue work by creating task nodes in the task docmem with `docmem_create_node`; it finds the task docmem's root id in its own context, where the task docmem appears like any other docmem. The user then runs the harness. The chat agent can read the summaries as they appear.

## Worker Permissions

Every worker has every command. There is no per-task capability restriction: child tasks are expected to edit the same docmems their parents edit, and a worker MAY write to any docmem by id, including ones outside its read-set. A worker MAY also create sibling tasks after itself to enqueue follow-up work, in addition to creating children.

## Supersedes

- SPEC_DELEGATE: the `delegate` and `complete` commands are removed. AgentLoop is retained except that `complete` handling becomes `suspend`/`finish` handling and tool-less responses are nudged before yielding.
- SPEC_AGENTS: superseded by this spec for agent orchestration.

## Non-Functional Requirements

- The harness MUST NOT depend on DOM elements; the Tasks panel drives it through method calls and callbacks.
- All harness operations MUST be async.
- The harness MUST run tasks strictly sequentially.
- The task docmem MUST round-trip through TOML save and load with no harness-specific side tables; everything the harness needs is in node text and context fields.

## Open Questions

None at present.
