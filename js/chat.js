/**
 * Chat - Chat interface logic using AgentLoop and DocmemChat
 */
import { OpenRouterAPI } from './OpenRouterAPI.js';
import { DocmemCommands } from './docmem_tools/docmem_commands.js';
import { SystemCommands } from './system_tools/system_commands.js';
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

/**
 * Enable or disable UI controls
 */
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

/**
 * Ensure chat session is active
 */
function ensureChatSessionActive() {
    if (!chatSession || !api) {
        showMessage('Please start a chat session first', 'error');
        return false;
    }
    return true;
}

/**
 * Append text to the chat display area
 */
function appendToChatDisplay(text) {
    const chatMessages = document.getElementById('chat-messages');
    if (chatMessages.value) {
        chatMessages.value += '\n' + text;
    } else {
        chatMessages.value = text;
    }
    // Scroll to bottom
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

/**
 * Validate node position mode
 */
function validateNodePositionMode(mode) {
    if (mode !== '--append-child' && mode !== '--before' && mode !== '--after') {
        throw new Error('Mode must be --append-child, --before, or --after');
    }
}

/**
 * Extract optional content from remaining arguments
 */
function extractOptionalContent(restArgs, startIndex) {
    return restArgs.length > startIndex
        ? restArgs.slice(startIndex).join(' ').replace(/^\n+|\n+$/g, '')
        : '';
}

/**
 * Load stored API key from sessionStorage
 */
function loadStoredApiKey(apiKeyInput) {
    const storedApiKey = sessionStorage.getItem('chat_api_key');
    if (storedApiKey) {
        apiKeyInput.value = storedApiKey;
    }
}

/**
 * Load stored model from sessionStorage
 */
function loadStoredModel(modelSelect) {
    const storedModel = sessionStorage.getItem('chat_model');
    if (storedModel) {
        const optionExists = Array.from(modelSelect.options).some(opt => opt.value === storedModel);
        if (optionExists) {
            modelSelect.value = storedModel;
        }
    }
}

/**
 * Store API key and model to sessionStorage
 */
function storeApiKeyAndModel(apiKey, model) {
    sessionStorage.setItem('chat_api_key', apiKey);
    sessionStorage.setItem('chat_model', model);
}

/**
 * Require minimum number of arguments for a command
 */
function requireArgs(restArgs, minCount, commandName, usage) {
    if (restArgs.length < minCount) {
        throw new Error(`${commandName} requires ${usage}`);
    }
}

/**
 * Execute a parsed docmem command
 */
async function executeDocmemCommand(args, docmem) {
    if (!args || args.length === 0) {
        throw new Error('Empty command');
    }

    const command = args[0];
    const restArgs = args.slice(1);

    // Commands that don't require a docmem instance
    const staticCommands = ['docmem-get-all-roots', 'docmem-create'];
    const needsDocmem = !staticCommands.includes(command);

    if (needsDocmem && !docmem) {
        throw new Error(`Command ${command} requires an active docmem instance`);
    }

    try {
        const commands = new DocmemCommands(docmem);

        switch (command) {
            case 'docmem-create': {
                requireArgs(restArgs, 1, 'docmem-create', '<root-id>');
                const rootId = restArgs[0];
                return await commands.create(rootId);
            }

            case 'docmem-create-node': {
                requireArgs(restArgs, 5, 'docmem-create-node', '<--append-child|--before|--after> <node_id> <context_type> <context_name> <context_value> [<content>]');
                const mode = restArgs[0];
                validateNodePositionMode(mode);
                const nodeId = restArgs[1];
                const contextType = restArgs[2];
                const contextName = restArgs[3];
                const contextValue = restArgs[4];
                const content = extractOptionalContent(restArgs, 5);
                return await commands.createNode(mode, nodeId, contextType, contextName, contextValue, content);
            }

            case 'docmem-update-content': {
                requireArgs(restArgs, 1, 'docmem-update-content', '<node_id> [<content>]');
                const nodeId = restArgs[0];
                const content = extractOptionalContent(restArgs, 1);
                return await commands.updateContent(nodeId, content);
            }

            case 'docmem-update-context': {
                requireArgs(restArgs, 4, 'docmem-update-context', '<node_id> <context_type> <context_name> <context_value>');
                const nodeId = restArgs[0];
                const contextType = restArgs[1];
                const contextName = restArgs[2];
                const contextValue = restArgs[3];
                return await commands.updateContext(nodeId, contextType, contextName, contextValue);
            }

            case 'docmem-find': {
                requireArgs(restArgs, 1, 'docmem-find', '<node_id>');
                const nodeId = restArgs[0];
                return await commands.find(nodeId);
            }

            case 'docmem-delete': {
                requireArgs(restArgs, 1, 'docmem-delete', '<node_id>');
                const nodeId = restArgs[0];
                return await commands.delete(nodeId);
            }

            case 'docmem-serialize': {
                requireArgs(restArgs, 1, 'docmem-serialize', '<node_id>');
                const nodeId = restArgs[0];
                return await commands.serialize(nodeId);
            }

            case 'docmem-structure': {
                requireArgs(restArgs, 1, 'docmem-structure', '<node_id>');
                const nodeId = restArgs[0];
                return await commands.structure(nodeId);
            }

            case 'docmem-expand-to-length': {
                requireArgs(restArgs, 2, 'docmem-expand-to-length', '<node_id> <maxTokens>');
                const nodeId = restArgs[0];
                const maxTokensArg = restArgs[1];
                return await commands.expandToLength(nodeId, maxTokensArg);
            }

            case 'docmem-add-summary': {
                requireArgs(restArgs, 6, 'docmem-add-summary', '<context_type> <context_name> <context_value> <content> <start-node-id> <end-node-id>');
                const contextType = restArgs[0];
                const contextName = restArgs[1];
                const contextValue = restArgs[2];
                const content = restArgs[3];
                const startNodeId = restArgs[4];
                const endNodeId = restArgs[5];
                return await commands.addSummary(contextType, contextName, contextValue, content, startNodeId, endNodeId);
            }

            case 'docmem-move-node': {
                requireArgs(restArgs, 3, 'docmem-move-node', '<--append-child|--before|--after> <node_id> <target_id>');
                const mode = restArgs[0];
                validateNodePositionMode(mode);
                const nodeId = restArgs[1];
                const targetId = restArgs[2];
                return await commands.moveNode(mode, nodeId, targetId);
            }

            case 'docmem-copy-node': {
                requireArgs(restArgs, 3, 'docmem-copy-node', '<--append-child|--before|--after> <node_id> <target_id>');
                const mode = restArgs[0];
                validateNodePositionMode(mode);
                const nodeId = restArgs[1];
                const targetId = restArgs[2];
                return await commands.copyNode(mode, nodeId, targetId);
            }

            case 'docmem-get-all-roots': {
                return await commands.getAllRoots();
            }

            default:
                return { success: false, result: `Unknown command: ${command}` };
        }
    } catch (error) {
        return { success: false, result: `Error: ${error.message}` };
    }
}

/**
 * Execute a parsed system command
 */
async function executeSystemCommand(args) {
    if (!args || args.length === 0) {
        throw new Error('Empty command');
    }

    const command = args[0];
    const restArgs = args.slice(1);

    try {
        const commands = new SystemCommands();

        switch (command) {
            case 'hello-world': {
                return commands.helloWorld();
            }

            default:
                return { success: false, result: `Unknown system command: ${command}` };
        }
    } catch (error) {
        return { success: false, result: `Error: ${error.message}` };
    }
}

/**
 * Create a command router factory.
 * Returns a function (parentDocmemId, isRoot) => router,
 * where router is async (args, docmem) => { success, result, complete?, summary? }
 */
function createCommandRouterFactory(currentApi) {
    function createRouter(parentDocmemId, isRoot) {
        return async function router(args, docmem) {
            const command = args[0];
            const restArgs = args.slice(1);

            if (command === 'complete') {
                if (isRoot) {
                    return { success: false, result: 'Warning: complete command is a no-op for the root agent (no parent to return to).' };
                }
                const summary = restArgs.join(' ').replace(/^\n+|\n+$/g, '') || '(no summary provided)';
                return { success: true, result: summary, complete: true, summary };
            }

            if (command === 'delegate') {
                if (restArgs.length === 0) {
                    return { success: false, result: 'delegate requires a task prompt' };
                }
                const taskPrompt = restArgs.join(' ').replace(/^\n+|\n+$/g, '');

                try {
                    // Create child chat docmem
                    const childId = 'chat_' + randomString(8);
                    const childChat = new DocmemChat(childId);
                    await childChat.ready();
                    await childChat.createChatSession();

                    // Create child router (recursive — child can delegate too)
                    const childRouter = createRouter(childId, false);

                    // Build initial message with delegation context
                    const initialMessage = formatDelegationMessage(taskPrompt, parentDocmemId);
                    const summaryLine = taskPrompt.length > 80
                        ? taskPrompt.slice(0, 77) + '...'
                        : taskPrompt;
                    const childLoop = new AgentLoop({
                        chatSession: childChat,
                        api: currentApi,
                        commandRouter: childRouter,
                        summaryLine,
                        maxDepth: 100
                    });

                    const result = await childLoop.run(initialMessage);

                    const summaryText = result.summary || result.finalResponse || '(no result)';
                    return { success: true, result: `${childId}: ${summaryText}` };
                } catch (error) {
                    return { success: false, result: `Delegation error: ${error.message}` };
                }
            }

            if (command.startsWith('docmem-')) {
                return await executeDocmemCommand(args, docmem);
            }

            return await executeSystemCommand(args);
        };
    }

    return createRouter;
}

/**
 * Initialize chat interface
 */
function initChat() {
    const startBtn = document.getElementById('chat-start-btn');
    const sendBtn = document.getElementById('chat-send-btn');
    const continueBtn = document.getElementById('chat-continue-btn');
    const chatInput = document.getElementById('chat-input');
    const apiKeyInput = document.getElementById('chat-api-key');
    const modelSelect = document.getElementById('chat-model');

    startBtn.addEventListener('click', async () => {
        await startChatSession();
    });

    sendBtn.addEventListener('click', async () => {
        await sendMessage();
    });

    continueBtn.addEventListener('click', async () => {
        await sendContinueMessage();
    });

    keyHandler = new Key(chatInput);
    keyHandler.on('Enter', async () => {
        await sendMessage();
    }, { shift: false });

    // Handle model selection change - update API instance if chat is active
    modelSelect.addEventListener('change', () => {
        if (api) {
            // Chat session is active, update the API instance with new model
            const apiKey = apiKeyInput.value.trim() || sessionStorage.getItem('chat_api_key');
            const newModel = modelSelect.value;

            if (apiKey && newModel) {
                api = new OpenRouterAPI(apiKey, newModel);
                sessionStorage.setItem('chat_model', newModel);
                const modelLabel = modelSelect.options[modelSelect.selectedIndex].text;
                showMessage(`Model changed to ${modelLabel}`, 'info');
            }
        }
    });

    // Try to load API key and model from sessionStorage
    loadStoredApiKey(apiKeyInput);
    loadStoredModel(modelSelect);
}

/**
 * Start a new chat session
 */
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
        // Store API key and model in sessionStorage
        storeApiKeyAndModel(apiKey, model);

        // Initialize API
        api = new OpenRouterAPI(apiKey, model);

        // Create chat session (system messages are handled in buildMessageList)
        chatSession = new DocmemChat(CHAT_DOCMEM_ID);
        await chatSession.ready();
        await chatSession.createChatSession();

        // Show chat interface
        chatContainer.style.display = 'flex';
        chatMessages.value = '';
        const chatInput = document.getElementById('chat-input');
        chatInput.focus();

        showMessage('Chat session started', 'success');
    } catch (error) {
        console.error('Error starting chat session:', error);
        showMessage('Error starting chat session: ' + error.message, 'error');
    }
}

/**
 * Run a message through the agent loop
 */
async function runAgentLoop(message) {
    const routerFactory = createCommandRouterFactory(api);
    const router = routerFactory(chatSession.docmemId, true);

    const summaryLine = message.length > 80
        ? message.slice(0, 77) + '...'
        : message;
    const loop = new AgentLoop({
        chatSession,
        api,
        commandRouter: router,
        summaryLine,
        maxDepth: 100,
        onUserMessage: (msg) => appendToChatDisplay(`\nuser> ${msg}`),
        onAssistantMessage: (msg) => appendToChatDisplay(`\nassistant> ${msg}`)
    });

    return await loop.run(message);
}

/**
 * Send a message to the LLM
 */
async function sendMessage() {
    if (isProcessing) {
        return;
    }

    const chatInput = document.getElementById('chat-input');
    const message = chatInput.value.trim();

    if (!message) {
        return;
    }

    if (!ensureChatSessionActive()) {
        return;
    }

    isProcessing = true;
    setUIEnabled(false);

    try {
        // Clear input
        chatInput.value = '';

        await runAgentLoop(message);
    } catch (error) {
        console.error('Error sending message:', error);
        showMessage('Error: ' + error.message, 'error');
        appendToChatDisplay(`error> ${error.message}`);
    } finally {
        isProcessing = false;
        setUIEnabled(true);
    }
}

/**
 * Send a continue message to the LLM
 */
async function sendContinueMessage() {
    if (isProcessing) {
        return;
    }

    if (!ensureChatSessionActive()) {
        return;
    }

    isProcessing = true;
    setUIEnabled(false);

    try {
        await runAgentLoop('Please continue.');
    } catch (error) {
        console.error('Error sending continue message:', error);
        showMessage('Error: ' + error.message, 'error');
        appendToChatDisplay(`error> ${error.message}`);
    } finally {
        isProcessing = false;
        setUIEnabled(true);
    }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initChat);
} else {
    initChat();
}
