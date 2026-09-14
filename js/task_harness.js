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
import { createTaskCommandRouter, KNOWN_COMMANDS } from './command_router.js';
import { OpenRouterAPI } from './OpenRouterAPI.js';
import { randomString } from './tools.js';

const RETRY_LIMIT = 3;
const MAX_DEPTH = 100;
const NUDGE_LIMIT = 3;
const NUDGE_MESSAGE = '$ System.turn()\n\nYour last response ran no commands. Act with a pytool block, or call suspend() or finish(summary).';
const NATIVE_MARKUP_MESSAGE = '$ System.turn()\n\nYour last response wrote native tool-call markup, which this system does not read. Only fenced ```pytool blocks run. Rewrite the same calls inside a pytool fence.';

// Native tool-call syntaxes small models fall back to instead of pytool fences
const NATIVE_MARKUP = /<｜+DSML｜+|<tool_call>|<function_calls>|<invoke /;

function nudgeFor(response) {
    return NATIVE_MARKUP.test(response) ? NATIVE_MARKUP_MESSAGE : NUDGE_MESSAGE;
}

// State block: {key=value, ...} at the start of a task node's text

const STATE_BLOCK = /^\s*\{([^}]*)\}/;

export function isChatRoot(node) {
    return node !== null && node.parentId === null && node.contextType === 'chat_session';
}

export function readList(state) {
    return (state.get('read') || '').split(/\s+/).filter(Boolean);
}

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

// Counters are written explicitly when a task first runs, so a missing key
// after that is a real inconsistency, not a case to paper over.
function counter(state, key) {
    if (!state.has(key)) {
        throw new Error(`state block missing ${key}`);
    }
    return Number(state.get(key));
}

/** The one place the per-task retry_limit key is allowed to be absent (spec). */
export function retryLimit(state) {
    return state.has('retry_limit') ? Number(state.get('retry_limit')) : RETRY_LIMIT;
}

// Termination table (spec: Termination). Each row: how `failures` changes,
// the status when the run rests, and the reason used if the task fails.

const restStatus = (hasChildTasks) => hasChildTasks ? 'waiting' : 'queued';

export const TERMINATION = {
    suspend: {
        failures: (outcome, failures) => outcome.workDone ? 0 : failures + 1,
        status: restStatus,
        reason: () => 'no progress'
    },
    no_commands: {
        failures: (outcome, failures) => failures + 1,
        status: restStatus,
        reason: () => 'no progress'
    },
    error: {
        failures: (outcome, failures) => failures + 1,
        status: () => 'queued',
        reason: (outcome) => outcome.message
    },
    depth_limit: {
        failures: (outcome, failures) => failures + 1,
        status: () => 'queued',
        reason: () => 'depth limit reached'
    }
};

/**
 * Pure termination step. Mutates and returns `state`; `fold` is null or
 * { value, text } describing the summary node to fold the task under.
 */
export function applyTermination(state, hasChildTasks, outcome) {
    if (outcome.kind === 'finish') {
        state.set('failures', '0');
        state.set('status', 'done');
        return { state, fold: { value: 'done', text: outcome.summary } };
    }
    if (outcome.kind === 'aborted') {
        state.set('status', 'queued');
        return { state, fold: null };
    }
    const row = TERMINATION[outcome.kind];
    if (!row) {
        throw new Error(`unknown outcome kind ${outcome.kind}`);
    }
    const failures = row.failures(outcome, counter(state, 'failures'));
    state.set('failures', String(failures));
    if (failures >= retryLimit(state)) {
        state.set('status', 'failed');
        return { state, fold: { value: 'failed', text: row.reason(outcome) } };
    }
    state.set('status', row.status(hasChildTasks));
    return { state, fold: null };
}

const REQUIRED_OPTIONS = ['taskRootId', 'credentials', 'onChange', 'onLog'];

export class TaskHarness {
    /**
     * options (all required):
     *   taskRootId   root id of the task docmem (context_type task_list)
     *   credentials  () => ({ apiKey, model }); model is used when a task has no `model` key
     *   onChange     () => void, after every harness write to the task docmem
     *   onLog        (line) => void
     */
    constructor(options) {
        for (const key of REQUIRED_OPTIONS) {
            if (options[key] === undefined) {
                throw new Error(`TaskHarness options missing: ${key}`);
            }
        }
        this.taskRootId = options.taskRootId;
        this.credentials = options.credentials;
        this.onChange = options.onChange;
        this.onLog = options.onLog;
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
            this.state = 'stopped';
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
                if (!this.aborted()) this.log('no eligible task; stopped');
                return;
            }
            await this.runTask(task);
        }
    }

    // State block access

    /** Parse a task's state block, warning once per read when it is malformed. */
    readState(node) {
        const { state, malformed } = parseStateBlock(node.text);
        if (malformed) {
            this.log(`warning: malformed state block on ${node.id}; treating as empty`);
        }
        return state;
    }

    async writeState(nodeId, state) {
        const node = await this.docmem.requireNode(nodeId);
        state.set('updated', new Date().toISOString());
        await this.setTaskText(nodeId, writeStateBlock(node.text, state));
    }

    async setTaskText(nodeId, text) {
        await this.docmem.updateContent(nodeId, text);
        this.onChange();
    }

    // A `running` status at start can only be stale (snapshot, reload, crash)
    async resetStaleRunning() {
        for (const node of await this.allTaskNodes()) {
            const state = this.readState(node);
            if (state.get('status') === 'running') {
                state.set('status', 'queued');
                await this.writeState(node.id, state);
                this.log(`reset stale running task ${node.id} to queued`);
            }
        }
    }

    // Walks never descend into a summary: it stands in for its subtree
    taskWalk() {
        return this.docmem.preorder(this.taskRootId, node => !isSummaryNode(node));
    }

    async allTaskNodes() {
        const result = [];
        for await (const { node } of this.taskWalk()) {
            if (isTaskNode(node)) result.push(node);
        }
        return result;
    }

    // Selection: first eligible task in preorder

    async selectNext() {
        for await (const { node, children } of this.taskWalk()) {
            if (isTaskNode(node) && this.isEligible(node, children)) {
                return node;
            }
        }
        return null;
    }

    isEligible(node, children) {
        const status = this.readState(node).get('status');
        if (status === 'queued' || status === undefined) return true;
        if (status === 'waiting') {
            return !children.some(isTaskNode);
        }
        return false;
    }

    // Running a task

    // Reuse the recorded chat only if it is still a chat root
    async resolveChat(state) {
        const existing = state.get('chat');
        if (existing) {
            const node = await this.docmem.find(existing);
            if (isChatRoot(node)) {
                return existing;
            }
        }
        const chatId = 'chat_' + randomString(8);
        const chat = this.createChat(chatId, null, null);
        await chat.ready();
        await chat.createChatSession();
        state.set('chat', chatId);
        return chatId;
    }

    createChat(chatId, readSet, lensId) {
        return new DocmemChat(chatId, { readSet, lensId });
    }

    // Read-set: the task root plus every `read` key from the task up to the root
    async readSetFor(node) {
        const ids = [this.taskRootId];
        let current = node;
        while (current) {
            ids.push(...readList(this.readState(current)));
            if (current.id === this.taskRootId) break;
            current = await this.docmem.find(current.parentId);
        }
        return [...new Set(ids)];
    }

    // A docmem the worker creates joins its read-set at once, and is recorded
    // in the task root's `read` key so every later task in this docmem sees it
    routerFor(chat) {
        const router = createTaskCommandRouter();
        return async (args, docmem) => {
            const result = await router(args, docmem);
            if (args[0] === 'docmem_create' && result.success) {
                await this.addToReadSet(chat, args[1]);
            }
            return result;
        };
    }

    async addToReadSet(chat, rootId) {
        if (chat.readSet.includes(rootId)) return;
        chat.readSet.push(rootId);
        const node = await this.docmem.find(this.taskRootId);
        const state = this.readState(node);
        const read = readList(state);
        read.push(rootId);
        state.set('read', read.join(' '));
        await this.writeState(this.taskRootId, state);
    }

    taskMessage(taskId, chatId) {
        return [
            `$ System.task("${taskId}", chat="${chatId}")`,
            '',
            `You are running task ${taskId} in the task docmem shown in your context. The task's text begins with a {key=value} state block, then your instruction. Do the instruction yourself, then call finish(summary). Every response must run commands or call suspend() or finish(). Only if the instruction is genuinely too large for one run, create child task nodes (context_type "task", text starting with {status=queued}) under your node and call suspend(); they run next, then you run again once they are folded. A child must do a part of your instruction, never restate it. Tasks queued after yours run in order once you finish; do not recreate them. To run later, move your node after a later sibling and call suspend().`
        ].join('\n');
    }

    // First run of a task initializes its counters explicitly
    initCounters(state) {
        if (!state.has('attempts')) state.set('attempts', '0');
        if (!state.has('failures')) state.set('failures', '0');
    }

    modelFor(state) {
        return state.has('model') ? state.get('model') : this.credentials().model;
    }

    async runTask(task) {
        const state = this.readState(task);
        this.initCounters(state);
        state.set('status', 'running');
        state.set('attempts', String(counter(state, 'attempts') + 1));
        const chatId = await this.resolveChat(state);
        await this.writeState(task.id, state);
        this.current = task.id;
        this.log(`running ${task.id} (attempt ${state.get('attempts')}, chat ${chatId})`);

        const api = new OpenRouterAPI(this.credentials().apiKey, this.modelFor(state));
        const readSet = await this.readSetFor(task);
        const chat = this.createChat(chatId, readSet, task.contextName || null);
        await chat.ready();
        const loop = new AgentLoop(chat, api, this.routerFor(chat), KNOWN_COMMANDS, {
            summaryLine: `task ${task.id}`,
            maxDepth: MAX_DEPTH,
            signal: this.abortController.signal,
            nudge: { message: nudgeFor, limit: NUDGE_LIMIT },
            onUserMessage: () => {},
            onAssistantMessage: () => {},
            onModelRequest: () => {}
        });

        const outcome = await this.runLoop(loop, task, chatId);
        await this.terminate(task.id, outcome);
        this.current = null;
    }

    async runLoop(loop, task, chatId) {
        try {
            const result = await loop.run(this.taskMessage(task.id, chatId));
            return { kind: result.reason, summary: result.summary, workDone: result.workDone };
        } catch (error) {
            if (error instanceof AbortedError || error.name === 'AbortError') {
                return { kind: 'aborted' };
            }
            return { kind: 'error', message: error.message };
        }
    }

    // Termination per the spec table

    async terminate(taskId, outcome) {
        const node = await this.docmem.find(taskId);
        if (!node) {
            this.log(`task ${taskId} vanished during its run`);
            return;
        }
        const children = await this.docmem.getSortedChildren(taskId);
        const hasChildTasks = children.some(isTaskNode);
        const { state, fold } = applyTermination(this.readState(node), hasChildTasks, outcome);
        await this.writeState(taskId, state);
        if (fold) {
            await this.fold(taskId, fold.value, fold.text);
        }
        const detail = outcome.kind === 'error' ? `: ${outcome.message}` : '';
        this.log(`${outcome.kind} ${taskId}; ${state.get('status')} (failures ${state.get('failures')})${detail}`);
    }

    async fold(taskId, value, text) {
        await this.docmem.addSummary(taskId, taskId, text || '', 'summary', 'task', value);
        this.onChange();
    }
}

/** Create a new task docmem root. */
export async function createTaskDocmem(rootId, name) {
    if (name === undefined) {
        throw new Error('createTaskDocmem requires a name');
    }
    const docmem = new Docmem(rootId);
    await docmem.ready();
    const root = await docmem.getRootById(rootId);
    if (root.contextType !== 'task_list') {
        await docmem.updateContext(rootId, 'task_list', name, new Date().toISOString());
    }
    return docmem;
}
