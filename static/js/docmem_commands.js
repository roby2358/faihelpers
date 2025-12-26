/**
 * DocmemCommands - Command wrapper class for docmem operations
 */
export class DocmemCommands {
    constructor(docmem) {
        this.docmem = docmem;
    }

    async create(rootId) {
        // Docmem is created automatically when instantiated
        const newDocmem = new Docmem(rootId);
        await newDocmem.ready();
        return { success: true, result: `docmem-create created docmem: ${rootId}` };
    }

    appendChild(nodeId, contextType, contextName, contextValue, content) {
        // Validate context fields are non-empty
        if (!contextType || !contextType.trim()) {
            throw new Error('docmem-append-child requires context_type to be a string of length 0 to 24');
        }
        if (!contextName || !contextName.trim()) {
            throw new Error('docmem-append-child requires context_name to be a string of length 0 to 24');
        }
        if (!contextValue || !contextValue.trim()) {
            throw new Error('docmem-append-child requires context_value to be a string of length 0 to 24');
        }

        const node = this.docmem.append_child(nodeId, contextType.trim(), contextName.trim(), contextValue.trim(), content);
        return { success: true, result: `docmem-append-child appended child node: ${node.id}` };
    }

    insertBetween(nodeId1, nodeId2, contextType, contextName, contextValue, content) {
        // Validate context fields are non-empty
        if (!contextType || !contextType.trim()) {
            throw new Error('docmem-insert-between requires context_type to be a string of length 0 to 24');
        }
        if (!contextName || !contextName.trim()) {
            throw new Error('docmem-insert-between requires context_name to be a string of length 0 to 24');
        }
        if (!contextValue || !contextValue.trim()) {
            throw new Error('docmem-insert-between requires context_value to be a string of length 0 to 24');
        }

        const node = this.docmem.insert_between(nodeId1, nodeId2, contextType.trim(), contextName.trim(), contextValue.trim(), content);
        return { success: true, result: `docmem-insert-between inserted node: ${node.id}` };
    }

    updateContent(nodeId, content) {
        const node = this.docmem.update_content(nodeId, content);
        return { success: true, result: `docmem-update-content updated node: ${node.id}` };
    }

    updateContext(nodeId, contextType, contextName, contextValue) {
        // Validate context fields are non-empty
        if (!contextType || !contextType.trim()) {
            throw new Error('docmem-update-context requires context_type to be a string of length 0 to 24');
        }
        if (!contextName || !contextName.trim()) {
            throw new Error('docmem-update-context requires context_name to be a string of length 0 to 24');
        }
        if (!contextValue || !contextValue.trim()) {
            throw new Error('docmem-update-context requires context_value to be a string of length 0 to 24');
        }

        const node = this.docmem.update_context(nodeId, contextType.trim(), contextName.trim(), contextValue.trim());
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

    addSummary(contextType, contextName, contextValue, content, nodeIds) {
        if (nodeIds.length === 0) {
            throw new Error('docmem-add-summary requires at least one node_id');
        }
        const node = this.docmem.add_summary(nodeIds, content, contextType, contextName, contextValue);
        return { success: true, result: `docmem-add-summary added summary node: ${node.id}` };
    }

    moveAppendChild(nodeId, targetParentId) {
        const node = this.docmem.move_append_child(nodeId, targetParentId);
        return { success: true, result: `docmem-move-append-child moved node ${nodeId} to parent ${targetParentId}` };
    }

    getAllRoots() {
        const roots = Docmem.getAllRoots();
        return { success: true, result: `docmem-get-all-roots:\n${JSON.stringify(roots, null, 2)}` };
    }
}

