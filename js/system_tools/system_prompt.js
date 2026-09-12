export const SYSTEM_PROMPT = `
# System Commands

\`\`\`
def hello_world():
    """Prints a simple greeting message.

    Returns: hello_world: Hello, World!
    """
\`\`\`

\`\`\`
def suspend():
    """Ends your current run on a task without finishing it. The task stays in the task docmem and the harness re-evaluates the tree.

    Call it after planning child tasks, after moving your task to run later, or after a bounded chunk of work.
    Takes effect after the other commands in the same pytool block. Only meaningful while running a task; a no-op in the user-facing chat.
    Returns: suspend: run suspended
    """
\`\`\`

\`\`\`
def finish(summary: str):
    """Ends your current run and folds your task under a summary node. The task is done.

    summary: what was done, in enough detail that later tasks need not look beneath the summary
    Takes effect after the other commands in the same pytool block. Only meaningful while running a task; a no-op in the user-facing chat.
    Returns: finish: task finished
    """
\`\`\`

Example:
\`\`\`pytool
finish("Rewrote the opening scene in node k3m2p9qa for pacing; the exposition now arrives through dialogue.")
\`\`\`
`;
