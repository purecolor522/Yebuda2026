import { api, renderHeader, renderFooter, TWD, mediaUrl, toast, refreshCartBadge } from './app.js';

renderHeader();
renderFooter();

const root = document.getElementById('cart-root');

async function load() {
  const cart = await api('/api/cart');
  render(cart);
}

function render(cart) {
  // preserve title + crumbs
  const head = `
    <h1>Shopping Bag</h1>
    <div class="crumbs">購物車 · 1 / 3 · CART</div>`;

  if (!cart.items.length) {
    root.innerHTML = head + `
      <div class="cart-empty">
        <h2>購物車是空的</h2>
        <p>把喜歡的單品加進來，我們為你保留 30 天。</p>
        <a href="/shop.html" class="btn-primary" style="display:inline-block;padding:14px 40px;">繼續選購</a>
      </div>`;
    return;
  }

  root.innerHTML = head + `
    <div class="cart-items">
      ${cart.items.map(it => `
        <div class="cart-row" data-pid="${it.productId}" data-size="${it.size}" data-color="${it.color}">
          <a href="/product.html?id=${it.productId}">
            <img src="${mediaUrl(it.image)}" alt="${it.name}">
          </a>
          <div class="meta">
            <div class="sub">${it.subtitle}</div>
            <a href="/product.html?id=${it.productId}"><div class="name">${it.name}</div></a>
            <div class="opts">${it.color} / 尺寸 ${it.size}</div>
            <div class="price">${TWD(it.price)}</div>
          </div>
          <div class="controls">
            <div class="qty-ctrl">
              <button data-act="dec">−</button>
              <input type="number" min="1" value="${it.qty}" class="qty-input">
              <button data-act="inc">+</button>
            </div>
            <div style="font-weight:600;">${TWD(it.subtotal)}</div>
            <button class="remove">REMOVE</button>
          </div>
        </div>`).join('')}
    </div>
    <aside class="cart-summary">
      <h3>Order Summary</h3>
      <div class="row"><span>商品小計</span><span>${TWD(cart.subtotal)}</span></div>
      <div class="row"><span>運費</span><span>${cart.shipping === 0 ? '免運' : TWD(cart.shipping)}</span></div>
      ${cart.subtotal < 3000 ? `
      <div class="hint">再消費 ${TWD(3000 - cart.subtotal)} 即可享免運優惠</div>` : ''}
      <div class="row total"><span>應付合計</span><span>${TWD(cart.total)}</span></div>
      <a href="/checkout.html" class="btn-primary" style="display:block;text-align:center;margin-top:20px;">前往結帳</a>
      <a href="/shop.html" style="display:block;text-align:center;margin-top:14px;font-size:12px;letter-spacing:0.25em;color:var(--ink-soft);">繼續選購</a>
    </aside>`;

  // wire controls
  root.querySelectorAll('.cart-row').forEach(row => {
    const pid = row.dataset.pid, size = row.dataset.size, color = row.dataset.color;
    const input = row.querySelector('.qty-input');
    row.querySelectorAll('[data-act]').forEach(btn => {
      btn.addEventListener('click', async () => {
        let v = Number(input.value) || 1;
        v = btn.dataset.act === 'inc' ? v + 1 : v - 1;
        if (v < 1) v = 1;
        input.value = v;
        await api('/api/cart', { method: 'PATCH', body: { productId: pid, size, color, qty: v } });
        refreshCartBadge();
        load();
      });
    });
    input.addEventListener('change', async () => {
      const v = Math.max(1, Number(input.value) || 1);
      await api('/api/cart', { method: 'PATCH', body: { productId: pid, size, color, qty: v } });
      refreshCartBadge();
      load();
    });
    row.querySelector('.remove').addEventListener('click', async () => {
      await api('/api/cart', { method: 'DELETE', body: { productId: pid, size, color } });
      toast('已移除');
      refreshCartBadge();
      load();
    });
  });
}

load();
