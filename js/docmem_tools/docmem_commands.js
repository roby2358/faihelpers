/**
 * DocmemCommands - Command wrapper class for docmem operations
 */
import { Docmem } from './docmem.js';

export const KNOWN_DOCMEM_COMMANDS = new Set([
    'docmem_create',
    'docmem_create_node',
    'docmem_update_content',
    'docmem_update_context',
    'docmem_delete',
    'docmem_structure',
    'docmem_focus',
    'docmem_add_summary',
    'docmem_move_node',
    'docmem_copy_node',
    'docmem_get_all_roots',
]);

export class DocmemCommands {
    constructor(docmem) {
        this.docmem = docmem;
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
        const validatedContextName = this.validateFieldLength(contextName, 'context_name', commandName);
        const validatedContextValue = this.validateFieldLength(contextValue, 'context_value', commandName);
        return {
            contextType: validatedContextType,
            contextName: validatedContextName,
            contextValue: validatedContextValue
        };
    }

    async validateSameRoot(nodeId, targetId, commandName) {
        const nodeRoot = await this.docmem.getRootOfNode(nodeId);
        const targetRoot = await this.docmem.getRootOfNode(targetId);
        if (nodeRoot.id !== targetRoot.id) {
            throw new Error(`${commandName} requires node-id and target-id to have the same root node. You can only move nodes within a docmem. Node root: ${nodeRoot.id}, Target root: ${targetRoot.id}`);
        }
    }

    async executeWithMode(mode, nodeId, targetId, operations, commandName) {
        if (mode === 'append-child') {
            const node = await operations.appendChild(nodeId, targetId);
            return { node, action: operations.appendChildAction(nodeId, targetId) };
        } else if (mode === 'before') {
            const node = await operations.before(nodeId, targetId);
            return { node, action: operations.beforeAction(nodeId, targetId) };
        } else if (mode === 'after') {
            const node = await operations.after(nodeId, targetId);
            return { node, action: operations.afterAction(nodeId, targetId) };
        } else {
            throw new Error(`${commandName} requires mode to be append-child, before, or after, got: ${mode}`);
        }
    }

    async create(rootId) {
        const validatedRootId = this.validateFieldLength(rootId, 'root-id', 'docmem-create', true);
        // Docmem is created automatically when instantiated
        const newDocmem = new Docmem(validatedRootId);
        await newDocmem.ready();
        return { success: true, result: `docmem-create created docmem: ${validatedRootId}` };
    }

    async appendChild(nodeId, contextType, contextName, contextValue, content) {
        const validated = this.validateContext(contextType, contextName, contextValue, 'docmem-append-child');
        const node = await this.docmem.appendChild(nodeId, validated.contextType, validated.contextName, validated.contextValue, content);
        return { success: true, result: `docmem-append-child appended child node: ${node.id}` };
    }

    async insertBefore(nodeId, contextType, contextName, contextValue, content) {
        const validated = this.validateContext(contextType, contextName, contextValue, 'docmem-insert-before');
        const node = await this.docmem.insertBefore(nodeId, validated.contextType, validated.contextName, validated.contextValue, content);
        return { success: true, result: `docmem-insert-before inserted node: ${node.id}` };
    }

    async insertAfter(nodeId, contextType, contextName, contextValue, content) {
        const validated = this.validateContext(contextType, contextName, contextValue, 'docmem-insert-after');
        const node = await this.docmem.insertAfter(nodeId, validated.contextType, validated.contextName, validated.contextValue, content);
        return { success: true, result: `docmem-insert-after inserted node: ${node.id}` };
    }

    async createNode(mode, nodeId, contextType, contextName, contextValue, content) {
        const validated = this.validateContext(contextType, contextName, contextValue, 'docmem-create-node');
        const result = await this.executeWithMode(mode, nodeId, null, {
            appendChild: async (nId) => await this.docmem.appendChild(nId, validated.contextType, validated.contextName, validated.contextValue, content),
            before: async (nId) => await this.docmem.insertBefore(nId, validated.contextType, validated.contextName, validated.contextValue, content),
            after: async (nId) => await this.docmem.insertAfter(nId, validated.contextType, validated.contextName, validated.contextValue, content),
            appendChildAction: () => 'appended child node',
            beforeAction: () => 'inserted node before',
            afterAction: () => 'inserted node after'
        }, 'docmem-create-node');
        return { success: true, result: `docmem-create-node ${result.action}: ${result.node.id}` };
    }

    async updateContent(nodeId, content) {
        const node = await this.docmem.updateContent(nodeId, content);
        return { success: true, result: `docmem-update-content updated node: ${node.id}` };
    }

    async updateContext(nodeId, contextType, contextName, contextValue) {
        const validated = this.validateContext(contextType, contextName, contextValue, 'docmem-update-context');
        const node = await this.docmem.updateContext(nodeId, validated.contextType, validated.contextName, validated.contextValue);
        return { success: true, result: `docmem-update-context updated node: ${node.id}` };
    }

    async delete(nodeId) {
        await this.docmem.delete(nodeId);
        return { success: true, result: `docmem-delete deleted node: ${nodeId}` };
    }

    async structure(nodeId) {
        const structure = await this.docmem.structure(nodeId);
        return { success: true, result: `docmem-structure:\n${structure}` };
    }

    async focus(rootNodeId, nodeId) {
        const node = await this.docmem.find(nodeId);
        if (!node) {
            return { success: false, result: `docmem-focus node not found: ${nodeId}` };
        }
        const root = await this.docmem.getRootOfNode(nodeId);
        if (root.id !== rootNodeId) {
            return { success: false, result: `docmem-focus node ${nodeId} does not belong to docmem ${rootNodeId} (its root is ${root.id})` };
        }
        if (node.id === root.id) {
            Docmem.clearFocus(root.id);
            return { success: true, result: `docmem-focus cleared: docmem ${root.id} will serialize its full tree into context` };
        }
        Docmem.setFocus(root.id, node.id);
        return { success: true, result: `docmem-focus focused: docmem ${root.id} will serialize only the subtree of ${node.id} into context. Call docmem_focus("${root.id}", "${root.id}") to restore the full tree.` };
    }

    async addSummary(contextType, contextName, contextValue, content, startNodeId, endNodeId) {
        if (!startNodeId || !endNodeId) {
            throw new Error('docmem-add-summary requires both start-node-id and end-node-id');
        }
        const validated = this.validateContext(contextType, contextName, contextValue, 'docmem-add-summary');
        const node = await this.docmem.addSummary(startNodeId, endNodeId, content, validated.contextType, validated.contextName, validated.contextValue);
        return { success: true, result: `docmem-add-summary added summary node: ${node.id}` };
    }

    async moveAppendChild(nodeId, targetParentId) {
        const node = await this.docmem.moveAppendChild(nodeId, targetParentId);
        return { success: true, result: `docmem-move-append-child moved node ${nodeId} to parent ${targetParentId}` };
    }

    async moveBefore(nodeId, targetNodeId) {
        const node = await this.docmem.moveBefore(nodeId, targetNodeId);
        return { success: true, result: `docmem-move-before moved node ${nodeId} before node ${targetNodeId}` };
    }

    async moveAfter(nodeId, targetNodeId) {
        const node = await this.docmem.moveAfter(nodeId, targetNodeId);
        return { success: true, result: `docmem-move-after moved node ${nodeId} after node ${targetNodeId}` };
    }

    async moveNode(mode, nodeId, targetId) {
        await this.validateSameRoot(nodeId, targetId, 'docmem-move-node');
        const result = await this.executeWithMode(mode, nodeId, targetId, {
            appendChild: async (nId, tId) => await this.docmem.moveAppendChild(nId, tId),
            before: async (nId, tId) => await this.docmem.moveBefore(nId, tId),
            after: async (nId, tId) => await this.docmem.moveAfter(nId, tId),
            appendChildAction: (nId, tId) => `moved node ${nId} to parent ${tId}`,
            beforeAction: (nId, tId) => `moved node ${nId} before node ${tId}`,
            afterAction: (nId, tId) => `moved node ${nId} after node ${tId}`
        }, 'docmem-move-node');
        return { success: true, result: `docmem-move-node ${result.action}` };
    }

    async copyNode(mode, nodeId, targetId) {
        const result = await this.executeWithMode(mode, nodeId, targetId, {
            appendChild: async (nId, tId) => await this.docmem.copyAppendChild(nId, tId),
            before: async (nId, tId) => await this.docmem.copyBefore(nId, tId),
            after: async (nId, tId) => await this.docmem.copyAfter(nId, tId),
            appendChildAction: (nId, tId) => `copied node ${nId} to parent ${tId}`,
            beforeAction: (nId, tId) => `copied node ${nId} before node ${tId}`,
            afterAction: (nId, tId) => `copied node ${nId} after node ${tId}`
        }, 'docmem-copy-node');
        return { success: true, result: `docmem-copy-node ${result.action}: ${result.node.id}` };
    }

    async getAllRoots() {
        const roots = await Docmem.getAllRoots();
        return { success: true, result: `docmem-get-all-roots:\n${JSON.stringify(roots, null, 2)}` };
    }
}
