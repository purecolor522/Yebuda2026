import { api, renderHeader, renderFooter, productCard, TWD, mediaUrl, toast, refreshCartBadge } from './app.js';

const id = new URLSearchParams(location.search).get('id');
renderHeader();
renderFooter();

if (!id) {
  document.getElementById('pdp-root').innerHTML = '<p style="padding:80px;text-align:center;grid-column:1/-1;">缺少商品編號。</p>';
  throw new Error('no id');
}

let product;
let selectedSize;
let selectedColor;

async function load() {
  product = await api(`/api/products/${id}`);
  selectedSize = product.sizes?.[0] || 'FREE';
  selectedColor = product.colors?.[0] || product.color || '';
  renderPDP();
  renderRelated();
  document.title = `${product.name} · YEBUDA`;
}

function renderPDP() {
  const off = product.originalPrice
    ? Math.round((1 - product.price / product.originalPrice) * 100)
    : 0;
  const host = document.getElementById('pdp-root');
  host.innerHTML = `
    <div class="pdp-gallery">
      <img src="${mediaUrl(product.image)}" alt="${product.name}">
    </div>
    <div class="pdp-info">
      <div class="sub">${product.subtitle}${product.badge ? ' · ' + product.badge : ''}</div>
      <h1>${product.name}</h1>
      <div class="pdp-price">
        <span class="now">${TWD(product.price)}</span>
        ${product.originalPrice ? `
          <span class="was">${TWD(product.originalPrice)}</span>
          <span class="off">-${off}%</span>` : ''}
      </div>
      <div class="pdp-desc">${product.description}</div>

      <div class="opt-row">
        <div class="label">顏色 · Color</div>
        <div class="opt-pills" id="color-pills">
          ${(product.colors || [product.color]).map(c =>
            `<button class="opt-pill ${c === selectedColor ? 'selected' : ''}" data-color="${c}">${c}</button>`
          ).join('')}
        </div>
      </div>
      <div class="opt-row">
        <div class="label">尺寸 · Size</div>
        <div class="opt-pills" id="size-pills">
          ${product.sizes.map(s =>
            `<button class="opt-pill ${s === selectedSize ? 'selected' : ''}" data-size="${s}">${s}</button>`
          ).join('')}
        </div>
      </div>
      <div class="opt-row">
        <div class="label">數量 · Quantity</div>
        <div class="qty-ctrl">
          <button data-act="dec">−</button>
          <input id="qty" type="number" min="1" max="${product.stock}" value="1">
          <button data-act="inc">+</button>
        </div>
        <div style="font-size:12px;color:var(--ink-soft);margin-top:8px;">現貨 ${product.stock} 件</div>
      </div>

      <div class="pdp-actions">
        <button class="btn-primary" id="add-btn">加入購物車</button>
        <button class="btn-buy-now" id="buy-btn">立即購買</button>
      </div>

      <div class="pdp-meta">
        <span>韓國東大門產地直送</span>
        <span>滿 NT$3,000 免運</span>
        <span>7 天現貨鑑賞期</span>
        <span>預購商品約 4-21 日工作天</span>
        <span>支援信用卡 / ATM / LINE Pay</span>
        <span>單件預購、多件合併免運</span>
      </div>
    </div>`;

  // wire events
  host.querySelector('#color-pills').addEventListener('click', (e) => {
    const b = e.target.closest('.opt-pill'); if (!b) return;
    selectedColor = b.dataset.color;
    host.querySelectorAll('#color-pills .opt-pill').forEach(x => x.classList.toggle('selected', x === b));
  });
  host.querySelector('#size-pills').addEventListener('click', (e) => {
    const b = e.target.closest('.opt-pill'); if (!b) return;
    selectedSize = b.dataset.size;
    host.querySelectorAll('#size-pills .opt-pill').forEach(x => x.classList.toggle('selected', x === b));
  });
  const qtyInput = host.querySelector('#qty');
  host.querySelectorAll('[data-act]').forEach(btn => {
    btn.addEventListener('click', () => {
      let v = Number(qtyInput.value) || 1;
      v = btn.dataset.act === 'inc' ? v + 1 : v - 1;
      v = Math.max(1, Math.min(product.stock, v));
      qtyInput.value = v;
    });
  });
  host.querySelector('#add-btn').addEventListener('click', () => addToCart(false));
  host.querySelector('#buy-btn').addEventListener('click', () => addToCart(true));
}

async function addToCart(goCheckout) {
  const qty = Math.max(1, Number(document.getElementById('qty').value) || 1);
  try {
    await api('/api/cart', {
      method: 'POST',
      body: { productId: product.id, qty, size: selectedSize, color: selectedColor }
    });
    await refreshCartBadge();
    toast(`已加入購物車 · ${product.name}`);
    if (goCheckout) setTimeout(() => location.href = '/cart.html', 400);
  } catch (e) {
    toast('加入失敗，請稍候再試');
  }
}

function renderRelated() {
  if (!product.related?.length) return;
  document.getElementById('related-section').style.display = '';
  document.getElementById('related-grid').innerHTML =
    product.related.map(productCard).join('');
}

load();
