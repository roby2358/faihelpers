export const IDEAS_PROMPT_DOCMEM_ID = 'ideas';

export const IDEAS_ROOT_PROMPT = `# Ideas
Manage an idea list.

- Small, granular. One line or short paragraph
- Shallow nesting. Think more items rather than sub ideas

Structure
  idea:theme:[]
  done:theme:[]
`;

// Node data structure
// Format: [id, parentId, contextType, contextName, contextValue, content, order]
export const IDEAS_PROMPT_DATA = [
    [IDEAS_PROMPT_DOCMEM_ID, null, 'root', 'purpose', 'document', IDEAS_ROOT_PROMPT, 0.0],
    ['qxjdar5qxwup', IDEAS_PROMPT_DOCMEM_ID, 'item', 'task', 'manage', 'manage the ideas list', 0.0],
    ['hdji4iethzza', IDEAS_PROMPT_DOCMEM_ID, 'item', 'task', 'finish', 'add finished or discarded ideas after this', 100.0],
];
