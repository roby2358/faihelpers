/**
 * Generic seed functionality for docmem
 * Seeds a docmem with provided node data
 */

import { Docmem, Node, NodeHasher } from '../docmem_tools/docmem.js';
import { ROOT_PROMPT_DOCMEM_ID, ROOT_PROMPT_DATA } from './root_prompt.js';
import { TO_DO_PROMPT_DOCMEM_ID, TO_DO_PROMPT_DATA } from './to_do_prompt.js';
import { IDEAS_PROMPT_DOCMEM_ID, IDEAS_PROMPT_DATA } from './ideas_prompt.js';
// import { STOOGES_DOCMEM_ID, STOOGES_DATA } from './stooges.js';

/**
 * Checks if a node is a root node
 * @param {string|null} parentId - The parent ID to check
 * @returns {boolean} True if this is a root node
 */
function isRootNode(parentId) {
    return parentId === null;
}

/**
 * Deletes all child nodes of a given parent
 * @param {Docmem} docmem - The docmem instance
 * @param {string} parentId - The parent node ID
 */
async function deleteExistingChildren(docmem, parentId) {
    const children = await docmem.getChildren(parentId);
    for (const child of children) {
        await docmem.sqlite.deleteNodeById(child.id);
    }
}

/**
 * Creates a Node instance from raw data array
 * @param {Array} nodeData - Array in format: [id, parentId, contextType, contextName, contextValue, content, order]
 * @returns {Node} The constructed node
 */
function createNodeFromData([nodeId, parentId, contextType, contextName, contextValue, content, order]) {
    return new Node(
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
}

/**
 * Hashes and inserts a node into the docmem database
 * @param {Docmem} docmem - The docmem instance
 * @param {Node} node - The node to insert
 */
async function hashAndInsertNode(docmem, node) {
    await NodeHasher.hash(node);
    await docmem.sqlite.insertNode(node);
}

/**
 * Seeds a docmem with provided node data
 * @param {string} docmemId - The ID of the docmem to seed
 * @param {Array} data - Array of node data in format: [id, parentId, contextType, contextName, contextValue, content, order]
 */
async function seedDocmem(docmemId, data) {
    const docmem = new Docmem(docmemId);
    await docmem.ready();

    await deleteExistingChildren(docmem, docmemId);

    for (const nodeData of data) {
        if (isRootNode(nodeData[1])) {
            continue;
        }

        const node = createNodeFromData(nodeData);
        await hashAndInsertNode(docmem, node);
    }

    console.log(`Seeded docmem: ${docmemId}`);
}

/**
 * Seeds all docmems
 */
export async function seedAllDocmems() {
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
