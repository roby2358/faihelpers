export const DOCMEM_PROMPT = `
# Docmem Operations

## Overview

Docmem organizes documents as a hierarchical tree structure. Each node in the tree represents a unit of content with metadata (context-type, context-name, context-value). The root node serves as the entry point, and child nodes can be appended, inserted, moved, copied, or deleted. The root node has a node-id just like any other node.

The intent is to keep the context window smaller by moving thought processes and work products in system promppts.

Try to keep as much as you can in docmem documents without repeating in the context window.

Docmems are durable. They can be shared across conversations.

## Important Concepts

### Node IDs
- Node IDs are randomly generated strings (e.g., "qjjp9a36") assigned by the system when nodes are created
- You MUST use the actual node IDs returned by command responses
- You MUST NOT make up or assume node IDs
- The ONLY node you name is the docmem root when creating it with \`docmem-create\`
- After creation commands, you MUST wait for the response to get the actual node-id before using it in subsequent commands
- Once you know the node-id you may include multiple Run blocks in the reply

### Context Fields
- All context fields (context-type, context-name, context-value) are REQUIRED for node creation and updates
- Each field MUST be a string of length 0 to 24 characters
- Context fields go general to specific: context-type, context-name, context-value are increasingly specific to the node
- Context fields hold metadata for identification or classification (e.g., "weather", "season", "summer")
- Context fields should NOT hold primary content - use the content parameter for that
- Context fields are not load-bearing information fields - they are for organization and filtering

### Content
- Content is the actual text stored in the node
- Content MAY be empty (use "" or '' for empty content)
- For multi-line content, use triple backticks (\`\`\` \`\`\`)

### Docmem Instance
- Most commands require an active docmem instance (a docmem root must be created or loaded first)
- Commands that work without an active instance: \`docmem-create\`, \`docmem-get-all-roots\`
- All other commands require an active docmem instance to operate on

### Command Response Format
- Successful commands return: \`result> <command-name> <action>: <node-id>\` or similar
- Query commands return text data: \`result> <command-name>:\\ntext\`
- Failed commands return: \`error> <error-message>\`
- Extract node-ids from the result text (they appear after colons)

## Command Reference

### Creation and Setup

#### docmem-create <root-id>
Creates a new docmem with the specified root ID.
- **Parameters:**
  - \`root-id\`: String of length 0-24 characters. This is the ONLY node-id you specify yourself.
- **Returns:** \`result> docmem-create created docmem: <root-id>\`
- **Note:** This command does NOT require an active docmem instance.

#### docmem-create-node <--append-child|--before|--after> <node-id> <context-type> <context-name> <context-value> <content>
Creates a new node at the specified position relative to an existing node.
- **Parameters:**
  - Mode: \`--append-child\` (adds as child), \`--before\` (inserts as sibling before), or \`--after\` (inserts as sibling after)
  - \`node-id\`: Existing node ID to position relative to (must exist)
  - \`context-type\`: String 0-24 chars (required)
  - \`context-name\`: String 0-24 chars (required)
  - \`context-value\`: String 0-24 chars (required)
  - \`content\`: Text content (may be empty "")
- **Returns:** \`result> docmem-create-node <action>: <new-node-id>\`
  - Action is "appended child node", "inserted node before", or "inserted node after"
- **Example:** \`docmem-create-node --append-child "abc123" "weather" "season" "summer" "Content about summer"\`

### Updates

#### docmem-update-content <node-id> <content>
Updates the text content of an existing node.
- **Parameters:**
  - \`node-id\`: Existing node ID to update (must exist)
  - \`content\`: New text content (may be empty "")
- **Returns:** \`result> docmem-update-content updated node: <node-id>\`

#### docmem-update-context <node-id> <context-type> <context-name> <context-value>
Updates the context metadata (context-type, context-name, context-value) of an existing node.
- **Parameters:**
  - \`node-id\`: Existing node ID to update (must exist)
  - \`context-type\`: String 0-24 chars (required)
  - \`context-name\`: String 0-24 chars (required)
  - \`context-value\`: String 0-24 chars (required)
- **Returns:** \`result> docmem-update-context updated node: <node-id>\`

### Movement and Copying

#### docmem-move-node <--append-child|--before|--after> <node-id> <target-id>
Moves a node (and its entire subtree) to a new position relative to a target node.
- **Parameters:**
  - Mode: \`--append-child\` (becomes child of target), \`--before\` (becomes sibling before target), or \`--after\` (becomes sibling after target)
  - \`node-id\`: Node ID to move (and its subtree) - must exist
  - \`target-id\`: Target node ID to position relative to - must exist
- **Behavior:**
  - \`--append-child\`: Moves node to become the last child of target-id
  - \`--before\`: Moves node to become a sibling immediately before target-id (same parent as target)
  - \`--after\`: Moves node to become a sibling immediately after target-id (same parent as target)
- **Returns:** \`result> docmem-move-node <action>\`
- **Requirements:** node-id and target-id MUST belong to the same docmem root (same tree)

#### docmem-copy-node <--append-child|--before|--after> <node-id> <target-id>
Copies a node (and its entire subtree) to a new position relative to a target node. The original node remains unchanged.
- **Parameters:**
  - Mode: \`--append-child\` (copy becomes child of target), \`--before\` (copy becomes sibling before target), or \`--after\` (copy becomes sibling after target)
  - \`node-id\`: Node ID to copy (and its subtree) - must exist
  - \`target-id\`: Target node ID to position relative to - must exist
- **Behavior:**
  - Creates a complete copy of the node and all its descendants
  - New node IDs are assigned to the copy and all copied descendants
  - Original node remains in place unchanged
  - \`--append-child\`: Copy becomes the last child of target-id
  - \`--before\`: Copy becomes a sibling immediately before target-id (same parent as target)
  - \`--after\`: Copy becomes a sibling immediately after target-id (same parent as target)
- **Returns:** \`result> docmem-copy-node <action>: <new-node-id>\`
- **Requirements:** node-id and target-id MUST belong to the same docmem root (same tree)

### Deletion

#### docmem-delete <node-id>
Deletes a node and its entire subtree (all descendants).
- **Parameters:**
  - \`node-id\`: Node ID to delete (must exist)
- **Returns:** \`result> docmem-delete deleted node: <node-id>\`
- **Warning:** This operation permanently deletes the node and all its children recursively. Cannot be undone.

### Query Operations

#### docmem-find <node-id>
Retrieves a single node by its ID.
- **Parameters:**
  - \`node-id\`: Node ID to find (must exist)
- **Returns:** \`result> docmem-find:\\n<JSON>\` - Complete node object with all fields including text, context, metadata

#### docmem-structure <node-id>
Returns the hierarchical structure and metadata without text content (efficient for navigation).
- **Parameters:**
  - \`node-id\`: Starting node ID (must exist)
- **Returns:** \`result> docmem-structure:\\n<JSON>\` - Array of node objects with all fields EXCEPT text (includes id, parentId, order, tokenCount, context fields, timestamps)
- **Use case:** Inspect tree structure without loading full text content

### Summary Operations

#### docmem-add-summary <context-type> <context-name> <context-value> <content> <start-node-id> <end-node-id>
Creates a summary node that becomes the parent of a contiguous range of sibling nodes.
- **Parameters:**
  - \`context-type\`: String 0-24 chars (required) - context for the summary node
  - \`context-name\`: String 0-24 chars (required) - context for the summary node
  - \`context-value\`: String 0-24 chars (required) - context for the summary node
  - \`content\`: Summary text content (may be empty, but typically contains summary text)
  - \`start-node-id\`: First node in the range to summarize (must exist)
  - \`end-node-id\`: Last node in the range to summarize (must exist)
- **Behavior:**
  - Creates a new summary node with the provided content and context
  - start-node-id and end-node-id MUST be siblings (have the same parent)
  - All nodes from start-node-id to end-node-id (inclusive) MUST be leaf nodes (have no children)
  - The summary node becomes the new parent of all nodes in the range
  - The summary node is positioned at the midpoint order between start and end nodes
- **Returns:** \`result> docmem-add-summary added summary node: <new-summary-node-id>\`
- **Use case:** Compress multiple memory nodes into a single summary while preserving original nodes as children

### Static Operations

#### docmem-get-all-roots
Returns a list of all root node IDs in the system.
- **Parameters:** None
- **Returns:** \`result> docmem-get-all-roots:\\n<JSON>\` - Array of root node objects
- **Note:** This command does NOT require an active docmem instance.
`;

const DOCMEM_EXTRA_COMMANDS = `

#### docmem-expand-to-length <node-id> <maxTokens>
Returns nodes from the subtree up to a maximum token count, using breadth-first expansion.
- **Parameters:**
  - \`node-id\`: Starting node ID (must exist)
  - \`maxTokens\`: Maximum total token count (must be a number)
- **Returns:** \`result> docmem-expand-to-length:\\n<JSON>\` - Array of node objects that fit within the token limit
- **Behavior:**
  - Always includes the starting node first
  - Expands breadth-first to depth 1, then expands children in order
  - Stops when adding more nodes would exceed maxTokens
  - Useful for context window management in LLM prompts

#### docmem-serialize <node-id>
Returns all nodes in the subtree starting from the specified node, in depth-first traversal order (includes the starting node and all descendants).
- **Parameters:**
  - \`node-id\`: Starting node ID (must exist)
- **Returns:** \`result> docmem-serialize:\\n<JSON>\` - Array of node objects in traversal order
- **Use case:** Get all content from a subtree for document generation or export
`;