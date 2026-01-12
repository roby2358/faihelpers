/**
 * Chat - Chat interface logic using DocmemChat
 */
import { OpenRouterAPI } from './OpenRouterAPI.js';
import { parse as parseCommand } from './bash/command_parser.js';
import { DocmemCommands } from './docmem_commands.js';
import { SystemCommands } from './system_commands.js';
import { DocmemChat } from './docmem_chat.js';
import { showMessage } from './index.js';
import { Key } from './key.js';

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
 * Record user message to chat session and display
 */
async function recordUserMessage(message) {
    await chatSession.appendUserMessage(message);
    appendToChatDisplay(`user> ${message}`);
}

/**
 * Record assistant message to chat session and display
 */
async function recordAssistantMessage(response) {
    await chatSession.appendAssistantMessage(response);
    appendToChatDisplay(`assistant> ${response}`);
}

/**
 * Invoke model and record response
 */
async function invokeModelAndRecordResponse() {
    const messages = await chatSession.buildMessageList();
    const response = await api.chat(messages, 0.7, 2000);
    await recordAssistantMessage(response);
    return response;
}

/**
 * Append command output to command output text
 */
function appendCommandOutput(commandOutputText, commandText, outputType, outputMessage) {
    const separator = commandOutputText ? '\n' : '';
    return commandOutputText + separator + `command> ${commandText}\n${outputType}> ${outputMessage}`;
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
        // Record user message
        await recordUserMessage(message);

        // Clear input
        chatInput.value = '';

        // Invoke model and record response
        const response = await invokeModelAndRecordResponse();

        // Process any # Run commands in the response
        await processCommands(response);
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
 * Appends "Please continue." as a user message and sends the context window to the LLM
 */
async function sendContinueMessage() {
    if (isProcessing) {
        return;
    }

    if (!ensureChatSessionActive()) {
        return;
    }

    const message = 'Please continue.';

    isProcessing = true;
    setUIEnabled(false);

    try {
        // Record user message
        await recordUserMessage(message);

        // Invoke model and record response
        const response = await invokeModelAndRecordResponse();

        // Process any # Run commands in the response
        await processCommands(response);
    } catch (error) {
        console.error('Error sending continue message:', error);
        showMessage('Error: ' + error.message, 'error');
        appendToChatDisplay(`error> ${error.message}`);
    } finally {
        isProcessing = false;
        setUIEnabled(true);
    }
}

/**
 * Extract # Run sections from text and return array of bash commands
 */
function extractRunSections(text) {
    const commands = [];
    // Match # Run heading followed by ```bash ... ```
    const runSectionPattern = /#\s+Run\s*\n```bash\s*\n([\s\S]*?)```/gi;
    
    let match;
    while ((match = runSectionPattern.exec(text)) !== null) {
        const commandText = match[1].trim();
        if (commandText) {
            commands.push(commandText);
        }
    }
    
    return commands;
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
                return commands.find(nodeId);
            }
            
            case 'docmem-delete': {
                requireArgs(restArgs, 1, 'docmem-delete', '<node_id>');
                const nodeId = restArgs[0];
                return commands.delete(nodeId);
            }
            
            case 'docmem-serialize': {
                requireArgs(restArgs, 1, 'docmem-serialize', '<node_id>');
                const nodeId = restArgs[0];
                return commands.serialize(nodeId);
            }
            
            case 'docmem-structure': {
                requireArgs(restArgs, 1, 'docmem-structure', '<node_id>');
                const nodeId = restArgs[0];
                return commands.structure(nodeId);
            }
            
            case 'docmem-expand-to-length': {
                requireArgs(restArgs, 2, 'docmem-expand-to-length', '<node_id> <maxTokens>');
                const nodeId = restArgs[0];
                const maxTokensArg = restArgs[1];
                return commands.expandToLength(nodeId, maxTokensArg);
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
                return commands.getAllRoots();
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
 * Execute a parsed command (routes to appropriate handler based on prefix)
 */
async function executeCommand(args, docmem) {
    if (!args || args.length === 0) {
        throw new Error('Empty command');
    }
    
    const command = args[0];
    
    if (command.startsWith('docmem-')) {
        return await executeDocmemCommand(args, docmem);
    } else {
        return await executeSystemCommand(args);
    }
}

/**
 * Process commands from assistant response
 * @param {string} responseText - The assistant response text to extract commands from
 * @param {number} depth - Current recursion depth (max 1000000 rounds)
 */
async function processCommands(responseText, depth = 0) {
    const commands = extractRunSections(responseText);
    if (commands.length === 0) {
        return;
    }
    
    const results = [];
    const docmem = chatSession.docmem; // Access underlying docmem from DocmemChat
    
    // Build command output text
    let commandOutputText = '';
    
    for (const commandText of commands) {
        try {
            // Parse the command using PEG parser
            const args = parseCommand(commandText);
            
            if (args.length === 0) {
                continue;
            }
            
            // Execute the command
            const result = await executeCommand(args, docmem);
            
            results.push({
                command: commandText,
                result: result.result,
                success: result.success
            });
            
            // Build command output text for user message
            const outputType = result.success ? 'result' : 'error';
            commandOutputText = appendCommandOutput(commandOutputText, commandText, outputType, result.result);
        } catch (error) {
            const errorMessage = `Parse error: ${error.message}`;
            results.push({
                command: commandText,
                result: errorMessage,
                success: false
            });
            // Build command output text for user message
            commandOutputText = appendCommandOutput(commandOutputText, commandText, 'error', errorMessage);
        }
    }
    
    // If we have command output, append it as a user message
    if (commandOutputText) {
        // Record command output as user message
        await recordUserMessage(commandOutputText);
        
        // Only invoke the model again if we haven't exceeded the depth limit (max 1000000 rounds)
        if (depth < 1000000) {
            // Invoke model and record response
            const response = await invokeModelAndRecordResponse();
            
            // Process any new # Run commands in the response (recursive, increment depth)
            await processCommands(response, depth + 1);
        } else {
            appendToChatDisplay(`info> Maximum command processing depth (1000000 rounds) reached. Command outputs have been recorded but will not trigger automatic model response.`);
        }
    }
    
    return results;
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

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initChat);
} else {
    initChat();
}

