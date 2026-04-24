import { api, TWD, fmtDate, toast } from './admin-app.js';

const STATUS_OPTIONS = ['paid', 'awaiting_payment', 'shipped', 'payment_failed', 'cancelled'];
const STATUS_LABEL = {
  paid: '已付款', awaiting_payment: '待付款',
  shipped: '已出貨', payment_failed: '付款失敗', cancelled: '已取消'
};

let all = [];
let filter = 'all';

async function load() {
  all = await api('/api/admin/orders');
  render();
}
function render() {
  const list = filter === 'all' ? all : all.filter(o => o.status === filter);
  document.getElementById('count').textContent = list.length;
  const host = document.getElementById('orders-list');
  if (!list.length) {
    host.innerHTML = `<div class="card"><p class="muted" style="padding:40px;text-align:center;">沒有符合的訂單。</p></div>`;
    return;
  }
  host.innerHTML = list.map(o => `
    <div class="order-card" data-id="${o.id}">
      <div class="order-head">
        <div class="id-line">
          ${o.id}
          <span class="date">${fmtDate(o.createdAt)}</span>
        </div>
        <div style="display:flex;align-items:center;gap:12px;">
          <span class="tag ${o.status}">${STATUS_LABEL[o.status] || o.status}</span>
          <span class="amount">${TWD(o.total)}</span>
        </div>
      </div>
      <div class="order-body">
        <div>
          <h5>商品明細</h5>
          ${o.items.map(it => `<div class="it">· ${it.name} · ${it.color || ''} / ${it.size} × ${it.qty} · ${TWD(it.subtotal)}</div>`).join('')}
        </div>
        <div>
          <h5>收件資訊</h5>
          <div class="it">${o.customer.name} · ${o.customer.phone}</div>
          <div class="it muted">${o.customer.email || ''}</div>
          <div class="it muted">${o.customer.zip || ''} ${o.customer.city || ''} ${o.customer.address}</div>
        </div>
        <div>
          <h5>付款與金額</h5>
          <div class="it">付款：${describePayment(o.payment)}</div>
          <div class="it muted">小計 ${TWD(o.subtotal)} · 運 ${o.shipping === 0 ? '免' : TWD(o.shipping)}</div>
          ${o.trackingNo ? `<div class="it">貨態：${o.trackingNo}</div>` : ''}
        </div>
      </div>
      <div class="order-actions">
        <label class="muted" style="font-size:11px;letter-spacing:0.15em;">狀態</label>
        <select class="inp-select st-sel">
          ${STATUS_OPTIONS.map(s => `<option value="${s}" ${s === o.status ? 'selected' : ''}>${STATUS_LABEL[s]}</option>`).join('')}
        </select>
        <input class="inp-search track-in" placeholder="物流單號" value="${o.trackingNo || ''}" style="max-width:180px;">
        <button class="btn-xs btn-save">儲存變更</button>
      </div>
    </div>`).join('');

  host.querySelectorAll('.order-card').forEach(card => {
    const id = card.dataset.id;
    card.querySelector('.btn-save').addEventListener('click', async () => {
      const status = card.querySelector('.st-sel').value;
      const trackingNo = card.querySelector('.track-in').value.trim();
      try {
        await api(`/api/admin/orders/${id}`, { method: 'PUT', body: { status, trackingNo } });
        toast('訂單已更新', 'success');
        load();
      } catch (e) { toast(e.message, 'error'); }
    });
  });
}
function describePayment(p) {
  if (!p) return '-';
  if (p.method === 'ecpay') return `綠界 · ${p.paymentType || '-'} · ${p.status === 'paid' ? '已付款' : p.status}`;
  if (p.method === 'card-mock') return `信用卡 (測試) ****${p.last4}`;
  if (p.method === 'transfer') return `ATM 轉帳 · ${p.status === 'paid' ? '已確認' : '待確認'}`;
  return p.method;
}

document.getElementById('filter-status').addEventListener('change', (e) => { filter = e.target.value; render(); });
load();
