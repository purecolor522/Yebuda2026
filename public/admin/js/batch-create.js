import { api, toast } from './admin-app.js';

const CATEGORIES = [
  ['outer', 'OUTER 外套'], ['blouse', 'BLOUSE 襯衫'], ['tee', 'TEE 針織T'],
  ['knit', 'KNIT 毛衣'], ['dress', 'DRESS 洋裝'], ['pants', 'PANTS 褲'], ['set', 'SET 套裝'],
];

const MANUAL_MODE = new URLSearchParams(location.search).get('manual') === '1';

// Adapt page chrome to mode
if (MANUAL_MODE) {
  document.title = '手動批次新增商品 · YEBUDA Admin';
  document.getElementById('pageTitle').textContent = '手動批次新增商品';
  document.getElementById('emptyTitle').textContent = '📷 手動批次新增';
  document.getElementById('emptyDesc').innerHTML =
    '選擇多張商品照片，每張照片建立一件商品。<br>所有欄位由你自己填寫，不會經過 AI。';
  // Hide AI-only buttons
  document.getElementById('retryFailedBtn').style.display = 'none';
  // Show the "set all category" helper (more useful when no AI fills it in)
  document.getElementById('defaultCatBtn').style.display = '';
}

let cards = []; // { id, imageUrl, status, ai, skip }

const grid = document.getElementById('batchGrid');
const empty = document.getElementById('emptyState');
const fileInput = document.getElementById('fileInput');
const saveAllBtn = document.getElementById('saveAllBtn');

document.getElementById('pickBtn').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', async () => {
  const files = [...fileInput.files];
  fileInput.value = '';
  if (!files.length) return;
  await addFiles(files);
});

document.getElementById('defaultPriceBtn').addEventListener('click', () => {
  const v = prompt('將所有「未填或為 0」的商品售價設為（NT$）：', '1280');
  if (!v) return;
  const price = Number(v);
  if (!Number.isFinite(price) || price < 0) { toast('請輸入有效的數字', 'error'); return; }
  cards.forEach(c => {
    if (!c.skip && (!c.priceInput.value || Number(c.priceInput.value) === 0)) {
      c.priceInput.value = price;
    }
  });
  toast(`已設定 ${cards.filter(c => !c.skip).length} 件商品的售價`, 'success');
});

document.getElementById('defaultCatBtn').addEventListener('click', () => {
  const labels = CATEGORIES.map(([v, l], i) => `${i + 1}. ${l}`).join('\n');
  const v = prompt(`輸入分類編號，將所有商品設為該分類：\n${labels}`, '1');
  if (!v) return;
  const idx = Number(v) - 1;
  if (!Number.isInteger(idx) || idx < 0 || idx >= CATEGORIES.length) {
    toast('請輸入 1-' + CATEGORIES.length + ' 之間的編號', 'error');
    return;
  }
  const code = CATEGORIES[idx][0];
  cards.forEach(c => { if (!c.skip && c.categorySelect) c.categorySelect.value = code; });
  toast(`已設定 ${cards.filter(c => !c.skip).length} 件商品的分類為 ${CATEGORIES[idx][1]}`, 'success');
});

saveAllBtn.addEventListener('click', saveAll);
document.getElementById('retryFailedBtn').addEventListener('click', retryFailed);

async function addFiles(files) {
  empty.style.display = 'none';
  toast(`上傳 ${files.length} 張照片中...`, 'info');

  // Upload all to server in one shot
  const fd = new FormData();
  files.forEach(f => fd.append('files', f));
  let urls;
  try {
    const res = await api('/api/admin/upload', { method: 'POST', body: fd });
    urls = res.urls;
  } catch (e) {
    toast('上傳失敗：' + e.message, 'error');
    return;
  }

  // Create a card per uploaded image
  const newCards = urls.map((url, i) => createCard(url, files[i]));
  cards = cards.concat(newCards);
  renderAll();
  updateCounts();

  if (MANUAL_MODE) {
    // Manual mode — no AI; mark each card ready immediately so save button enables
    newCards.forEach(c => {
      c.status = 'ok';
      setCardStatus(c, 'ok', '✓ 已上傳');
    });
    updateCounts();
    saveAllBtn.disabled = false;
    toast(`✓ ${newCards.length} 張照片已上傳，請填寫商品資料`, 'success');
    return;
  }

  // Classify each in parallel — Gemini free tier is ~10-15 RPM, so use concurrency 2
  // with a small inter-request delay to stay under the limit.
  toast(`AI 辨識 ${urls.length} 張照片中...`, 'info');
  await runClassifyQueue(newCards, 2);
  updateCounts();
  saveAllBtn.disabled = false;

  const failed = newCards.filter(c => c.status === 'err').length;
  if (failed > 0) {
    toast(`完成：${newCards.length - failed} 成功 / ${failed} 待重試（按「重試失敗的」）`, 'info');
  } else {
    toast(`✓ ${newCards.length} 張全部辨識完成`, 'success');
  }
}

function createCard(imageUrl, file) {
  return {
    id: 'c' + Math.random().toString(36).slice(2, 9),
    imageUrl,
    file,
    status: 'pending',
    ai: null,
    skip: false,
    nameInput: null, subtitleInput: null, categorySelect: null,
    priceInput: null, descTextarea: null, colorsInput: null, sizesInput: null,
  };
}

async function runClassifyQueue(items, concurrency) {
  const queue = [...items];
  // Gentle inter-request delay (~5s between calls per worker) — keeps us under
  // Gemini free tier's ~10-15 RPM cap even with multiple workers.
  const DELAY_MS = 5000;
  const workers = Array(concurrency).fill(0).map(async (_, workerIdx) => {
    // Stagger worker starts so they don't all fire at the same instant
    if (workerIdx > 0) await new Promise(r => setTimeout(r, workerIdx * 1500));
    while (queue.length) {
      const card = queue.shift();
      await classifyCard(card);
      if (queue.length) await new Promise(r => setTimeout(r, DELAY_MS));
    }
  });
  await Promise.all(workers);
}

async function retryFailed() {
  const failed = cards.filter(c => c.status === 'err' && !c.skip);
  if (!failed.length) { toast('沒有需要重試的項目', 'info'); return; }
  toast(`重試 ${failed.length} 張...`, 'info');
  await runClassifyQueue(failed, 1); // serial retry — extra-conservative
  updateCounts();
  const stillFailed = failed.filter(c => c.status === 'err').length;
  if (stillFailed === 0) toast('✓ 全部重試成功', 'success');
  else toast(`仍有 ${stillFailed} 張失敗，可再次重試`, 'error');
}

async function classifyCard(card) {
  setCardStatus(card, 'loading', '🤖 辨識中...');
  try {
    const res = await api('/api/admin/classify', {
      method: 'POST',
      body: { imageUrl: card.imageUrl },
    });
    card.ai = res;
    card.status = 'ok';
    applyAiToCard(card);
    setCardStatus(card, 'ok', '✓ ' + res.name);
  } catch (e) {
    card.status = 'err';
    setCardStatus(card, 'err', '⚠ ' + (e.message || '辨識失敗'));
  }
}

function setCardStatus(card, level, msg) {
  const el = document.querySelector(`[data-card="${card.id}"] .bc-status`);
  if (!el) return;
  el.className = 'bc-status ' + level;
  el.textContent = msg;
}

function applyAiToCard(card) {
  if (!card.ai) return;
  if (card.nameInput      && !card.nameInput.value)      card.nameInput.value      = card.ai.name || '';
  if (card.subtitleInput  && !card.subtitleInput.value)  card.subtitleInput.value  = card.ai.subtitle || '';
  if (card.descTextarea   && !card.descTextarea.value)   card.descTextarea.value   = card.ai.description || '';
  if (card.colorsInput    && !card.colorsInput.value)    card.colorsInput.value    = (card.ai.suggestedColors || []).join(', ');
  if (card.sizesInput     && !card.sizesInput.value)     card.sizesInput.value     = (card.ai.suggestedSizes || []).join(', ');
  if (card.categorySelect && card.ai.category && CATEGORIES.find(c => c[0] === card.ai.category)) {
    card.categorySelect.value = card.ai.category;
  }
}

function renderAll() {
  grid.innerHTML = '';
  cards.forEach(card => grid.appendChild(buildCardEl(card)));
}

function buildCardEl(card) {
  const div = document.createElement('div');
  div.className = 'batch-card' + (card.skip ? ' skip' : '');
  div.dataset.card = card.id;
  const initStatus = MANUAL_MODE ? '✓ 已上傳' : '⏳ 等待辨識';
  const initStatusClass = MANUAL_MODE ? 'ok' : 'loading';
  const namePh = MANUAL_MODE ? '請輸入商品名稱' : '待 AI 填入...';
  div.innerHTML = `
    <div class="bc-img">
      <img src="${card.imageUrl}" alt="">
      <span class="bc-status ${initStatusClass}">${initStatus}</span>
      <button class="bc-skip" title="跳過這項">${card.skip ? '↻' : '✕'}</button>
    </div>
    <div class="bc-body">
      <div><label>商品名稱 *</label><input class="i-name" placeholder="${namePh}"></div>
      <div><label>英文副標</label><input class="i-subtitle" placeholder="SUBTITLE"></div>
      <div class="bc-row">
        <div><label>分類 *</label>
          <select class="i-category">
            ${CATEGORIES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
          </select>
        </div>
        <div><label>售價 NT$ *</label><input class="i-price" type="number" min="0" placeholder="必填"></div>
      </div>
      <div><label>商品介紹</label><textarea class="i-desc" rows="3"></textarea></div>
      <div class="bc-row">
        <div><label>顏色</label><input class="i-colors" placeholder="駝, 黑"></div>
        <div><label>尺寸</label><input class="i-sizes" placeholder="S, M, L"></div>
      </div>
    </div>`;

  card.nameInput      = div.querySelector('.i-name');
  card.subtitleInput  = div.querySelector('.i-subtitle');
  card.categorySelect = div.querySelector('.i-category');
  card.priceInput     = div.querySelector('.i-price');
  card.descTextarea   = div.querySelector('.i-desc');
  card.colorsInput    = div.querySelector('.i-colors');
  card.sizesInput     = div.querySelector('.i-sizes');

  // If AI already finished before render
  applyAiToCard(card);
  if (card.status === 'ok') setCardStatus(card, 'ok', '✓ ' + (card.ai?.name || ''));
  else if (card.status === 'err') setCardStatus(card, 'err', '⚠ 辨識失敗');

  div.querySelector('.bc-skip').addEventListener('click', () => {
    card.skip = !card.skip;
    div.classList.toggle('skip', card.skip);
    div.querySelector('.bc-skip').textContent = card.skip ? '↻' : '✕';
    div.querySelector('.bc-skip').title = card.skip ? '恢復' : '跳過這項';
    updateCounts();
  });

  // Track edits to refresh keep-count display (price ↔ ready)
  ['input', 'change'].forEach(ev => {
    [card.nameInput, card.priceInput, card.categorySelect].forEach(el => el.addEventListener(ev, updateCounts));
  });

  return div;
}

function updateCounts() {
  document.getElementById('totalCount').textContent = cards.length;
  const keep = cards.filter(c => !c.skip).length;
  document.getElementById('keepCount').textContent = keep;
  saveAllBtn.disabled = keep === 0 || cards.some(c => c.status === 'pending' || c.status === 'loading');
}

async function saveAll() {
  const toSave = cards.filter(c => !c.skip);
  if (!toSave.length) { toast('沒有可儲存的商品', 'error'); return; }

  // Validate
  for (const c of toSave) {
    if (!c.nameInput.value.trim()) { toast(`請填寫商品名稱（圖片：${c.imageUrl.split('/').pop()}）`, 'error'); return; }
    if (!c.priceInput.value || Number(c.priceInput.value) <= 0) { toast(`請填寫售價（${c.nameInput.value}）`, 'error'); return; }
  }

  saveAllBtn.disabled = true;
  saveAllBtn.textContent = '儲存中 0 / ' + toSave.length;

  const asDraft = !!document.getElementById('draftMode')?.checked;

  let ok = 0, fail = 0;
  for (const c of toSave) {
    const payload = {
      name: c.nameInput.value.trim(),
      subtitle: c.subtitleInput.value.trim(),
      category: c.categorySelect.value,
      description: c.descTextarea.value.trim(),
      price: Number(c.priceInput.value),
      stock: 0,
      color: (c.colorsInput.value.split(',')[0] || '').trim(),
      colors: c.colorsInput.value.split(',').map(s => s.trim()).filter(Boolean),
      sizes:  c.sizesInput.value.split(',').map(s => s.trim()).filter(Boolean),
      image:  c.imageUrl,
      hidden: asDraft,   // 勾「先存為草稿」→ 下架草稿，盤點後到待上架頁一鍵上架
    };
    try {
      await api('/api/admin/products', { method: 'POST', body: payload });
      ok++;
    } catch {
      fail++;
    }
    saveAllBtn.textContent = `儲存中 ${ok + fail} / ${toSave.length}`;
  }

  saveAllBtn.textContent = '儲存全部商品';
  saveAllBtn.disabled = false;

  if (fail === 0) {
    toast(`✨ 成功建立 ${ok} 件商品！`, 'success');
    setTimeout(() => location.href = '/admin/products.html', 1200);
  } else {
    toast(`完成：成功 ${ok}，失敗 ${fail}`, fail ? 'error' : 'success');
  }
}

// Initial state
(async () => {
  if (!MANUAL_MODE) {
    try {
      const s = await api('/api/admin/ai-status');
      if (!s.available) {
        document.getElementById('aiStatusBar').textContent =
          '⚠ 尚未設定 GEMINI_API_KEY — 仍可上傳照片，但需手動填寫所有欄位。';
      }
    } catch {}
  }
  updateCounts();
})();
