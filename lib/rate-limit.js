/**
 * Tiny in-memory rate limiter for login endpoints.
 * Keyed by (route, IP). 5 failed attempts in 15 min → block 15 min.
 * Successful login clears the counter for that key.
 *
 * Note: in-memory means counter resets on server restart. That's acceptable —
 * fly.io machines rarely restart, and a restart actually slightly reduces an
 * attacker's window. For multi-instance setups you'd swap this for Redis.
 */
const WINDOW_MS = 15 * 60 * 1000;   // 15 minutes
const MAX_ATTEMPTS = 5;

const buckets = new Map(); // key → { attempts: [...timestamps], blockedUntil: number }

function clientIp(req) {
  // fly.io sets x-forwarded-for; trust proxy is already enabled in server.js
  return (req.ip || req.connection?.remoteAddress || 'unknown').toString();
}

function key(route, req) { return `${route}::${clientIp(req)}`; }

export function checkRateLimit(route) {
  return function (req, res, next) {
    const k = key(route, req);
    const now = Date.now();
    const b = buckets.get(k);
    if (b && b.blockedUntil && now < b.blockedUntil) {
      const wait = Math.ceil((b.blockedUntil - now) / 1000);
      res.set('Retry-After', String(wait));
      return res.status(429).json({
        error: `登入嘗試太多次，請等 ${Math.ceil(wait / 60)} 分鐘後再試`,
      });
    }
    next();
  };
}

export function recordFailure(route, req) {
  const k = key(route, req);
  const now = Date.now();
  let b = buckets.get(k);
  if (!b) { b = { attempts: [], blockedUntil: 0 }; buckets.set(k, b); }
  // Drop attempts older than the window
  b.attempts = b.attempts.filter(t => now - t < WINDOW_MS);
  b.attempts.push(now);
  if (b.attempts.length >= MAX_ATTEMPTS) {
    b.blockedUntil = now + WINDOW_MS;
    console.warn(`[rate-limit] BLOCKED ${k} for ${WINDOW_MS / 60000}min after ${MAX_ATTEMPTS} failed attempts`);
  }
}

export function recordSuccess(route, req) {
  buckets.delete(key(route, req));
}
