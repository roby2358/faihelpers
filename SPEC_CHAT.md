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