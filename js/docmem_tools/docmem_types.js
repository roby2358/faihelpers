/**
 * Core types for docmem system
 */

/**
 * NodeHasher - Computes SHA-512 hash of node state for optimistic locking
 */
export class NodeHasher {
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
export class OptimisticLockError extends Error {
    constructor(nodeId, message = 'Concurrent modification detected') {
        super(message);
        this.name = 'OptimisticLockError';
        this.nodeId = nodeId;
        this.message = `Optimistic lock failed for node ${nodeId}: ${message}. The node was modified by another operation. Please read the current state and retry your update.`;
    }
}


export class Node {
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

    contextString() {
        return `${this.contextType}:${this.contextName}:${this.contextValue}`;
    }

    metadataString() {
        return `${this.id} ${this.contextString()} ${this.updatedAt}`;
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
