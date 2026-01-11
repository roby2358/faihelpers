let currentDocmem = null;
let selectedPersistRootId = null;
let selectedViewRootId = null;

function showMessage(text, type = 'info') {
    const messageBar = document.getElementById('message-bar');
    const messageText = document.getElementById('message-text');
    
    messageText.textContent = text;
    messageBar.className = `message-bar ${type}`;
}

document.addEventListener('DOMContentLoaded', async () => {
    initTabs();
    initDocmem();
    initView();
    initPersist();
    
    // Seed all registered docmems
    if (typeof window.seedAllDocmems === 'function') {
        try {
            await window.seedAllDocmems();
        } catch (error) {
            console.warn('Error seeding docmems:', error);
        }
    }
    
    // Initial render to show roots list
    renderDocmem();
});

function initTabs() {
    const tabButtons = document.querySelectorAll('.tab-button');
    const tabContents = document.querySelectorAll('.tab-content');

    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const targetTab = button.getAttribute('data-tab');

            // Update button states
            tabButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');

            // Update content visibility
            tabContents.forEach(content => content.classList.remove('active'));
            document.getElementById(`${targetTab}-tab`).classList.add('active');
            
            // Refresh view tab when switching to it
            if (targetTab === 'view') {
                renderView();
                initView();
            }
            // Refresh persist tab when switching to it
            if (targetTab === 'persist') {
                renderPersist();
            }
        });
    });
}

function initDocmem() {
    const createBtn = document.getElementById('create-docmem-btn');
    const refreshBtn = document.getElementById('refresh-roots-btn');
    const docmemIdInput = document.getElementById('docmem-id-input');

    createBtn.addEventListener('click', async () => {
        const docmemId = docmemIdInput.value.trim() || `docmem_${Date.now()}`;
        await createDocmem(docmemId);
    });

    refreshBtn.addEventListener('click', () => {
        renderDocmem();
    });
}

async function createDocmem(docmemId) {
    try {
        currentDocmem = new Docmem(docmemId);
        await currentDocmem.ready();
        renderDocmem();
        showMessage(`Docmem created: ${docmemId}`, 'success');
    } catch (error) {
        console.error('Error creating docmem:', error);
        showMessage('Error creating docmem: ' + error.message, 'error');
    }
}

async function loadDocmem(docmemId) {
    try {
        currentDocmem = new Docmem(docmemId);
        await currentDocmem.ready();
        renderDocmem();
        const docmemIdInput = document.getElementById('docmem-id-input');
        if (docmemIdInput) {
            docmemIdInput.value = docmemId;
        }
    } catch (error) {
        console.error('Error loading docmem:', error);
        showMessage('Error loading docmem: ' + error.message, 'error');
    }
}

function renderDocmem() {
    const container = document.getElementById('docmem-container');
    
    if (!currentDocmem) {
        // Show only roots list when no docmem is loaded
        container.innerHTML = `
            <div class="operation-controls">
                <div class="operation-section">
                    <h3>All Docmem Roots</h3>
                    <div id="roots-list"></div>
                </div>
            </div>
        `;
        renderRootsList();
        return;
    }

    const root = currentDocmem.getRoot();
    
    container.innerHTML = `
        <div class="operation-section" style="margin-bottom: 2rem;">
            <h3>All Docmem Roots</h3>
            <div id="roots-list"></div>
        </div>
        <div class="expand-controls">
            <label>Expand to token limit:</label>
            <input type="number" id="expand-token-limit" value="1000" min="1" />
            <button id="expand-btn">Expand</button>
            <button id="serialize-btn">Serialize</button>
        </div>
        <div class="operation-controls">
            <h3>Operations</h3>
            <div class="operation-section">
                <h4>Append Child</h4>
                <div class="input-row">
                    <input type="text" id="append-parent-id" placeholder="Parent Node ID" />
                    <input type="text" id="append-context-type" placeholder="Context Type" />
                    <input type="text" id="append-context-name" placeholder="Context Name" />
                    <input type="text" id="append-context-value" placeholder="Context Value" />
                </div>
                <textarea id="append-content" placeholder="Content"></textarea>
                <button id="append-btn">Append</button>
            </div>
            <div class="operation-section">
                <h4>Insert Before</h4>
                <div class="input-row">
                    <input type="text" id="insert-before-node-id" placeholder="Node ID" />
                </div>
                <div class="input-row">
                    <input type="text" id="insert-before-context-type" placeholder="Context Type" />
                    <input type="text" id="insert-before-context-name" placeholder="Context Name" />
                    <input type="text" id="insert-before-context-value" placeholder="Context Value" />
                </div>
                <textarea id="insert-before-content" placeholder="Content"></textarea>
                <button id="insert-before-btn">Insert Before</button>
            </div>
            <div class="operation-section">
                <h4>Insert After</h4>
                <div class="input-row">
                    <input type="text" id="insert-after-node-id" placeholder="Node ID" />
                </div>
                <div class="input-row">
                    <input type="text" id="insert-after-context-type" placeholder="Context Type" />
                    <input type="text" id="insert-after-context-name" placeholder="Context Name" />
                    <input type="text" id="insert-after-context-value" placeholder="Context Value" />
                </div>
                <textarea id="insert-after-content" placeholder="Content"></textarea>
                <button id="insert-after-btn">Insert After</button>
            </div>
            <div class="operation-section">
                <h4>Update Content</h4>
                <div class="input-row">
                    <input type="text" id="update-node-id" placeholder="Node ID" />
                </div>
                <textarea id="update-content" placeholder="New Content"></textarea>
                <button id="update-btn">Update</button>
            </div>
            <div class="operation-section">
                <h4>Add Summary</h4>
                <div class="input-row">
                    <input type="text" id="summary-start-node-id" placeholder="Start Node ID" />
                    <input type="text" id="summary-end-node-id" placeholder="End Node ID" />
                </div>
                <div class="input-row">
                    <input type="text" id="summary-context-type" placeholder="Context Type" />
                    <input type="text" id="summary-context-name" placeholder="Context Name" />
                    <input type="text" id="summary-context-value" placeholder="Context Value" />
                </div>
                <textarea id="summary-content" placeholder="Summary Content"></textarea>
                <button id="summary-btn">Add Summary</button>
            </div>
        </div>
        <div id="docmem-tree" class="docmem-tree"></div>
        <div id="expanded-content" class="expanded-content" style="display: none;"></div>
    `;

    renderTree(root, document.getElementById('docmem-tree'));
    renderRootsList();

    const expandBtn = document.getElementById('expand-btn');
    const serializeBtn = document.getElementById('serialize-btn');
    const expandTokenLimit = document.getElementById('expand-token-limit');

    expandBtn.addEventListener('click', () => {
        const maxTokens = parseInt(expandTokenLimit.value) || 1000;
        // Use root node ID for expand in the UI
        const rootId = root.id;
        const expanded = currentDocmem.expandToLength(rootId, maxTokens);
        renderExpanded(expanded);
    });

    serializeBtn.addEventListener('click', () => {
        // Use root node ID for serialize in the UI
        const rootId = root.id;
        const serialized = currentDocmem.getNodes(rootId);
        renderExpanded(serialized);
    });

    // Operation handlers
    const appendBtn = document.getElementById('append-btn');
    appendBtn.addEventListener('click', () => {
        const parentId = document.getElementById('append-parent-id').value.trim();
        const contextType = document.getElementById('append-context-type').value.trim();
        const contextName = document.getElementById('append-context-name').value.trim();
        const contextValue = document.getElementById('append-context-value').value.trim();
        const content = document.getElementById('append-content').value.trim();
        
        if (!parentId || !content || !contextType || !contextName || !contextValue) {
            showMessage('Parent ID, content, and all context fields are required', 'error');
            return;
        }
        
        try {
            const node = currentDocmem.appendChild(parentId, contextType, contextName, contextValue, content);
            showMessage(`Node created: ${node.id}`, 'success');
            renderDocmem();
        } catch (error) {
            showMessage('Error: ' + error.message, 'error');
        }
    });

    const insertBeforeBtn = document.getElementById('insert-before-btn');
    insertBeforeBtn.addEventListener('click', () => {
        const nodeId = document.getElementById('insert-before-node-id').value.trim();
        const contextType = document.getElementById('insert-before-context-type').value.trim();
        const contextName = document.getElementById('insert-before-context-name').value.trim();
        const contextValue = document.getElementById('insert-before-context-value').value.trim();
        const content = document.getElementById('insert-before-content').value.trim();
        
        if (!nodeId || !content || !contextType || !contextName || !contextValue) {
            showMessage('Node ID, content, and all context fields are required', 'error');
            return;
        }
        
        try {
            const node = currentDocmem.insertBefore(nodeId, contextType, contextName, contextValue, content);
            showMessage(`Node inserted before: ${node.id}`, 'success');
            renderDocmem();
        } catch (error) {
            showMessage('Error: ' + error.message, 'error');
        }
    });

    const insertAfterBtn = document.getElementById('insert-after-btn');
    insertAfterBtn.addEventListener('click', () => {
        const nodeId = document.getElementById('insert-after-node-id').value.trim();
        const contextType = document.getElementById('insert-after-context-type').value.trim();
        const contextName = document.getElementById('insert-after-context-name').value.trim();
        const contextValue = document.getElementById('insert-after-context-value').value.trim();
        const content = document.getElementById('insert-after-content').value.trim();
        
        if (!nodeId || !content || !contextType || !contextName || !contextValue) {
            showMessage('Node ID, content, and all context fields are required', 'error');
            return;
        }
        
        try {
            const node = currentDocmem.insertAfter(nodeId, contextType, contextName, contextValue, content);
            showMessage(`Node inserted after: ${node.id}`, 'success');
            renderDocmem();
        } catch (error) {
            showMessage('Error: ' + error.message, 'error');
        }
    });

    const updateBtn = document.getElementById('update-btn');
    updateBtn.addEventListener('click', () => {
        const nodeId = document.getElementById('update-node-id').value.trim();
        const content = document.getElementById('update-content').value.trim();
        
        if (!nodeId || !content) {
            showMessage('Node ID and content are required', 'error');
            return;
        }
        
        try {
            const node = currentDocmem.updateContent(nodeId, content);
            showMessage(`Node updated: ${node.id}`, 'success');
            renderDocmem();
        } catch (error) {
            showMessage('Error: ' + error.message, 'error');
        }
    });

    const summaryBtn = document.getElementById('summary-btn');
    summaryBtn.addEventListener('click', () => {
        const startNodeId = document.getElementById('summary-start-node-id').value.trim();
        const endNodeId = document.getElementById('summary-end-node-id').value.trim();
        const content = document.getElementById('summary-content').value.trim();
        const contextType = document.getElementById('summary-context-type').value.trim();
        const contextName = document.getElementById('summary-context-name').value.trim();
        const contextValue = document.getElementById('summary-context-value').value.trim();
        
        if (!startNodeId || !endNodeId || !content || !contextType || !contextName || !contextValue) {
            showMessage('Start node ID, end node ID, summary content, and all context fields are required', 'error');
            return;
        }
        
        try {
            const node = currentDocmem.addSummary(startNodeId, endNodeId, content, contextType, contextName, contextValue);
            showMessage(`Summary created: ${node.id}`, 'success');
            renderDocmem();
        } catch (error) {
            showMessage('Error: ' + error.message, 'error');
        }
    });
}

function renderTree(node, container, depth = 0) {
    const nodeDiv = document.createElement('div');
    nodeDiv.className = `docmem-node ${node.contextType}`;
    
    const children = currentDocmem.getChildren(node.id);
    const hasChildren = children.length > 0;
    // Expand root node (no parent) or nodes at depth 0, or nodes with children
    const isExpanded = node.parentId === null || depth === 0 || hasChildren;

    nodeDiv.innerHTML = `
        <div class="docmem-node-header" data-node-id="${node.id}">
            ${hasChildren ? `<span class="docmem-expand-icon">${isExpanded ? '▼' : '▶'}</span>` : '<span class="docmem-expand-icon"> </span>'}
            <span class="docmem-node-type">${escapeHtml(node.contextType)} ${escapeHtml(node.contextName)}:${escapeHtml(node.contextValue)} (<span class="node-id-copy" data-node-id="${node.id}">${node.id}</span>)</span>
            <span class="docmem-node-meta">(tokens: ${node.tokenCount}, order: ${node.order.toFixed(3)})</span>
            <button class="node-action-btn" data-action="append" data-node-id="${node.id}" title="Append child">+</button>
            <button class="node-action-btn" data-action="update" data-node-id="${node.id}" title="Update content">✎</button>
            <button class="node-action-btn delete-btn" data-action="delete" data-node-id="${node.id}" title="Delete node">X</button>
        </div>
        ${node.text ? `<div class="docmem-node-text">${escapeHtml(node.text)}</div>` : ''}
        ${isExpanded && hasChildren ? `<div class="docmem-node-children" data-parent-id="${node.id}"></div>` : ''}
    `;

    container.appendChild(nodeDiv);

    // Add click handlers for node action buttons
    const actionButtons = nodeDiv.querySelectorAll('.node-action-btn');
    actionButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const action = btn.getAttribute('data-action');
            const nodeId = btn.getAttribute('data-node-id');
            handleNodeAction(action, nodeId);
        });
    });

    // Add click handler to copy node ID
    const nodeIdSpan = nodeDiv.querySelector('.node-id-copy');
    if (nodeIdSpan) {
        nodeIdSpan.style.cursor = 'pointer';
        nodeIdSpan.style.textDecoration = 'underline';
        nodeIdSpan.addEventListener('click', (e) => {
            e.stopPropagation();
            navigator.clipboard.writeText(nodeIdSpan.getAttribute('data-node-id'));
            showMessage('Node ID copied to clipboard', 'success');
        });
    }

    if (hasChildren) {
        const header = nodeDiv.querySelector('.docmem-node-header');
        const childrenContainer = nodeDiv.querySelector('.docmem-node-children');

        header.addEventListener('click', () => {
            if (childrenContainer) {
                const isCurrentlyExpanded = childrenContainer.style.display !== 'none';
                if (isCurrentlyExpanded) {
                    childrenContainer.style.display = 'none';
                    header.querySelector('.docmem-expand-icon').textContent = '▶';
                } else {
                    childrenContainer.style.display = 'block';
                    header.querySelector('.docmem-expand-icon').textContent = '▼';
                    if (childrenContainer.children.length === 0) {
                        const sortedChildren = [...children].sort((a, b) => a.order - b.order);
                        sortedChildren.forEach(child => {
                            renderTree(child, childrenContainer, depth + 1);
                        });
                    }
                }
            }
        });

        if (isExpanded && childrenContainer) {
            const sortedChildren = [...children].sort((a, b) => a.order - b.order);
            sortedChildren.forEach(child => {
                renderTree(child, childrenContainer, depth + 1);
            });
        }
    }
}

function renderExpanded(nodes) {
    const container = document.getElementById('expanded-content');
    container.style.display = 'block';
    
    let totalTokens = 0;
    container.innerHTML = `
        <h3>Expanded Content (${nodes.length} nodes)</h3>
        <div id="expanded-nodes"></div>
    `;

    const nodesContainer = document.getElementById('expanded-nodes');
    
    nodes.forEach(node => {
        totalTokens += node.tokenCount;
        const nodeDiv = document.createElement('div');
        nodeDiv.className = 'expanded-node';
        nodeDiv.innerHTML = `
            <div class="docmem-node-type">${escapeHtml(node.contextType)} ${escapeHtml(node.contextName)}:${escapeHtml(node.contextValue)}</div>
            <div class="docmem-node-text">${escapeHtml(node.text)}</div>
            <div class="docmem-node-meta">Tokens: ${node.tokenCount} | Order: ${node.order.toFixed(3)}</div>
        `;
        nodesContainer.appendChild(nodeDiv);
    });

    const header = container.querySelector('h3');
    header.textContent = `Expanded Content (${nodes.length} nodes, ${totalTokens} total tokens)`;
}

function handleNodeAction(action, nodeId) {
    switch (action) {
        case 'append':
            document.getElementById('append-parent-id').value = nodeId;
            document.getElementById('append-parent-id').scrollIntoView({ behavior: 'smooth', block: 'center' });
            break;
        case 'update':
            const node = currentDocmem.find(nodeId);
            if (node) {
                document.getElementById('update-node-id').value = nodeId;
                document.getElementById('update-content').value = node.text;
                document.getElementById('update-node-id').scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
            break;
        case 'delete':
            const nodeToDelete = currentDocmem.find(nodeId);
            if (!nodeToDelete) {
                showMessage('Node not found', 'error');
                return;
            }
            if (nodeToDelete.parentId === null) {
                showMessage('Cannot delete root node', 'error');
                return;
            }
            if (confirm(`Are you sure you want to delete node ${nodeId}? This will also delete all its children.`)) {
                try {
                    currentDocmem.delete(nodeId);
                    showMessage(`Node deleted: ${nodeId}`, 'success');
                    renderDocmem();
                } catch (error) {
                    showMessage('Error: ' + error.message, 'error');
                }
            }
            break;
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function renderRootsList() {
    const rootsListDiv = document.getElementById('roots-list');
    if (!rootsListDiv) {
        return;
    }

    try {
        const roots = Docmem.getAllRoots();
        
        if (roots.length === 0) {
            rootsListDiv.innerHTML = '<div>No root nodes found</div>';
            return;
        }

        rootsListDiv.innerHTML = roots.map(root => `
            <div class="found-node">
                <strong>Root Node:</strong><br/>
                ID: <span class="node-id-copy" data-node-id="${root.id}" style="color: #0066cc; cursor: pointer; text-decoration: underline;">${root.id}</span><br/>
                Content: ${escapeHtml(root.text) || '(empty)'}<br/>
                Tokens: ${root.tokenCount}<br/>
                Order: ${root.order.toFixed(3)}<br/>
                Created: ${root.createdAt}<br/>
                Context Type: ${escapeHtml(root.contextType)}<br/>
                Context Name: ${escapeHtml(root.contextName)}<br/>
                Context Value: ${escapeHtml(root.contextValue)}
            </div>
        `).join('<hr style="margin: 0.5rem 0;"/>');

        // Add click handlers to copy node IDs and load docmem
        rootsListDiv.querySelectorAll('.node-id-copy').forEach(span => {
            span.addEventListener('click', async (e) => {
                e.stopPropagation();
                const docmemId = span.getAttribute('data-node-id');
                navigator.clipboard.writeText(docmemId);
                await loadDocmem(docmemId);
                showMessage(`Docmem loaded: ${docmemId}`, 'success');
            });
        });
    } catch (error) {
        rootsListDiv.innerHTML = `<div>Error loading roots: ${escapeHtml(error.message)}</div>`;
    }
}

function initView() {
    const expandBtn = document.getElementById('view-expand-btn');
    const expandAllBtn = document.getElementById('view-expand-all-btn');
    const serializeBtn = document.getElementById('view-serialize-btn');
    const structureBtn = document.getElementById('view-structure-btn');
    
    if (expandBtn) {
        expandBtn.addEventListener('click', () => {
            if (!selectedViewRootId) {
                showMessage('No root selected', 'error');
                return;
            }
            const tokenInput = document.getElementById('view-token-limit');
            const maxTokens = parseInt(tokenInput.value);
            if (!maxTokens || maxTokens < 1) {
                showMessage('Please enter a valid token limit', 'error');
                return;
            }
            renderViewExpanded(selectedViewRootId, maxTokens);
        });
    }
    
    if (expandAllBtn) {
        expandAllBtn.addEventListener('click', () => {
            if (!selectedViewRootId) {
                showMessage('No root selected', 'error');
                return;
            }
            // Expand with a very large token limit to get all nodes
            const maxTokens = 1000000;
            renderViewExpanded(selectedViewRootId, maxTokens);
        });
    }
    
    if (serializeBtn) {
        serializeBtn.addEventListener('click', async () => {
            if (!selectedViewRootId) {
                showMessage('No root selected', 'error');
                return;
            }
            await renderViewSerialized(selectedViewRootId);
        });
    }
    
    if (structureBtn) {
        structureBtn.addEventListener('click', async () => {
            if (!selectedViewRootId) {
                showMessage('No root selected', 'error');
                return;
            }
            await renderViewStructure(selectedViewRootId);
        });
    }
}

function renderView() {
    const rootsBar = document.getElementById('view-roots-bar');
    const contentPanel = document.getElementById('view-content-panel');
    
    if (!rootsBar || !contentPanel) {
        return;
    }
    
    try {
        const roots = Docmem.getAllRoots();
        
        if (roots.length === 0) {
            rootsBar.innerHTML = '<div class="view-no-roots">No root nodes found</div>';
            contentPanel.innerHTML = '<div class="view-no-content">Select a root node to view its expanded content</div>';
            selectedViewRootId = null;
            return;
        }
        
        // Preserve selected root or default to first
        if (!selectedViewRootId || !roots.find(r => r.id === selectedViewRootId)) {
            selectedViewRootId = roots[0].id;
        }
        
        // Render root links
        rootsBar.innerHTML = roots.map((root) => `
            <a href="#" class="view-root-link ${root.id === selectedViewRootId ? 'active' : ''}" data-root-id="${root.id}">
                ${escapeHtml(root.id)}
            </a>
        `).join('');
        
        // Add click handlers
        rootsBar.querySelectorAll('.view-root-link').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                // Update active state
                rootsBar.querySelectorAll('.view-root-link').forEach(l => l.classList.remove('active'));
                link.classList.add('active');
                
                // Track selected root and display expanded content with large token limit
                const rootId = link.getAttribute('data-root-id');
                selectedViewRootId = rootId;
                renderViewExpanded(rootId, 1000000);
            });
        });
        
        // Load selected root with large token limit
        renderViewExpanded(selectedViewRootId, 1000000);
    } catch (error) {
        rootsBar.innerHTML = `<div class="view-error">Error loading roots: ${escapeHtml(error.message)}</div>`;
        contentPanel.innerHTML = '';
    }
}


async function renderViewExpanded(rootId, maxTokens) {
    const contentPanel = document.getElementById('view-content-panel');
    
    if (!contentPanel) {
        return;
    }
    
    try {
        const docmem = new Docmem(rootId);
        await docmem.ready();
        
        // Expand to token limit from the root node
        const expanded = docmem.expandToLength(rootId, maxTokens);
        
        if (expanded.length === 0) {
            contentPanel.innerHTML = '<div class="view-no-content">No content to display</div>';
            return;
        }
        
        // Render expanded content as contiguous text
        const textContent = expanded.map(node => {
            const header = `${node.id} ${node.contextType} ${node.contextName}:${node.contextValue} ${node.createdAt}`;
            const content = node.text || '';
            return `${header}\n${content}`;
        }).join('\n\n');
        
        // Calculate total tokens
        const totalTokens = expanded.reduce((sum, node) => sum + (node.tokenCount || 0), 0);
        
        // Use a pre element to preserve formatting and display as plain text
        const pre = document.createElement('pre');
        pre.className = 'view-serialized-text';
        pre.textContent = textContent;
        contentPanel.innerHTML = `<div class="view-stats">${expanded.length} nodes, ${totalTokens} tokens (expanded to ${maxTokens})</div>`;
        contentPanel.appendChild(pre);
    } catch (error) {
        contentPanel.innerHTML = `<div class="view-error">Error loading content: ${escapeHtml(error.message)}</div>`;
    }
}

async function renderViewSerialized(rootId) {
    const contentPanel = document.getElementById('view-content-panel');
    
    if (!contentPanel) {
        return;
    }
    
    try {
        const docmem = new Docmem(rootId);
        await docmem.ready();
        
        // Serialize in preorder traversal
        const nodes = docmem.getNodes(rootId);
        
        if (nodes.length === 0) {
            contentPanel.innerHTML = '<div class="view-no-content">No content to display</div>';
            return;
        }
        
        // Concatenate content: trim each node's text and join with \n\n
        const serializedContent = nodes
            .map(node => (node.text || '').trim())
            .join('\n\n');
        
        // Calculate total tokens
        const totalTokens = nodes.reduce((sum, node) => sum + (node.tokenCount || 0), 0);
        
        // Use a pre element to preserve formatting and display as plain text
        const pre = document.createElement('pre');
        pre.className = 'view-serialized-text';
        pre.textContent = serializedContent;
        contentPanel.innerHTML = `<div class="view-stats">${nodes.length} nodes, ${totalTokens} tokens (serialized)</div>`;
        contentPanel.appendChild(pre);
    } catch (error) {
        contentPanel.innerHTML = `<div class="view-error">Error serializing content: ${escapeHtml(error.message)}</div>`;
    }
}

async function renderViewStructure(rootId) {
    const contentPanel = document.getElementById('view-content-panel');
    
    if (!contentPanel) {
        return;
    }
    
    try {
        const docmem = new Docmem(rootId);
        await docmem.ready();
        
        // Get structure (nodes without text content)
        const structure = docmem.structure(rootId);
        
        if (structure.length === 0) {
            contentPanel.innerHTML = '<div class="view-no-content">No structure to display</div>';
            return;
        }
        
        // Build node map for quick lookup
        const nodeMap = new Map();
        structure.forEach(node => nodeMap.set(node.id, node));
        
        // Calculate depth for each node with memoization
        const depthMap = new Map();
        const getDepth = (nodeId) => {
            if (depthMap.has(nodeId)) {
                return depthMap.get(nodeId);
            }
            if (nodeId === rootId || !nodeId) {
                depthMap.set(nodeId, 0);
                return 0;
            }
            const node = nodeMap.get(nodeId);
            if (!node || !node.parentId) {
                depthMap.set(nodeId, 0);
                return 0;
            }
            const depth = 1 + getDepth(node.parentId);
            depthMap.set(nodeId, depth);
            return depth;
        };
        
        // Format each node like expand format: id contextType contextName:contextValue createdAt
        const textContent = structure.map(node => {
            const depth = getDepth(node.id);
            const indent = '  '.repeat(depth);
            const header = `${node.id} ${node.contextType} ${node.contextName}:${node.contextValue} ${node.createdAt}`;
            return `${indent}${header}`;
        }).join('\n');
        
        // Calculate total tokens
        const totalTokens = structure.reduce((sum, node) => sum + (node.tokenCount || 0), 0);
        
        // Use a pre element to preserve formatting and display as plain text
        const pre = document.createElement('pre');
        pre.className = 'view-serialized-text';
        pre.textContent = textContent;
        contentPanel.innerHTML = `<div class="view-stats">${structure.length} nodes, ${totalTokens} tokens (structure)</div>`;
        contentPanel.appendChild(pre);
    } catch (error) {
        contentPanel.innerHTML = `<div class="view-error">Error getting structure: ${escapeHtml(error.message)}</div>`;
    }
}


function initPersist() {
    const saveBtn = document.getElementById('persist-save-btn');
    const loadBtn = document.getElementById('persist-load-btn');
    const fileInput = document.getElementById('persist-file-input');
    const uploadTextBtn = document.getElementById('persist-upload-text-btn');
    const textFileInput = document.getElementById('persist-text-file-input');
    const uploadParagraphBtn = document.getElementById('persist-upload-paragraph-btn');
    const paragraphFileInput = document.getElementById('persist-paragraph-file-input');

    if (saveBtn) {
        saveBtn.addEventListener('click', async () => {
            try {
                const roots = Docmem.getAllRoots();
                if (roots.length === 0) {
                    showMessage('No docmem roots found to save', 'error');
                    return;
                }

                let selectedRootId = selectedPersistRootId;
                if (!selectedRootId || !roots.find(r => r.id === selectedRootId)) {
                    selectedRootId = roots[0].id;
                    selectedPersistRootId = selectedRootId;
                }
                const docmem = new Docmem(selectedRootId);
                await docmem.ready();
                
                const tomlSerializer = new TomlSerializer();
                const filename = `${selectedRootId}.toml`;
                await tomlSerializer.saveToFile(docmem, selectedRootId, filename);
                showMessage(`Saved ${filename}`, 'success');
            } catch (error) {
                console.error('Error saving TOML:', error);
                showMessage('Error saving TOML: ' + error.message, 'error');
            }
        });
    }

    if (loadBtn) {
        loadBtn.addEventListener('click', () => {
            if (fileInput) {
                fileInput.click();
            }
        });
    }

    if (fileInput) {
        fileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) {
                return;
            }

            try {
                const tomlSerializer = new TomlSerializer();
                const tomlText = await tomlSerializer.loadFromFile(file);
                const nodeData = tomlSerializer.parseToml(tomlText);
                
                if (nodeData.length === 0) {
                    showMessage('No nodes found in TOML file', 'error');
                    return;
                }

                const docmem = await tomlSerializer.deserializeFromToml(tomlText);
                const docmemId = docmem.docmemId;
                
                showMessage(`Loaded docmem: ${docmemId}`, 'success');
                await loadDocmem(docmemId);
                renderPersist();
            } catch (error) {
                console.error('Error loading TOML:', error);
                showMessage('Error loading TOML: ' + error.message, 'error');
            } finally {
                fileInput.value = '';
            }
        });
    }

    if (uploadTextBtn) {
        uploadTextBtn.addEventListener('click', () => {
            if (textFileInput) {
                textFileInput.click();
            }
        });
    }

    if (textFileInput) {
        textFileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) {
                return;
            }

            try {
                const lineImporter = new LineImporter();
                const { docmem, selectedRootId, createdCount } = await lineImporter.createDocmemFromFile(file);

                showMessage(`Created ${createdCount} nodes from ${file.name}`, 'success');
                renderPersist();
                if (currentDocmem && currentDocmem.docmemId === selectedRootId) {
                    renderDocmem();
                }
            } catch (error) {
                console.error('Error uploading text file:', error);
                showMessage('Error uploading text file: ' + error.message, 'error');
            } finally {
                textFileInput.value = '';
            }
        });
    }

    if (uploadParagraphBtn) {
        uploadParagraphBtn.addEventListener('click', () => {
            if (paragraphFileInput) {
                paragraphFileInput.click();
            }
        });
    }

    if (paragraphFileInput) {
        paragraphFileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) {
                return;
            }

            try {
                const paragraphImporter = new ParagraphImporter();
                const { docmem, selectedRootId, createdCount } = await paragraphImporter.createDocmemFromFile(file);

                showMessage(`Created ${createdCount} nodes from ${file.name}`, 'success');
                renderPersist();
                if (currentDocmem && currentDocmem.docmemId === selectedRootId) {
                    renderDocmem();
                }
            } catch (error) {
                console.error('Error uploading paragraph file:', error);
                showMessage('Error uploading paragraph file: ' + error.message, 'error');
            } finally {
                paragraphFileInput.value = '';
            }
        });
    }
}

function renderPersist() {
    const rootsBar = document.getElementById('persist-roots-bar');
    
    if (!rootsBar) {
        return;
    }
    
    try {
        const roots = Docmem.getAllRoots();
        
        if (roots.length === 0) {
            rootsBar.innerHTML = '<div class="persist-no-roots">No root nodes found</div>';
            return;
        }
        
        let currentRootId = selectedPersistRootId;
        if (!currentRootId || !roots.find(r => r.id === currentRootId)) {
            currentRootId = roots[0].id;
            selectedPersistRootId = currentRootId;
        }
        
        rootsBar.innerHTML = roots.map((root, index) => {
            const isActive = root.id === currentRootId;
            return `
                <a href="#" class="persist-root-link ${isActive ? 'active' : ''}" data-root-id="${root.id}">
                    ${escapeHtml(root.id)}
                </a>
            `;
        }).join('');
        
        rootsBar.querySelectorAll('.persist-root-link').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const rootId = link.getAttribute('data-root-id');
                selectedPersistRootId = rootId;
                renderPersist();
            });
        });
    } catch (error) {
        rootsBar.innerHTML = `<div class="persist-error">Error loading roots: ${escapeHtml(error.message)}</div>`;
    }
}

