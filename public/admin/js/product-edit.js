import { api, toast } from './admin-app.js';

const id = new URLSearchParams(location.search).get('id');
const form = document.getElementById('f');
const gallery = document.getElementById('gallery');
const fileInput = document.getElementById('file-input');

let images = []; // array of url strings, first = primary

if (id) {
  document.getElementById('title').textContent = '編輯商品';
  document.getElementById('bcid').textContent = '編輯 ' + id;
  (async () => {
    try {
      const all = await api('/api/admin/products');
      const p = all.find(x => x.id === id);
      if (!p) { toast('商品不存在', 'error'); return; }
      form.name.value = p.name;
      form.subtitle.value = p.subtitle || '';
      form.category.value = p.category;
      form.description.value = p.description || '';
      form.price.value = p.price;
      form.originalPrice.value = p.originalPrice ?? '';
      form.badge.value = p.badge || '';
      form.hidden.checked = !!p.hidden;
      form.color.value = p.color || '';
      form.colors.value = (p.colors || []).join(', ');
      form.sizes.value = (p.sizes || ['FREE']).join(', ');
      images = [p.image, ...(p.extraImages || [])].filter(Boolean);
      renderGallery();
    } catch (e) { toast(e.message, 'error'); }
  })();
}

document.getElementById('pick-btn').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', async () => {
  if (!fileInput.files.length) return;
  const fd = new FormData();
  [...fileInput.files].forEach(f => fd.append('files', f));
  const st = document.getElementById('upload-status');
  st.textContent = `上傳中 (${fileInput.files.length} 張)...`;
  try {
    const res = await api('/api/admin/upload', { method: 'POST', body: fd });
    images = images.concat(res.urls);
    st.textContent = `✓ 已上傳 ${res.urls.length} 張`;
    toast('照片已上傳', 'success');
    renderGallery();
  } catch (e) {
    st.textContent = '';
    toast(e.message, 'error');
  }
  fileInput.value = '';
});

// ===== AI 一鍵辨識上傳 =====
const aiInput = document.createElement('input');
aiInput.type = 'file';
aiInput.accept = 'image/*';
aiInput.multiple = true;
aiInput.style.display = 'none';
document.body.appendChild(aiInput);

document.getElementById('ai-pick-btn').addEventListener('click', () => aiInput.click());

aiInput.addEventListener('change', async () => {
  if (!aiInput.files.length) return;
  const files = [...aiInput.files];
  const aiSt = document.getElementById('ai-status');
  const upSt = document.getElementById('upload-status');

  // Step 1: upload all files first (so they're stored on server)
  upSt.textContent = `上傳中 (${files.length} 張)...`;
  let uploadedUrls = [];
  try {
    const fd = new FormData();
    files.forEach(f => fd.append('files', f));
    const res = await api('/api/admin/upload', { method: 'POST', body: fd });
    uploadedUrls = res.urls;
    images = images.concat(uploadedUrls);
    upSt.textContent = `✓ 已上傳 ${uploadedUrls.length} 張`;
    renderGallery();
  } catch (e) {
    upSt.textContent = '';
    toast('上傳失敗：' + e.message, 'error');
    aiInput.value = '';
    return;
  }

  // Step 2: classify the FIRST image and auto-fill the form
  aiSt.textContent = '🤖 AI 辨識中（約 3 秒）...';
  try {
    const fd = new FormData();
    fd.append('image', files[0]);
    const r = await api('/api/admin/classify', { method: 'POST', body: fd });
    applyAiResult(r);
    aiSt.textContent = `✨ 已自動填入：${r.name}`;
    toast('AI 辨識完成 ✨', 'success');
  } catch (e) {
    aiSt.textContent = '⚠ AI 辨識失敗：' + e.message;
    toast(e.message, 'error');
  }
  aiInput.value = '';
});

function applyAiResult(r) {
  // Only fill empty fields — don't overwrite user-edited content
  const fillIfEmpty = (field, value) => {
    if (!field) return;
    if (!field.value || field.value.trim() === '') field.value = value;
  };
  fillIfEmpty(form.name, r.name);
  fillIfEmpty(form.subtitle, r.subtitle);
  fillIfEmpty(form.description, r.description);
  if (r.category && form.category) {
    const opt = [...form.category.options].find(o => o.value === r.category);
    if (opt && (!form.category.value || form.category.value === 'outer')) {
      form.category.value = r.category;
    }
  }
  if (r.suggestedColors?.length) {
    fillIfEmpty(form.color, r.suggestedColors[0]);
    fillIfEmpty(form.colors, r.suggestedColors.join(', '));
  }
  if (r.suggestedSizes?.length) {
    fillIfEmpty(form.sizes, r.suggestedSizes.join(', '));
  }
}

// On page load, hide the AI button if the server says no API key is configured
(async () => {
  try {
    const s = await api('/api/admin/ai-status');
    if (!s.available) {
      const btn = document.getElementById('ai-pick-btn');
      btn.title = '尚未設定 GEMINI_API_KEY';
      btn.style.opacity = '0.5';
      document.getElementById('ai-status').textContent = '💡 想啟用 AI 辨識？請在 .env 加上 GEMINI_API_KEY（aistudio.google.com/apikey 免費取得）';
    }
  } catch {}
})();

function renderGallery() {
  if (!images.length) { gallery.innerHTML = '<p class="muted" style="grid-column:1/-1;text-align:center;padding:20px;">尚未上傳照片。</p>'; return; }
  gallery.innerHTML = images.map((url, i) => `
    <div class="thumb ${i === 0 ? 'primary' : ''}" data-i="${i}">
      <img src="${url}" alt="">
      ${i === 0 ? `<div class="star">MAIN 主圖</div>` : ''}
      <div class="x" title="刪除">×</div>
    </div>`).join('');
  gallery.querySelectorAll('.thumb').forEach(el => {
    const i = Number(el.dataset.i);
    el.addEventListener('click', (e) => {
      if (e.target.classList.contains('x')) {
        images.splice(i, 1);
        renderGallery();
      } else if (i !== 0) {
        // set as primary
        images = [images[i], ...images.filter((_, j) => j !== i)];
        renderGallery();
      }
    });
  });
}

document.getElementById('save-btn').addEventListener('click', async (e) => {
  e.preventDefault();
  const err = document.getElementById('err');
  err.textContent = '';
  if (!images.length) { err.textContent = '請至少上傳一張商品照片'; return; }
  const data = Object.fromEntries(new FormData(form));
  const payload = {
    name: data.name,
    subtitle: data.subtitle,
    category: data.category,
    description: data.description,
    price: Number(data.price),
    originalPrice: data.originalPrice ? Number(data.originalPrice) : null,
    badge: data.badge || null,
    hidden: !!data.hidden,
    color: data.color,
    colors: data.colors.split(',').map(s => s.trim()).filter(Boolean),
    sizes: data.sizes.split(',').map(s => s.trim()).filter(Boolean),
    image: images[0],
    extraImages: images.slice(1)
  };
  if (!payload.name || !payload.price || !payload.category) {
    err.textContent = '必填：名稱 / 分類 / 售價';
    return;
  }

  const btn = document.getElementById('save-btn');
  btn.disabled = true; btn.textContent = '儲存中...';
  try {
    if (id) await api(`/api/admin/products/${id}`, { method: 'PUT', body: payload });
    else    await api('/api/admin/products', { method: 'POST', body: payload });
    toast('已儲存 · Redirecting...', 'success');
    setTimeout(() => location.href = '/admin/products.html', 600);
  } catch (e) {
    err.textContent = e.message;
    btn.disabled = false; btn.textContent = '儲存商品';
  }
});
