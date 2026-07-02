/**
 * AgentLoop - Reusable LLM query/response loop for agents
 *
 * Encapsulates: message list construction, LLM invocation, command extraction,
 * command routing, and turn cycling. Free of UI dependencies.
 */
import { parse as parsePytool } from './pytool/pytool_parser.js';

const PYTOOL_BLOCK = /```pytool\s*\n([\s\S]*?)```/gi;

const TEMPERATURE = 0.7;
// 8000 not 2000: reasoning models (e.g. GLM 5.2) spend hidden reasoning
// tokens from this budget; too low and content comes back empty
const MAX_TOKENS = 8000;
// Not sent in the request yet — reported in the status line as a gauge
const REASONING = false;

export function formatDelegationMessage(taskPrompt, parentDocmemId) {
    return [
        '# Delegated Task',
        '',
        'You are a delegated agent. A parent agent has assigned you the following task.',
        '',
        '## Task',
        '',
        taskPrompt,
        '',
        '## Parent Agent',
        '',
        `Parent agent identity: ${parentDocmemId}`,
        '',
        '## Instructions',
        '',
        'When you have completed the task, you MUST issue a `complete` command with a summary of the work you performed. Example:',
        '',
        '```pytool',
        'complete("I finished the task. Here is what I did...")',
        '```'
    ].join('\n');
}

export class AgentLoop {
    constructor(chatSession, api, commandRouter, knownCommands, summaryLine, maxDepth, onUserMessage, onAssistantMessage, onModelRequest) {
        this.chatSession = chatSession;
        this.api = api;
        this.commandRouter = commandRouter;
        this.knownCommands = knownCommands;
        this.summaryLine = summaryLine;
        this.maxDepth = maxDepth;
        this.onUserMessage = onUserMessage;
        this.onAssistantMessage = onAssistantMessage;
        this.onModelRequest = onModelRequest || (() => {});
    }

    // Run

    async run(initialMessage) {
        const docmem = this.chatSession.docmem;
        const docmemId = this.chatSession.docmemId;

        await docmem.updateContent(docmemId, this.summaryLine);

        const runNode = await docmem.appendChild(docmemId, 'summary', 'status', 'working', 'working');
        this.chatSession.messageParentId = runNode.id;

        await this.recordUserMessage(initialMessage);

        let finalResponse = '';

        for (let depth = 0; depth < this.maxDepth; depth++) {
            finalResponse = await this.invokeModelAndRecord();

            const calls = this.extractPytoolCalls(finalResponse);
            if (calls.length === 0) {
                return this.finalize(runNode.id, docmemId, 'no_commands', null, finalResponse);
            }

            const completion = await this.executeCallList(calls);
            if (completion.complete) {
                return this.finalize(runNode.id, docmemId, 'complete', completion.summary, finalResponse);
            }
        }

        return this.finalize(runNode.id, docmemId, 'depth_limit', null, finalResponse);
    }

    async finalize(runNodeId, docmemId, reason, summary, finalResponse) {
        const text = reason === 'depth_limit'
            ? '(depth limit reached) ' + finalResponse
            : summary || finalResponse;
        await this.chatSession.docmem.updateContent(runNodeId, text || '');
        return { reason, summary, finalResponse, chatDocmemRootId: docmemId };
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
        const response = await this.api.chat(messages, TEMPERATURE, MAX_TOKENS);
        await this.recordAssistantMessage(response);
        return response;
    }

    // Pytool Extraction

    extractPytoolCalls(text) {
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

    // Call Execution

    formatCall(call) {
        return `${call.name}(${call.args.map(a => JSON.stringify(a)).join(', ')})`;
    }

    formatOutput(commandText, outputType, message) {
        return `command> ${commandText}\n\n${outputType}> ${message}`;
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
                this.formatOutput('(parse error)', 'error', `Parse error: ${err.args[0]}`)
            );
            await this.recordUserMessage(outputs.join('\n'));
            return { complete: false };
        }

        const unknowns = this.findUnknownCommands(calls);
        if (unknowns.length > 0) {
            const available = [...this.knownCommands].sort().join(', ');
            const output = this.formatOutput(
                calls.map(c => this.formatCall(c)).join('\n'),
                'error',
                `Unknown function(s): ${unknowns.join(', ')}. Available: ${available}`
            );
            await this.recordUserMessage(output);
            return { complete: false };
        }

        return await this.executeCalls(calls);
    }

    async executeCalls(calls) {
        const docmem = this.chatSession.docmem;
        const outputs = [];

        for (const call of calls) {
            const callText = this.formatCall(call);

            try {
                const result = await this.commandRouter([call.name, ...call.args], docmem);
                outputs.push(this.formatOutput(callText, result.success ? 'result' : 'error', result.result));

                if (result.complete) {
                    await this.recordUserMessage(outputs.join('\n'));
                    return { complete: true, summary: result.summary || null };
                }
                if (!result.success) break;
            } catch (error) {
                outputs.push(this.formatOutput(callText, 'error', `Execution error: ${error.message}`));
                break;
            }
        }

        if (outputs.length > 0) {
            await this.recordUserMessage(outputs.join('\n'));
        }
        return { complete: false };
    }
}
