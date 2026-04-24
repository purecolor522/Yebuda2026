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
      form.stock.value = p.stock;
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
    stock: Number(data.stock) || 0,
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
