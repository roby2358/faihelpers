/**
 * Generic seed functionality for docmem
 * Seeds a docmem with provided node data
 */

import { ROOT_PROMPT_DOCMEM_ID, ROOT_PROMPT_DATA } from './root_prompt.js';
import { TO_DO_PROMPT_DOCMEM_ID, TO_DO_PROMPT_DATA } from './to_do_prompt.js';
import { IDEAS_PROMPT_DOCMEM_ID, IDEAS_PROMPT_DATA } from './ideas_prompt.js';
// import { STOOGES_DOCMEM_ID, STOOGES_DATA } from './stooges.js';

/**
 * Seeds a docmem with provided node data
 * @param {string} docmemId - The ID of the docmem to seed
 * @param {Array} data - Array of node data in format: [id, parentId, contextType, contextName, contextValue, content, order]
 */
async function seedDocmem(docmemId, data) {
    const docmem = new Docmem(docmemId);
    await docmem.ready();
    
    // Delete existing non-root nodes to allow re-seeding
    const children = docmem.getChildren(docmemId);
    for (const child of children) {
        await docmem.sqlite.deleteNode(child.id);
    }
    
    // Insert nodes in order (parents before children)
    // Skip the root node since it's already created by docmem.ready()
    for (const [nodeId, parentId, contextType, contextName, contextValue, content, order] of data) {
        // Skip root node - it's already created
        if (parentId === null) {
            continue;
        }
        
        const node = new Node(
            nodeId,
            parentId,
            content,
            order,
            null, // tokenCount will be calculated
            null, // createdAt - will use current time
            null, // updatedAt - will use current time
            contextType,
            contextName,
            contextValue,
            0 // readonly = 0
        );
        
        // Compute hash for the node
        await NodeHasher.hash(node);
        
        // Insert into database
        await docmem.sqlite.insertNode(node);
    }
    
    console.log(`Seeded docmem: ${docmemId}`);
}

/**
 * Seeds all docmems
 */
async function seedAllDocmems() {
    // List of docmem definitions (references to constants exported by definition files)
    const docmemList = [
//        { docmemId: STOOGES_DOCMEM_ID, data: STOOGES_DATA },
        { docmemId: ROOT_PROMPT_DOCMEM_ID, data: ROOT_PROMPT_DATA },
        { docmemId: TO_DO_PROMPT_DOCMEM_ID, data: TO_DO_PROMPT_DATA },
        { docmemId: IDEAS_PROMPT_DOCMEM_ID, data: IDEAS_PROMPT_DATA },
    ];
    
    for (const { docmemId, data } of docmemList) {
        try {
            await seedDocmem(docmemId, data);
        } catch (error) {
            console.warn(`Error seeding docmem ${docmemId}:`, error);
        }
    }
}

// Make function available globally
window.seedAllDocmems = seedAllDocmems;