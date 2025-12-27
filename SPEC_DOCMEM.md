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

### Node Differentiation
- Nodes MUST be differentiated by their context metadata rather than an explicit node type field.
- The `context_type` field MUST distinguish node roles (e.g., "message", "summary", "root", "chat_session").
- Context metadata MUST provide semantic organization and enable filtering/querying by purpose, source, or role.

### Node Types
- Summary nodes MUST be distinguished from memory nodes by `context_type`.
- Memory nodes MUST preserve ground truth text.
- Summary nodes MUST represent interpretations of their children.
- Summary nodes MUST retain references to the nodes they summarize via parent-child relationships.

### Node Ordering
- Node ordering within a parent MUST use decimal values to allow insertion without reindexing.
- When inserting between two nodes, the new order value MUST use decimal interpolation to avoid reindexing.
- Current implementation MUST use 20% interpolation: `(a * 4 + b * 1) / 5` where `a` and `b` are sibling orders.

### Token Counting
- Token count MUST be calculated for each node.
- Token counting SHOULD use a tokenizer when available.
- Token counting MAY use approximation (characters / 4) when tokenizers are unavailable.

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
- `FOREIGN KEY (parent_id) REFERENCES nodes(id) ON DELETE CASCADE`

### Database Constraints
- Foreign key constraints MUST ensure referential integrity.
- CASCADE delete MUST be used for orphan cleanup.
- Indexes MUST be created on `parent_id` and `(parent_id, order_value)` for performance.

### Database Updates
- The database MUST allow updates (not append-only) to support summary regeneration and content updates.
- When a node is updated, the `updated_at` timestamp MUST be set to the current time.

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

### Serialization
- `serialize(nodeId)` MUST perform depth-first tree traversal starting from the specified node.
- Traversal MUST be ordered by each node's `order_value` field.
- Serialization MUST return a flat array of nodes in traversal order (including the starting node and all descendants).
- The reading order of a document MUST be determined by serialization order.

### Expand to Length
- `expandToLength(nodeId, maxTokens)` MUST return nodes until the concatenated node content reaches the token limit, starting from the specified node.
- The starting node itself is included in the result.
- Current implementation MUST use breadth-first search to depth 1 from the starting node, then expand the last children of those nodes moving toward the first.
- The node and itself are included, until the concatenated node content reaches the token limit.
- Priority MUST be determined by `order_value` field (left-to-right in the tree).
- Nodes are added to the result until the concatenated node content reaches the token limit.
- Semantic prioritization and relevance-based expansion SHOULD be implemented in the future.

### Summarization
- `add_summary(startNodeId, endNodeId)` MUST compress a list of contiguous memory nodes.
- Summary text MAY be provided manually (current implementation).
- Summary text SHOULD be LLM-generated when automatic summarization is implemented.
- A summary node MUST be created as the new parent of the memory nodes.
- All nodes to be summarized MUST have the same parent.
- When vector DB is implemented, embeddings MUST be updated when summaries are created or regenerated.
- Summaries SHOULD be regenerated when their children change.
- The operation MUST return the new node id.

### Append
- `append_child(nodeId)` MUST add a new node as a child of the specified parent node.
- The new node's `order_value` MUST be set to `max(sibling orders) + 1.0`.
- All context metadata fields (`context_type`, `context_name`, `context_value`) MUST be provided.
- The operation MUST return the new node id.

### Insert
- `insert_between(firstNodeId, secondNodeId)` MUST add a new node between two existing contiguous sibling nodes.
- Both nodes MUST have the same parent.
- The new node's `order_value` MUST use decimal interpolation to avoid reindexing.
- Current implementation MUST use 20% interpolation: `(a * 4 + b * 1) / 5`.
- This biases new nodes toward the left sibling, preserving more space to the right.
- The asymmetry optimizes for forward insertion patterns (repeated `insert_after` 
  on newly created nodes), allowing ~3x more sequential insertions before 
  hitting floating-point precision limits compared to midpoint interpolation.
- All context metadata fields MUST be provided.
- The operation MUST return the new node id.

### Delete
- `delete()` MUST remove a node and all its descendants.
- The operation MUST use SQL CASCADE delete for referential integrity.
- When vector DB is implemented, embeddings MUST be removed for deleted nodes.

### Update Content
- `update_content(nodeId)` MUST update the text content of an existing node.
- Token count MUST be recalculated automatically when content is updated.
- The `updated_at` timestamp MUST be set to the current time.
- The operation MUST return the node id.

### Update Context
- `update_context(nodeId)` MUST update the context metadata (`context_type`, `context_name`, `context_value`) of an existing node.
- The `updated_at` timestamp MUST be set to the current time.
- All context metadata fields MUST be provided.
- The operation MUST return the node id.

### Move
- `move_append_child(nodeId, targetNodeId)` MUST move a node to become a child of a different parent node.
- The moved node MUST be appended to the new parent's children (positioned after all existing children).
- The operation MUST prevent cycles (cannot move a node to be a child of itself or its descendants).
- The `updated_at` timestamp MUST be set to the current time.
- The operation MUST return the node id.

### Structure
- `structure(nodeId)` MUST return the tree structure starting from the specified node without text content.
- The result MUST be a flat array of node objects containing all fields except `text` (including the starting node and all descendants).
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
