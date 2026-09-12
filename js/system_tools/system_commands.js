/**
 * SystemCommands - Command wrapper class for system operations
 */
export const KNOWN_SYSTEM_COMMANDS = new Set([
    'hello_world',
    'suspend', 'finish',
]);

export class SystemCommands {
    constructor() {
    }

    helloWorld() {
        return { success: true, result: 'hello_world: Hello, World!' };
    }
}

