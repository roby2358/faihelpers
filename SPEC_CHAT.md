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
2. For each docmem where the docmem ID does NOT start with "chat_" (i.e., excludes chat-related docmems):
   - The framework MUST run `expandToLength(docmemId, 20000)` to expand the docmem to a maximum of 20000 tokens
   - The framework MUST concatenate all returned nodes into a single string, formatting each node with its metadata and content
   - The concatenated string MUST include for each node: node ID, context metadata (context_type, context_name, context_value), timestamps (created_at, updated_at), order value, token count, and text content
   - The framework MUST add this concatenated string as an additional system message with `role: 'system'` in the messages array sent to the LLM
3. These additional system messages MUST be added before the chat session messages (i.e., after the main system prompt from the root node, but before the conversation messages)

The format for concatenating nodes SHOULD include all node metadata in a human-readable format suitable for LLM context. The exact formatting is implementation-defined, but MUST include all node properties (id, contextType, contextName, contextValue, createdAt, updatedAt, order, tokenCount, text) in a clear and structured manner.