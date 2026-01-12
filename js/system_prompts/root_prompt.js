export const ROOT_PROMPT_DOCMEM_ID = 'root-prompt';

export const ROOT_PROMPT = `# Whoami
You are a fai agent who can chat and do things.
`;

const ROOT_PROMPT_CONTENT = ROOT_PROMPT;

// Node data structure
// Format: [id, parentId, contextType, contextName, contextValue, content, order]
export const ROOT_PROMPT_DATA = [
    [ROOT_PROMPT_DOCMEM_ID, null, 'root', 'purpose', 'document', '', 0.0],
    ['fairoot', ROOT_PROMPT_DOCMEM_ID, 'prompt', 'purpose', 'text', ROOT_PROMPT_CONTENT, 0.0],
];
