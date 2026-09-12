/**
 * AgentLoop - Reusable LLM query/response loop for agents
 *
 * Encapsulates: message list construction, LLM invocation, command extraction,
 * command routing, and turn cycling. Free of UI dependencies.
 */
import { parse as parsePytool } from './pytool/pytool_parser.js';

// A block runs to its closing fence or, when the model omits the fence, to
// the end of the response. Silently dropping an unterminated block cost a
// finish() call and a full chapter rewrite in one observed run.
const PYTOOL_BLOCK = /```pytool\s*\n([\s\S]*?)(?:```|$)/gi;

export function extractPytoolCalls(text) {
    const allCalls = [];
    let match;
    while ((match = PYTOOL_BLOCK.exec(text)) !== null) {
        try {
            allCalls.push(...parsePytool(match[1]));
        } catch (error) {
            allCalls.push({ name: '__parse_error__', args: [error.message], _error: true });
        }
    }
    PYTOOL_BLOCK.lastIndex = 0;
    return allCalls;
}

const TEMPERATURE = 0.7;
// Ceiling on completion length, not a spend target. Covers a full scene
// draft plus any hidden reasoning tokens, which count against this budget.
const MAX_TOKENS = 32000;
// Sent as OpenRouter's reasoning.enabled and shown in the status line
const REASONING = false;

const AGENT_LOOP_OPTION_KEYS = [
    'summaryLine', 'maxDepth', 'signal', 'nudge',
    'onUserMessage', 'onAssistantMessage', 'onModelRequest'
];

export class AbortedError extends Error {
    constructor() {
        super('Run aborted');
        this.name = 'AbortedError';
    }
}

/**
 * Options (every key is required; null where noted):
 *   summaryLine      short label written to the chat root text
 *   maxDepth         turn limit
 *   signal           AbortSignal or null; checked before each model call and each command
 *   nudge            { message, limit } or null: reply to a tool-less response with
 *                    `message(response)` up to `limit` times before ending the
 *                    run as no_commands. null: a tool-less response ends the run.
 *   onUserMessage, onAssistantMessage, onModelRequest  display callbacks
 *
 * run() resolves to { reason, summary, finalResponse, chatDocmemRootId, workDone }
 * where reason is finish | suspend | no_commands | depth_limit. Abort rejects
 * with AbortedError; API and execution errors reject with the underlying error.
 * workDone is true when at least one command other than suspend/finish
 * executed successfully during the run.
 */
export class AgentLoop {
    constructor(chatSession, api, commandRouter, knownCommands, options) {
        for (const key of AGENT_LOOP_OPTION_KEYS) {
            if (options[key] === undefined) {
                throw new Error(`AgentLoop options missing: ${key}`);
            }
        }
        this.chatSession = chatSession;
        this.api = api;
        this.commandRouter = commandRouter;
        this.knownCommands = knownCommands;
        this.summaryLine = options.summaryLine;
        this.maxDepth = options.maxDepth;
        this.signal = options.signal;
        this.nudge = options.nudge;
        this.onUserMessage = options.onUserMessage;
        this.onAssistantMessage = options.onAssistantMessage;
        this.onModelRequest = options.onModelRequest;
        this.workDone = false;
    }

    // Run

    async run(initialMessage) {
        const docmem = this.chatSession.docmem;
        const docmemId = this.chatSession.docmemId;

        await docmem.updateContent(docmemId, this.summaryLine);

        await this.recordUserMessage(initialMessage);

        let finalResponse = '';
        let toolless = 0;

        for (let depth = 0; depth < this.maxDepth; depth++) {
            this.checkAborted();
            finalResponse = await this.invokeModelAndRecord();

            const calls = this.extractPytoolCalls(finalResponse);
            if (calls.length === 0) {
                toolless += 1;
                if (!this.nudge || toolless >= this.nudge.limit) {
                    return this.finalize(docmemId, 'no_commands', null, finalResponse);
                }
                await this.recordUserMessage(this.nudge.message(finalResponse));
                continue;
            }
            toolless = 0;

            const termination = await this.executeCallList(calls);
            if (termination.terminate) {
                return this.finalize(docmemId, termination.terminate, termination.summary, finalResponse);
            }
        }

        return this.finalize(docmemId, 'depth_limit', null, finalResponse);
    }

    finalize(docmemId, reason, summary, finalResponse) {
        return { reason, summary, finalResponse, chatDocmemRootId: docmemId, workDone: this.workDone };
    }

    checkAborted() {
        if (this.signal && this.signal.aborted) {
            throw new AbortedError();
        }
    }

    // Message Recording

    async recordUserMessage(msg) {
        await this.chatSession.appendUserMessage(msg);
        this.onUserMessage(msg);
    }

    async recordAssistantMessage(msg) {
        await this.chatSession.appendAssistantMessage(msg);
        this.onAssistantMessage(msg);
    }

    async invokeModelAndRecord() {
        const messages = await this.chatSession.buildMessageList();
        const contextLength = messages.reduce((sum, m) => sum + (m.content?.length || 0), 0);
        this.onModelRequest({ reasoning: REASONING, contextLength, maxTokens: MAX_TOKENS });
        const response = await this.api.chat(messages, TEMPERATURE, MAX_TOKENS, REASONING, this.signal);
        await this.recordAssistantMessage(response);
        return response;
    }

    // Pytool Extraction

    extractPytoolCalls(text) {
        return extractPytoolCalls(text);
    }

    // Call Execution

    // A successful tool owns its whole display string, led by the function
    // name; the loop labels only failures, which arrive as bare messages
    formatError(functionName, message) {
        return `error ${functionName}: ${message}`;
    }

    findUnknownCommands(calls) {
        const unknown = calls
            .filter(c => !c._error && !this.knownCommands.has(c.name))
            .map(c => c.name);
        return [...new Set(unknown)];
    }

    async executeCallList(calls) {
        const parseErrors = calls.filter(c => c._error);
        if (parseErrors.length > 0) {
            const outputs = parseErrors.map(err =>
                this.formatError('pytool', `parse error: ${err.args[0]}`)
            );
            await this.recordUserMessage(outputs.join('\n\n'));
            return { terminate: null };
        }

        const unknowns = this.findUnknownCommands(calls);
        if (unknowns.length > 0) {
            const available = [...this.knownCommands].sort().join(', ');
            const output = this.formatError(
                'pytool',
                `unknown function(s): ${unknowns.join(', ')}. Available: ${available}`
            );
            await this.recordUserMessage(output);
            return { terminate: null };
        }

        return await this.executeCalls(calls);
    }

    // suspend/finish take effect after the remaining commands in the block.
    // A command that fails after the terminator cancels it: the run continues
    // so the model can see the error and decide again.
    cancelTermination(terminate, outputs) {
        if (terminate === null) return null;
        outputs[outputs.length - 1] += ` (${terminate} cancelled)`;
        return null;
    }

    async executeCalls(calls) {
        const docmem = this.chatSession.docmem;
        const outputs = [];
        let terminate = null;
        let summary = null;

        for (const call of calls) {
            this.checkAborted();
            try {
                const result = await this.commandRouter([call.name, ...call.args], docmem);
                outputs.push(result.success ? result.result : this.formatError(call.name, result.result));

                if (result.terminate) {
                    terminate = result.terminate;
                    summary = result.summary || null;
                    continue;
                }
                if (result.success) {
                    this.workDone = true;
                }
                if (!result.success) {
                    terminate = this.cancelTermination(terminate, outputs);
                    break;
                }
            } catch (error) {
                outputs.push(this.formatError(call.name, `execution error: ${error.message}`));
                terminate = this.cancelTermination(terminate, outputs);
                break;
            }
        }
        if (terminate === null) {
            summary = null;
        }

        if (outputs.length > 0) {
            await this.recordUserMessage(outputs.join('\n\n'));
        }
        return { terminate, summary };
    }
}
