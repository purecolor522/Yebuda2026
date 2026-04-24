import { api, TWD, fmtDate } from './admin-app.js';

const CATE_LABEL = {
  outer: 'OUTER', blouse: 'BLOUSE', tee: 'TEE', knit: 'KNIT',
  dress: 'DRESS', pants: 'PANTS', set: 'SET'
};
const STATUS_LABEL = {
  paid: '已付款', awaiting_payment: '待付款',
  shipped: '已出貨', payment_failed: '付款失敗', cancelled: '已取消'
};

(async () => {
  const s = await api('/api/admin/stats');

  // Stat cards
  document.getElementById('stats').innerHTML = `
    <div class="stat green">
      <div class="lbl">Total Revenue 總營收</div>
      <div class="num">${TWD(s.totalRevenue)}</div>
      <div class="sub">累計已付款訂單</div>
    </div>
    <div class="stat">
      <div class="lbl">This Month 本月</div>
      <div class="num">${TWD(s.month)}</div>
      <div class="sub">近 30 日</div>
    </div>
    <div class="stat blue">
      <div class="lbl">Orders 訂單總數</div>
      <div class="num">${s.orderCount}</div>
      <div class="sub">已付款 ${s.paidCount} · 待付款 ${s.pendingCount}</div>
    </div>
    <div class="stat red">
      <div class="lbl">Avg Order Value 客單價</div>
      <div class="num">${TWD(s.avgOrderValue)}</div>
      <div class="sub">平均每筆金額</div>
    </div>`;

  document.getElementById('chart-total').textContent =
    `30 日合計 ${TWD(s.days.reduce((x, d) => x + d.revenue, 0))} · ${s.days.reduce((x, d) => x + d.orders, 0)} 筆`;

  drawChart(s.days);
  window.addEventListener('resize', () => drawChart(s.days));

  // Best sellers
  const bs = document.getElementById('best-sellers');
  if (!s.bestSellers.length) {
    bs.innerHTML = `<p class="muted" style="padding:20px;text-align:center;">尚無已付款訂單</p>`;
  } else {
    bs.innerHTML = s.bestSellers.map(b => `
      <div class="best-row">
        <img src="${b.image}" alt="">
        <div>
          <div>${b.name}</div>
          <div class="rev">${TWD(b.revenue)}</div>
        </div>
        <div class="qty">${b.qty} 件</div>
      </div>`).join('');
  }

  // Recent orders
  const ro = document.getElementById('recent-orders');
  if (!s.recentOrders.length) {
    ro.innerHTML = `<p class="muted" style="padding:20px;text-align:center;">尚無訂單</p>`;
  } else {
    ro.innerHTML = s.recentOrders.map(o => `
      <div class="recent-row">
        <div>
          <span class="rid">${o.id}</span>
          <span style="margin-left:8px;">${o.customer.name}</span>
          <br>
          <span class="muted" style="font-size:11px;">${fmtDate(o.createdAt)}</span>
        </div>
        <span class="tag ${o.status}">${STATUS_LABEL[o.status] || o.status}</span>
        <span class="amt">${TWD(o.total)}</span>
      </div>`).join('');
  }
})();

function drawChart(days) {
  const canvas = document.getElementById('revenue-chart');
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const wrap = canvas.parentElement;
  const W = wrap.clientWidth;
  const H = 220;
  canvas.width = W * dpr; canvas.height = H * dpr;
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  const PAD_L = 50, PAD_R = 10, PAD_T = 20, PAD_B = 28;
  const cw = W - PAD_L - PAD_R;
  const ch = H - PAD_T - PAD_B;
  const max = Math.max(1, ...days.map(d => d.revenue));
  const niceMax = niceNumber(max * 1.15);

  // grid
  ctx.strokeStyle = '#e6ddd0';
  ctx.fillStyle = '#76705f';
  ctx.font = '11px Inter, sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let i = 0; i <= 4; i++) {
    const y = PAD_T + (ch / 4) * i;
    const v = niceMax * (1 - i / 4);
    ctx.beginPath(); ctx.moveTo(PAD_L, y); ctx.lineTo(W - PAD_R, y); ctx.stroke();
    ctx.fillText(v >= 1000 ? (v / 1000).toFixed(0) + 'k' : String(Math.round(v)), PAD_L - 8, y);
  }

  // area + line
  const stepX = cw / (days.length - 1 || 1);
  const xy = days.map((d, i) => [PAD_L + stepX * i, PAD_T + ch * (1 - d.revenue / niceMax)]);

  // area
  const grad = ctx.createLinearGradient(0, PAD_T, 0, PAD_T + ch);
  grad.addColorStop(0, 'rgba(184,152,106,0.35)');
  grad.addColorStop(1, 'rgba(184,152,106,0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(xy[0][0], PAD_T + ch);
  xy.forEach(([x, y]) => ctx.lineTo(x, y));
  ctx.lineTo(xy[xy.length - 1][0], PAD_T + ch);
  ctx.closePath(); ctx.fill();

  // line
  ctx.strokeStyle = '#8a6e4a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  xy.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
  ctx.stroke();

  // dots
  ctx.fillStyle = '#8a6e4a';
  xy.forEach(([x, y], i) => {
    if (days[i].revenue > 0) { ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.fill(); }
  });

  // x labels (every 5 days)
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#76705f';
  days.forEach((d, i) => {
    if (i % 5 === 0 || i === days.length - 1) {
      ctx.fillText(d.date, PAD_L + stepX * i, PAD_T + ch + 8);
    }
  });
}

function niceNumber(v) {
  if (v <= 0) return 100;
  const exp = Math.floor(Math.log10(v));
  const f = v / Math.pow(10, exp);
  const nice = f < 1.5 ? 1.5 : f < 2 ? 2 : f < 3 ? 3 : f < 5 ? 5 : 10;
  return nice * Math.pow(10, exp);
}
