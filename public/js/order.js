import { api, renderHeader, renderFooter, TWD, mediaUrl } from './app.js';

renderHeader();
renderFooter();

const id = new URLSearchParams(location.search).get('id');
const root = document.getElementById('confirm-root');

if (!id) {
  root.innerHTML = '<p>缺少訂單編號。<a href="/">返回首頁</a></p>';
  throw new Error('no id');
}

(async () => {
  try {
    const o = await api(`/api/orders/${id}`);
    const paidMsg = o.payment.method === 'card'
      ? `已收款 · 信用卡尾號 ****${o.payment.last4}`
      : `等待匯款 · 請於 24 小時內轉帳`;
    root.innerHTML = `
      <div class="tick">✓</div>
      <h1>訂單已成立</h1>
      <div class="order-id">ORDER NO · ${o.id}</div>
      <p style="color:var(--ink-soft);max-width:520px;margin:0 auto 24px;">
        感謝您的訂購，YEBUDA 團隊會盡快為您安排出貨。訂單明細已寄送至 ${o.customer.email}。
      </p>
      <div style="display:inline-block;padding:12px 24px;background:var(--bg-soft);font-size:13px;letter-spacing:0.15em;">
        ${paidMsg}
      </div>

      <div class="order-items">
        ${o.items.map(it => `
          <div class="ck-line">
            <div></div>
            <div>
              <div class="nm">${it.name}</div>
              <div class="op">${it.color} / ${it.size} × ${it.qty}</div>
            </div>
            <div>${TWD(it.subtotal)}</div>
          </div>`).join('')}
        <div class="ck-line" style="border-top:2px solid var(--line);margin-top:12px;">
          <div></div><div><b>商品小計</b></div><div>${TWD(o.subtotal)}</div>
        </div>
        <div class="ck-line">
          <div></div><div><b>運費</b></div><div>${o.shipping === 0 ? '免運' : TWD(o.shipping)}</div>
        </div>
        <div class="ck-line" style="font-size:18px;">
          <div></div><div><b>應付合計</b></div><div><b>${TWD(o.total)}</b></div>
        </div>
      </div>

      <div style="margin-top:32px;text-align:left;background:var(--bg-soft);padding:20px;">
        <h4 style="font-size:12px;letter-spacing:0.3em;text-transform:uppercase;margin-bottom:10px;">收件資訊</h4>
        <div style="font-size:13px;line-height:1.9;color:var(--ink-soft);">
          ${o.customer.name} · ${o.customer.phone}<br>
          ${o.customer.zip || ''} ${o.customer.city || ''} ${o.customer.address}
        </div>
      </div>

      <div style="margin-top:40px;display:flex;gap:10px;justify-content:center;">
        <a href="/" class="btn-ghost" style="padding:14px 28px;border:1px solid var(--ink);">返回首頁</a>
        <a href="/shop.html" class="btn-primary" style="display:inline-block;padding:14px 28px;">繼續選購</a>
      </div>`;
  } catch (e) {
    root.innerHTML = `<h1>找不到訂單</h1><p><a href="/">返回首頁</a></p>`;
  }
})();
