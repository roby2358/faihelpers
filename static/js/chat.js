/**
 * Chat - Chat interface logic using DocmemChat
 */
import { OpenRouterAPI } from './OpenRouterAPI.js';
import { parse as parseCommand } from './command_parser.js';

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
    const chatInput = document.getElementById('chat-input');
    const apiKeyInput = document.getElementById('chat-api-key');
    const modelInput = document.getElementById('chat-model');

    startBtn.addEventListener('click', async () => {
        await startChatSession();
    });

    sendBtn.addEventListener('click', async () => {
        await sendMessage();
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
    sendBtn.disabled = true;

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
    const staticCommands = ['Docmem.getAllRoots', 'docmem-create'];
    const needsDocmem = !staticCommands.includes(command);
    
    if (needsDocmem && !docmem) {
        throw new Error(`Command ${command} requires an active docmem instance`);
    }
    
    try {
        switch (command) {
            case 'docmem-create': {
                if (restArgs.length < 1) {
                    throw new Error('docmem-create requires <root-id>');
                }
                const rootId = restArgs[0];
                // Docmem is created automatically when instantiated
                const newDocmem = new Docmem(rootId);
                await newDocmem.ready();
                return { success: true, result: `Created docmem: ${rootId}` };
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
                
                // Validate context fields are non-empty
                if (!contextType || !contextType.trim()) {
                    throw new Error('context_type must be non-empty');
                }
                if (!contextName || !contextName.trim()) {
                    throw new Error('context_name must be non-empty');
                }
                if (!contextValue || !contextValue.trim()) {
                    throw new Error('context_value must be non-empty');
                }
                
                const node = docmem.append_child(nodeId, contextType.trim(), contextName.trim(), contextValue.trim(), content);
                return { success: true, result: `Appended child node: ${node.id}` };
            }
            
            case 'docmem-insert-between': {
                if (restArgs.length < 5) {
                    throw new Error('docmem-insert-between requires <node_id_1> <node_id_2> <context_type> <context_name> <context_value> [<content>]');
                }
                const nodeId1 = restArgs[0];
                const nodeId2 = restArgs[1];
                const contextType = restArgs[2];
                const contextName = restArgs[3];
                const contextValue = restArgs[4];
                // Content can be empty - join remaining args (if any) and trim leading/trailing newlines
                // Note: Empty strings are filtered out by the parser, so if content was "", restArgs.length will be 5
                const content = restArgs.length > 5 ? restArgs.slice(5).join(' ').replace(/^\n+|\n+$/g, '') : '';
                
                // Validate context fields are non-empty
                if (!contextType || !contextType.trim()) {
                    throw new Error('context_type must be non-empty');
                }
                if (!contextName || !contextName.trim()) {
                    throw new Error('context_name must be non-empty');
                }
                if (!contextValue || !contextValue.trim()) {
                    throw new Error('context_value must be non-empty');
                }
                
                const node = docmem.insert_between(nodeId1, nodeId2, contextType.trim(), contextName.trim(), contextValue.trim(), content);
                return { success: true, result: `Inserted node: ${node.id}` };
            }
            
            case 'docmem-update-content': {
                if (restArgs.length < 1) {
                    throw new Error('docmem-update-content requires <node_id> [<content>]');
                }
                const nodeId = restArgs[0];
                // Content can be empty - join remaining args (if any) and trim leading/trailing newlines
                // Note: Empty strings are filtered out by the parser, so if content was "", restArgs.length will be 1
                const content = restArgs.length > 1 ? restArgs.slice(1).join(' ').replace(/^\n+|\n+$/g, '') : '';
                const node = docmem.update_content(nodeId, content);
                return { success: true, result: `Updated node: ${node.id}` };
            }
            
            case 'docmem-find': {
                if (restArgs.length < 1) {
                    throw new Error('docmem-find requires <node_id>');
                }
                const nodeId = restArgs[0];
                const node = docmem.find(nodeId);
                if (!node) {
                    return { success: false, result: `Node not found: ${nodeId}` };
                }
                return { success: true, result: JSON.stringify(node.toDict(), null, 2) };
            }
            
            case 'docmem-delete': {
                if (restArgs.length < 1) {
                    throw new Error('docmem-delete requires <node_id>');
                }
                const nodeId = restArgs[0];
                docmem.delete(nodeId);
                return { success: true, result: `Deleted node: ${nodeId}` };
            }
            
            case 'docmem.serialize': {
                // Note: serialize() works on the root of the docmem instance
                // If node_id is provided in args, we ignore it for now (current impl doesn't support subtree serialization)
                const nodes = docmem.serialize();
                return { success: true, result: JSON.stringify(nodes.map(n => n.toDict()), null, 2) };
            }
            
            case 'docmem.expandToLength': {
                if (restArgs.length < 2) {
                    throw new Error('docmem.expandToLength requires <node_id> <maxTokens>');
                }
                const nodeId = restArgs[0];
                const maxTokensArg = restArgs[1];
                const maxTokens = parseInt(maxTokensArg, 10);
                if (isNaN(maxTokens)) {
                    throw new Error(`maxTokens must be a number, got: ${maxTokensArg}`);
                }
                const nodes = docmem.expandToLength(nodeId, maxTokens);
                return { success: true, result: JSON.stringify(nodes.map(n => n.toDict()), null, 2) };
            }
            
            case 'docmem.add_summary': {
                if (restArgs.length < 5) {
                    throw new Error('docmem.add_summary requires <context_type> <context_name> <context_value> <content> [<node_ids>...]');
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
                if (nodeIds.length === 0) {
                    throw new Error('docmem.add_summary requires at least one node_id');
                }
                const node = docmem.add_summary(nodeIds, content, contextType, contextName, contextValue);
                return { success: true, result: `Added summary node: ${node.id}` };
            }
            
            case 'Docmem.getAllRoots': {
                const roots = Docmem.getAllRoots();
                return { success: true, result: JSON.stringify(roots, null, 2) };
            }
            
            default:
                return { success: false, result: `Unknown command: ${command}` };
        }
    } catch (error) {
        return { success: false, result: `Error: ${error.message}` };
    }
}

/**
 * Process commands from assistant response
 */
async function processCommands(responseText) {
    const commands = extractRunSections(responseText);
    if (commands.length === 0) {
        return;
    }
    
    const results = [];
    const docmem = chatSession.docmem; // Access underlying docmem from DocmemChat
    
    for (const commandText of commands) {
        try {
            // Parse the command using PEG parser
            const args = parseCommand(commandText);
            
            if (args.length === 0) {
                continue;
            }
            
            // Execute the command
            const result = await executeDocmemCommand(args, docmem);
            
            results.push({
                command: commandText,
                result: result.result,
                success: result.success
            });
            
            // Log to chat display
            if (result.success) {
                appendToChatDisplay(`command> ${commandText}`);
                appendToChatDisplay(`result> ${result.result}`);
            } else {
                appendToChatDisplay(`command> ${commandText}`);
                appendToChatDisplay(`error> ${result.result}`);
            }
        } catch (error) {
            results.push({
                command: commandText,
                result: `Parse error: ${error.message}`,
                success: false
            });
            appendToChatDisplay(`command> ${commandText}`);
            appendToChatDisplay(`error> Parse error: ${error.message}`);
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

