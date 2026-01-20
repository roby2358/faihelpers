import { randomString } from '../tools.js';
import { DocmemSQLite } from './docmem_sqlite.js';
import { Node, NodeHasher, OptimisticLockError } from './docmem_types.js';

// Re-export types for backwards compatibility
export { Node, NodeHasher, OptimisticLockError };

export class Docmem {
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

    requireParent(node, operation) {
        if (!node.parentId) {
            throw new Error(`Cannot ${operation} root node`);
        }
        return node.parentId;
    }

    calculateOrderRelativeToTarget(targetNode, sortedChildren, targetIdx, position) {
        if (position === 'before') {
            return this.calculateOrderForBefore(targetNode, sortedChildren, targetIdx);
        } else {
            return this.calculateOrderForAfter(targetNode, sortedChildren, targetIdx);
        }
    }

    getOrderForSiblingOperation(targetNodeId, position) {
        const targetNode = this.requireNode(targetNodeId);
        const parentId = this.requireParent(targetNode, `${position} sibling of`);
        const sortedChildren = this.getSortedChildren(parentId);
        const targetIdx = this.findTargetIndexInSorted(sortedChildren, targetNodeId);
        const newOrder = this.calculateOrderRelativeToTarget(targetNode, sortedChildren, targetIdx, position);
        return { parentId, newOrder };
    }

    async withOptimisticLock(node, updateFn) {
        if (!node.hash) {
            throw new Error(`Node ${node.id} does not have a hash. Cannot perform optimistic locking.`);
        }
        const expectedHash = node.hash;
        this.updateTimestamp(node);
        await NodeHasher.hash(node);
        await updateFn(node, expectedHash);
        return node;
    }

    validateSameParent(startNode, endNode) {
        if (startNode.parentId !== endNode.parentId) {
            throw new Error(`Start node and end node must have the same parent. Start node parent: ${startNode.parentId}, End node parent: ${endNode.parentId}`);
        }
        const parentId = startNode.parentId;
        if (!parentId) {
            throw new Error('Cannot summarize root nodes');
        }
        return parentId;
    }

    findSiblingRange(parentId, startNodeId, endNodeId) {
        const sortedSiblings = this.getSortedChildren(parentId);
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

        return sortedSiblings.slice(startIndex, endIndex + 1);
    }

    validateLeafNodes(nodes) {
        const nodesWithChildren = nodes.filter(n => this.getChildren(n.id).length > 0);
        if (nodesWithChildren.length > 0) {
            throw new Error(`All nodes to summarize must be leaf nodes (have no children). Nodes with children: ${nodesWithChildren.map(n => n.id).join(', ')}`);
        }
    }

    calculateSummaryOrder(nodes) {
        const minOrder = nodes[0].order;
        const maxOrder = nodes[nodes.length - 1].order;
        return (minOrder + maxOrder) / 2;
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
        this.requireNode(nodeId);
        const { parentId, newOrder } = this.getOrderForSiblingOperation(nodeId, 'before');
        return await this.createAndInsertNode(parentId, content, newOrder, contextType, contextName, contextValue);
    }

    async insertAfter(nodeId, contextType, contextName, contextValue, content) {
        this.requireNode(nodeId);
        const { parentId, newOrder } = this.getOrderForSiblingOperation(nodeId, 'after');
        return await this.createAndInsertNode(parentId, content, newOrder, contextType, contextName, contextValue);
    }

    deleteDescendantsBottomUp(nodeId) {
        const descendants = [];
        this.getAllDescendants(nodeId, descendants);
        
        // Delete all descendants bottom-up (children before parents)
        // getAllDescendants returns nodes in pre-order (parent before children)
        // Reversing gives us post-order (children before parents) for safe deletion
        const descendantIds = descendants.map(n => n.id).reverse();
        for (const descendantId of descendantIds) {
            this.sqlite.deleteNodeById(descendantId);
        }
    }

    delete(nodeId) {
        this.requireNode(nodeId);
        this.deleteDescendantsBottomUp(nodeId);
        this.sqlite.deleteNodeById(nodeId);
    }

    requireWritable(node) {
        if (node.readonly === 1) {
            throw new Error(`Cannot update readonly node ${node.id}`);
        }
    }

    async updateContent(nodeId, content) {
        const node = this.requireNode(nodeId);
        this.requireWritable(node);
        
        // Create a temporary node to calculate token count
        const tempNode = new Node(nodeId, node.parentId, content, node.order, null, null, null, node.contextType, node.contextName, node.contextValue, node.readonly);
        node.text = content;
        node.tokenCount = tempNode.tokenCount;
        
        return await this.withOptimisticLock(node, async (n, expectedHash) => {
            await this.updateNode(n, expectedHash);
        });
    }

    async updateContext(nodeId, contextType, contextName, contextValue) {
        const node = this.requireNode(nodeId);
        this.requireWritable(node);
        
        node.contextType = contextType;
        node.contextName = contextName;
        node.contextValue = contextValue;
        
        return await this.withOptimisticLock(node, async (n, expectedHash) => {
            await this.updateNodeContext(n, expectedHash);
        });
    }

    find(nodeId) {
        return this.getNode(nodeId);
    }

    async moveAppendChild(nodeId, targetParentId) {
        const node = this.requireNode(nodeId);
        this.requireNode(targetParentId);
        this.validateCycleBeforeMove(nodeId, targetParentId);

        const newOrder = this.calculateOrderForAppend(targetParentId);
        node.parentId = targetParentId;
        node.order = newOrder;
        
        return await this.withOptimisticLock(node, async (n, expectedHash) => {
            return await this.updateNodeParentAndOrder(n, expectedHash);
        });
    }

    async moveBefore(nodeId, targetNodeId) {
        const node = this.requireNode(nodeId);
        const targetNode = this.requireNode(targetNodeId);
        this.validateCycleBeforeMoveSibling(nodeId, targetNode, 'before');

        const { parentId, newOrder } = this.getOrderForSiblingOperation(targetNodeId, 'before');
        node.parentId = parentId;
        node.order = newOrder;
        
        return await this.withOptimisticLock(node, async (n, expectedHash) => {
            return await this.updateNodeParentAndOrder(n, expectedHash);
        });
    }

    async moveAfter(nodeId, targetNodeId) {
        const node = this.requireNode(nodeId);
        const targetNode = this.requireNode(targetNodeId);
        this.validateCycleBeforeMoveSibling(nodeId, targetNode, 'after');

        const { parentId, newOrder } = this.getOrderForSiblingOperation(targetNodeId, 'after');
        node.parentId = parentId;
        node.order = newOrder;
        
        return await this.withOptimisticLock(node, async (n, expectedHash) => {
            return await this.updateNodeParentAndOrder(n, expectedHash);
        });
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
        const { parentId, newOrder } = this.getOrderForSiblingOperation(targetNodeId, 'before');
        return await this.copyNodeRecursive(nodeId, parentId, newOrder);
    }

    async copyAfter(nodeId, targetNodeId) {
        this.requireNode(nodeId);
        const { parentId, newOrder } = this.getOrderForSiblingOperation(targetNodeId, 'after');
        return await this.copyNodeRecursive(nodeId, parentId, newOrder);
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
        this.structureRecursive(startNode, result, 0);
        return result.join('\n');
    }

    structureRecursive(node, result, depth) {
        const indent = '  '.repeat(depth);
        const line = `${indent}- ${node.id} ${node.contextType} ${node.contextName}:${node.contextValue} ${node.createdAt}`;
        result.push(line);
        
        const sortedChildren = this.getSortedChildren(node.id);
        for (const child of sortedChildren) {
            this.structureRecursive(child, result, depth + 1);
        }
    }

    /**
     * Expand a node to fit within a token budget.
     * 
     * Algorithm:
     * 1. Reverse BFS to build priority list (level-by-level, last children first within each level)
     * 2. Iterate through priority list, consuming budget until it's spent (no holes - stop on first failure)
     * 3. Preorder DFS traversal, rendering only nodes in the included set
     * 
     * The priority order guarantees parents come before children, so stopping
     * on budget exhaustion naturally prevents orphans. Last children (most recent)
     * have higher priority than earlier children.
     * 
     * Example: For tree ROOT -> A(C,D), B(E):
     * - Priority list: ROOT, B, A, E, D, C
     * - Budget consumed until exhausted, list truncated
     * - DFS render: ROOT, A, ..., B, ... (only included nodes)
     */
    expandToLength(nodeId, maxTokens) {
        if (!nodeId) {
            throw new Error('nodeId is required');
        }

        const startNode = this.requireNode(nodeId);

        // Step 1: Build priority list via reverse BFS
        // Level-by-level, but within each level, reverse order (last/most recent children first)
        const priorityList = [];
        let currentLevel = [startNode];

        while (currentLevel.length > 0) {
            // Add nodes in reverse order (last ones have higher priority - most recent)
            for (let i = currentLevel.length - 1; i >= 0; i--) {
                priorityList.push(currentLevel[i]);
            }

            // Collect children for next level
            const nextLevel = [];
            for (const node of currentLevel) {
                const children = this.getSortedChildren(node.id);
                nextLevel.push(...children);
            }

            currentLevel = nextLevel;
        }

        // Step 2: Consume budget - stop on first node that doesn't fit (no holes)
        const includedIds = new Set();
        let totalTokens = 0;

        for (const node of priorityList) {
            const nodeTokens = node.tokenCount || 0;
            if (totalTokens + nodeTokens <= maxTokens) {
                includedIds.add(node.id);
                totalTokens += nodeTokens;
            } else {
                // Budget exhausted - stop here, truncate the rest
                break;
            }
        }

        // Step 3: Preorder DFS traversal, rendering only included nodes
        const result = [];

        const renderDfs = (node) => {
            if (!includedIds.has(node.id)) {
                // Node not included - skip entire subtree
                return;
            }
            result.push(node);
            const children = this.getSortedChildren(node.id);
            for (const child of children) {
                renderDfs(child);
            }
        };

        renderDfs(startNode);

        return result;
    }

    async addSummary(startNodeId, endNodeId, content, contextType, contextName, contextValue) {
        if (!startNodeId || !endNodeId) {
            throw new Error('Must provide both start-node-id and end-node-id');
        }

        const startNode = this.requireNode(startNodeId);
        const endNode = this.requireNode(endNodeId);
        const parentId = this.validateSameParent(startNode, endNode);
        this.requireNode(parentId);

        const memoryNodesSorted = this.findSiblingRange(parentId, startNodeId, endNodeId);
        this.validateLeafNodes(memoryNodesSorted);

        const summaryOrder = this.calculateSummaryOrder(memoryNodesSorted);
        const summaryNode = await this.createAndInsertNode(parentId, content, summaryOrder, contextType, contextName, contextValue);

        await this.reparentNodes(memoryNodesSorted, summaryNode.id);

        return summaryNode;
    }

    async reparentNodes(nodes, newParentId) {
        for (const node of nodes) {
            if (!node.hash) {
                throw new Error(`Node ${node.id} does not have a hash. Cannot perform optimistic locking check.`);
            }
            const expectedHash = node.hash;
            const oldParentId = node.parentId;
            
            try {
                node.parentId = newParentId;
                await NodeHasher.hash(node);
                this.updateTimestamp(node);
                this.sqlite.updateNodeParent(node.id, node.parentId, node.hash, node.updatedAt, expectedHash);
            } catch (error) {
                node.parentId = oldParentId;
                throw error;
            }
        }
    }

    close() {
        this.sqlite.close();
    }
}
