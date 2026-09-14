/**
 * Tasks panel - drives a TaskHarness bound to one task docmem and renders
 * the task tree with state blocks, plus manual editing between runs.
 */
import { Docmem } from './docmem_tools/docmem.js';
import { showMessage } from './index.js';
import { getChatCredentials } from './chat.js';
import {
    TaskHarness, createTaskDocmem, parseStateBlock, formatStateBlock,
    instructionText, isTaskNode, isSummaryNode
} from './task_harness.js';

let harness = null;
let selectedRootId = null;
let selectedNodeId = null;
let expandedSummaries = new Set();

const el = (id) => document.getElementById(id);

function log(line) {
    const pre = el('tasks-log');
    pre.textContent += `${new Date().toLocaleTimeString()} ${line}\n`;
    pre.scrollTop = pre.scrollHeight;
}

// Root selection

async function taskRoots() {
    const roots = await Docmem.getAllRoots();
    return roots.filter(r => r.contextType === 'task_list');
}

async function renderRootSelect() {
    const select = el('tasks-root-select');
    const roots = await taskRoots();
    select.innerHTML = '';
    for (const r of roots) {
        const opt = document.createElement('option');
        opt.value = r.id;
        opt.textContent = `${r.id} (${r.contextName})`;
        select.appendChild(opt);
    }
    if (!roots.some(r => r.id === selectedRootId)) {
        selectedRootId = roots[0]?.id || null;
    }
    if (selectedRootId) select.value = selectedRootId;
}

async function bindHarness() {
    if (harness && harness.taskRootId === selectedRootId) return;
    if (harnessRunning()) {
        showMessage('Stop the harness before switching task docmems', 'error');
        el('tasks-root-select').value = harness.taskRootId;
        selectedRootId = harness.taskRootId;
        return;
    }
    harness = null;
    if (!selectedRootId) return;
    harness = new TaskHarness({
        taskRootId: selectedRootId,
        credentials: getChatCredentials,
        onChange: () => { renderTree(); renderStatus(); },
        onLog: log
    });
    await harness.ready();
}

// Rendering

function renderStatus() {
    const status = el('tasks-status');
    if (!harness) {
        status.textContent = 'no task docmem';
        return;
    }
    status.textContent = harness.state + (harness.current ? ` (${harness.current})` : '');
    el('tasks-start-btn').disabled = harness.state === 'started';
    el('tasks-stop-btn').disabled = harness.state === 'stopped';
}

function shorten(text, max) {
    const oneLine = text.replace(/\s+/g, ' ').trim();
    return oneLine.length > max ? oneLine.slice(0, max - 1) + '…' : oneLine;
}

function button(label, title, onClick) {
    const b = document.createElement('button');
    b.className = 'btn';
    b.textContent = label;
    b.title = title;
    b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
    return b;
}

async function renderTree() {
    const container = el('tasks-tree');
    if (!harness) {
        container.innerHTML = '<div class="empty-state">Create or select a task docmem</div>';
        return;
    }
    container.innerHTML = '';
    const descend = (node) => !isSummaryNode(node) || expandedSummaries.has(node.id);
    try {
        for await (const { node, depth } of harness.docmem.preorder(harness.taskRootId, descend)) {
            if (node.parentId === null) continue;
            container.appendChild(renderRow(node, depth - 1));
        }
    } catch (error) {
        container.innerHTML = `<div class="error-state">${error.message}</div>`;
    }
}

function renderRow(node, depth) {
    const row = document.createElement('div');
    row.className = 'task-row';
    row.style.paddingLeft = `${0.5 + depth * 1.5}rem`;
    if (node.id === selectedNodeId) row.classList.add('selected');
    if (harness.current === node.id) row.classList.add('running');

    const stateEl = document.createElement('span');
    stateEl.className = 'task-row-state';
    const textEl = document.createElement('span');
    textEl.className = 'task-row-text';
    const actions = document.createElement('span');
    actions.className = 'task-row-actions';

    if (isSummaryNode(node)) {
        row.classList.add('summary', node.contextValue);
        const open = expandedSummaries.has(node.id);
        stateEl.textContent = `${open ? '▾' : '▸'} ${node.id} ${node.contextValue}`;
        textEl.textContent = shorten(node.text || '(no summary)', 160);
        row.addEventListener('click', () => {
            if (open) expandedSummaries.delete(node.id); else expandedSummaries.add(node.id);
            renderTree();
        });
    } else if (isTaskNode(node)) {
        const { state } = parseStateBlock(node.text);
        const lens = node.contextName ? ` lens=${node.contextName}` : '';
        stateEl.textContent = `${node.id} ${formatStateBlock(state)}${lens}`;
        textEl.textContent = shorten(instructionText(node.text), 160);
        row.addEventListener('click', () => { selectedNodeId = node.id; renderTree(); });
        actions.append(
            button('edit', 'Edit instruction and state block', () => editTask(node)),
            button('↑', 'Move before previous sibling', () => moveTask(node, 'before')),
            button('↓', 'Move after next sibling', () => moveTask(node, 'after')),
            button('requeue', 'Set status=queued', () => setStatus(node, 'queued')),
            button('✕', 'Delete task and subtree', () => deleteTask(node))
        );
    } else {
        stateEl.textContent = `${node.id} ${node.contextString()}`;
        textEl.textContent = shorten(node.text || '', 160);
    }

    row.append(stateEl, textEl, actions);
    return row;
}

// Manual edits

function harnessRunning() {
    return harness !== null && harness.state === 'started';
}

function guardStopped() {
    if (harnessRunning()) {
        showMessage('Stop the harness before editing tasks by hand', 'error');
        return false;
    }
    return true;
}

async function refreshAfter(fn) {
    try {
        await fn();
    } catch (error) {
        showMessage(error.message, 'error');
    }
    await renderTree();
}

// The one hand edit allowed during a run. See TASK_DELEGATION_SPEC, Who writes when.
async function addTask() {
    if (!harness) return;
    const text = el('tasks-new-text').value.trim();
    if (!text) return;
    const lens = el('tasks-new-lens').value.trim();
    await refreshAfter(async () => {
        await harness.docmem.appendChild(harness.taskRootId, 'task', lens, '', `{status=queued}\n${text}`);
        el('tasks-new-text').value = '';
    });
}

async function editTask(node) {
    if (!guardStopped()) return;
    const edited = window.prompt('Task text (state block first):', node.text);
    if (edited === null) return;
    await refreshAfter(() => harness.setTaskText(node.id, edited));
}

async function setStatus(node, status) {
    if (!guardStopped()) return;
    await refreshAfter(async () => {
        const state = harness.readState(node);
        state.set('status', status);
        await harness.writeState(node.id, state);
    });
}

async function moveTask(node, direction) {
    if (!guardStopped()) return;
    await refreshAfter(async () => {
        const siblings = await harness.docmem.getSortedChildren(node.parentId);
        const idx = siblings.findIndex(s => s.id === node.id);
        const target = direction === 'before' ? siblings[idx - 1] : siblings[idx + 1];
        if (!target) return;
        if (direction === 'before') {
            await harness.docmem.moveBefore(node.id, target.id);
        } else {
            await harness.docmem.moveAfter(node.id, target.id);
        }
    });
}

async function deleteTask(node) {
    if (!guardStopped()) return;
    if (!window.confirm(`Delete task ${node.id} and everything beneath it?`)) return;
    await refreshAfter(async () => {
        await harness.docmem.delete(node.id);
        if (selectedNodeId === node.id) selectedNodeId = null;
    });
}

// Harness controls

async function startHarness() {
    if (!harness) {
        showMessage('Create or select a task docmem first', 'error');
        return;
    }
    const { apiKey, model } = getChatCredentials();
    if (!apiKey || !model) {
        showMessage('Enter an API key and pick a model on the Chat tab first', 'error');
        return;
    }
    harness.start();
    renderStatus();
}

function stopHarness() {
    if (harness) harness.stop();
}

async function createRoot() {
    const id = el('tasks-new-root').value.trim();
    if (!id) return;
    try {
        await createTaskDocmem(id, id);
        el('tasks-new-root').value = '';
        selectedRootId = id;
        await refresh();
        showMessage(`Created task docmem ${id}`, 'success');
    } catch (error) {
        showMessage(error.message, 'error');
    }
}

async function refresh() {
    await renderRootSelect();
    await bindHarness();
    renderStatus();
    await renderTree();
}

function initTasksPanel() {
    el('tasks-root-select').addEventListener('change', async (e) => {
        selectedRootId = e.target.value;
        selectedNodeId = null;
        await refresh();
    });
    el('tasks-create-root-btn').addEventListener('click', createRoot);
    el('tasks-start-btn').addEventListener('click', startHarness);
    el('tasks-stop-btn').addEventListener('click', stopHarness);
    el('tasks-refresh-btn').addEventListener('click', refresh);
    el('tasks-add-btn').addEventListener('click', addTask);
    document.addEventListener('tasks-tab-shown', refresh);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTasksPanel);
} else {
    initTasksPanel();
}
