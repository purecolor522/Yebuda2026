/**
 * Minimal admin auth via signed HMAC cookie.
 * Shared password (ADMIN_PASSWORD) + 30-day signed cookie.
 *
 * Privilege hierarchy: owner ≥ admin. Anyone holding a valid owner cookie
 * automatically passes admin checks (so a logged-in owner can browse the
 * employee back-office without re-typing the admin password).
 */
import crypto from 'node:crypto';
import { isOwner } from './owner-auth.js';

const COOKIE = 'yebuda_admin';
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

function secret() {
  return process.env.ADMIN_SECRET || 'yebuda-default-dev-secret-change-me';
}
export function adminPassword() {
  return process.env.ADMIN_PASSWORD || 'yebuda2026';
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

export function issueAdminCookie(res) {
  const payload = `admin|${Date.now() + TTL_MS}`;
  const signed = sign(payload);
  res.setHeader('Set-Cookie', [
    (res.getHeader('Set-Cookie') || []),
    `${COOKIE}=${signed}; Path=/; Max-Age=${TTL_MS / 1000}; HttpOnly; SameSite=Lax`
  ].flat());
}
export function clearAdminCookie(res) {
  res.setHeader('Set-Cookie', [
    (res.getHeader('Set-Cookie') || []),
    `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`
  ].flat());
}

export function requireAdmin(req, res, next) {
  const cookies = parseCookies(req.headers.cookie);
  const sess = verify(cookies[COOKIE]);
  if (sess) { req.admin = sess; return next(); }
  // Owner outranks admin — let them through with a synthesized admin context
  if (isOwner(req)) { req.admin = { user: 'owner-as-admin', viaOwner: true }; return next(); }
  return res.status(401).json({ error: 'AUTH_REQUIRED' });
}

export function isAdmin(req) {
  const cookies = parseCookies(req.headers.cookie);
  if (verify(cookies[COOKIE])) return true;
  return isOwner(req);   // owner cookie also satisfies admin
}
