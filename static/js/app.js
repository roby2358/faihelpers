let currentDocmem = null;

document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    initDocmem();
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
    const loadBtn = document.getElementById('load-docmem-btn');
    const docmemIdInput = document.getElementById('docmem-id-input');

    createBtn.addEventListener('click', async () => {
        const docmemId = docmemIdInput.value.trim() || `docmem_${Date.now()}`;
        await createDocmem(docmemId);
    });

    loadBtn.addEventListener('click', async () => {
        const docmemId = docmemIdInput.value.trim();
        if (!docmemId) {
            alert('Please enter a docmem ID');
            return;
        }
        await loadDocmem(docmemId);
    });
}

async function createDocmem(docmemId) {
    try {
        currentDocmem = new Docmem(docmemId);
        await currentDocmem.ready();
        renderDocmem();
    } catch (error) {
        console.error('Error creating docmem:', error);
        alert('Error creating docmem: ' + error.message);
    }
}

async function loadDocmem(docmemId) {
    try {
        currentDocmem = new Docmem(docmemId);
        await currentDocmem.ready();
        renderDocmem();
    } catch (error) {
        console.error('Error loading docmem:', error);
        alert('Error loading docmem: ' + error.message);
    }
}

function renderDocmem() {
    if (!currentDocmem) {
        return;
    }

    const container = document.getElementById('docmem-container');
    const root = currentDocmem._getRoot();
    
    container.innerHTML = `
        <div class="expand-controls">
            <label>Expand to token limit:</label>
            <input type="number" id="expand-token-limit" value="1000" min="1" />
            <button id="expand-btn">Expand</button>
            <button id="serialize-btn">Serialize</button>
        </div>
        <div id="docmem-tree" class="docmem-tree"></div>
        <div id="expanded-content" class="expanded-content" style="display: none;"></div>
    `;

    renderTree(root, document.getElementById('docmem-tree'));

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
}

function renderTree(node, container, depth = 0) {
    const nodeDiv = document.createElement('div');
    nodeDiv.className = `docmem-node ${node.nodeType}`;
    
    const children = currentDocmem._getChildren(node.id);
    const hasChildren = children.length > 0;
    const isExpanded = node.nodeType === NodeType.ROOT || depth === 0;

    nodeDiv.innerHTML = `
        <div class="docmem-node-header" data-node-id="${node.id}">
            ${hasChildren ? `<span class="docmem-expand-icon">${isExpanded ? '▼' : '▶'}</span>` : '<span class="docmem-expand-icon"> </span>'}
            <span class="docmem-node-type">${node.nodeType}</span>
            <span class="docmem-node-meta">(tokens: ${node.tokenCount}, order: ${node.order.toFixed(3)})</span>
        </div>
        ${node.text ? `<div class="docmem-node-text">${escapeHtml(node.text)}</div>` : ''}
        <div class="docmem-node-meta">ID: ${node.id}</div>
        ${isExpanded && hasChildren ? `<div class="docmem-node-children" data-parent-id="${node.id}"></div>` : ''}
    `;

    container.appendChild(nodeDiv);

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
            <div class="docmem-node-type">${node.nodeType}</div>
            <div class="docmem-node-text">${escapeHtml(node.text)}</div>
            <div class="docmem-node-meta">Tokens: ${node.tokenCount} | Order: ${node.order.toFixed(3)}</div>
        `;
        nodesContainer.appendChild(nodeDiv);
    });

    const header = container.querySelector('h3');
    header.textContent = `Expanded Content (${nodes.length} nodes, ${totalTokens} total tokens)`;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
