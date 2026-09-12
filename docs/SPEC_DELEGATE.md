# SPEC_DELEGATE: Agent Loop

## Purpose

AgentLoop is the reusable LLM query/response loop. It is run by the chat UI for the user-facing chat agent and by the task harness for workers (see TASK_DELEGATION_SPEC). The loop is identical in both cases; only the options differ.

## AgentLoop

### Responsibilities

- Building the message list from system prompts and chat history (via DocmemChat)
- Calling the LLM API and recording the response
- Extracting command blocks from the response
- Routing commands to the command router
- Recording command results as user-role messages
- Repeating until a termination condition is met

### Construction

`new AgentLoop(chatSession, api, commandRouter, knownCommands, options)`. Every option is required; construction throws naming the first missing key. Options are:

| option               | meaning                                                                                   |
|----------------------|-------------------------------------------------------------------------------------------|
| `summaryLine`        | short label written to the chat root's text                                               |
| `maxDepth`           | turn limit                                                                                |
| `signal`             | AbortSignal or null, checked before each model call and before each command; passed to the API |
| `nudge`              | `{ message, limit }` or null: reply to a tool-less response with `message(response)`, up to `limit` times |
| `onUserMessage`, `onAssistantMessage`, `onModelRequest` | display callbacks                                      |

### Docmem Structure

Each AgentLoop records its turns directly under the chat docmem root:

```
root (text = summaryLine)
├── message node   (user — initial message)
├── message node   (assistant)
├── message node   (user — command results)
└── ...
```

The loop MUST NOT create summary nodes. Compressing chat history is an explicit act: the agent calls `docmem_add_summary` on a range of its own messages, or the user does so from the UI. Summary nodes in a chat docmem are converted to tool-call message pairs when the message list is built (SPEC_CHAT).

### Turn Cycle

1. If the signal is aborted, reject with `AbortedError`.
2. Build the message list from the chat docmem.
3. Call the LLM API with the message list and the signal.
4. Record the response as an assistant-role node.
5. Extract command blocks. If there are none: without `nudge`, or once `limit` consecutive tool-less responses have been seen, terminate with `no_commands`; otherwise record `nudge.message(response)` as a user-role node and return to step 1.
6. Execute each command in order, checking the signal before each. A `suspend` or `finish` result is noted and execution continues with the remaining commands in the block.
7. Record the collected results as a single user-role node.
8. If `suspend` or `finish` was noted, terminate with that reason. Otherwise return to step 1.

The turn limit terminates the loop with `depth_limit`.

### Termination Result

`run()` resolves to `{ reason, summary, finalResponse, chatDocmemRootId, workDone }`:

- `reason`: `finish`, `suspend`, `no_commands`, or `depth_limit`.
- `summary`: the `finish` summary, else null.
- `finalResponse`: the last assistant response text.
- `workDone`: true when at least one command other than `suspend`/`finish` succeeded during the run.

Abort rejects with `AbortedError`. API and command execution errors that escape the router reject with the underlying error.

### Command Routing

The loop delegates every command to the router (`js/command_router.js`) and contains no command implementations. A router result is `{ success, result }` and MAY carry `terminate: 'suspend' | 'finish'` and `summary`.

Within one pytool block, a terminator takes effect after the remaining commands have executed. If a later command in the same block fails, the termination is cancelled: the failure output is suffixed with `(suspend cancelled)` or `(finish cancelled)` and the run continues with the next turn.

## Suspend and Finish Commands

`suspend()` and `finish(summary)` are system commands handled by the router. Their effect on a task run is specified in TASK_DELEGATION_SPEC. `command_router.js` exports two routers built from one dispatch over terminator handlers: `createTaskCommandRouter()`, where both commands end the run, and `createChatCommandRouter()` for the user-facing chat, where both return an error result stating they are a no-op.

## Non-Functional Requirements

- The AgentLoop MUST NOT depend on DOM elements or UI state.
- The chat UI MUST use AgentLoop rather than reimplementing the loop.
