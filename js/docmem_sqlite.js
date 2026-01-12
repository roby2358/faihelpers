/**
 * SharedDatabase - Singleton SQLite database instance
 */
class SharedDatabase {
    static _instance = null;
    static _initPromise = null;

    static async getInstance() {
        if (SharedDatabase._instance) {
            return SharedDatabase._instance;
        }
        
        if (SharedDatabase._initPromise) {
            return SharedDatabase._initPromise;
        }
        
        SharedDatabase._initPromise = (async () => {
            // Wait for initSqlJs to be available (sql.js script should be loaded first)
            let attempts = 0;
            while (typeof initSqlJs === 'undefined' && attempts < 100) {
                await new Promise(resolve => setTimeout(resolve, 50));
                attempts++;
            }
            
            if (typeof initSqlJs === 'undefined') {
                throw new Error('sql.js not loaded. Please include sql.js script before DocmemSQLite.js');
            }
            
            try {
                const SQL = await initSqlJs({
                    locateFile: file => {
                        // Use jsdelivr CDN for WASM files - same version as script
                        return `https://cdn.jsdelivr.net/npm/sql.js@1.8.0/dist/${file}`;
                    }
                });
                SharedDatabase._instance = new SQL.Database();
                
                // Enable foreign key constraints (required for CASCADE delete to work)
                SharedDatabase._instance.run('PRAGMA foreign_keys = ON');
                
                // Initialize database schema (CREATE TABLE IF NOT EXISTS)
                SharedDatabase._instance.run(`
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
                        readonly INTEGER NOT NULL DEFAULT 0,
                        hash TEXT,
                        FOREIGN KEY (parent_id) REFERENCES nodes(id) ON DELETE CASCADE
                    )
                `);
                
                SharedDatabase._instance.run('CREATE INDEX IF NOT EXISTS idx_parent_id ON nodes(parent_id)');
                SharedDatabase._instance.run('CREATE INDEX IF NOT EXISTS idx_order ON nodes(parent_id, order_value)');
                
                return SharedDatabase._instance;
            } catch (error) {
                console.error('Error initializing SQL.js:', error);
                console.error('Error details:', error.stack);
                SharedDatabase._initPromise = null;
                throw new Error('Failed to initialize SQL.js: ' + error.message);
            }
        })();
        
        return SharedDatabase._initPromise;
    }
}

/**
 * DocmemSQLite - SQLite implementation of docmem database operations
 */
class DocmemSQLite {
    constructor() {
        this.db = null;
        this.initPromise = this.init();
    }

    async init() {
        this.db = await SharedDatabase.getInstance();
    }

    async ready() {
        await this.initPromise;
    }

    executeScalar(sql, params) {
        const stmt = this.db.prepare(sql);
        stmt.bind(params);
        stmt.step();
        const result = stmt.get()[0];
        stmt.free();
        return result;
    }

    executeSingleRow(sql, params) {
        const stmt = this.db.prepare(sql);
        stmt.bind(params);
        const hasRow = stmt.step();
        const result = hasRow ? stmt.getAsObject() : null;
        stmt.free();
        return result;
    }

    executeMultipleRows(sql, params) {
        const stmt = this.db.prepare(sql);
        stmt.bind(params);
        const rows = [];
        while (stmt.step()) {
            rows.push(stmt.getAsObject());
        }
        stmt.free();
        return rows;
    }

    executeUpdate(sql, params) {
        const stmt = this.db.prepare(sql);
        stmt.bind(params);
        stmt.step();
        const rowsModified = this.db.getRowsModified();
        stmt.free();
        return rowsModified;
    }

    executeUpdateWithOptimisticLock(sql, params, nodeId, expectedHash) {
        const rowsAffected = this.executeUpdate(sql, params);
        
        if (rowsAffected === 0) {
            this.checkOptimisticLockFailure(nodeId, expectedHash);
        }
    }

    rowToNode(row) {
        const node = new Node(
            row.id,
            row.parent_id,
            row.text,
            row.order_value,
            row.token_count,
            row.created_at,
            row.updated_at,
            row.context_type,
            row.context_name,
            row.context_value,
            row.readonly !== undefined ? row.readonly : 0
        );
        node.hash = row.hash || null;
        return node;
    }

    async insertNode(node) {
        this.executeUpdate(
            `INSERT INTO nodes (id, parent_id, text, order_value, token_count, created_at, updated_at, context_type, context_name, context_value, readonly, hash)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                node.id,
                node.parentId,
                node.text,
                node.order,
                node.tokenCount,
                node.createdAt,
                node.updatedAt,
                node.contextType,
                node.contextName,
                node.contextValue,
                node.readonly !== undefined ? node.readonly : 0,
                node.hash
            ]
        );
    }

    getNode(nodeId) {
        const row = this.executeSingleRow('SELECT * FROM nodes WHERE id = ?', [nodeId]);
        if (!row) {
            return null;
        }
        return this.rowToNode(row);
    }

    getRootById(rootId) {
        const row = this.executeSingleRow('SELECT * FROM nodes WHERE id = ? AND parent_id IS NULL', [rootId]);
        if (!row) {
            return null;
        }
        return this.rowToNode(row);
    }

    getChildren(parentId) {
        const rows = this.executeMultipleRows(
            'SELECT * FROM nodes WHERE parent_id = ? ORDER BY order_value',
            [parentId]
        );
        return rows.map(row => this.rowToNode(row));
    }

    getAllRoots() {
        const rows = this.executeMultipleRows(
            'SELECT * FROM nodes WHERE parent_id IS NULL ORDER BY created_at',
            []
        );
        return rows.map(row => this.rowToNode(row));
    }

    static getAllRoots() {
        if (!SharedDatabase._instance) {
            return [];
        }
        const stmt = SharedDatabase._instance.prepare('SELECT * FROM nodes WHERE parent_id IS NULL ORDER BY created_at');
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
                contextValue: row.context_value,
                readonly: row.readonly !== undefined ? row.readonly : 0
            });
        }
        stmt.free();
        return roots;
    }

    deleteNodeById(nodeId) {
        this.executeUpdate('DELETE FROM nodes WHERE id = ?', [nodeId]);
    }

    checkOptimisticLockFailure(nodeId, expectedHash) {
        const idCount = this.executeScalar('SELECT COUNT(*) FROM nodes WHERE id = ?', [nodeId]);
        
        if (idCount === 0) {
            throw new OptimisticLockError(nodeId, 'Another agent deleted the node');
        }
        
        const hashCount = this.executeScalar('SELECT COUNT(*) FROM nodes WHERE id = ? AND hash = ?', [nodeId, expectedHash]);
        
        if (hashCount === 0) {
            throw new OptimisticLockError(nodeId, 'Another agent changed the node. Review the operation and try again.');
        }
        
        throw new OptimisticLockError(nodeId, 'Could not update the node with hash. Please review the operation and try again.');
    }

    updateNodeContent(node, expectedHash) {
        this.executeUpdateWithOptimisticLock(
            'UPDATE nodes SET text = ?, token_count = ?, updated_at = ?, hash = ? WHERE id = ? AND hash = ?',
            [node.text, node.tokenCount, node.updatedAt, node.hash, node.id, expectedHash],
            node.id,
            expectedHash
        );
    }

    updateNodeContext(node, expectedHash) {
        this.executeUpdateWithOptimisticLock(
            'UPDATE nodes SET context_type = ?, context_name = ?, context_value = ?, updated_at = ?, hash = ? WHERE id = ? AND hash = ?',
            [node.contextType, node.contextName, node.contextValue, node.updatedAt, node.hash, node.id, expectedHash],
            node.id,
            expectedHash
        );
    }

    updateNodeParentAndOrder(node, expectedHash) {
        this.executeUpdateWithOptimisticLock(
            'UPDATE nodes SET parent_id = ?, order_value = ?, updated_at = ?, hash = ? WHERE id = ? AND hash = ?',
            [node.parentId, node.order, node.updatedAt, node.hash, node.id, expectedHash],
            node.id,
            expectedHash
        );
    }

    updateNodeParent(nodeId, parentId, hash, updatedAt, expectedHash) {
        this.executeUpdateWithOptimisticLock(
            'UPDATE nodes SET parent_id = ?, hash = ?, updated_at = ? WHERE id = ? AND hash = ?',
            [parentId, hash, updatedAt, nodeId, expectedHash],
            nodeId,
            expectedHash
        );
    }

    close() {
        this.db.close();
    }
}
