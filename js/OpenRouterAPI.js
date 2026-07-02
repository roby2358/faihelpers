/**
 * OpenRouterAPI - Client for calling OpenRouter API with OpenAI protocol
 */

// Generous because responses are non-streaming: the entire generation
// (including hidden reasoning tokens) must complete within this window
const DEFAULT_TIMEOUT_MS = 300000;

export class OpenRouterAPI {
    constructor(apiKey, model, timeoutMs = DEFAULT_TIMEOUT_MS) {
        if (!apiKey || apiKey.trim() === '') {
            throw new Error('OpenRouterAPI: API key is required');
        }
        this.apiKey = apiKey.trim();
        this.baseURL = 'https://openrouter.ai/api/v1';
        this.model = model;
        this.timeoutMs = timeoutMs;
    }

    /**
     * Build request headers for API call
     */
    buildHeaders() {
        return {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': window.location.href,
            'X-Title': 'FAI Helpers'
        };
    }

    /**
     * Build request body for chat completion
     */
    buildRequestBody(messages, temperature, maxTokens) {
        return {
            model: this.model,
            messages,
            temperature,
            max_tokens: maxTokens
        };
    }

    /**
     * Log request details to console
     */
    logRequest(requestBody, headers, messages) {
        console.log('Request URL:', `${this.baseURL}/chat/completions`);
        console.log('Request headers:', { ...headers, 'Authorization': 'Bearer ***' });
        console.log('Request body:', { ...requestBody, messages: `[${messages.length} messages]` });
        
        console.log('=== PROMPT TO LLM ===');
        console.log('Model:', requestBody.model);
        console.log('Temperature:', requestBody.temperature);
        console.log('Max Tokens:', requestBody.max_tokens);
        console.log('Messages:', JSON.stringify(messages, null, 2));
        console.log('====================');
    }

    /**
     * Log error response to console
     */
    logErrorResponse(response, errorData) {
        if (errorData) {
            console.error('=== API ERROR RESPONSE ===');
            console.error('Status:', response.status);
            console.error('Error Data:', JSON.stringify(errorData, null, 2));
            console.error('========================');
        } else {
            console.error('=== API ERROR (Non-JSON) ===');
            console.error('Status:', response.status);
            console.error('Status Text:', response.statusText);
            console.error('===========================');
        }
    }

    /**
     * Log successful response to console
     */
    logSuccessResponse(data, responseContent) {
        console.log('=== RAW LLM RESPONSE ===');
        console.log(JSON.stringify(data, null, 2));
        console.log('========================');
        
        console.log('=== RESPONSE FROM LLM ===');
        console.log('Model Used:', data.model || 'unknown');
        console.log('Usage:', JSON.stringify(data.usage || {}, null, 2));
        console.log('Response Content:', responseContent);
        console.log('==========================');
    }

    /**
     * Handle error response from API
     */
    async handleErrorResponse(response) {
        let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
        let errorData = null;
        
        try {
            errorData = await response.json();
            errorMessage = errorData.error?.message || errorData.message || errorMessage;
        } catch (e) {
            // Response isn't JSON, use status text
        }
        
        this.logErrorResponse(response, errorData);
        throw new Error(`API Error: ${errorMessage}`);
    }

    /**
     * Validate response structure
     */
    validateResponse(data) {
        if (!data.choices || !Array.isArray(data.choices) || data.choices.length === 0) {
            throw new Error('API Error: Invalid response structure - no choices array');
        }

        const choice = data.choices[0];
        if (!choice.message || !choice.message.content) {
            // Reasoning models (e.g. GLM 5.2) can exhaust max_tokens on hidden
            // reasoning, returning finish_reason "length" with empty content
            if (choice.finish_reason === 'length') {
                throw new Error('API Error: Response truncated (finish_reason=length) - '
                    + 'the model ran out of tokens before producing content, '
                    + 'likely spent on reasoning; increase maxTokens');
            }
            if (choice.message?.reasoning) {
                throw new Error('API Error: Model returned reasoning but no message content');
            }
            throw new Error('API Error: Invalid response structure - missing message content');
        }
    }

    /**
     * Extract content from validated response
     */
    extractResponseContent(data) {
        return data.choices[0].message.content;
    }

    /**
     * Convert abort/timeout DOMExceptions into agent-readable API errors;
     * pass all other errors through unchanged
     */
    translateAbortError(error) {
        if (error.name === 'TimeoutError') {
            return new Error(`API Error: Request timed out after ${Math.round(this.timeoutMs / 1000)}s`);
        }
        if (error.name === 'AbortError') {
            return new Error('API Error: Request aborted');
        }
        return error;
    }

    /**
     * Perform the HTTP request to the API
     */
    async performRequest(headers, requestBody) {
        return await fetch(`${this.baseURL}/chat/completions`, {
            method: 'POST',
            headers,
            body: JSON.stringify(requestBody),
            signal: AbortSignal.timeout(this.timeoutMs)
        });
    }

    /**
     * Call the chat completion API
     */
    async chat(messages, temperature, maxTokens) {
        if (!this.apiKey || this.apiKey.trim() === '') {
            throw new Error('API key is missing or empty');
        }

        const headers = this.buildHeaders();
        const requestBody = this.buildRequestBody(messages, temperature, maxTokens);
        
        this.logRequest(requestBody, headers, messages);
        
        let data;
        try {
            const response = await this.performRequest(headers, requestBody);

            if (!response.ok) {
                await this.handleErrorResponse(response);
            }

            // The timeout signal also covers the body read
            data = await response.json();
        } catch (error) {
            throw this.translateAbortError(error);
        }
        
        this.validateResponse(data);
        
        const responseContent = this.extractResponseContent(data);
        
        this.logSuccessResponse(data, responseContent);
        
        return responseContent;
    }
}
