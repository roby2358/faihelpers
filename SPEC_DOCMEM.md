# DOCMEM Specification

## Overview

Docmem MUST store discrete bits of memory in a hierarchical tree structure. The tree structure MUST be traversable and serializable directly into documents. A parallel vector database for semantic search SHOULD be implemented in the future.

The core insight: LLM output is linear and hierarchical (conversations, documents), but memory is high-dimensional and associative. Docmem MUST make the compression between these representations explicit and controllable, rather than leaving it implicit in generation.

## Design Principles

### Separation of Concerns
- Docmem MUST handle context construction and memory management.
- The LLM MUST handle decisions and text generation.
- Docmem MUST NOT generate text content except through explicit summarization operations.

### Tree as Document
- Serialization MUST be accomplished through tree traversal.
- Serialization MUST NOT require orchestration or generation logic beyond traversal.
- The reading order of a document MUST be determined by traversal order.

### Visible Compression
- Summarization operations MUST be explicit and auditable.
- Original memory nodes MUST be preserved when summaries are created.
- Summarization MUST be reversible (the original nodes remain accessible).

### Dual Representation (Planned)
- Tree structure MUST provide hierarchy and reading order.
- Vector DB (when implemented) MUST provide semantic access.
- Query operations SHOULD query via vectors and contextualize via tree structure.

## Tree Structure

The tree structure MUST be shallow with clear semantics at each level. For example:

- **Root:** MUST represent a single docmem instance. MAY represent a book, knowledge base, project, or chat session.
- **User node:** MAY partition by source or subject to enable scoped operations.
- **Summary:** MUST be a paragraph-length compression of its children. SHOULD be regenerated when new memories accumulate. Summary content SHOULD be LLM-generated when automatic summarization is implemented.
- **Memory:** MUST be an atomic unit, typically a sentence. MUST preserve ground truth—the actual text from the source.

## Node Structure

### Required Fields
A node MUST contain the following fields:
- `id`: Unique identifier (TEXT, PRIMARY KEY)
- `parent_id`: Reference to parent node (TEXT, NULLABLE, FOREIGN KEY)
- `text`: Text content (TEXT, NOT NULL)
- `order_value`: Ordering within parent (REAL, NOT NULL)
- `token_count`: Token count (INTEGER, NOT NULL)
- `created_at`: Creation timestamp (TEXT, NOT NULL, ISO8601 format)
- `updated_at`: Update timestamp (TEXT, NOT NULL, ISO8601 format)
- `context_type`: Node role type (TEXT, NOT NULL)
- `context_name`: Context metadata name (TEXT, NOT NULL)
- `context_value`: Context metadata value (TEXT, NOT NULL)
- `readonly`: Readonly metadata flag (INTEGER, NOT NULL, 0 or 1)
- `hash`: SHA-512 hash of node state for optimistic locking (TEXT, NULLABLE, Base64-encoded)

### Node Differentiation
- Nodes MUST be differentiated by their context metadata rather than an explicit node type field.
- The `context_type` field MUST distinguish node roles (e.g., "message", "summary", "root", "chat_session").
- Context metadata MUST provide semantic organization and enable filtering/querying by purpose, source, or role.

### Node Types
- Summary nodes MUST be distinguished from memory nodes by `context_type`.
- Memory nodes MUST preserve ground truth text.
- Summary nodes MUST represent interpretations of their children.
- Summary nodes MUST retain references to the nodes they summarize via parent-child relationships.
- Note nodes MUST be a system node type (distinguished by `context_type`) that allows agents to add annotations or updates to docmem without modifying readonly nodes.
- Note nodes MUST be created as siblings after readonly nodes to enable agent updates while preserving the original readonly content.

### Node Ordering
- Node ordering within a parent MUST use decimal values to allow insertion without reindexing.
- When inserting between two nodes, the new order value MUST use decimal interpolation to avoid reindexing.
- Current implementation MUST use 20% interpolation: `(a * 4 + b * 1) / 5` where `a` and `b` are sibling orders.

### Token Counting
- Token count MUST be calculated for each node.
- Token counting SHOULD use a tokenizer when available.
- Token counting MAY use approximation (characters / 4) when tokenizers are unavailable.

### Readonly Metadata
- The `readonly` field MUST be an INTEGER value of 0 or 1.
- Nodes with `readonly = 1` MUST NOT be modified by update operations (content or context updates).
- Nodes with `readonly = 0` MAY be modified by update operations.
- Documents imported through file upload (non-TOML files) MUST have all their nodes marked with `readonly = 1`.
- Nodes from TOML files MUST default to `readonly = 0`.
- When an agent needs to update docmem content that includes readonly nodes, it MUST create note nodes as siblings after the readonly nodes rather than modifying the readonly nodes directly.

## Database

### Storage Implementation
- The implementation MUST use SQLite (via sql.js) running in the browser.
- All docmem instances MUST share a single database instance.

### Schema Requirements
The database schema MUST include a `nodes` table with the following columns:
- `id TEXT PRIMARY KEY`
- `parent_id TEXT`
- `text TEXT NOT NULL`
- `order_value REAL NOT NULL`
- `token_count INTEGER NOT NULL`
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`
- `context_type TEXT NOT NULL`
- `context_name TEXT NOT NULL`
- `context_value TEXT NOT NULL`
- `readonly INTEGER NOT NULL`
- `hash TEXT`
- `FOREIGN KEY (parent_id) REFERENCES nodes(id) ON DELETE CASCADE`

### Database Constraints
- Foreign key constraints MUST ensure referential integrity.
- CASCADE delete MUST be used for orphan cleanup.
- Indexes MUST be created on `parent_id` and `(parent_id, order_value)` for performance.

### Database Updates
- The database MUST allow updates (not append-only) to support summary regeneration and content updates.
- When a node is updated, the `updated_at` timestamp MUST be set to the current time.
- All update operations MUST use optimistic locking with hash-based versioning (see Optimistic Locking section).

### Optimistic Locking
- All update operations MUST implement optimistic locking using SHA-512 hash-based versioning.
- Each node MUST have a `hash` field containing a Base64-encoded SHA-512 hash of the node's state.
- The hash MUST be computed from the concatenation of: `parent_id|context_type|context_name|context_value|text|order` (using `|` as delimiter).
- NULL/undefined values MUST be normalized to empty strings for deterministic hashing.
- The hash MUST be recalculated whenever any hashed field changes (parent_id, context_type, context_name, context_value, text, order).
- The `readonly` field MUST NOT be included in the hash calculation.
- Update operations MUST include an expected hash value and MUST only succeed if the node's current hash matches the expected hash.
- If the hash does not match, the operation MUST throw an `OptimisticLockError` indicating concurrent modification.
- This prevents lost updates when multiple operations attempt to modify the same node concurrently.

### Persistence (Planned)
- Database persistence to IndexedDB SHOULD be implemented to survive page reloads.
- Current implementation does NOT persist data to IndexedDB (data is lost on page reload).

## Vector Database (Not Yet Implemented)

### Embedding Requirements (Planned)
- All nodes (memories and summaries) SHOULD be embedded and stored in a vector DB.
- When summaries are regenerated, their embeddings MUST be updated in the vector DB.

### Query Pattern (Planned)
- Semantic search MUST return matching nodes.
- The implementation MUST trace each hit up to its parent summary and/or user node.
- The implementation MUST deduplicate results (if a summary and its child both match, the child MUST be considered "covered by" the summary).
- Results MUST include nodes with structural context.

### Summary Attraction (Planned)
- Summaries SHOULD act as attractors—they're semantically denser and more likely to catch queries.
- Multiple hits tracing to the same parent SHOULD signal that the whole subtree is relevant.
- Trace-up operations MUST use parent pointers only (cheap operation after expensive vector search).

## Operations

### Import
- When importing documents through file upload (non-TOML files), all nodes created from the imported content MUST have `readonly = 1`.
- When importing nodes from TOML files, all nodes MUST default to `readonly = 0`.
- Import operations MUST preserve the hierarchical structure of the source document.

### Serialization
- `serialize(nodeId)` MUST perform depth-first tree traversal starting from the specified node.
- Traversal MUST be ordered by each node's `order_value` field.
- Serialization MUST return a flat array of nodes in traversal order (including the starting node and all descendants).
- The reading order of a document MUST be determined by serialization order.

### Expand to Length
- `expandToLength(nodeId, maxTokens)` MUST return nodes until the concatenated node content reaches the token limit, starting from the specified node.
- The starting node itself MUST be included in the result as the first element.
- If the starting node's token count exceeds maxTokens, the result MUST contain only the starting node.
- Current implementation MUST use breadth-first search to depth 1 from the starting node, then expand the children of those nodes moving in order_value order.
- The starting node's token count MUST be included in the total token count before expanding children.
- Priority MUST be determined by `order_value` field (left-to-right in the tree).
- Nodes are added to the result until the concatenated node content reaches the token limit.
- Semantic prioritization and relevance-based expansion SHOULD be implemented in the future.

### Summarization
- `add_summary(startNodeId, endNodeId, content, context_type, context_name, context_value)` MUST compress a list of contiguous memory nodes.
- Summary text content MUST be provided as a parameter (current implementation requires manual content).
- Summary text SHOULD be LLM-generated when automatic summarization is implemented.
- A summary node MUST be created as the new parent of the memory nodes with the provided content and context metadata.
- All nodes to be summarized MUST have the same parent and MUST be leaf nodes (have no children).
- The summary node's order MUST be placed at the midpoint between the start and end nodes' orders.
- Memory nodes MUST be reparented to the summary node (they become children of the summary).
- When vector DB is implemented, embeddings MUST be updated when summaries are created or regenerated.
- Summaries SHOULD be regenerated when their children change.
- The operation MUST return the new summary node.

### Append
- `append_child(nodeId, context_type, context_name, context_value, content)` MUST add a new node as a child of the specified parent node.
- The new node's `order_value` MUST be set to `max(sibling orders) + 1.0`.
- All context metadata fields (`context_type`, `context_name`, `context_value`) and `content` MUST be provided.
- The operation MUST return the new node.

### Insert
- `insert_before(nodeId, context_type, context_name, context_value, content)` MUST add a new node before the specified target node.
- `insert_after(nodeId, context_type, context_name, context_value, content)` MUST add a new node after the specified target node.
- The target node MUST have a parent (cannot insert before/after root node).
- The new node MUST be inserted as a sibling of the target node (same parent).
- The new node's `order_value` MUST use decimal interpolation to avoid reindexing.
- Current implementation MUST use 20% interpolation: `(a * 4 + b * 1) / 5` where `a` is the adjacent sibling's order and `b` is the target node's order.
- For `insert_before`: if a sibling exists before the target, use `(siblingOrder * 4 + targetOrder * 1) / 5`; otherwise use `targetOrder - 1.0`.
- For `insert_after`: if a sibling exists after the target, use `(targetOrder * 4 + siblingOrder * 1) / 5`; otherwise use `targetOrder + 1.0`.
- This biases new nodes toward the left sibling, preserving more space to the right.
- The asymmetry optimizes for forward insertion patterns (repeated `insert_after` 
  on newly created nodes), allowing ~3x more sequential insertions before 
  hitting floating-point precision limits compared to midpoint interpolation.
- All context metadata fields (`context_type`, `context_name`, `context_value`) and `content` MUST be provided.
- The operation MUST return the new node.

### Delete
- `delete(nodeId)` MUST remove a node and all its descendants.
- The operation MUST collect all descendants first, then delete them in post-order (children before parents) to ensure safe deletion.
- The operation MUST use SQL CASCADE delete for referential integrity (though explicit deletion is performed for safety).
- When vector DB is implemented, embeddings MUST be removed for deleted nodes.

### Update Content
- `update_content(nodeId, content)` MUST update the text content of an existing node.
- The operation MUST fail if the target node has `readonly = 1`.
- Token count MUST be recalculated automatically when content is updated.
- The `updated_at` timestamp MUST be set to the current time.
- The hash MUST be recalculated after content changes.
- The operation MUST use optimistic locking (expected hash must match current hash).
- The operation MUST return the updated node.

### Update Context
- `update_context(nodeId, context_type, context_name, context_value)` MUST update the context metadata of an existing node.
- The operation MUST fail if the target node has `readonly = 1`.
- The `updated_at` timestamp MUST be set to the current time.
- All context metadata fields MUST be provided.
- The hash MUST be recalculated after context changes.
- The operation MUST use optimistic locking (expected hash must match current hash).
- The operation MUST return the updated node.

### Copy
- `copy_append_child(nodeId, targetParentId)` MUST create a copy of a node and all its descendants as a child of the target parent.
- `copy_before(nodeId, targetNodeId)` MUST create a copy of a node and all its descendants as a sibling before the target node.
- `copy_after(nodeId, targetNodeId)` MUST create a copy of a node and all its descendants as a sibling after the target node.
- The target node for `copy_before`/`copy_after` MUST have a parent (cannot copy before/after root node).
- Copy operations MUST recursively copy all descendants, creating new node IDs for each copied node.
- The copied nodes MUST maintain the same tree structure and order relationships as the original.
- The copied nodes' `order_value` fields MUST be recalculated for their new positions using the same rules as insert operations.
- The copied nodes' `created_at` and `updated_at` timestamps MUST be set to the current time.
- The operation MUST return the new root node of the copied subtree.

### Move
- `move_append_child(nodeId, targetParentId)` MUST move a node to become a child of a different parent node.
- `move_before(nodeId, targetNodeId)` MUST move a node to become a sibling before the target node.
- `move_after(nodeId, targetNodeId)` MUST move a node to become a sibling after the target node.
- For `move_append_child`, the moved node MUST be appended to the new parent's children (positioned after all existing children).
- For `move_before` and `move_after`, the moved node MUST be repositioned as a sibling of the target node (same parent as target).
- The target node for `move_before`/`move_after` MUST have a parent (cannot move before/after root node).
- All move operations MUST prevent cycles (cannot move a node to be a child of itself, its descendants, or a descendant's parent).
- The moved node's `order_value` MUST be recalculated using the same interpolation rules as insert operations.
- The `updated_at` timestamp MUST be set to the current time.
- The operation MUST use optimistic locking (expected hash must match current hash).
- The operation MUST return the updated node.

### Structure
- `structure(nodeId)` MUST return the tree structure starting from the specified node without text content.
- The result MUST be a flat array of node objects containing the following fields: `id`, `parentId`, `order`, `tokenCount`, `createdAt`, `updatedAt`, `contextType`, `contextName`, `contextValue`, `readonly` (excluding `text` and `hash`).
- The result MUST include the starting node and all descendants.
- Traversal MUST use preorder traversal ordered by `order_value`.
- This operation is useful for inspecting tree structure without loading full text content.

### Find
- `find(nodeId)` MUST retrieve a node by ID.
- The operation MUST return all the node properties if found, or null if not found.

## Current Limitations

The following features are NOT REQUIRED in the current implementation:

- Vector database and semantic search are NOT REQUIRED (planned for future).
- Automatic LLM-based summarization is NOT REQUIRED (manual summarization is acceptable).
- Database persistence to IndexedDB is NOT REQUIRED (data may be lost on page reload).
- Version history for updates is NOT REQUIRED.
- Priority/importance flags for expansion ordering are NOT REQUIRED.
- Semantic prioritization in expand to length is NOT REQUIRED (simple BFS is acceptable).

## Future Requirements

### Linking

Cross-entity relationships MUST be carried in content via @ tags rather than structural links. Vector similarity (when implemented) SHOULD surface these connections at query time.

### Vector Database
- Vector database implementation SHOULD be added with embeddings for all nodes.
- Semantic search with query-time trace-up and deduplication SHOULD be implemented.

### Query Operations (Planned)
- Semantic query operations SHOULD be implemented when vector DB is available.
- Query results SHOULD include structural context through trace-up operations.

### Summarization
- Automatic LLM-based summarization SHOULD be implemented.
- Extractive summarization approaches MAY be used as a first pass or optimization.

### Persistence
- Persistence to IndexedDB for browser sessions SHOULD be implemented.

### Expansion
- Semantic prioritization in expand to length SHOULD be implemented.
- Partial expansion (mixed resolution in one document) SHOULD be implemented.
- Priority/importance flags for expansion ordering SHOULD be implemented.

### Additional Features
- Version history for non-destructive updates SHOULD be implemented.
- Ingest classification for incoming threads and documents SHOULD be implemented.

## Open Questions

### Summary Behavior on Expansion
When a summary is expanded, what SHOULD happen to the summary node itself? Options include:
- Replacing it entirely with children (clean but loses framing)
- Keeping it as a header (natural but redundant)
- Making it a parameter of the expand operation
- Having serialization modes that skip or include interior nodes

Current implementation includes summary nodes in serialization.

### Sticky Nodes
Some memories are tightly coupled and resist being separated. SHOULD there be a mechanism to mark this, or does summarization naturally preserve these relationships?
