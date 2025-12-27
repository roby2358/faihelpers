class TomlSerializer {
    constructor() {
        this.currentRootId = null;
    }

    setRootId(rootId) {
        this.currentRootId = rootId;
    }

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

    serializeToToml(docmem, rootId) {
        const nodes = docmem.serialize(rootId);
        if (nodes.length === 0) {
            return '';
        }

        const sections = [];
        for (const node of nodes) {
            const sectionName = this.escapeKey(node.id);
            const lines = [`[${sectionName}]`];
            
            if (node.parentId) {
                lines.push(`parent-node-id=${this.escapeKey(node.parentId)}`);
            } else {
                lines.push('parent-node-id=');
            }
            
            const contextValue = `${node.contextType}:${node.contextName}:${node.contextValue}`;
            lines.push(`context=${this.escapeValue(contextValue)}`);
            
            lines.push(`content=${this.escapeValue(node.text)}`);
            
            sections.push(lines.join('\n'));
        }

        return sections.join('\n\n');
    }

    async deserializeFromToml(tomlText) {
        const nodeData = this.parseToml(tomlText);
        
        if (nodeData.length === 0) {
            throw new Error('No nodes found in TOML file');
        }

        const nodeMap = new Map();
        const rootNodes = [];

        for (const data of nodeData) {
            if (!data.id) {
                throw new Error('Node missing id in TOML');
            }

            if (!data.parentId) {
                rootNodes.push(data);
            }

            nodeMap.set(data.id, data);
        }

        if (rootNodes.length === 0) {
            throw new Error('No root node found in TOML file');
        }

        if (rootNodes.length > 1) {
            throw new Error('Multiple root nodes found in TOML file');
        }

        const rootData = rootNodes[0];
        const docmemId = rootData.id;
        
        const docmem = new Docmem(docmemId);
        await docmem.ready();

        const existingRoot = docmem._getRootById(docmemId);
        if (existingRoot) {
            docmem.delete(docmemId);
        }

        const processed = new Set();
        const toProcess = Array.from(nodeMap.values());

        while (toProcess.length > 0) {
            let progress = false;
            for (let i = toProcess.length - 1; i >= 0; i--) {
                const data = toProcess[i];
                
                if (!data.parentId) {
                    const rootNode = new Node(
                        data.id,
                        null,
                        data.content || '',
                        0.0,
                        null,
                        null,
                        null,
                        data.contextType,
                        data.contextName,
                        data.contextValue
                    );
                    docmem._insertNode(rootNode);
                    processed.add(data.id);
                    toProcess.splice(i, 1);
                    progress = true;
                    continue;
                }

                if (processed.has(data.parentId)) {
                    const parentNode = docmem.find(data.parentId);
                    if (!parentNode) {
                        throw new Error(`Parent node ${data.parentId} not found`);
                    }
                    
                    const children = docmem._getChildren(data.parentId);
                    const maxOrder = children.length > 0 
                        ? Math.max(...children.map(c => c.order))
                        : 0.0;
                    const newOrder = maxOrder + 1.0;
                    
                    const newNode = new Node(
                        data.id,
                        data.parentId,
                        data.content || '',
                        newOrder,
                        null,
                        null,
                        null,
                        data.contextType,
                        data.contextName,
                        data.contextValue
                    );
                    docmem._insertNode(newNode);
                    
                    processed.add(data.id);
                    toProcess.splice(i, 1);
                    progress = true;
                }
            }
            
            if (!progress) {
                throw new Error('Circular dependency or orphaned nodes in TOML file');
            }
        }

        return docmem;
    }

    parseToml(tomlText) {
        const nodes = [];
        const lines = tomlText.split('\n');
        let currentSection = null;
        let currentContent = null;
        let inMultilineString = false;
        let multilineStringAccumulator = '';

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();

            if (trimmed === '' || trimmed.startsWith('#')) {
                continue;
            }

            if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
                if (currentSection) {
                    if (currentContent !== null) {
                        currentSection.content = currentContent;
                    }
                    nodes.push(currentSection);
                }
                
                const sectionName = trimmed.slice(1, -1).trim();
                currentSection = {
                    id: this.unescapeKey(sectionName),
                    parentId: null,
                    contextType: null,
                    contextName: null,
                    contextValue: null,
                    content: null
                };
                currentContent = null;
                inMultilineString = false;
                multilineStringAccumulator = '';
                continue;
            }

            if (!currentSection) {
                continue;
            }

            if (inMultilineString) {
                if (trimmed === '"""' || trimmed.endsWith('"""')) {
                    const endIndex = trimmed === '"""' ? 0 : trimmed.length - 3;
                    if (trimmed !== '"""') {
                        multilineStringAccumulator += '\n' + line.slice(0, endIndex).trimEnd();
                    }
                    currentContent = this.unescapeMultilineString(multilineStringAccumulator);
                    multilineStringAccumulator = '';
                    inMultilineString = false;
                } else {
                    if (multilineStringAccumulator === '') {
                        multilineStringAccumulator = line;
                    } else {
                        multilineStringAccumulator += '\n' + line;
                    }
                }
                continue;
            }

            const eqIndex = trimmed.indexOf('=');
            if (eqIndex === -1) {
                continue;
            }

            const key = trimmed.slice(0, eqIndex).trim();
            let value = trimmed.slice(eqIndex + 1).trim();

            if (key === 'parent-node-id') {
                currentSection.parentId = value === '' ? null : this.unescapeKey(value);
            } else if (key === 'context') {
                value = this.unescapeValue(value);
                const parts = value.split(':');
                if (parts.length === 3) {
                    currentSection.contextType = parts[0];
                    currentSection.contextName = parts[1];
                    currentSection.contextValue = parts[2];
                }
            } else if (key === 'content') {
                if (value.startsWith('"""')) {
                    if (value.endsWith('"""') && value.length > 6) {
                        const content = value.slice(3, -3);
                        currentContent = this.unescapeMultilineString(content);
                    } else {
                        inMultilineString = true;
                        multilineStringAccumulator = value.slice(3);
                    }
                } else {
                    currentContent = this.unescapeValue(value);
                }
            }
        }

        if (currentSection) {
            if (currentContent !== null) {
                currentSection.content = currentContent;
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

