/**
 * DocmemChat - Chat-specific wrapper around Docmem for managing chat sessions
 */
import { Docmem, Node, NodeHasher } from './docmem/docmem.js';
import { ROOT_PROMPT_DOCMEM_ID } from './system_prompts/root_prompt.js';
import { BASH_PROMPT } from './system_prompts/bash_prompt.js';
import { SYSTEM_PROMPT } from './system_tools/system_prompt.js';
import { DOCMEM_PROMPT } from './docmem/docmem_prompt.js';

const DEFAULT_EXPAND_MAX_TOKENS = 10000;
const VALID_CHAT_ROLES = ['user', 'assistant'];

export class DocmemChat {
    constructor(docmemId) {
        this.docmem = new Docmem(docmemId);
        this.docmemId = docmemId;
    }

    async ready() {
        await this.docmem.ready();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Message Helpers
    // ─────────────────────────────────────────────────────────────────────────

    msg(role, content) {
        return { role, content };
    }

    systemMsg(content) {
        return this.msg('system', content);
    }

    toolMsg(content) {
        return this.msg('tool', content);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Node Predicates
    // ─────────────────────────────────────────────────────────────────────────

    isSummaryToolNode(node) {
        return node.contextType === 'summary';
    }

    isMessageNode(node) {
        return node.contextType === 'message';
    }

    isToolRoleNode(node) {
        return node.contextName === 'role' && node.contextValue === 'tool';
    }

    isValidChatRole(role) {
        return VALID_CHAT_ROLES.includes(role);
    }

    isIncludableDocmem(rootInfo) {
        return !rootInfo.id.startsWith('chat_');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Children Helpers
    // ─────────────────────────────────────────────────────────────────────────

    getSortedChildren(parentId) {
        const children = this.docmem.getChildren(parentId);
        return [...children].sort((a, b) => a.order - b.order);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Node Formatting
    // ─────────────────────────────────────────────────────────────────────────

    buildNodeMetadataFields(node) {
        return [
            ['id', node.id],
            ['parent_id', node.parentId],
            ['context_type', node.contextType],
            ['context_name', node.contextName],
            ['context_value', node.contextValue],
            ['order', node.order],
            ['token_count', node.tokenCount],
            ['created_at', node.createdAt],
            ['updated_at', node.updatedAt]
        ];
    }

    filterDefinedFields(fields) {
        return fields.filter(([_, value]) => value !== null && value !== undefined);
    }

    formatMetadataFields(fields) {
        return fields
            .map(([key, value]) => `${key}: ${value}`)
            .join(', ');
    }

    formatNodeMetadata(node) {
        const fields = this.buildNodeMetadataFields(node);
        const defined = this.filterDefinedFields(fields);
        return this.formatMetadataFields(defined);
    }

    formatNodeWithMetadata(node) {
        return `${this.formatNodeMetadata(node)}\n${node.text || ''}`;
    }

    formatNodesExpanded(nodes) {
        return nodes.map(node => this.formatNodeWithMetadata(node)).join('\n\n---\n\n');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // System Message Builders
    // ─────────────────────────────────────────────────────────────────────────

    buildExpandedSystemMessage(docmemId, nodes) {
        return this.systemMsg(`${docmemId}\n\n${this.formatNodesExpanded(nodes)}`);
    }

    validateRootPromptExists() {
        const rootPromptRoot = this.docmem.find(ROOT_PROMPT_DOCMEM_ID);
        if (!rootPromptRoot) {
            console.warn('Root-prompt docmem not found');
            return false;
        }
        return true;
    }

    serializeRootPrompt() {
        const serialized = this.docmem.serialize(ROOT_PROMPT_DOCMEM_ID);
        if (!serialized || serialized.length === 0) {
            console.warn('Root-prompt docmem is empty');
            return null;
        }
        return serialized;
    }

    buildRootPromptSystemMessage() {
        if (!this.validateRootPromptExists()) {
            return null;
        }

        const serialized = this.serializeRootPrompt();
        if (!serialized) {
            return null;
        }

        const message = this.systemMsg(serialized);
        message.cache_control = { type: 'ephemeral' };
        return message;
    }

    buildPromptsSystemMessage() {
        const message = this.systemMsg(BASH_PROMPT + SYSTEM_PROMPT + DOCMEM_PROMPT);
        message.cache_control = { type: 'ephemeral' };
        return message;
    }

    expandDocmemNodes(docmemId, maxTokens) {
        return this.docmem.expandToLength(docmemId, maxTokens);
    }

    tryBuildExpandedDocmemMessage(docmemId) {
        const expandedNodes = this.expandDocmemNodes(docmemId, DEFAULT_EXPAND_MAX_TOKENS);
        if (expandedNodes.length === 0) {
            console.warn(`Could not expand docmem ${docmemId}, skipping`);
            return null;
        }

        console.log(`Added docmem ${docmemId} as system message (${expandedNodes.length} nodes)`);
        return this.buildExpandedSystemMessage(docmemId, expandedNodes);
    }

    collectIncludableDocmems() {
        const allRoots = Docmem.getAllRoots();
        return allRoots.filter(r => this.isIncludableDocmem(r));
    }

    buildNonChatDocmemSystemMessages() {
        const includable = this.collectIncludableDocmems();

        console.log(`=== INCLUDING ${includable.length} NON-CHAT DOCMEMS ===`);

        return includable
            .map(r => this.tryBuildExpandedDocmemMessage(r.id))
            .filter(msg => msg !== null);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Chat Node Converters
    // ─────────────────────────────────────────────────────────────────────────

    generateToolCallId(nodeId) {
        return `call_${nodeId}`;
    }

    buildAssistantToolCallMessage(toolCallId, functionName) {
        return {
            role: 'assistant',
            tool_calls: [{
                id: toolCallId,
                type: 'function',
                function: { name: functionName, arguments: '{}' }
            }]
        };
    }

    buildToolResultMessage(toolCallId, functionName, result) {
        return {
            role: 'tool',
            tool_call_id: toolCallId,
            name: functionName,
            content: JSON.stringify(result)
        };
    }

    convertSummaryNodeToMessages(node) {
        const toolCallId = this.generateToolCallId(node.id);
        const assistantMessage = this.buildAssistantToolCallMessage(toolCallId, 'summary');
        const toolMessage = this.buildToolResultMessage(toolCallId, 'summary', { text: node.text });
        return [assistantMessage, toolMessage];
    }

    validateContextName(node) {
        if (node.contextName !== 'role') {
            console.warn(`Unknown node format: contextName=${node.contextName}, skipping node ${node.id}`);
            return false;
        }
        return true;
    }

    validateMessageRole(role, nodeId) {
        if (!this.isValidChatRole(role)) {
            console.warn(`Unknown message role: ${role}, skipping node ${nodeId}`);
            return false;
        }
        return true;
    }

    convertMessageNodeToMessage(node) {
        if (this.isToolRoleNode(node)) {
            return this.toolMsg(node.text);
        }

        if (!this.validateContextName(node)) {
            return null;
        }

        const role = node.contextValue;
        if (!this.validateMessageRole(role, node.id)) {
            return null;
        }

        return this.msg(role, node.text);
    }

    handleSummaryNode(node) {
        console.log(`Including summary node ${node.id} as assistant tool call + tool message pair`);
        return this.convertSummaryNodeToMessages(node);
    }

    handleToolRoleNode(node) {
        console.log(`Including tool node ${node.id} as tool message`);
        return [this.toolMsg(node.text)];
    }

    handleMessageNode(node) {
        const message = this.convertMessageNodeToMessage(node);
        return message ? [message] : [];
    }

    convertChatNodeToMessages(node) {
        if (this.isSummaryToolNode(node)) {
            return this.handleSummaryNode(node);
        }

        if (!this.isMessageNode(node)) {
            console.warn(`Skipping node ${node.id}: context_type is not 'message' or 'summary' (got '${node.contextType}')`);
            return [];
        }

        if (this.isToolRoleNode(node)) {
            return this.handleToolRoleNode(node);
        }

        return this.handleMessageNode(node);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Chat Session Operations
    // ─────────────────────────────────────────────────────────────────────────

    deleteExistingRoot() {
        const existingRoot = this.docmem.getRootById(this.docmemId);
        if (existingRoot) {
            this.docmem.delete(existingRoot.id);
        }
    }

    createChatRootNode(docmemId) {
        return new Node(
            docmemId,
            null,
            '',
            0.0,
            null,
            null,
            null,
            'chat_session',
            'date',
            new Date().toISOString()
        );
    }

    async createChatSession() {
        await this.ready();
        this.deleteExistingRoot();

        const rootNode = this.createChatRootNode(this.docmemId);
        await NodeHasher.hash(rootNode);
        await this.docmem.insertNode(rootNode);
    }

    async appendUserMessage(content) {
        return await this.docmem.appendChild(this.docmemId, 'message', 'role', 'user', content);
    }

    async appendAssistantMessage(content) {
        console.log('=== ASSISTANT RESPONSE ===');
        console.log(content);
        console.log('==========================');
        return await this.docmem.appendChild(this.docmemId, 'message', 'role', 'assistant', content);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Build Message List
    // ─────────────────────────────────────────────────────────────────────────

    buildSystemMessages() {
        return [
            this.buildRootPromptSystemMessage(),
            this.buildPromptsSystemMessage(),
            ...this.buildNonChatDocmemSystemMessages()
        ].filter(msg => msg !== null);
    }

    buildChatMessages() {
        const sortedChildren = this.getSortedChildren(this.docmemId);
        return sortedChildren.flatMap(node => this.convertChatNodeToMessages(node));
    }

    async buildMessageList() {
        const systemMessages = this.buildSystemMessages();
        const chatMessages = this.buildChatMessages();
        return [...systemMessages, ...chatMessages];
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Public API
    // ─────────────────────────────────────────────────────────────────────────

    getRoot() {
        return this.docmem.find(this.docmemId);
    }

    close() {
        this.docmem.close();
    }

    find(nodeId) {
        return this.docmem.find(nodeId);
    }

    async update_content(nodeId, content) {
        return await this.docmem.updateContent(nodeId, content);
    }
}
