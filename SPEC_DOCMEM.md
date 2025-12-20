# DOCMEM

Docmem is a method of storing discrete bits of memory in a hierarchical structure that bridges semantic retrieval and linear document form. The tree structure can be traversed and serialized directly into documents, while a parallel vector database enables semantic search. Memory operations work nodes back into the structure while maintaining vector embeddings.

The core insight: LLM output is linear and hierarchical (conversations, documents), but memory is high-dimensional and associative. Docmem makes the compression between these representations explicit and controllable, rather than leaving it implicit in generation.

## Design Principles

- **The LLM is a pure function.** Docmem handles context construction and memory management; the LLM handles decisions and text generation.
- **The tree is the document.** Serialization is traversal. No orchestration or generation required for document assembly.
- **Compression is visible.** Summarization operations are explicit, auditable, and reversible. The original atoms are preserved.
- **Dual representation.** Tree structure provides hierarchy and reading order; vector DB provides semantic access. Query via vectors, contextualize via tree.

## Tree Structure

The tree is shallow with clear semantics at each level:

- **Root:** Represents a single docmem instance. Could be a book, a knowledge base, a project.
- **User node:** Partitions by source or subject. Enables scoped operations ("summarize everything about Alice", "forget Bob").
- **Summary:** A paragraph-length compression of its children. Regenerated as new memories accumulate. LLM-generated.
- **Memory:** Atomic unit, typically a sentence. Ground truth—the actual text from the source. A tweet, a sentence from a document, an observation.

Cross-entity relationships are carried in content via @ tags rather than structural links. Vector similarity surfaces these connections at query time.

## Nodes

A node contains an ID, parent reference, text content, token count, creation and update timestamps, ordering within its parent (decimal, to allow insertion without reindexing), and node type.

Summaries are a different kind of node than memories. Memories are ground truth; summaries are interpretations. This distinction matters for expansion behavior. Summary nodes retain references to the nodes they summarize, enabling drill-down.

The database allows updates (not append-only), primarily to support summary regeneration.

## Vector Database

All nodes—memories and summaries alike—are embedded and stored in the vector DB.

Query pattern: semantic search returns matching nodes, then trace each hit up to its parent summary and/or user node, deduplicate (if a summary and its child both match, the child is "covered by" the summary), and return nodes with structural context.

Summaries act as attractors—they're semantically denser and more likely to catch queries. Multiple hits tracing to the same parent signal that the whole subtree is relevant. Trace-up is cheap (just parent pointers); the expensive vector search is already done.

When summaries are regenerated, their embeddings must be updated in the vector DB.

## Operations

**Serialization:** Traversal is serialization. Depth-first, ordered by the node's order field. Reading order is the document.

**Expand to length:** Selectively expand summaries until a token budget is reached. Priority heuristics determine which summaries expand first: recency, relevance score from query, depth, explicit importance flags.

**Summarization:** Compress a list of contiguous memory nodes by generating summary text via LLM, creating a summary node as new parent of the memories, and embedding in the vector DB. Summaries are regenerated when their children change.

**Append:** Add a new memory node as child of a summary or user node.

**Insert:** Add a new memory node between two existing siblings using decimal ordering to avoid reindexing.

**Delete:** Remove a node and its children, updating the vector DB accordingly.

## Open Questions

**Summary behavior on expansion:** When a summary is expanded, what happens to the summary node itself? Options include replacing it entirely with children (clean but loses framing), keeping it as a header (natural but redundant), making it a parameter of the expand operation, or having serialization modes that skip or include interior nodes.

**Extractive summarization:** Currently summaries are LLM-generated. Extractive approaches (selecting existing sentences rather than generating new text) could serve as a first pass or optimization. Extractive preserves original voice, avoids hallucination, and is faster.

**Sticky nodes:** Some memories are tightly coupled and resist being separated. Should there be a mechanism to mark this, or does summarization naturally preserve these relationships?

## Future Considerations

- Version history for non-destructive updates
- Partial expansion (mixed resolution in one document)
- Priority/importance flags for expansion ordering
- Ingest classification for incoming threads and documents