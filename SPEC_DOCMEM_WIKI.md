# DOCMEM_WIKI Specification

## Overview

DOCMEM_WIKI extends DOCMEM to serve as a unified knowledge substrate that presents three projections of the same underlying data:

- **System Memory**: Agent-facing, context-optimized representations for LLM consumption
- **Work Products**: Versioned output artifacts produced by agents or humans
- **Wiki**: Human-facing, browsable knowledge pages

The core insight: these are not separate data stores but different *views* of the same canonical node tree. A single piece of knowledge exists once in DOCMEM and is projected differently depending on consumer (human vs agent) and purpose (reference vs task execution vs documentation).

## Design Principles

### Single Source of Truth
- All knowledge MUST be stored as DOCMEM nodes.
- Projections MUST be computed views, not duplicated storage.
- Updates to nodes MUST be immediately reflected in all projections.

### Projection as Transformation
- System Memory projection MUST optimize for token efficiency and LLM comprehension.
- Wiki projection MUST optimize for human readability and navigation.
- Work Products projection MUST optimize for artifact integrity and version history.
- Transformation between projections MAY involve LLM-mediated reformatting.

### Search as Context Assembly
- Semantic search MUST surface conceptually relevant nodes.
- Fuzzy text search MUST surface terminologically precise matches.
- Combined search MUST deduplicate and rank results.
- Context compilation MUST transform search results into coherent system prompts.

### Chat as Invocation
- The system prompt MUST become the primary interface for agent work.
- Chat interactions SHOULD compress toward task invocation.
- Context engineering MUST be a first-class operation, not ad-hoc prompting.

## Architecture

### Canonical Layer (DOCMEM)

All DOCMEM_WIKI operations build on the existing DOCMEM specification. The node structure, tree operations, and storage implementation remain as specified in DOCMEM.

### Extended Node Metadata

DOCMEM_WIKI extends node context metadata to support projections:

#### Projection Hints
Nodes MAY include projection hints in their context metadata:
- `context_type: "wiki_page"` - Primary wiki content
- `context_type: "wiki_section"` - Subsection of a wiki page
- `context_type: "work_product"` - Output artifact
- `context_type: "work_product_version"` - Specific version of an artifact
- `context_type: "system_context"` - Pre-compiled system memory fragment
- `context_type: "memory"` - Raw memory node (default DOCMEM behavior)
- `context_type: "summary"` - Compressed representation (default DOCMEM behavior)

#### Additional Context Fields
- `context_name` SHOULD indicate the topic, title, or identifier.
- `context_value` SHOULD contain structured metadata as JSON:
    - `tags`: Array of classification tags
    - `visibility`: "human" | "agent" | "both"
    - `compilation_hints`: Instructions for context compilation
    - `version`: Version identifier for work products
    - `supersedes`: ID of previous version (for work products)

### Projection Definitions

#### System Memory Projection

The System Memory projection presents nodes optimized for LLM context injection.

**Characteristics:**
- Token-efficient representation
- Explicit relationships and dependencies
- Redundant context for standalone comprehension
- May include LLM-specific formatting hints

**Rendering Rules:**
- Summary nodes MUST be preferred over expanded children when within token budget.
- Nodes with `visibility: "human"` MUST be excluded.
- Nodes MUST be rendered with minimal formatting overhead.
- Cross-references MUST be resolved to inline context when possible.

#### Wiki Projection

The Wiki projection presents nodes as browsable, linked documentation.

**Characteristics:**
- Human-readable prose
- Navigation structure (table of contents, breadcrumbs)
- Cross-links between related pages
- Rich formatting (headers, lists, code blocks)

**Rendering Rules:**
- Nodes with `context_type: "wiki_page"` MUST be rendered as top-level pages.
- Child nodes MUST be rendered as sections within their parent page.
- Nodes with `visibility: "agent"` MAY be excluded or marked as "agent-facing content."
- Cross-references via `@` tags MUST be rendered as hyperlinks.

#### Work Products Projection

The Work Products projection presents versioned output artifacts.

**Characteristics:**
- Version history with diffs
- Authorship tracking (human vs agent)
- Artifact integrity (checksums, validation)
- Export-ready formats

**Rendering Rules:**
- Nodes with `context_type: "work_product"` MUST be rendered as artifact entries.
- Version history MUST be reconstructed from `supersedes` chains.
- The latest version MUST be presented by default.
- Previous versions MUST be accessible but clearly marked as historical.

## Search System

### Dual Search Strategy

DOCMEM_WIKI MUST implement both semantic and fuzzy text search, combining results for comprehensive retrieval.

#### Semantic Search

Semantic search MUST use vector embeddings to find conceptually related content.

**Implementation Requirements:**
- All nodes MUST be embedded using a consistent embedding model.
- Embeddings MUST be stored in a vector database (e.g., sqlite-vss, pgvector, or in-memory HNSW).
- Query embeddings MUST use the same model as node embeddings.
- Similarity MUST be computed using cosine similarity or dot product.
- Results MUST be ranked by similarity score.

**Embedding Scope:**
- Memory nodes MUST be embedded individually.
- Summary nodes MUST be embedded (they act as semantic attractors).
- Wiki pages MUST be embedded at both page and section granularity.
- Work products MUST be embedded (latest version only, or all versions based on configuration).

#### Fuzzy Text Search

Fuzzy text search MUST surface terminologically precise matches that semantic search might miss.

**Implementation Requirements:**
- FULLTEXT index MUST be maintained on node text content.
- Fuzzy matching MUST handle:
    - Case insensitivity
    - Partial word matches (prefix, suffix, substring)
    - Common misspellings and typos (Levenshtein distance ≤ 2)
    - Synonym expansion (configurable)
    - Acronym matching (e.g., "OAuth" ↔ "OAuth 2.0" ↔ "OAuth2")

**Index Requirements:**
- Index MUST be updated when nodes are created, updated, or deleted.
- Index SHOULD support field-specific search (text content vs context_name vs tags).

#### Combined Search

Combined search MUST merge and deduplicate results from both search strategies.

**Merge Strategy:**
1. Execute semantic search with query, retrieve top N results with scores.
2. Execute fuzzy search with query terms, retrieve top M results with scores.
3. Normalize scores to comparable ranges (0.0 to 1.0).
4. Merge results, combining scores for nodes appearing in both result sets.
5. Apply boost factors:
    - Exact term match: 1.5x boost
    - Title/name match: 1.3x boost
    - Recent update: 1.1x boost (configurable decay)
6. Deduplicate using DOCMEM's trace-up logic:
    - If a summary and its child both match, prefer the summary unless the child has significantly higher score.
    - If multiple children of the same summary match, return the summary with annotation of matching children.
7. Return ranked, deduplicated results with provenance (semantic, fuzzy, or both).

### Search Operations

#### `search(query, options)`

**Parameters:**
- `query`: Search query string
- `options`:
    - `limit`: Maximum results (default: 10)
    - `strategy`: "semantic" | "fuzzy" | "combined" (default: "combined")
    - `scope`: Node ID to scope search within (default: null for global)
    - `projection`: "system" | "wiki" | "work_product" | "all" (default: "all")
    - `include_children`: Boolean, whether to include matching children in results (default: false)

**Returns:**
Array of search results:
```
{
  node: Node,
  score: number,
  provenance: "semantic" | "fuzzy" | "both",
  matching_children?: Node[],  // if include_children is true
  context_path: string[]       // ancestor chain for navigation
}
```

#### `search_for_context(query, max_tokens, options)`

Specialized search that returns results formatted for context injection.

**Parameters:**
- `query`: Search query string
- `max_tokens`: Token budget for returned context
- `options`:
    - `strategy`: Search strategy (default: "combined")
    - `compilation`: "raw" | "digest" | "compile" (default: "raw")
    - `scope`: Node ID to scope search within

**Returns:**
```
{
  nodes: Node[],
  total_tokens: number,
  compilation_result?: string,  // if compilation != "raw"
  sources: SearchResult[]       // original search results for attribution
}
```

## Context Compilation

Context compilation transforms search results into coherent system prompt content. This is where the "wiki-as-system-knowledge" pattern is implemented.

### Compilation Modes

#### Raw Mode
- Search results are concatenated in relevance order.
- No transformation is applied.
- Suitable for simple retrieval or when token budget is tight.

#### Digest Mode
- Search results are summarized by an LLM.
- Redundant information is removed.
- Key facts are preserved with source attribution.
- Suitable for broad context needs.

#### Compile Mode
- Search results are transformed into a coherent knowledge document.
- Structure is imposed based on query intent.
- Cross-references are resolved and inlined.
- Contradictions are noted or resolved.
- Suitable for complex task contexts.

### Compilation Operations

#### `compile_context(nodes, query, options)`

**Parameters:**
- `nodes`: Array of nodes to compile
- `query`: Original query (provides intent context)
- `options`:
    - `mode`: "digest" | "compile"
    - `max_tokens`: Token budget for output
    - `format`: "prose" | "structured" | "bullet" (output format hint)
    - `include_sources`: Boolean, whether to include source references

**LLM Invocation:**
Compilation MUST invoke an LLM with a prompt structured as:

```
You are compiling knowledge from multiple sources into a coherent context document.

Query intent: {query}
Output format: {format}
Token budget: {max_tokens}

Sources:
{for each node}
---
Source: {node.context_name} (ID: {node.id})
Content: {node.text}
---
{end for}

Instructions:
- Synthesize information relevant to the query intent.
- Remove redundant information.
- Preserve specific facts, numbers, and technical details.
- Note any contradictions between sources.
- {if include_sources} Include [Source: name] attributions for key facts.
- Output MUST NOT exceed {max_tokens} tokens.
```

**Returns:**
```
{
  compiled_text: string,
  token_count: number,
  sources_used: string[],      // IDs of nodes that contributed
  sources_excluded: string[],  // IDs of nodes excluded (low relevance or token budget)
  contradictions?: string[]    // noted contradictions, if any
}
```

### Context Templates

Context templates define reusable patterns for context assembly.

#### Template Structure
```
{
  id: string,
  name: string,
  description: string,
  queries: [
    {
      query: string,
      weight: number,           // relative importance
      max_tokens: number,       // token budget for this query
      required: boolean         // fail if no results?
    }
  ],
  compilation: {
    mode: "digest" | "compile",
    format: "prose" | "structured" | "bullet",
    preamble?: string,         // text to prepend
    postamble?: string         // text to append
  },
  total_max_tokens: number
}
```

#### `apply_template(template_id, variables)`

**Parameters:**
- `template_id`: ID of the template to apply
- `variables`: Key-value pairs to substitute in query strings

**Process:**
1. Load template by ID.
2. Substitute variables in query strings.
3. Execute each query with its token budget.
4. Compile results according to template compilation settings.
5. Prepend preamble, append postamble.
6. Return assembled context.

**Returns:**
```
{
  context: string,
  token_count: number,
  template_id: string,
  queries_executed: number,
  queries_failed: number,
  sources: SearchResult[]
}
```

## Wiki Operations

### Page Management

#### `create_wiki_page(title, content, options)`

Creates a new wiki page as a top-level node.

**Parameters:**
- `title`: Page title (used as `context_name`)
- `content`: Initial page content
- `options`:
    - `parent_id`: Parent page ID for hierarchical wikis (default: wiki root)
    - `tags`: Array of classification tags
    - `visibility`: "human" | "agent" | "both" (default: "both")

**Process:**
1. Create node with `context_type: "wiki_page"`.
2. Set `context_name` to title.
3. Set `context_value` to JSON with tags and visibility.
4. Generate embedding for the page.
5. Index page for fuzzy search.

#### `update_wiki_page(page_id, content, options)`

Updates wiki page content.

**Parameters:**
- `page_id`: ID of the page to update
- `content`: New content
- `options`:
    - `create_version`: Boolean, whether to preserve previous version as work product

**Process:**
1. If `create_version` is true, snapshot current content as work product version.
2. Update node content via DOCMEM `update_content`.
3. Regenerate embedding.
4. Update fuzzy search index.

#### `add_wiki_section(page_id, title, content, options)`

Adds a section to an existing wiki page.

**Parameters:**
- `page_id`: Parent page ID
- `title`: Section title
- `content`: Section content
- `options`:
    - `after_section_id`: Insert after this section (default: append)
    - `visibility`: "human" | "agent" | "both"

**Process:**
1. Create child node with `context_type: "wiki_section"`.
2. Position using DOCMEM insert/append operations.
3. Generate embedding.
4. Update fuzzy search index.

### Page Rendering

#### `render_wiki_page(page_id, options)`

Renders a wiki page for human consumption.

**Parameters:**
- `page_id`: ID of the page to render
- `options`:
    - `format`: "markdown" | "html" (default: "markdown")
    - `include_toc`: Boolean, generate table of contents
    - `resolve_links`: Boolean, convert `@` references to hyperlinks
    - `include_metadata`: Boolean, show tags, dates, etc.

**Returns:**
```
{
  rendered: string,
  format: string,
  toc?: TableOfContents,
  outbound_links: string[],    // pages linked from this page
  inbound_links: string[]      // pages linking to this page (requires index)
}
```

### Link Management

#### Cross-Reference Syntax

Wiki pages MUST use `@` syntax for cross-references:
- `@[[Page Title]]` - Link to page by title
- `@[[Page Title#Section]]` - Link to specific section
- `@{{node_id}}` - Link to node by ID (for programmatic use)

#### Link Resolution

When rendering wiki pages:
1. Parse `@` references in content.
2. Resolve each reference to a node ID via title lookup or direct ID.
3. Render as hyperlink in output format.
4. Track unresolved references for broken link detection.

#### Link Index

A link index SHOULD be maintained for efficient inbound link queries:
- Store (source_node_id, target_node_id, link_text) tuples.
- Update index when pages are created, updated, or deleted.
- Enable "what links here" queries.

## Work Products

### Artifact Management

#### `create_work_product(title, content, options)`

Creates a new work product.

**Parameters:**
- `title`: Artifact title
- `content`: Artifact content
- `options`:
    - `parent_id`: Parent node (default: work products root)
    - `artifact_type`: "document" | "code" | "data" | "other"
    - `author`: "human" | "agent" | agent identifier
    - `source_context`: IDs of nodes that informed this artifact

**Process:**
1. Create node with `context_type: "work_product"`.
2. Set initial version to 1.
3. Store metadata including author and source context.
4. Generate embedding.
5. Index for search.

#### `update_work_product(product_id, content, options)`

Creates a new version of a work product.

**Parameters:**
- `product_id`: ID of the work product
- `content`: New content
- `options`:
    - `author`: Who made this update
    - `change_summary`: Description of changes
    - `source_context`: IDs of nodes that informed this update

**Process:**
1. Create new node with `context_type: "work_product_version"`.
2. Set `supersedes` to current latest version ID.
3. Reparent new version under the work product node.
4. Update version number.
5. Generate embedding for new version.

#### `get_work_product_history(product_id)`

Retrieves version history for a work product.

**Returns:**
```
{
  product_id: string,
  title: string,
  versions: [
    {
      version_id: string,
      version_number: number,
      created_at: timestamp,
      author: string,
      change_summary?: string,
      token_count: number
    }
  ],
  current_version: string
}
```

### Artifact-Wiki Integration

Work products MAY be linked from wiki pages:
- `@{{work_product:product_id}}` - Embed or link to work product
- `@{{work_product:product_id:version}}` - Link to specific version

When rendering wiki pages, work product references SHOULD be rendered as:
- Inline preview (first N tokens) with link to full artifact
- Or full embedding if artifact is small and context allows

## LLM Integration

### LLM Operations Summary

DOCMEM_WIKI requires LLM invocations for the following operations:

| Operation | Purpose | Required? |
|-----------|---------|-----------|
| `compile_context` | Transform search results into coherent context | Required for digest/compile modes |
| `summarize_nodes` | Create summary nodes (DOCMEM) | Optional (manual summaries allowed) |
| `generate_wiki_page` | Create wiki page from raw nodes | Optional |
| `transform_projection` | Convert between projection formats | Optional |
| `resolve_contradictions` | Identify and resolve conflicting information | Optional |

### LLM Invocation Interface

All LLM operations MUST use a consistent invocation interface:

```
interface LLMInvocation {
  operation: string;           // operation identifier
  prompt: string;              // full prompt text
  max_tokens: number;          // output token limit
  temperature?: number;        // sampling temperature (default: 0.3 for factual, 0.7 for creative)
  metadata: {
    source_nodes: string[];    // nodes that informed this invocation
    purpose: string;           // human-readable purpose
    cacheable: boolean;        // whether result can be cached
  }
}

interface LLMResult {
  output: string;
  tokens_used: number;
  cached: boolean;
  invocation_id: string;       // for audit trail
}
```

### Caching Strategy

LLM invocations SHOULD be cached when:
- Input nodes have not changed (compare hashes).
- Query/parameters are identical.
- Cache TTL has not expired.

Cache key MUST be computed from:
- Operation identifier
- Hash of input node IDs and their hashes
- Hash of parameters

### Audit Trail

All LLM invocations SHOULD be logged for audit:
- Invocation ID
- Timestamp
- Operation
- Input node IDs
- Output summary (not full output for storage efficiency)
- Tokens used
- Cache hit/miss

## System Prompt Assembly

### The Invocation Pattern

When agents operate, the system prompt MUST be assembled from DOCMEM_WIKI content:

```
┌─────────────────────────────────────────────────────────┐
│                    System Prompt                         │
├─────────────────────────────────────────────────────────┤
│  1. Base Instructions (static)                          │
│     - Agent identity and capabilities                   │
│     - Behavioral constraints                            │
│                                                         │
│  2. Compiled Context (from DOCMEM_WIKI)                 │
│     - Relevant wiki knowledge                           │
│     - Task-specific context                             │
│     - Work product references                           │
│                                                         │
│  3. Task Specification (from invocation)                │
│     - Current task description                          │
│     - Expected output format                            │
│     - Success criteria                                  │
└─────────────────────────────────────────────────────────┘
```

### Assembly Operation

#### `assemble_system_prompt(task_description, options)`

**Parameters:**
- `task_description`: Description of the task to be performed
- `options`:
    - `template_id`: Context template to apply (optional)
    - `additional_queries`: Extra search queries to include
    - `max_context_tokens`: Token budget for compiled context
    - `include_work_products`: IDs of work products to include
    - `base_instructions`: Static instruction text

**Process:**
1. If template_id provided, apply template to get base context.
2. Execute semantic search with task description.
3. Execute fuzzy search for key terms in task description.
4. Combine and deduplicate results.
5. Compile context within token budget.
6. Assemble system prompt from base instructions + compiled context + task spec.
7. Return assembled prompt with metadata.

**Returns:**
```
{
  system_prompt: string,
  total_tokens: number,
  context_sources: string[],     // node IDs that contributed
  compilation_metadata: {
    mode: string,
    queries_executed: number,
    contradictions: string[]
  }
}
```

## Data Model Extensions

### New Tables

#### `embeddings` Table
```sql
CREATE TABLE embeddings (
  node_id TEXT PRIMARY KEY,
  embedding BLOB NOT NULL,        -- serialized vector
  model_id TEXT NOT NULL,         -- embedding model identifier
  created_at TEXT NOT NULL,
  FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
);
```

#### `links` Table
```sql
CREATE TABLE links (
  id TEXT PRIMARY KEY,
  source_node_id TEXT NOT NULL,
  target_node_id TEXT NOT NULL,
  link_text TEXT,                 -- display text of link
  created_at TEXT NOT NULL,
  FOREIGN KEY (source_node_id) REFERENCES nodes(id) ON DELETE CASCADE,
  FOREIGN KEY (target_node_id) REFERENCES nodes(id) ON DELETE CASCADE
);
CREATE INDEX idx_links_source ON links(source_node_id);
CREATE INDEX idx_links_target ON links(target_node_id);
```

#### `context_templates` Table
```sql
CREATE TABLE context_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  template_json TEXT NOT NULL,    -- JSON template definition
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

#### `llm_invocations` Table (Audit)
```sql
CREATE TABLE llm_invocations (
  id TEXT PRIMARY KEY,
  operation TEXT NOT NULL,
  input_node_ids TEXT NOT NULL,   -- JSON array of node IDs
  parameters_hash TEXT NOT NULL,
  output_summary TEXT,
  tokens_used INTEGER NOT NULL,
  cached INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_invocations_operation ON llm_invocations(operation);
CREATE INDEX idx_invocations_created ON llm_invocations(created_at);
```

### FULLTEXT Index

For SQLite implementations:
```sql
CREATE VIRTUAL TABLE nodes_fts USING fts5(
  text,
  context_name,
  content='nodes',
  content_rowid='rowid'
);

-- Triggers to keep FTS in sync
CREATE TRIGGER nodes_ai AFTER INSERT ON nodes BEGIN
  INSERT INTO nodes_fts(rowid, text, context_name) 
  VALUES (NEW.rowid, NEW.text, NEW.context_name);
END;

CREATE TRIGGER nodes_ad AFTER DELETE ON nodes BEGIN
  INSERT INTO nodes_fts(nodes_fts, rowid, text, context_name) 
  VALUES('delete', OLD.rowid, OLD.text, OLD.context_name);
END;

CREATE TRIGGER nodes_au AFTER UPDATE ON nodes BEGIN
  INSERT INTO nodes_fts(nodes_fts, rowid, text, context_name) 
  VALUES('delete', OLD.rowid, OLD.text, OLD.context_name);
  INSERT INTO nodes_fts(rowid, text, context_name) 
  VALUES (NEW.rowid, NEW.text, NEW.context_name);
END;
```

## Implementation Phases

### Phase 1: Search Foundation
- Implement FULLTEXT index for fuzzy search.
- Implement basic vector storage (sqlite-vss or in-memory).
- Implement combined search with deduplication.
- Implement raw context retrieval (`search_for_context` with `compilation: "raw"`).

### Phase 2: Wiki Projection
- Implement wiki page CRUD operations.
- Implement section management.
- Implement `@` link syntax parsing and resolution.
- Implement wiki rendering (markdown output).
- Implement link index for bidirectional navigation.

### Phase 3: Context Compilation
- Implement LLM invocation interface.
- Implement digest mode compilation.
- Implement compile mode compilation.
- Implement caching layer.
- Implement audit logging.

### Phase 4: Work Products
- Implement work product creation.
- Implement versioning with `supersedes` chains.
- Implement history retrieval.
- Implement wiki-work product integration.

### Phase 5: System Prompt Assembly
- Implement context templates.
- Implement `assemble_system_prompt` operation.
- Implement template library management.
- Build standard templates for common task types.

### Phase 6: Advanced Features
- Implement contradiction detection.
- Implement automatic summarization triggers.
- Implement projection transformation (wiki ↔ system memory reformatting).
- Implement collaborative editing support.

## Open Questions

### Embedding Model Selection
Which embedding model(s) SHOULD be supported? Options:
- Local models (e.g., all-MiniLM-L6-v2) for privacy and speed
- API models (e.g., OpenAI ada-002, Anthropic) for quality
- Pluggable interface supporting both

### Compilation Consistency
How SHOULD compilation handle the same nodes being compiled differently for different queries?
- Cache per (nodes, query) pair?
- Allow stale compilations with freshness indicator?
- Always recompile?

### Wiki-Optimized vs Agent-Optimized Content
SHOULD nodes store both human-optimized and agent-optimized text, or SHOULD transformation happen at render time?
- Dual storage is wasteful but fast.
- Runtime transformation is efficient but adds latency.
- Hybrid: cache agent-optimized versions, invalidate on node update.

### Conflict Resolution in Multi-Agent Scenarios
When multiple agents update the wiki concurrently:
- Rely on DOCMEM optimistic locking?
- Implement higher-level merge strategies?
- Queue writes through a coordinator?

### Token Budget Allocation
When assembling system prompts with limited token budget, how SHOULD tokens be allocated across:
- Base instructions (static but essential)
- Compiled context (dynamic and relevant)
- Task specification (variable length)

SHOULD this be configurable per-template, or use a standard allocation strategy?