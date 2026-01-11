class Node {
    constructor(nodeId, parentId, text, order, tokenCount = null, createdAt = null, updatedAt = null, contextType, contextName, contextValue, readonly = 0) {
        if (!contextType || !contextName || !contextValue) {
            throw new Error('contextType, contextName, and contextValue are required');
        }
        this.id = nodeId;
        this.parentId = parentId;
        this.text = text;
        this.order = order;
        this.tokenCount = tokenCount !== null ? tokenCount : this.countTokens(text);
        this.createdAt = createdAt || new Date().toISOString();
        this.updatedAt = updatedAt || new Date().toISOString();
        this.contextType = contextType;
        this.contextName = contextName;
        this.contextValue = contextValue;
        this.readonly = readonly === undefined ? 0 : readonly;
        this.hash = null;
    }

    countTokens(text) {
        if (!text) return 0;
        // Using approximation (characters / 4) instead of tokenizer
        // This provides a reasonable estimate for token counting purposes
        return Math.ceil(text.length / 4);
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
            readonly: this.readonly,
            hash: this.hash
        };
    }

    static fromDict(data) {
        const node = new Node(
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
            data.readonly !== undefined ? data.readonly : 0
        );
        node.hash = data.hash || null;
        return node;
    }
}

/**
 * NodeHasher - Computes SHA-512 hash of node state for optimistic locking
 */
class NodeHasher {
    /**
     * Compute hash for node state, set it on the node, and return the node
     * Hashes: parentId, contextType, contextName, contextValue, text, order
     * @param {Node} node - The node to hash
     * @returns {Promise<Node>} The node with hash property set (Base64-encoded SHA-512 hash, 88 characters)
     */
    static async hash(node) {
        // Create deterministic serialization: parentId|contextType|contextName|contextValue|text|order
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
        this.initPromise = this.init();
    }

    async init() {
        await this.sqlite.ready();
        // Check if root already exists, if not create it
        const existingRoot = this.getRootById(this.docmemId);
        if (!existingRoot) {
            await this.createRoot();
        }
    }

    async ready() {
        await this.initPromise;
    }

    getRootById(rootId) {
        return this.sqlite.getRootById(rootId);
    }

    async createRoot(contextType = 'root', contextName = 'purpose', contextValue = 'document') {
        // Check if root already exists
        const existingRoot = this.getRootById(this.docmemId);
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

    updateTimestamp(node) {
        node.updatedAt = new Date().toISOString();
    }

    async createAndInsertNode(parentId, content, order, contextType, contextName, contextValue, readonly = 0) {
        const node = this.createNodeWithContext(parentId, content, order, contextType, contextName, contextValue, readonly);
        await NodeHasher.hash(node);
        await this.sqlite.insertNode(node);
        return node;
    }

    async updateNode(node, expectedHash) {
        this.updateTimestamp(node);
        this.sqlite.updateNodeContent(node, expectedHash);
    }

    async updateNodeContext(node, expectedHash) {
        this.updateTimestamp(node);
        this.sqlite.updateNodeContext(node, expectedHash);
    }

    getNode(nodeId) {
        return this.sqlite.getNode(nodeId);
    }

    getChildren(parentId) {
        return this.sqlite.getChildren(parentId);
    }

    async insertNode(node) {
        await this.sqlite.insertNode(node);
    }

    getRoot() {
        const root = this.getRootById(this.docmemId);
        if (!root) {
            throw new Error(`Root node not found for docmem: ${this.docmemId}`);
        }
        return root;
    }

    getAllRoots() {
        return this.sqlite.getAllRoots();
    }

    static getAllRoots() {
        return DocmemSQLite.getAllRoots();
    }

    requireNode(nodeId) {
        const node = this.getNode(nodeId);
        if (!node) {
            throw new Error(`Node ${nodeId} not found`);
        }
        return node;
    }

    getRootOfNode(nodeId) {
        let node = this.requireNode(nodeId);
        while (node.parentId !== null) {
            node = this.requireNode(node.parentId);
        }
        return node;
    }

    getSortedChildren(parentId) {
        const children = this.getChildren(parentId);
        return [...children].sort((a, b) => a.order - b.order);
    }

    calculateOrderForAppend(parentId) {
        const children = this.getChildren(parentId);
        const maxOrder = children.length > 0 
            ? Math.max(...children.map(c => c.order))
            : 0.0;
        return maxOrder + 1.0;
    }

    calculateOrderForBefore(targetNode, sortedChildren, targetIdx) {
        if (targetIdx > 0) {
            const siblingBefore = sortedChildren[targetIdx - 1];
            const targetOrder = targetNode.order;
            const siblingOrder = siblingBefore.order;
            return (siblingOrder * 4 + targetOrder * 1) / 5;
        } else {
            return targetNode.order - 1.0;
        }
    }

    calculateOrderForAfter(targetNode, sortedChildren, targetIdx) {
        if (targetIdx < sortedChildren.length - 1) {
            const siblingAfter = sortedChildren[targetIdx + 1];
            const targetOrder = targetNode.order;
            const siblingOrder = siblingAfter.order;
            return (targetOrder * 4 + siblingOrder * 1) / 5;
        } else {
            return targetNode.order + 1.0;
        }
    }

    findTargetIndexInSorted(sortedChildren, nodeId) {
        const targetIdx = sortedChildren.findIndex(n => n.id === nodeId);
        if (targetIdx === -1) {
            throw new Error('Target node not found in parent children');
        }
        return targetIdx;
    }

    validateCycleBeforeMove(nodeId, targetParentId) {
        if (nodeId === targetParentId) {
            throw new Error('Cannot move a node to be a child of itself');
        }

        const descendants = [];
        this.getAllDescendants(nodeId, descendants);
        const descendantIds = new Set(descendants.map(n => n.id));

        if (descendantIds.has(targetParentId)) {
            throw new Error('Cannot move a node to be a child of one of its descendants');
        }
    }

    validateCycleBeforeMoveSibling(nodeId, targetNode, operation) {
        if (nodeId === targetNode.id) {
            throw new Error(`Cannot move a node to be ${operation} itself`);
        }

        if (!targetNode.parentId) {
            throw new Error(`Cannot move a node to be ${operation} root node`);
        }

        const descendants = [];
        this.getAllDescendants(nodeId, descendants);
        const descendantIds = new Set(descendants.map(n => n.id));

        if (descendantIds.has(targetNode.parentId)) {
            throw new Error('Cannot move a node to be a sibling of a descendant');
        }
    }

    async updateNodeParentAndOrder(node, expectedHash) {
        this.updateTimestamp(node);
        this.sqlite.updateNodeParentAndOrder(node, expectedHash);
        return this.getNode(node.id);
    }

    createNodeWithContext(parentId, content, order, contextType, contextName, contextValue, readonly = 0) {
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
            contextValue,
            readonly
        );
    }

    async appendChild(nodeId, contextType, contextName, contextValue, content) {
        this.requireNode(nodeId);
        const newOrder = this.calculateOrderForAppend(nodeId);
        return await this.createAndInsertNode(nodeId, content, newOrder, contextType, contextName, contextValue);
    }

    async insertBefore(nodeId, contextType, contextName, contextValue, content) {
        const targetNode = this.requireNode(nodeId);
        
        const parentId = targetNode.parentId;
        if (!parentId) {
            throw new Error('Cannot insert before root node');
        }
        
        const sortedChildren = this.getSortedChildren(parentId);
        const targetIdx = this.findTargetIndexInSorted(sortedChildren, nodeId);
        const newOrder = this.calculateOrderForBefore(targetNode, sortedChildren, targetIdx);
        
        return await this.createAndInsertNode(parentId, content, newOrder, contextType, contextName, contextValue);
    }

    async insertAfter(nodeId, contextType, contextName, contextValue, content) {
        const targetNode = this.requireNode(nodeId);
        
        const parentId = targetNode.parentId;
        if (!parentId) {
            throw new Error('Cannot insert after root node');
        }
        
        const sortedChildren = this.getSortedChildren(parentId);
        const targetIdx = this.findTargetIndexInSorted(sortedChildren, nodeId);
        const newOrder = this.calculateOrderForAfter(targetNode, sortedChildren, targetIdx);
        
        return await this.createAndInsertNode(parentId, content, newOrder, contextType, contextName, contextValue);
    }

    delete(nodeId) {
        this.requireNode(nodeId);
        
        // Collect all descendants recursively before deletion
        // This ensures we delete all children to prevent orphaned nodes
        const descendants = [];
        this.getAllDescendants(nodeId, descendants);
        
        // Delete all descendants first (bottom-up: children before parents)
        // getAllDescendants returns nodes in pre-order (parent before children)
        // Reversing gives us post-order (children before parents) for safe deletion
        const descendantIds = descendants.map(n => n.id).reverse();
        for (const descendantId of descendantIds) {
            this.sqlite.deleteNodeById(descendantId);
        }
        
        // Finally delete the target node itself
        this.sqlite.deleteNodeById(nodeId);
    }

    async updateContent(nodeId, content) {
        const node = this.requireNode(nodeId);
        if (node.readonly === 1) {
            throw new Error(`Cannot update content of readonly node ${nodeId}`);
        }
        const expectedHash = node.hash;
        
        // Create a temporary node to calculate token count
        const tempNode = new Node(nodeId, node.parentId, content, node.order, null, null, null, node.contextType, node.contextName, node.contextValue, node.readonly);
        node.text = content;
        node.tokenCount = tempNode.tokenCount;
        await NodeHasher.hash(node);
        await this.updateNode(node, expectedHash);
        return node;
    }

    async updateContext(nodeId, contextType, contextName, contextValue) {
        const node = this.requireNode(nodeId);
        if (node.readonly === 1) {
            throw new Error(`Cannot update context of readonly node ${nodeId}`);
        }
        const expectedHash = node.hash;
        
        node.contextType = contextType;
        node.contextName = contextName;
        node.contextValue = contextValue;
        await NodeHasher.hash(node);
        await this.updateNodeContext(node, expectedHash);
        return node;
    }

    find(nodeId) {
        return this.getNode(nodeId);
    }

    async moveAppendChild(nodeId, targetParentId) {
        const node = this.requireNode(nodeId);
        const expectedHash = node.hash;
        this.requireNode(targetParentId);
        this.validateCycleBeforeMove(nodeId, targetParentId);

        const newOrder = this.calculateOrderForAppend(targetParentId);
        node.parentId = targetParentId;
        node.order = newOrder;
        await NodeHasher.hash(node);
        return await this.updateNodeParentAndOrder(node, expectedHash);
    }

    async moveBefore(nodeId, targetNodeId) {
        const node = this.requireNode(nodeId);
        const expectedHash = node.hash;
        const targetNode = this.requireNode(targetNodeId);
        this.validateCycleBeforeMoveSibling(nodeId, targetNode, 'before');

        const targetParentId = targetNode.parentId;
        const sortedChildren = this.getSortedChildren(targetParentId);
        const targetIdx = this.findTargetIndexInSorted(sortedChildren, targetNodeId);
        const newOrder = this.calculateOrderForBefore(targetNode, sortedChildren, targetIdx);

        node.parentId = targetParentId;
        node.order = newOrder;
        await NodeHasher.hash(node);
        return await this.updateNodeParentAndOrder(node, expectedHash);
    }

    async moveAfter(nodeId, targetNodeId) {
        const node = this.requireNode(nodeId);
        const expectedHash = node.hash;
        const targetNode = this.requireNode(targetNodeId);
        this.validateCycleBeforeMoveSibling(nodeId, targetNode, 'after');

        const targetParentId = targetNode.parentId;
        const sortedChildren = this.getSortedChildren(targetParentId);
        const targetIdx = this.findTargetIndexInSorted(sortedChildren, targetNodeId);
        const newOrder = this.calculateOrderForAfter(targetNode, sortedChildren, targetIdx);

        node.parentId = targetParentId;
        node.order = newOrder;
        await NodeHasher.hash(node);
        return await this.updateNodeParentAndOrder(node, expectedHash);
    }

    async copyNodeRecursive(sourceNodeId, newParentId, newOrder) {
        const sourceNode = this.requireNode(sourceNodeId);
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
            sourceNode.contextValue,
            sourceNode.readonly
        );
        await NodeHasher.hash(newNode);
        await this.sqlite.insertNode(newNode);
        
        // Recursively copy all children
        const children = this.getChildren(sourceNodeId);
        let childOrder = this.calculateOrderForAppend(newNodeId);
        for (const child of children) {
            await this.copyNodeRecursive(child.id, newNodeId, childOrder);
            childOrder += 1.0;
        }
        
        return newNode;
    }

    async copyAppendChild(nodeId, targetParentId) {
        this.requireNode(nodeId);
        this.requireNode(targetParentId);
        
        const newOrder = this.calculateOrderForAppend(targetParentId);
        return await this.copyNodeRecursive(nodeId, targetParentId, newOrder);
    }

    async copyBefore(nodeId, targetNodeId) {
        this.requireNode(nodeId);
        const targetNode = this.requireNode(targetNodeId);
        
        const targetParentId = targetNode.parentId;
        if (!targetParentId) {
            throw new Error('Cannot copy a node to be before root node');
        }
        
        const sortedChildren = this.getSortedChildren(targetParentId);
        const targetIdx = this.findTargetIndexInSorted(sortedChildren, targetNodeId);
        const newOrder = this.calculateOrderForBefore(targetNode, sortedChildren, targetIdx);
        
        return await this.copyNodeRecursive(nodeId, targetParentId, newOrder);
    }

    async copyAfter(nodeId, targetNodeId) {
        this.requireNode(nodeId);
        const targetNode = this.requireNode(targetNodeId);
        
        const targetParentId = targetNode.parentId;
        if (!targetParentId) {
            throw new Error('Cannot copy a node to be after root node');
        }
        
        const sortedChildren = this.getSortedChildren(targetParentId);
        const targetIdx = this.findTargetIndexInSorted(sortedChildren, targetNodeId);
        const newOrder = this.calculateOrderForAfter(targetNode, sortedChildren, targetIdx);
        
        return await this.copyNodeRecursive(nodeId, targetParentId, newOrder);
    }

    getAllDescendants(nodeId, result) {
        const children = this.getChildren(nodeId);
        for (const child of children) {
            result.push(child);
            this.getAllDescendants(child.id, result);
        }
    }

    getNodesRecursive(node, result) {
        result.push(node);
        const sortedChildren = this.getSortedChildren(node.id);
        for (const child of sortedChildren) {
            this.getNodesRecursive(child, result);
        }
    }

    getNodes(nodeId) {
        if (!nodeId) {
            throw new Error('nodeId is required');
        }
        const nodes = [];
        const startNode = this.requireNode(nodeId);
        this.getNodesRecursive(startNode, nodes);
        return nodes;
    }

    serialize(nodeId) {
        return this.getNodes(nodeId)
            .filter(node => node.parentId !== null)
            .map(node => node.text)
            .filter(text => text && text.trim().length > 0)
            .join('\n\n');
    }

    structure(nodeId) {
        if (!nodeId) {
            throw new Error('nodeId is required');
        }
        const result = [];
        const startNode = this.requireNode(nodeId);
        this.structureRecursive(startNode, result);
        return result;
    }

    structureRecursive(node, result) {
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
            contextValue: node.contextValue,
            readonly: node.readonly
        });
        const sortedChildren = this.getSortedChildren(node.id);
        for (const child of sortedChildren) {
            this.structureRecursive(child, result);
        }
    }

    expandToLength(nodeId, maxTokens) {
        if (!nodeId) {
            throw new Error('nodeId is required');
        }
        const result = [];
        const startNode = this.requireNode(nodeId);
        
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
                const sortedChildren = this.getSortedChildren(node.id);
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
            
            const children = this.getChildren(node.id);
            if (children.length > 0) {
                // Node has children, expand by including its children
                const sortedChildren = this.getSortedChildren(node.id);
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

    async addSummary(startNodeId, endNodeId, content, contextType, contextName, contextValue) {
        if (!startNodeId || !endNodeId) {
            throw new Error('Must provide both start-node-id and end-node-id');
        }

        const startNode = this.requireNode(startNodeId);
        const endNode = this.requireNode(endNodeId);

        // Check that both nodes have the same parent
        if (startNode.parentId !== endNode.parentId) {
            throw new Error(`Start node and end node must have the same parent. Start node parent: ${startNode.parentId}, End node parent: ${endNode.parentId}`);
        }

        const parentId = startNode.parentId;
        if (!parentId) {
            throw new Error('Cannot summarize root nodes');
        }

        this.requireNode(parentId);

        // Get all siblings sorted by order
        const sortedSiblings = this.getSortedChildren(parentId);
        
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
        const nodesWithChildren = memoryNodesSorted.filter(n => this.getChildren(n.id).length > 0);
        if (nodesWithChildren.length > 0) {
            throw new Error(`All nodes to summarize must be leaf nodes (have no children). Nodes with children: ${nodesWithChildren.map(n => n.id).join(', ')}`);
        }

        const minOrder = memoryNodesSorted[0].order;
        const maxOrder = memoryNodesSorted[memoryNodesSorted.length - 1].order;
        const summaryOrder = (minOrder + maxOrder) / 2;

        const summaryNode = await this.createAndInsertNode(parentId, content, summaryOrder, contextType, contextName, contextValue);

        // Update parentId for memory nodes and recompute their hashes
        for (const memoryNode of memoryNodesSorted) {
            if (!memoryNode.hash) {
                throw new Error(`Node ${memoryNode.id} does not have a hash. Cannot perform optimistic locking check.`);
            }
            const expectedHash = memoryNode.hash;
            
            const oldParentId = memoryNode.parentId;
            memoryNode.parentId = summaryNode.id;
            await NodeHasher.hash(memoryNode);
            this.updateTimestamp(memoryNode);
            
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
