let currentDocmem = null;

function showMessage(text, type = 'info') {
    const messageBar = document.getElementById('message-bar');
    const messageText = document.getElementById('message-text');
    
    messageText.textContent = text;
    messageBar.className = `message-bar ${type}`;
}

document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    initDocmem();
    
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

    const root = currentDocmem._getRoot();
    
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
                <h4>Insert Between</h4>
                <div class="input-row">
                    <input type="text" id="insert-node1-id" placeholder="Node ID 1" />
                    <input type="text" id="insert-node2-id" placeholder="Node ID 2" />
                </div>
                <div class="input-row">
                    <input type="text" id="insert-context-type" placeholder="Context Type" />
                    <input type="text" id="insert-context-name" placeholder="Context Name" />
                    <input type="text" id="insert-context-value" placeholder="Context Value" />
                </div>
                <textarea id="insert-content" placeholder="Content"></textarea>
                <button id="insert-btn">Insert</button>
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
                    <input type="text" id="summary-node-ids" placeholder="Node IDs (space-separated)" />
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
        const expanded = currentDocmem.expandToLength(maxTokens);
        renderExpanded(expanded);
    });

    serializeBtn.addEventListener('click', () => {
        const serialized = currentDocmem.serialize();
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
            const node = currentDocmem.append_child(parentId, contextType, contextName, contextValue, content);
            showMessage(`Node created: ${node.id}`, 'success');
            renderDocmem();
        } catch (error) {
            showMessage('Error: ' + error.message, 'error');
        }
    });

    const insertBtn = document.getElementById('insert-btn');
    insertBtn.addEventListener('click', () => {
        const nodeId1 = document.getElementById('insert-node1-id').value.trim();
        const nodeId2 = document.getElementById('insert-node2-id').value.trim();
        const contextType = document.getElementById('insert-context-type').value.trim();
        const contextName = document.getElementById('insert-context-name').value.trim();
        const contextValue = document.getElementById('insert-context-value').value.trim();
        const content = document.getElementById('insert-content').value.trim();
        
        if (!nodeId1 || !nodeId2 || !content || !contextType || !contextName || !contextValue) {
            showMessage('Both node IDs, content, and all context fields are required', 'error');
            return;
        }
        
        try {
            const node = currentDocmem.insert_between(nodeId1, nodeId2, contextType, contextName, contextValue, content);
            showMessage(`Node inserted: ${node.id}`, 'success');
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
            const node = currentDocmem.update_content(nodeId, content);
            showMessage(`Node updated: ${node.id}`, 'success');
            renderDocmem();
        } catch (error) {
            showMessage('Error: ' + error.message, 'error');
        }
    });

    const summaryBtn = document.getElementById('summary-btn');
    summaryBtn.addEventListener('click', () => {
        const nodeIdsStr = document.getElementById('summary-node-ids').value.trim();
        const content = document.getElementById('summary-content').value.trim();
        const contextType = document.getElementById('summary-context-type').value.trim();
        const contextName = document.getElementById('summary-context-name').value.trim();
        const contextValue = document.getElementById('summary-context-value').value.trim();
        
        if (!nodeIdsStr || !content || !contextType || !contextName || !contextValue) {
            showMessage('Node IDs, summary content, and all context fields are required', 'error');
            return;
        }
        
        // Split by whitespace, trim each, and filter out empty strings
        const nodeIds = nodeIdsStr.split(/\s+/).map(id => id.trim()).filter(id => id);
        if (nodeIds.length === 0) {
            showMessage('At least one node ID is required', 'error');
            return;
        }
        
        try {
            const node = currentDocmem.add_summary(nodeIds, content, contextType, contextName, contextValue);
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
    
    const children = currentDocmem._getChildren(node.id);
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

