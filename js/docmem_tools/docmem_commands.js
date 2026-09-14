/**
 * DocmemCommands - Command wrapper class for docmem operations
 */
import { Docmem, DocmemStore } from './docmem.js';

// A model that "creates" an existing docmem is usually about to write into
// the wrong tree. Refuse, and say what it can do instead.
export function createExistsMessage(rootId) {
    return `docmem ${rootId} already exists, nothing was created. ` +
        `To add to that docmem, call docmem_create_node("append-child", "${rootId}", ...). ` +
        `To start a new docmem, call docmem_create with an id not in the $ System.docmem_roots() list.`;
}

export const KNOWN_DOCMEM_COMMANDS = new Set([
    'docmem_create',
    'docmem_create_node',
    'docmem_update_content',
    'docmem_update_context',
    'docmem_delete',
    'docmem_structure',
    'docmem_search',
    'docmem_focus',
    'docmem_add_summary',
    'docmem_move_node',
    'docmem_copy_node',
    'docmem_get_all_roots',
]);

// Every command names its nodes by id, and ids are global, so the commands
// carry no docmem binding. Root-scoped checks (focus, move) are explicit.
export class DocmemCommands {
    constructor() {
        this.store = new DocmemStore();
    }

    async ready() {
        await this.store.ready();
    }

    validateFieldLength(value, fieldName, commandName, allowEmpty) {
        if (value === null || value === undefined || typeof value !== 'string') {
            throw new Error(`${commandName} requires ${fieldName} to be a string of length 0 to 24`);
        }
        const trimmed = value.trim();
        if (!allowEmpty && trimmed.length === 0) {
            throw new Error(`${commandName} requires ${fieldName} to be a string of length 0 to 24`);
        }
        if (trimmed.length > 24) {
            throw new Error(`${commandName} requires ${fieldName} to be a string of length 0 to 24, got length ${trimmed.length}`);
        }
        return trimmed;
    }

    validateContext(contextType, contextName, contextValue, commandName) {
        const validatedContextType = this.validateFieldLength(contextType, 'context_type', commandName);
        const validatedContextName = this.validateFieldLength(contextName, 'context_name', commandName, true);
        const validatedContextValue = this.validateFieldLength(contextValue, 'context_value', commandName, true);
        return {
            contextType: validatedContextType,
            contextName: validatedContextName,
            contextValue: validatedContextValue
        };
    }

    async validateSameRoot(nodeId, targetId, commandName) {
        const nodeRoot = await this.store.getRootOfNode(nodeId);
        const targetRoot = await this.store.getRootOfNode(targetId);
        if (nodeRoot.id !== targetRoot.id) {
            throw new Error(`${commandName} requires node-id and target-id to have the same root node. You can only move nodes within a docmem. Node root: ${nodeRoot.id}, Target root: ${targetRoot.id}`);
        }
    }

    async executeWithMode(mode, nodeId, targetId, operations, commandName) {
        if (mode === 'append-child') {
            const node = await operations.appendChild(nodeId, targetId);
            return { node, action: operations.appendChildAction(node.id, nodeId, targetId) };
        } else if (mode === 'before') {
            const node = await operations.before(nodeId, targetId);
            return { node, action: operations.beforeAction(node.id, nodeId, targetId) };
        } else if (mode === 'after') {
            const node = await operations.after(nodeId, targetId);
            return { node, action: operations.afterAction(node.id, nodeId, targetId) };
        } else {
            throw new Error(`${commandName} requires mode to be append-child, before, or after, got: ${mode}`);
        }
    }

    async create(rootId) {
        const validatedRootId = this.validateFieldLength(rootId, 'root-id', 'docmem_create', true);
        const roots = await Docmem.getAllRoots();
        if (roots.some(r => r.id === validatedRootId)) {
            return { success: false, result: createExistsMessage(validatedRootId) };
        }
        // Docmem is created automatically when instantiated
        const newDocmem = new Docmem(validatedRootId);
        await newDocmem.ready();
        return { success: true, result: `docmem_create: created docmem ${validatedRootId}` };
    }

    async createNode(mode, nodeId, contextType, contextName, contextValue, content) {
        const validated = this.validateContext(contextType, contextName, contextValue, 'docmem_create_node');
        const result = await this.executeWithMode(mode, nodeId, null, {
            appendChild: async (nId) => await this.store.appendChild(nId, validated.contextType, validated.contextName, validated.contextValue, content),
            before: async (nId) => await this.store.insertBefore(nId, validated.contextType, validated.contextName, validated.contextValue, content),
            after: async (nId) => await this.store.insertAfter(nId, validated.contextType, validated.contextName, validated.contextValue, content),
            appendChildAction: (newId, nId) => `created ${newId} as last child of ${nId}`,
            beforeAction: (newId, nId) => `created ${newId} before ${nId}`,
            afterAction: (newId, nId) => `created ${newId} after ${nId}`
        }, 'docmem_create_node');
        return { success: true, result: `docmem_create_node: ${result.action}`, lastId: result.node.id };
    }

    async updateContent(nodeId, content) {
        const node = await this.store.updateContent(nodeId, content);
        return { success: true, result: `docmem_update_content: updated ${node.id}`, lastId: node.id };
    }

    async updateContext(nodeId, contextType, contextName, contextValue) {
        const validated = this.validateContext(contextType, contextName, contextValue, 'docmem_update_context');
        const node = await this.store.updateContext(nodeId, validated.contextType, validated.contextName, validated.contextValue);
        return { success: true, result: `docmem_update_context: updated ${node.id}` };
    }

    async delete(nodeId) {
        await this.store.delete(nodeId);
        return { success: true, result: `docmem_delete: deleted ${nodeId}` };
    }

    async structure(nodeId) {
        const structure = await this.store.structure(nodeId);
        return { success: true, result: `docmem_structure:\n${structure}` };
    }

    async search(nodeId, pattern, mode = 'literal') {
        const results = await this.store.search(nodeId, mode, pattern);
        return { success: true, result: `docmem_search:\n${this.store.formatSearchResults(results)}` };
    }

    async focus(rootNodeId, nodeId) {
        const node = await this.store.find(nodeId);
        if (!node) {
            return { success: false, result: `node not found: ${nodeId}` };
        }
        const root = await this.store.getRootOfNode(nodeId);
        if (root.id !== rootNodeId) {
            return { success: false, result: `node ${nodeId} does not belong to docmem ${rootNodeId} (its root is ${root.id})` };
        }
        if (node.id === root.id) {
            Docmem.clearFocus(root.id);
            return { success: true, result: `docmem_focus: cleared, docmem ${root.id} will serialize its full tree into context` };
        }
        Docmem.setFocus(root.id, node.id);
        return { success: true, result: `docmem_focus: focused, docmem ${root.id} will serialize only the subtree of ${node.id} into context. Call docmem_focus("${root.id}", "${root.id}") to restore the full tree.` };
    }

    async addSummary(contextType, contextName, contextValue, content, startNodeId, endNodeId) {
        if (!startNodeId || !endNodeId) {
            throw new Error('docmem_add_summary requires both start-node-id and end-node-id');
        }
        const validated = this.validateContext(contextType, contextName, contextValue, 'docmem_add_summary');
        const node = await this.store.addSummary(startNodeId, endNodeId, content, validated.contextType, validated.contextName, validated.contextValue);
        return { success: true, result: `docmem_add_summary: created summary ${node.id} over ${startNodeId} through ${endNodeId}`, lastId: node.id };
    }

    async moveNode(mode, nodeId, targetId) {
        await this.validateSameRoot(nodeId, targetId, 'docmem_move_node');
        const result = await this.executeWithMode(mode, nodeId, targetId, {
            appendChild: async (nId, tId) => await this.store.moveAppendChild(nId, tId),
            before: async (nId, tId) => await this.store.moveBefore(nId, tId),
            after: async (nId, tId) => await this.store.moveAfter(nId, tId),
            appendChildAction: (movedId, nId, tId) => `moved ${movedId} to last child of ${tId}`,
            beforeAction: (movedId, nId, tId) => `moved ${movedId} before ${tId}`,
            afterAction: (movedId, nId, tId) => `moved ${movedId} after ${tId}`
        }, 'docmem_move_node');
        return { success: true, result: `docmem_move_node: ${result.action}`, lastId: nodeId };
    }

    async copyNode(mode, nodeId, targetId) {
        const result = await this.executeWithMode(mode, nodeId, targetId, {
            appendChild: async (nId, tId) => await this.store.copyAppendChild(nId, tId),
            before: async (nId, tId) => await this.store.copyBefore(nId, tId),
            after: async (nId, tId) => await this.store.copyAfter(nId, tId),
            appendChildAction: (copyId, nId, tId) => `created ${copyId} as last child of ${tId}, a copy of ${nId}`,
            beforeAction: (copyId, nId, tId) => `created ${copyId} before ${tId}, a copy of ${nId}`,
            afterAction: (copyId, nId, tId) => `created ${copyId} after ${tId}, a copy of ${nId}`
        }, 'docmem_copy_node');
        return { success: true, result: `docmem_copy_node: ${result.action}`, lastId: result.node.id };
    }

    async getAllRoots() {
        const roots = await Docmem.getAllRoots();
        return { success: true, result: `docmem_get_all_roots:\n${JSON.stringify(roots, null, 2)}` };
    }
}
