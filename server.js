import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import fs from 'node:fs/promises';
import fssync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import nodemailer from 'nodemailer';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { buildCheckoutPage, verifyCallback } from './lib/ecpay.js';
import {
  adminPassword, issueAdminCookie, clearAdminCookie,
  requireAdmin, isAdmin
} from './lib/auth.js';
import { classifyProductImage, isAvailable as aiAvailable } from './lib/ai-classify.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const UPLOAD_DIR = process.env.NODE_ENV === 'production'
  ? path.join(__dirname, 'data', 'uploads')
  : path.join(__dirname, 'uploads');
const PRODUCTS_FILE  = path.join(DATA_DIR, 'products.json');
const ORDERS_FILE    = path.join(DATA_DIR, 'orders.json');
const CARTS_FILE     = path.join(DATA_DIR, 'carts.json');
const CUSTOMERS_FILE = path.join(DATA_DIR, 'customers.json');

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
    return {
      ...it,
      name: p.name, subtitle: p.subtitle, price: p.price, image: p.image,
      subtotal: p.price * it.qty,
      availableSizes:  Array.isArray(p.sizes)  && p.sizes.length  ? p.sizes  : ['FREE'],
      availableColors: Array.isArray(p.colors) && p.colors.length ? p.colors : (p.color ? [p.color] : []),
    };
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

// Change a cart line's size/color — moves the line to the new variant key,
// merging qty if that variant already exists in the cart.
app.put('/api/cart/variant', async (req, res) => {
  const { productId, oldSize, oldColor, newSize, newColor } = req.body || {};
  if (!productId || !newSize || newColor === undefined) {
    return res.status(400).json({ error: 'productId / newSize / newColor required' });
  }
  const items = await getCart(req.sid);
  const idx = items.findIndex(it => it.productId === productId && it.size === oldSize && it.color === oldColor);
  if (idx === -1) return res.status(404).json({ error: 'Not in cart' });
  const oldItem = items.splice(idx, 1)[0];
  const merge = items.find(it => it.productId === productId && it.size === newSize && it.color === newColor);
  if (merge) merge.qty += oldItem.qty;
  else items.push({ productId, size: newSize, color: newColor, qty: oldItem.qty });
  await saveCart(req.sid, items);
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
// Customer Auth
// =================================================================
const JWT_SECRET = process.env.ADMIN_SECRET || 'yebuda-jwt-secret-2026';
const JWT_EXPIRES = '30d';

function signToken(id) { return jwt.sign({ id }, JWT_SECRET, { expiresIn: JWT_EXPIRES }); }
function verifyToken(token) { try { return jwt.verify(token, JWT_SECRET); } catch { return null; } }
function authMiddleware(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  req.customer = token ? verifyToken(token) : null;
  next();
}

// New-member welcome coupon: NT$100, no expiry, one-time use
function makeWelcomeCoupon() {
  return {
    id: 'cpn_' + crypto.randomBytes(6).toString('hex'),
    code: 'WELCOME100',
    type: 'fixed',
    amount: 100,
    reason: '新會員禮 ✨',
    issuedAt: new Date().toISOString(),
    usedAt: null,
    orderId: null,
  };
}

app.post('/api/auth/register', async (req, res) => {
  const { email, password, name, phone, address } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: '請填寫 Email 和密碼' });
  if (password.length < 8) return res.status(400).json({ error: '密碼至少需要 8 個字元' });
  const customers = await readJson(CUSTOMERS_FILE, []);
  if (customers.find(c => c.email === email)) return res.status(409).json({ error: '此 Email 已被註冊' });
  const hashed = await bcrypt.hash(password, 10);
  const customer = {
    id: crypto.randomUUID(),
    email, password: hashed,
    name: name || '', phone: phone || '', address: address || '',
    createdAt: new Date().toISOString(),
    coupons: [makeWelcomeCoupon()],
  };
  customers.push(customer);
  await writeJson(CUSTOMERS_FILE, customers);
  const { password: _, ...safe } = customer;
  res.json({ ok: true, token: signToken(customer.id), customer: safe });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: '請填寫 Email 和密碼' });
  const customers = await readJson(CUSTOMERS_FILE, []);
  const customer = customers.find(c => c.email === email);
  if (!customer || !(await bcrypt.compare(password, customer.password))) return res.status(401).json({ error: 'Email 或密碼錯誤' });
  const { password: _, ...safe } = customer;
  res.json({ ok: true, token: signToken(customer.id), customer: safe });
});

app.get('/api/auth/me', authMiddleware, async (req, res) => {
  if (!req.customer) return res.status(401).json({ error: '請先登入' });
  const customers = await readJson(CUSTOMERS_FILE, []);
  const customer = customers.find(c => c.id === req.customer.id);
  if (!customer) return res.status(404).json({ error: '找不到用戶' });
  const { password: _, ...safe } = customer;
  res.json(safe);
});

app.put('/api/auth/me', authMiddleware, async (req, res) => {
  if (!req.customer) return res.status(401).json({ error: '請先登入' });
  const { name, phone, address } = req.body || {};
  const customers = await readJson(CUSTOMERS_FILE, []);
  const idx = customers.findIndex(c => c.id === req.customer.id);
  if (idx === -1) return res.status(404).json({ error: '找不到用戶' });
  customers[idx] = { ...customers[idx], name: name ?? customers[idx].name, phone: phone ?? customers[idx].phone, address: address ?? customers[idx].address };
  await writeJson(CUSTOMERS_FILE, customers);
  const { password: _, ...safe } = customers[idx];
  res.json({ ok: true, customer: safe });
});

// =========== Forgot password flow ===========
app.post('/api/auth/forgot', async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: '請輸入 Email' });
  const normalized = String(email).trim().toLowerCase();
  const customers = await readJson(CUSTOMERS_FILE, []);
  const customer = customers.find(c => String(c.email).toLowerCase() === normalized);

  // Generic response prevents email enumeration — same message whether the email exists or not
  const generic = { ok: true, message: '如果該 Email 已註冊，重設信件已寄出，請查收' };
  if (!customer) return res.json(generic);

  // Generate one-hour token
  const token = crypto.randomBytes(32).toString('hex');
  customer.passwordResetToken   = token;
  customer.passwordResetExpires = Date.now() + 60 * 60 * 1000;
  await writeJson(CUSTOMERS_FILE, customers);

  // Send the email if SMTP is configured
  if (mailTransporter) {
    // Prefer real APP_BASE_URL only if it's actually configured (not the placeholder)
    const envBase = process.env.APP_BASE_URL || '';
    const isPlaceholder = !envBase || /your-domain\.com|example\.com|localhost/i.test(envBase);
    const baseUrl = isPlaceholder ? `${req.protocol}://${req.get('host')}` : envBase;
    const resetUrl = `${baseUrl}/reset-password.html?token=${token}`;
    const html = `
      <div style="font-family:'Noto Sans TC',sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#faf7f2;color:#2c2c2c;">
        <h2 style="font-family:Cormorant Garamond,serif;letter-spacing:3px;color:#c9a96e;margin-bottom:8px;">YEBUDA 漂亮小姐</h2>
        <p style="font-size:13px;color:#999;letter-spacing:2px;margin-bottom:24px;">PASSWORD RESET</p>
        <p>您好 <strong>${customer.name || customer.email}</strong>，</p>
        <p>我們收到您重設密碼的請求。請點擊下方按鈕設定新密碼，連結將在 <strong>1 小時內有效</strong>。</p>
        <p style="margin:28px 0;">
          <a href="${resetUrl}" style="display:inline-block;padding:14px 32px;background:#2c2c2c;color:#fff;text-decoration:none;letter-spacing:2px;font-size:13px;border-radius:4px;">重設密碼</a>
        </p>
        <p style="font-size:12px;color:#888;line-height:1.7;">如果上方按鈕無法點擊，請複製以下網址貼到瀏覽器：<br>
          <a href="${resetUrl}" style="color:#c9a96e;word-break:break-all;">${resetUrl}</a>
        </p>
        <p style="font-size:12px;color:#888;margin-top:24px;">如果您沒有提出此請求，請忽略此封信件，您的密碼不會被更動。</p>
        <hr style="border:none;border-top:1px solid #e8e4df;margin:24px 0;">
        <p style="font-size:11px;color:#aaa;text-align:center;">YEBUDA 漂亮小姐 · 韓系女裝精品<br>LINE @094efuba ｜ Email yebuda22@gmail.com</p>
      </div>`;
    try {
      await mailTransporter.sendMail({
        from: `"YEBUDA 漂亮小姐" <${process.env.SMTP_USER}>`,
        to: customer.email,
        subject: '【YEBUDA】重設您的密碼',
        html,
      });
      console.log(`[forgot-password] reset email sent to ${customer.email}`);
    } catch (e) {
      console.error('[forgot-password] failed to send email:', e.message);
    }
  } else {
    console.warn('[forgot-password] SMTP not configured — token not delivered');
  }

  res.json(generic);
});

app.post('/api/auth/reset', async (req, res) => {
  const { token, newPassword } = req.body || {};
  if (!token || !newPassword) return res.status(400).json({ error: '缺少必要參數' });
  if (String(newPassword).length < 8) return res.status(400).json({ error: '密碼至少需要 8 個字元' });
  const customers = await readJson(CUSTOMERS_FILE, []);
  const customer = customers.find(c => c.passwordResetToken === token);
  if (!customer) return res.status(400).json({ error: '重設連結無效或已使用' });
  if (Date.now() > (customer.passwordResetExpires || 0)) {
    return res.status(400).json({ error: '重設連結已過期，請重新申請' });
  }
  customer.password = await bcrypt.hash(newPassword, 10);
  delete customer.passwordResetToken;
  delete customer.passwordResetExpires;
  await writeJson(CUSTOMERS_FILE, customers);
  res.json({ ok: true });
});

app.get('/api/auth/orders', authMiddleware, async (req, res) => {
  if (!req.customer) return res.status(401).json({ error: '請先登入' });
  const customers = await readJson(CUSTOMERS_FILE, []);
  const customer = customers.find(c => c.id === req.customer.id);
  if (!customer) return res.status(404).json({ error: '找不到用戶' });
  const orders = await readJson(ORDERS_FILE, []);
  const mine = orders
    .filter(o => o.customer?.email === customer.email)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  res.json(mine);
});

// Customer self-service: confirm receipt / request refund
async function findCustomerOrder(req) {
  const customers = await readJson(CUSTOMERS_FILE, []);
  const customer = customers.find(c => c.id === req.customer?.id);
  if (!customer) return { error: '找不到用戶', code: 404 };
  const orders = await readJson(ORDERS_FILE, []);
  const order = orders.find(o => o.id === req.params.id && o.customer?.email === customer.email);
  if (!order) return { error: '找不到訂單', code: 404 };
  return { orders, order };
}

app.post('/api/auth/orders/:id/confirm', authMiddleware, async (req, res) => {
  if (!req.customer) return res.status(401).json({ error: '請先登入' });
  const r = await findCustomerOrder(req);
  if (r.error) return res.status(r.code).json({ error: r.error });
  if (!['shipped', 'in_transit'].includes(r.order.status)) return res.status(400).json({ error: '此訂單目前無法確認收貨' });
  r.order.status = 'delivered';
  r.order.deliveredAt = new Date().toISOString();
  await writeJson(ORDERS_FILE, r.orders);
  res.json({ ok: true, order: r.order });
});

app.post('/api/auth/orders/:id/refund', authMiddleware, async (req, res) => {
  if (!req.customer) return res.status(401).json({ error: '請先登入' });
  const r = await findCustomerOrder(req);
  if (r.error) return res.status(r.code).json({ error: r.error });
  if (!['paid', 'shipped', 'in_transit', 'delivered'].includes(r.order.status))
    return res.status(400).json({ error: '此訂單目前無法申請退貨' });
  r.order.status = 'refund_requested';
  r.order.refundReason = String(req.body?.reason || '').slice(0, 200);
  r.order.refundRequestedAt = new Date().toISOString();
  await writeJson(ORDERS_FILE, r.orders);
  res.json({ ok: true, order: r.order });
});

// =================================================================
// Checkout + Payment + Email
// =================================================================
const mailTransporter = process.env.SMTP_USER && process.env.SMTP_PASS ? nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
}) : null;

async function sendOrderNotification(order) {
  if (!mailTransporter || !process.env.NOTIFICATION_EMAIL) return;
  const itemsHtml = order.items.map(it => `<li>${it.name} (${it.size}) x ${it.qty} - NT$${it.subtotal}</li>`).join('');
  const mailOptions = {
    from: `"YEBUDA Shop" <${process.env.SMTP_USER}>`,
    to: process.env.NOTIFICATION_EMAIL,
    subject: `[新訂單通知] 訂單編號 ${order.id} - NT$${order.total}`,
    html: `
      <h2>收到一筆新訂單！</h2>
      <p><strong>訂單編號：</strong> ${order.id}</p>
      <p><strong>顧客姓名：</strong> ${order.customer.name}</p>
      <p><strong>聯絡電話：</strong> ${order.customer.phone}</p>
      <p><strong>付款方式：</strong> ${order.payment.method}</p>
      <h3>購買明細：</h3>
      <ul>${itemsHtml}</ul>
      <p><strong>總計金額：</strong> NT$${order.total}</p>
      <hr>
      <p><a href="http://localhost:3000/admin/login.html">登入後台查看詳情</a></p>
    `
  };
  try {
    await mailTransporter.sendMail(mailOptions);
    console.log(`Email sent for order ${order.id}`);
  } catch(e) {
    console.error('Failed to send order email:', e);
  }
}

async function buildPendingOrder(sid, customer, payment, coupon = null) {
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
  const couponDiscount = coupon && coupon.type === 'fixed'
    ? Math.min(coupon.amount, subtotal)   // cap so total never goes below shipping
    : 0;
  const total = Math.max(0, subtotal + shipping - couponDiscount);
  const id = 'YB' + Date.now().toString().slice(-8) + crypto.randomInt(100, 999);
  return {
    id, createdAt: new Date().toISOString(),
    customer, items: lineItems, subtotal, shipping, total,
    couponDiscount,
    coupon: coupon ? { id: coupon.id, code: coupon.code, amount: coupon.amount, reason: coupon.reason } : null,
    payment, status: payment.method === 'card-mock' ? 'paid' : 'awaiting_payment'
  };
}

async function markCouponUsed(customerId, couponId, orderId) {
  if (!customerId || !couponId) return;
  const customers = await readJson(CUSTOMERS_FILE, []);
  const cust = customers.find(c => c.id === customerId);
  if (!cust) return;
  const c = (cust.coupons || []).find(x => x.id === couponId);
  if (c && !c.usedAt) {
    c.usedAt = new Date().toISOString();
    c.orderId = orderId;
    await writeJson(CUSTOMERS_FILE, customers);
  }
}

app.post('/api/checkout', async (req, res) => {
  const { name, phone, email, address, city, zip, payment, couponId,
          shippingMethod, cvsBrand, cvsStore, purchaser } = req.body || {};
  if (!name || !phone || !address || !payment) return res.status(400).json({ error: '請填寫完整收件資訊' });
  // Purchaser is optional but if provided must have name + phone
  if (purchaser && (!purchaser.name || !purchaser.phone)) {
    return res.status(400).json({ error: '訂購人姓名與電話為必填' });
  }
  if (shippingMethod === 'cvs' && (!cvsBrand || !cvsStore)) {
    return res.status(400).json({ error: '請填寫超商取貨資訊' });
  }
  if (payment === 'cvs-cod' && shippingMethod !== 'cvs') {
    return res.status(400).json({ error: '超商取貨付款僅限選擇超商取貨' });
  }

  // Validate coupon ownership via JWT (must be logged in to use a coupon)
  let authedCustomer = null;
  let appliedCoupon = null;
  if (couponId) {
    const h = req.headers.authorization || '';
    const decoded = h.startsWith('Bearer ') ? verifyToken(h.slice(7)) : null;
    if (!decoded) return res.status(401).json({ error: '使用折價券需要登入' });
    const customers = await readJson(CUSTOMERS_FILE, []);
    authedCustomer = customers.find(c => c.id === decoded.id);
    if (!authedCustomer) return res.status(401).json({ error: '帳號驗證失敗' });
    const c = (authedCustomer.coupons || []).find(x => x.id === couponId);
    if (!c) return res.status(400).json({ error: '找不到此折價券' });
    if (c.usedAt) return res.status(400).json({ error: '此折價券已使用過' });
    appliedCoupon = c;
  }

  try {
    const customer = { name, phone, email, address, city, zip };
    const shippingInfo = shippingMethod === 'cvs'
      ? { method: 'cvs', cvsBrand, cvsStore }
      : { method: 'address' };

    const finishOrder = async (order) => {
      // Attach structured shipping info so admin / orders dashboard can display it cleanly
      order.shipping = { ...(order.shipping || {}), ...shippingInfo };
      // Attach purchaser (orderer) if provided — recipient stays in order.customer for compat
      if (purchaser) order.purchaser = { name: purchaser.name, phone: purchaser.phone, email: purchaser.email || '' };
      const orders = await readJson(ORDERS_FILE, []);
      orders.unshift(order);
      await writeJson(ORDERS_FILE, orders);
      if (appliedCoupon && authedCustomer) {
        await markCouponUsed(authedCustomer.id, appliedCoupon.id, order.id);
      }
      await saveCart(req.sid, []);
      sendOrderNotification(order).catch(console.error);
      return orders;
    };

    if (payment === 'ecpay') {
      // Real credit card via ECPay — defer building the redirect page to a GET endpoint
      // so the customer's browser does a full-page navigation (avoids HTML-injection bugs).
      const order = await buildPendingOrder(req.sid, customer,
        { method: 'ecpay', status: 'pending' }, appliedCoupon);
      await finishOrder(order);
      res.json({ ok: true, ecpayUrl: `/api/ecpay/redirect/${order.id}`, order: { id: order.id } });
      return;
    }

    if (payment === 'cvs-cod') {
      // Pay-on-pickup at convenience store
      const order = await buildPendingOrder(req.sid, customer,
        { method: 'cvs-cod', status: 'pending' }, appliedCoupon);
      await finishOrder(order);
      res.json({ ok: true, order });
      return;
    }

    res.status(400).json({ error: '未知的付款方式' });
  } catch (e) {
    res.status(400).json({ error: e.message || 'checkout failed' });
  }
});

// =================================================================
// CVS map picker (ECPay 物流子站地圖)
// Browser flow:
//   popup → GET /api/cvs/map?brand=… → auto-POST form to ECPay
//   customer picks a store on ECPay's map
//   ECPay browser-POSTs back to /api/cvs/map-callback
//   callback page postMessage's the result back to the parent window
// =================================================================
const CVS_SUBTYPE = {
  '7-11': 'UNIMARTC2C',
  'unimart': 'UNIMARTC2C',
  '全家':   'FAMIC2C',
  'fami':   'FAMIC2C',
};
const CVS_BRAND_FROM_SUBTYPE = { UNIMARTC2C: '7-11', FAMIC2C: '全家' };

app.get('/api/cvs/map', (req, res) => {
  const brand = String(req.query.brand || '7-11');
  const subType = CVS_SUBTYPE[brand] || 'UNIMARTC2C';
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const replyUrl = `${baseUrl}/api/cvs/map-callback`;
  // ECPay logistics sandbox MerchantIDs:
  //   2000132 → B2C (商家批量寄貨到門市，需與超商簽約)
  //   2000933 → C2C 「店到店」(小店家直接寄到門市，新會員可申請)  ← 你想要的
  // 上正式環境請在 .env 設 ECPAY_LOGISTICS_MERCHANT_ID 為自己的綠界物流商家編號
  const merchantId = process.env.ECPAY_LOGISTICS_MERCHANT_ID || '2000933';
  const isMobile = /Mobi|iPhone|Android/i.test(req.headers['user-agent'] || '') ? '1' : '0';

  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="zh-TW"><head><meta charset="UTF-8"><title>選擇門市…</title>
<style>body{font-family:sans-serif;text-align:center;padding:60px 20px;color:#666}</style></head>
<body>
<p>正在開啟 ${brand} 門市地圖…</p>
<form id="ecpayForm" method="POST" action="https://logistics.ecpay.com.tw/Express/map">
  <input type="hidden" name="MerchantID" value="${merchantId}">
  <input type="hidden" name="LogisticsType" value="CVS">
  <input type="hidden" name="LogisticsSubType" value="${subType}">
  <input type="hidden" name="IsCollection" value="N">
  <input type="hidden" name="ServerReplyURL" value="${replyUrl}">
  <input type="hidden" name="ExtraData" value="">
  <input type="hidden" name="Device" value="${isMobile}">
</form>
<script>document.getElementById('ecpayForm').submit();</script>
</body></html>`);
});

app.post('/api/cvs/map-callback', (req, res) => {
  const d = req.body || {};
  const brand = CVS_BRAND_FROM_SUBTYPE[d.LogisticsSubType] || '';
  const store = {
    brand,
    subType: d.LogisticsSubType || '',
    storeId: d.CVSStoreID || '',
    storeName: d.CVSStoreName || '',
    address: d.CVSAddress || '',
    tel: d.CVSTelephone || '',
  };
  const json = JSON.stringify(store).replace(/</g, '\\u003c');
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="zh-TW"><head><meta charset="UTF-8"><title>已選擇門市</title>
<style>body{font-family:sans-serif;text-align:center;padding:60px 20px}h2{color:#3b7a57}p{color:#666;margin-top:8px}</style></head>
<body>
<h2>✓ 已選擇門市</h2>
<p>${brand} ${store.storeName}</p>
<p style="font-size:12px;color:#999">${store.address}</p>
<p style="margin-top:24px;font-size:13px;color:#999">即將返回結帳頁…</p>
<script>
  (function(){
    var data = ${json};
    var msg = { type: 'cvs-store-selected', data: data };
    try {
      // Iframe mode: tell parent window
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(msg, '*');
        return;
      }
      // Popup fallback (legacy): tell opener
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage(msg, '*');
        setTimeout(function(){ try { window.close(); } catch(e){} }, 600);
      }
    } catch(e) {}
  })();
</script>
</body></html>`);
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

// Auto-submit page that POSTs to ECPay. The customer's browser navigates here
// via window.location.href = '/api/ecpay/redirect/:orderId' — a full-page navigation
// (avoids HTML-injection-into-body bugs).
app.get('/api/ecpay/redirect/:orderId', async (req, res) => {
  const orders = await readJson(ORDERS_FILE, []);
  const order = orders.find(o => o.id === req.params.orderId);
  if (!order) return res.status(404).send('找不到訂單');
  if (order.payment?.method !== 'ecpay') return res.status(400).send('此訂單非信用卡結帳');

  // Use the actual host the customer connected to so callbacks resolve back here
  // (works for localhost, 192.168.x.x LAN, or production domain alike)
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const { tradeNo, html } = buildCheckoutPage(order, baseUrl);

  // Persist the tradeNo on first visit so the server-to-server callback can match
  if (!order.payment.ecpayTradeNo) {
    order.payment.ecpayTradeNo = tradeNo;
    await writeJson(ORDERS_FILE, orders);
  }

  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
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

// AI: classify a product image (admin)
// Accepts either { imageUrl } pointing to an /uploads/... path, or a multipart upload with field "image".
app.get('/api/admin/ai-status', requireAdmin, (_req, res) => {
  res.json({ available: aiAvailable() });
});

const aiUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('僅支援 JPG / PNG / WEBP / GIF'));
  },
});

app.post('/api/admin/classify', requireAdmin, (req, res) => {
  aiUpload.single('image')(req, res, async (uploadErr) => {
    if (uploadErr) return res.status(400).json({ error: uploadErr.message });
    if (!aiAvailable()) {
      return res.status(503).json({ error: '尚未設定 GEMINI_API_KEY。請到 aistudio.google.com/apikey 取得免費 API key 並加到 .env 檔案。' });
    }
    try {
      let imageBase64, mediaType;

      if (req.file) {
        imageBase64 = req.file.buffer.toString('base64');
        mediaType = req.file.mimetype;
      } else if (req.body?.imageUrl) {
        const url = String(req.body.imageUrl);
        if (!url.startsWith('/uploads/')) return res.status(400).json({ error: '只接受 /uploads/ 內的圖片' });
        const fname = path.basename(url.replace(/^\/uploads\//, ''));
        const fpath = path.join(UPLOAD_DIR, fname);
        const buf = await fs.readFile(fpath);
        imageBase64 = buf.toString('base64');
        const ext = path.extname(fname).toLowerCase();
        mediaType = ext === '.png' ? 'image/png'
                  : ext === '.webp' ? 'image/webp'
                  : ext === '.gif' ? 'image/gif'
                  : 'image/jpeg';
      } else {
        return res.status(400).json({ error: '請提供 image 檔案或 imageUrl' });
      }

      const result = await classifyProductImage({ imageBase64, mediaType });
      res.json({ ok: true, ...result });
    } catch (e) {
      const status = e.code === 'NO_API_KEY' ? 503
                   : e.status === 429 ? 429
                   : e.status && e.status >= 400 && e.status < 600 ? e.status
                   : 500;
      res.status(status).json({
        error: e.message || 'AI 辨識失敗',
        retryAfterMs: e.retryAfterMs || 0,
      });
    }
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
const HOST = process.env.HOST || '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log(`\n  YEBUDA shop  ⟶  http://localhost:${PORT}`);
  console.log(`  Admin login  ⟶  http://localhost:${PORT}/admin/login.html`);
  console.log(`  Default password: ${adminPassword()}${process.env.ADMIN_PASSWORD ? '' : ' (set ADMIN_PASSWORD env var for production)'}`);
  console.log(`  ECPay mode:  ${process.env.ECPAY_ENV === 'production' ? 'PRODUCTION' : 'STAGE (test)'}`);
  // Print LAN IPs so phone testing on the same Wi-Fi is one tap away
  try {
    const nets = Object.entries(os.networkInterfaces()).flatMap(([name, addrs]) =>
      (addrs || []).filter(a => a.family === 'IPv4' && !a.internal).map(a => ({ name, addr: a.address })));
    if (nets.length) {
      console.log('  Phone (same Wi-Fi):');
      nets.forEach(n => console.log(`     http://${n.addr}:${PORT}    (${n.name})`));
    }
    console.log();
  } catch {}
});
