# DOCMEM

Docmem is a method of storing discrete bits of memory in a hierarchical fashion in order to allow easy memory operations on incoming data, and to allow easy modifications of memory in order to facilitate response and document building.

LLM output focuses on conversational and document form. The challenge is that while memory can be highly semantic using embeddings and vectors, conversations and documents remain linear and hierarchical. The intent is to bridge that gap by providing a fluid hierarchical structure. This can be traversed and expanded linearly. Then we provide commands to work new memories back into the structure while also maintaining them in a vector database.

Docmem allows storing granular pieces of memory, or summaries, in a vector database for semantic searches. The hierarchical structure allows for both navigation as well as text searches through sub-trees.

The advantage of managing granular memory nodes is that we can summarize to compact them, and then expand them iterative to fill a given length of context to engineer the context window in an LLM request.

The idea is that instead of relying on an LLM's response to generate a document, the LLM will piece together bits of memory in order to form a coherent whole. On the other side, nodes can be taken from the tree to engineer the context to an LLM.

# Nodes

There is a single root node which represents a particular memdoc.

Nodes in the tree represent the literal pieces of text that go into the docmem.

A node contains
- id: a random string
- parent node reference
- tokenized text
- timestamp of creation or last update
- length
- order within parent node (decimal)
- context
  - We carry information about the meaning of a node to use for search or filtering. The context may be a username for information about that user. Or it may indicate the node is a summary node.
    - context type
    - context name
    - context value

# Data structure (RAM)

# Data structure (Database)

# Operations

The memory operations to support are:
- append a new child to a node
- insert a new child between two nodes
- summarize a list of contiguous nodes by inserting a node in their parent, then adding a summary node as the new parent
- delete a node (and children)
- expand a node to length
  - traverse to collect nodes, then expand until the length is met