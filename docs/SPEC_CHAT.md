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

For each turn in the chat, the framework MUST include additional context from non-chat docmems as system messages:

1. The framework MUST enumerate all existing docmem instances using `Docmem.getAllRoots()`
2. For each docmem where the docmem ID does NOT start with "chat_" (i.e., excludes chat-related docmems) and is NOT the root prompt docmem (which is already included, serialized, as the main system prompt):
   - The framework MUST run `expandToLength(docmemId, 20000)` to expand the docmem to a maximum of 20000 tokens
   - If the expansion was truncated by the token budget (fewer nodes returned than the subtree contains), the system message MUST carry a truncation marker on a line directly below the docmem ID, stating how many of the total nodes are shown and pointing to `docmem_structure` for the omitted subtrees (e.g., `[partial: 42 of 97 nodes shown (token budget); call docmem_structure("<docmemId>") to see the omitted subtrees]`). The marker MUST lead the message rather than trail it, because breadth-first expansion omits scattered deeper/older subtrees, not a contiguous tail. A complete docmem MUST NOT carry a marker.
   - The framework MUST concatenate all returned nodes into a single string, formatting each node with its metadata and content
   - The concatenated string MUST include for each node: node ID, context metadata (context_type, context_name, context_value), order value, token count, and text content. Per-node timestamps (created_at, updated_at) MUST NOT be included, so that the serialized docmem messages remain byte-stable when node content has not changed, enabling prompt caching.
   - The framework MUST add this concatenated string as an additional system message with `role: 'system'` in the messages array sent to the LLM
3. These docmem context system messages MUST be appended AFTER the chat session messages, at the end of the message list. This keeps the append-only conversation history a stable prefix for prompt caching; docmem writes only invalidate the tail of the message list.
4. Among themselves, the docmem context messages MUST be ordered by last-updated ascending (most recently updated last), with ties broken deterministically by docmem root ID. A docmem's last-updated value is the maximum `updated_at` across the nodes included in its expansion — not the whole subtree — so the sort key changes only when the serialized message content changes. Frequently edited docmems thus settle at the very end of the message list, where their churn invalidates the least cacheable prefix.

The format for concatenating nodes SHOULD include all node metadata in a human-readable format suitable for LLM context. The exact formatting is implementation-defined, but MUST include all node properties (id, contextType, contextName, contextValue, order, tokenCount, text) in a clear and structured manner.

## API Request Timeout

- Every LLM API request MUST enforce a timeout so that a hung connection cannot stall an agent loop indefinitely.
- The default timeout MUST be 300 seconds. The timeout MAY be configurable per API client instance.
- The timeout MUST cover the entire request, including reading the response body (responses are non-streaming, so the full generation must complete within the window).
- A timed-out or aborted request MUST fail with a descriptive error (e.g., "Request timed out after 300s") that surfaces through the normal error path, the same as any other API failure.