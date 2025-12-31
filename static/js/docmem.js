class Node {
    constructor(nodeId, parentId, text, order, tokenCount = null, createdAt = null, updatedAt = null, contextType, contextName, contextValue) {
        if (!contextType || !contextName || !contextValue) {
            throw new Error('contextType, contextName, and contextValue are required');
        }
        this.id = nodeId;
        this.parentId = parentId;
        this.text = text;
        this.order = order;
        this.tokenCount = tokenCount !== null ? tokenCount : this._countTokens(text);
        this.createdAt = createdAt || new Date().toISOString();
        this.updatedAt = updatedAt || new Date().toISOString();
        this.contextType = contextType;
        this.contextName = contextName;
        this.contextValue = contextValue;
        this.hash = null;
    }

    _countTokens(text) {
        if (!text) return 0;
        try {
            // Try gpt-tokenizer from CDN - check various possible global names
            if (typeof gptTokenizer !== 'undefined') {
                if (typeof gptTokenizer.encode === 'function') {
                    return gptTokenizer.encode(text).length;
                } else if (typeof gptTokenizer === 'function') {
                    // If it's a constructor, instantiate it
                    const tokenizer = new gptTokenizer();
                    if (tokenizer && typeof tokenizer.encode === 'function') {
                        return tokenizer.encode(text).length;
                    }
                }
            }
            if (typeof GPTTokenizer !== 'undefined') {
                if (typeof GPTTokenizer.encode === 'function') {
                    return GPTTokenizer.encode(text).length;
                } else if (typeof GPTTokenizer === 'function') {
                    const tokenizer = new GPTTokenizer();
                    if (tokenizer && typeof tokenizer.encode === 'function') {
                        return tokenizer.encode(text).length;
                    }
                }
            }
            if (typeof window !== 'undefined') {
                if (window.gptTokenizer && typeof window.gptTokenizer.encode === 'function') {
                    return window.gptTokenizer.encode(text).length;
                }
            }
            // Try tiktoken
            if (typeof tiktoken !== 'undefined') {
                const encoding = tiktoken.get_encoding('cl100k_base');
                return encoding.encode(text).length;
            }
            // Fallback to approximation
            console.warn('Tokenizer not available, using approximation (characters / 4)');
            return Math.ceil(text.length / 4);
        } catch (e) {
            console.warn('Tokenizer error, using approximation:', e);
            return Math.ceil(text.length / 4);
        }
    }

    toDict() {
        return {
            id: this.id,
            parentId: this.parentId,
            text: this.text,
            order: this.order,
            tokenCount: this.tokenCount,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt,
            contextType: this.contextType,
            contextName: this.contextName,
            contextValue: this.contextValue,
            hash: this.hash
        };
    }

    static fromDict(data) {
        return new Node(
            data.id,
            data.parentId,
            data.text,
            data.order,
            data.tokenCount,
            data.createdAt,
            data.updatedAt,
            data.contextType,
            data.contextName,
            data.contextValue,
            data.hash
        );
    }
}

/**
 * NodeHasher - Computes SHA-512 hash of node state for optimistic locking
 */
class NodeHasher {
    /**
     * Compute hash for node state, set it on the node, and return the node
     * Hashes: parent_id, context_type, context_name, context_value, text, order
     * @param {Node} node - The node to hash
     * @returns {Promise<Node>} The node with hash property set (Base64-encoded SHA-512 hash, 88 characters)
     */
    static async hash(node) {
        // Create deterministic serialization: parent_id|context_type|context_name|context_value|text|order
        // Using | as delimiter (simple and unlikely to conflict)
        // Normalize NULL/undefined to empty string for deterministic hashing
        // Convert order to string for consistent serialization
        const data = [
            node.parentId || '',
            node.contextType || '',
            node.contextName || '',
            node.contextValue || '',
            node.text || '',
            String(node.order ?? '')
        ].join('|');
        
        // Compute SHA-512 hash
        const msgBuffer = new TextEncoder().encode(data);
        const hashBuffer = await crypto.subtle.digest('SHA-512', msgBuffer);
        
        // Convert to base64
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const binaryString = String.fromCharCode(...hashArray);
        node.hash = btoa(binaryString);
        return node;
    }
}

/**
 * OptimisticLockError - Error thrown when optimistic locking fails due to concurrent modification
 */
class OptimisticLockError extends Error {
    constructor(nodeId, message = 'Concurrent modification detected') {
        super(message);
        this.name = 'OptimisticLockError';
        this.nodeId = nodeId;
        this.message = `Optimistic lock failed for node ${nodeId}: ${message}. The node was modified by another operation. Please read the current state and retry your update.`;
    }
}

class Docmem {
    constructor(docmemId) {
        this.docmemId = docmemId;
        this.sqlite = new DocmemSQLite();
        this._initPromise = this._init();
    }

    async _init() {
        await this.sqlite.ready();
        // Check if root already exists, if not create it
        const existingRoot = this._getRootById(this.docmemId);
        if (!existingRoot) {
            await this._createRoot();
        }
    }

    async ready() {
        await this._initPromise;
    }

    _getRootById(rootId) {
        return this.sqlite.getRootById(rootId);
    }

    async _createRoot(contextType = 'root', contextName = 'purpose', contextValue = 'document') {
        // Check if root already exists
        const existingRoot = this._getRootById(this.docmemId);
        if (existingRoot) {
            return existingRoot;
        }
        
        const root = new Node(
            this.docmemId,
            null,
            '',
            0.0,
            null,
            null,
            null,
            contextType,
            contextName,
            contextValue
        );
        await NodeHasher.hash(root);
        await this.sqlite.insertNode(root);
        return root;
    }

    _updateTimestamp(node) {
        node.updatedAt = new Date().toISOString();
    }

    async _createAndInsertNode(parentId, content, order, contextType, contextName, contextValue) {
        const node = this._createNodeWithContext(parentId, content, order, contextType, contextName, contextValue);
        await NodeHasher.hash(node);
        await this.sqlite.insertNode(node);
        return node;
    }

    async _updateNode(node, expectedHash) {
        this._updateTimestamp(node);
        this.sqlite.updateNodeContent(node, expectedHash);
    }

    async _updateNodeContext(node, expectedHash) {
        this._updateTimestamp(node);
        this.sqlite.updateNodeContext(node, expectedHash);
    }

    _getNode(nodeId) {
        return this.sqlite.getNode(nodeId);
    }

    _getChildren(parentId) {
        return this.sqlite.getChildren(parentId);
    }

    async _insertNode(node) {
        await this.sqlite.insertNode(node);
    }

    _getRoot() {
        const root = this._getRootById(this.docmemId);
        if (!root) {
            throw new Error(`Root node not found for docmem: ${this.docmemId}`);
        }
        return root;
    }

    _getAllRoots() {
        return this.sqlite.getAllRoots();
    }

    static getAllRoots() {
        return DocmemSQLite.getAllRoots();
    }

    _requireNode(nodeId) {
        const node = this._getNode(nodeId);
        if (!node) {
            throw new Error(`Node ${nodeId} not found`);
        }
        return node;
    }

    _getRootOfNode(nodeId) {
        let node = this._requireNode(nodeId);
        while (node.parentId !== null) {
            node = this._requireNode(node.parentId);
        }
        return node;
    }

    _getSortedChildren(parentId) {
        const children = this._getChildren(parentId);
        return [...children].sort((a, b) => a.order - b.order);
    }

    _calculateOrderForAppend(parentId) {
        const children = this._getChildren(parentId);
        const maxOrder = children.length > 0 
            ? Math.max(...children.map(c => c.order))
            : 0.0;
        return maxOrder + 1.0;
    }

    _calculateOrderForBefore(targetNode, sortedChildren, targetIdx) {
        if (targetIdx > 0) {
            const siblingBefore = sortedChildren[targetIdx - 1];
            const targetOrder = targetNode.order;
            const siblingOrder = siblingBefore.order;
            return (siblingOrder * 4 + targetOrder * 1) / 5;
        } else {
            return targetNode.order - 1.0;
        }
    }

    _calculateOrderForAfter(targetNode, sortedChildren, targetIdx) {
        if (targetIdx < sortedChildren.length - 1) {
            const siblingAfter = sortedChildren[targetIdx + 1];
            const targetOrder = targetNode.order;
            const siblingOrder = siblingAfter.order;
            return (targetOrder * 4 + siblingOrder * 1) / 5;
        } else {
            return targetNode.order + 1.0;
        }
    }

    _findTargetIndexInSorted(sortedChildren, nodeId) {
        const targetIdx = sortedChildren.findIndex(n => n.id === nodeId);
        if (targetIdx === -1) {
            throw new Error('Target node not found in parent children');
        }
        return targetIdx;
    }

    _validateCycleBeforeMove(nodeId, targetParentId) {
        if (nodeId === targetParentId) {
            throw new Error('Cannot move a node to be a child of itself');
        }

        const descendants = [];
        this._getAllDescendants(nodeId, descendants);
        const descendantIds = new Set(descendants.map(n => n.id));

        if (descendantIds.has(targetParentId)) {
            throw new Error('Cannot move a node to be a child of one of its descendants');
        }
    }

    _validateCycleBeforeMoveSibling(nodeId, targetNode, operation) {
        if (nodeId === targetNode.id) {
            throw new Error(`Cannot move a node to be ${operation} itself`);
        }

        if (!targetNode.parentId) {
            throw new Error(`Cannot move a node to be ${operation} root node`);
        }

        const descendants = [];
        this._getAllDescendants(nodeId, descendants);
        const descendantIds = new Set(descendants.map(n => n.id));

        if (descendantIds.has(targetNode.parentId)) {
            throw new Error('Cannot move a node to be a sibling of a descendant');
        }
    }

    async _updateNodeParentAndOrder(node, expectedHash) {
        this._updateTimestamp(node);
        this.sqlite.updateNodeParentAndOrder(node, expectedHash);
        return this._getNode(node.id);
    }

    _createNodeWithContext(parentId, content, order, contextType, contextName, contextValue) {
        const newNodeId = randomString(8);
        return new Node(
            newNodeId,
            parentId,
            content,
            order,
            null,
            null,
            null,
            contextType,
            contextName,
            contextValue
        );
    }

    async append_child(node_id, context_type, context_name, context_value, content) {
        this._requireNode(node_id);
        const newOrder = this._calculateOrderForAppend(node_id);
        return await this._createAndInsertNode(node_id, content, newOrder, context_type, context_name, context_value);
    }

    async insert_before(node_id, context_type, context_name, context_value, content) {
        const targetNode = this._requireNode(node_id);
        
        const parentId = targetNode.parentId;
        if (!parentId) {
            throw new Error('Cannot insert before root node');
        }
        
        const sortedChildren = this._getSortedChildren(parentId);
        const targetIdx = this._findTargetIndexInSorted(sortedChildren, node_id);
        const newOrder = this._calculateOrderForBefore(targetNode, sortedChildren, targetIdx);
        
        return await this._createAndInsertNode(parentId, content, newOrder, context_type, context_name, context_value);
    }

    async insert_after(node_id, context_type, context_name, context_value, content) {
        const targetNode = this._requireNode(node_id);
        
        const parentId = targetNode.parentId;
        if (!parentId) {
            throw new Error('Cannot insert after root node');
        }
        
        const sortedChildren = this._getSortedChildren(parentId);
        const targetIdx = this._findTargetIndexInSorted(sortedChildren, node_id);
        const newOrder = this._calculateOrderForAfter(targetNode, sortedChildren, targetIdx);
        
        return await this._createAndInsertNode(parentId, content, newOrder, context_type, context_name, context_value);
    }

    delete(node_id) {
        this._requireNode(node_id);
        
        // Collect all descendants recursively before deletion
        // This ensures we delete all children to prevent orphaned nodes
        const descendants = [];
        this._getAllDescendants(node_id, descendants);
        
        // Delete all descendants first (bottom-up: children before parents)
        // _getAllDescendants returns nodes in pre-order (parent before children)
        // Reversing gives us post-order (children before parents) for safe deletion
        const descendantIds = descendants.map(n => n.id).reverse();
        for (const descendantId of descendantIds) {
            this.sqlite.deleteNodeById(descendantId);
        }
        
        // Finally delete the target node itself
        this.sqlite.deleteNodeById(node_id);
    }

    async update_content(node_id, content) {
        const node = this._requireNode(node_id);
        const expectedHash = node.hash;
        
        // Create a temporary node to calculate token count
        const tempNode = new Node(node_id, node.parentId, content, node.order, null, null, null, node.contextType, node.contextName, node.contextValue);
        node.text = content;
        node.tokenCount = tempNode.tokenCount;
        await NodeHasher.hash(node);
        await this._updateNode(node, expectedHash);
        return node;
    }

    async update_context(node_id, context_type, context_name, context_value) {
        const node = this._requireNode(node_id);
        const expectedHash = node.hash;
        
        node.contextType = context_type;
        node.contextName = context_name;
        node.contextValue = context_value;
        await NodeHasher.hash(node);
        await this._updateNodeContext(node, expectedHash);
        return node;
    }

    find(node_id) {
        return this._getNode(node_id);
    }

    async move_append_child(node_id, target_parent_id) {
        const node = this._requireNode(node_id);
        const expectedHash = node.hash;
        this._requireNode(target_parent_id);
        this._validateCycleBeforeMove(node_id, target_parent_id);

        const newOrder = this._calculateOrderForAppend(target_parent_id);
        node.parentId = target_parent_id;
        node.order = newOrder;
        await NodeHasher.hash(node);
        return await this._updateNodeParentAndOrder(node, expectedHash);
    }

    async move_before(node_id, target_node_id) {
        const node = this._requireNode(node_id);
        const expectedHash = node.hash;
        const targetNode = this._requireNode(target_node_id);
        this._validateCycleBeforeMoveSibling(node_id, targetNode, 'before');

        const targetParentId = targetNode.parentId;
        const sortedChildren = this._getSortedChildren(targetParentId);
        const targetIdx = this._findTargetIndexInSorted(sortedChildren, target_node_id);
        const newOrder = this._calculateOrderForBefore(targetNode, sortedChildren, targetIdx);

        node.parentId = targetParentId;
        node.order = newOrder;
        await NodeHasher.hash(node);
        return await this._updateNodeParentAndOrder(node, expectedHash);
    }

    async move_after(node_id, target_node_id) {
        const node = this._requireNode(node_id);
        const expectedHash = node.hash;
        const targetNode = this._requireNode(target_node_id);
        this._validateCycleBeforeMoveSibling(node_id, targetNode, 'after');

        const targetParentId = targetNode.parentId;
        const sortedChildren = this._getSortedChildren(targetParentId);
        const targetIdx = this._findTargetIndexInSorted(sortedChildren, target_node_id);
        const newOrder = this._calculateOrderForAfter(targetNode, sortedChildren, targetIdx);

        node.parentId = targetParentId;
        node.order = newOrder;
        await NodeHasher.hash(node);
        return await this._updateNodeParentAndOrder(node, expectedHash);
    }

    async _copyNodeRecursive(sourceNodeId, newParentId, newOrder) {
        const sourceNode = this._requireNode(sourceNodeId);
        const newNodeId = randomString(8);
        const newNode = new Node(
            newNodeId,
            newParentId,
            sourceNode.text,
            newOrder,
            sourceNode.tokenCount,
            new Date().toISOString(),
            new Date().toISOString(),
            sourceNode.contextType,
            sourceNode.contextName,
            sourceNode.contextValue
        );
        await NodeHasher.hash(newNode);
        await this.sqlite.insertNode(newNode);
        
        // Recursively copy all children
        const children = this._getChildren(sourceNodeId);
        let childOrder = this._calculateOrderForAppend(newNodeId);
        for (const child of children) {
            await this._copyNodeRecursive(child.id, newNodeId, childOrder);
            childOrder += 1.0;
        }
        
        return newNode;
    }

    async copy_append_child(node_id, target_parent_id) {
        this._requireNode(node_id);
        this._requireNode(target_parent_id);
        
        const newOrder = this._calculateOrderForAppend(target_parent_id);
        return await this._copyNodeRecursive(node_id, target_parent_id, newOrder);
    }

    async copy_before(node_id, target_node_id) {
        this._requireNode(node_id);
        const targetNode = this._requireNode(target_node_id);
        
        const targetParentId = targetNode.parentId;
        if (!targetParentId) {
            throw new Error('Cannot copy a node to be before root node');
        }
        
        const sortedChildren = this._getSortedChildren(targetParentId);
        const targetIdx = this._findTargetIndexInSorted(sortedChildren, target_node_id);
        const newOrder = this._calculateOrderForBefore(targetNode, sortedChildren, targetIdx);
        
        return await this._copyNodeRecursive(node_id, targetParentId, newOrder);
    }

    async copy_after(node_id, target_node_id) {
        this._requireNode(node_id);
        const targetNode = this._requireNode(target_node_id);
        
        const targetParentId = targetNode.parentId;
        if (!targetParentId) {
            throw new Error('Cannot copy a node to be after root node');
        }
        
        const sortedChildren = this._getSortedChildren(targetParentId);
        const targetIdx = this._findTargetIndexInSorted(sortedChildren, target_node_id);
        const newOrder = this._calculateOrderForAfter(targetNode, sortedChildren, targetIdx);
        
        return await this._copyNodeRecursive(node_id, targetParentId, newOrder);
    }

    _getAllDescendants(nodeId, result) {
        const children = this._getChildren(nodeId);
        for (const child of children) {
            result.push(child);
            this._getAllDescendants(child.id, result);
        }
    }

    serialize(nodeId) {
        if (!nodeId) {
            throw new Error('nodeId is required');
        }
        const result = [];
        const startNode = this._requireNode(nodeId);
        this._serializeRecursive(startNode, result);
        return result;
    }

    _serializeRecursive(node, result) {
        result.push(node);
        const sortedChildren = this._getSortedChildren(node.id);
        for (const child of sortedChildren) {
            this._serializeRecursive(child, result);
        }
    }

    structure(nodeId) {
        if (!nodeId) {
            throw new Error('nodeId is required');
        }
        const result = [];
        const startNode = this._requireNode(nodeId);
        this._structureRecursive(startNode, result);
        return result;
    }

    _structureRecursive(node, result) {
        // Return structure without text content
        result.push({
            id: node.id,
            parentId: node.parentId,
            order: node.order,
            tokenCount: node.tokenCount,
            createdAt: node.createdAt,
            updatedAt: node.updatedAt,
            contextType: node.contextType,
            contextName: node.contextName,
            contextValue: node.contextValue
        });
        const sortedChildren = this._getSortedChildren(node.id);
        for (const child of sortedChildren) {
            this._structureRecursive(child, result);
        }
    }

    expandToLength(nodeId, maxTokens) {
        if (!nodeId) {
            throw new Error('nodeId is required');
        }
        const result = [];
        const startNode = this._requireNode(nodeId);
        
        // Include the starting node itself first (always included, even if it exceeds limit)
        result.push(startNode);
        let totalTokens = startNode.tokenCount || 0;
        
        // Step 1: BFS to depth 1
        const depth1Nodes = [];
        const queue = [{ node: startNode, depth: 0 }];
        
        while (queue.length > 0) {
            const { node, depth } = queue.shift();
            
            if (depth === 1) {
                depth1Nodes.push(node);
            } else if (depth < 1) {
                const sortedChildren = this._getSortedChildren(node.id);
                for (const child of sortedChildren) {
                    queue.push({ node: child, depth: depth + 1 });
                }
            }
        }
        
        // Step 2: Expand nodes one by one if possible
        const sortedDepth1 = depth1Nodes.sort((a, b) => a.order - b.order);
        
        for (const node of sortedDepth1) {
            if (totalTokens >= maxTokens) {
                break;
            }
            
            const children = this._getChildren(node.id);
            if (children.length > 0) {
                // Node has children, expand by including its children
                const sortedChildren = this._getSortedChildren(node.id);
                for (const child of sortedChildren) {
                    if (totalTokens + child.tokenCount <= maxTokens) {
                        result.push(child);
                        totalTokens += child.tokenCount;
                    } else {
                        // Stop when we exceed the length
                        break;
                    }
                }
            } else {
                // Node with no children, just include it
                if (totalTokens + node.tokenCount <= maxTokens) {
                    result.push(node);
                    totalTokens += node.tokenCount;
                } else {
                    break;
                }
            }
        }
        
        return result;
    }

    async add_summary(startNodeId, endNodeId, content, context_type, context_name, context_value) {
        if (!startNodeId || !endNodeId) {
            throw new Error('Must provide both start-node-id and end-node-id');
        }

        const startNode = this._requireNode(startNodeId);
        const endNode = this._requireNode(endNodeId);

        // Check that both nodes have the same parent
        if (startNode.parentId !== endNode.parentId) {
            throw new Error(`Start node and end node must have the same parent. Start node parent: ${startNode.parentId}, End node parent: ${endNode.parentId}`);
        }

        const parentId = startNode.parentId;
        if (!parentId) {
            throw new Error('Cannot summarize root nodes');
        }

        this._requireNode(parentId);

        // Get all siblings sorted by order
        const sortedSiblings = this._getSortedChildren(parentId);
        
        // Find indices of start and end nodes
        const startIndex = sortedSiblings.findIndex(n => n.id === startNodeId);
        const endIndex = sortedSiblings.findIndex(n => n.id === endNodeId);

        if (startIndex === -1) {
            throw new Error(`Start node ${startNodeId} not found as a child of parent ${parentId}`);
        }
        if (endIndex === -1) {
            throw new Error(`End node ${endNodeId} not found as a child of parent ${parentId}`);
        }

        if (startIndex > endIndex) {
            throw new Error(`Start node must come before or equal to end node in sibling order. Start index: ${startIndex}, End index: ${endIndex}`);
        }

        // Get all nodes between start and end (inclusive)
        const memoryNodesSorted = sortedSiblings.slice(startIndex, endIndex + 1);

        // Check that all nodes are leaf nodes (have no children) - these are the "memories"
        const nodesWithChildren = memoryNodesSorted.filter(n => this._getChildren(n.id).length > 0);
        if (nodesWithChildren.length > 0) {
            throw new Error(`All nodes to summarize must be leaf nodes (have no children). Nodes with children: ${nodesWithChildren.map(n => n.id).join(', ')}`);
        }

        const minOrder = memoryNodesSorted[0].order;
        const maxOrder = memoryNodesSorted[memoryNodesSorted.length - 1].order;
        const summaryOrder = (minOrder + maxOrder) / 2;

        const summaryNode = await this._createAndInsertNode(parentId, content, summaryOrder, context_type, context_name, context_value);

        // Update parent_id for memory nodes and recompute their hashes
        for (const memoryNode of memoryNodesSorted) {
            if (!memoryNode.hash) {
                throw new Error(`Node ${memoryNode.id} does not have a hash. Cannot perform optimistic locking check.`);
            }
            const expectedHash = memoryNode.hash;
            
            const oldParentId = memoryNode.parentId;
            memoryNode.parentId = summaryNode.id;
            await NodeHasher.hash(memoryNode);
            this._updateTimestamp(memoryNode);
            
            try {
                this.sqlite.updateNodeParent(memoryNode.id, memoryNode.parentId, memoryNode.hash, memoryNode.updatedAt, expectedHash);
            } catch (error) {
                // Restore original parent on failure
                memoryNode.parentId = oldParentId;
                throw error;
            }
        }

        return summaryNode;
    }

    close() {
        this.sqlite.close();
    }
}
