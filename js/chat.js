/**
 * Chat - Chat interface logic using AgentLoop and DocmemChat
 */
import { OpenRouterAPI } from './OpenRouterAPI.js';
import { DocmemChat } from './docmem_chat.js';
import { showMessage } from './index.js';
import { Key } from './key.js';
import { AgentLoop } from './agent_loop.js';
import { createCommandRouter, KNOWN_COMMANDS } from './command_router.js';

let chatSession = null;
let api = null;
let isProcessing = false;
let keyHandler = null;

const CHAT_DOCMEM_ID = 'chat_session';

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
    const router = createCommandRouter({ isTaskRun: false });

    const loop = new AgentLoop(chatSession, api, router, KNOWN_COMMANDS, {
        summaryLine: truncate(message, 80),
        onUserMessage: (msg) => appendToChatDisplay(`\nuser> ${msg}`),
        onAssistantMessage: (msg) => appendToChatDisplay(`\nassistant> ${msg}`),
        onModelRequest: reportModelRequest
    });

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

/** Current OpenRouter credentials, for the Tasks panel. */
export function getChatApi() {
    return api;
}

export function getChatCredentials() {
    const apiKey = document.getElementById('chat-api-key')?.value.trim() || sessionStorage.getItem('chat_api_key') || '';
    const model = document.getElementById('chat-model')?.value || sessionStorage.getItem('chat_model') || '';
    return { apiKey, model };
}

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
