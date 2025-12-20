/**
 * Chat - Chat interface logic using DocmemChat
 */
import { OpenRouterAPI } from './OpenRouterAPI.js';

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

        // Create chat session
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

