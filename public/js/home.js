import { api, renderHeader, renderFooter, productCard, CATEGORIES, mediaUrl } from './app.js';

renderHeader('all');
renderFooter();

/* ---------- Hero slider ---------- */
const slides = [
  {
    img: 'LINE_ALBUM_2026424_260424_10.jpg',
    eyebrow: 'SEOUL · 2026 AUTUMN',
    title: 'Quiet Luxury,<br><em>in every thread</em>',
    caption: '雙面羊毛大衣 × 英倫西裝 · 入秋必備',
    cta: '探索新品',
    link: '/shop.html?cat=outer'
  },
  {
    img: 'LINE_ALBUM_2026424_260424_15.jpg',
    eyebrow: 'LEATHER SEASON',
    title: 'Edge &amp; <em>softness</em>',
    caption: '復古油蠟皮夾克 · 鎮店招牌回歸',
    cta: '立即選購',
    link: '/product.html?id=y015'
  },
  {
    img: 'LINE_ALBUM_2026424_260424_3.jpg',
    eyebrow: 'OCCASION EDIT',
    title: 'For the <em>special day</em>',
    caption: '小香風珠釦外套 · 婚宴登場',
    cta: '查看系列',
    link: '/shop.html?cat=outer'
  }
];

const heroBg = document.getElementById('hero-bg');
const heroContent = document.getElementById('hero-content');
const dotsEl = document.getElementById('hero-dots');
let idx = 0;

function renderSlide(i) {
  const s = slides[i];
  heroBg.style.backgroundImage = `url("${mediaUrl(s.img)}")`;
  heroContent.innerHTML = `
    <div class="eyebrow">${s.eyebrow}</div>
    <h1>${s.title}</h1>
    <p>${s.caption}</p>
    <a class="hero-btn" href="${s.link}">${s.cta}</a>`;
  dotsEl.innerHTML = slides.map((_, j) =>
    `<span class="${j === i ? 'active' : ''}" data-i="${j}"></span>`
  ).join('');
}
renderSlide(0);
let heroTimer = setInterval(() => { idx = (idx + 1) % slides.length; renderSlide(idx); }, 6000);
dotsEl.addEventListener('click', (e) => {
  const i = Number(e.target.dataset.i);
  if (Number.isNaN(i)) return;
  idx = i; renderSlide(idx);
  clearInterval(heroTimer);
  heroTimer = setInterval(() => { idx = (idx + 1) % slides.length; renderSlide(idx); }, 6000);
});

/* ---------- Category grid ---------- */
const catImages = {
  outer:  'LINE_ALBUM_2026424_260424_2.jpg',
  blouse: 'LINE_ALBUM_2026424_260424_25.jpg',
  tee:    'LINE_ALBUM_2026424_260424_8.jpg',
  dress:  'LINE_ALBUM_2026424_260424_13.jpg'
};
const catGrid = document.getElementById('cat-grid');
catGrid.innerHTML = ['outer', 'blouse', 'tee', 'dress'].map(key => {
  const c = CATEGORIES.find(x => x.key === key);
  return `
    <a href="/shop.html?cat=${c.key}" class="cat-card">
      <img src="${mediaUrl(catImages[key])}" alt="${c.zh}">
      <div class="overlay">
        <small>${c.label}</small>
        <h3>${c.zh}</h3>
      </div>
    </a>`;
}).join('');

/* ---------- Weekly best with tabs ---------- */
const weeklyTabs = [
  { key: 'all',   label: 'ALL' },
  { key: 'outer', label: 'OUTER' },
  { key: 'tee',   label: 'TEE' },
  { key: 'knit',  label: 'KNIT' },
  { key: 'dress', label: 'DRESS' }
];
const tabsEl = document.getElementById('tabs');
tabsEl.innerHTML = weeklyTabs.map((t, i) =>
  `<button class="${i === 0 ? 'active' : ''}" data-cat="${t.key}">${t.label}</button>`
).join('');

let allProducts = [];
async function loadWeekly() {
  allProducts = await api('/api/products?sort=best');
  renderWeekly('all');
  renderNew();
}
function renderWeekly(cat) {
  const grid = document.getElementById('weekly-grid');
  const list = (cat === 'all' ? allProducts : allProducts.filter(p => p.category === cat)).slice(0, 8);
  grid.innerHTML = list.map(productCard).join('');
}
function renderNew() {
  const grid = document.getElementById('new-grid');
  const list = allProducts
    .filter(p => p.badge === 'NEW' || p.badge === 'HOT')
    .slice(0, 6);
  const fallback = allProducts.slice(0, 6);
  grid.innerHTML = (list.length >= 3 ? list : fallback).map(productCard).join('');
}
tabsEl.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  tabsEl.querySelectorAll('button').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderWeekly(btn.dataset.cat);
});

loadWeekly();
