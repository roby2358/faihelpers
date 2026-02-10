/**
 * AgentLoop - Reusable LLM query/response loop for agents
 *
 * Encapsulates: message list construction, LLM invocation, command extraction,
 * command routing, and turn cycling. Free of UI dependencies.
 */
import { parse as parseCommand } from './bash/command_parser.js';

/**
 * Format a delegation system message for a child agent
 */
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
        '# Run',
        '```bash',
        'complete "I finished the task. Here is what I did..."',
        '```'
    ].join('\n');
}

export class AgentLoop {
    /**
     * @param {object} opts
     * @param {import('./docmem_chat.js').DocmemChat} opts.chatSession
     * @param {import('./OpenRouterAPI.js').OpenRouterAPI} opts.api
     * @param {function} opts.commandRouter - async (args, docmem) => { success, result, complete?, summary? }
     * @param {string} opts.summaryLine - Short descriptive label stored in the docmem root node
     * @param {number} [opts.maxDepth=100]
     * @param {function} [opts.onUserMessage] - callback(text)
     * @param {function} [opts.onAssistantMessage] - callback(text)
     */
    constructor({ chatSession, api, commandRouter, summaryLine, maxDepth = 100, onUserMessage, onAssistantMessage }) {
        this.chatSession = chatSession;
        this.api = api;
        this.commandRouter = commandRouter;
        this.summaryLine = summaryLine || '';
        this.maxDepth = maxDepth;
        this.onUserMessage = onUserMessage || (() => {});
        this.onAssistantMessage = onAssistantMessage || (() => {});
        this._completeSignaled = false;
        this._completeSummary = null;
    }

    /**
     * Run the agent loop with an initial message
     * @param {string} initialMessage
     * @returns {{ reason: string, summary: string|null, finalResponse: string, chatDocmemRootId: string }}
     */
    async run(initialMessage) {
        const docmem = this.chatSession.docmem;
        const docmemId = this.chatSession.docmemId;

        // Store summary line in the chat docmem root node
        if (this.summaryLine) {
            await docmem.updateContent(docmemId, this.summaryLine);
        }

        // Create summary node as child of root; messages will be appended under it
        const runNode = await docmem.appendChild(docmemId, 'summary', 'status', 'working', 'working');
        this._runNodeId = runNode.id;
        this.chatSession.messageParentId = runNode.id;

        await this.recordUserMessage(initialMessage);

        let finalResponse = '';

        for (let depth = 0; depth < this.maxDepth; depth++) {
            const response = await this.invokeModelAndRecordResponse();
            finalResponse = response;

            const commands = this.extractRunSections(response);
            if (commands.length === 0) {
                await this.finalizeRunNode(finalResponse);
                return {
                    reason: 'no_commands',
                    summary: null,
                    finalResponse,
                    chatDocmemRootId: docmemId
                };
            }

            await this.executeCommandBatch(commands);

            if (this._completeSignaled) {
                await this.finalizeRunNode(this._completeSummary || finalResponse);
                return {
                    reason: 'complete',
                    summary: this._completeSummary,
                    finalResponse,
                    chatDocmemRootId: docmemId
                };
            }
        }

        await this.finalizeRunNode('(depth limit reached) ' + finalResponse);
        return {
            reason: 'depth_limit',
            summary: null,
            finalResponse,
            chatDocmemRootId: docmemId
        };
    }

    /**
     * Update the run node text with the final summary
     */
    async finalizeRunNode(summaryText) {
        await this.chatSession.docmem.updateContent(this._runNodeId, summaryText || '');
    }

    async recordUserMessage(msg) {
        await this.chatSession.appendUserMessage(msg);
        this.onUserMessage(msg);
    }

    async recordAssistantMessage(msg) {
        await this.chatSession.appendAssistantMessage(msg);
        this.onAssistantMessage(msg);
    }

    async invokeModelAndRecordResponse() {
        const messages = await this.chatSession.buildMessageList();
        const response = await this.api.chat(messages, 0.7, 2000);
        await this.recordAssistantMessage(response);
        return response;
    }

    /**
     * Extract # Run sections from text and return array of bash commands
     */
    extractRunSections(text) {
        const commands = [];
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
     * Format a single command output line
     */
    appendCommandOutput(commandOutputText, commandText, outputType, outputMessage) {
        const separator = commandOutputText ? '\n' : '';
        return commandOutputText + separator + `command> ${commandText}\n\n${outputType}> ${outputMessage}`;
    }

    /**
     * Execute a batch of commands, record results, check for complete signal
     */
    async executeCommandBatch(commands) {
        const docmem = this.chatSession.docmem;
        let commandOutputText = '';

        for (const commandText of commands) {
            try {
                const args = parseCommand(commandText);
                if (args.length === 0) continue;

                const result = await this.commandRouter(args, docmem);

                const outputType = result.success ? 'result' : 'error';
                commandOutputText = this.appendCommandOutput(commandOutputText, commandText, outputType, result.result);

                if (result.complete) {
                    this._completeSignaled = true;
                    this._completeSummary = result.summary || null;
                }
            } catch (error) {
                const errorMessage = `Parse error: ${error.message}`;
                commandOutputText = this.appendCommandOutput(commandOutputText, commandText, 'error', errorMessage);
            }
        }

        if (commandOutputText) {
            await this.recordUserMessage(commandOutputText);
        }
    }
}
