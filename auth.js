/* =============================================================
   auth.js — login modal + nav auth widget for all pages
   ============================================================= */
'use strict';

(function initAuth() {
  // ---- Inject nav auth widget ----
  function buildNavWidget() {
    const widget = document.createElement('div');
    widget.id = 'auth-widget';
    widget.style.cssText = 'display:flex;align-items:center;gap:.6rem;font-family:inherit;';

    const user = VaultAPI.auth.getUser();
    if (user) {
      widget.innerHTML = `
        <span id="auth-user-label" style="color:#c8a96e;font-size:.8rem;">
          ${escapeHtml(user.username)}
          <span style="color:#7a6040;font-size:.7rem;">[${escapeHtml(user.role)}]</span>
        </span>
        ${user.role === 'admin' ? '<button id="auth-register-btn" class="nav-btn">New User</button>' : ''}
        <button id="auth-logout-btn" class="nav-btn">Logout</button>`;
    } else {
      widget.innerHTML = `<button id="auth-login-btn" class="nav-btn">Login</button>`;
    }
    return widget;
  }

  function injectNavWidget() {
    const nav = document.querySelector('.d2-nav') || document.querySelector('nav');
    if (!nav) return;
    document.getElementById('auth-widget')?.remove();
    nav.appendChild(buildNavWidget());
    bindNavEvents();
  }

  function bindNavEvents() {
    document.getElementById('auth-login-btn')?.addEventListener('click', () => openModal('login'));
    document.getElementById('auth-logout-btn')?.addEventListener('click', () => {
      VaultAPI.auth.logout();
      injectNavWidget();
      showFlash('Logged out.');
    });
    document.getElementById('auth-register-btn')?.addEventListener('click', () => openModal('register'));
  }

  // ---- Modal ----
  function buildModal(mode) {
    const isRegister = mode === 'register';
    const overlay = document.createElement('div');
    overlay.id = 'auth-modal-overlay';
    overlay.style.cssText = `
      position:fixed;inset:0;z-index:9000;
      background:rgba(0,0,0,.7);
      display:flex;align-items:center;justify-content:center;`;

    overlay.innerHTML = `
      <div id="auth-modal" style="
        background:#1a1510;border:1px solid #5a4020;
        padding:2rem;min-width:300px;max-width:360px;width:90%;
        box-shadow:0 0 30px rgba(0,0,0,.8);position:relative;">
        <div style="position:absolute;top:0;left:0;width:8px;height:8px;border-top:1px solid #c8a96e;border-left:1px solid #c8a96e;"></div>
        <div style="position:absolute;top:0;right:0;width:8px;height:8px;border-top:1px solid #c8a96e;border-right:1px solid #c8a96e;"></div>
        <div style="position:absolute;bottom:0;left:0;width:8px;height:8px;border-bottom:1px solid #c8a96e;border-left:1px solid #c8a96e;"></div>
        <div style="position:absolute;bottom:0;right:0;width:8px;height:8px;border-bottom:1px solid #c8a96e;border-right:1px solid #c8a96e;"></div>

        <h2 style="font-family:'Cinzel',serif;color:#c8a96e;margin:0 0 1.2rem;font-size:1.1rem;text-align:center;">
          ${isRegister ? 'Create Credentials' : 'Enter the Vault'}
        </h2>

        <form id="auth-form" autocomplete="off">
          <label style="display:block;color:#8a7050;font-size:.75rem;margin-bottom:.2rem;">Username</label>
          <input id="auth-username" type="text" autocomplete="off"
            style="width:100%;box-sizing:border-box;background:#0d0b09;border:1px solid #5a4020;color:#c8a96e;padding:.5rem;margin-bottom:.8rem;font-family:inherit;font-size:.9rem;"
            placeholder="username" required />

          <label style="display:block;color:#8a7050;font-size:.75rem;margin-bottom:.2rem;">Password</label>
          <input id="auth-password" type="password" autocomplete="new-password"
            style="width:100%;box-sizing:border-box;background:#0d0b09;border:1px solid #5a4020;color:#c8a96e;padding:.5rem;margin-bottom:.8rem;font-family:inherit;font-size:.9rem;"
            placeholder="password" required />

          ${isRegister ? `
          <label style="display:block;color:#8a7050;font-size:.75rem;margin-bottom:.2rem;">Role</label>
          <select id="auth-role"
            style="width:100%;box-sizing:border-box;background:#0d0b09;border:1px solid #5a4020;color:#c8a96e;padding:.5rem;margin-bottom:.8rem;font-family:inherit;font-size:.9rem;">
            <option value="author">author</option>
            <option value="admin">admin</option>
          </select>` : ''}

          <div id="auth-error" style="color:#c04040;font-size:.8rem;min-height:1rem;margin-bottom:.5rem;"></div>

          <div style="display:flex;gap:.5rem;justify-content:flex-end;">
            <button type="button" id="auth-modal-cancel"
              style="background:transparent;border:1px solid #5a4020;color:#8a7050;padding:.4rem .9rem;cursor:pointer;font-family:inherit;font-size:.85rem;">
              Cancel
            </button>
            <button type="submit"
              style="background:#3a2810;border:1px solid #c8a96e;color:#c8a96e;padding:.4rem .9rem;cursor:pointer;font-family:inherit;font-size:.85rem;">
              ${isRegister ? 'Create' : 'Login'}
            </button>
          </div>
        </form>
      </div>`;

    return overlay;
  }

  function openModal(mode = 'login') {
    document.getElementById('auth-modal-overlay')?.remove();
    const overlay = buildModal(mode);
    document.body.appendChild(overlay);

    const form     = document.getElementById('auth-form');
    const errEl    = document.getElementById('auth-error');
    const cancelBtn = document.getElementById('auth-modal-cancel');

    cancelBtn.addEventListener('click', closeModal);
    overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });

    form.addEventListener('submit', async e => {
      e.preventDefault();
      errEl.textContent = '';
      const username = document.getElementById('auth-username').value.trim();
      const password = document.getElementById('auth-password').value;

      try {
        if (mode === 'register') {
          const role = document.getElementById('auth-role').value;
          await VaultAPI.auth.register(username, password, role);
          closeModal();
          showFlash(`User "${username}" created as ${role}.`);
        } else {
          await VaultAPI.auth.login(username, password);
          closeModal();
          injectNavWidget();
          showFlash('Welcome back, ' + username + '!');
        }
      } catch (err) {
        errEl.textContent = err.message;
      }
    });

    document.getElementById('auth-username').focus();
  }

  function closeModal() {
    document.getElementById('auth-modal-overlay')?.remove();
  }

  // ---- Unauthorized event → prompt login ----
  document.addEventListener('vault:unauthorized', () => {
    injectNavWidget();
    openModal('login');
    showFlash('Session expired — please log in again.', 'error');
  });

  // ---- Boot ----
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectNavWidget);
  } else {
    injectNavWidget();
  }
})();
