const initialTasks = [];

const STORAGE_KEY = 'priorix-tasks';
const quadrantKeys = ['do', 'schedule', 'delegate', 'delete'];
const legacyQuadrantMap = { eliminate: 'delete' };
const scopeKeys = ['pm', 'personal'];
const PROFILE_STORAGE_KEY = 'priorix-profile-v1';
const SUPABASE_URL = 'https://tjhcjhopjvaajhjnihjk.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_35IIzIC2QYvaCaGbzj3erQ_iEH6Gj2h';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
let supabaseAccessToken = null;
const TASKS_ENDPOINT = `${SUPABASE_URL}/rest/v1/pm_tasks`;
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
let profile = null;
try { profile = JSON.parse(localStorage.getItem(PROFILE_STORAGE_KEY) || 'null'); } catch { profile = null; }

function setActiveScope(scope) {
  activeScope = scopeKeys.includes(scope) ? scope : 'all';
  document.querySelectorAll('[data-scope]').forEach(item => item.classList.toggle('active', item.dataset.scope === activeScope));
  render();
}

function applyProfile(data) {
  profile = { name: String(data.name || '').trim(), purpose: scopeKeys.includes(data.purpose) ? data.purpose : 'personal' };
  try { localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile)); } catch { /* 預覽模式不影響本次使用 */ }
  document.querySelector('#userName').textContent = profile.name;
  document.querySelector('#profileNameLabel').textContent = profile.name;
  document.querySelector('#profilePurposeLabel').textContent = profile.purpose === 'pm' ? '專案管理' : '個人專案管理';
  setActiveScope(profile.purpose);
}

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
let taskSyncPending = false;
let taskSyncFailed = false;
function taskToRow(task) {
  return { task_id: String(task.id), title: task.title, scope: task.scope, project: task.project || '個人', due: /^\d{4}-\d{2}-\d{2}$/.test(task.due || '') ? task.due : null, due_label: task.dueLabel || dueText(task.due), quadrant: task.quadrant, note: task.note || '', done: Boolean(task.done), focus_minutes: Number(task.focusMinutes) || 0, focus_date: Number(task.focusMinutes) > 0 ? (task.focusDate || localDateKey()) : null, completed_at: task.completedAt || null };
}
function rowToTask(row) {
  return { id: row.task_id, title: row.title, scope: row.scope, project: row.project, due: row.due || '', dueLabel: row.due_label || dueText(row.due), quadrant: row.quadrant, note: row.note || '', done: row.done, focusMinutes: row.focus_minutes || 0, focusDate: row.focus_date || '', completedAt: row.completed_at || null };
}
function localDateKey(date = new Date()) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
async function requestTasks(method, rows) {
  const response = await fetch(method === 'GET' ? `${TASKS_ENDPOINT}?select=*&order=updated_at.asc` : TASKS_ENDPOINT, {
    method,
    headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${supabaseAccessToken}`, 'Content-Type': 'application/json', ...(method === 'POST' ? { Prefer: 'resolution=merge-duplicates,return=minimal' } : {}) },
    ...(rows ? { body: JSON.stringify(rows) } : {})
  });
  if (!response.ok) throw new Error(`Supabase task request failed: ${response.status}`);
  return method === 'GET' ? response.json() : null;
}
async function syncTasks() {
  const current = await requestTasks('GET');
  const keep = new Set(tasks.map(task => String(task.id)));
  const obsolete = current.map(row => row.task_id).filter(id => !keep.has(String(id)));
  if (obsolete.length) {
    const response = await fetch(`${TASKS_ENDPOINT}?task_id=in.${encodeURIComponent(`(${obsolete.join(',')})`)}`, { method: 'DELETE', headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${supabaseAccessToken}` } });
    if (!response.ok) throw new Error(`Supabase task delete failed: ${response.status}`);
  }
  if (tasks.length) await requestTasks('POST', tasks.map(taskToRow));
}
function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks)); } catch { /* 保留本次工作階段資料 */ }
  taskSyncPending = true;
  if (supabaseAccessToken) syncTasks().then(() => {
    taskSyncPending = false;
    taskSyncFailed = false;
    document.querySelector('#syncNotice').hidden = true;
  }).catch(error => {
    taskSyncPending = false;
    taskSyncFailed = true;
    console.error('任務同步失敗', error);
    document.querySelector('#syncNotice').hidden = false;
  });
}
async function loadRemoteTasks() {
  const rows = await requestTasks('GET');
  if (rows.length) tasks = rows.map(rowToTask);
  else if (tasks.length) await syncTasks();
  else tasks = [];
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks)); } catch { /* 保留本次工作階段資料 */ }
  taskSyncPending = false;
  taskSyncFailed = false;
  document.querySelector('#syncNotice').hidden = true;
  render();
}
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
  card.querySelector('.task-check').addEventListener('click', event => { event.stopPropagation(); task.done = !task.done; task.completedAt = task.done ? new Date().toISOString() : null; save(); render(); });
  card.querySelector('.task-menu').addEventListener('click', event => { event.stopPropagation(); openModal(task); });
  return card;
}

function updateSummary(summaryTasks = tasks) {
  const total = summaryTasks.length;
  const completed = summaryTasks.filter(task => task.done).length;
  const rate = total ? Math.round((completed / total) * 100) : 0;
  const today = new Date();
  const todayKey = localDateKey(today);
  const focusMinutes = summaryTasks.filter(task => task.focusDate === todayKey).reduce((sum, task) => sum + (Number(task.focusMinutes) || 0), 0);
  const completedDates = new Set(tasks.filter(task => task.done && task.completedAt).map(task => localDateKey(new Date(task.completedAt))));
  let streak = 0;
  const cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (!completedDates.has(localDateKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (completedDates.has(localDateKey(cursor))) { streak++; cursor.setDate(cursor.getDate() - 1); }
  document.querySelector('#matrixCount').textContent = total;
  document.querySelector('#myTaskCount').textContent = total - completed;
  document.querySelector('#completedCount').textContent = completed;
  document.querySelector('#totalCount').textContent = total;
  document.querySelector('#completionProgress').style.width = `${rate}%`;
  document.querySelector('#completionRate').textContent = `${rate}%`;
  document.querySelector('#completionMeta').innerHTML = total ? `${total - completed} 件待處理 <span>保持穩定節奏</span>` : '先新增一個任務 <span>開始整理今天</span>';
  document.querySelector('.stats-grid .stat-card:first-child .stat-value').innerHTML = `${Math.floor(focusMinutes / 60)}<span class="stat-unit">h ${focusMinutes % 60}m</span>`;
  document.querySelector('.stats-grid .stat-card:nth-child(3) .stat-value').innerHTML = `${streak}<span class="stat-unit">天</span>`;
  const weekStart = new Date(today.getFullYear(), today.getMonth(), today.getDate() - ((today.getDay() + 6) % 7));
  document.querySelectorAll('.week-dots i').forEach((dot, index) => {
    const day = new Date(weekStart); day.setDate(weekStart.getDate() + index);
    dot.classList.toggle('done', completedDates.has(localDateKey(day)));
  });
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
const profileBackdrop = document.querySelector('#profileBackdrop');
const profileForm = document.querySelector('#profileForm');
function openProfile(changeUser = false) {
  document.querySelector('#profileName').value = profile?.name || '';
  document.querySelector('#profilePurpose').value = profile?.purpose || 'personal';
  document.querySelector('#profileTitle').textContent = changeUser ? '輸入新的使用者設定' : (profile ? '更新你的使用設定' : '先告訴我怎麼稱呼你');
  document.querySelector('.profile-modal .modal-kicker').textContent = changeUser ? '更換使用者' : (profile ? '個人設定' : '開始使用');
  profileForm.querySelector('button[type="submit"]').innerHTML = changeUser ? '套用新設定 <span>→</span>' : (profile ? '儲存設定 <span>→</span>' : '開始使用 <span>→</span>');
  document.querySelector('#profileFormStatus').textContent = '';
  profileBackdrop.classList.add('visible');
  document.querySelector('#profileName').focus();
}
function closeProfile() { profileBackdrop.classList.remove('visible'); }
profileForm.addEventListener('submit', async event => {
  event.preventDefault();
  const submitButton = profileForm.querySelector('button[type="submit"]');
  const status = document.querySelector('#profileFormStatus');
  const response = { name: document.querySelector('#profileName').value.trim(), purpose: document.querySelector('#profilePurpose').value };
  submitButton.disabled = true;
  status.textContent = '正在儲存問卷…';
  try {
    const result = await fetch(`${SUPABASE_URL}/rest/v1/profile_questionnaire_responses`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      },
      body: JSON.stringify(response)
    });
    if (!result.ok) throw new Error(`HTTP ${result.status}`);
    applyProfile(response);
    status.textContent = '';
    profileBackdrop.classList.remove('visible');
  } catch (error) {
    console.error('問卷儲存失敗', error);
    status.textContent = '問卷暫時無法儲存，請確認網路後再試一次。';
  } finally {
    submitButton.disabled = false;
  }
});
document.querySelector('#closeProfile').addEventListener('click', closeProfile);
profileBackdrop.addEventListener('click', event => { if (event.target === profileBackdrop) closeProfile(); });
document.querySelector('#profileBtn').addEventListener('click', openProfile);
document.querySelector('#changeUserBtn').addEventListener('click', () => openProfile(true));
function openModal(taskOrQuadrant = 'do') {
  const task = typeof taskOrQuadrant === 'object' ? taskOrQuadrant : null;
  form.reset();
  document.querySelector('#taskId').value = task?.id || '';
  document.querySelector('#taskScope').value = task?.scope || profile?.purpose || 'personal';
  document.querySelector('#taskQuadrant').value = task?.quadrant || taskOrQuadrant;
  if (task) {
    document.querySelector('#modalKicker').textContent = '編輯工作項目';
    document.querySelector('#modalTitle').textContent = '把任務調整到最適合的位置';
    document.querySelector('#submitTask').innerHTML = '儲存變更 <span>→</span>';
    document.querySelector('#taskTitle').value = task.title;
    document.querySelector('#taskProject').value = ['個人', '工作', '學習', '生活', '健康', '財務'].includes(task.project) ? task.project : '工作';
    document.querySelector('#taskDate').value = /^\d{4}-\d{2}-\d{2}$/.test(task.due || '') ? task.due : '';
    document.querySelector('#taskFocusMinutes').value = task.focusMinutes || 0;
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
document.querySelectorAll('[data-scope]').forEach(button => button.addEventListener('click', () => setActiveScope(button.dataset.scope)));
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
window.addEventListener('beforeunload', event => {
  if (!taskSyncPending && !taskSyncFailed) return;
  event.preventDefault();
  event.returnValue = '';
});
window.addEventListener('storage', event => { if (event.key === STORAGE_KEY) { tasks = readStoredTasks(); render(); } });

form.addEventListener('submit', event => {
  event.preventDefault();
  const id = document.querySelector('#taskId').value;
  const due = document.querySelector('#taskDate').value;
  const focusMinutes = Number(document.querySelector('#taskFocusMinutes').value) || 0;
  const data = { title: document.querySelector('#taskTitle').value.trim(), scope: document.querySelector('#taskScope').value, project: document.querySelector('#taskProject').value, due, dueLabel: dueText(due), quadrant: document.querySelector('#taskQuadrant').value, note: document.querySelector('#taskNote').value.trim(), focusMinutes, focusDate: focusMinutes ? localDateKey() : '' };
  if (!data.title) return;
  const index = tasks.findIndex(task => String(task.id) === String(id));
  if (index >= 0) tasks[index] = { ...tasks[index], ...data };
  else tasks.unshift({ ...data, id: newTaskId(), done: false, completedAt: null });
  save(); render(); closeModal();
});

const matrix = document.querySelector('#matrixGrid');
matrix.addEventListener('dragstart', event => { const card = event.target.closest('.task-card'); if (!card) return; card.classList.add('dragging'); event.dataTransfer.setData('text/plain', card.dataset.id); });
matrix.addEventListener('dragend', event => event.target.closest('.task-card')?.classList.remove('dragging'));
matrix.addEventListener('dragover', event => { const list = event.target.closest('.task-list'); if (list) { event.preventDefault(); list.classList.add('drag-over'); } });
matrix.addEventListener('dragleave', event => event.target.closest('.task-list')?.classList.remove('drag-over'));
matrix.addEventListener('drop', event => { const list = event.target.closest('.task-list'); if (!list) return; event.preventDefault(); list.classList.remove('drag-over'); const task = tasks.find(item => String(item.id) === event.dataTransfer.getData('text/plain')); if (task) { task.quadrant = list.closest('.quadrant').dataset.quadrant; save(); render(); } });

document.querySelector('#exportBtn').addEventListener('click', () => { const blob = new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), tasks }, null, 2)], { type: 'application/json' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `priorix-backup-${new Date().toISOString().slice(0, 10)}.json`; link.click(); URL.revokeObjectURL(link.href); });
document.querySelector('#importInput').addEventListener('change', async event => { const file = event.target.files[0]; if (!file) return; try { const data = JSON.parse(await file.text()); const imported = Array.isArray(data) ? data : data.tasks; if (!Array.isArray(imported)) throw new Error(); if (!window.confirm('匯入會取代目前所有任務，確定嗎？')) return; tasks = imported.map(task => ({ ...task, title: String(task.title || '').trim(), scope: inferScope(task), quadrant: legacyQuadrantMap[task.quadrant] || task.quadrant, project: task.project || '個人', dueLabel: task.dueLabel || dueText(task.due) })).filter(task => task.title && quadrantKeys.includes(task.quadrant)); save(); render(); } catch { window.alert('這不是有效的 PM 備份檔。'); } finally { event.target.value = ''; } });
document.addEventListener('keydown', event => { if (event.key === 'Escape') { closeModal(); closeProfile(); } });
if (profile?.name && scopeKeys.includes(profile.purpose)) applyProfile(profile);
else { render(); openProfile(); }
(async () => {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session) supabaseAccessToken = session.access_token;
  else {
    const { data, error } = await supabaseClient.auth.signInAnonymously();
    if (error) throw error;
    supabaseAccessToken = data.session.access_token;
  }
  await loadRemoteTasks();
})().catch(error => { console.error('Supabase 初始化失敗', error); document.querySelector('#syncNotice').hidden = false; });
