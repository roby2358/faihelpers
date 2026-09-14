# Chat Spec

The chat page is arranged this way:
- A scrolling chat area above, where messages are displayed console style as
```
user> Hello!
assistant> Hi there!
```
  - no special formatting, it's just a plain text area with console-style messages
- The chat session is represented by a docmem with the following structure
  - root: context_type=chat_session, context_name=date, context_value=ISO8601 timestamp
  - summary (optional): context_type=summary, context_name=role, context_value=tool
  - leaf: context_type=message, context_name=role, context_value=user|assistant

The user enters their message in the input box and clicks the send button. It gets appended to the root node as a leaf node as above.

We build the context to the LLM by iterating over the children of the root, from oldest to newest. If there's a summary node, we do not go down into its children, but include it as a tool node.

When the response comes back from the LLM, we append it as a leaf node in the above format.

## System Prompt Context from Docmems

For each turn in the chat, the framework MUST include additional context from non-chat docmems as system messages. Which docmems depends on the DocmemChat's read-set:

- No read-set (the user-facing chat agent): every non-chat docmem, as enumerated below.
- A read-set (task workers, TASK_DELEGATION_SPEC): only the nodes named in the read-set, each expanded from the named node with no focus applied. A named node is expanded even when it lies beneath a summary node.

A DocmemChat MAY also name a lens docmem. The lens is serialized as a system message with the same shape as the root prompt message and placed immediately after it.

1. The framework MUST enumerate all existing docmem instances using `Docmem.getAllRoots()`
2. For each docmem where the docmem ID does NOT start with "chat_" (i.e., excludes chat-related docmems) and is NOT the root prompt docmem (which is already included, serialized, as the main system prompt):
   - The framework MUST determine the expansion start node: the docmem's focus node if one is set (see Docmem Focus below), otherwise the docmem root
   - The framework MUST run `expandToLength(startNodeId, 20000)` to expand the docmem to a maximum of 20000 tokens. Expansion shows summary nodes but not their children (SPEC_DOCMEM, Expansion).
   - The system message carries no header line: the first node block's metadata line names the start node, so the message is self-identifying. The root prompt system message is likewise the bare serialized root prompt.
   - If the docmem is focused, the message MUST carry a focus marker as its first line, naming the focus node and the docmem root and pointing to `docmem_focus("<docmemId>", "<docmemId>")` to restore the full tree (e.g., `[focus: showing only the subtree of <focusNodeId> within docmem <docmemId>; call docmem_focus("<docmemId>", "<docmemId>") to restore the full tree]`). An unfocused docmem MUST NOT carry a focus marker.
   - If the expansion was truncated by the token budget (fewer nodes returned than the subtree contains), the system message MUST carry a truncation marker as its first line (after the focus marker, if any), followed by a blank line before the node blocks, stating how many of the total nodes are shown and pointing to `docmem_structure` for the omitted subtrees (e.g., `[partial: 42 of 97 nodes shown (token budget); call docmem_structure("<startNodeId>") to see the omitted subtrees]`). The marker MUST lead the message rather than trail it, because breadth-first expansion omits scattered deeper/older subtrees, not a contiguous tail. A complete expansion MUST NOT carry a marker.
   - The framework MUST concatenate all returned nodes into a single string, one block per node in preorder, blocks separated by a blank line
   - Each block MUST be the node's metadata line (`<id> <context_type>:<context_name>:<context_value> <updated_at>`, the same line `docmem_structure` prints, indented two spaces per level of depth below the start node) followed on the next line by the node's text. No other fields (parent_id, order, token_count, created_at) are included. The metadata line changes only when the node itself changes, so unchanged docmems remain byte-stable for prompt caching.
   - The framework MUST add this concatenated string as an additional system message with `role: 'system'` in the messages array sent to the LLM
3. Before the first docmem context system message, the framework MUST include a roster system message consisting of a pretend invocation line `$ System.docmem_roots()` followed by a blank line and the docmem root IDs in plain text, one ID per line, with no decoration. The name deliberately differs from the real `docmem_get_all_roots` command because their outputs differ: chat roots (IDs starting with `chat_`, including the current chat's) MUST be omitted from the roster — the agent has nothing to do with them; the root-prompt root IS included. The IDs MUST be sorted so the message is byte-stable for prompt caching.
4. These docmem context system messages (including the roster message, which leads them) MUST come after the prompt, root prompt, and lens system messages and BEFORE the chat session messages, so the conversation reads as taking place against the current docmem state.
5. Among themselves, the docmem context messages (excluding the roster message, which always leads) MUST be ordered by last-updated ascending (most recently updated last), with ties broken deterministically by docmem root ID. A docmem's last-updated value is the maximum `updated_at` across the nodes included in its expansion — not the whole subtree — so the sort key changes only when the serialized message content changes. Frequently edited docmems thus settle last among the docmem messages, so their churn invalidates the least cacheable prefix.
6. The chat session messages MUST come last. The loop records the incoming user message (or command results, also user-role) before every model call, so the list always ends on a user turn; several chat templates end the assistant turn immediately when the final message is system-role.

The node block format above is the same identity line the agent sees from `docmem_structure`, so one node reads the same wherever it appears.

## Command Results

A pytool block opens with a ```` ```pytool ```` fence and runs to its closing fence or, when the closing fence is missing, to the end of the response.

Command output is fed back to the model as a user-role message, one per executed pytool block.

- Each command contributes one paragraph, in call order, separated by blank lines.
- A successful command owns its entire display string. The string MUST begin with the command's function name exactly as the model calls it (underscores, never hyphens), followed by a colon and a one-line outcome; multi-line data, if any, follows on subsequent lines. Example: `docmem_create_node: created qjjp9a36 after 9cqd3zc9`.
- A mutating command's outcome MUST name the created or moved node first, followed by its position relative to the anchor (`created <new_id> after <node_id>`, `moved <node_id> before <target_id>`). The anchor id never appears before the affected id.
- A failed command returns a bare message; the loop labels it as `error <function_name>: <message>`.
- Errors that arise before any command runs (parse errors, unknown functions) use the same shape with `pytool` as the name.
- The call itself is never echoed back, so a result cannot be mistaken for a second invocation.

## Docmem Focus

The `docmem_focus(root_node_id, node_id)` agent command narrows a docmem's automatic context serialization to one node and its subtree:

- The framework MUST maintain at most one focus node per docmem root. Focus state is in-memory only (same lifetime as the database) and MUST NOT be persisted to TOML.
- Focusing a node MUST resolve the node's root and record the focus against that root, so subsequent turns expand from the focus node instead of the root.
- The command MUST verify that `root_node_id` is the root of `node_id`'s tree, and MUST fail with an error naming the actual root if it is not. The explicit root parameter makes the target docmem unambiguous and guards against cross-docmem mistakes.
- Focusing the docmem root (passing the root ID as both arguments) MUST clear the focus (restore full-tree serialization). There is no separate unfocus command.
- Focusing a nonexistent node MUST fail with an error.
- If a focus node no longer exists at expansion time (e.g., it was deleted), the framework MUST clear the focus and fall back to full-tree expansion rather than failing.
- Focus MUST persist across turns until changed or cleared.

## API Request Timeout

- Every LLM API request MUST enforce a timeout so that a hung connection cannot stall an agent loop indefinitely.
- The default timeout MUST be 300 seconds. The timeout MAY be configurable per API client instance.
- The timeout MUST cover the entire request, including reading the response body (responses are non-streaming, so the full generation must complete within the window).
- A timed-out or aborted request MUST fail with a descriptive error (e.g., "Request timed out after 300s") that surfaces through the normal error path, the same as any other API failure.