/* ============================================================
   storage.js — طبقة تخزين محلية آمنة
   ------------------------------------------------------------
   ملاحظة أمنية مهمة:
   هذه المنصة تدريبية. لا نُخزّن ولا نُرسل كلمات المرور الحقيقية
   إطلاقاً. عند تسجيل حدث محاكاة نحفظ فقط بيانات مجهّلة
   (طول الإدخال، الوقت، نوع الحدث) داخل متصفح المستخدم نفسه
   (localStorage). الإرسال البعيد اختياري ومعطّل افتراضياً.

   النسخة السابقة كانت ترسل (البريد + كلمة المرور) إلى قاعدة
   بيانات Firebase عن بُعد، وهي ممارسة خاطئة حتى لأغراض التدريب،
   لذا استُبدلت بالكامل بهذا الملف المحلي الآمن.
   ============================================================ */

import { normalizeLearning } from './learning.js';

const KEYS = {
  events: 'cs_training_events',   // أحداث المحاكاة (مجهّلة)
  quiz:   'cs_quiz_results',      // نتائج الاختبار
  check:  'cs_checklist_state',   // حالة قائمة التحقق
  survey: 'cs_survey_results',    // ردود الاستبيان (مجهّلة)
  theme:  'cs_theme',             // السمة
  daily:  'cs_daily_tip',         // نصيحة اليوم المخزّنة (تُطلب مرة واحدة يومياً)
  feed:   'cs_threat_feed',       // آخر نسخة من قوائم التصيّد المباشرة
  counters: 'cs_counters',        // عدّادات صفحة المحاكاة الكاملة (مشاهدات/إرسال)
  learning: 'cs_learning_progress', // إنجاز التحدي اليومي فقط، دون نصوص المستخدم
};

/* ------------------------------------------------------------
   الطبقة البعيدة (اختيارية) لتجميع نتائج كل المشاركين في لوحة واحدة.
   تُفعّل صراحة في الإعداد:
     • السحابة (Supabase Edge Function): إدخال محدود الحقول والمعدل،
       وقراءة إحصاءات مجمّعة فقط. لا اتصال مباشر بجدول events.
     • الخادم المحلي (server.py): عند التشغيل داخل الشبكة بلا إنترنت.
   إن لم يتوفّر أيّهما، يبقى التخزين المحلي (localStorage) فقط.
   ------------------------------------------------------------ */
const HAS_API = typeof location !== 'undefined' && /^https?:$/.test(location.protocol);

function cloudCfg() {
  try {
    const c = (typeof window !== 'undefined') ? window.PP_CLOUD : null;
    return (c?.enabled === true && c.endpoint && c.key) ? c : null;
  } catch { return null; }
}

function localApiEnabled() {
  return HAS_API && typeof window !== 'undefined' && window.PP_CLOUD?.localApi === true;
}

const MAX_RESULTS = 5000;
const VECTORS = new Set(['fake-login-form', 'fullscreen-fake-login', 'fake-domain']);
const TARGETED = new Set(['yes-fell', 'yes-caught', 'no']);
const FEATURES = new Set(['inspector', 'password', 'quiz', 'checklist']);
const int = (v, lo, hi, fallback = lo) => {
  const n = typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.trunc(n))) : fallback;
};
const agent = () => shortAgent(typeof navigator === 'undefined' ? '' : navigator.userAgent);

function cloudRow(path, body) {
  switch (path) {
    case '/api/sim':    return { kind: 'sim', vector: body.vector, input_length: body.inputLength, client: agent() };
    case '/api/quiz':   return { kind: 'quiz', score: body.score | 0, total: body.total | 0, pct: Math.round((body.score / body.total) * 100) };
    case '/api/survey': return { kind: 'survey', awareness: body.awareness, usefulness: body.usefulness, targeted: body.targeted, feature: body.feature };
    case '/api/bump':   return { kind: body.name === 'fl_submits' ? 'submit' : 'view' };
    default: return null;
  }
}

function apiPost(path, body) {
  const c = cloudCfg();
  if (c) {
    const row = cloudRow(path, body);
    if (!row) return;
    try {
      fetch(c.endpoint.replace(/\/$/, '') + '/event', {
        method: 'POST', keepalive: true,
        headers: { 'Content-Type': 'application/json', apikey: c.key },
        body: JSON.stringify(row),
      }).catch(() => {});
    } catch {}
    return;
  }
  if (localApiEnabled()) {
    try {
      fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), keepalive: true }).catch(() => {});
    } catch {}
  }
}

const readJSON = (k, fallback) => {
  try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; }
  catch { return fallback; }
};
const writeJSON = (k, v) => {
  try { localStorage.setItem(k, JSON.stringify(v)); return true; }
  catch { return false; }
};

export const Store = {
  KEYS,

  /* سجل حدث محاكاة — بدون أي بيانات حساسة */
  logSimEvent({ vector = 'fake-domain', inputLength = 0 } = {}) {
    vector = VECTORS.has(vector) ? vector : 'fake-domain';
    inputLength = int(inputLength, 0, 256);
    const events = readJSON(KEYS.events, []);
    events.push({
      id: Date.now(),
      vector,                                  // ناقل الهجوم
      inputLength,                             // طول الإدخال فقط (لا محتواه)
      passwordEntered: inputLength > 0,       // مؤشر آمن دون حفظ كلمة المرور
      disclaimerShown: true,                 // تظهر شاشة التوعية بعد إرسال النموذج
      at: new Date().toISOString(),
      day: new Date().getDay(),
      client: agent(),
    });
    writeJSON(KEYS.events, events.slice(-MAX_RESULTS));
    apiPost('/api/sim', { vector, inputLength });   // الخادم يتجاهل أي حقل غير الطول والنوع
    return events.length;
  },
  getSimEvents() { return readJSON(KEYS.events, []); },
  clearSimEvents() { try { localStorage.removeItem(KEYS.events); localStorage.removeItem(KEYS.counters); } catch {} },

  /* نتائج الاختبار */
  saveQuiz(score, total) {
    total = int(total, 1, 100);
    score = int(score, 0, total);
    const results = readJSON(KEYS.quiz, []);
    const entry = {
      id: Date.now(), score, total,
      pct: Math.round((score / total) * 100),
      at: new Date().toISOString(),
    };
    results.push(entry);
    writeJSON(KEYS.quiz, results.slice(-MAX_RESULTS));
    apiPost('/api/quiz', { score, total });
    return entry;
  },
  getQuiz() { return readJSON(KEYS.quiz, []); },

  /* تقدّم التعلّم محلي فقط، ولا يمر عبر apiPost. */
  getLearning() { return normalizeLearning(readJSON(KEYS.learning, null)); },
  saveLearning(value) { return writeJSON(KEYS.learning, normalizeLearning(value)); },

  /* الاستبيان — ردود مجهّلة تُحفظ محلياً */
  saveSurvey(data) {
    const results = readJSON(KEYS.survey, []);
    const entry = {
      id: Date.now(), at: new Date().toISOString(),
      awareness: int(data?.awareness, 1, 5, 0),
      usefulness: int(data?.usefulness, 1, 5, 0),
      targeted: TARGETED.has(data?.targeted) ? data.targeted : '',
      feature: FEATURES.has(data?.feature) ? data.feature : '',
    };
    results.push(entry);
    writeJSON(KEYS.survey, results.slice(-MAX_RESULTS));
    apiPost('/api/survey', { awareness: entry.awareness, usefulness: entry.usefulness, targeted: entry.targeted, feature: entry.feature });
    return entry;
  },
  getSurvey() { return readJSON(KEYS.survey, []); },
  clearSurvey() { try { localStorage.removeItem(KEYS.survey); } catch {} },

  /* قائمة التحقق */
  getChecklist() { return readJSON(KEYS.check, {}); },
  saveChecklist(state) { writeJSON(KEYS.check, state); },

  /* عدّادات بسيطة (بديل محلي لخدمة countapi.xyz المتوقفة) */
  bump(name) {
    if (!['fl_views', 'fl_submits'].includes(name)) return 0;
    const c = readJSON(KEYS.counters, {});
    c[name] = (c[name] || 0) + 1;
    writeJSON(KEYS.counters, c);
    apiPost('/api/bump', { name });
    return c[name];
  },
  getCounters() { return readJSON(KEYS.counters, {}); },

  /* قراءة نتائج كل المشاركين من السحابة أو الخادم المحلي (أو null) */
  async getRemoteAll() {
    const c = cloudCfg();
    if (c) {
      try {
        const url = c.endpoint.replace(/\/$/, '') + '/summary';
        const r = await fetch(url, { headers: { apikey: c.key }, cache: 'no-store' });
        if (!r.ok) return null;
        const d = await r.json();
        if (!d?.summary) return null;
        return { events: [], quiz: [], survey: [], counters: d.summary.counters || {}, summary: d.summary, _mode: 'cloud' };
      } catch { return null; }
    }
    if (localApiEnabled()) {
      try {
        const r = await fetch('/api/all', { cache: 'no-store' });
        if (!r.ok) return null;
        const d = await r.json();
        if (!d) return null;
        d._mode = 'local';
        return d;
      } catch { return null; }
    }
    return null;
  },
  async resetRemote() {
    if (cloudCfg()) return false;   // حذف السحابة من لوحة Supabase فقط (الزوار بلا صلاحية حذف)
    if (localApiEnabled()) {
      try { const r = await fetch('/api/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); return r.ok; }
      catch { return false; }
    }
    return false;
  },

  /* قوائم التصيّد المباشرة (آخر نسخة ناجحة) */
  getFeed() { return readJSON(KEYS.feed, null); },
  saveFeed(v) { return writeJSON(KEYS.feed, v); },

  /* نصيحة اليوم */
  getDaily() { return readJSON(KEYS.daily, null); },
  saveDaily(v) { writeJSON(KEYS.daily, v); },

  /* السمة */
  getTheme() { try { return localStorage.getItem(KEYS.theme); } catch { return null; } },
  setTheme(t) { try { localStorage.setItem(KEYS.theme, t); } catch {} },

  clearAll() { Object.values(KEYS).forEach(k => { try { localStorage.removeItem(k); } catch {} }); },
};

function shortAgent(ua = '') {
  if (/edg/i.test(ua)) return 'Edge';
  if (/chrome|crios/i.test(ua)) return 'Chrome';
  if (/firefox|fxios/i.test(ua)) return 'Firefox';
  if (/safari/i.test(ua)) return 'Safari';
  return 'Other';
}
