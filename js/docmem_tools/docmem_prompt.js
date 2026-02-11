export const DOCMEM_PROMPT = `
# Docmem Operations

## Overview

Docmem organizes documents as a hierarchical tree structure. Each node in the tree represents a unit of content with metadata (context_type, context_name, context_value). The root node serves as the entry point, and child nodes can be appended, inserted, moved, copied, or deleted. The root node has a node_id just like any other node.

The intent is to keep the context window smaller by moving thought processes and work products into system prompts.

Try to keep as much as you can in docmem documents without repeating in the context window.

Docmems are durable. They can be shared across conversations.

## Important Concepts

### Node IDs
- Node IDs are randomly generated strings (e.g., "qjjp9a36") assigned by the system when nodes are created
- You MUST use the actual node IDs returned by command responses
- You MUST NOT make up or assume node IDs
- The ONLY node you name is the docmem root when creating it with \`docmem_create\`
- After creation commands, you MUST wait for the response to get the actual node_id before using it in subsequent commands
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
- Successful commands return: \`result> <command_name> <action>: <node_id>\` or similar
- Query commands return text data: \`result> <command_name>:\\ntext\`
- Failed commands return: \`error> <error_message>\`
- Extract node_ids from the result text (they appear after colons)

## Tool Reference

### Creation and Setup

\`\`\`
def docmem_create(root_id: str):
    """Creates a new docmem with the specified root ID.

    root_id: string 0-24 chars. This is the ONLY node_id you specify yourself.
    Returns: result> docmem_create created docmem: <root_id>
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
    Returns: result> docmem_create_node <action>: <new_node_id>
    """
\`\`\`

### Updates

\`\`\`
def docmem_update_content(node_id: str, content: str):
    """Updates the text content of an existing node.

    node_id: existing node ID to update (must exist)
    content: new text content (may be empty "")
    Returns: result> docmem_update_content updated node: <node_id>
    """
\`\`\`

\`\`\`
def docmem_update_context(node_id: str, context_type: str, context_name: str, context_value: str):
    """Updates the context metadata of an existing node.

    node_id: existing node ID to update (must exist)
    context_type: string 0-24 chars
    context_name: string 0-24 chars
    context_value: string 0-24 chars
    Returns: result> docmem_update_context updated node: <node_id>
    """
\`\`\`

### Movement and Copying

\`\`\`
def docmem_move_node(mode: str, node_id: str, target_id: str):
    """Moves a node (and its entire subtree) to a new position relative to a target node.

    mode: "append-child" (becomes child of target), "before" (sibling before target), or "after" (sibling after target)
    node_id: node ID to move (and its subtree) - must exist
    target_id: target node ID to position relative to - must exist
    Returns: result> docmem_move_node <action>
    Note: node_id and target_id MUST belong to the same docmem root (same tree)
    """
\`\`\`

\`\`\`
def docmem_copy_node(mode: str, node_id: str, target_id: str):
    """Copies a node (and its entire subtree) to a new position. Original node unchanged.

    mode: "append-child" (copy becomes child of target), "before" (sibling before target), or "after" (sibling after target)
    node_id: node ID to copy (and its subtree) - must exist
    target_id: target node ID to position relative to - must exist
    Returns: result> docmem_copy_node <action>: <new_node_id>
    """
\`\`\`

### Deletion

\`\`\`
def docmem_delete(node_id: str):
    """Deletes a node and its entire subtree (all descendants). Cannot be undone.

    node_id: node ID to delete (must exist)
    Returns: result> docmem_delete deleted node: <node_id>
    """
\`\`\`

### Query Operations

\`\`\`
def docmem_structure(node_id: str):
    """Returns the hierarchical structure and metadata without text content.

    node_id: starting node ID (must exist)
    Returns: result> docmem_structure:\\n<JSON> - array of node objects with all fields EXCEPT text
    Use case: inspect tree structure without loading full text content
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
    Returns: result> docmem_add_summary added summary node: <new_summary_node_id>
    """
\`\`\`

### Static Operations

\`\`\`
def docmem_get_all_roots():
    """Returns a list of all root node IDs in the system.

    Returns: result> docmem_get_all_roots:\\n<JSON> - array of root node objects
    Note: does NOT require an active docmem instance.
    """
\`\`\`
`;

const DOCMEM_EXTRA_COMMANDS = `
\`\`\`
def docmem_find(node_id: str):
    """Retrieves a single node by its ID.

    node_id: node ID to find (must exist)
    Returns: result> docmem_find:\\n<JSON> - complete node object with all fields
    """
\`\`\`

\`\`\`
def docmem_expand_to_length(node_id: str, max_tokens: str):
    """Returns nodes from the subtree up to a maximum token count, using breadth-first expansion.

    node_id: starting node ID (must exist)
    max_tokens: maximum total token count (must be a number)
    Returns: result> docmem_expand_to_length:\\n<JSON> - array of node objects within token limit
    """
\`\`\`

\`\`\`
def docmem_serialize(node_id: str):
    """Returns all nodes in the subtree in depth-first traversal order.

    node_id: starting node ID (must exist)
    Returns: result> docmem_serialize:\\n<JSON> - array of node objects in traversal order
    """
\`\`\`
`;
