/* Standalone checkout page logic.
   Self-contained — does not depend on app.js (which is for the homepage). */

const TWD = (n) => 'NT$' + Number(n || 0).toLocaleString('en-US');

let cart = [];
let cartTotalsFromServer = { subtotal: 0, shipping: 0, total: 0 };
let currentCustomer = null;

// ===== INIT =====
document.addEventListener('DOMContentLoaded', async () => {
  await loadCart();
  if (!cart.length) return;   // empty-cart screen rendered
  await restoreSession();
  populateCouponSelect();
  syncShippingMethodUI();
  syncRecipientUI();
  updateSummary();
  bindEvents();
});

async function loadCart() {
  try {
    const res = await fetch('/api/cart');
    const data = await res.json();
    cart = data.items || [];
    cartTotalsFromServer = { subtotal: data.subtotal || 0, shipping: data.shipping || 0, total: data.total || 0 };
  } catch (e) { console.error(e); cart = []; }
  renderItemsOrEmpty();
}

function renderItemsOrEmpty() {
  if (!cart.length) {
    document.getElementById('ckPage').innerHTML = `
      <div class="empty-cart" style="grid-column:1/-1;">
        <h2 style="font-family:var(--font-serif);font-size:24px;letter-spacing:2px;margin-bottom:10px;">購物車是空的</h2>
        <p style="margin-bottom:18px;color:#888;">先去逛逛商品吧 ✨</p>
        <a href="/" class="autofill-chip">← 回去逛商品</a>
      </div>`;
    return;
  }
  const root = document.getElementById('summaryItems');
  root.innerHTML = cart.map(it => `
    <div class="sum-item">
      <img src="${it.image}" alt="${it.name}">
      <div class="si-info">
        <h4>${it.name}</h4>
        <small>${it.size || ''}${it.color ? ' · ' + it.color : ''} · 數量 ${it.qty}</small>
      </div>
      <div class="si-price">${TWD(it.subtotal)}</div>
    </div>`).join('');
}

async function restoreSession() {
  const token = localStorage.getItem('yebuda_token');
  if (!token) return;
  try {
    const res = await fetch('/api/auth/me', { headers: { 'Authorization': `Bearer ${token}` } });
    if (res.ok) {
      currentCustomer = await res.json();
      // Pre-fill email + show autofill chip
      if (currentCustomer.email) document.getElementById('buyerEmail').value = currentCustomer.email;
      document.getElementById('autofillBtn').style.display = 'inline-block';
    }
  } catch {}
}

// ===== SUMMARY =====
function getSummary() {
  const subtotal = cart.reduce((s, x) => s + (x.subtotal || 0), 0);
  const uiShip = document.querySelector('input[name="shippingMethod"]:checked')?.value || 'address';
  const isCvs = uiShip === 'cvs-711' || uiShip === 'cvs-fami';
  const freeThreshold = isCvs ? 2000 : 3000;
  const shipping = subtotal === 0 ? 0 : (subtotal >= freeThreshold ? 0 : 80);
  const couponId = document.getElementById('couponSelect')?.value || '';
  const coupon = couponId ? (currentCustomer?.coupons || []).find(c => c.id === couponId) : null;
  const discount = coupon ? Math.min(coupon.amount, subtotal) : 0;
  const total = Math.max(0, subtotal + shipping - discount);
  return { subtotal, shipping, discount, total, coupon, freeThreshold, isCvs };
}

function updateSummary() {
  const s = getSummary();
  document.getElementById('csSubtotal').textContent = TWD(s.subtotal);
  const shipEl = document.getElementById('csShipping');
  if (s.shipping === 0) {
    shipEl.textContent = '免運 ✨';
    shipEl.style.color = 'var(--accent)';
  } else {
    const gap = s.freeThreshold - s.subtotal;
    shipEl.innerHTML = `${TWD(s.shipping)} <span style="font-size:11px;color:#999">再 ${TWD(gap)} ${s.isCvs ? '超商' : '宅配'}免運</span>`;
    shipEl.style.color = '';
  }
  const line = document.getElementById('csCouponLine');
  if (s.discount > 0) {
    line.style.display = 'flex';
    document.getElementById('csCouponLabel').textContent = `折價券 ${s.coupon?.reason || ''}`;
    document.getElementById('csCouponAmount').textContent = `−${TWD(s.discount)}`;
  } else {
    line.style.display = 'none';
  }
  document.getElementById('csTotal').textContent = TWD(s.total);
}

// ===== COUPONS =====
function populateCouponSelect() {
  const sel = document.getElementById('couponSelect');
  const card = document.getElementById('couponCard');
  const available = (currentCustomer?.coupons || []).filter(c => !c.usedAt);
  if (!available.length) { card.style.display = 'none'; return; }
  card.style.display = 'block';
  sel.innerHTML = '<option value="">不使用折價券</option>' +
    available.map(c => `<option value="${c.id}">NT$${c.amount} ${c.reason || c.code}</option>`).join('');
}

// ===== SHIPPING / RECIPIENT UI =====
function currentCvsBrand() {
  const v = document.querySelector('input[name="shippingMethod"]:checked')?.value;
  if (v === 'cvs-711') return '7-11';
  if (v === 'cvs-fami') return '全家';
  return null;
}
function syncShippingMethodUI() {
  const brand = currentCvsBrand();
  const isCvs = !!brand;
  document.getElementById('addressBlock').style.display = isCvs ? 'none' : 'block';
  document.getElementById('cvsBlock').style.display = isCvs ? 'block' : 'none';
  document.getElementById('buyerAddress').required = !isCvs;

  // CVS-COD only when CVS shipping
  const cvsCodLabel = document.getElementById('payCvsCodLabel');
  if (cvsCodLabel) cvsCodLabel.style.display = isCvs ? 'flex' : 'none';
  if (!isCvs) {
    const cvsCodRadio = document.querySelector('input[name="paymentMethod"][value="cvs-cod"]');
    if (cvsCodRadio?.checked) {
      document.querySelector('input[name="paymentMethod"][value="ecpay"]').checked = true;
    }
  }
  if (isCvs) {
    const btn = document.getElementById('pickStoreBtn');
    const lbl = document.getElementById('pickStoreLabel');
    if (brand === '7-11') { btn.style.borderColor = '#e63946'; btn.style.color = '#e63946'; lbl.textContent = '🟧 點擊選擇 7-ELEVEN 門市'; }
    else                  { btn.style.borderColor = '#00a651'; btn.style.color = '#00a651'; lbl.textContent = '🟩 點擊選擇 全家 門市'; }
    const pickedBrand = document.getElementById('cvsBrand').value;
    if (pickedBrand && pickedBrand !== brand) clearCvsSelection();
  }
  updateSummary();
}

function syncRecipientUI() {
  const same = document.getElementById('sameAsPurchaser').checked;
  document.getElementById('recipientFields').style.display = same ? 'none' : 'block';
  if (same) mirrorPurchaserToRecipient();
}
function mirrorPurchaserToRecipient() {
  document.getElementById('rcpName').value = document.getElementById('buyerName').value;
  document.getElementById('rcpPhone').value = document.getElementById('buyerPhone').value;
}

// ===== CVS MAP PICKER =====
function openCvsPicker(brand) {
  const overlay = document.getElementById('cvsMapOverlay');
  document.getElementById('cvsMapTitle').textContent = `選擇 ${brand} 門市`;
  document.getElementById('cvsMapFrame').src = `/api/cvs/map?brand=${encodeURIComponent(brand)}`;
  overlay.style.display = 'block';
  document.body.style.overflow = 'hidden';
}
function closeCvsPicker() {
  document.getElementById('cvsMapOverlay').style.display = 'none';
  document.getElementById('cvsMapFrame').src = 'about:blank';
  document.body.style.overflow = '';
}
function applyCvsSelection(d) {
  if (!d?.storeName) return;
  document.getElementById('cvsBrand').value = d.brand || '';
  document.getElementById('cvsStore').value = d.storeName || '';
  document.getElementById('cvsStoreId').value = d.storeId || '';
  document.getElementById('cvsStoreAddress').value = d.address || '';
  document.getElementById('cvsSelBrand').textContent = d.brand || '';
  document.getElementById('cvsSelName').textContent = `${d.storeName}${d.storeId ? ` #${d.storeId}` : ''}`;
  document.getElementById('cvsSelAddr').textContent = d.address || '';
  document.getElementById('cvsSelected').style.display = 'block';
}
function clearCvsSelection() {
  ['cvsBrand', 'cvsStore', 'cvsStoreId', 'cvsStoreAddress'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('cvsSelected').style.display = 'none';
}

// ===== EVENTS =====
function bindEvents() {
  // Autofill
  document.getElementById('autofillBtn').addEventListener('click', () => {
    if (!currentCustomer) return;
    if (currentCustomer.name)  document.getElementById('buyerName').value  = currentCustomer.name;
    if (currentCustomer.phone) document.getElementById('buyerPhone').value = currentCustomer.phone;
    if (currentCustomer.email) document.getElementById('buyerEmail').value = currentCustomer.email;
    if (currentCustomer.address) {
      document.getElementById('buyerAddress').value = currentCustomer.address;
      // Saved address → 宅配 mode
      const addrRadio = document.querySelector('input[name="shippingMethod"][value="address"]');
      if (addrRadio && !addrRadio.checked) { addrRadio.checked = true; syncShippingMethodUI(); }
    }
    if (document.getElementById('sameAsPurchaser').checked) mirrorPurchaserToRecipient();
  });

  // Shipping + payment radios
  document.querySelectorAll('input[name="shippingMethod"]').forEach(r =>
    r.addEventListener('change', syncShippingMethodUI));
  document.querySelectorAll('input[name="paymentMethod"]').forEach(r =>
    r.addEventListener('change', updateSummary));

  // Recipient checkbox + purchaser fields mirror
  document.getElementById('sameAsPurchaser').addEventListener('change', syncRecipientUI);
  ['buyerName', 'buyerPhone'].forEach(id => {
    document.getElementById(id).addEventListener('input', () => {
      if (document.getElementById('sameAsPurchaser').checked) mirrorPurchaserToRecipient();
    });
  });

  // CVS picker
  document.getElementById('pickStoreBtn').addEventListener('click', () => {
    const brand = currentCvsBrand();
    if (brand) openCvsPicker(brand);
  });
  document.getElementById('cvsChangeBtn').addEventListener('click', (e) => {
    e.preventDefault(); clearCvsSelection();
  });
  document.getElementById('cvsMapClose').addEventListener('click', closeCvsPicker);
  document.getElementById('cvsMapOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'cvsMapOverlay') closeCvsPicker();
  });
  window.addEventListener('message', (e) => {
    if (e?.data?.type !== 'cvs-store-selected') return;
    applyCvsSelection(e.data.data);
    closeCvsPicker();
  });

  // Coupon
  document.getElementById('couponSelect').addEventListener('change', updateSummary);

  // Submit
  document.getElementById('checkoutForm').addEventListener('submit', submit);
}

async function submit(e) {
  e.preventDefault();
  const errEl = document.getElementById('errMsg');
  errEl.style.display = 'none';
  const btn = document.getElementById('submitBtn');
  btn.disabled = true;
  btn.textContent = '送出中…';

  const fail = (msg) => {
    errEl.textContent = msg; errEl.style.display = 'block';
    btn.disabled = false; btn.textContent = '確認下單 · PLACE ORDER';
  };

  // Build payload
  const couponId = document.getElementById('couponSelect').value || undefined;
  const uiShip = document.querySelector('input[name="shippingMethod"]:checked')?.value || 'address';
  const payment = document.querySelector('input[name="paymentMethod"]:checked')?.value || 'ecpay';

  let shippingMethod, cvsBrand, cvsStore, address;
  if (uiShip === 'address') {
    shippingMethod = 'address';
    address = document.getElementById('buyerAddress').value.trim();
    if (!address) return fail('請填寫收件地址');
  } else {
    shippingMethod = 'cvs';
    cvsBrand = uiShip === 'cvs-711' ? '7-11' : '全家';
    cvsStore = document.getElementById('cvsStore').value;
    const storeId = document.getElementById('cvsStoreId').value;
    const storeAddr = document.getElementById('cvsStoreAddress').value;
    const pickedBrand = document.getElementById('cvsBrand').value;
    if (!cvsStore || pickedBrand !== cvsBrand) return fail(`請點擊上方按鈕選擇 ${cvsBrand} 取貨門市`);
    address = `[${cvsBrand} ${cvsStore}${storeId ? ' #' + storeId : ''}] ${storeAddr}`;
  }

  const same = document.getElementById('sameAsPurchaser').checked;
  const purchaserName  = document.getElementById('buyerName').value.trim();
  const purchaserPhone = document.getElementById('buyerPhone').value.trim();
  const purchaserEmail = document.getElementById('buyerEmail').value.trim();
  const rcpName  = same ? purchaserName  : document.getElementById('rcpName').value.trim();
  const rcpPhone = same ? purchaserPhone : document.getElementById('rcpPhone').value.trim();

  if (!purchaserName || !purchaserPhone || !purchaserEmail) return fail('請填寫訂購人姓名、電話、Email');
  if (!rcpName || !rcpPhone) return fail('請填寫收貨人姓名與電話');

  const payload = {
    name: rcpName, phone: rcpPhone, email: purchaserEmail || 'guest@example.com',
    address, shippingMethod, cvsBrand, cvsStore, payment, couponId,
    purchaser: { name: purchaserName, phone: purchaserPhone, email: purchaserEmail },
  };

  try {
    const token = localStorage.getItem('yebuda_token');
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch('/api/checkout', { method: 'POST', headers, body: JSON.stringify(payload) });
    const result = await res.json();
    if (!res.ok) return fail(result.error || '結帳失敗');

    if (result.ecpayUrl) {
      window.location.href = result.ecpayUrl;
      return;
    }
    // Non-ECPay (cvs-cod) → redirect to order page
    if (result.order?.id) {
      location.href = `/order.html?id=${encodeURIComponent(result.order.id)}`;
      return;
    }
    location.href = '/';
  } catch (err) { fail('連線錯誤，請稍後再試'); }
}
