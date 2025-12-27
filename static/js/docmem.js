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
            contextValue: this.contextValue
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
            data.contextValue
        );
    }
}

// Shared database instance for all docmem instances
let sharedDatabase = null;
let databaseInitPromise = null;

async function initSharedDatabase() {
    if (sharedDatabase) {
        return sharedDatabase;
    }
    
    if (databaseInitPromise) {
        return databaseInitPromise;
    }
    
    databaseInitPromise = (async () => {
        // Wait for initSqlJs to be available (sql.js script should be loaded first)
        let attempts = 0;
        while (typeof initSqlJs === 'undefined' && attempts < 100) {
            await new Promise(resolve => setTimeout(resolve, 50));
            attempts++;
        }
        
        if (typeof initSqlJs === 'undefined') {
            throw new Error('sql.js not loaded. Please include sql.js script before docmem.js');
        }
        
        try {
            const SQL = await initSqlJs({
                locateFile: file => {
                    // Use jsdelivr CDN for WASM files - same version as script
                    return `https://cdn.jsdelivr.net/npm/sql.js@1.8.0/dist/${file}`;
                }
            });
            sharedDatabase = new SQL.Database();
            
            // Initialize database schema (CREATE TABLE IF NOT EXISTS)
            sharedDatabase.run(`
                CREATE TABLE IF NOT EXISTS nodes (
                    id TEXT PRIMARY KEY,
                    parent_id TEXT,
                    text TEXT NOT NULL,
                    order_value REAL NOT NULL,
                    token_count INTEGER NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    context_type TEXT NOT NULL,
                    context_name TEXT NOT NULL,
                    context_value TEXT NOT NULL,
                    FOREIGN KEY (parent_id) REFERENCES nodes(id) ON DELETE CASCADE
                )
            `);
            sharedDatabase.run('CREATE INDEX IF NOT EXISTS idx_parent_id ON nodes(parent_id)');
            sharedDatabase.run('CREATE INDEX IF NOT EXISTS idx_order ON nodes(parent_id, order_value)');
            
            return sharedDatabase;
        } catch (error) {
            console.error('Error initializing SQL.js:', error);
            console.error('Error details:', error.stack);
            databaseInitPromise = null;
            throw new Error('Failed to initialize SQL.js: ' + error.message);
        }
    })();
    
    return databaseInitPromise;
}

class Docmem {
    constructor(docmemId) {
        this.docmemId = docmemId;
        this.db = null;
        this._initPromise = this._init();
    }

    async _init() {
        this.db = await initSharedDatabase();
        // Check if root already exists, if not create it
        const existingRoot = this._getRootById(this.docmemId);
        if (!existingRoot) {
            this._createRoot();
        }
    }

    async ready() {
        await this._initPromise;
    }

    _getRootById(rootId) {
        const stmt = this.db.prepare('SELECT * FROM nodes WHERE id = ? AND parent_id IS NULL');
        stmt.bind([rootId]);
        const result = stmt.step() ? this._rowToNode(stmt.getAsObject()) : null;
        stmt.free();
        return result;
    }

    _createRoot(contextType = 'root', contextName = 'purpose', contextValue = 'document') {
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
        this._insertNode(root);
        return root;
    }

    _insertNode(node) {
        const stmt = this.db.prepare(`
            INSERT INTO nodes (id, parent_id, text, order_value, token_count, created_at, updated_at, context_type, context_name, context_value)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        stmt.bind([
            node.id,
            node.parentId,
            node.text,
            node.order,
            node.tokenCount,
            node.createdAt,
            node.updatedAt,
            node.contextType,
            node.contextName,
            node.contextValue
        ]);
        stmt.step();
        stmt.free();
    }

    _updateNode(node) {
        const stmt = this.db.prepare(`
            UPDATE nodes
            SET text = ?, token_count = ?, updated_at = ?
            WHERE id = ?
        `);
        stmt.bind([
            node.text,
            node.tokenCount,
            new Date().toISOString(),
            node.id
        ]);
        stmt.step();
        stmt.free();
    }

    _updateNodeContext(node) {
        const stmt = this.db.prepare(`
            UPDATE nodes
            SET context_type = ?, context_name = ?, context_value = ?, updated_at = ?
            WHERE id = ?
        `);
        stmt.bind([
            node.contextType,
            node.contextName,
            node.contextValue,
            new Date().toISOString(),
            node.id
        ]);
        stmt.step();
        stmt.free();
    }

    _getNode(nodeId) {
        const stmt = this.db.prepare('SELECT * FROM nodes WHERE id = ?');
        stmt.bind([nodeId]);
        const result = stmt.step() ? this._rowToNode(stmt.getAsObject()) : null;
        stmt.free();
        return result;
    }

    _rowToNode(row) {
        return new Node(
            row.id,
            row.parent_id,
            row.text,
            row.order_value,
            row.token_count,
            row.created_at,
            row.updated_at,
            row.context_type,
            row.context_name,
            row.context_value
        );
    }

    _getChildren(parentId) {
        const stmt = this.db.prepare(`
            SELECT * FROM nodes
            WHERE parent_id = ?
            ORDER BY order_value
        `);
        stmt.bind([parentId]);
        const children = [];
        while (stmt.step()) {
            children.push(this._rowToNode(stmt.getAsObject()));
        }
        stmt.free();
        return children;
    }

    _getRoot() {
        const root = this._getRootById(this.docmemId);
        if (!root) {
            throw new Error(`Root node not found for docmem: ${this.docmemId}`);
        }
        return root;
    }

    _getAllRoots() {
        const stmt = this.db.prepare('SELECT * FROM nodes WHERE parent_id IS NULL ORDER BY created_at');
        const roots = [];
        while (stmt.step()) {
            roots.push(this._rowToNode(stmt.getAsObject()));
        }
        stmt.free();
        return roots;
    }

    static getAllRoots() {
        if (!sharedDatabase) {
            return [];
        }
        const stmt = sharedDatabase.prepare('SELECT * FROM nodes WHERE parent_id IS NULL ORDER BY created_at');
        const roots = [];
        while (stmt.step()) {
            const row = stmt.getAsObject();
            roots.push({
                id: row.id,
                parentId: row.parent_id,
                text: row.text,
                order: row.order_value,
                tokenCount: row.token_count,
                createdAt: row.created_at,
                updatedAt: row.updated_at,
                contextType: row.context_type,
                contextName: row.context_name,
                contextValue: row.context_value
            });
        }
        stmt.free();
        return roots;
    }

    _requireNode(nodeId) {
        const node = this._getNode(nodeId);
        if (!node) {
            throw new Error(`Node ${nodeId} not found`);
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

    _updateNodeParentAndOrder(nodeId, newParentId, newOrder) {
        const stmt = this.db.prepare(`
            UPDATE nodes
            SET parent_id = ?, order_value = ?, updated_at = ?
            WHERE id = ?
        `);
        const updatedAt = new Date().toISOString();
        stmt.bind([newParentId, newOrder, updatedAt, nodeId]);
        stmt.step();
        stmt.free();
        return this._getNode(nodeId);
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

    append_child(node_id, context_type, context_name, context_value, content) {
        this._requireNode(node_id);
        const newOrder = this._calculateOrderForAppend(node_id);
        const node = this._createNodeWithContext(node_id, content, newOrder, context_type, context_name, context_value);
        this._insertNode(node);
        return node;
    }

    insert_before(node_id, context_type, context_name, context_value, content) {
        const targetNode = this._requireNode(node_id);
        
        const parentId = targetNode.parentId;
        if (!parentId) {
            throw new Error('Cannot insert before root node');
        }
        
        const sortedChildren = this._getSortedChildren(parentId);
        const targetIdx = this._findTargetIndexInSorted(sortedChildren, node_id);
        const newOrder = this._calculateOrderForBefore(targetNode, sortedChildren, targetIdx);
        
        const node = this._createNodeWithContext(parentId, content, newOrder, context_type, context_name, context_value);
        this._insertNode(node);
        return node;
    }

    insert_after(node_id, context_type, context_name, context_value, content) {
        const targetNode = this._requireNode(node_id);
        
        const parentId = targetNode.parentId;
        if (!parentId) {
            throw new Error('Cannot insert after root node');
        }
        
        const sortedChildren = this._getSortedChildren(parentId);
        const targetIdx = this._findTargetIndexInSorted(sortedChildren, node_id);
        const newOrder = this._calculateOrderForAfter(targetNode, sortedChildren, targetIdx);
        
        const node = this._createNodeWithContext(parentId, content, newOrder, context_type, context_name, context_value);
        this._insertNode(node);
        return node;
    }

    delete(node_id) {
        this._requireNode(node_id);
        const stmt = this.db.prepare('DELETE FROM nodes WHERE id = ?');
        stmt.bind([node_id]);
        stmt.step();
        stmt.free();
    }

    update_content(node_id, content) {
        const node = this._requireNode(node_id);
        
        // Create a temporary node to calculate token count
        const tempNode = new Node(node_id, node.parentId, content, node.order, null, null, null, node.contextType, node.contextName, node.contextValue);
        node.text = content;
        node.tokenCount = tempNode.tokenCount;
        node.updatedAt = new Date().toISOString();
        this._updateNode(node);
        return node;
    }

    update_context(node_id, context_type, context_name, context_value) {
        const node = this._requireNode(node_id);
        
        node.contextType = context_type;
        node.contextName = context_name;
        node.contextValue = context_value;
        node.updatedAt = new Date().toISOString();
        this._updateNodeContext(node);
        return node;
    }

    find(node_id) {
        return this._getNode(node_id);
    }

    move_append_child(node_id, target_parent_id) {
        this._requireNode(node_id);
        this._requireNode(target_parent_id);
        this._validateCycleBeforeMove(node_id, target_parent_id);

        const newOrder = this._calculateOrderForAppend(target_parent_id);
        return this._updateNodeParentAndOrder(node_id, target_parent_id, newOrder);
    }

    move_before(node_id, target_node_id) {
        this._requireNode(node_id);
        const targetNode = this._requireNode(target_node_id);
        this._validateCycleBeforeMoveSibling(node_id, targetNode, 'before');

        const targetParentId = targetNode.parentId;
        const sortedChildren = this._getSortedChildren(targetParentId);
        const targetIdx = this._findTargetIndexInSorted(sortedChildren, target_node_id);
        const newOrder = this._calculateOrderForBefore(targetNode, sortedChildren, targetIdx);

        return this._updateNodeParentAndOrder(node_id, targetParentId, newOrder);
    }

    move_after(node_id, target_node_id) {
        this._requireNode(node_id);
        const targetNode = this._requireNode(target_node_id);
        this._validateCycleBeforeMoveSibling(node_id, targetNode, 'after');

        const targetParentId = targetNode.parentId;
        const sortedChildren = this._getSortedChildren(targetParentId);
        const targetIdx = this._findTargetIndexInSorted(sortedChildren, target_node_id);
        const newOrder = this._calculateOrderForAfter(targetNode, sortedChildren, targetIdx);

        return this._updateNodeParentAndOrder(node_id, targetParentId, newOrder);
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
        let totalTokens = 0;
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

    add_summary(node_ids, content, context_type, context_name, context_value) {
        if (!node_ids || node_ids.length === 0) {
            throw new Error('Must provide at least one memory node to summarize');
        }

        const memoryNodes = node_ids.map(id => this._requireNode(id));
        
        // Check that all nodes are leaf nodes (have no children) - these are the "memories"
        const nodesWithChildren = memoryNodes.filter(n => this._getChildren(n.id).length > 0);
        if (nodesWithChildren.length > 0) {
            throw new Error(`All nodes to summarize must be leaf nodes (have no children). Nodes with children: ${nodesWithChildren.map(n => n.id).join(', ')}`);
        }

        let parentId;
        if (memoryNodes.length === 1) {
            parentId = memoryNodes[0].parentId;
        } else {
            const parentIds = new Set(memoryNodes.map(n => n.parentId));
            if (parentIds.size !== 1) {
                const parentInfo = Array.from(parentIds).map(pid => {
                    const nodesWithThisParent = memoryNodes.filter(n => n.parentId === pid).map(n => n.id);
                    return `parent ${pid}: nodes ${nodesWithThisParent.join(', ')}`;
                }).join('; ');
                throw new Error(`All memory nodes must have the same parent. Found: ${parentInfo}`);
            }
            parentId = memoryNodes[0].parentId;
        }

        this._requireNode(parentId);

        const children = this._getChildren(parentId);
        const childrenIds = new Set(children.map(c => c.id));
        const nodeIdsSet = new Set(node_ids);
        
        // Check which nodes are missing from parent's children
        const missingFromParent = node_ids.filter(id => !childrenIds.has(id));
        
        if (missingFromParent.length > 0) {
            throw new Error(`Not all memory nodes found as children of parent. Missing: ${missingFromParent.join(', ')}. Parent has ${children.length} children.`);
        }
        
        const memoryNodesSorted = this._getSortedChildren(parentId)
            .filter(n => nodeIdsSet.has(n.id));

        const minOrder = memoryNodesSorted[0].order;
        const maxOrder = memoryNodesSorted[memoryNodesSorted.length - 1].order;
        const summaryOrder = (minOrder + maxOrder) / 2;

        const summaryNode = this._createNodeWithContext(parentId, content, summaryOrder, context_type, context_name, context_value);
        this._insertNode(summaryNode);

        for (const memoryNode of memoryNodesSorted) {
            const stmt = this.db.prepare('UPDATE nodes SET parent_id = ? WHERE id = ?');
            stmt.bind([summaryNode.id, memoryNode.id]);
            stmt.step();
            stmt.free();
        }

        return summaryNode;
    }

    close() {
        this.db.close();
    }
}

