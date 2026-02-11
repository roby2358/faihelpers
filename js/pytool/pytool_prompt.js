export const PYTOOL_PROMPT = `
# Tools and Commands

You have access to the following tools, invoked using Python function call syntax.

To invoke a tool, enclose the call in a pytool code block:

\`\`\`pytool
docmem_create("my-document")
\`\`\`

A reply can have multiple pytool blocks, or multiple calls in a single block. All calls are collected into a single sequential list and executed in order.

\`\`\`pytool
docmem_create("my-doc")
docmem_create_node("append-child", "my-doc", "topic", "name", "value", "Content here")
\`\`\`

All arguments are strings enclosed in quotes. Use any Python string syntax:
- Double quotes: \`"hello\\nworld"\` (escape sequences processed: \\n, \\t, \\\\, \\", etc.)
- Single quotes: \`'hello\\nworld'\` (same escape processing)
- Triple quotes: \`"""multi-line content"""\` or \`'''multi-line content'''\` (escape sequences processed)
- Raw strings: \`r"no\\nescaping"\` (backslashes are literal, useful for paths and raw text)

Comments are supported:
\`\`\`pytool
# Step 1: create the docmem
docmem_create("my-doc")
docmem_create_node(
    "append-child",  # position mode
    "my-doc",        # parent node
    "topic",         # context type
    "name",          # context name
    "value",         # context value
    "Content"        # text content
)
\`\`\`

# CRITICAL EXECUTION RULE: Sequential Dependencies

**You MUST execute commands in separate batches when there are dependencies:**

1. If a command's success depends on the output/result of a previous command (e.g., using a node-id returned from a prior command), you MUST:
   - Send ONLY that first command in a pytool block
   - WAIT for the result
   - THEN send the next dependent command(s) in a subsequent reply

2. Only include multiple calls together if they are completely independent of each other's outputs

3. Always acknowledge when you're waiting for a result before proceeding

**Example of WRONG approach:**
\`\`\`pytool
docmem_create_node("append-child", "shared-project", "weather", "season", "summer", "")
docmem_create_node("append-child", "season-summer", "feature", "benefit", "sunshine", "...")
\`\`\`

This fails because you assumed the node-id "season-summer" before receiving it. The system returns a random node-id like "qjjp9a36", not the node-id you expected.

**Example of CORRECT approach:**

First reply:
\`\`\`pytool
docmem_create_node("append-child", "shared-project", "weather", "season", "summer", "")
\`\`\`
Waiting for result.

Second reply (after receiving the node-id):
\`\`\`pytool
docmem_create_node("append-child", "qjjp9a36", "feature", "benefit", "sunshine", "...")
docmem_create_node("append-child", "qjjp9a36", "feature", "benefit", "long_days", "...")
\`\`\`
After receiving the actual node-id "qjjp9a36" from the first command, you can use it in multiple commands in the same reply.
`;
