/**
 * Chat - Chat interface logic using DocmemChat
 */
import { OpenRouterAPI } from './OpenRouterAPI.js';
import { parse as parseCommand } from './bash/command_parser.js';
import { DocmemCommands } from './docmem_commands.js';
import { SystemCommands } from './system_commands.js';

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
    const modelInput = document.getElementById('chat-model');

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

    // Try to load API key from sessionStorage
    const storedApiKey = sessionStorage.getItem('chat_api_key');
    if (storedApiKey) {
        apiKeyInput.value = storedApiKey;
    }
}

/**
 * Fetch system text from fai_bash_root.txt
 */
async function fetchSystemText() {
    try {
        const response = await fetch('/static/fai_bash_root.txt');
        if (response.ok) {
            return await response.text();
        } else {
            console.warn('Could not load fai_bash_root.txt, proceeding without system text');
            return '';
        }
    } catch (error) {
        console.warn('Error loading fai_bash_root.txt:', error);
        return '';
    }
}

/**
 * Start a new chat session
 */
async function startChatSession() {
    const apiKeyInput = document.getElementById('chat-api-key');
    const modelInput = document.getElementById('chat-model');
    const chatContainer = document.getElementById('chat-container');
    const chatMessages = document.getElementById('chat-messages');

    const apiKey = apiKeyInput.value.trim();
    const model = modelInput.value.trim() || 'anthropic/claude-haiku-4.5';

    if (!apiKey) {
        window.showMessage('Please enter an API key', 'error');
        return;
    }

    if (!model) {
        window.showMessage('Please enter a model', 'error');
        return;
    }

    try {
        // Store API key in sessionStorage
        sessionStorage.setItem('chat_api_key', apiKey);

        // Initialize API
        api = new OpenRouterAPI(apiKey, model);

        // Fetch system text from fai_bash_root.txt
        const systemText = await fetchSystemText();

        // Create chat session
        chatSession = new DocmemChat(CHAT_DOCMEM_ID);
        await chatSession.ready();
        await chatSession.createChatSession(systemText);

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
        chatSession.appendUserMessage(message);
        appendToChatDisplay(`user> ${message}`);

        // Clear input
        chatInput.value = '';

        // Build message list for LLM
        const messages = chatSession.buildMessageList();

        // Call LLM
        const response = await api.chat(messages);

        // Append assistant response to chat session
        chatSession.appendAssistantMessage(response);
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
        chatSession.appendUserMessage(message);
        appendToChatDisplay(`user> ${message}`);

        // Build message list for LLM
        const messages = chatSession.buildMessageList();

        // Call LLM
        const response = await api.chat(messages);

        // Append assistant response to chat session
        chatSession.appendAssistantMessage(response);
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
            
            case 'docmem-append-child': {
                if (restArgs.length < 4) {
                    throw new Error('docmem-append-child requires <node_id> <context_type> <context_name> <context_value> [<content>]');
                }
                const nodeId = restArgs[0];
                const contextType = restArgs[1];
                const contextName = restArgs[2];
                const contextValue = restArgs[3];
                // Content can be empty - join remaining args (if any) and trim leading/trailing newlines
                // Note: Empty strings are filtered out by the parser, so if content was "", restArgs.length will be 4
                const content = restArgs.length > 4 ? restArgs.slice(4).join(' ').replace(/^\n+|\n+$/g, '') : '';
                return commands.appendChild(nodeId, contextType, contextName, contextValue, content);
            }
            
            case 'docmem-insert-before': {
                if (restArgs.length < 4) {
                    throw new Error('docmem-insert-before requires <node_id> <context_type> <context_name> <context_value> [<content>]');
                }
                const nodeId = restArgs[0];
                const contextType = restArgs[1];
                const contextName = restArgs[2];
                const contextValue = restArgs[3];
                // Content can be empty - join remaining args (if any) and trim leading/trailing newlines
                // Note: Empty strings are filtered out by the parser, so if content was "", restArgs.length will be 4
                const content = restArgs.length > 4 ? restArgs.slice(4).join(' ').replace(/^\n+|\n+$/g, '') : '';
                return commands.insertBefore(nodeId, contextType, contextName, contextValue, content);
            }
            
            case 'docmem-insert-after': {
                if (restArgs.length < 4) {
                    throw new Error('docmem-insert-after requires <node_id> <context_type> <context_name> <context_value> [<content>]');
                }
                const nodeId = restArgs[0];
                const contextType = restArgs[1];
                const contextName = restArgs[2];
                const contextValue = restArgs[3];
                // Content can be empty - join remaining args (if any) and trim leading/trailing newlines
                // Note: Empty strings are filtered out by the parser, so if content was "", restArgs.length will be 4
                const content = restArgs.length > 4 ? restArgs.slice(4).join(' ').replace(/^\n+|\n+$/g, '') : '';
                return commands.insertAfter(nodeId, contextType, contextName, contextValue, content);
            }
            
            case 'docmem-update-content': {
                if (restArgs.length < 1) {
                    throw new Error('docmem-update-content requires <node_id> [<content>]');
                }
                const nodeId = restArgs[0];
                // Content can be empty - join remaining args (if any) and trim leading/trailing newlines
                // Note: Empty strings are filtered out by the parser, so if content was "", restArgs.length will be 1
                const content = restArgs.length > 1 ? restArgs.slice(1).join(' ').replace(/^\n+|\n+$/g, '') : '';
                return commands.updateContent(nodeId, content);
            }
            
            case 'docmem-update-context': {
                if (restArgs.length < 4) {
                    throw new Error('docmem-update-context requires <node_id> <context_type> <context_name> <context_value>');
                }
                const nodeId = restArgs[0];
                const contextType = restArgs[1];
                const contextName = restArgs[2];
                const contextValue = restArgs[3];
                return commands.updateContext(nodeId, contextType, contextName, contextValue);
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
                if (restArgs.length < 5) {
                    throw new Error('docmem-add-summary requires <context_type> <context_name> <context_value> <content> [<node_ids>...]');
                }
                // Format: context_type context_name context_value content node_id1 node_id2 ...
                const contextType = restArgs[0];
                const contextName = restArgs[1];
                const contextValue = restArgs[2];
                // Content is everything until we hit what looks like a node_id (typically 8 chars, but can vary)
                // Node IDs come after content. We'll take first 3 as context, rest split between content and node_ids
                // Simplest: content is arg[3], node_ids are the rest
                const content = restArgs[3];
                const nodeIds = restArgs.slice(4);
                return commands.addSummary(contextType, contextName, contextValue, content, nodeIds);
            }
            
            case 'docmem-move-append-child': {
                if (restArgs.length < 2) {
                    throw new Error('docmem-move-append-child requires <node_id> <target_parent_id>');
                }
                const nodeId = restArgs[0];
                const targetParentId = restArgs[1];
                return commands.moveAppendChild(nodeId, targetParentId);
            }
            
            case 'docmem-move-before': {
                if (restArgs.length < 2) {
                    throw new Error('docmem-move-before requires <node_id> <target_node_id>');
                }
                const nodeId = restArgs[0];
                const targetNodeId = restArgs[1];
                return commands.moveBefore(nodeId, targetNodeId);
            }
            
            case 'docmem-move-after': {
                if (restArgs.length < 2) {
                    throw new Error('docmem-move-after requires <node_id> <target_node_id>');
                }
                const nodeId = restArgs[0];
                const targetNodeId = restArgs[1];
                return commands.moveAfter(nodeId, targetNodeId);
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
 * @param {number} depth - Current recursion depth (max 3 rounds)
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
        chatSession.appendUserMessage(commandOutputText);
        appendToChatDisplay(`user> ${commandOutputText}`);
        
        // Only invoke the model again if we haven't exceeded the depth limit (max 3 rounds)
        if (depth < 3) {
            // Build message list for LLM
            const messages = chatSession.buildMessageList();
            
            // Call LLM again
            const response = await api.chat(messages);
            
            // Append assistant response to chat session
            chatSession.appendAssistantMessage(response);
            appendToChatDisplay(`assistant> ${response}`);
            
            // Process any new # Run commands in the response (recursive, increment depth)
            await processCommands(response, depth + 1);
        } else {
            appendToChatDisplay(`info> Maximum command processing depth (3 rounds) reached. Command outputs have been recorded but will not trigger automatic model response.`);
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

