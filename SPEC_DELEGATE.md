# SPEC_DELEGATE: Agent Loop and Delegation

## Purpose

The current LLM query/response loop is embedded in the chat UI module. This specification defines how to extract that loop into a reusable AgentLoop class and expose a `delegate` command that allows a model to spawn a sub-agent. The sub-agent creates its own chat docmem, runs the loop autonomously (model-initiated rather than user-initiated), and returns its results to the parent agent. This aligns with the agent model described in SPEC_AGENTS.md.

## Concepts

### AgentLoop

An AgentLoop encapsulates a single turn cycle: build a message list, call the LLM, record the response, execute any commands found in the response, feed results back, and repeat until the model produces a response with no commands. The loop is identical whether the first message originates from a human user or from a parent agent's delegation.

### Delegation

Delegation is the act of one agent (the parent) spawning another agent (the child) to perform a scoped task. The parent provides a task prompt. The child runs its own AgentLoop and signals completion by issuing a `complete` command with a required summary. Control then returns to the parent, which receives the summary of the child's work.

### Agent Identity

Each agent is identified by the root ID of its chat docmem. The parent agent's chat docmem root ID is the parent agent's identity. The child agent's chat docmem root ID is the child agent's identity.

## AgentLoop

### Responsibilities

The AgentLoop MUST encapsulate the following concerns:

- Building the message list from system prompts and chat history
- Calling the LLM API and recording the response
- Extracting command blocks from the response
- Routing commands to the appropriate handler
- Recording command results as user-role messages
- Repeating until no commands remain or a termination condition is met

### Lifecycle

- An AgentLoop MUST be constructed with a DocmemChat instance and an API client instance.
- An AgentLoop MUST accept an initial message that seeds the first user-role turn.
- An AgentLoop MUST run until one of the following termination conditions:
  - The model produces a response containing no command blocks.
  - The model issues a `complete` command.
  - The depth limit is reached.
- The AgentLoop MUST return a result object when it terminates (see Termination Result below).

### Message List Construction

- The AgentLoop MUST delegate message list construction to DocmemChat's `buildMessageList` method.
- The message list MUST include system messages (root prompt, tool prompts, non-chat docmems) followed by chat messages, as specified in SPEC_CHAT.md.

### Turn Cycle

A single turn MUST proceed as follows:

1. Build the message list from the chat docmem.
2. Call the LLM API with the message list.
3. Record the response as an assistant-role node in the chat docmem.
4. Extract command blocks from the response.
5. If no command blocks exist, terminate the loop.
6. Execute each command and collect results.
7. Record the collected command results as a single user-role node in the chat docmem.
8. If a `complete` command was among the executed commands, terminate the loop.
9. Otherwise, return to step 1.

### Depth Limit

- The AgentLoop MUST enforce a configurable maximum turn depth.
- The default depth limit MUST be 100 turns.
- When the depth limit is reached, the loop MUST terminate and MUST include a depth-limit indicator in its result.

### Termination Result

When the loop terminates, the AgentLoop MUST return a result containing:

- The reason for termination: `complete`, `no_commands`, or `depth_limit`.
- The summary text from the `complete` command (if termination reason is `complete`).
- The final assistant response text (returned for all termination reasons).
- The chat docmem root ID (the agent's identity).

The `no_commands` termination MUST be treated equivalently to `complete` — the final assistant response serves as the result. This covers cases where the model finishes its work without explicitly issuing `complete`.

### Command Routing

- The AgentLoop MUST accept a command router that maps command names to handler functions.
- The AgentLoop MUST NOT contain command implementations directly; it MUST delegate to the router.
- The command router MUST support registration of the `delegate` and `complete` commands alongside existing docmem and system commands.

## Delegate Command

### Command Signature

The delegate command MUST be invoked as:

```
delegate <task-prompt>
```

- `task-prompt`: A text string describing the task for the child agent. MUST be provided. MAY be multi-line (triple-quoted).

### Child Agent Setup

When the delegate command is executed, the system MUST:

1. Generate a unique chat docmem root ID for the child agent (prefixed with `chat_`).
2. Create a new chat docmem with that root ID.
3. Create a new DocmemChat instance bound to the child's chat docmem.
4. Record the parent agent's chat docmem root ID as the child's predecessor.
5. Create a new AgentLoop for the child with the same API client and model as the parent.

### Child Agent Context

The child agent's chat docmem is a fresh docmem that the child owns. It is visible in the View and Persist panels like any other docmem.

The delegation system message MUST be stored as a node in the child's chat docmem. The child's message list is then built through the standard DocmemChat mechanism, which MUST include:

- The same root system prompt as the parent (the shared root prompt docmem).
- The same tool prompts (bash prompt, system prompt, docmem prompt) as the parent.
- The delegation system message (stored in the child's chat docmem) containing:
  - The task prompt provided by the parent.
  - The parent agent's identity (chat docmem root ID).
  - An instruction that the agent MUST issue `complete` with a summary when the task is done.
- Non-chat docmems, included via the existing system message mechanism (SPEC_CHAT.md).
- The child's own chat history.

The child agent MUST NOT receive the parent's chat history as context.

### Child Agent Execution

- The child agent's AgentLoop MUST be started with the task prompt as the initial user-role message.
- The child agent MUST have access to the same command set as the parent, including the `delegate` command (enabling recursive delegation).
- The child agent MUST signal completion by issuing the `complete` command with a summary.

### Execution Model

- Delegation MUST be synchronous from the parent's perspective: the parent's loop MUST suspend while the child runs.
- The parent's turn cycle MUST NOT advance until the child's AgentLoop terminates.
- Agents MUST NOT run in parallel (as specified in SPEC_AGENTS.md).

### Return to Parent

When the child's AgentLoop terminates, the delegate command MUST return a result to the parent containing:

- The child agent's chat docmem root ID (identity).
- The termination reason (`complete`, `no_commands`, or `depth_limit`).
- The summary text from the `complete` command (if termination reason is `complete`), or the final assistant response text (for `no_commands` or `depth_limit`).

The result MUST be formatted as a command result string, prepended with the child's chat docmem root ID. For example: `"chat_abc123: I finished the work to..."`. This result MUST be recorded in the parent's chat docmem as a user-role message, following the same pattern as other command results.

## Complete Command

### Command Signature

The complete command MUST be invoked as:

```
complete <summary>
```

- `summary`: A text string summarizing the work performed. MUST be provided. MAY be multi-line (triple-quoted).

### Behavior

- The complete command MUST cause the current AgentLoop to terminate after the current turn's command processing completes.
- The summary MUST be included in the termination result returned to the parent.
- If the complete command is issued by the root agent (the user-facing chat), it MUST be treated as a no-op with a warning, since there is no parent to return to.

## Delegation System Message

The delegation system message provided to the child agent MUST contain the following information:

- A header identifying this as a delegated task.
- The task prompt exactly as provided by the parent.
- The parent agent's identity.
- An instruction that the agent MUST issue `complete` with a summary when the task is done.

## Recursive Delegation

- A child agent MAY issue `delegate` commands to create grandchild agents.
- The delegation depth MUST NOT be limited beyond the per-agent turn depth limit.
- Each level of delegation MUST block its parent until the child terminates.
- Each child agent MUST have its own independent chat docmem and turn cycle.

## Docmem Visibility

- Any agent MUST have full read and write access to all docmems in the system.
- Non-chat docmems (IDs not prefixed with `chat_`) MUST be included in every agent's system messages via the existing inclusion mechanism (SPEC_CHAT.md).
- There is no access control or scoping between agents. The task prompt is the sole mechanism for directing what a child agent works on.

## Error Handling

- If the child agent's API call fails, the error MUST propagate to the parent as a failed command result.
- If the child agent exceeds its depth limit without issuing `complete`, the parent MUST receive a result indicating `depth_limit` termination.
- If the child agent's chat docmem creation fails, the delegate command MUST fail with an error.

## Non-Functional Requirements

- The AgentLoop MUST NOT depend on DOM elements or UI state. It MUST be usable without a browser UI.
- The AgentLoop MUST NOT import from or reference UI modules.
- The chat UI MUST use AgentLoop internally rather than reimplementing the loop.
- All AgentLoop operations MUST be async.

## Dependencies

- DocmemChat (existing, from `docmem_chat.js`)
- OpenRouterAPI (existing, from `OpenRouterAPI.js`)
- Command parser (existing, from `command_parser.js`)
- DocmemCommands (existing, from `docmem_commands.js`)
- SystemCommands (existing, from `system_commands.js`)

## Implementation Notes

- The current loop logic lives in `chat.js` functions: `sendMessage`, `invokeModelAndRecordResponse`, `processCommands`, `extractRunSections`, `executeCommand`, `executeDocmemCommand`, `executeSystemCommand`. These MUST be factored into the AgentLoop class.
- The chat UI (`chat.js`) MUST become a thin wrapper that creates an AgentLoop for the user-facing agent and bridges UI events to AgentLoop method calls. The Send button passes the user's input as the initial message. The Continue button passes "Please continue" as the initial message.
- DocmemChat already handles message list construction (`buildMessageList`). The AgentLoop MUST reuse this rather than reimplementing it.
- The delegation system message MUST be stored as a node in the child's chat docmem, so the standard DocmemChat message list construction picks it up automatically.
- The `delegate` command is itself a command handler, so it participates in the same `processCommands` cycle as docmem commands. When the handler runs, it blocks the parent's loop by awaiting the child's entire AgentLoop run.

## Current Limitations

- Parallel delegation is NOT REQUIRED (agents run sequentially as specified in SPEC_AGENTS.md).
- Token budget management across delegation depth is NOT REQUIRED.
- Automatic summarization of child results is NOT REQUIRED.
- Persistence of agent relationships across page reloads is NOT REQUIRED (inherits the existing in-memory limitation).
