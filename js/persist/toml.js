import { Node, Docmem, NodeHasher } from '../docmem/docmem.js';

export class TomlSerializer {

    escapeKey(key) {
        if (/^[a-zA-Z0-9_-]+$/.test(key)) {
            return key;
        }
        return `"${key.replace(/"/g, '\\"')}"`;
    }

    escapeValue(value) {
        if (typeof value !== 'string') {
            return String(value);
        }
        if (value.includes('\n') || value.includes('"') || value.includes('\\')) {
            return `"""\n${value.replace(/"""/g, '\\"""')}\n"""`;
        }
        return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    }

    formatContext(contextType, contextName, contextValue) {
        return `${contextType}:${contextName}:${contextValue}`;
    }

    parseContext(contextString) {
        const parts = contextString.split(':');
        if (parts.length !== 3) {
            return { contextType: null, contextName: null, contextValue: null };
        }
        return {
            contextType: parts[0],
            contextName: parts[1],
            contextValue: parts[2]
        };
    }

    serializeSection(node) {
        const sectionName = this.escapeKey(node.id);
        const lines = [`[${sectionName}]`];
        
        if (node.parentId) {
            lines.push(`parent-node-id=${this.escapeKey(node.parentId)}`);
        } else {
            lines.push('parent-node-id=');
        }
        
        const contextValue = this.formatContext(node.contextType, node.contextName, node.contextValue);
        lines.push(`context=${this.escapeValue(contextValue)}`);
        
        lines.push(`content=${this.escapeValue(node.text)}`);
        
        if (node.readonly !== undefined && node.readonly !== 0) {
            lines.push(`readonly=${node.readonly}`);
        }
        
        return lines.join('\n');
    }

    serializeToToml(docmem, rootId) {
        const nodes = docmem.getNodes(rootId);
        if (nodes.length === 0) {
            return '';
        }

        const sections = nodes.map(node => this.serializeSection(node));
        return sections.join('\n\n');
    }

    validateNodeData(nodeData) {
        if (nodeData.length === 0) {
            throw new Error('No nodes found in TOML file');
        }

        for (const data of nodeData) {
            if (!data.id) {
                throw new Error('Node missing id in TOML');
            }
        }

        const rootNodes = nodeData.filter(data => !data.parentId);
        
        if (rootNodes.length === 0) {
            throw new Error('No root node found in TOML file');
        }

        if (rootNodes.length > 1) {
            throw new Error('Multiple root nodes found in TOML file');
        }

        return rootNodes[0];
    }

    createNodeFromData(data, parentId, order) {
        const readonly = data.readonly !== undefined ? data.readonly : 0;
        return new Node(
            data.id,
            parentId,
            data.content || '',
            order,
            null,
            null,
            null,
            data.contextType,
            data.contextName,
            data.contextValue,
            readonly
        );
    }

    async buildNodeGraph(docmem, nodeMap, rootData) {
        const processed = new Set();
        let toProcess = Array.from(nodeMap.values());

        while (toProcess.length > 0) {
            let progress = false;
            const remaining = [];

            for (const data of toProcess) {
                if (!data.parentId) {
                    const rootNode = this.createNodeFromData(data, null, 0.0);
                    await NodeHasher.hash(rootNode);
                    await docmem.insertNode(rootNode);
                    processed.add(data.id);
                    progress = true;
                    continue;
                }

                if (processed.has(data.parentId)) {
                    const parentNode = docmem.find(data.parentId);
                    if (!parentNode) {
                        throw new Error(`Parent node ${data.parentId} not found`);
                    }
                    
                    const children = docmem.getChildren(data.parentId);
                    const maxOrder = children.length > 0 
                        ? Math.max(...children.map(c => c.order))
                        : 0.0;
                    const newOrder = maxOrder + 1.0;
                    
                    const newNode = this.createNodeFromData(data, data.parentId, newOrder);
                    await NodeHasher.hash(newNode);
                    await docmem.insertNode(newNode);
                    
                    processed.add(data.id);
                    progress = true;
                    continue;
                }

                remaining.push(data);
            }

            toProcess = remaining;
            
            if (!progress) {
                throw new Error('Circular dependency or orphaned nodes in TOML file');
            }
        }
    }

    async deserializeFromToml(tomlText) {
        const nodeData = this.parseToml(tomlText);
        const rootData = this.validateNodeData(nodeData);

        const nodeMap = new Map();
        for (const data of nodeData) {
            nodeMap.set(data.id, data);
        }

        const docmemId = rootData.id;
        const docmem = new Docmem(docmemId);
        await docmem.ready();

        const existingRoot = docmem.getRootById(docmemId);
        if (existingRoot) {
            docmem.delete(docmemId);
        }

        await this.buildNodeGraph(docmem, nodeMap, rootData);
        return docmem;
    }

    parseMultilineString(lines, startIndex, initialValue) {
        let accumulator = initialValue || '';
        let i = startIndex;

        for (; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();

            if (trimmed === '"""' || trimmed.endsWith('"""')) {
                const endIndex = trimmed === '"""' ? 0 : trimmed.length - 3;
                if (trimmed !== '"""') {
                    accumulator += '\n' + line.slice(0, endIndex).trimEnd();
                }
                return {
                    value: this.unescapeMultilineString(accumulator),
                    nextIndex: i + 1
                };
            } else {
                if (accumulator === '') {
                    accumulator = line;
                } else {
                    accumulator += '\n' + line;
                }
            }
        }

        throw new Error('Unterminated multiline string');
    }

    parseKeyValue(trimmed) {
        const eqIndex = trimmed.indexOf('=');
        if (eqIndex === -1) {
            return null;
        }

        const key = trimmed.slice(0, eqIndex).trim();
        const value = trimmed.slice(eqIndex + 1).trim();
        return { key, value };
    }

    createEmptySection(sectionName) {
        return {
            id: this.unescapeKey(sectionName),
            parentId: null,
            contextType: null,
            contextName: null,
            contextValue: null,
            content: null,
            readonly: 0
        };
    }

    applyKeyValueToSection(section, key, value, state) {
        if (key === 'parent-node-id') {
            section.parentId = value === '' ? null : this.unescapeKey(value);
        } else if (key === 'context') {
            const unescapedValue = this.unescapeValue(value);
            const context = this.parseContext(unescapedValue);
            section.contextType = context.contextType;
            section.contextName = context.contextName;
            section.contextValue = context.contextValue;
        } else if (key === 'content') {
            if (value.startsWith('"""')) {
                if (value.endsWith('"""') && value.length > 6) {
                    const content = value.slice(3, -3);
                    state.currentContent = this.unescapeMultilineString(content);
                } else {
                    state.inMultilineString = true;
                    state.multilineStringAccumulator = value.slice(3);
                }
            } else {
                state.currentContent = this.unescapeValue(value);
            }
        } else if (key === 'readonly') {
            section.readonly = parseInt(value, 10) || 0;
        }
    }

    parseToml(tomlText) {
        const nodes = [];
        const lines = tomlText.split('\n');
        let currentSection = null;
        const state = {
            currentContent: null,
            inMultilineString: false,
            multilineStringAccumulator: ''
        };

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();

            if (trimmed === '' || trimmed.startsWith('#')) {
                continue;
            }

            if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
                if (currentSection) {
                    if (state.currentContent !== null) {
                        currentSection.content = state.currentContent;
                    }
                    nodes.push(currentSection);
                }
                
                const sectionName = trimmed.slice(1, -1).trim();
                currentSection = this.createEmptySection(sectionName);
                state.currentContent = null;
                state.inMultilineString = false;
                state.multilineStringAccumulator = '';
                continue;
            }

            if (!currentSection) {
                continue;
            }

            if (state.inMultilineString) {
                const result = this.parseMultilineString(lines, i, state.multilineStringAccumulator);
                state.currentContent = result.value;
                i = result.nextIndex - 1;
                state.inMultilineString = false;
                state.multilineStringAccumulator = '';
                continue;
            }

            const kv = this.parseKeyValue(trimmed);
            if (!kv) {
                continue;
            }

            this.applyKeyValueToSection(currentSection, kv.key, kv.value, state);
        }

        if (currentSection) {
            if (state.currentContent !== null) {
                currentSection.content = state.currentContent;
            }
            nodes.push(currentSection);
        }

        return nodes;
    }

    unescapeKey(key) {
        if (key.startsWith('"') && key.endsWith('"')) {
            return key.slice(1, -1).replace(/\\"/g, '"');
        }
        return key;
    }

    unescapeValue(value) {
        if (value.startsWith('"""') && value.endsWith('"""')) {
            return this.unescapeMultilineString(value.slice(3, -3));
        }
        if (value.startsWith('"') && value.endsWith('"')) {
            return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
        }
        return value;
    }

    unescapeMultilineString(value) {
        return value.replace(/\\"""/g, '"""').trim();
    }

    async saveToFile(docmem, rootId, filename) {
        const tomlContent = this.serializeToToml(docmem, rootId);
        const blob = new Blob([tomlContent], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename || `${rootId}.toml`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    async loadFromFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const tomlText = e.target.result;
                    resolve(tomlText);
                } catch (error) {
                    reject(error);
                }
            };
            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsText(file);
        });
    }
}

