class NodeType {
    static ROOT = 'root';
    static USER = 'user';
    static SUMMARY = 'summary';
    static MEMORY = 'memory';
}

class Node {
    constructor(nodeId, parentId, text, nodeType, order, tokenCount = null, createdAt = null, updatedAt = null) {
        this.id = nodeId;
        this.parentId = parentId;
        this.text = text;
        this.nodeType = nodeType;
        this.order = order;
        this.tokenCount = tokenCount !== null ? tokenCount : this._countTokens(text);
        this.createdAt = createdAt || new Date().toISOString();
        this.updatedAt = updatedAt || new Date().toISOString();
    }

    _countTokens(text) {
        if (!text) return 0;
        try {
            if (typeof gptTokenizer !== 'undefined' && gptTokenizer.encode) {
                return gptTokenizer.encode(text).length;
            } else if (typeof tiktoken !== 'undefined') {
                const encoding = tiktoken.get_encoding('cl100k_base');
                return encoding.encode(text).length;
            } else {
                console.warn('Tokenizer not available, using approximation');
                return Math.ceil(text.length / 4);
            }
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
            nodeType: this.nodeType,
            order: this.order,
            tokenCount: this.tokenCount,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt
        };
    }

    static fromDict(data) {
        return new Node(
            data.id,
            data.parentId,
            data.text,
            data.nodeType,
            data.order,
            data.tokenCount,
            data.createdAt,
            data.updatedAt
        );
    }
}

class Docmem {
    constructor(docmemId) {
        this.docmemId = docmemId;
        this.db = null;
        this._initPromise = this._init();
    }

    async _init() {
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
            this.db = new SQL.Database();
            this._initDb();
            this._createRoot();
        } catch (error) {
            console.error('Error initializing SQL.js:', error);
            console.error('Error details:', error.stack);
            throw new Error('Failed to initialize SQL.js: ' + error.message);
        }
    }

    async ready() {
        await this._initPromise;
    }

    _initDb() {
        this.db.run(`
            CREATE TABLE nodes (
                id TEXT PRIMARY KEY,
                parent_id TEXT,
                text TEXT NOT NULL,
                node_type TEXT NOT NULL,
                order_value REAL NOT NULL,
                token_count INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (parent_id) REFERENCES nodes(id) ON DELETE CASCADE
            )
        `);
        this.db.run('CREATE INDEX idx_parent_id ON nodes(parent_id)');
        this.db.run('CREATE INDEX idx_order ON nodes(parent_id, order_value)');
    }

    _createRoot() {
        const root = new Node(
            `${this.docmemId}_root`,
            null,
            '',
            NodeType.ROOT,
            0.0
        );
        this._insertNode(root);
    }

    _insertNode(node) {
        const stmt = this.db.prepare(`
            INSERT INTO nodes (id, parent_id, text, node_type, order_value, token_count, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        stmt.bind([
            node.id,
            node.parentId,
            node.text,
            node.nodeType,
            node.order,
            node.tokenCount,
            node.createdAt,
            node.updatedAt
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
            row.node_type,
            row.order_value,
            row.token_count,
            row.created_at,
            row.updated_at
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
        const stmt = this.db.prepare('SELECT * FROM nodes WHERE parent_id IS NULL');
        const result = stmt.step() ? this._rowToNode(stmt.getAsObject()) : null;
        stmt.free();
        if (!result) {
            throw new Error('Root node not found');
        }
        return result;
    }

    append(parentId, text, nodeType, contextType, contextValue1, contextValue2) {
        const parent = this._getNode(parentId);
        if (!parent) {
            throw new Error(`Parent node ${parentId} not found`);
        }

        const children = this._getChildren(parentId);
        const maxOrder = children.length > 0 
            ? Math.max(...children.map(c => c.order))
            : 0.0;
        const newOrder = maxOrder + 1.0;

        const nodeId = `${contextType}_${contextValue1}_${contextValue2}_${children.length}`;
        const node = new Node(
            nodeId,
            parentId,
            text,
            nodeType,
            newOrder
        );
        this._insertNode(node);
        return node;
    }

    insert(parentId, text, nodeType, contextType, contextValue1, contextValue2, afterNodeId = null, beforeNodeId = null) {
        if (afterNodeId && beforeNodeId) {
            throw new Error('Cannot specify both afterNodeId and beforeNodeId');
        }

        const parent = this._getNode(parentId);
        if (!parent) {
            throw new Error(`Parent node ${parentId} not found`);
        }

        const children = this._getChildren(parentId);
        let newOrder;

        if (afterNodeId) {
            const afterNode = this._getNode(afterNodeId);
            if (!afterNode || afterNode.parentId !== parentId) {
                throw new Error(`After node ${afterNodeId} not found or not a sibling`);
            }
            const afterIdx = children.findIndex(n => n.id === afterNodeId);
            if (afterIdx === -1) {
                throw new Error(`After node ${afterNodeId} not found in children`);
            }
            if (afterIdx === children.length - 1) {
                newOrder = children[afterIdx].order + 1.0;
            } else {
                const a = children[afterIdx].order;
                const b = children[afterIdx + 1].order;
                newOrder = (a * 4 + b * 1) / 5;
            }
        } else if (beforeNodeId) {
            const beforeNode = this._getNode(beforeNodeId);
            if (!beforeNode || beforeNode.parentId !== parentId) {
                throw new Error(`Before node ${beforeNodeId} not found or not a sibling`);
            }
            const beforeIdx = children.findIndex(n => n.id === beforeNodeId);
            if (beforeIdx === -1) {
                throw new Error(`Before node ${beforeNodeId} not found in children`);
            }
            if (beforeIdx === 0) {
                newOrder = children[0].order - 1.0;
            } else {
                const a = children[beforeIdx - 1].order;
                const b = children[beforeIdx].order;
                newOrder = (a * 4 + b * 1) / 5;
            }
        } else {
            throw new Error('Must specify either afterNodeId or beforeNodeId');
        }

        const nodeId = `${contextType}_${contextValue1}_${contextValue2}_${Math.floor(newOrder * 1000)}`;
        const node = new Node(
            nodeId,
            parentId,
            text,
            nodeType,
            newOrder
        );
        this._insertNode(node);
        return node;
    }

    delete(nodeId) {
        const node = this._getNode(nodeId);
        if (!node) {
            throw new Error(`Node ${nodeId} not found`);
        }
        const stmt = this.db.prepare('DELETE FROM nodes WHERE id = ?');
        stmt.bind([nodeId]);
        stmt.step();
        stmt.free();
    }

    serialize() {
        const result = [];
        const root = this._getRoot();
        this._serializeRecursive(root, result);
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

    expandToLength(maxTokens) {
        const result = [];
        const root = this._getRoot();
        
        // Step 1: BFS to depth 1
        const depth1Nodes = [];
        const queue = [{ node: root, depth: 0 }];
        
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
            
            if (node.nodeType === NodeType.SUMMARY) {
                const children = this._getChildren(node.id);
                if (children.length > 0) {
                    // Expand the summary by including its children
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
                    // Summary with no children, just include the summary
                    if (totalTokens + node.tokenCount <= maxTokens) {
                        result.push(node);
                        totalTokens += node.tokenCount;
                    }
                }
            } else {
                // Non-summary node, just include it
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

    summarize(memoryNodeIds, summaryText, contextType, contextValue1, contextValue2) {
        if (!memoryNodeIds || memoryNodeIds.length === 0) {
            throw new Error('Must provide at least one memory node to summarize');
        }

        const memoryNodes = memoryNodeIds.map(id => this._getNode(id));
        if (memoryNodes.some(n => !n)) {
            throw new Error('One or more memory nodes not found');
        }
        if (memoryNodes.some(n => n.nodeType !== NodeType.MEMORY)) {
            throw new Error('All nodes to summarize must be of type MEMORY');
        }

        let parentId;
        if (memoryNodes.length === 1) {
            parentId = memoryNodes[0].parentId;
        } else {
            const parentIds = new Set(memoryNodes.map(n => n.parentId));
            if (parentIds.size !== 1) {
                throw new Error('All memory nodes must have the same parent');
            }
            parentId = memoryNodes[0].parentId;
        }

        const parent = this._getNode(parentId);
        if (!parent) {
            throw new Error(`Parent node ${parentId} not found`);
        }

        const children = this._getChildren(parentId);
        const memoryNodesSorted = children
            .filter(n => memoryNodeIds.includes(n.id))
            .sort((a, b) => a.order - b.order);

        if (memoryNodesSorted.length !== memoryNodeIds.length) {
            throw new Error('Not all memory nodes found as children of parent');
        }

        const minOrder = memoryNodesSorted[0].order;
        const maxOrder = memoryNodesSorted[memoryNodesSorted.length - 1].order;
        const summaryOrder = (minOrder + maxOrder) / 2;

        const summaryId = `${contextType}_${contextValue1}_${contextValue2}_summary_${Math.floor(summaryOrder * 1000)}`;
        const summaryNode = new Node(
            summaryId,
            parentId,
            summaryText,
            NodeType.SUMMARY,
            summaryOrder
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

