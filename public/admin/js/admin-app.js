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
    el.style.cssText = `position:fixed;bottom:32px;right:32px;background:#1f1d1a;
      color:#fff;padding:18px 28px;font-size:15px;font-weight:500;letter-spacing:0.02em;
      z-index:9999;transition:transform 0.3s ease, opacity 0.3s ease;transform:translateY(150%);opacity:0;
      box-shadow:0 12px 36px rgba(0,0,0,0.35);border-radius:8px;max-width:420px;line-height:1.5;`;
    document.body.appendChild(el);
  }
  // Cap super-long error payloads so they don't blow up the UI
  const safe = String(msg ?? '');
  el.textContent = safe.length > 160 ? safe.slice(0, 157) + '…' : safe;
  el.style.background = type === 'error' ? '#c84436' : type === 'success' ? '#3f6e3a' : '#1f1d1a';
  requestAnimationFrame(() => {
    el.style.transform = 'translateY(0)';
    el.style.opacity = '1';
  });
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    el.style.transform = 'translateY(150%)';
    el.style.opacity = '0';
  }, 4000);
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
        <a href="/admin/publish.html" class="${is('publish.html') ? 'active' : ''}">
          <span class="ic">▲</span> 待上架 上架
        </a>
        <a href="/admin/orders.html" class="${is('orders.html') ? 'active' : ''}">
          <span class="ic">✧</span> Orders 訂單
        </a>
        <a href="/admin/home-settings.html" class="${is('home-settings.html') ? 'active' : ''}">
          <span class="ic">⬚</span> 首頁設定
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

  // Mobile-only "back to dashboard" chip — appears at top of every admin sub-page
  // The dashboard itself doesn't need it (already there)
  const onDashboard = path === '/admin/' || path.endsWith('/admin/index.html');
  if (!onDashboard && !document.getElementById('mobile-back-chip')) {
    const chip = document.createElement('a');
    chip.id = 'mobile-back-chip';
    chip.href = '/admin/';
    chip.innerHTML = '← 後台主頁';
    document.body.prepend(chip);
  }
}

ensureAuthed();
renderShell();
