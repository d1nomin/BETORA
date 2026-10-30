const API = '/api';
async function api(path, options = {}) {
  const config = { credentials: 'same-origin', ...options, headers: { ...(options.headers || {}) } };
  if (config.body && typeof config.body !== 'string') { config.headers['Content-Type'] = 'application/json'; config.body = JSON.stringify(config.body); }
  const response = await fetch(API + path, config);
  let data = {};
  try { data = await response.json(); } catch (_) { data = { error: 'Сервер вернул некорректный ответ' }; }
  if (!response.ok) throw new Error(data.error || 'Не удалось выполнить запрос');
  return data;
}
function toast(message, type = 'info') {
  let root = document.getElementById('toast-root');
  if (!root) { root = document.createElement('div'); root.id = 'toast-root'; root.className = 'toast-root'; document.body.append(root); }
  const item = document.createElement('div'); item.className = `toast ${type}`; item.textContent = message; root.append(item);
  setTimeout(() => item.remove(), 4200);
}
function esc(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function fmtDate(value) { const d = new Date(value); return Number.isNaN(d.getTime()) ? 'Дата не указана' : d.toLocaleString('ru-RU', { dateStyle:'short', timeStyle:'short' }); }
function statusLabel(status) { return ({pending:'В игре',won:'Выиграла',lost:'Проиграла',done:'Выполнена',upcoming:'Ожидает',live:'Идёт',finished:'Завершён'})[status] || status; }
function openModal(id) { document.getElementById(id)?.classList.add('open'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('open'); }
document.addEventListener('click', e => {
  const close = e.target.closest('[data-close]'); if (close) closeModal(close.dataset.close);
  if (e.target.classList.contains('modal')) e.target.classList.remove('open');
});
document.addEventListener('click', e => {
  const eye = e.target.closest('.eye'); if (!eye) return;
  const input = eye.parentElement.querySelector('input'); input.type = input.type === 'password' ? 'text' : 'password';
  eye.innerHTML = input.type === 'password' ? '<i class="fa-regular fa-eye"></i>' : '<i class="fa-regular fa-eye-slash"></i>';
});
async function requireUser(admin = false) {
  try { const data = await api('/me'); if (admin && data.user.role !== 'admin') location.href = '/app.html'; if (!admin && data.user.role === 'admin') location.href = '/admin.html'; return data.user; }
  catch (_) { location.href = '/'; return null; }
}
document.addEventListener('click', async e => {
  if (e.target.closest('#logout')) { try { await api('/logout', { method:'POST' }); } catch (_) {} location.href = '/'; }
});
