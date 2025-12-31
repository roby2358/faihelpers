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
        this._initPromise = this._init();
    }

    async _init() {
        this.db = await SharedDatabase.getInstance();
    }

    async ready() {
        await this._initPromise;
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
            row.context_value
        );
        node.hash = row.hash || null;
        return node;
    }

    async insertNode(node) {
        const stmt = this.db.prepare(`
            INSERT INTO nodes (id, parent_id, text, order_value, token_count, created_at, updated_at, context_type, context_name, context_value, hash)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            node.contextValue,
            node.hash
        ]);
        stmt.step();
        stmt.free();
    }

    getNode(nodeId) {
        const stmt = this.db.prepare('SELECT * FROM nodes WHERE id = ?');
        stmt.bind([nodeId]);
        const result = stmt.step() ? this.rowToNode(stmt.getAsObject()) : null;
        stmt.free();
        return result;
    }

    getRootById(rootId) {
        const stmt = this.db.prepare('SELECT * FROM nodes WHERE id = ? AND parent_id IS NULL');
        stmt.bind([rootId]);
        const result = stmt.step() ? this.rowToNode(stmt.getAsObject()) : null;
        stmt.free();
        return result;
    }

    getChildren(parentId) {
        const stmt = this.db.prepare(`
            SELECT * FROM nodes
            WHERE parent_id = ?
            ORDER BY order_value
        `);
        stmt.bind([parentId]);
        const children = [];
        while (stmt.step()) {
            children.push(this.rowToNode(stmt.getAsObject()));
        }
        stmt.free();
        return children;
    }

    getAllRoots() {
        const stmt = this.db.prepare('SELECT * FROM nodes WHERE parent_id IS NULL ORDER BY created_at');
        const roots = [];
        while (stmt.step()) {
            roots.push(this.rowToNode(stmt.getAsObject()));
        }
        stmt.free();
        return roots;
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
                contextValue: row.context_value
            });
        }
        stmt.free();
        return roots;
    }

    deleteNodeById(nodeId) {
        const stmt = this.db.prepare('DELETE FROM nodes WHERE id = ?');
        stmt.bind([nodeId]);
        stmt.step();
        stmt.free();
    }

    checkOptimisticLockFailure(nodeId, expectedHash) {
        const idCheckStmt = this.db.prepare('SELECT COUNT(*) FROM nodes WHERE id = ?');
        idCheckStmt.bind([nodeId]);
        idCheckStmt.step();
        const idCount = idCheckStmt.get()[0];
        idCheckStmt.free();
        
        if (idCount === 0) {
            throw new OptimisticLockError(nodeId, 'Another agent deleted the node');
        }
        
        const hashCheckStmt = this.db.prepare('SELECT COUNT(*) FROM nodes WHERE id = ? AND hash = ?');
        hashCheckStmt.bind([nodeId, expectedHash]);
        hashCheckStmt.step();
        const hashCount = hashCheckStmt.get()[0];
        hashCheckStmt.free();
        
        if (hashCount === 0) {
            throw new OptimisticLockError(nodeId, 'Another agent changed the node. Review the operation and try again.');
        }
        
        throw new OptimisticLockError(nodeId, 'Could not update the node with hash. Please review the operation and try again.');
    }

    updateNodeContent(node, expectedHash) {
        const stmt = this.db.prepare(
            'UPDATE nodes SET text = ?, token_count = ?, updated_at = ?, hash = ? WHERE id = ? AND hash = ?'
        );
        stmt.bind([node.text, node.tokenCount, node.updatedAt, node.hash, node.id, expectedHash]);
        stmt.step();
        const rowsAffected = this.db.getRowsModified();
        stmt.free();
        
        if (rowsAffected === 0) {
            this.checkOptimisticLockFailure(node.id, expectedHash);
        }
    }

    updateNodeContext(node, expectedHash) {
        const stmt = this.db.prepare(
            'UPDATE nodes SET context_type = ?, context_name = ?, context_value = ?, updated_at = ?, hash = ? WHERE id = ? AND hash = ?'
        );
        stmt.bind([node.contextType, node.contextName, node.contextValue, node.updatedAt, node.hash, node.id, expectedHash]);
        stmt.step();
        const rowsAffected = this.db.getRowsModified();
        stmt.free();
        
        if (rowsAffected === 0) {
            this.checkOptimisticLockFailure(node.id, expectedHash);
        }
    }

    updateNodeParentAndOrder(node, expectedHash) {
        const stmt = this.db.prepare(
            'UPDATE nodes SET parent_id = ?, order_value = ?, updated_at = ?, hash = ? WHERE id = ? AND hash = ?'
        );
        stmt.bind([node.parentId, node.order, node.updatedAt, node.hash, node.id, expectedHash]);
        stmt.step();
        const rowsAffected = this.db.getRowsModified();
        stmt.free();
        
        if (rowsAffected === 0) {
            this.checkOptimisticLockFailure(node.id, expectedHash);
        }
    }

    updateNodeParent(nodeId, parentId, hash, updatedAt, expectedHash) {
        const stmt = this.db.prepare(
            'UPDATE nodes SET parent_id = ?, hash = ?, updated_at = ? WHERE id = ? AND hash = ?'
        );
        stmt.bind([parentId, hash, updatedAt, nodeId, expectedHash]);
        stmt.step();
        const rowsAffected = this.db.getRowsModified();
        stmt.free();
        
        if (rowsAffected === 0) {
            this.checkOptimisticLockFailure(nodeId, expectedHash);
        }
    }

    close() {
        this.db.close();
    }
}
