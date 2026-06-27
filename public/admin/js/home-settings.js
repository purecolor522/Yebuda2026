import { api, toast } from './admin-app.js';

/* 首頁設定：編輯 Hero 輪播與 Lookbook 橫幅。圖片用 /api/admin/upload 上傳，
   存到 /api/admin/home-settings；前台 index.html 會讀 /api/home-settings 套用。 */

let settings = { hero: [], lookbookBanner: {} };

const heroList = document.getElementById('heroList');
const bannerBox = document.getElementById('bannerBox');

document.getElementById('addSlideBtn').addEventListener('click', () => {
  settings.hero.push({ image: '', title: '', subtitle: '', btnText: 'SHOP NOW', btnLink: '#products' });
  renderHero();
});
document.getElementById('saveBtn').addEventListener('click', save);
document.getElementById('reloadBtn').addEventListener('click', load);

load();

async function load() {
  try { settings = await api('/api/home-settings'); }
  catch (e) { toast(e.message || '載入失敗', 'error'); return; }
  if (!Array.isArray(settings.hero)) settings.hero = [];
  if (!settings.lookbookBanner) settings.lookbookBanner = {};
  // 焦點預設：輪播置中、Lookbook 橫幅靠上（人像橫幅較不會切到頭）
  settings.hero.forEach(s => { if (!s.focus) s.focus = 'center'; });
  if (!settings.lookbookBanner.focus) settings.lookbookBanner.focus = 'top';
  renderHero();
  renderBanner();
}

// 預設圖是相對路徑 images/...（前台在根目錄可用）；後台在 /admin/ 要補成絕對路徑才顯示得到
function previewSrc(img) {
  if (!img) return '';
  return (/^https?:\/\//.test(img) || img.startsWith('/')) ? img : '/' + img;
}

function fieldsHtml(o, withIndex, idx) {
  return `
    <div class="hs-fields">
      ${withIndex ? `<div class="hs-card-head"><label>第 ${idx + 1} 張</label><button class="hs-del">刪除這張</button></div>` : ''}
      <div><label>大標題</label><input class="f-title" value="${escAttr(o.title)}"></div>
      <div><label>副標</label><input class="f-sub" value="${escAttr(o.subtitle)}"></div>
      <div class="hs-row">
        <div><label>按鈕文字</label><input class="f-bt" value="${escAttr(o.btnText)}"></div>
        <div><label>按鈕連結</label><input class="f-bl" value="${escAttr(o.btnLink)}"></div>
      </div>
      <div><label>圖片焦點（裁切時對齊哪裡，避免切到頭）</label>
        <select class="f-focus" style="width:100%;padding:8px 10px;border:1px solid #e0dcd5;border-radius:4px;font-family:inherit;font-size:13px;">
          <option value="top"${o.focus === 'top' ? ' selected' : ''}>靠上（顯示頭部，推薦人像）</option>
          <option value="center"${(!o.focus || o.focus === 'center') ? ' selected' : ''}>置中</option>
          <option value="bottom"${o.focus === 'bottom' ? ' selected' : ''}>靠下</option>
        </select>
      </div>
    </div>`;
}

function focusPos(f) { return f === 'top' ? 'center top' : f === 'bottom' ? 'center bottom' : 'center center'; }

function bindCard(div, obj) {
  div.querySelector('.f-title').addEventListener('input', e => obj.title = e.target.value);
  div.querySelector('.f-sub').addEventListener('input', e => obj.subtitle = e.target.value);
  div.querySelector('.f-bt').addEventListener('input', e => obj.btnText = e.target.value);
  div.querySelector('.f-bl').addEventListener('input', e => obj.btnLink = e.target.value);
  const pv = div.querySelector('.pv');
  pv.style.objectPosition = focusPos(obj.focus);
  div.querySelector('.f-focus').addEventListener('change', e => {
    obj.focus = e.target.value;
    pv.style.objectPosition = focusPos(obj.focus); // 即時預覽焦點
  });
  const file = div.querySelector('input[type=file]');
  div.querySelector('.rep').addEventListener('click', () => file.click());
  file.addEventListener('change', () => uploadInto(file, obj, pv));
}

function cardEl(obj, withIndex, idx) {
  const div = document.createElement('div');
  div.className = 'hs-card';
  div.innerHTML = `
    <div class="hs-thumb">
      <img class="pv" src="${previewSrc(obj.image)}" alt="">
      <input type="file" accept="image/*" hidden>
      <button type="button" class="btn-ghost rep">📷 更換圖片</button>
    </div>
    ${fieldsHtml(obj, withIndex, idx)}`;
  bindCard(div, obj);
  if (withIndex) {
    div.querySelector('.hs-del').addEventListener('click', () => {
      settings.hero.splice(idx, 1);
      renderHero();
    });
  }
  return div;
}

function renderHero() {
  heroList.innerHTML = '';
  settings.hero.forEach((sl, i) => heroList.appendChild(cardEl(sl, true, i)));
}

function renderBanner() {
  bannerBox.innerHTML = '';
  bannerBox.appendChild(cardEl(settings.lookbookBanner, false));
}

async function uploadInto(fileInput, obj, imgEl) {
  const f = fileInput.files[0];
  fileInput.value = '';
  if (!f) return;
  try {
    const fd = new FormData();
    fd.append('files', f);
    const up = await api('/api/admin/upload', { method: 'POST', body: fd });
    const url = up.urls && up.urls[0];
    if (!url) throw new Error('上傳未取得網址');
    obj.image = url;
    imgEl.src = previewSrc(url) + (url.includes('?') ? '&' : '?') + 't=' + Date.now();
    toast('圖片已更換（記得按「儲存並套用」）', 'success');
  } catch (e) { toast(e.message || '上傳失敗', 'error'); }
}

async function save() {
  const hero = settings.hero.filter(s => s.image);
  if (!hero.length) { toast('至少要有一張有圖片的輪播', 'error'); return; }
  if (!settings.lookbookBanner.image) { toast('Lookbook 橫幅需要一張圖片', 'error'); return; }
  const btn = document.getElementById('saveBtn');
  btn.disabled = true; btn.textContent = '儲存中…';
  try {
    await api('/api/admin/home-settings', { method: 'PUT', body: { hero, lookbookBanner: settings.lookbookBanner } });
    toast('已儲存並套用！到前台重整即可看到', 'success');
  } catch (e) { toast(e.message || '儲存失敗', 'error'); }
  btn.disabled = false; btn.textContent = '儲存並套用';
}

function escAttr(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m])); }
