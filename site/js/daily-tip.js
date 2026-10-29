/* ============================================================
   daily-tip.js — «نصيحة اليوم» المولّدة بالذكاء الاصطناعي
   ------------------------------------------------------------
   التدفّق:
     1) إن وُجدت نصيحة محفوظة لتاريخ اليوم → تُعرض فوراً (طلب واحد يومياً).
     2) وإلا: نختار محور اليوم ← نطلب من النموذج نصيحة بصيغة JSON
        ← نتحقّق من الرد (validateTip) ← نحفظه ونعرضه.
     3) أي فشل (شبكة، مهلة، رد غير صالح) ← نصيحة من المكتبة المحلية.

   أمان مخرجات النموذج: لا نثق بالرد. نرفض أي نص فيه روابط أو
   وسوم HTML أو أرقام هواتف غير رسمية، ونعرضه عبر textContent فقط.
   ============================================================ */
import { TOPICS, LOCAL_TIPS } from './tips-data.js';

/* ---------- دوال نقية (قابلة للاختبار) ---------- */

export function todayKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function dayIndex(d = new Date()) {
  const start = Date.UTC(d.getFullYear(), 0, 0);
  const now = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.floor((now - start) / 86400000) + d.getFullYear() * 366;
}

export function topicFor(d = new Date(), offset = 0) {
  return TOPICS[(dayIndex(d) + offset) % TOPICS.length];
}

export function localTipFor(d = new Date(), offset = 0) {
  const t = LOCAL_TIPS[(dayIndex(d) + offset) % LOCAL_TIPS.length];
  return { ...t, source: 'local' };
}

export function buildPrompt(topic) {
  return [
    'أنت خبير توعية بالأمن السيبراني لجمهور سعودي عام.',
    `اكتب نصيحة يومية واحدة جديدة وعملية عن: «${topic}».`,
    'الشروط: عربية فصحى بسيطة، دقيقة علمياً، بدون روابط، بدون أرقام هواتف',
    '(إلا 330330 أو 1909 عند الحاجة)، بدون إيموجي.',
    'أعد JSON فقط بلا أي نص قبله أو بعده وبهذا الشكل بالضبط:',
    '{"title":"عنوان قصير حتى 6 كلمات","tip":"شرح في جملة أو جملتين حتى 40 كلمة","action":"خطوة واحدة ينفّذها القارئ اليوم حتى 25 كلمة"}',
  ].join('\n');
}

const ALLOWED_NUMBERS = ['330330', '1909'];

/* يستخرج JSON من رد النموذج ويتحقّق منه؛ يعيد null إن لم يكن صالحاً */
export function validateTip(raw) {
  if (raw == null) return null;
  let obj = raw;
  if (typeof raw === 'string') {
    const m = raw.replace(/```(?:json)?/gi, '').match(/\{[\s\S]*\}/);
    if (!m) return null;
    try { obj = JSON.parse(m[0]); } catch { return null; }
  }
  if (typeof obj !== 'object') return null;

  const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
  const tip = { title: clean(obj.title), tip: clean(obj.tip), action: clean(obj.action) };

  const all = `${tip.title} ${tip.tip} ${tip.action}`;
  if (!tip.title || !tip.tip || !tip.action) return null;
  if (tip.title.length > 70 || tip.tip.length > 320 || tip.action.length > 220) return null;
  if (!/[؀-ۿ]/.test(all)) return null;                              // يجب أن يكون عربياً
  if (/(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|sa|io|xyz|ly)\b)/i.test(all)) return null; // لا روابط
  if (/[<>]/.test(all)) return null;                                          // لا وسوم
  const nums = all.match(/\d{5,}/g) || [];
  if (nums.some(n => !ALLOWED_NUMBERS.includes(n))) return null;              // لا أرقام هواتف مجهولة
  return tip;
}

/* ---------- المزوّدات ---------- */

function withTimeout(ms) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return { signal: c.signal, done: () => clearTimeout(t) };
}

async function fromPollinations(cfg, prompt, seed, timeoutMs) {
  const t = withTimeout(timeoutMs);
  try {
    const url = `${cfg.url}${encodeURIComponent(prompt)}?model=${encodeURIComponent(cfg.model)}&json=true&seed=${seed}&private=true`;
    const r = await fetch(url, { signal: t.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.text();
  } finally { t.done(); }
}

async function fromGeminiProxy(cfg, prompt, seed, timeoutMs, topic) {
  const t = withTimeout(timeoutMs);
  try {
    const r = await fetch(cfg.url, {
      method: 'POST', signal: t.signal,
      headers: { 'Content-Type': 'application/json', ...(cfg.key ? { apikey: cfg.key } : {}) },
      body: JSON.stringify({ prompt, topic }),
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();
    return d.text;
  } finally { t.done(); }
}

export const PROVIDERS = [
  { id: 'pollinations', label: 'Pollinations AI', ready: (c) => c.pollinations?.enabled && c.pollinations.url, run: (c, p, s) => fromPollinations(c.pollinations, p, s, c.timeoutMs) },
  { id: 'gemini',       label: 'Google Gemini',   ready: (c) => c.geminiProxy?.enabled && c.geminiProxy.url, run: (c, p, s, topic) => fromGeminiProxy(c.geminiProxy, p, s, c.timeoutMs, topic) },
];

/* يجرّب المزوّدات بالترتيب ثم يرجع للمكتبة المحلية */
export async function generateTip(config, { date = new Date(), offset = 0, fetchImpl } = {}) {
  const topic = topicFor(date, offset);
  const prompt = buildPrompt(topic);
  const seed = dayIndex(date) * 10 + offset;
  const restore = fetchImpl ? swapFetch(fetchImpl) : null;
  try {
    for (const p of PROVIDERS) {
      if (!p.ready(config)) continue;
      try {
        const tip = validateTip(await p.run(config, prompt, seed, topic));
        if (tip) return { ...tip, topic, source: 'ai', provider: p.label };
      } catch { /* جرّب المزوّد التالي */ }
    }
  } finally { if (restore) restore(); }
  return { ...localTipFor(date, offset), topic };
}

function swapFetch(f) { const old = globalThis.fetch; globalThis.fetch = f; return () => { globalThis.fetch = old; }; }
