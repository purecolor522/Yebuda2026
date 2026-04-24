import { api, renderHeader, renderFooter, TWD, mediaUrl, refreshCartBadge } from './app.js';

renderHeader();
renderFooter();

async function loadSummary() {
  const cart = await api('/api/cart');
  if (!cart.items.length) {
    location.href = '/cart.html';
    return;
  }
  document.getElementById('ck-lines').innerHTML = cart.items.map(it => `
    <div class="ck-line">
      <img src="${mediaUrl(it.image)}" alt="">
      <div>
        <div class="nm">${it.name}</div>
        <div class="op">${it.color} / ${it.size} × ${it.qty}</div>
      </div>
      <div>${TWD(it.subtotal)}</div>
    </div>`).join('');
  document.getElementById('ck-sub').textContent = TWD(cart.subtotal);
  document.getElementById('ck-ship').textContent = cart.shipping === 0 ? '免運' : TWD(cart.shipping);
  document.getElementById('ck-total').textContent = TWD(cart.total);
}
loadSummary();

// Payment method toggle
document.querySelectorAll('.pay-opt').forEach(opt => {
  opt.addEventListener('click', () => {
    document.querySelectorAll('.pay-opt').forEach(o => o.classList.remove('selected'));
    opt.classList.add('selected');
    opt.querySelector('input').checked = true;
    const method = opt.querySelector('input').value;
    document.getElementById('card-fields').classList.toggle('show', method === 'card');
  });
});

// Card number & expiry formatting
const numInput = document.querySelector('[name="card_number"]');
numInput?.addEventListener('input', (e) => {
  e.target.value = e.target.value.replace(/\D/g, '').slice(0, 19).replace(/(.{4})/g, '$1 ').trim();
});
const expInput = document.querySelector('[name="card_expiry"]');
expInput?.addEventListener('input', (e) => {
  let v = e.target.value.replace(/\D/g, '').slice(0, 4);
  if (v.length >= 3) v = v.slice(0, 2) + '/' + v.slice(2);
  e.target.value = v;
});
const cvcInput = document.querySelector('[name="card_cvc"]');
cvcInput?.addEventListener('input', (e) => {
  e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4);
});

// Submit
document.getElementById('ck-submit').addEventListener('click', async () => {
  const form = document.getElementById('ck-form');
  const data = Object.fromEntries(new FormData(form));
  const errEl = document.getElementById('ck-error');
  errEl.style.display = 'none';

  if (!data.name || !data.phone || !data.email || !data.address) {
    errEl.textContent = '請填寫必要的收件資訊 (姓名 / 電話 / Email / 地址)';
    errEl.style.display = 'block';
    return;
  }

  const payload = {
    name: data.name, phone: data.phone, email: data.email,
    address: data.address, city: data.city, zip: data.zip,
    payment: data.payment
  };
  if (data.payment === 'card') {
    payload.card = {
      name: data.card_name,
      number: data.card_number,
      expiry: data.card_expiry,
      cvc: data.card_cvc
    };
  }

  const btn = document.getElementById('ck-submit');
  btn.disabled = true; btn.textContent = '處理中 · PROCESSING...';
  try {
    const res = await api('/api/checkout', { method: 'POST', body: payload });
    refreshCartBadge();
    if (res.redirectHtml) {
      // ECPay: replace page with auto-submit form -> redirect to gateway
      document.open();
      document.write(res.redirectHtml);
      document.close();
      return;
    }
    location.href = `/order.html?id=${res.order.id}`;
  } catch (e) {
    errEl.textContent = e.message || '結帳失敗，請確認資料後再試';
    errEl.style.display = 'block';
    btn.disabled = false; btn.textContent = '完成訂單 · PLACE ORDER';
  }
});
