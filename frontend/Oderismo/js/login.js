import { api, clearSession } from './api.js';

export function renderLogin(container, onLogin) {
  container.innerHTML = `
    <div class="min-h-screen flex items-center justify-end">
      <div class="glass-card">
        <h1 class="title title-sm font-serifDisplay">Oderismo</h1>
        <p class="subtitle subtitle-sm font-serifDisplay">Acceso al sistema</p>
        <form id="login-form" class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-brand-800 mb-1">Email</label>
            <input id="email" type="email" required
              class="w-full px-3 py-2 border border-brand-200 rounded-lg bg-white/80 text-brand-900 focus:ring-4 focus:ring-brand-200 outline-none">
          </div>
          <div>
            <label class="block text-sm font-medium text-brand-800 mb-1">Contraseña</label>
            <input id="password" type="password" required
              class="w-full px-3 py-2 border border-brand-200 rounded-lg bg-white/80 text-brand-900 focus:ring-4 focus:ring-brand-200 outline-none">
          </div>
          <p id="login-error" class="text-red-500 text-sm hidden"></p>
          <button type="submit"
            class="w-full btn btn-primary">
            Iniciar sesión
          </button>
        </form>
      </div>
    </div>
  `;

  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const errorEl = document.getElementById('login-error');
    try {
      await api.login(email, password);
      onLogin();
    } catch (err) {
      clearSession();
      errorEl.textContent = err.message;
      errorEl.classList.remove('hidden');
    }
  });
}
