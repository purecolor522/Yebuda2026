/* Shared admin helpers + sidebar + auth gate */
export const TWD = n => 'NT$' + Number(n).toLocaleString('en-US');
export const fmtDate = (iso) => new Date(iso).toLocaleString('zh-TW', {
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit'
});

export async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: opts.body instanceof FormData ? {} : { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    ...opts,
    body: opts.body instanceof FormData ? opts.body
        : opts.body ? JSON.stringify(opts.body) : undefined
  });
  if (res.status === 401) {
    location.href = '/admin/login.html';
    throw new Error('auth required');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(err.error || 'Request failed');
  }
  return res.json();
}

export function toast(msg, type = 'info') {
  let el = document.querySelector('.admin-toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'admin-toast';
    el.style.cssText = `position:fixed;bottom:24px;right:24px;background:#1f1d1a;
      color:#fff;padding:12px 20px;font-size:13px;letter-spacing:0.08em;
      z-index:1000;transition:transform 0.25s ease;transform:translateY(120%);
      box-shadow:0 10px 30px rgba(0,0,0,0.25);border-radius:6px;max-width:360px;`;
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.background = type === 'error' ? '#b13a2f' : type === 'success' ? '#3f6e3a' : '#1f1d1a';
  requestAnimationFrame(() => el.style.transform = 'translateY(0)');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.style.transform = 'translateY(120%)', 2400);
}

export async function ensureAuthed() {
  const res = await fetch('/api/admin/whoami', { credentials: 'same-origin' });
  const { loggedIn } = await res.json();
  if (!loggedIn) { location.href = '/admin/login.html'; throw new Error('no auth'); }
}

export function renderShell(active) {
  const path = location.pathname;
  const is = (p) => active === p || path.endsWith(p);
  const shell = document.getElementById('shell');
  if (!shell) return;
  shell.className = 'admin-shell';
  shell.innerHTML = `
    <aside class="sidebar">
      <div class="brand-box">
        <div class="brand-mark">YEBUDA</div>
        <div class="brand-sub">ADMIN CONSOLE</div>
      </div>
      <nav>
        <a href="/admin/" class="${is('/admin/') || is('/admin/index.html') ? 'active' : ''}">
          <span class="ic">▦</span> Dashboard 儀表板
        </a>
        <a href="/admin/products.html" class="${is('products.html') || is('product-edit.html') ? 'active' : ''}">
          <span class="ic">◉</span> Products 商品
        </a>
        <a href="/admin/orders.html" class="${is('orders.html') ? 'active' : ''}">
          <span class="ic">✧</span> Orders 訂單
        </a>
        <a href="/" target="_blank">
          <span class="ic">↗</span> 查看前台
        </a>
      </nav>
      <div class="foot">
        <div style="color:#8c8274;font-size:11px;letter-spacing:0.15em;">YEBUDA v1.0</div>
        <a href="#" id="logout-btn">Logout 登出 →</a>
      </div>
    </aside>`;

  document.getElementById('logout-btn').addEventListener('click', async (e) => {
    e.preventDefault();
    await fetch('/api/admin/logout', { method: 'POST', credentials: 'same-origin' });
    location.href = '/admin/login.html';
  });
}

ensureAuthed();
renderShell();
