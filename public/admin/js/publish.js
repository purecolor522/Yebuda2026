import { api, toast, TWD } from './admin-app.js';

/* ─────────────────────────────────────────────────────────────
   待上架批次上架
   - 來源：Excel 進貨匯入建立的「待上架草稿」(hidden && subtitle==='EXCEL IMPORTED')
   - 你只做兩件事：勾選要上架的、（需要時）逐件換圖
   - 一鍵 AI：命名／副標／分類／文案，售價自動 = 落地成本 × MARKUP，並發布上架
   - 顏色與庫存沿用進貨資料，不被 AI 覆寫（保留變體庫存）
   ───────────────────────────────────────────────────────────── */

// 售價公式（要調整就改這裡）
const MARKUP   = 1.5;   // 售價 = 落地成本 × MARKUP
const ROUND_TO = 10;    // 售價四捨五入到的位數（10 = 個位歸零，較好看）
const DRAFT_SUBTITLE = 'EXCEL IMPORTED';
const PLACEHOLDER = '/images/placeholder.jpg';

function suggestPrice(cost) {
  const c = Number(cost) || 0;
  if (c <= 0) return 0;
  return Math.round(c * MARKUP / ROUND_TO) * ROUND_TO;
}

// Excel 進貨草稿：需要 AI 命名 + 自動定價；其餘（舊庫存批次草稿）已命名，只需一鍵上架
function isExcelDraft(p) { return p && p.subtitle === DRAFT_SUBTITLE; }

function variantSummary(p) {
  const vs = Array.isArray(p.variants) ? p.variants : [];
  if (vs.length) {
    return {
      colors: [...new Set(vs.map(v => v.color).filter(Boolean))],
      stock: vs.reduce((s, v) => s + (Number(v.qty) || 0), 0),
    };
  }
  return { colors: Array.isArray(p.colors) ? p.colors : [], stock: Number(p.stock) || 0 };
}

const grid = document.getElementById('grid');
const emptyState = document.getElementById('emptyState');
const publishBtn = document.getElementById('publishBtn');
document.getElementById('markupLabel').textContent = MARKUP;

let cards = []; // { product, el, checkbox, status }

document.getElementById('refreshBtn').addEventListener('click', load);
document.getElementById('selectAllBtn').addEventListener('click', toggleSelectAll);
publishBtn.addEventListener('click', publishAll);

load();

async function load() {
  publishBtn.disabled = true;
  let all;
  try {
    all = await api('/api/admin/products');
  } catch (e) {
    toast(e.message || '載入失敗', 'error');
    return;
  }
  // 待上架 = 所有下架草稿（Excel 進貨的待命名草稿 + 舊庫存先存的草稿）
  const drafts = all.filter(p => p.hidden);
  cards = drafts.map(p => ({ product: p, el: null, checkbox: null, status: 'idle', isExcel: isExcelDraft(p) }));
  render();
}

function render() {
  grid.innerHTML = '';
  emptyState.style.display = cards.length ? 'none' : 'block';
  cards.forEach(card => grid.appendChild(buildCard(card)));
  updateCounts();
}

function buildCard(card) {
  const p = card.product;
  const { colors, stock } = variantSummary(p);
  const isPlaceholder = !p.image || p.image === PLACEHOLDER;

  // Excel 草稿：需圖片才能 AI 命名，badge 顯示「需先換圖」；舊庫存草稿已命名，缺圖也可上架
  const blockPublish = card.isExcel && isPlaceholder;
  const badge = blockPublish ? '⚠ 需先換圖' : (card.isExcel ? '新款草稿' : '舊庫存草稿');

  // 售價列：Excel 用建議售價（成本×倍率）；舊庫存用已設定的售價
  const sugg = suggestPrice(p.cost);
  const priceHtml = card.isExcel
    ? `落地成本：${TWD(Number(p.cost) || 0)}<br><span class="pc-price">建議售價：<strong>${sugg > 0 ? TWD(sugg) : '— 無成本'}</strong></span>`
    : `售價：<span class="pc-price"><strong>${TWD(Number(p.price) || 0)}</strong></span>　<span class="muted">（AI 不重新命名）</span>`;

  const div = document.createElement('div');
  div.className = 'pub-card';
  div.dataset.id = p.id;
  div.innerHTML = `
    <div class="pc-img">
      <img src="${p.image || PLACEHOLDER}" alt="">
      <span class="pc-status ${blockPublish ? 'err' : ''}">${badge}</span>
      <label class="pc-check"><input type="checkbox" ${blockPublish ? '' : 'checked'}></label>
    </div>
    <div class="pc-body">
      <div class="pc-name">${escapeHtml(p.name || '待命名商品')} <span class="muted" style="font-weight:400;font-size:11px;">${p.id}</span></div>
      <div class="pc-meta">
        顏色：${colors.length ? colors.map(escapeHtml).join('、') : '—'}　庫存：${stock}<br>
        ${priceHtml}
      </div>
      <div class="pc-replace">
        <input type="file" accept="image/*" hidden>
        <button type="button" class="btn-ghost pc-replace-btn">📷 更換圖片</button>
      </div>
    </div>`;

  card.el = div;
  card.checkbox = div.querySelector('.pc-check input');
  card.checkbox.addEventListener('change', updateCounts);

  // 逐件換圖：上傳綁定這件商品 ID，所見即所得，不會對應錯
  const fileInput = div.querySelector('input[type=file]');
  const replaceBtn = div.querySelector('.pc-replace-btn');
  replaceBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => replaceImage(card, fileInput));

  return div;
}

async function replaceImage(card, fileInput) {
  const file = fileInput.files[0];
  fileInput.value = '';
  if (!file) return;
  const p = card.product;
  setStatus(card, 'loading', '上傳中…');
  try {
    const fd = new FormData();
    fd.append('files', file);
    const up = await api('/api/admin/upload', { method: 'POST', body: fd });
    const newUrl = up.urls && up.urls[0];
    if (!newUrl) throw new Error('上傳未取得圖片網址');
    await api(`/api/admin/products/${encodeURIComponent(p.id)}`, { method: 'PUT', body: { image: newUrl } });
    p.image = newUrl;
    const img = card.el.querySelector('.pc-img img');
    img.src = newUrl + (newUrl.includes('?') ? '&' : '?') + 't=' + Date.now(); // 破快取
    setStatus(card, 'ok', '✓ 已換圖');
    if (!card.checkbox.checked) { card.checkbox.checked = true; updateCounts(); }
    toast(`已更換「${p.name || p.id}」的圖片`, 'success');
  } catch (e) {
    setStatus(card, 'err', '⚠ 換圖失敗');
    toast(e.message || '換圖失敗', 'error');
  }
}

function checkedCards() {
  return cards.filter(c => c.checkbox && c.checkbox.checked && c.status !== 'done');
}

function updateCounts() {
  document.getElementById('totalCount').textContent = cards.filter(c => c.status !== 'done').length;
  const keep = checkedCards().length;
  document.getElementById('keepCount').textContent = keep;
  publishBtn.disabled = keep === 0;
}

function toggleSelectAll() {
  const target = checkedCards().length < cards.filter(c => c.status !== 'done').length;
  cards.forEach(c => { if (c.checkbox && c.status !== 'done') c.checkbox.checked = target; });
  updateCounts();
}

async function publishAll() {
  const all = checkedCards();
  if (!all.length) return;

  // 只有 Excel 草稿需要圖片(供 AI)與成本(供定價)；舊庫存草稿已命名定價，一律可上架
  const bad = all.filter(c => c.isExcel && (!c.product.image || c.product.image === PLACEHOLDER || suggestPrice(c.product.cost) <= 0));
  bad.forEach(c => setStatus(c, 'err', !c.product.image || c.product.image === PLACEHOLDER ? '⚠ 需先換圖' : '⚠ 無成本，跳過'));
  const list = all.filter(c => !bad.includes(c));
  if (!list.length) {
    toast('勾選的商品都「需先換圖」或「無成本」，請先處理', 'error');
    return;
  }
  if (bad.length) toast(`跳過 ${bad.length} 件（需換圖/無成本），其餘 ${list.length} 件開始上架`, 'info');

  publishBtn.disabled = true;
  const total = list.length;
  let done = 0, fail = 0;
  publishBtn.textContent = `上架中 0 / ${total}`;

  await runQueue(list, 2, async (card) => {
    const ok = await publishOne(card);
    if (ok) done++; else fail++;
    publishBtn.textContent = `上架中 ${done + fail} / ${total}`;
  });

  publishBtn.textContent = '🤖 批次 AI 上架';
  // 移除已上架的卡片
  cards = cards.filter(c => c.status !== 'done');
  render();

  if (fail === 0) toast(`✨ 成功上架 ${done} 件！`, 'success');
  else toast(`完成：${done} 件上架成功，${fail} 件失敗（可重新整理後再試）`, 'info');
}

async function publishOne(card) {
  const p = card.product;
  try {
    let body;
    if (card.isExcel) {
      // Excel 草稿：AI 命名/分類/文案 + 售價=落地成本×倍率
      setStatus(card, 'loading', '🤖 AI 命名中…');
      const ai = await api('/api/admin/classify', { method: 'POST', body: { imageUrl: p.image } });
      // 不送 colors/sizes → 沿用進貨建立的顏色與變體庫存，AI 顏色僅供參考不覆寫
      body = {
        name: ai.name || p.name,
        subtitle: ai.subtitle || '',
        category: ai.category || 'outer',
        description: ai.description || '',
        price: suggestPrice(p.cost),
        hidden: false,
      };
    } else {
      // 舊庫存草稿：已命名定價，只需上架（不動名稱/售價/顏色/庫存）
      setStatus(card, 'loading', '上架中…');
      body = { hidden: false };
    }
    await api(`/api/admin/products/${encodeURIComponent(p.id)}`, { method: 'PUT', body });
    card.status = 'done';
    setStatus(card, 'ok', '✓ 已上架');
    card.el.classList.add('done');
    if (card.checkbox) card.checkbox.checked = false;
    return true;
  } catch (e) {
    setStatus(card, 'err', '⚠ ' + (e.message || '上架失敗'));
    return false;
  }
}

// 併發佇列 + 節流（Gemini 免費額度約 10-15 RPM）
async function runQueue(items, concurrency, worker) {
  const queue = [...items];
  const DELAY_MS = 5000;
  const runners = Array(concurrency).fill(0).map(async (_, i) => {
    if (i > 0) await sleep(i * 1500);
    while (queue.length) {
      const item = queue.shift();
      await worker(item);
      if (queue.length) await sleep(DELAY_MS);
    }
  });
  await Promise.all(runners);
}

// 只更新卡片上的狀態徽章；card.status 由呼叫端（publishOne）自行管理
function setStatus(card, level, msg) {
  const el = card.el && card.el.querySelector('.pc-status');
  if (!el) return;
  const cls = level === 'loading' ? 'loading' : level === 'ok' ? 'ok' : level === 'err' ? 'err' : '';
  el.className = 'pc-status ' + cls;
  el.textContent = msg;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}
