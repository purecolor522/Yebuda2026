import { GoogleGenAI, Type } from '@google/genai';

// Categories must match the admin product-edit form's category options.
const CATEGORIES = ['outer', 'blouse', 'tee', 'knit', 'dress', 'pants', 'set'];

// Gemini's responseSchema uses uppercase Type.* enums (OBJECT, STRING, ARRAY, ...)
// Documented at https://ai.google.dev/gemini-api/docs/structured-output
const RESULT_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    name: {
      type: Type.STRING,
      description:
        '中文商品名稱，6-14 個字。要有 YEBUDA 韓系女裝品牌的氣質與韻味，融合材質、版型、風格關鍵字（如：千金、氣質、慵懶、復古、輕奢、法式）。例如：「千金風氣質羊毛大衣」、「微醺女郎絲緞洋裝」、「冷淡風落肩針織上衣」。避免機械式描述。',
    },
    subtitle: {
      type: Type.STRING,
      description: '英文副標題，全大寫，2-5 個英文字。例如：CASHMERE LONG COAT、SILK MIDI DRESS。',
    },
    category: {
      type: Type.STRING,
      enum: CATEGORIES,
      description:
        '商品分類。outer=外套大衣風衣；blouse=襯衫；tee=針織T或棉T；knit=毛衣針織衫；dress=洋裝連身裙；pants=長褲短褲褲裙；set=兩件式套裝。',
    },
    description: {
      type: Type.STRING,
      description: '一段 40-80 字的中文商品介紹，描述材質、版型、適合場合、穿搭建議。語氣優雅、不浮誇。',
    },
    suggestedColors: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: '從照片觀察到的顏色，中文命名（如：奶油白、駝色、墨黑、淺灰）。最多 3 個。',
    },
    suggestedSizes: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: '建議的尺寸列表。一般版型用 ["S","M","L"]；Oversize 或 FreeSize 用 ["FREE"]；下身褲類用 ["S","M","L","XL"]。',
    },
  },
  required: ['name', 'subtitle', 'category', 'description', 'suggestedColors', 'suggestedSizes'],
  propertyOrdering: ['name', 'subtitle', 'category', 'description', 'suggestedColors', 'suggestedSizes'],
};

const SYSTEM_INSTRUCTION = `你是 YEBUDA 漂亮小姐（韓系女裝精品電商）的商品文案編輯。
看到商品照片時，請：
1. 辨識商品類型並歸類到指定分類之一。
2. 為它命名一個有韻味、有氣質的中文商品名（不要太普通，融合風格詞）。
3. 寫一段優雅的商品介紹文案。
4. 觀察並命名照片中的顏色。
5. 依商品類別建議合理的尺寸選項。

只回應符合 schema 的 JSON。`;

export function isAvailable() {
  return Boolean(process.env.GEMINI_API_KEY);
}

/**
 * Translate a raw Gemini SDK error into a friendly Chinese message + a retry hint.
 * Returns { message, retryAfterMs, code }.
 */
function parseGeminiError(err) {
  const raw = String(err?.message || err || '');
  // Try to extract embedded JSON from the SDK's error message
  let payload = null;
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (jsonMatch) { try { payload = JSON.parse(jsonMatch[0]); } catch {} }
  const code = payload?.error?.code || err?.status || 0;
  const status = payload?.error?.status || '';

  if (code === 429 || status === 'RESOURCE_EXHAUSTED') {
    // Find the suggested retry delay in the error details
    let retryAfterMs = 30_000; // default 30s
    const details = payload?.error?.details || [];
    const retry = details.find(d => d['@type']?.includes('RetryInfo'));
    if (retry?.retryDelay) {
      const m = String(retry.retryDelay).match(/^(\d+(?:\.\d+)?)s$/);
      if (m) retryAfterMs = Math.ceil(parseFloat(m[1]) * 1000);
    }
    return {
      message: `Gemini 免費額度暫時用完（每分鐘 10-15 次上限），${Math.ceil(retryAfterMs / 1000)} 秒後重試`,
      retryAfterMs,
      code: 429,
    };
  }
  if (code === 503 || status === 'UNAVAILABLE') {
    return { message: 'Gemini 服務暫時無法使用，稍後再試', retryAfterMs: 5000, code: 503 };
  }
  if (code === 400 || status === 'INVALID_ARGUMENT') {
    return { message: '圖片格式不支援或太大，請換一張', retryAfterMs: 0, code: 400 };
  }
  if (code === 401 || code === 403 || status === 'PERMISSION_DENIED') {
    return { message: 'GEMINI_API_KEY 無效或權限不足，請檢查 .env 設定', retryAfterMs: 0, code: 403 };
  }
  return { message: 'AI 辨識失敗，請再試一次', retryAfterMs: 0, code: 500 };
}

/**
 * Classify a product image and generate name, category, description, etc.
 * Uses Gemini 2.5 Flash (free tier: ~10-15 RPM / 250-1500 RPD).
 * Automatically retries once on 429 / 503 errors with the API-suggested delay.
 */
export async function classifyProductImage({ imageBase64, mediaType }) {
  if (!isAvailable()) {
    const err = new Error('尚未設定 GEMINI_API_KEY。請到 aistudio.google.com/apikey 取得免費 API key 並加到 .env 檔案。');
    err.code = 'NO_API_KEY';
    throw err;
  }

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  const callOnce = () => ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [{
      role: 'user',
      parts: [
        { inlineData: { mimeType: mediaType, data: imageBase64 } },
        { text: '辨識這張商品照片，輸出符合 schema 的 JSON。' },
      ],
    }],
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      responseMimeType: 'application/json',
      responseSchema: RESULT_SCHEMA,
      thinkingConfig: { thinkingBudget: 0 },
    },
  });

  let response;
  try {
    response = await callOnce();
  } catch (err) {
    const info = parseGeminiError(err);
    // Auto-retry once for transient errors (rate limit / unavailable)
    if ((info.code === 429 || info.code === 503) && info.retryAfterMs > 0 && info.retryAfterMs <= 60_000) {
      console.log(`[ai-classify] ${info.code} — retrying in ${info.retryAfterMs}ms`);
      await new Promise(r => setTimeout(r, info.retryAfterMs));
      try { response = await callOnce(); }
      catch (err2) {
        const info2 = parseGeminiError(err2);
        const e = new Error(info2.message);
        e.status = info2.code;
        e.retryAfterMs = info2.retryAfterMs;
        throw e;
      }
    } else {
      const e = new Error(info.message);
      e.status = info.code;
      e.retryAfterMs = info.retryAfterMs;
      throw e;
    }
  }

  const text = response.text;
  if (!text) throw new Error('AI 沒有回傳結果，請再試一次');

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('AI 回傳的內容無法解析，請再試一次');
  }

  if (!CATEGORIES.includes(parsed.category)) parsed.category = 'outer';

  return {
    ...parsed,
    usage: response.usageMetadata,
  };
}
