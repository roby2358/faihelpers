/**
 * Chat - Chat interface logic using AgentLoop and DocmemChat
 */
import { OpenRouterAPI } from './OpenRouterAPI.js';
import { DocmemCommands, KNOWN_DOCMEM_COMMANDS } from './docmem_tools/docmem_commands.js';
import { SystemCommands, KNOWN_SYSTEM_COMMANDS } from './system_tools/system_commands.js';
import { DocmemChat } from './docmem_chat.js';
import { showMessage } from './index.js';
import { Key } from './key.js';
import { AgentLoop, formatDelegationMessage } from './agent_loop.js';
import { randomString } from './tools.js';

let chatSession = null;
let api = null;
let isProcessing = false;
let keyHandler = null;

const CHAT_DOCMEM_ID = 'chat_session';
const KNOWN_COMMANDS = new Set([...KNOWN_SYSTEM_COMMANDS, ...KNOWN_DOCMEM_COMMANDS]);
const VALID_MODES = new Set(['append-child', 'before', 'after']);
const STATIC_DOCMEM_COMMANDS = new Set(['docmem_get_all_roots', 'docmem_create']);

// ─────────────────────────────────────────────────────────────────────────────
// UI Helpers
// ─────────────────────────────────────────────────────────────────────────────

let lastRequestStats = null;

function updateStatusLine() {
    const statusEl = document.getElementById('chat-status');
    if (!statusEl) return;

    const state = isProcessing ? 'Working...' : 'Ready';
    const s = lastRequestStats;
    statusEl.textContent = s
        ? `${state} | reasoning: ${s.reasoning} | context length: ${s.contextLength.toLocaleString()} | max tokens: ${s.maxTokens.toLocaleString()}`
        : state;
}

function reportModelRequest(stats) {
    lastRequestStats = stats;
    updateStatusLine();
}

function setUIEnabled(enabled) {
    const chatInput = document.getElementById('chat-input');
    const sendBtn = document.getElementById('chat-send-btn');
    const continueBtn = document.getElementById('chat-continue-btn');

    chatInput.disabled = !enabled;
    sendBtn.disabled = !enabled;
    continueBtn.disabled = !enabled;

    if (enabled) {
        chatInput.focus();
    }
}

function appendToChatDisplay(text) {
    const chatMessages = document.getElementById('chat-messages');
    if (chatMessages.value) {
        chatMessages.value += '\n' + text;
    } else {
        chatMessages.value = text;
    }
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function loadStoredApiKey(apiKeyInput) {
    const storedApiKey = sessionStorage.getItem('chat_api_key');
    if (storedApiKey) {
        apiKeyInput.value = storedApiKey;
    }
}

function loadStoredModel(modelSelect) {
    const storedModel = sessionStorage.getItem('chat_model');
    if (!storedModel) return;

    const optionExists = Array.from(modelSelect.options).some(opt => opt.value === storedModel);
    if (optionExists) {
        modelSelect.value = storedModel;
    }
}

function storeApiKeyAndModel(apiKey, model) {
    sessionStorage.setItem('chat_api_key', apiKey);
    sessionStorage.setItem('chat_model', model);
}

function truncate(text, maxLen) {
    return text.length > maxLen ? text.slice(0, maxLen - 3) + '...' : text;
}

// ─────────────────────────────────────────────────────────────────────────────
// Arg Helpers
// ─────────────────────────────────────────────────────────────────────────────

function requireArgs(args, minCount, commandName, usage) {
    if (args.length < minCount) {
        throw new Error(`${commandName} requires ${usage}`);
    }
}

function requireMode(mode) {
    if (!VALID_MODES.has(mode)) {
        throw new Error(`Mode must be append-child, before, or after`);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Docmem Command Dispatch
// ─────────────────────────────────────────────────────────────────────────────

async function executeDocmemCommand(args, docmem) {
    const [command, ...restArgs] = args;

    if (!STATIC_DOCMEM_COMMANDS.has(command) && !docmem) {
        throw new Error(`Command ${command} requires an active docmem instance`);
    }

    try {
        const commands = new DocmemCommands(docmem);

        switch (command) {
            case 'docmem_create': {
                requireArgs(restArgs, 1, 'docmem_create', '<root_id>');
                return await commands.create(restArgs[0]);
            }

            case 'docmem_create_node': {
                requireArgs(restArgs, 5, 'docmem_create_node', '<mode> <node_id> <context_type> <context_name> <context_value> [<content>]');
                const [mode, nodeId, contextType, contextName, contextValue] = restArgs;
                requireMode(mode);
                return await commands.createNode(mode, nodeId, contextType, contextName, contextValue, restArgs[5] || '');
            }

            case 'docmem_update_content': {
                requireArgs(restArgs, 1, 'docmem_update_content', '<node_id> [<content>]');
                return await commands.updateContent(restArgs[0], restArgs[1] || '');
            }

            case 'docmem_update_context': {
                requireArgs(restArgs, 4, 'docmem_update_context', '<node_id> <context_type> <context_name> <context_value>');
                const [nodeId, contextType, contextName, contextValue] = restArgs;
                return await commands.updateContext(nodeId, contextType, contextName, contextValue);
            }

            case 'docmem_delete':
                requireArgs(restArgs, 1, 'docmem_delete', '<node_id>');
                return await commands.delete(restArgs[0]);

            case 'docmem_structure':
                requireArgs(restArgs, 1, 'docmem_structure', '<node_id>');
                return await commands.structure(restArgs[0]);

            case 'docmem_search':
                requireArgs(restArgs, 2, 'docmem_search', '<node_id> <pattern> [<mode>]');
                return await commands.search(restArgs[0], restArgs[1], restArgs[2] || 'literal');

            case 'docmem_focus':
                requireArgs(restArgs, 2, 'docmem_focus', '<root_node_id> <node_id>');
                return await commands.focus(restArgs[0], restArgs[1]);

            case 'docmem_add_summary': {
                requireArgs(restArgs, 6, 'docmem_add_summary', '<context_type> <context_name> <context_value> <content> <start_node_id> <end_node_id>');
                const [contextType, contextName, contextValue, content, startNodeId, endNodeId] = restArgs;
                return await commands.addSummary(contextType, contextName, contextValue, content, startNodeId, endNodeId);
            }

            case 'docmem_move_node': {
                requireArgs(restArgs, 3, 'docmem_move_node', '<mode> <node_id> <target_id>');
                const [mode, nodeId, targetId] = restArgs;
                requireMode(mode);
                return await commands.moveNode(mode, nodeId, targetId);
            }

            case 'docmem_copy_node': {
                requireArgs(restArgs, 3, 'docmem_copy_node', '<mode> <node_id> <target_id>');
                const [mode, nodeId, targetId] = restArgs;
                requireMode(mode);
                return await commands.copyNode(mode, nodeId, targetId);
            }

            case 'docmem_get_all_roots':
                return await commands.getAllRoots();

            default:
                return { success: false, result: `Unknown docmem command: ${command}` };
        }
    } catch (error) {
        return { success: false, result: `Error: ${error.message}` };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// System Command Dispatch
// ─────────────────────────────────────────────────────────────────────────────

async function executeSystemCommand(args) {
    const [command] = args;

    try {
        const commands = new SystemCommands();

        switch (command) {
            case 'hello_world':
                return commands.helloWorld();

            default:
                return { success: false, result: `Unknown system command: ${command}` };
        }
    } catch (error) {
        return { success: false, result: `Error: ${error.message}` };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Router Commands (complete, delegate)
// ─────────────────────────────────────────────────────────────────────────────

function routeComplete(restArgs, isRoot) {
    if (isRoot) {
        return { success: false, result: 'Warning: complete is a no-op for the root agent (no parent to return to).' };
    }
    const summary = restArgs.join(' ').replace(/^\n+|\n+$/g, '') || '(no summary provided)';
    return { success: true, result: summary, complete: true, summary };
}

async function routeDelegate(restArgs, parentDocmemId, createRouter, currentApi) {
    if (restArgs.length === 0) {
        return { success: false, result: 'delegate requires a task prompt' };
    }
    const taskPrompt = restArgs.join(' ').replace(/^\n+|\n+$/g, '');

    const childId = 'chat_' + randomString(8);
    const childChat = new DocmemChat(childId);
    await childChat.ready();
    await childChat.createChatSession();

    const childRouter = createRouter(childId, false);
    const initialMessage = formatDelegationMessage(taskPrompt, parentDocmemId);

    const childLoop = new AgentLoop(
        childChat, currentApi, childRouter, KNOWN_COMMANDS,
        truncate(taskPrompt, 80), 100, () => {}, () => {},
        reportModelRequest
    );

    const result = await childLoop.run(initialMessage);
    const summaryText = result.summary || result.finalResponse || '(no result)';
    return { success: true, result: `${childId}: ${summaryText}` };
}

// ─────────────────────────────────────────────────────────────────────────────
// Command Router
// ─────────────────────────────────────────────────────────────────────────────

function createCommandRouter(currentApi, parentDocmemId, isRoot) {
    function router(args, docmem) {
        const [command, ...restArgs] = args;

        if (command === 'complete') {
            return routeComplete(restArgs, isRoot);
        }

        if (command === 'delegate') {
            return routeDelegate(restArgs, parentDocmemId, createRouter, currentApi);
        }

        if (KNOWN_DOCMEM_COMMANDS.has(command)) {
            return executeDocmemCommand(args, docmem);
        }

        if (KNOWN_SYSTEM_COMMANDS.has(command)) {
            return executeSystemCommand(args);
        }

        return { success: false, result: `Unknown command: ${command}. Available: ${[...KNOWN_COMMANDS].sort().join(', ')}` };
    }

    function createRouter(childDocmemId, childIsRoot) {
        return (args, docmem) => createCommandRouter(currentApi, childDocmemId, childIsRoot)(args, docmem);
    }

    return router;
}

// ─────────────────────────────────────────────────────────────────────────────
// Chat Session
// ─────────────────────────────────────────────────────────────────────────────

async function startChatSession() {
    const apiKeyInput = document.getElementById('chat-api-key');
    const modelSelect = document.getElementById('chat-model');
    const chatContainer = document.getElementById('chat-container');
    const chatMessages = document.getElementById('chat-messages');

    const apiKey = apiKeyInput.value.trim();
    const model = modelSelect.value;

    if (!apiKey) {
        showMessage('Please enter an API key', 'error');
        return;
    }
    if (!model) {
        showMessage('Please select a model', 'error');
        return;
    }

    try {
        storeApiKeyAndModel(apiKey, model);
        api = new OpenRouterAPI(apiKey, model);

        chatSession = new DocmemChat(CHAT_DOCMEM_ID);
        await chatSession.ready();
        await chatSession.createChatSession();

        chatContainer.style.display = 'flex';
        chatMessages.value = '';
        document.getElementById('chat-input').focus();
        showMessage('Chat session started', 'success');
    } catch (error) {
        console.error('Error starting chat session:', error);
        showMessage('Error starting chat session: ' + error.message, 'error');
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Send Messages
// ─────────────────────────────────────────────────────────────────────────────

async function runAgentLoop(message) {
    const router = createCommandRouter(api, chatSession.docmemId, true);

    const loop = new AgentLoop(
        chatSession, api, router, KNOWN_COMMANDS,
        truncate(message, 80), 100,
        (msg) => appendToChatDisplay(`\nuser> ${msg}`),
        (msg) => appendToChatDisplay(`\nassistant> ${msg}`),
        reportModelRequest
    );

    return await loop.run(message);
}

async function withProcessingGuard(fn) {
    if (isProcessing) return;
    if (!ensureChatSessionActive()) return;

    isProcessing = true;
    setUIEnabled(false);
    updateStatusLine();

    try {
        await fn();
    } catch (error) {
        console.error('Chat error:', error);
        showMessage('Error: ' + error.message, 'error');
        appendToChatDisplay(`error> ${error.message}`);
    } finally {
        isProcessing = false;
        setUIEnabled(true);
        updateStatusLine();
    }
}

function ensureChatSessionActive() {
    if (!chatSession || !api) {
        showMessage('Please start a chat session first', 'error');
        return false;
    }
    return true;
}

async function sendMessage() {
    const chatInput = document.getElementById('chat-input');
    const message = chatInput.value.trim();
    if (!message) return;

    await withProcessingGuard(async () => {
        chatInput.value = '';
        await runAgentLoop(message);
    });
}

async function sendContinueMessage() {
    await withProcessingGuard(() => runAgentLoop('Please continue.'));
}

// ─────────────────────────────────────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────────────────────────────────────

function initChat() {
    const startBtn = document.getElementById('chat-start-btn');
    const sendBtn = document.getElementById('chat-send-btn');
    const continueBtn = document.getElementById('chat-continue-btn');
    const chatInput = document.getElementById('chat-input');
    const apiKeyInput = document.getElementById('chat-api-key');
    const modelSelect = document.getElementById('chat-model');

    startBtn.addEventListener('click', () => startChatSession());
    sendBtn.addEventListener('click', () => sendMessage());
    continueBtn.addEventListener('click', () => sendContinueMessage());

    keyHandler = new Key(chatInput);
    keyHandler.on('Enter', () => sendMessage(), { shift: false });

    modelSelect.addEventListener('change', () => {
        if (!api) return;

        const apiKey = apiKeyInput.value.trim() || sessionStorage.getItem('chat_api_key');
        const newModel = modelSelect.value;
        if (!apiKey || !newModel) return;

        api = new OpenRouterAPI(apiKey, newModel);
        sessionStorage.setItem('chat_model', newModel);
        showMessage(`Model changed to ${modelSelect.options[modelSelect.selectedIndex].text}`, 'info');
    });

    loadStoredApiKey(apiKeyInput);
    loadStoredModel(modelSelect);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initChat);
} else {
    initChat();
}
