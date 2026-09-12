/**
 * Command router shared by the chat agent and task workers.
 *
 * Dispatches parsed pytool calls to DocmemCommands or SystemCommands and
 * handles the run-terminating commands suspend and finish.
 */
import { DocmemCommands, KNOWN_DOCMEM_COMMANDS } from './docmem_tools/docmem_commands.js';
import { SystemCommands, KNOWN_SYSTEM_COMMANDS } from './system_tools/system_commands.js';

export const KNOWN_COMMANDS = new Set([...KNOWN_SYSTEM_COMMANDS, ...KNOWN_DOCMEM_COMMANDS]);
const VALID_MODES = new Set(['append-child', 'before', 'after']);
const STATIC_DOCMEM_COMMANDS = new Set(['docmem_get_all_roots', 'docmem_create']);

function requireArgs(args, minCount, commandName, usage) {
    if (args.length < minCount) {
        throw new Error(`${commandName} requires ${usage}`);
    }
}

function requireMode(mode) {
    if (!VALID_MODES.has(mode)) {
        throw new Error(`Mode must be append-child, before, or after`);
    }
}

async function executeDocmemCommand(args, docmem) {
    const [command, ...restArgs] = args;

    if (!STATIC_DOCMEM_COMMANDS.has(command) && !docmem) {
        throw new Error(`Command ${command} requires an active docmem instance`);
    }

    try {
        const commands = new DocmemCommands(docmem);

        switch (command) {
            case 'docmem_create': {
                requireArgs(restArgs, 1, 'docmem_create', '<root_id>');
                return await commands.create(restArgs[0]);
            }

            case 'docmem_create_node': {
                requireArgs(restArgs, 5, 'docmem_create_node', '<mode> <node_id> <context_type> <context_name> <context_value> [<content>]');
                const [mode, nodeId, contextType, contextName, contextValue] = restArgs;
                requireMode(mode);
                return await commands.createNode(mode, nodeId, contextType, contextName, contextValue, restArgs[5] || '');
            }

            case 'docmem_update_content': {
                requireArgs(restArgs, 1, 'docmem_update_content', '<node_id> [<content>]');
                return await commands.updateContent(restArgs[0], restArgs[1] || '');
            }

            case 'docmem_update_context': {
                requireArgs(restArgs, 4, 'docmem_update_context', '<node_id> <context_type> <context_name> <context_value>');
                const [nodeId, contextType, contextName, contextValue] = restArgs;
                return await commands.updateContext(nodeId, contextType, contextName, contextValue);
            }

            case 'docmem_delete':
                requireArgs(restArgs, 1, 'docmem_delete', '<node_id>');
                return await commands.delete(restArgs[0]);

            case 'docmem_structure':
                requireArgs(restArgs, 1, 'docmem_structure', '<node_id>');
                return await commands.structure(restArgs[0]);

            case 'docmem_search':
                requireArgs(restArgs, 2, 'docmem_search', '<node_id> <pattern> [<mode>]');
                return await commands.search(restArgs[0], restArgs[1], restArgs[2] || 'literal');

            case 'docmem_focus':
                requireArgs(restArgs, 2, 'docmem_focus', '<root_node_id> <node_id>');
                return await commands.focus(restArgs[0], restArgs[1]);

            case 'docmem_add_summary': {
                requireArgs(restArgs, 6, 'docmem_add_summary', '<context_type> <context_name> <context_value> <content> <start_node_id> <end_node_id>');
                const [contextType, contextName, contextValue, content, startNodeId, endNodeId] = restArgs;
                return await commands.addSummary(contextType, contextName, contextValue, content, startNodeId, endNodeId);
            }

            case 'docmem_move_node': {
                requireArgs(restArgs, 3, 'docmem_move_node', '<mode> <node_id> <target_id>');
                const [mode, nodeId, targetId] = restArgs;
                requireMode(mode);
                return await commands.moveNode(mode, nodeId, targetId);
            }

            case 'docmem_copy_node': {
                requireArgs(restArgs, 3, 'docmem_copy_node', '<mode> <node_id> <target_id>');
                const [mode, nodeId, targetId] = restArgs;
                requireMode(mode);
                return await commands.copyNode(mode, nodeId, targetId);
            }

            case 'docmem_get_all_roots':
                return await commands.getAllRoots();

            default:
                return { success: false, result: `unknown docmem command: ${command}` };
        }
    } catch (error) {
        return { success: false, result: error.message };
    }
}

async function executeSystemCommand(args) {
    const [command] = args;

    try {
        const commands = new SystemCommands();

        switch (command) {
            case 'hello_world':
                return commands.helloWorld();

            default:
                return { success: false, result: `unknown system command: ${command}` };
        }
    } catch (error) {
        return { success: false, result: error.message };
    }
}

// suspend and finish end the run after the rest of the block executes.
// The result carries `terminate` so AgentLoop can act on it. Each router
// is built from a lookup of terminator handlers keyed by command name.

function suspendInTask(restArgs) {
    return { success: true, result: 'suspend: run suspended', terminate: 'suspend' };
}

function finishInTask(restArgs) {
    const summary = restArgs.join(' ').replace(/^\n+|\n+$/g, '');
    if (!summary) {
        return { success: false, result: 'requires a summary' };
    }
    return { success: true, result: 'finish: task finished', terminate: 'finish', summary };
}

function noOpOutsideTask(restArgs) {
    return { success: false, result: 'no-op outside a task run' };
}

const TASK_TERMINATORS = { suspend: suspendInTask, finish: finishInTask };
const CHAT_TERMINATORS = { suspend: noOpOutsideTask, finish: noOpOutsideTask };

function buildRouter(terminators) {
    return function router(args, docmem) {
        const [command, ...restArgs] = args;

        if (Object.hasOwn(terminators, command)) {
            return terminators[command](restArgs);
        }

        if (KNOWN_DOCMEM_COMMANDS.has(command)) {
            return executeDocmemCommand(args, docmem);
        }

        if (KNOWN_SYSTEM_COMMANDS.has(command)) {
            return executeSystemCommand(args);
        }

        return { success: false, result: `unknown command. Available: ${[...KNOWN_COMMANDS].sort().join(', ')}` };
    };
}

/** Router for the user-facing chat: suspend and finish are no-ops with a warning. */
export function createChatCommandRouter() {
    return buildRouter(CHAT_TERMINATORS);
}

/** Router for a task run: suspend and finish end the run. */
export function createTaskCommandRouter() {
    return buildRouter(TASK_TERMINATORS);
}
