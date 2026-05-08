/**
 * ECPay (綠界) AIO checkout integration.
 *
 * Usage (test-mode credentials ship by default — override via env vars for production):
 *   ECPAY_MERCHANT_ID=3002607
 *   ECPAY_HASH_KEY=pwFHCqoQZGmho4w6
 *   ECPAY_HASH_IV=EkRm7iFT261dpevs
 *   ECPAY_ENV=stage   # stage | production
 *   APP_BASE_URL=https://your-domain.com
 *
 * Flow:
 *   1. Server builds form params + CheckMacValue.
 *   2. Frontend auto-submits POST form to ECPay AIO endpoint.
 *   3. ECPay redirects user to ReturnURL (server-to-server) and OrderResultURL (browser).
 *
 * Docs: https://developers.ecpay.com.tw/?p=2509
 */
import crypto from 'node:crypto';

const STAGE_ENDPOINT = 'https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5';
const PROD_ENDPOINT  = 'https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5';

function cfg(overrideBaseUrl) {
  return {
    merchantID: process.env.ECPAY_MERCHANT_ID || '3002607',
    hashKey:    process.env.ECPAY_HASH_KEY    || 'pwFHCqoQZGmho4w6',
    hashIV:     process.env.ECPAY_HASH_IV     || 'EkRm7iFT261dpevs',
    endpoint:   (process.env.ECPAY_ENV === 'production') ? PROD_ENDPOINT : STAGE_ENDPOINT,
    baseUrl:    overrideBaseUrl || process.env.APP_BASE_URL || 'http://localhost:3000'
  };
}

// ECPay uses .NET-style HttpUtility.UrlEncode + lowercase hex.
// Per the official .NET reference impl:
//   - space → '+'
//   - keep literal: ! * ( ) -  _  .  ~
//   - everything else: percent-encoded lowercase
function ecpayUrlEncode(s) {
  return encodeURIComponent(s)
    .replace(/%20/g, '+')
    // encodeURIComponent already keeps !*()'~_.- literal, which is what ECPay expects.
    // Lowercase the percent escapes only.
    .replace(/%[0-9A-F]{2}/g, m => m.toLowerCase());
}

function checkMacValue(params, hashKey, hashIV) {
  const sorted = Object.keys(params).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  const joined = sorted.map(k => `${k}=${params[k]}`).join('&');
  const raw = `HashKey=${hashKey}&${joined}&HashIV=${hashIV}`;
  const encoded = ecpayUrlEncode(raw).toLowerCase();
  return crypto.createHash('sha256').update(encoded).digest('hex').toUpperCase();
}

/** Build ECPay AIO params + auto-submit HTML page.
 *  Pass baseUrl from req (e.g. http://192.168.0.150:3000) so callbacks resolve
 *  to the same host the customer's browser is on, not localhost. */
export function buildCheckoutPage(order, baseUrl) {
  const c = cfg(baseUrl);
  const tradeNo = 'YB' + Date.now().toString().slice(-10);
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const tradeDate = `${now.getFullYear()}/${pad(now.getMonth() + 1)}/${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  const itemName = order.items
    .map(it => `${it.name} x${it.qty}`)
    .join('#')
    .slice(0, 400); // ECPay max 400

  const params = {
    MerchantID:      c.merchantID,
    MerchantTradeNo: tradeNo,
    MerchantTradeDate: tradeDate,
    PaymentType:     'aio',
    TotalAmount:     String(order.total),
    TradeDesc:       'YEBUDA Apparel Order',
    ItemName:        itemName,
    ReturnURL:       `${c.baseUrl}/api/ecpay/notify`,
    OrderResultURL:  `${c.baseUrl}/api/ecpay/return`,
    ClientBackURL:   `${c.baseUrl}/order.html?id=${order.id}`,
    ChoosePayment:   'ALL',
    EncryptType:     '1',
    CustomField1:    order.id
  };
  params.CheckMacValue = checkMacValue(params, c.hashKey, c.hashIV);

  const formFields = Object.entries(params)
    .map(([k, v]) => `<input type="hidden" name="${k}" value="${String(v).replace(/"/g, '&quot;')}">`)
    .join('\n');

  const html = `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>前往綠界付款中...</title>
<style>
  body { font-family: system-ui, "Noto Sans TC", sans-serif;
         background: #faf7f2; color: #2c2a26;
         display: flex; align-items: center; justify-content: center;
         min-height: 100vh; margin: 0; padding: 20px; }
  .box { text-align: center; max-width: 420px; }
  .spin {
    width: 40px; height: 40px; margin: 0 auto 20px;
    border: 3px solid #e6ddd0; border-top-color: #b8986a;
    border-radius: 50%; animation: r 0.8s linear infinite;
  }
  @keyframes r { to { transform: rotate(360deg); } }
  .pay-btn { display:inline-block; margin-top:20px; padding:14px 32px;
             background:#2c2a26; color:#fff; border:none; cursor:pointer;
             font-size:14px; letter-spacing:2px; border-radius:4px; }
  .pay-btn:hover { background:#b8986a; }
</style>
</head>
<body>
  <form id="ecpayForm" method="POST" action="${c.endpoint}" accept-charset="UTF-8" target="_top">
    ${formFields}
    <div class="box">
      <div class="spin"></div>
      <h2 style="font-weight:500;letter-spacing:0.1em;">轉跳至綠界金流中…</h2>
      <p style="color:#6a6257;font-size:13px;line-height:1.7;">系統正在引導您前往綠界 ECPay 完成付款<br>請勿關閉視窗</p>
      <button type="submit" class="pay-btn">如未自動跳轉，請點此繼續</button>
    </div>
  </form>
  <script>
    // Submit immediately on load — no delay, no timing race
    (function(){
      var f = document.getElementById('ecpayForm');
      if (f && typeof f.submit === 'function') {
        try { f.submit(); } catch(e) { console.error('ECPay submit failed:', e); }
      }
    })();
  </script>
</body>
</html>`;

  return { tradeNo, html };
}

export function verifyCallback(params) {
  const c = cfg();
  const { CheckMacValue, ...rest } = params;
  const expected = checkMacValue(rest, c.hashKey, c.hashIV);
  return expected === CheckMacValue;
}

export function isEnabled() {
  return Boolean(process.env.ECPAY_MERCHANT_ID); // production requires explicit opt-in
}
