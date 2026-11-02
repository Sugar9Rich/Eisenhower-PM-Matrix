const initialTasks = [];

const STORAGE_KEY = 'priorix-tasks';
const quadrantKeys = ['do', 'schedule', 'delegate', 'delete'];
const legacyQuadrantMap = { eliminate: 'delete' };
const scopeKeys = ['pm', 'personal'];
const lists = { do: document.querySelector('#doList'), schedule: document.querySelector('#scheduleList'), delegate: document.querySelector('#delegateList'), delete: document.querySelector('#deleteList') };
const appShell = document.querySelector('.app-shell');
const sidebarToggle = document.querySelector('#sidebarToggle');
const SIDEBAR_STORAGE_KEY = 'priorix-sidebar-collapsed';

function setSidebarCollapsed(collapsed) {
  appShell.classList.toggle('sidebar-collapsed', collapsed);
  sidebarToggle.textContent = collapsed ? '›' : '‹';
  sidebarToggle.setAttribute('aria-label', collapsed ? '展開側邊欄' : '收起側邊欄');
  sidebarToggle.setAttribute('aria-pressed', String(collapsed));
  sidebarToggle.title = collapsed ? '展開側邊欄' : '收起側邊欄';
  try { localStorage.setItem(SIDEBAR_STORAGE_KEY, String(collapsed)); } catch { /* 預覽模式不影響本次使用 */ }
}

let sidebarCollapsed = false;
try { sidebarCollapsed = localStorage.getItem(SIDEBAR_STORAGE_KEY) === 'true'; } catch { /* 預覽模式不影響本次使用 */ }
setSidebarCollapsed(sidebarCollapsed);
sidebarToggle.addEventListener('click', () => { sidebarCollapsed = !sidebarCollapsed; setSidebarCollapsed(sidebarCollapsed); });

let activeScope = 'all';
function inferScope(task) { return scopeKeys.includes(task.scope) ? task.scope : (['Q4 產品上市', '品牌重新設計', '團隊營運'].includes(task.project) ? 'pm' : 'personal'); }

function readStoredTasks() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem('pm-eisenhower-tasks-v1');
    if (!raw) return initialTasks;
    const data = JSON.parse(raw);
    const saved = Array.isArray(data) ? data : data.tasks;
    if (!Array.isArray(saved)) return initialTasks;
    return saved.map(task => ({ ...task, title: String(task.title || '').trim(), scope: inferScope(task), quadrant: legacyQuadrantMap[task.quadrant] || task.quadrant, project: task.project || '個人', dueLabel: task.dueLabel || dueText(task.due) })).filter(task => quadrantKeys.includes(task.quadrant) && task.title);
  } catch { return initialTasks; }
}

let tasks = readStoredTasks();
function save() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks)); } catch { /* file:// 預覽模式可能停用儲存，仍保留本次工作階段資料 */ } }
function newTaskId() { return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
const escapeHtml = value => String(value || '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));
function formatDate(date) { return date ? new Intl.DateTimeFormat('zh-TW', { month: 'short', day: 'numeric' }).format(new Date(`${date}T12:00:00`)) : ''; }
function dueText(due) { return /^\d{4}-\d{2}-\d{2}$/.test(due || '') ? formatDate(due) : (due || '未設定'); }

function taskCard(task) {
  const card = document.createElement('div');
  card.className = `task-card${task.done ? ' completed' : ''}`;
  card.dataset.id = task.id;
  card.draggable = true;
  const note = task.note ? `<div class="task-note">${escapeHtml(task.note)}</div>` : '';
  const scopeLabel = task.scope === 'pm' ? 'PM 專案' : 'Personal PM';
  card.innerHTML = `<button class="task-check${task.done ? ' checked' : ''}" aria-label="${task.done ? '標記未完成' : '標記完成'}">${task.done ? '✓' : ''}</button><div class="task-main"><div class="task-name">${escapeHtml(task.title)}</div><div class="task-meta"><span class="scope-tag ${task.scope}">${scopeLabel}</span><span class="project-tag">${escapeHtml(task.project)}</span><span class="due-tag">${escapeHtml(task.dueLabel || dueText(task.due))}</span></div>${note}</div><button class="task-menu" data-edit="${task.id}" aria-label="編輯任務">⋯</button>`;
  card.querySelector('.task-check').addEventListener('click', event => { event.stopPropagation(); task.done = !task.done; save(); render(); });
  card.querySelector('.task-menu').addEventListener('click', event => { event.stopPropagation(); openModal(task); });
  return card;
}

function updateSummary(summaryTasks = tasks) {
  const total = summaryTasks.length;
  const completed = summaryTasks.filter(task => task.done).length;
  const rate = total ? Math.round((completed / total) * 100) : 0;
  document.querySelector('#matrixCount').textContent = total;
  document.querySelector('#myTaskCount').textContent = total - completed;
  document.querySelector('#completedCount').textContent = completed;
  document.querySelector('#totalCount').textContent = total;
  document.querySelector('#completionProgress').style.width = `${rate}%`;
  document.querySelector('#completionRate').textContent = `${rate}%`;
  document.querySelector('#completionMeta').innerHTML = total ? `${total - completed} 件待處理 <span>保持穩定節奏</span>` : '先新增一個任務 <span>開始整理今天</span>';
}

function render() {
  const query = document.querySelector('#searchInput').value.trim().toLowerCase();
  const scopedTasks = activeScope === 'all' ? tasks : tasks.filter(task => task.scope === activeScope);
  Object.entries(lists).forEach(([quadrant, list]) => {
    list.innerHTML = '';
    const visible = scopedTasks.filter(task => task.quadrant === quadrant && (!query || task.title.toLowerCase().includes(query) || String(task.project || '').toLowerCase().includes(query) || String(task.note || '').toLowerCase().includes(query)));
    if (!visible.length) list.innerHTML = '<div class="empty-state">暫無符合的任務</div>';
    visible.forEach(task => list.appendChild(taskCard(task)));
    const parent = list.closest('.quadrant');
    parent.querySelector('.task-count').textContent = scopedTasks.filter(task => task.quadrant === quadrant).length;
  });
  updateSummary(scopedTasks);
}

const backdrop = document.querySelector('#modalBackdrop');
const form = document.querySelector('#taskForm');
function openModal(taskOrQuadrant = 'do') {
  const task = typeof taskOrQuadrant === 'object' ? taskOrQuadrant : null;
  form.reset();
  document.querySelector('#taskId').value = task?.id || '';
  document.querySelector('#taskQuadrant').value = task?.quadrant || taskOrQuadrant;
  if (task) {
    document.querySelector('#modalKicker').textContent = '編輯工作項目';
    document.querySelector('#modalTitle').textContent = '把任務調整到最適合的位置';
    document.querySelector('#submitTask').innerHTML = '儲存變更 <span>→</span>';
    document.querySelector('#taskTitle').value = task.title;
    document.querySelector('#taskProject').value = task.project;
    document.querySelector('#taskDate').value = /^\d{4}-\d{2}-\d{2}$/.test(task.due || '') ? task.due : '';
    document.querySelector('#taskNote').value = task.note || '';
  } else {
    document.querySelector('#modalKicker').textContent = '新增工作項目';
    document.querySelector('#modalTitle').textContent = '把下一件重要的事放進計畫';
    document.querySelector('#submitTask').innerHTML = '建立任務 <span>→</span>';
  }
  backdrop.classList.add('visible');
  document.querySelector('#taskTitle').focus();
}
function closeModal() { backdrop.classList.remove('visible'); form.reset(); }

document.querySelector('#openModal').addEventListener('click', () => openModal());
document.querySelector('#closeModal').addEventListener('click', closeModal);
backdrop.addEventListener('click', event => { if (event.target === backdrop) closeModal(); });
document.querySelectorAll('[data-add]').forEach(button => button.addEventListener('click', () => openModal(button.dataset.add)));
document.querySelector('#searchInput').addEventListener('input', render);
document.querySelector('#filterBtn').addEventListener('click', () => { document.querySelector('#searchInput').focus(); document.querySelector('#searchInput').placeholder = '輸入關鍵字篩選...'; });
document.querySelector('#todayBtn').addEventListener('click', () => document.querySelector('.focus-section').scrollIntoView({ behavior: 'smooth' }));
document.querySelector('#clearBtn').addEventListener('click', () => {
  if (!tasks.length) return;
  if (!window.confirm('確定要清除所有任務嗎？建議先匯出備份。')) return;
  tasks = [];
  save();
  render();
});

document.querySelector('#todayLabel').textContent = new Intl.DateTimeFormat('zh-TW', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }).format(new Date());
window.addEventListener('storage', event => { if (event.key === STORAGE_KEY) { tasks = readStoredTasks(); render(); } });

form.addEventListener('submit', event => {
  event.preventDefault();
  const id = document.querySelector('#taskId').value;
  const due = document.querySelector('#taskDate').value;
  const data = { title: document.querySelector('#taskTitle').value.trim(), project: document.querySelector('#taskProject').value, due, dueLabel: dueText(due), quadrant: document.querySelector('#taskQuadrant').value, note: document.querySelector('#taskNote').value.trim() };
  if (!data.title) return;
  const index = tasks.findIndex(task => String(task.id) === String(id));
  if (index >= 0) tasks[index] = { ...tasks[index], ...data };
  else tasks.unshift({ ...data, id: newTaskId(), done: false });
  save(); render(); closeModal();
});

const matrix = document.querySelector('#matrixGrid');
matrix.addEventListener('dragstart', event => { const card = event.target.closest('.task-card'); if (!card) return; card.classList.add('dragging'); event.dataTransfer.setData('text/plain', card.dataset.id); });
matrix.addEventListener('dragend', event => event.target.closest('.task-card')?.classList.remove('dragging'));
matrix.addEventListener('dragover', event => { const list = event.target.closest('.task-list'); if (list) { event.preventDefault(); list.classList.add('drag-over'); } });
matrix.addEventListener('dragleave', event => event.target.closest('.task-list')?.classList.remove('drag-over'));
matrix.addEventListener('drop', event => { const list = event.target.closest('.task-list'); if (!list) return; event.preventDefault(); list.classList.remove('drag-over'); const task = tasks.find(item => String(item.id) === event.dataTransfer.getData('text/plain')); if (task) { task.quadrant = list.closest('.quadrant').dataset.quadrant; save(); render(); } });

document.querySelector('#exportBtn').addEventListener('click', () => { const blob = new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), tasks }, null, 2)], { type: 'application/json' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `priorix-backup-${new Date().toISOString().slice(0, 10)}.json`; link.click(); URL.revokeObjectURL(link.href); });
document.querySelector('#importInput').addEventListener('change', async event => { const file = event.target.files[0]; if (!file) return; try { const data = JSON.parse(await file.text()); const imported = Array.isArray(data) ? data : data.tasks; if (!Array.isArray(imported)) throw new Error(); if (!window.confirm('匯入會取代目前所有任務，確定嗎？')) return; tasks = imported.map(task => ({ ...task, title: String(task.title || '').trim(), quadrant: legacyQuadrantMap[task.quadrant] || task.quadrant, project: task.project || '團隊營運', dueLabel: task.dueLabel || dueText(task.due) })).filter(task => task.title && quadrantKeys.includes(task.quadrant)); save(); render(); } catch { window.alert('這不是有效的 Priorix 備份檔。'); } finally { event.target.value = ''; } });
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeModal(); });
render();
