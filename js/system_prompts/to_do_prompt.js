export const TO_DO_PROMPT_DOCMEM_ID = 'to-do';

export const TO_DO_ROOT_PROMPT = `# To Do
Manage a To Do list.

- Small, granular. One line or short paragraph
- Shallow nesting. Think more to do items rather than sub tasks

Structure
  item:task:[]
  done:task:[]
`;

// Node data structure
// Format: [id, parentId, contextType, contextName, contextValue, content, order]
export const TO_DO_PROMPT_DATA = [
    [TO_DO_PROMPT_DOCMEM_ID, null, 'root', 'purpose', 'document', TO_DO_ROOT_PROMPT, 0.0],
    ['ksf7kuzs2n3n', TO_DO_PROMPT_DOCMEM_ID, 'item', 'task', 'manage', 'manage the To Do list', 0.0],
    ['bwscuwrctvf6', TO_DO_PROMPT_DOCMEM_ID, 'item', 'task', 'finish', 'add finished items after this', 100.0],
];
