export const BASH_PROMPT = `
# Tools and Commands

You have access to the following bash commands.

To invoke a command, enclose it in a # Run block, like:
# Run
\`\`\`bash
ls -lA
\`\`\`

A reply can have multiple # Run blocks, but only one command per # Run block.

Arguments are space separated, and can be enclosed in quotes (" "), single quotes (' '), or triple quotes for multi-line inputs (""" """).

**IMPORTANT:** Triple backticks (\`\`\` \`\`\`) WILL NOT work for multi-line values. Use triple quotes (""" """) instead.

# CRITICAL EXECUTION RULE: Sequential Dependencies

**You MUST execute commands in separate batches when there are dependencies:**

1. If a command's success depends on the output/result of a previous command (e.g., using a node-id returned from a prior command), you MUST:
   - Send ONLY that first command in a # Run block
   - WAIT for the user to provide the result
   - THEN send the next dependent command(s) in a subsequent reply

2. Only include multiple # Run commands together if they are completely independent of each other's outputs

3. Always acknowledge when you're waiting for a result before proceeding

**Example of WRONG approach:**
# Run
\`\`\`bash
docmem-create-node --append-child "shared-project" "weather" "season" "summer" ""
\`\`\`
# Run
\`\`\`bash
docmem-create-node --append-child "season-summer" "feature" "benefit" "sunshine" "..."
\`\`\`

❌ This fails because you assumed the node-id "season-summer" before receiving it. The system returns a random node-id like "qjjp9a36", not the node-id you expected.

**Example of CORRECT approach:**

First reply:
# Run
\`\`\`bash
docmem-create-node --append-child "shared-project" "weather" "season" "summer" ""
\`\`\`
Waiting for result.

Second reply (after receiving the node-id):
# Run
\`\`\`bash
docmem-create-node --append-child "qjjp9a36" "feature" "benefit" "sunshine" "..."
\`\`\`
# Run
\`\`\`bash
docmem-create-node --append-child "qjjp9a36" "feature" "benefit" "long_days" "..."
\`\`\`
✅ After receiving the actual node-id "qjjp9a36" from the first command, you can use it in multiple commands in the same reply.
`;