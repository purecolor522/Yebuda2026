import { api, TWD, toast } from './admin-app.js';

let all = [];
let filterCat = 'all';
let searchTerm = '';

const CAT_LABEL = {
  outer: 'OUTER', blouse: 'BLOUSE', tee: 'TEE', knit: 'KNIT',
  dress: 'DRESS', pants: 'PANTS', set: 'SET'
};

async function load() {
  all = await api('/api/admin/products');
  render();
}
function render() {
  let list = all;
  if (filterCat !== 'all') list = list.filter(p => p.category === filterCat);
  if (searchTerm) {
    const q = searchTerm.toLowerCase();
    list = list.filter(p => p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q));
  }
  document.getElementById('count').textContent = list.length;
  const tbody = document.getElementById('tbody');
  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--ink-soft);">沒有符合的商品。<a href="/admin/product-edit.html">新增一筆</a></td></tr>`;
    return;
  }
  tbody.innerHTML = list.map(p => `
    <tr data-id="${p.id}">
      <td><img class="thumb" src="${p.image}" alt=""></td>
      <td>
        <div class="name">${p.name}</div>
        <div class="sku">${p.id} · ${p.subtitle || ''}</div>
      </td>
      <td>${CAT_LABEL[p.category] || p.category}</td>
      <td>
        <strong>${TWD(p.price)}</strong>
        ${p.originalPrice ? `<br><span style="text-decoration:line-through;color:var(--ink-soft);font-size:11px;">${TWD(p.originalPrice)}</span>` : ''}
      </td>
      <td class="${p.stock < 5 ? 'stock-low' : ''}">${p.stock}</td>
      <td>${p.badge ? `<span class="tag ${p.badge}">${p.badge}</span>` : '-'}</td>
      <td>${p.hidden ? `<span class="tag hidden">下架</span>` : `<span class="tag paid">上架中</span>`}</td>
      <td>
        <a href="/admin/product-edit.html?id=${p.id}" class="btn-xs">編輯</a>
        <button class="btn-xs btn-del">刪除</button>
      </td>
    </tr>`).join('');

  tbody.querySelectorAll('.btn-del').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.closest('tr').dataset.id;
      const p = all.find(x => x.id === id);
      if (!confirm(`確定要刪除「${p.name}」? 此動作無法復原。`)) return;
      try {
        await api(`/api/admin/products/${id}`, { method: 'DELETE' });
        toast('已刪除', 'success');
        load();
      } catch (e) { toast(e.message, 'error'); }
    });
  });
}

document.getElementById('search').addEventListener('input', (e) => { searchTerm = e.target.value; render(); });
document.getElementById('filter-cat').addEventListener('change', (e) => { filterCat = e.target.value; render(); });

load();
