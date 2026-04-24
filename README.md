# YEBUDA · 首爾精選電商

正韓東大門選品 × Shopify 風格電商全棧。前台 + 後台 CMS + 金流 + 儀表板 + 部署一條龍。

![stack](https://img.shields.io/badge/Node-20+-3C873A) ![express](https://img.shields.io/badge/express-4-000) ![ecpay](https://img.shields.io/badge/ECPay-integrated-b8986a)

---

## ✨ 功能

### 🛍️ 前台 (Customer)
- 首頁 Hero 輪播、分類、Weekly Best、Editorial、New Arrival
- 商品列表（分類篩選 + 排序）、商品詳情頁（顏色/尺寸/數量、相關推薦）
- 購物車（Cookie-based session）、Checkout、訂單確認頁
- RWD 響應式設計

### 🧑‍💼 後台 (Admin · `/admin/`)
- 🔐 密碼保護 + 簽章 Cookie
- 📊 儀表板：總營收、本月營收、訂單數、客單價、30 日營收曲線、熱銷單品、最近訂單
- 📸 商品管理：多張照片上傳、CRUD、庫存、標籤、下架
- 🧾 訂單管理：狀態變更、物流單號、付款資訊

### 💳 金流：綠界 ECPay
- 信用卡 / Apple Pay / ATM / 超商繳費全支援
- 內建 stage 測試環境即開即用
- Server-to-server notify + browser redirect callback 已處理

### 🚀 部署
- Dockerfile + `.dockerignore`
- Render.com blueprint (`render.yaml`) 一鍵上線
- Fly.io 設定 (`fly.toml`)
- `.env.example` 範本

---

## 🏃 本機開發

```bash
npm install
cp .env.example .env      # 改 ADMIN_PASSWORD 等
npm start                 # 或 npm run dev（watch 模式）
```

打開 http://localhost:3000

- 前台：`http://localhost:3000/`
- 後台登入：`http://localhost:3000/admin/login.html`
- 預設密碼：`yebuda2026`

---

## 🔐 環境變數

| 變數 | 用途 | 預設值 |
|---|---|---|
| `PORT` | 伺服器 port | `3000` |
| `APP_BASE_URL` | 公開 HTTPS 網址（ECPay callback） | `http://localhost:3000` |
| `ADMIN_PASSWORD` | 後台密碼 | `yebuda2026` |
| `ADMIN_SECRET` | Cookie 簽章金鑰 | `yebuda-default-dev-secret-change-me` |
| `ECPAY_ENV` | `stage`（測試）或 `production` | `stage` |
| `ECPAY_MERCHANT_ID` | 綠界商店代號 | `3002607`（官方測試號） |
| `ECPAY_HASH_KEY` | 綠界 HashKey | 官方測試金鑰 |
| `ECPAY_HASH_IV` | 綠界 HashIV | 官方測試金鑰 |

**正式上線前務必更改：** `ADMIN_PASSWORD`、`ADMIN_SECRET`、`ECPAY_*`、`APP_BASE_URL`。

---

## 💳 綠界 ECPay 設定

### 測試模式（預設，立即可用）
什麼都不用設定，預設使用綠界官方提供的 **Stage 測試帳號**：
- 測試卡號：`4311-9522-2222-2222`（任何三位 CVC / 未來日期）
- 會模擬刷卡成功，不會真實扣款。

### 正式上線
1. 前往 [綠界 ECPay 官網](https://www.ecpay.com.tw/) 申請特約商店
2. 審核通過後，在後台取得：
   - `MerchantID`（商店代號）
   - `HashKey`
   - `HashIV`
3. 在後台「系統 → API 介接設定」
   - **付款完成通知回傳網址**：`https://你的網域/api/ecpay/notify`
   - **Client 端返回網址**：`https://你的網域/api/ecpay/return`
4. 把三組金鑰填入 `.env`（或部署平台的環境變數）
5. 將 `ECPAY_ENV` 設為 `production`

---

## ☁️ 部署到 Render.com（推薦，有免費方案）

1. 把這個 repo 推到 GitHub
2. 登入 [Render](https://render.com) → **New +** → **Blueprint**
3. 選擇你的 repo → Render 會讀 `render.yaml` 自動建立服務 + 1GB 持久化磁碟
4. 首次部署成功後，到服務設定頁把 `APP_BASE_URL` 改成 Render 給你的網址（如 `https://yebuda-shop.onrender.com`）
5. 到 ECPay 商店後台設定這個網址為 callback URL
6. 完成 ✅

**注意：** Free 方案閒置 15 分鐘會休眠，首次請求會有冷啟動 (~30s)。若要保持常駐，升級到 Starter ($7/月)。

---

## 🪂 部署到 Fly.io

```bash
# 安裝 flyctl: https://fly.io/docs/hands-on/install-flyctl/
fly launch --copy-config --no-deploy
fly volumes create yebuda_data --size 1 --region nrt
fly volumes create yebuda_uploads --size 1 --region nrt
fly secrets set ADMIN_PASSWORD=your-strong-password ADMIN_SECRET=$(openssl rand -hex 32)
fly secrets set APP_BASE_URL=https://yebuda-shop.fly.dev
fly deploy
```

---

## 🐳 自架 Docker

```bash
docker build -t yebuda .
docker run -d \
  -p 3000:3000 \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/uploads:/app/uploads \
  -e ADMIN_PASSWORD=your-password \
  -e ADMIN_SECRET=$(openssl rand -hex 32) \
  -e APP_BASE_URL=https://your-domain.com \
  --name yebuda yebuda
```

建議搭配 Nginx / Caddy 做 HTTPS 反向代理（ECPay 要求 HTTPS）。

---

## 📂 專案結構

```
pure/
├── server.js              · Express 主程式
├── lib/
│   ├── auth.js            · 後台 Cookie 簽章
│   └── ecpay.js           · 綠界金流
├── data/
│   ├── products.json      · 商品資料 (受版控)
│   ├── orders.json        · 訂單 (runtime)
│   └── carts.json         · 購物車 session (runtime)
├── uploads/               · 後台上傳的商品照片 (runtime)
├── public/
│   ├── index.html / shop.html / product.html / cart.html / checkout.html / order.html
│   ├── css/style.css
│   ├── js/ (app.js + 各頁 module)
│   └── admin/
│       ├── login.html / index.html / products.html / product-edit.html / orders.html
│       ├── admin.css
│       └── js/ (admin-app / dashboard / products / product-edit / orders)
├── Dockerfile · render.yaml · fly.toml · .env.example · .gitignore
└── LINE_ALBUM_*.jpg       · 原始產品照片 (serve as /media/*)
```

---

## 🧪 開發測試

```bash
# 跑一個完整的訂單流程（測試購物車 → 結帳 → 訂單建立 → 後台查詢）
CJ=$(mktemp)
curl -s -c "$CJ" -b "$CJ" -X POST http://localhost:3000/api/cart \
  -H "Content-Type: application/json" \
  -d '{"productId":"y010","qty":1,"size":"M","color":"駝色"}'
curl -s -c "$CJ" -b "$CJ" http://localhost:3000/api/cart
```

信用卡測試資料 (mock mode)：`4242 4242 4242 4242` / `12/28` / `123`

---

## 📜 授權

此專案是為 YEBUDA 客製開發。素材版權屬於原持有者。
