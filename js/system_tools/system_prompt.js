export const SYSTEM_PROMPT = `
# System Commands

#### hello-world
Prints a simple greeting message.
- **Parameters:** None
- **Returns:** A greeting message

#### delegate
Spawns a child agent to perform a scoped task. The child runs its own loop autonomously and returns a summary when done. Delegation is synchronous — your loop suspends until the child finishes.
- **Parameters:** \`<task-prompt>\` — a description of the task for the child agent. May be multi-line (triple-quoted).
- **Returns:** The child agent's ID and summary of work performed.
- **Example:**
\`\`\`
delegate "Search all docmems for nodes related to authentication and summarize your findings."
\`\`\`

#### complete
Signals that you have finished your delegated task and returns a summary to the parent agent. Only valid for delegated agents — issuing this as the root agent is a no-op.
- **Parameters:** \`<summary>\` — a summary of the work you performed. May be multi-line (triple-quoted).
- **Returns:** Terminates the current agent loop.
- **Example:**
\`\`\`
complete "I found 3 authentication-related nodes and created a summary docmem at auth-summary."
\`\`\`
`;