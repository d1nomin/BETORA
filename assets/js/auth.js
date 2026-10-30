const loginForm = document.getElementById('login-form'), registerForm = document.getElementById('register-form');
function setAuthTab(tab) {
  document.querySelectorAll('[data-auth-tab]').forEach(b => b.classList.toggle('active', b.dataset.authTab === tab));
  loginForm.classList.toggle('hidden', tab !== 'login'); registerForm.classList.toggle('hidden', tab !== 'register');
  document.getElementById('auth-switch').innerHTML = tab === 'login' ? 'Нет аккаунта? <button type="button" data-auth-tab="register">Зарегистрируйся</button>' : 'Уже есть аккаунт? <button type="button" data-auth-tab="login">Войти</button>';
}
document.addEventListener('click', e => { const tab = e.target.closest('[data-auth-tab]'); if (tab) setAuthTab(tab.dataset.authTab); });
(async () => { try { const {user} = await api('/me'); location.href = user.role === 'admin' ? '/admin.html' : '/app.html'; } catch (_) {} })();
loginForm.addEventListener('submit', async e => {
  e.preventDefault(); const button = loginForm.querySelector('button[type=submit]'); button.disabled = true;
  try { const body = Object.fromEntries(new FormData(loginForm)); const data = await api('/login', {method:'POST',body}); location.href = data.user.role === 'admin' ? '/admin.html' : '/app.html'; }
  catch (err) { toast(err.message, 'error'); } finally { button.disabled = false; }
});
registerForm.addEventListener('submit', async e => {
  e.preventDefault(); const button = registerForm.querySelector('button[type=submit]'); button.disabled = true;
  try { const body = Object.fromEntries(new FormData(registerForm)); const data = await api('/register', {method:'POST',body}); toast('Аккаунт создан. Добро пожаловать!', 'success'); location.href = data.user.role === 'admin' ? '/admin.html' : '/app.html'; }
  catch (err) { toast(err.message, 'error'); } finally { button.disabled = false; }
});
