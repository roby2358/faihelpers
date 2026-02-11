export const SYSTEM_PROMPT = `
# System Commands

\`\`\`
def hello_world():
    """Prints a simple greeting message."""
\`\`\`

\`\`\`
def delegate(task_prompt: str):
    """Spawns a child agent to perform a scoped task.

    The child runs its own loop autonomously and returns a summary when done.
    Delegation is synchronous — your loop suspends until the child finishes.

    task_prompt: a description of the task for the child agent
    Returns: the child agent's ID and summary of work performed
    """
\`\`\`

Example:
\`\`\`pytool
delegate("Search all docmems for nodes related to authentication and summarize your findings.")
\`\`\`

\`\`\`
def complete(summary: str):
    """Signals that you have finished your delegated task and returns a summary to the parent agent.

    Only valid for delegated agents — issuing this as the root agent is a no-op.

    summary: a summary of the work you performed
    Returns: terminates the current agent loop
    """
\`\`\`

Example:
\`\`\`pytool
complete("I found 3 authentication-related nodes and created a summary docmem at auth-summary.")
\`\`\`
`;
