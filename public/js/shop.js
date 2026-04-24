import { api, renderHeader, renderFooter, productCard, CATEGORIES } from './app.js';

const params = new URLSearchParams(location.search);
let currentCat = params.get('cat') || 'all';
let currentSort = 'best';

renderHeader(currentCat);
renderFooter();

const chipsEl = document.getElementById('chips');
const titleEl = document.getElementById('shop-title');
const crumbsEl = document.getElementById('crumbs');
const countEl = document.getElementById('count-text');
const grid = document.getElementById('grid');
const sortEl = document.getElementById('sort');

function renderChips() {
  chipsEl.innerHTML = CATEGORIES.map(c =>
    `<button class="chip ${c.key === currentCat ? 'active' : ''}" data-cat="${c.key}">${c.label} · ${c.zh}</button>`
  ).join('');
}
function updateTitle() {
  const c = CATEGORIES.find(x => x.key === currentCat);
  titleEl.textContent = c ? c.zh : 'All Items';
  crumbsEl.textContent = `HOME / SHOP / ${c ? c.label : 'ALL'}`;
}

async function load() {
  const list = await api(`/api/products?category=${currentCat}&sort=${currentSort}`);
  countEl.textContent = `共 ${list.length} 件商品`;
  grid.innerHTML = list.length
    ? list.map(productCard).join('')
    : `<p style="grid-column:1/-1;text-align:center;padding:60px;color:var(--ink-soft);">暫無商品。</p>`;
}

renderChips();
updateTitle();
load();

chipsEl.addEventListener('click', (e) => {
  const btn = e.target.closest('.chip');
  if (!btn) return;
  currentCat = btn.dataset.cat;
  const u = new URL(location.href);
  u.searchParams.set('cat', currentCat);
  history.replaceState(null, '', u);
  renderChips(); updateTitle(); load();
});
sortEl.addEventListener('change', () => { currentSort = sortEl.value; load(); });
