/**
 * Key - Keyboard event handling utility
 */
export class Key {
    constructor(element) {
        this.element = element;
        this.handlers = new Map();
    }

    /**
     * Register a handler for a specific key with modifiers
     * @param {string} key - The key name (e.g., 'Enter', 'Escape')
     * @param {Function} handler - The handler function to call
     * @param {Object} modifiers - Optional modifier keys { shift: boolean, ctrl: boolean, alt: boolean, meta: boolean }
     */
    on(key, handler, modifiers = {}) {
        const handlerKey = this.buildHandlerKey(key, modifiers);
        
        if (!this.handlers.has(handlerKey)) {
            this.handlers.set(handlerKey, []);
        }
        
        this.handlers.get(handlerKey).push(handler);
        
        // Attach the event listener if this is the first handler
        if (!this.listener) {
            this.listener = (e) => this.handleKeyEvent(e);
            this.element.addEventListener('keypress', this.listener);
        }
    }

    /**
     * Build a unique key for the handlers map
     */
    buildHandlerKey(key, modifiers) {
        const parts = [key];
        if (modifiers.shift) parts.push('shift');
        if (modifiers.ctrl) parts.push('ctrl');
        if (modifiers.alt) parts.push('alt');
        if (modifiers.meta) parts.push('meta');
        return parts.join('+');
    }

    /**
     * Check if event matches the specified modifiers
     */
    matchesModifiers(event, modifiers) {
        return (
            (modifiers.shift === undefined || event.shiftKey === modifiers.shift) &&
            (modifiers.ctrl === undefined || event.ctrlKey === modifiers.ctrl) &&
            (modifiers.alt === undefined || event.altKey === modifiers.alt) &&
            (modifiers.meta === undefined || event.metaKey === modifiers.meta)
        );
    }

    /**
     * Handle keyboard event and dispatch to registered handlers
     */
    handleKeyEvent(event) {
        const key = event.key;
        
        // Try to find matching handlers
        for (const [handlerKey, handlers] of this.handlers.entries()) {
            const [keyName, ...modifierNames] = handlerKey.split('+');
            
            if (keyName !== key) {
                continue;
            }
            
            // Build modifier object from handler key
            const modifiers = {
                shift: modifierNames.includes('shift'),
                ctrl: modifierNames.includes('ctrl'),
                alt: modifierNames.includes('alt'),
                meta: modifierNames.includes('meta')
            };
            
            if (this.matchesModifiers(event, modifiers)) {
                event.preventDefault();
                for (const handler of handlers) {
                    handler(event);
                }
            }
        }
    }

    /**
     * Remove all event listeners and clean up
     */
    destroy() {
        if (this.listener) {
            this.element.removeEventListener('keypress', this.listener);
            this.listener = null;
        }
        this.handlers.clear();
    }
}
