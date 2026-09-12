/**
 * TaskHarness - runs the tasks in one task docmem, one at a time.
 *
 * Behavior is specified in docs/TASK_DELEGATION_SPEC.md. No DOM access; the
 * Tasks panel drives it through start()/stop() and the onChange/onLog
 * callbacks.
 */
import { Docmem } from './docmem_tools/docmem.js';
import { DocmemChat } from './docmem_chat.js';
import { AgentLoop, AbortedError } from './agent_loop.js';
import { createCommandRouter, KNOWN_COMMANDS } from './command_router.js';
import { randomString } from './tools.js';

const DEFAULT_RETRY_LIMIT = 3;
const NUDGE_LIMIT = 3;
const NUDGE_MESSAGE = '$ System.turn()\n\nYour last response ran no commands. Act with a pytool block, or call suspend() or finish(summary).';

// State block: {key=value, ...} at the start of a task node's text

const STATE_BLOCK = /^\s*\{([^}]*)\}/;

export function parseStateBlock(text) {
    const match = STATE_BLOCK.exec(text || '');
    if (!match) {
        return { state: new Map([['status', 'queued']]), malformed: false };
    }
    const state = new Map();
    for (const pair of match[1].split(',')) {
        if (!pair.trim()) continue;
        const eq = pair.indexOf('=');
        if (eq < 0) {
            return { state: new Map(), malformed: true };
        }
        state.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
    return { state, malformed: false };
}

export function formatStateBlock(state) {
    return `{${[...state].map(([k, v]) => `${k}=${v}`).join(', ')}}`;
}

/** Replace (or prepend) the state block in text, leaving the instruction untouched. */
export function writeStateBlock(text, state) {
    const block = formatStateBlock(state);
    const match = STATE_BLOCK.exec(text || '');
    if (!match) {
        return `${block}\n${text || ''}`;
    }
    return block + text.slice(match[0].length);
}

export function instructionText(text) {
    const match = STATE_BLOCK.exec(text || '');
    return match ? text.slice(match[0].length).replace(/^\n/, '') : (text || '');
}

export function isTaskNode(node) {
    return node.contextType === 'task';
}

export function isSummaryNode(node) {
    return node.contextType === 'summary';
}

export class TaskHarness {
    /**
     * options:
     *   taskRootId   root id of the task docmem (context_type task_list)
     *   apiFactory   (model) => OpenRouterAPI
     *   defaultModel model id used when a task has no `model` key
     *   onChange     () => void, after every harness write to the task docmem
     *   onLog        (line) => void
     */
    constructor(options) {
        this.taskRootId = options.taskRootId;
        this.apiFactory = options.apiFactory;
        this.defaultModel = options.defaultModel;
        this.onChange = options.onChange || (() => {});
        this.onLog = options.onLog || (() => {});
        this.docmem = new Docmem(this.taskRootId);
        this.state = 'stopped';
        this.abortController = null;
        this.current = null;
        this.loopPromise = null;
    }

    async ready() {
        await this.docmem.ready();
    }

    log(line) {
        this.onLog(line);
    }

    // Start / Stop

    start() {
        if (this.state === 'started') return;
        this.state = 'started';
        this.abortController = new AbortController();
        this.loopPromise = this.selectionLoop().catch(error => {
            this.log(`harness error: ${error.message}`);
            console.error(error);
        }).finally(() => {
            if (this.state !== 'idle') this.state = 'stopped';
            this.current = null;
            this.onChange();
        });
    }

    stop() {
        if (this.state === 'stopped') return;
        this.log('stop requested');
        this.state = 'stopped';
        this.abortController.abort();
        this.onChange();
    }

    aborted() {
        return this.abortController.signal.aborted;
    }

    async selectionLoop() {
        await this.ready();
        await this.resetStaleRunning();
        while (!this.aborted()) {
            const task = await this.selectNext();
            if (!task) {
                if (this.aborted()) return;
                this.state = 'idle';
                this.log('no eligible task; idle');
                this.onChange();
                return;
            }
            this.state = 'started';
            await this.runTask(task);
        }
    }

    // A `running` status at start can only be stale (snapshot, reload, crash)
    async resetStaleRunning() {
        for (const node of await this.allTaskNodes()) {
            const { state } = parseStateBlock(node.text);
            if (state.get('status') === 'running') {
                state.set('status', 'queued');
                await this.writeState(node.id, state);
                this.log(`reset stale running task ${node.id} to queued`);
            }
        }
    }

    async allTaskNodes() {
        const result = [];
        const walk = async (node) => {
            if (isTaskNode(node)) result.push(node);
            if (isSummaryNode(node)) return;
            for (const child of await this.docmem.getSortedChildren(node.id)) {
                await walk(child);
            }
        };
        await walk(await this.docmem.requireNode(this.taskRootId));
        return result;
    }

    // Selection: first eligible task in preorder, never descending into summaries

    async selectNext() {
        const visit = async (node) => {
            const children = await this.docmem.getSortedChildren(node.id);
            if (isTaskNode(node) && await this.isEligible(node, children)) {
                return node;
            }
            for (const child of children) {
                if (isSummaryNode(child)) continue;
                const found = await visit(child);
                if (found) return found;
            }
            return null;
        };
        return await visit(await this.docmem.requireNode(this.taskRootId));
    }

    async isEligible(node, children) {
        const { state } = parseStateBlock(node.text);
        const status = state.get('status') || 'queued';
        if (status === 'queued') return true;
        if (status === 'waiting') {
            return !children.some(isTaskNode);
        }
        return false;
    }

    // Running a task

    async writeState(nodeId, state) {
        const node = await this.docmem.requireNode(nodeId);
        state.set('updated', new Date().toISOString());
        await this.docmem.updateContent(nodeId, writeStateBlock(node.text, state));
        this.onChange();
    }

    async resolveChat(state) {
        const existing = state.get('chat');
        if (existing && await this.docmem.find(existing)) {
            return existing;
        }
        const chatId = 'chat_' + randomString(8);
        const chat = this.createChat(chatId, {});
        await chat.ready();
        await chat.createChatSession();
        state.set('chat', chatId);
        return chatId;
    }

    createChat(chatId, options) {
        return new DocmemChat(chatId, options);
    }

    async readSetFor(node) {
        const ids = [this.taskRootId];
        let current = node;
        while (current) {
            const { state } = parseStateBlock(current.text);
            const read = state.get('read');
            if (read) {
                ids.push(...read.split(/\s+/).filter(Boolean));
            }
            current = current.parentId ? await this.docmem.find(current.parentId) : null;
        }
        return [...new Set(ids)];
    }

    taskMessage(taskId, chatId) {
        return [
            `$ System.task("${taskId}", chat="${chatId}")`,
            '',
            `You are running task ${taskId} in the task docmem shown in your context. The task's text begins with a {key=value} state block, then your instruction. Around advice: your task wraps the subtasks beneath it. If the work needs splitting, create child task nodes (context_type "task", text starting with {status=queued}) under your node and call suspend(); they run next, and you are run again when they are all folded. To run later, move your node after a later sibling and call suspend(). When the work is done, call finish(summary). Every response must run commands or call suspend() or finish().`
        ].join('\n');
    }

    async runTask(task) {
        const { state } = parseStateBlock(task.text);
        state.set('status', 'running');
        state.set('attempts', String(Number(state.get('attempts') || 0) + 1));
        const chatId = await this.resolveChat(state);
        await this.writeState(task.id, state);
        this.current = task.id;
        this.log(`running ${task.id} (attempt ${state.get('attempts')}, chat ${chatId})`);

        const model = state.get('model') || this.defaultModel;
        const api = this.apiFactory(model);
        const readSet = await this.readSetFor(task);
        const chat = this.createChat(chatId, { readSet, lensId: task.contextName || null });
        await chat.ready();
        const loop = new AgentLoop(chat, api, createCommandRouter({ isTaskRun: true }), KNOWN_COMMANDS, {
            summaryLine: `task ${task.id}`,
            signal: this.abortController.signal,
            nudge: { message: NUDGE_MESSAGE, limit: NUDGE_LIMIT }
        });

        let outcome;
        try {
            const result = await loop.run(this.taskMessage(task.id, chatId));
            outcome = { kind: result.reason, summary: result.summary, workDone: result.workDone };
        } catch (error) {
            if (error instanceof AbortedError || error.name === 'AbortError') {
                outcome = { kind: 'aborted' };
            } else {
                outcome = { kind: 'error', message: error.message };
            }
        }
        await this.terminate(task.id, outcome);
        this.current = null;
    }

    // Termination per the spec table

    async terminate(taskId, outcome) {
        const node = await this.docmem.find(taskId);
        if (!node) {
            this.log(`task ${taskId} vanished during its run`);
            return;
        }
        const { state } = parseStateBlock(node.text);
        const children = await this.docmem.getSortedChildren(taskId);
        const hasChildTasks = children.some(isTaskNode);
        const limit = Number(state.get('retry_limit') || DEFAULT_RETRY_LIMIT);
        let failures = Number(state.get('failures') || 0);
        const restStatus = hasChildTasks ? 'waiting' : 'queued';

        switch (outcome.kind) {
            case 'finish':
                state.set('failures', '0');
                state.set('status', 'done');
                await this.writeState(taskId, state);
                await this.fold(taskId, 'done', outcome.summary);
                this.log(`finished ${taskId}`);
                return;
            case 'suspend':
                if (outcome.workDone) {
                    failures = 0;
                } else {
                    failures += 1;
                }
                break;
            case 'no_commands':
                failures += 1;
                break;
            case 'aborted':
                state.set('status', 'queued');
                await this.writeState(taskId, state);
                this.log(`aborted ${taskId}; queued`);
                return;
            case 'error':
            case 'depth_limit':
                failures += 1;
                break;
        }

        state.set('failures', String(failures));
        if (failures >= limit) {
            const reason = outcome.kind === 'error' ? outcome.message
                : outcome.kind === 'depth_limit' ? 'depth limit reached'
                : 'no progress';
            state.set('status', 'failed');
            await this.writeState(taskId, state);
            await this.fold(taskId, 'failed', reason);
            this.log(`failed ${taskId}: ${reason}`);
            return;
        }

        const isError = outcome.kind === 'error' || outcome.kind === 'depth_limit';
        state.set('status', isError ? 'queued' : restStatus);
        await this.writeState(taskId, state);
        const detail = outcome.kind === 'error' ? `: ${outcome.message}` : '';
        this.log(`${outcome.kind} ${taskId}; ${state.get('status')} (failures ${failures})${detail}`);
    }

    async fold(taskId, value, summary) {
        await this.docmem.addSummary(taskId, taskId, summary || '', 'summary', 'task', value);
        this.onChange();
    }
}

/** Create a new task docmem root. */
export async function createTaskDocmem(rootId, name) {
    const docmem = new Docmem(rootId);
    await docmem.ready();
    const root = await docmem.getRootById(rootId);
    if (root.contextType !== 'task_list') {
        await docmem.updateContext(rootId, 'task_list', name || rootId, new Date().toISOString());
    }
    return docmem;
}
