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
     */
    async createChatSession() {
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
            '',
            0.0,
            null,
            null,
            null,
            'chat_session',
            'date',
            timestamp
        );
        this.docmem._insertNode(rootNode);
    }

    /**
     * Append a user message to the chat session
     */
    appendUserMessage(content) {
        const root = this.getRoot();
        if (!root) {
            throw new Error('Chat session root not found. Call createChatSession() first.');
        }
        return this.docmem.append_child(
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
    appendAssistantMessage(content) {
        const root = this.getRoot();
        if (!root) {
            throw new Error('Chat session root not found. Call createChatSession() first.');
        }
        
        // Log the assistant response before appending
        console.log('=== ASSISTANT RESPONSE ===');
        console.log(content);
        console.log('==========================');
        
        return this.docmem.append_child(
            root.id,
            'message',
            'role',
            'assistant',
            content
        );
    }

    /**
     * Build OpenAI message list from chat session
     * Iterates over root's children, oldest to newest
     * Summary nodes are formatted as assistant tool call + tool response pairs
     * Message nodes are formatted as standard messages
     */
    buildMessageList() {
        const root = this.getRoot();
        if (!root) {
            throw new Error('Chat session root not found. Call createChatSession() first.');
        }

        const children = this.docmem._getChildren(root.id);
        const sortedChildren = [...children].sort((a, b) => a.order - b.order);
        
        // Log all children for debugging
        console.log('=== BUILDING MESSAGE LIST ===');
        console.log(`Root ID: ${root.id}`);
        console.log(`Total children: ${children.length}`);
        sortedChildren.forEach(node => {
            console.log(`  Node: ${node.id}, contextType: ${node.contextType}, contextName: ${node.contextName}, contextValue: ${node.contextValue}, order: ${node.order}, text: ${node.text.substring(0, 50)}...`);
        });
        
        const messages = [];
        
        for (const node of sortedChildren) {
            // Handle summary nodes: context_type=summary, context_name=role, context_value=tool
            if (node.contextType === 'summary' && node.contextName === 'role' && node.contextValue === 'tool') {
                console.log(`Including summary node ${node.id} as assistant tool call + tool message pair`);
                const toolCallId = `call_${node.id}`;
                
                // First message: assistant with tool_calls
                messages.push({
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
                });
                
                // Second message: tool response
                messages.push({
                    role: 'tool',
                    tool_call_id: toolCallId,
                    name: 'summary',
                    content: JSON.stringify({ text: node.text })
                });
            }
            // Handle message nodes: context_type=message
            else if (node.contextType === 'message') {
                // Check for tool nodes: context_name=role and context_value=tool
                if (node.contextName === 'role' && node.contextValue === 'tool') {
                    // Format as tool message, don't traverse children
                    console.log(`Including tool node ${node.id} as tool message`);
                    messages.push({
                        role: 'tool',
                        content: node.text
                    });
                } else if (node.contextName === 'role') {
                    // Format message node based on role
                    const role = node.contextValue; // 'user' or 'assistant'
                    if (role !== 'user' && role !== 'assistant') {
                        console.warn(`Unknown message role: ${role}, skipping node ${node.id}`);
                        continue;
                    }
                    messages.push({
                        role: role,
                        content: node.text
                    });
                } else {
                    console.warn(`Unknown node format: contextName=${node.contextName}, contextValue=${node.contextValue}, skipping node ${node.id}`);
                }
            } else {
                console.warn(`Skipping node ${node.id}: context_type is not 'message' or 'summary' (got '${node.contextType}')`);
            }
        }
        
        // Log the message list that will be sent to the LLM
        console.log('=== CHAT MESSAGE LIST TO LLM ===');
        console.log(JSON.stringify(messages, null, 2));
        console.log('================================');
        
        return messages;
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

    update_content(nodeId, content) {
        return this.docmem.update_content(nodeId, content);
    }
}

