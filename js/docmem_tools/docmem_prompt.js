export const DOCMEM_PROMPT = `
# Docmem Operations

## Overview

Docmem organizes documents as a hierarchical tree structure. Each node in the tree represents a unit of content with metadata (context_type, context_name, context_value). The root node serves as the entry point, and child nodes can be appended, inserted, moved, copied, or deleted. The root node has a node_id just like any other node.

The intent is to keep the context window smaller by moving thought processes and work products into system prompts.

Try to keep as much as you can in docmem documents rather than repeating it in your chat messages.

Docmems are durable. They can be shared across conversations.

## Docmem Content Is Already In Your Context

Every docmem is automatically serialized and included in your context as a system message. Each such message begins with a line like \`$ System.docmem_expand_to_context("node_id")\` showing which node the serialization starts from, followed by the serialized nodes. Each serialized node shows its metadata (id, parent_id, context fields, order, token_count) followed by its full text content.

- The \`$ System.docmem_expand_to_context(...)\` line is a system call made by the framework to label the content. It is NOT a command you can call — do not try to invoke it.
- The serialization is regenerated EVERY turn, so it is always up to date and authoritative. It already reflects any nodes you created, updated, moved, or deleted on previous turns.
- There is NO read command, and none is needed. To read a node, look at the serialized docmem in your context. Do NOT call \`docmem_structure\` to read content — it returns structure only, with no text.
- Very large docmems may be only partially included (expanded breadth-first up to a token budget). Such docmems are marked with a \`[partial: N of M nodes shown ...]\` line under the \`$ System.docmem_expand_to_context(...)\` line. Only in that case is \`docmem_structure\` useful, to see the parts of the tree that were left out. No \`[partial: ...]\` marker means the docmem is complete.
- You can narrow the serialization to one subtree with \`docmem_focus(root_node_id, node_id)\`. A focused docmem is marked with a \`[focus: ...]\` line and only that subtree appears in your context. Focus the docmem root to restore the full tree.
- Before the serialized docmems, a \`$ System.docmem_roots()\` message lists every docmem root ID, one per line. This is also framework-generated.
- The last message each turn is \`$ System.turn()\`, a framework-generated user turn telling you the docmem context is current. It is not a user request; respond to the conversation above it.

## Important Concepts

### Node IDs
- Node IDs are randomly generated strings (e.g., "qjjp9a36") assigned by the system when nodes are created
- Use node IDs from the serialized docmems in your context, or from command responses
- You MUST NOT make up or assume node IDs
- The ONLY node you name is the docmem root when creating it with \`docmem_create\`
- After creating a node, you MUST wait for the response to get the actual node_id before using it in subsequent commands
- Once you know the node_id you may include multiple calls in the same pytool block

### Context Fields
- All context fields (context_type, context_name, context_value) are REQUIRED for node creation and updates
- Each field MUST be a string of length 0 to 24 characters
- Context fields go general to specific: context_type, context_name, context_value are increasingly specific to the node
- Context fields hold metadata for identification or classification (e.g., "weather", "season", "summer")
- Context fields should NOT hold primary content - use the content parameter for that
- Context fields are not load-bearing information fields - they are for organization and filtering

### Content
- Content is the actual text stored in the node
- Content MAY be empty (use "" for empty content)
- For multi-line content, use triple quotes (""" """) or raw strings (r"...")

### Docmem Instance
- Most commands require an active docmem instance (a docmem root must be created or loaded first)
- Commands that work without an active instance: \`docmem_create\`, \`docmem_get_all_roots\`
- All other commands require an active docmem instance to operate on

### Command Response Format
- Each command's output comes back in the next user message, one paragraph per command, in call order
- Successful commands return: \`<command_name>: <one-line outcome>\`, e.g. \`docmem_create_node: appended child qjjp9a36\`
- Query commands return text data below the label: \`<command_name>:\\ntext\`
- Failed commands return: \`error <command_name>: <message>\`
- The output is the framework's reply to your call; it is not a second invocation

## Tool Reference

### Creation and Setup

\`\`\`
def docmem_create(root_id: str):
    """Creates a new docmem with the specified root ID.

    root_id: string 0-24 chars. This is the ONLY node_id you specify yourself.
    Returns: docmem_create: created docmem <root_id>
    Note: does NOT require an active docmem instance.
    """
\`\`\`

\`\`\`
def docmem_create_node(mode: str, node_id: str, context_type: str, context_name: str, context_value: str, content: str):
    """Creates a new node at the specified position relative to an existing node.

    mode: "append-child" (adds as child), "before" (inserts as sibling before), or "after" (inserts as sibling after)
    node_id: existing node ID to position relative to (must exist)
    context_type: string 0-24 chars
    context_name: string 0-24 chars
    context_value: string 0-24 chars
    content: text content (may be empty "")
    Returns: docmem_create_node: <action> <new_node_id>
    """
\`\`\`

### Updates

\`\`\`
def docmem_update_content(node_id: str, content: str):
    """Updates the text content of an existing node.

    node_id: existing node ID to update (must exist)
    content: new text content (may be empty "")
    Returns: docmem_update_content: updated <node_id>
    """
\`\`\`

\`\`\`
def docmem_update_context(node_id: str, context_type: str, context_name: str, context_value: str):
    """Updates the context metadata of an existing node.

    node_id: existing node ID to update (must exist)
    context_type: string 0-24 chars
    context_name: string 0-24 chars
    context_value: string 0-24 chars
    Returns: docmem_update_context: updated <node_id>
    """
\`\`\`

### Movement and Copying

\`\`\`
def docmem_move_node(mode: str, node_id: str, target_id: str):
    """Moves a node (and its entire subtree) to a new position relative to a target node.

    mode: "append-child" (becomes child of target), "before" (sibling before target), or "after" (sibling after target)
    node_id: node ID to move (and its subtree) - must exist
    target_id: target node ID to position relative to - must exist
    Returns: docmem_move_node: <action>
    Note: node_id and target_id MUST belong to the same docmem root (same tree)
    """
\`\`\`

\`\`\`
def docmem_copy_node(mode: str, node_id: str, target_id: str):
    """Copies a node (and its entire subtree) to a new position. Original node unchanged.

    mode: "append-child" (copy becomes child of target), "before" (sibling before target), or "after" (sibling after target)
    node_id: node ID to copy (and its subtree) - must exist
    target_id: target node ID to position relative to - must exist
    Returns: docmem_copy_node: <action> <new_node_id>
    """
\`\`\`

### Deletion

\`\`\`
def docmem_delete(node_id: str):
    """Deletes a node and its entire subtree (all descendants). Cannot be undone.

    node_id: node ID to delete (must exist)
    Returns: docmem_delete: deleted <node_id>
    """
\`\`\`

### Query Operations

\`\`\`
def docmem_structure(node_id: str):
    """Returns the hierarchical structure and metadata without text content.

    node_id: starting node ID (must exist)
    Returns: docmem_structure:\\n<indented text outline> - one line per node in preorder traversal; each line is "- " followed by node metadata (id, context fields, order, token count — no text content), indented two spaces per depth level
    Use case: see the shape of a tree that was too large to be fully serialized into your context.
    Note: returns NO text content. To read node content, use the serialized docmem already in your context.
    """
\`\`\`

\`\`\`
def docmem_search(node_id: str, pattern: str, mode: str = "literal"):
    """Searches a node and its whole subtree for a pattern in text or context fields. Case-insensitive; matches anywhere in a field.

    node_id: starting node ID (must exist) — use a docmem root to search the whole docmem
    pattern: what to search for (non-empty)
    mode: optional; "literal" (plain substring, the default), "wildcard" (* matches any run of characters, ? matches one), or "regex" (RE2 syntax)
    Example: docmem_search("stooges", "peacemaker") or docmem_search("stooges", "peace*", "wildcard")
    Returns: docmem_search:\\n<hits> - for each hit, a "- " metadata line (same format as docmem_structure), a "path:" line of ancestor IDs from the root down to the hit, and a "match:" line with a short snippet around the match (or "(context field)" if only metadata matched). At most 50 hits; a [truncated: ...] line means there were more.
    Use case: find where something is mentioned in a large or partially serialized docmem, then docmem_focus on the subtree you need.
    """
\`\`\`

\`\`\`
def docmem_focus(root_node_id: str, node_id: str):
    """Narrows a docmem's automatic context serialization to one node and its subtree.

    root_node_id: the docmem root ID (must be the root of node_id's tree)
    node_id: node to focus on (must exist)
    After focusing, only that subtree is serialized into your context each turn, marked with a [focus: ...] line. Focus persists across turns.
    To restore the full tree, pass the docmem root ID as both arguments (focusing the root clears the focus).
    Returns: docmem_focus: focused, ... (or "cleared" when focusing the root)
    Use case: a large docmem where you only need one section right now — especially one marked [partial: ...], to zoom into subtrees that were omitted.
    """
\`\`\`

### Summary Operations

\`\`\`
def docmem_add_summary(context_type: str, context_name: str, context_value: str, content: str, start_node_id: str, end_node_id: str):
    """Creates a summary node that becomes the parent of a contiguous range of sibling nodes.

    context_type: string 0-24 chars - context for the summary node
    context_name: string 0-24 chars - context for the summary node
    context_value: string 0-24 chars - context for the summary node
    content: summary text content (may be empty, but typically contains summary text)
    start_node_id: first node in the range to summarize (must exist)
    end_node_id: last node in the range to summarize (must exist)
    Note: start and end nodes MUST be siblings. All nodes in range MUST be leaf nodes.
    Returns: docmem_add_summary: added summary <new_summary_node_id>
    """
\`\`\`

### Static Operations

\`\`\`
def docmem_get_all_roots():
    """Returns a list of all root node IDs in the system.

    Returns: docmem_get_all_roots:\\n<JSON> - array of root node objects
    Note: does NOT require an active docmem instance.
    """
\`\`\`
`;
