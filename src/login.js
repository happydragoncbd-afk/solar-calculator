'use strict';

const btn        = document.getElementById('loginBtn');
const msgEl      = document.getElementById('message');
const warnEl     = document.getElementById('expiryWarning');
const usernameEl = document.getElementById('username');
const passwordEl = document.getElementById('password');

function showMessage(text, type) {
  msgEl.textContent = text;
  msgEl.className = `message ${type} visible`;
}

async function doLogin() {
  const username = usernameEl.value.trim();
  const password = passwordEl.value;

  if (!username || !password) {
    showMessage('Please enter your username and password.', 'error');
    return;
  }

  btn.disabled = true;
  btn.classList.add('loading');
  msgEl.className = 'message';

  try {
    const result = await window.electronAPI.login({ username, password });

    if (result.success) {
      showMessage(`Welcome, ${result.name}!`, 'success');
      if (result.daysLeft <= 30) {
        warnEl.textContent = `⚠ Licence expires in ${result.daysLeft} day${result.daysLeft !== 1 ? 's' : ''}`;
        warnEl.style.display = 'block';
      }
      // Main window opens automatically after 600ms (handled in main.js)
    } else {
      showMessage(result.error, 'error');
      btn.disabled = false;
      btn.classList.remove('loading');
      passwordEl.value = '';
      passwordEl.focus();
    }
  } catch (e) {
    showMessage('Unexpected error. Please restart the application.', 'error');
    btn.disabled = false;
    btn.classList.remove('loading');
  }
}

btn.addEventListener('click', doLogin);

[usernameEl, passwordEl].forEach(el =>
  el.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); })
);

document.getElementById('helpLink').addEventListener('click', e => {
  e.preventDefault();
  window.electronAPI.openExternal('https://aira.com');
});
