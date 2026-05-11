/**
 * Owner-level auth — completely separate from staff admin.
 *
 * Owner sees inventory + accounting; staff (admin) only sees orders + products.
 * Different password (OWNER_PASSWORD) + different cookie + different middleware.
 */
import crypto from 'node:crypto';

const COOKIE = 'yebuda_owner';
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

function secret() {
  // Distinct from ADMIN_SECRET — if you ever leak the staff secret, owner cookie stays valid
  return process.env.OWNER_SECRET || process.env.ADMIN_SECRET || 'yebuda-default-dev-secret-change-me';
}
export function ownerPassword() {
  return process.env.OWNER_PASSWORD || 'yebuda-owner-2026';
}

function sign(payload) {
  const h = crypto.createHmac('sha256', secret()).update(payload).digest('hex');
  return `${payload}.${h}`;
}
function verify(signed) {
  if (typeof signed !== 'string' || !signed.includes('.')) return null;
  const idx = signed.lastIndexOf('.');
  const payload = signed.slice(0, idx);
  const sig = signed.slice(idx + 1);
  const expect = crypto.createHmac('sha256', secret()).update(payload).digest('hex');
  if (expect.length !== sig.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(expect), Buffer.from(sig))) return null;
  const parts = payload.split('|');
  const exp = Number(parts[1]);
  if (!exp || Date.now() > exp) return null;
  return { user: parts[0], exp };
}

function parseCookies(header) {
  return Object.fromEntries(
    (header || '').split(';').map(s => s.trim().split('=')).filter(p => p[0])
  );
}

export function issueOwnerCookie(res) {
  const payload = `owner|${Date.now() + TTL_MS}`;
  const signed = sign(payload);
  res.setHeader('Set-Cookie', [
    (res.getHeader('Set-Cookie') || []),
    `${COOKIE}=${signed}; Path=/; Max-Age=${TTL_MS / 1000}; HttpOnly; SameSite=Lax`
  ].flat());
}
export function clearOwnerCookie(res) {
  res.setHeader('Set-Cookie', [
    (res.getHeader('Set-Cookie') || []),
    `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`
  ].flat());
}

export function requireOwner(req, res, next) {
  const cookies = parseCookies(req.headers.cookie);
  const sess = verify(cookies[COOKIE]);
  if (!sess) return res.status(401).json({ error: 'OWNER_AUTH_REQUIRED' });
  req.owner = sess;
  next();
}

export function isOwner(req) {
  const cookies = parseCookies(req.headers.cookie);
  return Boolean(verify(cookies[COOKIE]));
}
