import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import fs from 'node:fs/promises';
import fssync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { buildCheckoutPage, verifyCallback } from './lib/ecpay.js';
import {
  adminPassword, issueAdminCookie, clearAdminCookie,
  requireAdmin, isAdmin
} from './lib/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const PRODUCTS_FILE = path.join(DATA_DIR, 'products.json');
const ORDERS_FILE   = path.join(DATA_DIR, 'orders.json');
const CARTS_FILE    = path.join(DATA_DIR, 'carts.json');

fssync.mkdirSync(UPLOAD_DIR, { recursive: true });
fssync.mkdirSync(DATA_DIR, { recursive: true });

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// ---- Static ----
app.use(express.static(path.join(__dirname, 'public')));
app.use('/media',   express.static(__dirname,   { index: false }));
app.use('/uploads', express.static(UPLOAD_DIR, { index: false }));

// ---- Helpers ----
async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (e) {
    if (e.code === 'ENOENT') { await fs.writeFile(file, JSON.stringify(fallback, null, 2)); return fallback; }
    throw e;
  }
}
async function writeJson(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(data, null, 2));
}
function normalizeProductImage(p) {
  // Legacy: bare filename means it's one of the original lookbook photos at project root.
  if (p.image && !p.image.startsWith('/') && !p.image.startsWith('http')) {
    return { ...p, image: '/media/' + p.image };
  }
  return p;
}
async function getProducts() {
  const list = await readJson(PRODUCTS_FILE, []);
  return list.map(normalizeProductImage);
}
async function rawProducts() { return readJson(PRODUCTS_FILE, []); }

// ---- Customer session cookie ----
app.use((req, res, next) => {
  const cookies = Object.fromEntries(
    (req.headers.cookie || '').split(';').map(s => s.trim().split('=')).filter(p => p[0])
  );
  req.sid = cookies.yebuda_sid;
  if (!req.sid) {
    req.sid = crypto.randomBytes(16).toString('hex');
    const existing = res.getHeader('Set-Cookie') || [];
    res.setHeader('Set-Cookie', [...(Array.isArray(existing) ? existing : [existing]),
      `yebuda_sid=${req.sid}; Path=/; Max-Age=${60 * 60 * 24 * 30}; SameSite=Lax`]);
  }
  next();
});

async function getCart(sid) { const c = await readJson(CARTS_FILE, {}); return c[sid] || []; }
async function saveCart(sid, items) { const c = await readJson(CARTS_FILE, {}); c[sid] = items; await writeJson(CARTS_FILE, c); }

// =================================================================
// Public: Products
// =================================================================
app.get('/api/products', async (req, res) => {
  const products = await getProducts();
  const { category, q, sort } = req.query;
  let list = products.filter(p => !p.hidden);
  if (category && category !== 'all') list = list.filter(p => p.category === category);
  if (q) {
    const needle = String(q).toLowerCase();
    list = list.filter(p => p.name.toLowerCase().includes(needle) ||
      (p.subtitle || '').toLowerCase().includes(needle));
  }
  if (sort === 'price-asc')  list.sort((a, b) => a.price - b.price);
  else if (sort === 'price-desc') list.sort((a, b) => b.price - a.price);
  else if (sort === 'best') list.sort((a, b) => {
    const rank = x => x.badge === 'HOT' ? 3 : x.badge === 'BEST' ? 2 : x.badge === 'NEW' ? 1 : 0;
    return rank(b) - rank(a);
  });
  res.json(list);
});

app.get('/api/products/:id', async (req, res) => {
  const products = await getProducts();
  const product = products.find(p => p.id === req.params.id);
  if (!product || product.hidden) return res.status(404).json({ error: 'Not found' });
  const related = products.filter(p => p.category === product.category && p.id !== product.id && !p.hidden).slice(0, 4);
  res.json({ ...product, related });
});

// =================================================================
// Cart
// =================================================================
app.get('/api/cart', async (req, res) => {
  const items = await getCart(req.sid);
  const products = await getProducts();
  const detailed = items.map(it => {
    const p = products.find(pp => pp.id === it.productId);
    if (!p) return null;
    return { ...it, name: p.name, subtitle: p.subtitle, price: p.price, image: p.image, subtotal: p.price * it.qty };
  }).filter(Boolean);
  const subtotal = detailed.reduce((s, x) => s + x.subtotal, 0);
  const shipping = subtotal === 0 ? 0 : (subtotal >= 3000 ? 0 : 80);
  res.json({ items: detailed, subtotal, shipping, total: subtotal + shipping });
});
app.get('/api/cart/count', async (req, res) => {
  const items = await getCart(req.sid);
  res.json({ count: items.reduce((s, x) => s + x.qty, 0) });
});
app.post('/api/cart', async (req, res) => {
  const { productId, qty = 1, size = 'FREE', color = '' } = req.body || {};
  if (!productId) return res.status(400).json({ error: 'productId required' });
  const products = await getProducts();
  if (!products.find(p => p.id === productId)) return res.status(404).json({ error: 'Product not found' });
  const items = await getCart(req.sid);
  const key = `${productId}::${size}::${color}`;
  const existing = items.find(it => `${it.productId}::${it.size}::${it.color}` === key);
  if (existing) existing.qty += Number(qty);
  else items.push({ productId, qty: Number(qty), size, color });
  await saveCart(req.sid, items);
  res.json({ ok: true, count: items.reduce((s, x) => s + x.qty, 0) });
});
app.patch('/api/cart', async (req, res) => {
  const { productId, size, color, qty } = req.body || {};
  const items = await getCart(req.sid);
  const target = items.find(it => it.productId === productId && it.size === size && it.color === color);
  if (!target) return res.status(404).json({ error: 'Not in cart' });
  target.qty = Math.max(0, Number(qty));
  await saveCart(req.sid, items.filter(it => it.qty > 0));
  res.json({ ok: true });
});
app.delete('/api/cart', async (req, res) => {
  const { productId, size, color } = req.body || {};
  const items = await getCart(req.sid);
  await saveCart(req.sid, items.filter(it =>
    !(it.productId === productId && it.size === size && it.color === color)));
  res.json({ ok: true });
});

// =================================================================
// Checkout + Payment
// =================================================================
async function buildPendingOrder(sid, customer, payment) {
  const items = await getCart(sid);
  if (!items.length) throw new Error('購物車是空的');
  const products = await getProducts();
  const lineItems = items.map(it => {
    const p = products.find(pp => pp.id === it.productId);
    return {
      productId: it.productId, name: p.name, price: p.price, qty: it.qty,
      size: it.size, color: it.color, subtotal: p.price * it.qty, image: p.image
    };
  });
  const subtotal = lineItems.reduce((s, x) => s + x.subtotal, 0);
  const shipping = subtotal >= 3000 ? 0 : 80;
  const total = subtotal + shipping;
  const id = 'YB' + Date.now().toString().slice(-8) + crypto.randomInt(100, 999);
  return {
    id, createdAt: new Date().toISOString(),
    customer, items: lineItems, subtotal, shipping, total,
    payment, status: payment.method === 'card-mock' ? 'paid' : 'awaiting_payment'
  };
}

app.post('/api/checkout', async (req, res) => {
  const { name, phone, email, address, city, zip, payment, card } = req.body || {};
  if (!name || !phone || !address || !payment) return res.status(400).json({ error: '請填寫完整收件資訊' });
  try {
    const customer = { name, phone, email, address, city, zip };

    if (payment === 'ecpay') {
      const order = await buildPendingOrder(req.sid, customer,
        { method: 'ecpay', status: 'pending' });
      const orders = await readJson(ORDERS_FILE, []);
      orders.unshift(order);
      await writeJson(ORDERS_FILE, orders);
      const { tradeNo, html } = buildCheckoutPage(order);
      order.payment.ecpayTradeNo = tradeNo;
      await writeJson(ORDERS_FILE, orders);
      await saveCart(req.sid, []);
      res.json({ ok: true, redirectHtml: html, order: { id: order.id } });
      return;
    }

    // fallback: mock card (development / when ECPay not in use)
    if (payment === 'card') {
      const num = String(card?.number || '').replace(/\s+/g, '');
      if (!/^\d{14,19}$/.test(num)) return res.status(400).json({ error: '卡號格式錯誤' });
      if (!/^\d{3,4}$/.test(String(card?.cvc || ''))) return res.status(400).json({ error: 'CVC 格式錯誤' });
      if (!/^\d{2}\/\d{2}$/.test(String(card?.expiry || ''))) return res.status(400).json({ error: '到期日格式錯誤 (MM/YY)' });
      const order = await buildPendingOrder(req.sid, customer,
        { method: 'card-mock', status: 'paid', last4: num.slice(-4) });
      const orders = await readJson(ORDERS_FILE, []);
      orders.unshift(order);
      await writeJson(ORDERS_FILE, orders);
      await saveCart(req.sid, []);
      res.json({ ok: true, order });
      return;
    }

    if (payment === 'transfer') {
      const order = await buildPendingOrder(req.sid, customer,
        { method: 'transfer', status: 'pending' });
      const orders = await readJson(ORDERS_FILE, []);
      orders.unshift(order);
      await writeJson(ORDERS_FILE, orders);
      await saveCart(req.sid, []);
      res.json({ ok: true, order });
      return;
    }

    res.status(400).json({ error: '未知的付款方式' });
  } catch (e) {
    res.status(400).json({ error: e.message || 'checkout failed' });
  }
});

// ---- ECPay callbacks ----
// Server-to-server notify (must respond "1|OK")
app.post('/api/ecpay/notify', async (req, res) => {
  const data = req.body || {};
  if (!verifyCallback(data)) return res.status(400).send('0|CheckMacValue mismatch');
  const orders = await readJson(ORDERS_FILE, []);
  const order = orders.find(o => o.id === data.CustomField1);
  if (!order) return res.status(200).send('1|OK'); // ack anyway to stop retries
  order.payment = {
    ...order.payment,
    method: 'ecpay',
    ecpayTradeNo: data.MerchantTradeNo,
    ecpayTradeRecv: data.TradeNo,
    paymentType: data.PaymentType,
    rawReturn: { RtnCode: data.RtnCode, RtnMsg: data.RtnMsg, PaymentDate: data.PaymentDate }
  };
  if (String(data.RtnCode) === '1') {
    order.status = 'paid';
    order.payment.status = 'paid';
  } else {
    order.status = 'payment_failed';
    order.payment.status = 'failed';
  }
  await writeJson(ORDERS_FILE, orders);
  res.send('1|OK');
});

// Browser redirect back after payment
app.post('/api/ecpay/return', async (req, res) => {
  const data = req.body || {};
  const orderId = data.CustomField1 || '';
  res.redirect(302, `/order.html?id=${encodeURIComponent(orderId)}`);
});

app.get('/api/orders/:id', async (req, res) => {
  const orders = await readJson(ORDERS_FILE, []);
  const order = orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  res.json(order);
});

// =================================================================
// Admin
// =================================================================
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body || {};
  if (password !== adminPassword()) return res.status(401).json({ error: '密碼錯誤' });
  issueAdminCookie(res);
  res.json({ ok: true });
});
app.post('/api/admin/logout', (req, res) => { clearAdminCookie(res); res.json({ ok: true }); });
app.get('/api/admin/whoami', (req, res) => res.json({ loggedIn: isAdmin(req) }));

// Upload
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
      cb(null, Date.now() + '-' + crypto.randomBytes(4).toString('hex') + ext);
    }
  }),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    if (/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('僅支援 JPG / PNG / WEBP / GIF'));
  }
});
app.post('/api/admin/upload', requireAdmin, (req, res) => {
  upload.array('files', 10)(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    const urls = (req.files || []).map(f => '/uploads/' + f.filename);
    res.json({ ok: true, urls });
  });
});

// Products CRUD
app.get('/api/admin/products', requireAdmin, async (_req, res) => {
  const list = await getProducts();
  res.json(list);
});
app.post('/api/admin/products', requireAdmin, async (req, res) => {
  const p = req.body || {};
  if (!p.name || !p.category || !(p.price >= 0) || !p.image) {
    return res.status(400).json({ error: '必填：name / category / price / image' });
  }
  const products = await rawProducts();
  const id = p.id || ('y' + Date.now().toString().slice(-6));
  if (products.find(x => x.id === id)) return res.status(409).json({ error: 'ID 已存在' });
  const newProduct = {
    id, name: String(p.name), subtitle: String(p.subtitle || ''),
    category: String(p.category), price: Number(p.price),
    originalPrice: p.originalPrice ? Number(p.originalPrice) : null,
    color: String(p.color || ''), colors: Array.isArray(p.colors) ? p.colors : [],
    sizes: Array.isArray(p.sizes) && p.sizes.length ? p.sizes : ['FREE'],
    badge: p.badge || null, stock: Number(p.stock ?? 0),
    image: String(p.image), description: String(p.description || ''),
    hidden: Boolean(p.hidden)
  };
  products.push(newProduct);
  await writeJson(PRODUCTS_FILE, products);
  res.json({ ok: true, product: newProduct });
});
app.put('/api/admin/products/:id', requireAdmin, async (req, res) => {
  const products = await rawProducts();
  const idx = products.findIndex(x => x.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const patch = req.body || {};
  const merged = { ...products[idx], ...patch, id: products[idx].id };
  if (merged.price !== undefined) merged.price = Number(merged.price);
  if (merged.originalPrice !== undefined && merged.originalPrice !== null)
    merged.originalPrice = Number(merged.originalPrice) || null;
  if (merged.stock !== undefined) merged.stock = Number(merged.stock);
  products[idx] = merged;
  await writeJson(PRODUCTS_FILE, products);
  res.json({ ok: true, product: merged });
});
app.delete('/api/admin/products/:id', requireAdmin, async (req, res) => {
  const products = await rawProducts();
  const next = products.filter(x => x.id !== req.params.id);
  if (next.length === products.length) return res.status(404).json({ error: 'Not found' });
  await writeJson(PRODUCTS_FILE, next);
  res.json({ ok: true });
});

// Orders (protected)
app.get('/api/admin/orders', requireAdmin, async (_req, res) => {
  const orders = await readJson(ORDERS_FILE, []);
  res.json(orders);
});
app.put('/api/admin/orders/:id', requireAdmin, async (req, res) => {
  const orders = await readJson(ORDERS_FILE, []);
  const o = orders.find(x => x.id === req.params.id);
  if (!o) return res.status(404).json({ error: 'Not found' });
  if (req.body.status) o.status = req.body.status;
  if (req.body.trackingNo) o.trackingNo = String(req.body.trackingNo);
  await writeJson(ORDERS_FILE, orders);
  res.json({ ok: true, order: o });
});

// Dashboard stats
app.get('/api/admin/stats', requireAdmin, async (_req, res) => {
  const orders = await readJson(ORDERS_FILE, []);
  const paid = orders.filter(o => o.status === 'paid');
  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;

  const sumIn = (days) => paid
    .filter(o => now - Date.parse(o.createdAt) <= days * DAY)
    .reduce((s, o) => s + o.total, 0);

  const totalRevenue = paid.reduce((s, o) => s + o.total, 0);
  const orderCount = orders.length;
  const paidCount = paid.length;
  const pendingCount = orders.filter(o => o.status === 'awaiting_payment').length;
  const avgOrderValue = paidCount ? Math.round(totalRevenue / paidCount) : 0;

  // 30-day series
  const days = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now - i * DAY);
    const label = `${d.getMonth() + 1}/${d.getDate()}`;
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const end = start + DAY;
    const daily = paid.filter(o => {
      const t = Date.parse(o.createdAt);
      return t >= start && t < end;
    });
    days.push({
      date: label,
      revenue: daily.reduce((s, o) => s + o.total, 0),
      orders: daily.length
    });
  }

  // Best sellers
  const tally = new Map();
  for (const o of paid) {
    for (const it of o.items) {
      const k = it.productId;
      const curr = tally.get(k) || { productId: k, name: it.name, image: it.image, qty: 0, revenue: 0 };
      curr.qty += it.qty;
      curr.revenue += it.subtotal;
      tally.set(k, curr);
    }
  }
  const bestSellers = Array.from(tally.values()).sort((a, b) => b.qty - a.qty).slice(0, 6);

  res.json({
    totalRevenue, orderCount, paidCount, pendingCount, avgOrderValue,
    today: sumIn(1), week: sumIn(7), month: sumIn(30),
    days, bestSellers,
    recentOrders: orders.slice(0, 8)
  });
});

// SPA fallback
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/media/') || req.path.startsWith('/uploads/')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n  YEBUDA shop  ⟶  http://localhost:${PORT}`);
  console.log(`  Admin login  ⟶  http://localhost:${PORT}/admin/login.html`);
  console.log(`  Default password: ${adminPassword()}${process.env.ADMIN_PASSWORD ? '' : ' (set ADMIN_PASSWORD env var for production)'}`);
  console.log(`  ECPay mode:  ${process.env.ECPAY_ENV === 'production' ? 'PRODUCTION' : 'STAGE (test)'}\n`);
});
