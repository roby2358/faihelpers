# DOCMEM

Docmem is a method of storing discrete bits of memory in a hierarchical structure that bridges semantic retrieval and linear document form. The tree structure can be traversed and serialized directly into documents. A parallel vector database for semantic search is planned but not yet implemented.

The core insight: LLM output is linear and hierarchical (conversations, documents), but memory is high-dimensional and associative. Docmem makes the compression between these representations explicit and controllable, rather than leaving it implicit in generation.

## Design Principles

- **The LLM is a pure function.** Docmem handles context construction and memory management; the LLM handles decisions and text generation.
- **The tree is the document.** Serialization is traversal. No orchestration or generation required for document assembly.
- **Compression is visible.** Summarization operations are explicit, auditable, and reversible. The original atoms are preserved.
- **Dual representation (planned).** Tree structure provides hierarchy and reading order; vector DB will provide semantic access. Query via vectors, contextualize via tree.

## Tree Structure

The tree is shallow with clear semantics at each level:

- **Root:** Represents a single docmem instance. Could be a book, a knowledge base, a project.
- **User node:** Partitions by source or subject. Enables scoped operations ("summarize everything about Alice", "forget Bob").
- **Summary:** A paragraph-length compression of its children. Regenerated as new memories accumulate. LLM-generated.
- **Memory:** Atomic unit, typically a sentence. Ground truth—the actual text from the source. A tweet, a sentence from a document, an observation.

Cross-entity relationships are carried in content via @ tags rather than structural links. Vector similarity (when implemented) will surface these connections at query time.

## Nodes

A node contains an ID, parent reference, text content, token count, creation and update timestamps, ordering within its parent (decimal, to allow insertion without reindexing), and context metadata (context_type, context_name, context_value).

Nodes are differentiated by their context metadata rather than an explicit node type field. The context_type field distinguishes node roles (e.g., "message", "summary", "root", "chat_session"). Context metadata provides semantic organization and enables filtering/querying by purpose, source, or role.

Summaries are distinguished from memories by context_type. Memories are ground truth; summaries are interpretations. This distinction matters for expansion behavior. Summary nodes retain references to the nodes they summarize (via parent-child relationships), enabling drill-down.

The database allows updates (not append-only), primarily to support summary regeneration and content updates.

## Database

The implementation uses SQLite (via sql.js) running in the browser. All docmem instances share a single database instance. The schema stores nodes with the following fields: id, parent_id, text, order_value, token_count, created_at, updated_at, context_type, context_name, context_value. Foreign key constraints ensure referential integrity with CASCADE delete for orphans.

## Vector Database (Not Yet Implemented)

Planned: All nodes—memories and summaries alike—will be embedded and stored in a vector DB.

Planned query pattern: semantic search returns matching nodes, then trace each hit up to its parent summary and/or user node, deduplicate (if a summary and its child both match, the child is "covered by" the summary), and return nodes with structural context.

Summaries will act as attractors—they're semantically denser and more likely to catch queries. Multiple hits tracing to the same parent signal that the whole subtree is relevant. Trace-up is cheap (just parent pointers); the expensive vector search is already done.

When summaries are regenerated, their embeddings must be updated in the vector DB.

## Operations

**Serialization:** Traversal is serialization. Depth-first, ordered by the node's order field. Reading order is the document. Returns a flat array of nodes in traversal order.

**Expand to length:** Current implementation uses breadth-first search to depth 1, then expands children of those nodes until a token budget is reached. Priority is by order field (left-to-right in the tree). Semantic prioritization and relevance-based expansion are planned but not yet implemented.

**Summarization:** Compress a list of contiguous memory nodes by generating summary text (currently manual; LLM generation is planned), creating a summary node as new parent of the memories. Summary nodes are positioned between the first and last memory nodes they summarize using decimal ordering. Vector embeddings will be updated when the vector DB is implemented. Summaries are regenerated when their children change.

**Append:** Add a new node as child of a parent node. The new node's order is set to max(sibling orders) + 1.0.

**Insert:** Add a new node between two existing siblings using decimal ordering (20% interpolation: (a * 4 + b * 1) / 5) to avoid reindexing. Requires both nodes to have the same parent.

**Delete:** Remove a node and its children. Uses SQL CASCADE delete for referential integrity. Vector DB cleanup will be needed when implemented.

**Update:** Update the text content of an existing node. Token count is recalculated automatically. Updated timestamp is set to current time.

## Operation Details

Current implementation signatures:

- `append_child(node_id, context_type, context_name, context_value, content)` - Adds a child node to the specified parent. Returns the new node.
- `insert_between(node_id_1, node_id_2, context_type, context_name, context_value, content)` - Inserts a node between two siblings. Returns the new node.
- `delete(node_id)` - Deletes a node and all its descendants.
- `update_content(node_id, content)` - Updates a node's text content and recalculates token count. Returns the updated node.
- `find(node_id)` - Retrieves a node by ID. Returns the node or null.
- `add_summary(node_ids, content, context_type, context_name, context_value)` - Creates a summary node as parent of the specified memory nodes. All nodes must be leaf nodes with the same parent. Returns the new summary node.
- `serialize()` - Returns all nodes in depth-first traversal order as a flat array.
- `expandToLength(maxTokens)` - Returns nodes up to the token limit using current BFS expansion strategy.
- `_getRoot()` - Returns the root node of this docmem instance.
- `_getChildren(parentId)` - Returns children of a node, sorted by order.
- `_getAllRoots()` - Static method returning all root nodes across all docmem instances.

## Chat Integration

The `DocmemChat` class wraps `Docmem` for chat session management. Chat sessions use:
- Root: `context_type=chat_session`, `context_name=date`, `context_value=ISO8601 timestamp`
- Summary nodes (optional): `context_type=summary`, `context_name=role`, `context_value=tool`
- Message nodes: `context_type=message`, `context_name=role`, `context_value=user|assistant`

The `buildMessageList()` method converts the docmem structure into OpenAI message format, handling summary nodes as tool call/response pairs and message nodes as standard messages.

## Open Questions

**Summary behavior on expansion:** When a summary is expanded, what happens to the summary node itself? Options include replacing it entirely with children (clean but loses framing), keeping it as a header (natural but redundant), making it a parameter of the expand operation, or having serialization modes that skip or include interior nodes. Current implementation includes summary nodes in serialization.

**Extractive summarization:** When automatic summarization is implemented, should it use extractive approaches (selecting existing sentences rather than generating new text) as a first pass or optimization? Extractive preserves original voice, avoids hallucination, and is faster than abstractive summarization.

**Sticky nodes:** Some memories are tightly coupled and resist being separated. Should there be a mechanism to mark this, or does summarization naturally preserve these relationships?

## Current Limitations

- Vector database and semantic search are not yet implemented
- Token counting uses approximation (characters / 4) when tokenizers are unavailable
- Expand to length uses simple BFS strategy, not semantic prioritization
- Summarization content must be provided manually; automatic LLM generation is not implemented
- Database persistence to IndexedDB is not yet implemented (data lost on page reload)
- No version history for updates
- No priority/importance flags for expansion ordering

## Future Considerations

- Vector database implementation with embeddings for all nodes
- Semantic search with query-time trace-up and deduplication
- Automatic LLM-based summarization
- Persistence to IndexedDB for browser sessions
- Version history for non-destructive updates
- Semantic prioritization in expand to length
- Partial expansion (mixed resolution in one document)
- Priority/importance flags for expansion ordering
- Ingest classification for incoming threads and documents