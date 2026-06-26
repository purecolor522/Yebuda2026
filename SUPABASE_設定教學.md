# YEBUDA × Supabase 設定教學

照著做就能把網站從「本機 JSON 檔」切換成「Supabase 雲端資料庫 + 圖片儲存」，上線後資料不會掉。

---

## 第 1 步：建立 Supabase 專案（免費）

1. 打開 https://supabase.com → 點 **Start your project** → 用 GitHub 或 Email 登入。
2. 點 **New project**：
   - **Name**：`yebuda`（隨意）
   - **Database Password**：設一組密碼，**記下來**（之後備份/進階操作會用到）。
   - **Region**：選 **Northeast Asia (Tokyo)** 或 **Singapore**（離台灣近、速度快）。
   - 方案選 **Free** 即可。
3. 按 **Create new project**，等約 1～2 分鐘建立完成。

---

## 第 2 步：建立資料表 + 圖片儲存空間

1. 左側選單點 **SQL Editor** → **New query**。
2. 打開本專案的 [supabase/schema.sql](supabase/schema.sql)，把裡面**全部內容**複製貼上。
3. 按右下角 **Run**。看到成功訊息即可（這會建立 `app_data` 資料表和 `product-images` 圖片空間）。

---

## 第 3 步：拿到網址和金鑰

1. 左下角 **Project Settings**（齒輪）→ **API**。
2. 複製這兩個值：
   - **Project URL** → 例如 `https://abcdxyz.supabase.co`
   - **Project API keys** 裡的 **`service_role`**（點 Reveal 顯示）→ 這是機密金鑰，**只放在伺服器，絕對不要外洩或放進前端**。

> 把這兩個值傳給我（或自己貼進 `.env`），我就幫你完成接線。

---

## 第 4 步：填進 .env

打開專案根目錄的 `.env`，填入：

```env
SUPABASE_URL=https://你的專案.supabase.co
SUPABASE_SERVICE_KEY=貼上 service_role 金鑰
SUPABASE_BUCKET=product-images
```

> 留空 = 繼續用本機 JSON 檔（適合開發測試）。填了 = 自動切換到 Supabase。

---

## 第 5 步：把現有 37 筆商品搬進去

在專案資料夾執行一次：

```bash
node scripts/migrate-to-supabase.js
```

成功會看到 `✓ products: 37 item(s) uploaded`。

---

## 第 6 步：確認切換成功

```bash
npm start
```

啟動訊息裡若出現：

```
Data store:  Supabase (cloud) ✓
```

就代表已經在用 Supabase 了。打開 http://localhost:3000 應該看到一樣的 37 個商品（這次是從雲端讀的）。

---

## 上線到雲端（Fly.io / Render）時

把這三個環境變數設定到你的部署平台（**不要**把 `.env` 推上 GitHub）：

- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`
- `SUPABASE_BUCKET`（= `product-images`）

連同原本的 `ADMIN_PASSWORD`、`OWNER_PASSWORD`、ECPay、SMTP 等一起設定即可。

---

## 運作原理（給你了解）

- 原本 6 個 `data/*.json` 檔 → 變成 Supabase `app_data` 表裡的 6 列（products / orders / carts / customers / purchases / stock-adjustments），整份 JSON 存成一格。
- 後台新上傳的商品圖 → 傳到 Supabase Storage 的 `product-images`，回傳公開網址存進商品資料。
- 舊的 `LINE_ALBUM_*.jpg`（37 個商品用的圖）跟著程式碼一起部署，不受影響。
- 程式碼會自動判斷：有設定 Supabase 就走雲端，沒設定就走本機檔案——所以開發、上線共用同一套程式。

### 目前限制（誠實說明）
資料是「整份讀取、整份寫回」，和原本 JSON 檔行為一致。流量極大、多人同一秒下單時理論上可能有覆蓋風險，但對剛上線的小店可忽略。未來訂單量變大時，可再升級成「每筆訂單一列」的正規資料表，到時我可以幫你做。
