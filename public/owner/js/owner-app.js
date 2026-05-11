/* Shared owner helpers — auth gate, top nav, fetch wrapper, toast */
export const TWD = (n) => 'NT$' + Number(n || 0).toLocaleString('en-US');
export const fmtDate = (iso) => {
  const d = new Date(iso);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
};

export async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: opts.body instanceof FormData ? {} : { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    ...opts,
    body: opts.body instanceof FormData ? opts.body
        : opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401) {
    location.href = '/owner/login.html';
    throw new Error('owner auth required');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(err.error || 'Request failed');
  }
  return res.json();
}

export function toast(msg, type = 'info') {
  let el = document.querySelector('.owner-toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'owner-toast';
    document.body.appendChild(el);
  }
  el.className = 'owner-toast ' + type;
  el.textContent = msg;
  requestAnimationFrame(() => el.classList.add('show'));
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), 3000);
}

export async function ensureOwner() {
  try {
    const r = await fetch('/api/owner/whoami', { credentials: 'same-origin' });
    const { loggedIn } = await r.json();
    if (!loggedIn) { location.href = '/owner/login.html'; throw new Error('not owner'); }
  } catch {
    location.href = '/owner/login.html'; throw new Error('not owner');
  }
}

export function renderTopBar(active) {
  const path = location.pathname;
  const is = (id) => active === id || path.endsWith(id + '.html') || (id === 'index' && path.endsWith('/owner/'));
  const bar = document.createElement('div');
  bar.className = 'owner-topbar';
  bar.innerHTML = `
    <a href="/owner/" class="brand">YEBUDA<small>OWNER</small></a>
    <nav>
      <a href="/owner/" class="${is('index') ? 'active' : ''}">儀表板</a>
      <a href="/owner/inventory.html" class="${is('inventory') ? 'active' : ''}">進貨</a>
      <a href="/owner/stocktake.html" class="${is('stocktake') ? 'active' : ''}">盤點</a>
      <a href="/owner/finance.html" class="${is('finance') ? 'active' : ''}">損益</a>
      <a href="/admin/" style="color:#888;">→ 員工後台</a>
    </nav>
    <button class="logout" id="ownerLogoutBtn">登出</button>
  `;
  document.body.insertBefore(bar, document.body.firstChild);
  document.getElementById('ownerLogoutBtn').addEventListener('click', async () => {
    await fetch('/api/owner/logout', { method: 'POST', credentials: 'same-origin' });
    location.href = '/owner/login.html';
  });
}
