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
    buildRequestBody(messages, temperature, maxTokens, reasoning, ignoreProviders = []) {
        const body = {
            model: this.model,
            messages,
            temperature,
            max_tokens: maxTokens,
            // OpenRouter unified reasoning control; models that cannot
            // switch thinking off ignore enabled: false
            reasoning: { enabled: reasoning }
        };
        if (ignoreProviders.length > 0) {
            body.provider = { ignore: ignoreProviders };
        }
        return body;
    }

    /**
     * True for a completed response whose content is empty: the model ended
     * its turn immediately. Retried once on a different provider.
     */
    isEmptyStop(data) {
        const choice = data?.choices?.[0];
        return Boolean(choice) && !choice.error && !choice.message?.content
            && choice.finish_reason === 'stop';
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
        console.log('Reasoning:', requestBody.reasoning.enabled);
        if (requestBody.provider) {
            console.log('Provider:', JSON.stringify(requestBody.provider));
        }
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
    logRawResponse(data) {
        console.log('=== RAW LLM RESPONSE ===');
        console.log(JSON.stringify(data, null, 2));
        console.log('========================');
    }

    logSuccessResponse(data, responseContent) {
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
        if (choice.error) {
            const message = choice.error.message || JSON.stringify(choice.error);
            throw new Error(`API Error: Provider error in response: ${message}`);
        }
        if (!choice.message || !choice.message.content) {
            const detail = `finish_reason=${choice.finish_reason ?? 'none'}, `
                + `native_finish_reason=${choice.native_finish_reason ?? 'none'}, `
                + `message keys=[${Object.keys(choice.message || {}).join(', ')}]`;
            // Reasoning models (e.g. GLM 5.2) can exhaust max_tokens on hidden
            // reasoning, returning finish_reason "length" with empty content
            if (choice.finish_reason === 'length') {
                throw new Error('API Error: Response truncated (finish_reason=length) - '
                    + 'the model ran out of tokens before producing content, '
                    + 'likely spent on reasoning; increase maxTokens');
            }
            if (choice.message?.reasoning) {
                throw new Error(`API Error: Model returned reasoning but no message content (${detail})`);
            }
            throw new Error(`API Error: Empty message content (${detail})`);
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
     * One request/response round trip; returns the parsed JSON body
     */
    async requestOnce(headers, messages, temperature, maxTokens, reasoning, ignoreProviders) {
        const requestBody = this.buildRequestBody(messages, temperature, maxTokens, reasoning, ignoreProviders);
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

        this.logRawResponse(data);
        return data;
    }

    /**
     * Call the chat completion API
     */
    async chat(messages, temperature, maxTokens, reasoning = false) {
        if (!this.apiKey || this.apiKey.trim() === '') {
            throw new Error('API key is missing or empty');
        }

        const headers = this.buildHeaders();
        let data = await this.requestOnce(headers, messages, temperature, maxTokens, reasoning, []);

        if (this.isEmptyStop(data) && data.provider) {
            console.warn(`Empty response from provider ${data.provider}; retrying once on another provider`);
            data = await this.requestOnce(headers, messages, temperature, maxTokens, reasoning, [data.provider]);
        }

        this.validateResponse(data);
        
        const responseContent = this.extractResponseContent(data);
        
        this.logSuccessResponse(data, responseContent);
        
        return responseContent;
    }
}
