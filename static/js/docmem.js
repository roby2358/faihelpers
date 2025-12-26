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

    append_child(node_id, context_type, context_name, context_value, content) {
        const parent = this._getNode(node_id);
        if (!parent) {
            throw new Error(`Parent node ${node_id} not found`);
        }

        const children = this._getChildren(node_id);
        const maxOrder = children.length > 0 
            ? Math.max(...children.map(c => c.order))
            : 0.0;
        const newOrder = maxOrder + 1.0;

        const newNodeId = randomString(8);
        const node = new Node(
            newNodeId,
            node_id,
            content,
            newOrder,
            null,
            null,
            null,
            context_type,
            context_name,
            context_value
        );
        this._insertNode(node);
        return node;
    }

    insert_between(node_id_1, node_id_2, context_type, context_name, context_value, content) {
        const node1 = this._getNode(node_id_1);
        const node2 = this._getNode(node_id_2);
        
        if (!node1) {
            throw new Error(`Node ${node_id_1} not found`);
        }
        if (!node2) {
            throw new Error(`Node ${node_id_2} not found`);
        }
        
        if (node1.parentId !== node2.parentId) {
            throw new Error('Nodes must have the same parent');
        }
        
        const parentId = node1.parentId;
        const children = this._getChildren(parentId);
        
        // Find the positions of node1 and node2
        const idx1 = children.findIndex(n => n.id === node_id_1);
        const idx2 = children.findIndex(n => n.id === node_id_2);
        
        if (idx1 === -1 || idx2 === -1) {
            throw new Error('One or both nodes not found in parent children');
        }
        
        // Ensure node1 comes before node2
        if (idx1 >= idx2) {
            throw new Error('node_id_1 must come before node_id_2 in the ordering');
        }
        
        // Calculate order between the two nodes using 20% interpolation
        const a = children[idx1].order;
        const b = children[idx2].order;
        const newOrder = (a * 4 + b * 1) / 5;
        
        const newNodeId = randomString(8);
        const node = new Node(
            newNodeId,
            parentId,
            content,
            newOrder,
            null,
            null,
            null,
            context_type,
            context_name,
            context_value
        );
        this._insertNode(node);
        return node;
    }

    delete(node_id) {
        const node = this._getNode(node_id);
        if (!node) {
            throw new Error(`Node ${node_id} not found`);
        }
        const stmt = this.db.prepare('DELETE FROM nodes WHERE id = ?');
        stmt.bind([node_id]);
        stmt.step();
        stmt.free();
    }

    update_content(node_id, content) {
        const node = this._getNode(node_id);
        if (!node) {
            throw new Error(`Node ${node_id} not found`);
        }
        
        // Create a temporary node to calculate token count
        const tempNode = new Node(node_id, node.parentId, content, node.order, null, null, null, node.contextType, node.contextName, node.contextValue);
        node.text = content;
        node.tokenCount = tempNode.tokenCount;
        node.updatedAt = new Date().toISOString();
        this._updateNode(node);
        return node;
    }

    find(node_id) {
        return this._getNode(node_id);
    }

    serialize(nodeId) {
        if (!nodeId) {
            throw new Error('nodeId is required');
        }
        const result = [];
        const startNode = this._getNode(nodeId);
        if (!startNode) {
            throw new Error(`Node ${nodeId} not found`);
        }
        this._serializeRecursive(startNode, result);
        return result;
    }

    _serializeRecursive(node, result) {
        result.push(node);
        const children = this._getChildren(node.id);
        const sortedChildren = [...children].sort((a, b) => a.order - b.order);
        for (const child of sortedChildren) {
            this._serializeRecursive(child, result);
        }
    }

    expandToLength(nodeId, maxTokens) {
        if (!nodeId) {
            throw new Error('nodeId is required');
        }
        const result = [];
        const startNode = this._getNode(nodeId);
        if (!startNode) {
            throw new Error(`Node ${nodeId} not found`);
        }
        
        // Step 1: BFS to depth 1
        const depth1Nodes = [];
        const queue = [{ node: startNode, depth: 0 }];
        
        while (queue.length > 0) {
            const { node, depth } = queue.shift();
            
            if (depth === 1) {
                depth1Nodes.push(node);
            } else if (depth < 1) {
                const children = this._getChildren(node.id);
                const sortedChildren = [...children].sort((a, b) => a.order - b.order);
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
                const sortedChildren = [...children].sort((a, b) => a.order - b.order);
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

        const memoryNodes = node_ids.map(id => this._getNode(id));
        const missingNodes = memoryNodes.map((n, i) => n ? null : node_ids[i]).filter(id => id !== null);
        if (missingNodes.length > 0) {
            throw new Error(`One or more memory nodes not found: ${missingNodes.join(', ')}`);
        }
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

        const parent = this._getNode(parentId);
        if (!parent) {
            throw new Error(`Parent node ${parentId} not found`);
        }

        const children = this._getChildren(parentId);
        const childrenIds = new Set(children.map(c => c.id));
        const nodeIdsSet = new Set(node_ids);
        
        // Check which nodes are missing from parent's children
        const missingFromParent = node_ids.filter(id => !childrenIds.has(id));
        
        if (missingFromParent.length > 0) {
            throw new Error(`Not all memory nodes found as children of parent. Missing: ${missingFromParent.join(', ')}. Parent has ${children.length} children.`);
        }
        
        const memoryNodesSorted = children
            .filter(n => nodeIdsSet.has(n.id))
            .sort((a, b) => a.order - b.order);

        const minOrder = memoryNodesSorted[0].order;
        const maxOrder = memoryNodesSorted[memoryNodesSorted.length - 1].order;
        const summaryOrder = (minOrder + maxOrder) / 2;

        // Generate summary ID using random string
        const summaryId = randomString(8);
        const summaryNode = new Node(
            summaryId,
            parentId,
            content,
            summaryOrder,
            null,
            null,
            null,
            context_type,
            context_name,
            context_value
        );
        this._insertNode(summaryNode);

        for (const memoryNode of memoryNodesSorted) {
            const stmt = this.db.prepare('UPDATE nodes SET parent_id = ? WHERE id = ?');
            stmt.bind([summaryId, memoryNode.id]);
            stmt.step();
            stmt.free();
        }

        return summaryNode;
    }

    close() {
        this.db.close();
    }
}

