import { Node, OptimisticLockError } from './docmem_types.js';

/**
 * SharedDatabase - Singleton DuckDB WASM database instance
 */
export class SharedDatabase {
    static _conn = null;
    static _db = null;
    static _worker = null;
    static _initPromise = null;

    static async getInstance() {
        if (SharedDatabase._conn) {
            return SharedDatabase._conn;
        }

        if (SharedDatabase._initPromise) {
            return SharedDatabase._initPromise;
        }

        SharedDatabase._initPromise = (async () => {
            try {
                const duckdb = await import('https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm/+esm');

                const JSDELIVR_BUNDLES = duckdb.getJsDelivrBundles();
                const bundle = await duckdb.selectBundle(JSDELIVR_BUNDLES);

                const worker_url = URL.createObjectURL(
                    new Blob([`importScripts("${bundle.mainWorker}");`], { type: 'text/javascript' })
                );

                const worker = new Worker(worker_url);
                const logger = new duckdb.ConsoleLogger();
                const db = new duckdb.AsyncDuckDB(logger, worker);
                await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
                URL.revokeObjectURL(worker_url);

                SharedDatabase._worker = worker;
                SharedDatabase._db = db;

                const conn = await db.connect();
                SharedDatabase._conn = conn;

                // Initialize database schema
                await conn.query(`
                    CREATE TABLE IF NOT EXISTS nodes (
                        id TEXT PRIMARY KEY,
                        parent_id TEXT,
                        text TEXT NOT NULL,
                        order_value DOUBLE NOT NULL,
                        token_count INTEGER NOT NULL,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL,
                        context_type TEXT NOT NULL,
                        context_name TEXT NOT NULL,
                        context_value TEXT NOT NULL,
                        readonly INTEGER NOT NULL DEFAULT 0,
                        hash TEXT
                    )
                `);

                await conn.query('CREATE INDEX IF NOT EXISTS idx_parent_id ON nodes(parent_id)');
                await conn.query('CREATE INDEX IF NOT EXISTS idx_order ON nodes(parent_id, order_value)');

                return conn;
            } catch (error) {
                console.error('Error initializing DuckDB WASM:', error);
                console.error('Error details:', error.stack);
                SharedDatabase._initPromise = null;
                throw new Error('Failed to initialize DuckDB WASM: ' + error.message);
            }
        })();

        return SharedDatabase._initPromise;
    }
}

/**
 * Convert an Arrow table result to an array of plain JS objects
 */
function arrowToObjects(result) {
    return result.toArray().map(row => row.toJSON());
}

/**
 * DocmemSQLite - DuckDB WASM implementation of docmem database operations
 */
export class DocmemSQLite {
    constructor() {
        this.conn = null;
        this.initPromise = this.init();
    }

    async init() {
        this.conn = await SharedDatabase.getInstance();
    }

    async ready() {
        await this.initPromise;
    }

    async executeScalar(sql, params) {
        const stmt = await this.conn.prepare(sql);
        const result = await stmt.query(...params);
        await stmt.close();
        const rows = arrowToObjects(result);
        if (rows.length === 0) return null;
        const firstRow = rows[0];
        const keys = Object.keys(firstRow);
        return keys.length > 0 ? firstRow[keys[0]] : null;
    }

    async executeSingleRow(sql, params) {
        const stmt = await this.conn.prepare(sql);
        const result = await stmt.query(...params);
        await stmt.close();
        const rows = arrowToObjects(result);
        return rows.length > 0 ? rows[0] : null;
    }

    async executeMultipleRows(sql, params) {
        const stmt = await this.conn.prepare(sql);
        const result = await stmt.query(...params);
        await stmt.close();
        return arrowToObjects(result);
    }

    async executeUpdate(sql, params) {
        // Append RETURNING id to count affected rows
        const returningSQL = sql + ' RETURNING id';
        const stmt = await this.conn.prepare(returningSQL);
        const result = await stmt.query(...params);
        await stmt.close();
        return result.numRows;
    }

    async executeUpdateWithOptimisticLock(sql, params, nodeId, expectedHash) {
        const rowsAffected = await this.executeUpdate(sql, params);

        if (rowsAffected === 0) {
            await this.checkOptimisticLockFailure(nodeId, expectedHash);
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
        const sql = `INSERT INTO nodes (id, parent_id, text, order_value, token_count, created_at, updated_at, context_type, context_name, context_value, readonly, hash)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
        const stmt = await this.conn.prepare(sql);
        await stmt.query(
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
        );
        await stmt.close();
    }

    async getNode(nodeId) {
        const row = await this.executeSingleRow('SELECT * FROM nodes WHERE id = ?', [nodeId]);
        if (!row) {
            return null;
        }
        return this.rowToNode(row);
    }

    async getRootById(rootId) {
        const row = await this.executeSingleRow('SELECT * FROM nodes WHERE id = ? AND parent_id IS NULL', [rootId]);
        if (!row) {
            return null;
        }
        return this.rowToNode(row);
    }

    async getChildren(parentId) {
        const rows = await this.executeMultipleRows(
            'SELECT * FROM nodes WHERE parent_id = ? ORDER BY order_value',
            [parentId]
        );
        return rows.map(row => this.rowToNode(row));
    }

    async getAllRoots() {
        const rows = await this.executeMultipleRows(
            'SELECT * FROM nodes WHERE parent_id IS NULL ORDER BY created_at',
            []
        );
        return rows.map(row => this.rowToNode(row));
    }

    static async getAllRoots() {
        if (!SharedDatabase._conn) {
            return [];
        }
        const conn = SharedDatabase._conn;
        const result = await conn.query('SELECT * FROM nodes WHERE parent_id IS NULL ORDER BY created_at');
        const rows = arrowToObjects(result);
        return rows.map(row => ({
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
        }));
    }

    async deleteNodeById(nodeId) {
        const sql = 'DELETE FROM nodes WHERE id = ?';
        const stmt = await this.conn.prepare(sql + ' RETURNING id');
        await stmt.query(nodeId);
        await stmt.close();
    }

    async checkOptimisticLockFailure(nodeId, expectedHash) {
        const idCount = await this.executeScalar('SELECT COUNT(*) FROM nodes WHERE id = ?', [nodeId]);

        if (idCount === 0) {
            throw new OptimisticLockError(nodeId, 'Another agent deleted the node');
        }

        const hashCount = await this.executeScalar('SELECT COUNT(*) FROM nodes WHERE id = ? AND hash = ?', [nodeId, expectedHash]);

        if (hashCount === 0) {
            throw new OptimisticLockError(nodeId, 'Another agent changed the node. Review the operation and try again.');
        }

        throw new OptimisticLockError(nodeId, 'Could not update the node with hash. Please review the operation and try again.');
    }

    async updateNodeContent(node, expectedHash) {
        await this.executeUpdateWithOptimisticLock(
            'UPDATE nodes SET text = ?, token_count = ?, updated_at = ?, hash = ? WHERE id = ? AND hash = ?',
            [node.text, node.tokenCount, node.updatedAt, node.hash, node.id, expectedHash],
            node.id,
            expectedHash
        );
    }

    async updateNodeContext(node, expectedHash) {
        await this.executeUpdateWithOptimisticLock(
            'UPDATE nodes SET context_type = ?, context_name = ?, context_value = ?, updated_at = ?, hash = ? WHERE id = ? AND hash = ?',
            [node.contextType, node.contextName, node.contextValue, node.updatedAt, node.hash, node.id, expectedHash],
            node.id,
            expectedHash
        );
    }

    async updateNodeParentAndOrder(node, expectedHash) {
        await this.executeUpdateWithOptimisticLock(
            'UPDATE nodes SET parent_id = ?, order_value = ?, updated_at = ?, hash = ? WHERE id = ? AND hash = ?',
            [node.parentId, node.order, node.updatedAt, node.hash, node.id, expectedHash],
            node.id,
            expectedHash
        );
    }

    async updateNodeParent(nodeId, parentId, hash, updatedAt, expectedHash) {
        await this.executeUpdateWithOptimisticLock(
            'UPDATE nodes SET parent_id = ?, hash = ?, updated_at = ? WHERE id = ? AND hash = ?',
            [parentId, hash, updatedAt, nodeId, expectedHash],
            nodeId,
            expectedHash
        );
    }

    async close() {
        if (this.conn) {
            await this.conn.close();
        }
    }
}
