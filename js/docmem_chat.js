/**
 * DocmemChat - Chat-specific wrapper around Docmem for managing chat sessions
 */
import { Docmem } from './docmem_tools/docmem.js';
import { Node, NodeHasher } from './docmem_tools/docmem_types.js';
import { ROOT_PROMPT_DOCMEM_ID } from './system_prompts/root_prompt.js';
import { PYTOOL_PROMPT } from './pytool/pytool_prompt.js';
import { SYSTEM_PROMPT } from './system_tools/system_prompt.js';
import { DOCMEM_PROMPT } from './docmem_tools/docmem_prompt.js';

const DEFAULT_EXPAND_MAX_TOKENS = 20000;
const VALID_CHAT_ROLES = ['user', 'assistant'];

/**
 * Options (both keys required; null allowed):
 *   readSet   array of node ids to expand as docmem context instead of every
 *             non-chat docmem (null: expand all, the chat agent's default)
 *   lensId    root id of a docmem serialized as a system prompt after the
 *             root prompt (null: none)
 */
export class DocmemChat {
    constructor(docmemId, { readSet, lensId }) {
        if (readSet === undefined || lensId === undefined) {
            throw new Error('DocmemChat options require readSet and lensId');
        }
        this.docmem = new Docmem(docmemId);
        this.docmemId = docmemId;
        this.readSet = readSet;
        this.lensId = lensId;
    }

    async ready() {
        await this.docmem.ready();
    }

    // Message Helpers

    msg(role, content) {
        return { role, content };
    }

    systemMsg(content) {
        return this.msg('system', content);
    }

    toolMsg(content) {
        return this.msg('tool', content);
    }

    // Node Predicates

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
        // Exclude chat docmems, and the root prompt — it is already included
        // (serialized) by buildRootPromptSystemMessage
        return !rootInfo.id.startsWith('chat_') && rootInfo.id !== ROOT_PROMPT_DOCMEM_ID;
    }

    // Children Helpers

    async getSortedChildren(parentId) {
        const children = await this.docmem.getChildren(parentId);
        return [...children].sort((a, b) => a.order - b.order);
    }

    // Node Formatting

    // Expansion has no holes, so every ancestor of a returned node is in the
    // list; depth is recovered from parent links to indent headers as
    // docmem_structure does.
    buildDepthMap(nodes) {
        const depths = new Map();
        for (const node of nodes) {
            const parentDepth = depths.get(node.parentId);
            depths.set(node.id, parentDepth === undefined ? 0 : parentDepth + 1);
        }
        return depths;
    }

    formatNodeWithMetadata(node, depth) {
        const indent = '  '.repeat(depth);
        return `${indent}${node.metadataString()}\n${node.text || ''}`;
    }

    formatNodesExpanded(nodes) {
        const depths = this.buildDepthMap(nodes);
        return nodes.map(node => this.formatNodeWithMetadata(node, depths.get(node.id))).join('\n\n');
    }

    // System Message Builders

    buildTruncationMarker(startNodeId, nodes, totalCount) {
        if (nodes.length >= totalCount) {
            return '';
        }
        // Expansion is breadth-first, so omissions are scattered deeper/older
        // subtrees, not a tail cut — the marker must lead, not trail.
        return `[partial: ${nodes.length} of ${totalCount} nodes shown (token budget); call docmem_structure("${startNodeId}") to see the omitted subtrees]`;
    }

    buildFocusMarker(docmemId, focusNodeId) {
        if (!focusNodeId) {
            return '';
        }
        return `[focus: showing only the subtree of ${focusNodeId} within docmem ${docmemId}; call docmem_focus("${docmemId}", "${docmemId}") to restore the full tree]`;
    }

    buildExpandedSystemMessage(docmemId, focusNodeId, nodes, totalCount) {
        const startNodeId = focusNodeId || docmemId;
        const markers = [
            this.buildFocusMarker(docmemId, focusNodeId),
            this.buildTruncationMarker(startNodeId, nodes, totalCount)
        ].filter(Boolean).join('\n');
        const body = this.formatNodesExpanded(nodes);
        return this.systemMsg(markers ? `${markers}\n\n${body}` : body);
    }

    async validateRootPromptExists() {
        const rootPromptRoot = await this.docmem.find(ROOT_PROMPT_DOCMEM_ID);
        if (!rootPromptRoot) {
            console.warn('Root-prompt docmem not found');
            return false;
        }
        return true;
    }

    async serializeRootPrompt() {
        const serialized = await this.docmem.serialize(ROOT_PROMPT_DOCMEM_ID);
        if (!serialized || serialized.length === 0) {
            console.warn('Root-prompt docmem is empty');
            return null;
        }
        return serialized;
    }

    async buildRootPromptSystemMessage() {
        if (!await this.validateRootPromptExists()) {
            return null;
        }

        const serialized = await this.serializeRootPrompt();
        if (!serialized) {
            return null;
        }

        const message = this.systemMsg(serialized);
        message.cache_control = { type: 'ephemeral' };
        return message;
    }

    async buildLensSystemMessage() {
        if (!this.lensId) {
            return null;
        }
        const root = await this.docmem.find(this.lensId);
        if (!root) {
            console.warn(`Lens docmem ${this.lensId} not found`);
            return null;
        }
        const serialized = await this.docmem.serialize(this.lensId);
        if (!serialized) {
            return null;
        }
        const message = this.systemMsg(serialized);
        message.cache_control = { type: 'ephemeral' };
        return message;
    }

    buildPromptsSystemMessage() {
        const message = this.systemMsg(PYTOOL_PROMPT + SYSTEM_PROMPT + DOCMEM_PROMPT);
        message.cache_control = { type: 'ephemeral' };
        return message;
    }

    async expandDocmemNodes(docmemId, maxTokens) {
        return await this.docmem.expandToLength(docmemId, maxTokens);
    }

    maxUpdatedAt(nodes) {
        return nodes.reduce((max, node) => (node.updatedAt > max ? node.updatedAt : max), '');
    }

    async resolveFocusNode(docmemId) {
        const focusNodeId = Docmem.getFocus(docmemId);
        if (!focusNodeId) {
            return null;
        }
        const node = await this.docmem.find(focusNodeId);
        if (!node) {
            // Focus node was deleted — fall back to the full tree.
            Docmem.clearFocus(docmemId);
            return null;
        }
        return focusNodeId;
    }

    async tryBuildExpandedDocmemMessage(docmemId) {
        const focusNodeId = await this.resolveFocusNode(docmemId);
        const startNodeId = focusNodeId || docmemId;
        const { nodes: expandedNodes, totalCount } = await this.expandDocmemNodes(startNodeId, DEFAULT_EXPAND_MAX_TOKENS);
        if (expandedNodes.length === 0) {
            console.warn(`Could not expand docmem ${docmemId}, skipping`);
            return null;
        }

        const focusNote = focusNodeId ? `, focused on ${focusNodeId}` : '';
        console.log(`Added docmem ${docmemId} as system message (${expandedNodes.length} of ${totalCount} nodes${focusNote})`);
        return {
            message: this.buildExpandedSystemMessage(docmemId, focusNodeId, expandedNodes, totalCount),
            lastUpdated: this.maxUpdatedAt(expandedNodes),
            docmemId
        };
    }

    compareByLastUpdated(a, b) {
        if (a.lastUpdated !== b.lastUpdated) {
            return a.lastUpdated < b.lastUpdated ? -1 : 1;
        }
        return a.docmemId.localeCompare(b.docmemId);
    }

    buildRootsRosterMessage(allRoots) {
        // Chat roots are omitted — the agent has nothing to do with them.
        // Sorted so the message is byte-stable regardless of query order,
        // keeping it prompt-cache friendly.
        const ids = allRoots
            .map(r => r.id)
            .filter(id => !id.startsWith('chat_'))
            .sort()
            .join('\n');
        return this.systemMsg(`$ System.docmem_roots()\n\n${ids}`);
    }

    // A read-set entry names a node; expansion starts there (no focus), so a
    // node inside a summary is expanded even though the summary rule would
    // omit it from its docmem's own expansion.
    async tryBuildReadSetMessage(nodeId) {
        const node = await this.docmem.find(nodeId);
        if (!node) {
            console.warn(`Read-set node ${nodeId} not found, skipping`);
            return null;
        }
        const { nodes, totalCount } = await this.expandDocmemNodes(nodeId, DEFAULT_EXPAND_MAX_TOKENS);
        if (nodes.length === 0) {
            return null;
        }
        return {
            message: this.buildExpandedSystemMessage(nodeId, null, nodes, totalCount),
            lastUpdated: this.maxUpdatedAt(nodes),
            docmemId: nodeId
        };
    }

    async buildNonChatDocmemSystemMessages() {
        const allRoots = await Docmem.getAllRoots();
        const entries = [];

        if (this.readSet) {
            console.log(`=== INCLUDING READ-SET OF ${this.readSet.length} NODES ===`);
            for (const id of this.readSet) {
                const entry = await this.tryBuildReadSetMessage(id);
                if (entry !== null) {
                    entries.push(entry);
                }
            }
        } else {
            const includable = allRoots.filter(r => this.isIncludableDocmem(r));
            console.log(`=== INCLUDING ${includable.length} NON-CHAT DOCMEMS ===`);
            for (const r of includable) {
                const entry = await this.tryBuildExpandedDocmemMessage(r.id);
                if (entry !== null) {
                    entries.push(entry);
                }
            }
        }
        // Most recently updated last, so frequently edited docmems settle at
        // the tail of the message list where their churn invalidates the
        // least cacheable prefix. lastUpdated is the max updated_at over the
        // included nodes only, so the sort key changes only when the
        // serialized bytes do.
        entries.sort((a, b) => this.compareByLastUpdated(a, b));
        return [this.buildRootsRosterMessage(allRoots), ...entries.map(entry => entry.message)];
    }

    // Chat Node Converters

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

    // Chat Session Operations

    async deleteExistingRoot() {
        const existingRoot = await this.docmem.getRootById(this.docmemId);
        if (existingRoot) {
            await this.docmem.delete(existingRoot.id);
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
        await this.deleteExistingRoot();

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

    // Build Message List

    async buildSystemMessages() {
        return [
            await this.buildRootPromptSystemMessage(),
            await this.buildLensSystemMessage(),
            this.buildPromptsSystemMessage()
        ].filter(msg => msg !== null);
    }

    async buildChatMessages() {
        const sortedChildren = await this.getSortedChildren(this.docmemId);
        const messages = [];
        for (const node of sortedChildren) {
            messages.push(...this.convertChatNodeToMessages(node));
        }
        return messages;
    }

    /**
     * Final user-role message so the list ends on a user turn. Byte-stable.
     */
    async buildMessageList() {
        const systemMessages = await this.buildSystemMessages();
        const chatMessages = await this.buildChatMessages();
        const docmemMessages = await this.buildNonChatDocmemSystemMessages();
        return [...systemMessages, ...docmemMessages, ...chatMessages];
    }

    // Public API

    async getRoot() {
        return await this.docmem.find(this.docmemId);
    }

    async close() {
        await this.docmem.close();
    }

    async find(nodeId) {
        return await this.docmem.find(nodeId);
    }

    async update_content(nodeId, content) {
        return await this.docmem.updateContent(nodeId, content);
    }
}
