/**
 * Chat - Chat interface logic using DocmemChat
 */
import { OpenRouterAPI } from './OpenRouterAPI.js';
import { parse as parseCommand } from './bash/command_parser.js';
import { DocmemCommands } from './docmem_commands.js';
import { SystemCommands } from './system_commands.js';
import { DocmemChat } from './docmem_chat.js';

let chatSession = null;
let api = null;
let isProcessing = false;

const CHAT_DOCMEM_ID = 'chat_session';

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

    chatInput.addEventListener('keypress', async (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            await sendMessage();
        }
    });

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
                window.showMessage(`Model changed to ${modelLabel}`, 'info');
            }
        }
    });

    // Try to load API key from sessionStorage
    const storedApiKey = sessionStorage.getItem('chat_api_key');
    if (storedApiKey) {
        apiKeyInput.value = storedApiKey;
    }

    // Try to load model from sessionStorage
    const storedModel = sessionStorage.getItem('chat_model');
    if (storedModel) {
        // Check if stored model is in the select options
        const optionExists = Array.from(modelSelect.options).some(opt => opt.value === storedModel);
        if (optionExists) {
            modelSelect.value = storedModel;
        }
    }
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
        window.showMessage('Please enter an API key', 'error');
        return;
    }

    if (!model) {
        window.showMessage('Please select a model', 'error');
        return;
    }

    try {
        // Store API key in sessionStorage
        sessionStorage.setItem('chat_api_key', apiKey);
        // Store model in sessionStorage
        sessionStorage.setItem('chat_model', model);

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

        window.showMessage('Chat session started', 'success');
    } catch (error) {
        console.error('Error starting chat session:', error);
        window.showMessage('Error starting chat session: ' + error.message, 'error');
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

    if (!chatSession || !api) {
        window.showMessage('Please start a chat session first', 'error');
        return;
    }

    isProcessing = true;
    chatInput.disabled = true;
    const sendBtn = document.getElementById('chat-send-btn');
    const continueBtn = document.getElementById('chat-continue-btn');
    sendBtn.disabled = true;
    continueBtn.disabled = true;

    try {
        // Append user message to chat session
        await chatSession.appendUserMessage(message);
        appendToChatDisplay(`user> ${message}`);

        // Clear input
        chatInput.value = '';

        // Build message list for LLM
        const messages = await chatSession.buildMessageList();

        // Call LLM
        const response = await api.chat(messages);

        // Append assistant response to chat session
        await chatSession.appendAssistantMessage(response);
        appendToChatDisplay(`assistant> ${response}`);

        // Process any # Run commands in the response
        await processCommands(response);
    } catch (error) {
        console.error('Error sending message:', error);
        window.showMessage('Error: ' + error.message, 'error');
        appendToChatDisplay(`error> ${error.message}`);
    } finally {
        isProcessing = false;
        chatInput.disabled = false;
        sendBtn.disabled = false;
        continueBtn.disabled = false;
        chatInput.focus();
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

    if (!chatSession || !api) {
        window.showMessage('Please start a chat session first', 'error');
        return;
    }

    const message = 'Please continue.';

    isProcessing = true;
    const chatInput = document.getElementById('chat-input');
    const sendBtn = document.getElementById('chat-send-btn');
    const continueBtn = document.getElementById('chat-continue-btn');
    chatInput.disabled = true;
    sendBtn.disabled = true;
    continueBtn.disabled = true;

    try {
        // Append user message to chat session
        await chatSession.appendUserMessage(message);
        appendToChatDisplay(`user> ${message}`);

        // Build message list for LLM
        const messages = await chatSession.buildMessageList();

        // Call LLM
        const response = await api.chat(messages);

        // Append assistant response to chat session
        await chatSession.appendAssistantMessage(response);
        appendToChatDisplay(`assistant> ${response}`);

        // Process any # Run commands in the response
        await processCommands(response);
    } catch (error) {
        console.error('Error sending continue message:', error);
        window.showMessage('Error: ' + error.message, 'error');
        appendToChatDisplay(`error> ${error.message}`);
    } finally {
        isProcessing = false;
        chatInput.disabled = false;
        sendBtn.disabled = false;
        continueBtn.disabled = false;
        chatInput.focus();
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
                if (restArgs.length < 1) {
                    throw new Error('docmem-create requires <root-id>');
                }
                const rootId = restArgs[0];
                return await commands.create(rootId);
            }
            
            case 'docmem-create-node': {
                if (restArgs.length < 5) {
                    throw new Error('docmem-create-node requires <--append-child|--before|--after> <node_id> <context_type> <context_name> <context_value> [<content>]');
                }
                const mode = restArgs[0];
                if (mode !== '--append-child' && mode !== '--before' && mode !== '--after') {
                    throw new Error('docmem-create-node requires mode to be --append-child, --before, or --after');
                }
                const nodeId = restArgs[1];
                const contextType = restArgs[2];
                const contextName = restArgs[3];
                const contextValue = restArgs[4];
                // Content can be empty - join remaining args (if any) and trim leading/trailing newlines
                // Note: Empty strings are filtered out by the parser, so if content was "", restArgs.length will be 5
                const content = restArgs.length > 5 ? restArgs.slice(5).join(' ').replace(/^\n+|\n+$/g, '') : '';
                return await commands.createNode(mode, nodeId, contextType, contextName, contextValue, content);
            }
            
            case 'docmem-update-content': {
                if (restArgs.length < 1) {
                    throw new Error('docmem-update-content requires <node_id> [<content>]');
                }
                const nodeId = restArgs[0];
                // Content can be empty - join remaining args (if any) and trim leading/trailing newlines
                // Note: Empty strings are filtered out by the parser, so if content was "", restArgs.length will be 1
                const content = restArgs.length > 1 ? restArgs.slice(1).join(' ').replace(/^\n+|\n+$/g, '') : '';
                return await commands.updateContent(nodeId, content);
            }
            
            case 'docmem-update-context': {
                if (restArgs.length < 4) {
                    throw new Error('docmem-update-context requires <node_id> <context_type> <context_name> <context_value>');
                }
                const nodeId = restArgs[0];
                const contextType = restArgs[1];
                const contextName = restArgs[2];
                const contextValue = restArgs[3];
                return await commands.updateContext(nodeId, contextType, contextName, contextValue);
            }
            
            case 'docmem-find': {
                if (restArgs.length < 1) {
                    throw new Error('docmem-find requires <node_id>');
                }
                const nodeId = restArgs[0];
                return commands.find(nodeId);
            }
            
            case 'docmem-delete': {
                if (restArgs.length < 1) {
                    throw new Error('docmem-delete requires <node_id>');
                }
                const nodeId = restArgs[0];
                return commands.delete(nodeId);
            }
            
            case 'docmem-serialize': {
                if (restArgs.length < 1) {
                    throw new Error('docmem-serialize requires <node_id>');
                }
                const nodeId = restArgs[0];
                return commands.serialize(nodeId);
            }
            
            case 'docmem-structure': {
                if (restArgs.length < 1) {
                    throw new Error('docmem-structure requires <node_id>');
                }
                const nodeId = restArgs[0];
                return commands.structure(nodeId);
            }
            
            case 'docmem-expand-to-length': {
                if (restArgs.length < 2) {
                    throw new Error('docmem-expand-to-length requires <node_id> <maxTokens>');
                }
                const nodeId = restArgs[0];
                const maxTokensArg = restArgs[1];
                return commands.expandToLength(nodeId, maxTokensArg);
            }
            
            case 'docmem-add-summary': {
                if (restArgs.length < 6) {
                    throw new Error('docmem-add-summary requires <context_type> <context_name> <context_value> <content> <start-node-id> <end-node-id>');
                }
                // Format: context_type context_name context_value content start_node_id end_node_id
                const contextType = restArgs[0];
                const contextName = restArgs[1];
                const contextValue = restArgs[2];
                const content = restArgs[3];
                const startNodeId = restArgs[4];
                const endNodeId = restArgs[5];
                return await commands.addSummary(contextType, contextName, contextValue, content, startNodeId, endNodeId);
            }
            
            case 'docmem-move-node': {
                if (restArgs.length < 3) {
                    throw new Error('docmem-move-node requires <--append-child|--before|--after> <node_id> <target_id>');
                }
                const mode = restArgs[0];
                if (mode !== '--append-child' && mode !== '--before' && mode !== '--after') {
                    throw new Error('docmem-move-node requires mode to be --append-child, --before, or --after');
                }
                const nodeId = restArgs[1];
                const targetId = restArgs[2];
                return await commands.moveNode(mode, nodeId, targetId);
            }
            
            case 'docmem-copy-node': {
                if (restArgs.length < 3) {
                    throw new Error('docmem-copy-node requires <--append-child|--before|--after> <node_id> <target_id>');
                }
                const mode = restArgs[0];
                if (mode !== '--append-child' && mode !== '--before' && mode !== '--after') {
                    throw new Error('docmem-copy-node requires mode to be --append-child, --before, or --after');
                }
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
            if (result.success) {
                if (commandOutputText) {
                    commandOutputText += '\n';
                }
                commandOutputText += `command> ${commandText}\nresult> ${result.result}`;
            } else {
                if (commandOutputText) {
                    commandOutputText += '\n';
                }
                commandOutputText += `command> ${commandText}\nerror> ${result.result}`;
            }
        } catch (error) {
            const errorMessage = `Parse error: ${error.message}`;
            results.push({
                command: commandText,
                result: errorMessage,
                success: false
            });
            // Build command output text for user message
            if (commandOutputText) {
                commandOutputText += '\n';
            }
            commandOutputText += `command> ${commandText}\nerror> ${errorMessage}`;
        }
    }
    
    // If we have command output, append it as a user message
    if (commandOutputText) {
        // Append command output as user message
        await chatSession.appendUserMessage(commandOutputText);
        appendToChatDisplay(`user> ${commandOutputText}`);
        
        // Only invoke the model again if we haven't exceeded the depth limit (max 1000000 rounds)
        if (depth < 1000000) {
            // Build message list for LLM
            const messages = await chatSession.buildMessageList();
            
            // Call LLM again
            const response = await api.chat(messages);
            
            // Append assistant response to chat session
            chatSession.appendAssistantMessage(response);
            appendToChatDisplay(`assistant> ${response}`);
            
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

