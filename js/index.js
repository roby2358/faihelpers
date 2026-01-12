import { Docmem } from './docmem.js';
import { seedAllDocmems } from './system_prompts/seed.js';
import { LineImporter } from './persist/line.js';
import { ParagraphImporter } from './persist/paragraph.js';
import { TomlSerializer } from './persist/toml.js';

let currentDocmem = null;
let selectedPersistRootId = null;
let selectedViewRootId = null;

export function showMessage(text, type) {
    const messageBar = document.getElementById('message-bar');
    const messageText = document.getElementById('message-text');
    
    messageText.textContent = text;
    messageBar.className = `message-bar ${type}`;
}

function getInputValue(elementId) {
    const element = document.getElementById(elementId);
    if (!element) {
        throw new Error(`Element not found: ${elementId}`);
    }
    return element.value.trim();
}

function setInputValue(elementId, value) {
    const element = document.getElementById(elementId);
    if (!element) {
        throw new Error(`Element not found: ${elementId}`);
    }
    element.value = value;
}

function getContextFields(prefix) {
    const contextType = getInputValue(`${prefix}-context-type`);
    const contextName = getInputValue(`${prefix}-context-name`);
    const contextValue = getInputValue(`${prefix}-context-value`);
    return { contextType, contextName, contextValue };
}

function validateRequired(fields, fieldNames) {
    for (let i = 0; i < fields.length; i++) {
        if (!fields[i]) {
            throw new Error(`${fieldNames[i]} is required`);
        }
    }
}

function calculateTotalTokens(nodes) {
    return nodes.reduce((sum, node) => sum + (node.tokenCount || 0), 0);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function copyToClipboard(text, successMessage) {
    navigator.clipboard.writeText(text);
    showMessage(successMessage, 'success');
}

function scrollToElement(elementId) {
    const element = document.getElementById(elementId);
    if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

function setupNodeIdCopyHandler(element) {
    const nodeId = element.getAttribute('data-node-id');
    element.style.cursor = 'pointer';
    element.style.textDecoration = 'underline';
    element.addEventListener('click', (e) => {
        e.stopPropagation();
        copyToClipboard(nodeId, 'Node ID copied to clipboard');
    });
}

function setupRootLoadHandler(element) {
    const nodeId = element.getAttribute('data-node-id');
    element.style.cursor = 'pointer';
    element.style.textDecoration = 'underline';
    element.addEventListener('click', async (e) => {
        e.stopPropagation();
        const docmemId = nodeId;
        navigator.clipboard.writeText(docmemId);
        await loadDocmem(docmemId);
        showMessage(`Docmem loaded: ${docmemId}`, 'success');
    });
}

function createPreElement(className, textContent) {
    const pre = document.createElement('pre');
    pre.className = className;
    pre.textContent = textContent;
    return pre;
}

function renderEmptyState(container, message) {
    container.innerHTML = `<div class="view-no-content">${escapeHtml(message)}</div>`;
}

function renderErrorState(container, error) {
    container.innerHTML = `<div class="view-error">Error: ${escapeHtml(error.message)}</div>`;
}

document.addEventListener('DOMContentLoaded', async () => {
    initTabs();
    initDocmem();
    initView();
    initPersist();
    
    // Seed all registered docmems
    try {
        await seedAllDocmems();
    } catch (error) {
        console.warn('Error seeding docmems:', error);
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

    renderTree(root, document.getElementById('docmem-tree'), 0);
    renderRootsList();

    const expandBtn = document.getElementById('expand-btn');
    const serializeBtn = document.getElementById('serialize-btn');

    expandBtn.addEventListener('click', () => handleDocmemExpand(root.id));
    serializeBtn.addEventListener('click', () => handleDocmemSerialize(root.id));

    // Operation handlers
    const appendBtn = document.getElementById('append-btn');
    appendBtn.addEventListener('click', () => handleAppendChild());

    const insertBeforeBtn = document.getElementById('insert-before-btn');
    insertBeforeBtn.addEventListener('click', () => handleInsertBefore());

    const insertAfterBtn = document.getElementById('insert-after-btn');
    insertAfterBtn.addEventListener('click', () => handleInsertAfter());

    const updateBtn = document.getElementById('update-btn');
    updateBtn.addEventListener('click', () => handleUpdateContent());

    const summaryBtn = document.getElementById('summary-btn');
    summaryBtn.addEventListener('click', () => handleAddSummary());
}

function handleAppendChild() {
    try {
        const parentId = getInputValue('append-parent-id');
        const { contextType, contextName, contextValue } = getContextFields('append');
        const content = getInputValue('append-content');
        
        validateRequired(
            [parentId, contextType, contextName, contextValue, content],
            ['Parent ID', 'Context Type', 'Context Name', 'Context Value', 'Content']
        );
        
        const node = currentDocmem.appendChild(parentId, contextType, contextName, contextValue, content);
        showMessage(`Node created: ${node.id}`, 'success');
        renderDocmem();
    } catch (error) {
        showMessage('Error: ' + error.message, 'error');
    }
}

function handleInsertBefore() {
    try {
        const nodeId = getInputValue('insert-before-node-id');
        const { contextType, contextName, contextValue } = getContextFields('insert-before');
        const content = getInputValue('insert-before-content');
        
        validateRequired(
            [nodeId, contextType, contextName, contextValue, content],
            ['Node ID', 'Context Type', 'Context Name', 'Context Value', 'Content']
        );
        
        const node = currentDocmem.insertBefore(nodeId, contextType, contextName, contextValue, content);
        showMessage(`Node inserted before: ${node.id}`, 'success');
        renderDocmem();
    } catch (error) {
        showMessage('Error: ' + error.message, 'error');
    }
}

function handleInsertAfter() {
    try {
        const nodeId = getInputValue('insert-after-node-id');
        const { contextType, contextName, contextValue } = getContextFields('insert-after');
        const content = getInputValue('insert-after-content');
        
        validateRequired(
            [nodeId, contextType, contextName, contextValue, content],
            ['Node ID', 'Context Type', 'Context Name', 'Context Value', 'Content']
        );
        
        const node = currentDocmem.insertAfter(nodeId, contextType, contextName, contextValue, content);
        showMessage(`Node inserted after: ${node.id}`, 'success');
        renderDocmem();
    } catch (error) {
        showMessage('Error: ' + error.message, 'error');
    }
}

function handleUpdateContent() {
    try {
        const nodeId = getInputValue('update-node-id');
        const content = getInputValue('update-content');
        
        validateRequired([nodeId, content], ['Node ID', 'Content']);
        
        const node = currentDocmem.updateContent(nodeId, content);
        showMessage(`Node updated: ${node.id}`, 'success');
        renderDocmem();
    } catch (error) {
        showMessage('Error: ' + error.message, 'error');
    }
}

function handleAddSummary() {
    try {
        const startNodeId = getInputValue('summary-start-node-id');
        const endNodeId = getInputValue('summary-end-node-id');
        const content = getInputValue('summary-content');
        const { contextType, contextName, contextValue } = getContextFields('summary');
        
        validateRequired(
            [startNodeId, endNodeId, content, contextType, contextName, contextValue],
            ['Start Node ID', 'End Node ID', 'Content', 'Context Type', 'Context Name', 'Context Value']
        );
        
        const node = currentDocmem.addSummary(startNodeId, endNodeId, content, contextType, contextName, contextValue);
        showMessage(`Summary created: ${node.id}`, 'success');
        renderDocmem();
    } catch (error) {
        showMessage('Error: ' + error.message, 'error');
    }
}

function handleDocmemExpand(rootId) {
    const expandTokenLimit = document.getElementById('expand-token-limit');
    const maxTokens = parseInt(expandTokenLimit.value) || 1000;
    const expanded = currentDocmem.expandToLength(rootId, maxTokens);
    renderExpanded(expanded);
}

function handleDocmemSerialize(rootId) {
    const serialized = currentDocmem.getNodes(rootId);
    renderExpanded(serialized);
}

function renderTree(node, container, depth) {
    const nodeDiv = document.createElement('div');
    nodeDiv.className = `docmem-node ${node.contextType}`;
    
    const children = currentDocmem.getChildren(node.id);
    const hasChildren = children.length > 0;
    const isExpanded = shouldExpandNode(node, depth, hasChildren);

    nodeDiv.innerHTML = createTreeNodeHtml(node, hasChildren, isExpanded);
    container.appendChild(nodeDiv);

    setupTreeNodeHandlers(nodeDiv, node, children, hasChildren, isExpanded, depth);
}

function shouldExpandNode(node, depth, hasChildren) {
    return node.parentId === null || depth === 0 || hasChildren;
}

function createTreeNodeHtml(node, hasChildren, isExpanded) {
    const expandIcon = hasChildren ? (isExpanded ? '▼' : '▶') : ' ';
    const childrenHtml = isExpanded && hasChildren ? `<div class="docmem-node-children" data-parent-id="${node.id}"></div>` : '';
    const textHtml = node.text ? `<div class="docmem-node-text">${escapeHtml(node.text)}</div>` : '';
    
    return `
        <div class="docmem-node-header" data-node-id="${node.id}">
            <span class="docmem-expand-icon">${expandIcon}</span>
            <span class="docmem-node-type">${escapeHtml(node.contextType)} ${escapeHtml(node.contextName)}:${escapeHtml(node.contextValue)} (<span class="node-id-copy" data-node-id="${node.id}">${node.id}</span>)</span>
            <span class="docmem-node-meta">(tokens: ${node.tokenCount}, order: ${node.order.toFixed(3)})</span>
            <button class="node-action-btn" data-action="append" data-node-id="${node.id}" title="Append child">+</button>
            <button class="node-action-btn" data-action="update" data-node-id="${node.id}" title="Update content">✎</button>
            <button class="node-action-btn delete-btn" data-action="delete" data-node-id="${node.id}" title="Delete node">X</button>
        </div>
        ${textHtml}
        ${childrenHtml}
    `;
}

function setupTreeNodeHandlers(nodeDiv, node, children, hasChildren, isExpanded, depth) {
    setupActionButtonHandlers(nodeDiv);
    setupNodeIdCopyHandlerForTree(nodeDiv);
    
    if (hasChildren) {
        setupTreeExpandHandlers(nodeDiv, children, depth, isExpanded);
    }
}

function setupActionButtonHandlers(nodeDiv) {
    const actionButtons = nodeDiv.querySelectorAll('.node-action-btn');
    actionButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const action = btn.getAttribute('data-action');
            const nodeId = btn.getAttribute('data-node-id');
            handleNodeAction(action, nodeId);
        });
    });
}

function setupNodeIdCopyHandlerForTree(nodeDiv) {
    const nodeIdSpan = nodeDiv.querySelector('.node-id-copy');
    if (nodeIdSpan) {
        setupNodeIdCopyHandler(nodeIdSpan);
    }
}

function setupTreeExpandHandlers(nodeDiv, children, depth, isExpanded) {
    const header = nodeDiv.querySelector('.docmem-node-header');
    const childrenContainer = nodeDiv.querySelector('.docmem-node-children');

    header.addEventListener('click', () => {
        toggleTreeNode(header, childrenContainer, children, depth);
    });

    if (isExpanded && childrenContainer) {
        renderSortedChildren(children, childrenContainer, depth);
    }
}

function toggleTreeNode(header, childrenContainer, children, depth) {
    if (!childrenContainer) {
        return;
    }
    
    const isCurrentlyExpanded = childrenContainer.style.display !== 'none';
    if (isCurrentlyExpanded) {
        childrenContainer.style.display = 'none';
        header.querySelector('.docmem-expand-icon').textContent = '▶';
    } else {
        childrenContainer.style.display = 'block';
        header.querySelector('.docmem-expand-icon').textContent = '▼';
        if (childrenContainer.children.length === 0) {
            renderSortedChildren(children, childrenContainer, depth);
        }
    }
}

function renderSortedChildren(children, container, parentDepth) {
    const sortedChildren = [...children].sort((a, b) => a.order - b.order);
    sortedChildren.forEach(child => {
        renderTree(child, container, parentDepth + 1);
    });
}

function renderExpanded(nodes) {
    const container = document.getElementById('expanded-content');
    container.style.display = 'block';
    
    const totalTokens = calculateTotalTokens(nodes);
    container.innerHTML = `
        <h3>Expanded Content (${nodes.length} nodes)</h3>
        <div id="expanded-nodes"></div>
    `;

    const nodesContainer = document.getElementById('expanded-nodes');
    
    nodes.forEach(node => {
        const nodeDiv = createExpandedNodeElement(node);
        nodesContainer.appendChild(nodeDiv);
    });

    const header = container.querySelector('h3');
    header.textContent = `Expanded Content (${nodes.length} nodes, ${totalTokens} total tokens)`;
}

function createExpandedNodeElement(node) {
    const nodeDiv = document.createElement('div');
    nodeDiv.className = 'expanded-node';
    nodeDiv.innerHTML = `
        <div class="docmem-node-type">${escapeHtml(node.contextType)} ${escapeHtml(node.contextName)}:${escapeHtml(node.contextValue)}</div>
        <div class="docmem-node-text">${escapeHtml(node.text)}</div>
        <div class="docmem-node-meta">Tokens: ${node.tokenCount} | Order: ${node.order.toFixed(3)}</div>
    `;
    return nodeDiv;
}

function handleNodeAction(action, nodeId) {
    switch (action) {
        case 'append':
            handleAppendNodeAction(nodeId);
            break;
        case 'update':
            handleUpdateNodeAction(nodeId);
            break;
        case 'delete':
            handleDeleteNodeAction(nodeId);
            break;
    }
}

function handleAppendNodeAction(nodeId) {
    setInputValue('append-parent-id', nodeId);
    scrollToElement('append-parent-id');
}

function handleUpdateNodeAction(nodeId) {
    const node = currentDocmem.find(nodeId);
    if (!node) {
        return;
    }
    setInputValue('update-node-id', nodeId);
    setInputValue('update-content', node.text);
    scrollToElement('update-node-id');
}

function handleDeleteNodeAction(nodeId) {
    const nodeToDelete = currentDocmem.find(nodeId);
    if (!nodeToDelete) {
        showMessage('Node not found', 'error');
        return;
    }
    if (nodeToDelete.parentId === null) {
        showMessage('Cannot delete root node', 'error');
        return;
    }
    if (!confirm(`Are you sure you want to delete node ${nodeId}? This will also delete all its children.`)) {
        return;
    }
    try {
        currentDocmem.delete(nodeId);
        showMessage(`Node deleted: ${nodeId}`, 'success');
        renderDocmem();
    } catch (error) {
        showMessage('Error: ' + error.message, 'error');
    }
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

        // Add click handlers to load docmem
        rootsListDiv.querySelectorAll('.node-id-copy').forEach(span => {
            setupRootLoadHandler(span);
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
        expandBtn.addEventListener('click', () => handleViewExpand());
    }
    
    if (expandAllBtn) {
        expandAllBtn.addEventListener('click', () => handleViewExpandAll());
    }
    
    if (serializeBtn) {
        serializeBtn.addEventListener('click', () => handleViewSerialize());
    }
    
    if (structureBtn) {
        structureBtn.addEventListener('click', () => handleViewStructure());
    }
}

function handleViewExpand() {
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
}

function handleViewExpandAll() {
    if (!selectedViewRootId) {
        showMessage('No root selected', 'error');
        return;
    }
    renderViewExpanded(selectedViewRootId, 1000000);
}

async function handleViewSerialize() {
    if (!selectedViewRootId) {
        showMessage('No root selected', 'error');
        return;
    }
    await renderViewSerialized(selectedViewRootId);
}

async function handleViewStructure() {
    if (!selectedViewRootId) {
        showMessage('No root selected', 'error');
        return;
    }
    await renderViewStructure(selectedViewRootId);
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
        
        selectedViewRootId = ensureValidRootSelection(roots, selectedViewRootId);
        
        renderRootLinks(rootsBar, roots, selectedViewRootId, 'view-root-link', (rootId) => {
            selectedViewRootId = rootId;
            renderViewExpanded(rootId, 1000000);
        });
        
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
        
        const expanded = docmem.expandToLength(rootId, maxTokens);
        
        if (expanded.length === 0) {
            renderEmptyState(contentPanel, 'No content to display');
            return;
        }
        
        const textContent = formatExpandedNodes(expanded);
        const totalTokens = calculateTotalTokens(expanded);
        
        const pre = createPreElement('view-serialized-text', textContent);
        contentPanel.innerHTML = `<div class="view-stats">${expanded.length} nodes, ${totalTokens} tokens (expanded to ${maxTokens})</div>`;
        contentPanel.appendChild(pre);
    } catch (error) {
        renderErrorState(contentPanel, error);
    }
}

function formatExpandedNodes(nodes) {
    return nodes.map(node => {
        const header = `${node.id} ${node.contextType} ${node.contextName}:${node.contextValue} ${node.createdAt}`;
        const content = node.text || '';
        return `${header}\n${content}`;
    }).join('\n\n');
}

async function renderViewSerialized(rootId) {
    const contentPanel = document.getElementById('view-content-panel');
    
    if (!contentPanel) {
        return;
    }
    
    try {
        const docmem = new Docmem(rootId);
        await docmem.ready();
        
        const serializedContent = docmem.serialize(rootId);
        
        if (!serializedContent || serializedContent.length === 0) {
            renderEmptyState(contentPanel, 'No content to display');
            return;
        }
        
        const nodes = docmem.getNodes(rootId);
        const totalTokens = calculateTotalTokens(nodes);
        
        const pre = createPreElement('view-serialized-text', serializedContent);
        contentPanel.innerHTML = `<div class="view-stats">${nodes.length} nodes, ${totalTokens} tokens (serialized)</div>`;
        contentPanel.appendChild(pre);
    } catch (error) {
        renderErrorState(contentPanel, error);
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
        
        const structureContent = docmem.structure(rootId);
        
        if (!structureContent || structureContent.length === 0) {
            renderEmptyState(contentPanel, 'No structure to display');
            return;
        }
        
        const nodes = docmem.getNodes(rootId);
        const totalTokens = calculateTotalTokens(nodes);
        
        const pre = createPreElement('view-serialized-text', structureContent);
        contentPanel.innerHTML = `<div class="view-stats">${nodes.length} nodes, ${totalTokens} tokens (structure)</div>`;
        contentPanel.appendChild(pre);
    } catch (error) {
        renderErrorState(contentPanel, error);
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
    const removeBtn = document.getElementById('persist-remove-btn');

    if (saveBtn) {
        saveBtn.addEventListener('click', () => handlePersistSave());
    }

    if (loadBtn) {
        loadBtn.addEventListener('click', () => {
            if (fileInput) {
                fileInput.click();
            }
        });
    }

    if (fileInput) {
        fileInput.addEventListener('change', (e) => handleTomlFileUpload(e, fileInput));
    }

    if (uploadTextBtn) {
        uploadTextBtn.addEventListener('click', () => {
            if (textFileInput) {
                textFileInput.click();
            }
        });
    }

    if (textFileInput) {
        textFileInput.addEventListener('change', (e) => handleTextFileUpload(e, textFileInput));
    }

    if (uploadParagraphBtn) {
        uploadParagraphBtn.addEventListener('click', () => {
            if (paragraphFileInput) {
                paragraphFileInput.click();
            }
        });
    }

    if (paragraphFileInput) {
        paragraphFileInput.addEventListener('change', (e) => handleParagraphFileUpload(e, paragraphFileInput));
    }

    if (removeBtn) {
        removeBtn.addEventListener('click', () => handlePersistRemove());
    }
}

async function handlePersistSave() {
    try {
        const roots = Docmem.getAllRoots();
        if (roots.length === 0) {
            showMessage('No docmem roots found to save', 'error');
            return;
        }

        const selectedRootId = ensureValidRootSelection(roots, selectedPersistRootId);
        selectedPersistRootId = selectedRootId;
        
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
}

async function handleTomlFileUpload(event, fileInput) {
    const file = event.target.files[0];
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
}

async function handleTextFileUpload(event, fileInput) {
    const file = event.target.files[0];
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
        fileInput.value = '';
    }
}

async function handleParagraphFileUpload(event, fileInput) {
    const file = event.target.files[0];
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
        fileInput.value = '';
    }
}

async function handlePersistRemove() {
    if (!selectedPersistRootId) {
        showMessage('No docmem selected to remove', 'error');
        return;
    }

    if (!confirm(`Are you sure you want to remove docmem "${selectedPersistRootId}"? This will permanently delete it and all its content.`)) {
        return;
    }

    try {
        const docmem = new Docmem(selectedPersistRootId);
        await docmem.ready();
        
        docmem.delete(selectedPersistRootId);
        
        if (currentDocmem && currentDocmem.docmemId === selectedPersistRootId) {
            currentDocmem = null;
        }
        
        selectedPersistRootId = null;
        
        showMessage('Docmem removed successfully', 'success');
        renderPersist();
        renderDocmem();
    } catch (error) {
        console.error('Error removing docmem:', error);
        showMessage('Error removing docmem: ' + error.message, 'error');
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
            selectedPersistRootId = null;
            return;
        }
        
        const currentRootId = ensureValidRootSelection(roots, selectedPersistRootId);
        selectedPersistRootId = currentRootId;
        
        renderRootLinks(rootsBar, roots, currentRootId, 'persist-root-link', (rootId) => {
            selectedPersistRootId = rootId;
            renderPersist();
        });
    } catch (error) {
        rootsBar.innerHTML = `<div class="persist-error">Error loading roots: ${escapeHtml(error.message)}</div>`;
    }
}

function ensureValidRootSelection(roots, selectedRootId) {
    if (!selectedRootId || !roots.find(r => r.id === selectedRootId)) {
        return roots[0].id;
    }
    return selectedRootId;
}

function renderRootLinks(container, roots, activeRootId, linkClassName, onClickHandler) {
    container.innerHTML = roots.map((root) => {
        const isActive = root.id === activeRootId;
        return `
            <a href="#" class="${linkClassName} ${isActive ? 'active' : ''}" data-root-id="${root.id}">
                ${escapeHtml(root.id)}
            </a>
        `;
    }).join('');
    
    container.querySelectorAll(`.${linkClassName}`).forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const rootId = link.getAttribute('data-root-id');
            onClickHandler(rootId);
        });
    });
}

