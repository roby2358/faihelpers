/**
 * DocmemCommands - Command wrapper class for docmem operations
 */
export class DocmemCommands {
    constructor(docmem) {
        this.docmem = docmem;
    }

    _validateFieldLength(value, fieldName, commandName, allowEmpty = false) {
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

    async create(rootId) {
        const validatedRootId = this._validateFieldLength(rootId, 'root-id', 'docmem-create', true);
        // Docmem is created automatically when instantiated
        const newDocmem = new Docmem(validatedRootId);
        await newDocmem.ready();
        return { success: true, result: `docmem-create created docmem: ${validatedRootId}` };
    }

    appendChild(nodeId, contextType, contextName, contextValue, content) {
        const validatedContextType = this._validateFieldLength(contextType, 'context_type', 'docmem-append-child');
        const validatedContextName = this._validateFieldLength(contextName, 'context_name', 'docmem-append-child');
        const validatedContextValue = this._validateFieldLength(contextValue, 'context_value', 'docmem-append-child');

        const node = this.docmem.append_child(nodeId, validatedContextType, validatedContextName, validatedContextValue, content);
        return { success: true, result: `docmem-append-child appended child node: ${node.id}` };
    }

    insertBefore(nodeId, contextType, contextName, contextValue, content) {
        const validatedContextType = this._validateFieldLength(contextType, 'context_type', 'docmem-insert-before');
        const validatedContextName = this._validateFieldLength(contextName, 'context_name', 'docmem-insert-before');
        const validatedContextValue = this._validateFieldLength(contextValue, 'context_value', 'docmem-insert-before');

        const node = this.docmem.insert_before(nodeId, validatedContextType, validatedContextName, validatedContextValue, content);
        return { success: true, result: `docmem-insert-before inserted node: ${node.id}` };
    }

    insertAfter(nodeId, contextType, contextName, contextValue, content) {
        const validatedContextType = this._validateFieldLength(contextType, 'context_type', 'docmem-insert-after');
        const validatedContextName = this._validateFieldLength(contextName, 'context_name', 'docmem-insert-after');
        const validatedContextValue = this._validateFieldLength(contextValue, 'context_value', 'docmem-insert-after');

        const node = this.docmem.insert_after(nodeId, validatedContextType, validatedContextName, validatedContextValue, content);
        return { success: true, result: `docmem-insert-after inserted node: ${node.id}` };
    }

    createNode(mode, nodeId, contextType, contextName, contextValue, content) {
        const validatedContextType = this._validateFieldLength(contextType, 'context_type', 'docmem-create-node');
        const validatedContextName = this._validateFieldLength(contextName, 'context_name', 'docmem-create-node');
        const validatedContextValue = this._validateFieldLength(contextValue, 'context_value', 'docmem-create-node');

        let node;
        let action;
        if (mode === '--append-child') {
            node = this.docmem.append_child(nodeId, validatedContextType, validatedContextName, validatedContextValue, content);
            action = 'appended child node';
        } else if (mode === '--before') {
            node = this.docmem.insert_before(nodeId, validatedContextType, validatedContextName, validatedContextValue, content);
            action = 'inserted node before';
        } else if (mode === '--after') {
            node = this.docmem.insert_after(nodeId, validatedContextType, validatedContextName, validatedContextValue, content);
            action = 'inserted node after';
        } else {
            throw new Error(`docmem-create-node requires mode to be --append-child, --before, or --after, got: ${mode}`);
        }
        return { success: true, result: `docmem-create-node ${action}: ${node.id}` };
    }

    updateContent(nodeId, content) {
        const node = this.docmem.update_content(nodeId, content);
        return { success: true, result: `docmem-update-content updated node: ${node.id}` };
    }

    updateContext(nodeId, contextType, contextName, contextValue) {
        const validatedContextType = this._validateFieldLength(contextType, 'context_type', 'docmem-update-context');
        const validatedContextName = this._validateFieldLength(contextName, 'context_name', 'docmem-update-context');
        const validatedContextValue = this._validateFieldLength(contextValue, 'context_value', 'docmem-update-context');

        const node = this.docmem.update_context(nodeId, validatedContextType, validatedContextName, validatedContextValue);
        return { success: true, result: `docmem-update-context updated node: ${node.id}` };
    }

    find(nodeId) {
        const node = this.docmem.find(nodeId);
        if (!node) {
            return { success: false, result: `docmem-find node not found: ${nodeId}` };
        }
        return { success: true, result: `docmem-find:\n${JSON.stringify(node.toDict(), null, 2)}` };
    }

    delete(nodeId) {
        this.docmem.delete(nodeId);
        return { success: true, result: `docmem-delete deleted node: ${nodeId}` };
    }

    serialize(nodeId) {
        const nodes = this.docmem.serialize(nodeId);
        const content = nodes.map(n => n.text).join('\n\n');
        return { success: true, result: `docmem-serialize:\n${content}` };
    }

    structure(nodeId) {
        const structure = this.docmem.structure(nodeId);
        return { success: true, result: `docmem-structure:\n${JSON.stringify(structure, null, 2)}` };
    }

    expandToLength(nodeId, maxTokens) {
        const maxTokensNum = parseInt(maxTokens, 10);
        if (isNaN(maxTokensNum)) {
            throw new Error(`maxTokens must be a number, got: ${maxTokens}`);
        }
        const nodes = this.docmem.expandToLength(nodeId, maxTokensNum);
        return { success: true, result: `docmem-expand-to-length:\n${JSON.stringify(nodes.map(n => n.toDict()), null, 2)}` };
    }

    addSummary(contextType, contextName, contextValue, content, startNodeId, endNodeId) {
        if (!startNodeId || !endNodeId) {
            throw new Error('docmem-add-summary requires both start-node-id and end-node-id');
        }
        const validatedContextType = this._validateFieldLength(contextType, 'context_type', 'docmem-add-summary');
        const validatedContextName = this._validateFieldLength(contextName, 'context_name', 'docmem-add-summary');
        const validatedContextValue = this._validateFieldLength(contextValue, 'context_value', 'docmem-add-summary');

        const node = this.docmem.add_summary(startNodeId, endNodeId, content, validatedContextType, validatedContextName, validatedContextValue);
        return { success: true, result: `docmem-add-summary added summary node: ${node.id}` };
    }

    moveAppendChild(nodeId, targetParentId) {
        const node = this.docmem.move_append_child(nodeId, targetParentId);
        return { success: true, result: `docmem-move-append-child moved node ${nodeId} to parent ${targetParentId}` };
    }

    moveBefore(nodeId, targetNodeId) {
        const node = this.docmem.move_before(nodeId, targetNodeId);
        return { success: true, result: `docmem-move-before moved node ${nodeId} before node ${targetNodeId}` };
    }

    moveAfter(nodeId, targetNodeId) {
        const node = this.docmem.move_after(nodeId, targetNodeId);
        return { success: true, result: `docmem-move-after moved node ${nodeId} after node ${targetNodeId}` };
    }

    moveNode(mode, nodeId, targetId) {
        // Validate that both nodes belong to the same root
        const nodeRoot = this.docmem._getRootOfNode(nodeId);
        const targetRoot = this.docmem._getRootOfNode(targetId);
        if (nodeRoot.id !== targetRoot.id) {
            throw new Error(`docmem-move-node requires node-id and target-id to have the same root node. Node root: ${nodeRoot.id}, Target root: ${targetRoot.id}`);
        }

        let node;
        let action;
        if (mode === '--append-child') {
            node = this.docmem.move_append_child(nodeId, targetId);
            action = `moved node ${nodeId} to parent ${targetId}`;
        } else if (mode === '--before') {
            node = this.docmem.move_before(nodeId, targetId);
            action = `moved node ${nodeId} before node ${targetId}`;
        } else if (mode === '--after') {
            node = this.docmem.move_after(nodeId, targetId);
            action = `moved node ${nodeId} after node ${targetId}`;
        } else {
            throw new Error(`docmem-move-node requires mode to be --append-child, --before, or --after, got: ${mode}`);
        }
        return { success: true, result: `docmem-move-node ${action}` };
    }

    copyNode(mode, nodeId, targetId) {
        // Validate that both nodes belong to the same root
        const nodeRoot = this.docmem._getRootOfNode(nodeId);
        const targetRoot = this.docmem._getRootOfNode(targetId);
        if (nodeRoot.id !== targetRoot.id) {
            throw new Error(`docmem-copy-node requires node-id and target-id to have the same root node. Node root: ${nodeRoot.id}, Target root: ${targetRoot.id}`);
        }

        let node;
        let action;
        if (mode === '--append-child') {
            node = this.docmem.copy_append_child(nodeId, targetId);
            action = `copied node ${nodeId} to parent ${targetId}`;
        } else if (mode === '--before') {
            node = this.docmem.copy_before(nodeId, targetId);
            action = `copied node ${nodeId} before node ${targetId}`;
        } else if (mode === '--after') {
            node = this.docmem.copy_after(nodeId, targetId);
            action = `copied node ${nodeId} after node ${targetId}`;
        } else {
            throw new Error(`docmem-copy-node requires mode to be --append-child, --before, or --after, got: ${mode}`);
        }
        return { success: true, result: `docmem-copy-node ${action}: ${node.id}` };
    }

    getAllRoots() {
        const roots = Docmem.getAllRoots();
        return { success: true, result: `docmem-get-all-roots:\n${JSON.stringify(roots, null, 2)}` };
    }
}

