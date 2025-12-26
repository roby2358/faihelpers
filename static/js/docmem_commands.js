/**
 * DocmemCommands - Command wrapper class for docmem operations
 */
export class DocmemCommands {
    constructor(docmem) {
        this.docmem = docmem;
    }

    async _create(rootId) {
        // Docmem is created automatically when instantiated
        const newDocmem = new Docmem(rootId);
        await newDocmem.ready();
        return { success: true, result: `docmem-create created docmem: ${rootId}` };
    }

    _appendChild(nodeId, contextType, contextName, contextValue, content) {
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

    _insertBetween(nodeId1, nodeId2, contextType, contextName, contextValue, content) {
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

    _updateContent(nodeId, content) {
        const node = this.docmem.update_content(nodeId, content);
        return { success: true, result: `docmem-update-content updated node: ${node.id}` };
    }

    _find(nodeId) {
        const node = this.docmem.find(nodeId);
        if (!node) {
            return { success: false, result: `docmem-find node not found: ${nodeId}` };
        }
        return { success: true, result: `docmem-find:\n${JSON.stringify(node.toDict(), null, 2)}` };
    }

    _delete(nodeId) {
        this.docmem.delete(nodeId);
        return { success: true, result: `docmem-delete deleted node: ${nodeId}` };
    }

    _serialize(nodeId) {
        const nodes = this.docmem.serialize(nodeId);
        return { success: true, result: `docmem-serialize:\n${JSON.stringify(nodes.map(n => n.toDict()), null, 2)}` };
    }

    _expandToLength(nodeId, maxTokens) {
        const maxTokensNum = parseInt(maxTokens, 10);
        if (isNaN(maxTokensNum)) {
            throw new Error(`maxTokens must be a number, got: ${maxTokens}`);
        }
        const nodes = this.docmem.expandToLength(nodeId, maxTokensNum);
        return { success: true, result: `docmem-expand-to-length:\n${JSON.stringify(nodes.map(n => n.toDict()), null, 2)}` };
    }

    _addSummary(contextType, contextName, contextValue, content, nodeIds) {
        if (nodeIds.length === 0) {
            throw new Error('docmem-add-summary requires at least one node_id');
        }
        const node = this.docmem.add_summary(nodeIds, content, contextType, contextName, contextValue);
        return { success: true, result: `docmem-add-summary added summary node: ${node.id}` };
    }

    _getAllRoots() {
        const roots = Docmem.getAllRoots();
        return { success: true, result: `docmem-get-all-roots:\n${JSON.stringify(roots, null, 2)}` };
    }
}

