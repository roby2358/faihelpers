/**
 * DocmemChat - Chat-specific wrapper around Docmem for managing chat sessions
 */
class DocmemChat {
    constructor(docmemId) {
        this.docmem = new Docmem(docmemId);
        this.docmemId = docmemId;
    }

    async ready() {
        await this.docmem.ready();
    }

    /**
     * Initialize as a chat session with proper root node context
     * @param {string} systemText - System text to include in the root node
     */
    async createChatSession(systemText) {
        await this.ready();
        
        // Delete the existing root node if it exists (to replace with chat session root)
        const existingRoot = this.docmem._getRootById(this.docmemId);
        if (existingRoot) {
            this.docmem.delete(existingRoot.id);
        }
        
        // Create chat session root with ISO8601 timestamp
        const timestamp = new Date().toISOString();
        const rootNode = new Node(
            this.docmemId,
            null,
            systemText,
            0.0,
            null,
            null,
            null,
            'chat_session',
            'date',
            timestamp
        );
        await NodeHasher.hash(rootNode);
        await this.docmem._insertNode(rootNode);
    }

    /**
     * Append a user message to the chat session
     */
    async appendUserMessage(content) {
        const root = this.getRoot();
        if (!root) {
            throw new Error('Chat session root not found. Call createChatSession() first.');
        }
        return await this.docmem.append_child(
            root.id,
            'message',
            'role',
            'user',
            content
        );
    }

    /**
     * Append an assistant message to the chat session
     */
    async appendAssistantMessage(content) {
        const root = this.getRoot();
        if (!root) {
            throw new Error('Chat session root not found. Call createChatSession() first.');
        }
        
        // Log the assistant response before appending
        console.log('=== ASSISTANT RESPONSE ===');
        console.log(content);
        console.log('==========================');
        
        return await this.docmem.append_child(
            root.id,
            'message',
            'role',
            'assistant',
            content
        );
    }

    /**
     * Format a node with metadata and content into a human-readable string
     * @param {Node} node - The node to format
     * @returns {string} Formatted string representation
     */
    _formatNodeWithMetadata(node) {
        const parts = [];
        parts.push(`id: ${node.id}`);
        if (node.parentId) {
            parts.push(`parent_id: ${node.parentId}`);
        }
        parts.push(`context_type: ${node.contextType}`);
        parts.push(`context_name: ${node.contextName}`);
        parts.push(`context_value: ${node.contextValue}`);
        parts.push(`order: ${node.order}`);
        parts.push(`token_count: ${node.tokenCount}`);
        parts.push(`created_at: ${node.createdAt}`);
        parts.push(`updated_at: ${node.updatedAt}`);
        
        const metadataStr = parts.join(', ');
        const contentStr = node.text || '';
        
        return `${metadataStr}\n${contentStr}`;
    }

    /**
     * Build system messages from all non-chat docmems
     * @returns {Array<Object>} Array of system message objects
     */
    _buildNonChatDocmemSystemMessages() {
        const messages = [];
        
        try {
            const allRoots = Docmem.getAllRoots();
            const nonChatDocmems = allRoots.filter(rootInfo => 
                !rootInfo.id.startsWith('chat_') && rootInfo.id !== this.docmemId
            );
            
            console.log(`=== INCLUDING ${nonChatDocmems.length} NON-CHAT DOCMEMS ===`);
            
            for (const rootInfo of nonChatDocmems) {
                try {
                    const expandedNodes = this.docmem.expandToLength(rootInfo.id, 20000);
                    if (expandedNodes.length === 0) {
                        console.warn(`Could not find root node for docmem ${rootInfo.id}, skipping`);
                        continue;
                    }
                    
                    const nodeStrings = expandedNodes.map(node => this._formatNodeWithMetadata(node));
                    const docmemContent = nodeStrings.join('\n\n---\n\n');
                    
                    messages.push({
                        role: 'system',
                        content: `# Docmem: ${rootInfo.id}\n\n${docmemContent}`
                    });
                    
                    console.log(`Added docmem ${rootInfo.id} as system message (${expandedNodes.length} nodes)`);
                } catch (error) {
                    console.error(`Error including docmem ${rootInfo.id}:`, error);
                }
            }
        } catch (error) {
            console.error('Error getting docmem roots for system context:', error);
        }
        
        return messages;
    }

    /**
     * Convert a summary node to OpenAI message format (tool call + tool response)
     * @param {Node} node - The summary node to convert
     * @returns {Array<Object>} Array of two message objects [assistant message with tool_calls, tool response]
     */
    _convertSummaryNodeToMessages(node) {
        const toolCallId = `call_${node.id}`;
        
        return [
            {
                role: 'assistant',
                tool_calls: [
                    {
                        id: toolCallId,
                        type: 'function',
                        function: {
                            name: 'summary',
                            arguments: '{}'
                        }
                    }
                ]
            },
            {
                role: 'tool',
                tool_call_id: toolCallId,
                name: 'summary',
                content: JSON.stringify({ text: node.text })
            }
        ];
    }

    /**
     * Convert a message node to OpenAI message format
     * @param {Node} node - The message node to convert
     * @returns {Object|null} Message object, or null if node format is invalid
     */
    _convertMessageNodeToMessage(node) {
        if (node.contextName === 'role' && node.contextValue === 'tool') {
            return {
                role: 'tool',
                content: node.text
            };
        }
        
        if (node.contextName === 'role') {
            const role = node.contextValue;
            if (role !== 'user' && role !== 'assistant') {
                console.warn(`Unknown message role: ${role}, skipping node ${node.id}`);
                return null;
            }
            return {
                role: role,
                content: node.text
            };
        }
        
        console.warn(`Unknown node format: contextName=${node.contextName}, contextValue=${node.contextValue}, skipping node ${node.id}`);
        return null;
    }

    /**
     * Convert a chat session node to OpenAI message format(s)
     * @param {Node} node - The node to convert
     * @returns {Array<Object>} Array of message objects (may be empty)
     */
    _convertChatNodeToMessages(node) {
        if (node.contextType === 'summary' && node.contextName === 'role' && node.contextValue === 'tool') {
            console.log(`Including summary node ${node.id} as assistant tool call + tool message pair`);
            return this._convertSummaryNodeToMessages(node);
        }
        
        if (node.contextType === 'message') {
            if (node.contextName === 'role' && node.contextValue === 'tool') {
                console.log(`Including tool node ${node.id} as tool message`);
                return [{ role: 'tool', content: node.text }];
            }
            
            const message = this._convertMessageNodeToMessage(node);
            return message ? [message] : [];
        }
        
        console.warn(`Skipping node ${node.id}: context_type is not 'message' or 'summary' (got '${node.contextType}')`);
        return [];
    }

    /**
     * Build OpenAI message list from chat session
     * Iterates over root's children, oldest to newest
     * Summary nodes are formatted as assistant tool call + tool response pairs
     * Message nodes are formatted as standard messages
     * Also includes expanded content from non-chat docmems as system messages
     */
    async buildMessageList() {
        const root = this.getRoot();
        if (!root) {
            throw new Error('Chat session root not found. Call createChatSession() first.');
        }

        const children = this.docmem._getChildren(root.id);
        const sortedChildren = [...children].sort((a, b) => a.order - b.order);
        
        this._logBuildingMessageList(root, sortedChildren);
        
        const messages = [];
        
        // Add system message from root node text if present
        if (root.text && root.text.trim()) {
            messages.push({
                role: 'system',
                content: root.text.trim()
            });
        }
        
        // Add system messages from non-chat docmems
        messages.push(...this._buildNonChatDocmemSystemMessages());
        
        // Convert chat session nodes to messages
        for (const node of sortedChildren) {
            const nodeMessages = this._convertChatNodeToMessages(node);
            messages.push(...nodeMessages);
        }
        
        this._logFinalMessageList(messages);
        
        return messages;
    }

    /**
     * Log information about building the message list
     * @param {Node} root - The root node
     * @param {Array<Node>} sortedChildren - Sorted children nodes
     */
    _logBuildingMessageList(root, sortedChildren) {
        console.log('=== BUILDING MESSAGE LIST ===');
        console.log(`Root ID: ${root.id}`);
        console.log(`Total children: ${sortedChildren.length}`);
        sortedChildren.forEach(node => {
            const textPreview = node.text ? node.text.substring(0, 50) : '(empty)';
            console.log(`  Node: ${node.id}, contextType: ${node.contextType}, contextName: ${node.contextName}, contextValue: ${node.contextValue}, order: ${node.order}, text: ${textPreview}...`);
        });
    }

    /**
     * Log the final message list
     * @param {Array<Object>} messages - The message list to log
     */
    _logFinalMessageList(messages) {
        console.log('=== CHAT MESSAGE LIST TO LLM ===');
        console.log(JSON.stringify(messages, null, 2));
        console.log('================================');
    }

    /**
     * Get the chat session root node
     */
    getRoot() {
        return this.docmem.find(this.docmemId);
    }

    /**
     * Close the underlying docmem instance
     */
    close() {
        this.docmem.close();
    }

    // Expose other docmem methods as needed
    find(nodeId) {
        return this.docmem.find(nodeId);
    }

    async update_content(nodeId, content) {
        return await this.docmem.update_content(nodeId, content);
    }
}

