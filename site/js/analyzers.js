/* ============================================================
   analyzers.js — محرّكات التحليل (منطق نقي بلا واجهة)
   ------------------------------------------------------------
   فُصل عن app.js ليُختبر آلياً (tests/analyzers.test.mjs)
   ويُعاد استخدامه في أكثر من صفحة. لا يتصل بالشبكة إطلاقاً.
   ============================================================ */

/* ---------- قواعد النطاقات ---------- */
export const SHORTENERS = ['bit.ly','tinyurl.com','goo.gl','t.co','ow.ly','is.gd','buff.ly','cutt.ly','rebrand.ly','shorturl.at','rb.gy','t.ly','s.id'];
export const RISKY_TLDS = ['zip','mov','xyz','top','club','online','click','link','country','gq','tk','ml','cf','ga','work','fit','rest','icu','buzz','cam','sbs','cfd'];

// امتدادات من مستويين (حتى لا نعتبر com.sa هو "النطاق الحقيقي")
const MULTI_SUFFIX = ['com.sa','gov.sa','edu.sa','net.sa','org.sa','med.sa','sch.sa','co.uk','org.uk','ac.uk','gov.uk','com.au','co.jp','com.eg','co.in','com.tr','co.za','com.br'];

// العلامة ← نطاقاتها الرسمية (أي نطاق آخر يحمل الاسم = انتحال محتمل)
export const BRANDS = {
  absher:      ['absher.sa'],
  sama:        ['sama.gov.sa'],
  stcpay:      ['stcpay.com.sa'],
  stc:         ['stc.com.sa'],
  alrajhi:     ['alrajhibank.com.sa'],
  alahli:      ['alahli.com'],
  snb:         ['snb.com','alahli.com'],
  riyadbank:   ['riyadbank.com'],
  spl:         ['splonline.com.sa'],
  aramex:      ['aramex.com'],
  paypal:      ['paypal.com'],
  apple:       ['apple.com','icloud.com'],
  icloud:      ['icloud.com','apple.com'],
  microsoft:   ['microsoft.com','live.com','office.com'],
  outlook:     ['outlook.com','live.com','microsoft.com'],
  google:      ['google.com','google.com.sa','youtube.com'],
  amazon:      ['amazon.com','amazon.sa'],
  netflix:     ['netflix.com'],
  whatsapp:    ['whatsapp.com'],
  instagram:   ['instagram.com'],
  tabby:       ['tabby.ai'],
  tamara:      ['tamara.co'],
  aramco:      ['aramco.com'],
};

// كلمات توحي بجهة حكومية سعودية
const GOV_WORDS = ['gov','absher','najiz','tawakkalna','sehhaty','moi','nca','muqeem','qiwa','etimad','nafath'];
const OFFICIAL_GOV = ['absher.sa','nafath.sa','qiwa.sa','muqeem.sa','etimad.sa'];

// كلمات طُعم شائعة في نطاقات التصيّد
const BAIT_WORDS = ['login','signin','verify','verification','secure','update','account','confirm','wallet','support','unlock','billing','refund'];

/* استخراج "النطاق القابل للتسجيل" مع مراعاة الامتدادات الثنائية */
export function registrableDomain(host) {
  const parts = host.toLowerCase().split('.').filter(Boolean);
  if (parts.length <= 2) return parts.join('.');
  const last2 = parts.slice(-2).join('.');
  return MULTI_SUFFIX.includes(last2) ? parts.slice(-3).join('.') : last2;
}

// يزيل تبديلات بصرية شائعة: paypa1 → paypal، g00gle → google، rn → m
function deHomoglyph(s) {
  return s.replace(/rn/g, 'm').replace(/vv/g, 'w')
          .replace(/0/g, 'o').replace(/1/g, 'l').replace(/3/g, 'e')
          .replace(/5/g, 's').replace(/4/g, 'a').replace(/7/g, 't');
}

const isOfficialFor = (brand, reg) => (BRANDS[brand] || []).includes(reg);

/* ============================================================
   analyzeUrl — فحص استدلالي لرابط واحد
   يعيد { score 0-100, level safe|warn|danger, host, registrable, flags[] }
   ============================================================ */
export function analyzeUrl(raw) {
  const flags = [];
  const input = (raw || '').trim();
  if (!input) return null;

  const hadScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(input);
  let url;
  try { url = new URL(hadScheme ? input : 'http://' + input); }
  catch { return { score: 0, level: 'danger', host: '', registrable: '', flags: [{ t: 'bad', title: 'صيغة رابط غير صالحة', desc: 'تعذّر تحليل العنوان — قد يكون مموّهاً أو ناقصاً.' }] }; }

  if (!/^https?:$/.test(url.protocol)) {
    return { score: 0, level: 'danger', host: '', registrable: '', flags: [{ t: 'bad', title: `بروتوكول غير معتاد (${url.protocol})`, desc: 'روابط مثل javascript: أو data: قد تنفّذ شيفرة أو تعرض صفحة مزيّفة مباشرة.' }] };
  }

  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  const parts = host.split('.');
  const tld = parts[parts.length - 1];
  const isIP = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith('[');
  const registrable = isIP ? host : registrableDomain(host);
  const isSaudiGov = host === 'gov.sa' || host.endsWith('.gov.sa');
  const regLabel = registrable.split('.')[0];
  // كلمات النطاق كاملاً (بدون الامتداد) مقسّمة على النقاط والشرطات
  const hostTokens = parts.slice(0, -1).join('.').split(/[.\-_]/).filter(Boolean);
  let decodedPath = url.pathname + url.search;
  try { decodedPath = decodeURIComponent(decodedPath); }
  catch { flags.push({ t: 'mid', title: 'ترميز غير صالح داخل العنوان', desc: 'قد يكون الرابط ناقصًا أو مموّهًا؛ لا تعتمد عليه قبل التحقّق من مصدره.' }); }
  const pathTokens = decodedPath.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

  // 1) البروتوكول
  if (url.protocol !== 'https:') {
    flags.push({ t: 'bad', title: 'اتصال غير مُشفّر (HTTP)', desc: 'البيانات تنتقل مكشوفة. المواقع الرسمية تستخدم HTTPS دائماً.' });
  } else {
    flags.push({ t: 'good', title: 'اتصال مُشفّر (HTTPS)', desc: 'وجود التشفير جيد—لكنه لا يكفي وحده لإثبات أن الموقع أصلي.' });
  }

  // 2) عنوان IP بدل النطاق
  if (isIP) flags.push({ t: 'bad', title: 'يستخدم عنوان IP بدل اسم نطاق', desc: 'المواقع الموثوقة تُعرّف باسم نطاق، لا برقم مثل 192.0.2.10.' });

  // 3) رمز @ داخل الرابط (بيانات اعتماد مدمجة)
  if (url.username || url.password || input.split('#')[0].replace(/^[a-z]+:\/\//i, '').split('/')[0].includes('@')) {
    flags.push({ t: 'bad', title: 'يحتوي على الرمز @ قبل النطاق', desc: 'حيلة شائعة: ما قبل @ يُتجاهل، فيوجّهك الرابط لوجهة مختلفة تماماً.' });
  }

  // 4) Punycode / حروف مموّهة
  if (host.includes('xn--')) flags.push({ t: 'bad', title: 'نطاق بحروف مموّهة (Punycode)', desc: 'قد يحاكي حروفاً لاتينية لتقليد موقع شهير (هجوم Homograph).' });

  // 5) انتحال جهة حكومية سعودية
  const govHit = !isSaudiGov && !OFFICIAL_GOV.includes(registrable) &&
    hostTokens.some(tk => GOV_WORDS.some(w => tk === w || (w.length > 3 && tk.startsWith(w))));
  if (govHit) {
    flags.push({ t: 'bad', title: 'يوهم بأنه جهة حكومية', desc: 'النطاق الفعلي هو ', code: registrable, tail: ' وليس نطاقاً حكومياً رسمياً (.gov.sa).' });
  }

  // 6) انتحال علامة تجارية (في النطاق الفرعي أو المسار)
  let brandHit = null;
  for (const b of Object.keys(BRANDS)) {
    const inHost = hostTokens.some(tk => tk === b || tk.startsWith(b));
    const inPath = pathTokens.includes(b);
    if ((inHost || inPath) && !isOfficialFor(b, registrable)) { brandHit = b; break; }
  }
  if (brandHit && !(govHit && brandHit === 'absher')) {
    flags.push({ t: 'bad', title: `ينتحل اسم علامة معروفة (${brandHit})`, desc: 'الاسم يظهر في العنوان لكن النطاق الحقيقي ', code: registrable, tail: ' لا يعود لتلك الجهة.' });
  }

  // 7) تبديل بصري للحروف (Typosquatting): paypa1 / g00gle / rnicrosoft
  if (!brandHit && !isIP) {
    const cleaned = deHomoglyph(regLabel);
    const squat = cleaned !== regLabel && Object.keys(BRANDS).find(b => cleaned.includes(b) && !regLabel.includes(b));
    if (squat) flags.push({ t: 'bad', title: `تقليد بصري لاسم (${squat})`, desc: 'استُبدلت حروف بأرقام أو حروف متشابهة شكلاً: ', code: registrable, tail: ` يُقرأ كأنه ${squat}.` });
  }

  // 8) مختصر روابط
  if (SHORTENERS.includes(registrable)) flags.push({ t: 'mid', title: 'رابط مختصَر — الوجهة مخفية', desc: 'المختصرات تُخفي العنوان الحقيقي. وسّع الرابط قبل فتحه.' });

  // 9) امتداد نطاق عالي المخاطر
  if (RISKY_TLDS.includes(tld)) flags.push({ t: 'mid', title: `امتداد نطاق كثير الإساءة (.${tld})`, desc: 'يُستخدم بكثرة في حملات التصيّد لرخصه وسهولة تسجيله.' });

  // 10) كلمات طُعم داخل النطاق
  const bait = hostTokens.find(tk => BAIT_WORDS.includes(tk));
  if (bait && !isSaudiGov) flags.push({ t: 'mid', title: `كلمة طُعم في النطاق (${bait})`, desc: 'كلمات مثل login و secure و verify تُضاف للنطاق لتوحي بالأمان.' });

  // 11) كثرة النطاقات الفرعية
  if (parts.length >= 5 && !isIP) flags.push({ t: 'mid', title: 'نطاقات فرعية متداخلة كثيرة', desc: 'أسلوب لدفن النطاق الحقيقي بين كلمات تبدو رسمية.' });

  // 12) كثرة الشرطات في النطاق
  if ((regLabel.match(/-/g) || []).length >= 2) flags.push({ t: 'mid', title: 'شرطات متعددة في اسم النطاق', desc: 'نطاقات مثل secure-update-account شائعة في التصيّد.' });

  // 13) طول الرابط المفرط
  if (url.href.length > 100) flags.push({ t: 'mid', title: 'رابط طويل جداً', desc: 'الطول المبالغ فيه يُستخدم لإخفاء معاملات ووجهات مريبة.' });

  // 14) إشارات إيجابية
  if (isSaudiGov) flags.push({ t: 'good', title: 'نطاق حكومي سعودي (.gov.sa)', desc: 'هذا الامتداد لا تسجّله إلا الجهات الحكومية.' });
  const officialBrand = Object.keys(BRANDS).find(b => isOfficialFor(b, registrable));
  if (officialBrand || OFFICIAL_GOV.includes(registrable)) flags.push({ t: 'good', title: 'نطاق رسمي معروف', desc: 'النطاق مطابق للنطاق الرسمي المسجّل للجهة: ', code: registrable });

  // النتيجة
  const bad = flags.filter(f => f.t === 'bad').length;
  const mid = flags.filter(f => f.t === 'mid').length;
  let score = 100 - bad * 34 - mid * 14;
  score = Math.max(0, Math.min(100, score));
  let level = 'safe';
  if (bad > 0 || score < 45) level = 'danger';
  else if (mid > 0 || score < 80) level = 'warn';

  if (level === 'safe' && !isSaudiGov && !officialBrand) {
    flags.push({ t: 'good', title: 'لا مؤشرات خطر واضحة', desc: 'لم نرصد علامات تصيّد شائعة—لكن تحقّق دائماً من الجهة عبر قناتها الرسمية.' });
  }
  return { score, level, host, registrable, flags };
}

/* ============================================================
   analyzeMessage — فاحص نص رسالة SMS / واتساب / بريد
   يرصد أساليب الهندسة الاجتماعية ويفحص الروابط داخل النص.
   ============================================================ */
const MSG_RULES = [
  { key: 'urgency', w: 22, title: 'ضغط زمني وإلحاح',
    desc: 'عبارات تستعجلك لتتصرّف دون تفكير.',
    re: /(عاجل|فوراً|فورا|حالاً|حالا|خلال\s*\d+\s*(ساعة|ساعات|دقيقة|دقائق|يوم)|آخر\s*(فرصة|مهلة|تنبيه)|قبل\s*فوات|urgent|immediately|within\s*\d+\s*hours?)/i },
  { key: 'threat', w: 24, title: 'تهديد بإيقاف أو عقوبة',
    desc: 'التخويف بإغلاق الحساب أو غرامة أسلوب ضغط كلاسيكي.',
    re: /(سيتم\s*(إيقاف|ايقاف|تعليق|إغلاق|اغلاق|حظر|تجميد)|تم\s*(إيقاف|ايقاف|تعليق|تجميد)|مخالفة|غرامة|suspend|locked|blocked)/i },
  { key: 'prize', w: 24, title: 'إغراء بجائزة أو مكسب',
    desc: 'لا أحد يمنحك جائزة مقابل بياناتك أو رسوم تحويل.',
    re: /(مبروك|مبارك|فزت|ربحت|جائزة|الفائز|سحب\s*على|استرداد\s*مبلغ|كاش\s*باك|هدية\s*مجانية|congratulations|winner|prize|free\s*gift)/i },
  { key: 'secret', w: 34, title: 'طلب بيانات سرّية',
    desc: 'الجهات الرسمية لا تطلب رمز التحقق أو كلمة المرور أو بيانات البطاقة أبداً.',
    re: /(رمز\s*(التحقق|التفعيل|التأكيد)|كود\s*(التحقق|التفعيل)|OTP|كلمة\s*(المرور|السر)|الرقم\s*السري|رقم\s*البطاقة|CVV|تاريخ\s*الانتهاء|password|verification\s*code)/i },
  { key: 'payment', w: 18, title: 'طلب دفع أو تحويل',
    desc: 'رسوم شحن صغيرة أو "سداد" عبر رابط = طُعم لسرقة البطاقة.',
    re: /(رسوم|سداد|سدد|ادفع|دفع\s*مبلغ|حوّل|حول\s*مبلغ|تحويل\s*مبلغ|ريال\s*فقط|pay\s*now|fee)/i },
  { key: 'impersonation', w: 12, title: 'انتحال جهة معروفة',
    desc: 'ذكر اسم بنك أو جهة حكومية أو شركة شحن لكسب الثقة.',
    re: /(البنك|بنك|مصرف|أبشر|ابشر|ساما|البريد\s*السعودي|سبل|أرامكس|ارامكس|شحنتك|طردك|وزارة|الجوازات|المرور|نفاذ|توكلنا|stc|absher)/i },
  { key: 'update', w: 14, title: 'طلب تحديث أو تأكيد بيانات',
    desc: 'دعوة لتحديث بياناتك عبر رابط—الجهات الحقيقية تطلب ذلك داخل تطبيقها الرسمي.',
    re: /(حدّث|حدث\s*بيانات|تحديث\s*(بيانات|البيانات|معلومات)|تأكيد\s*(بيانات|هويتك|الحساب)|أكّد|اكد\s*بيانات|verify\s*your|update\s*your)/i },
];

const URL_RE = /((?:https?:\/\/|www\.)[^\s<>"'،]+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|sa|xyz|top|info|link|click|online|site|ly|co|me|io|app|shop|vip)(?:\/[^\s<>"'،]*)?)/gi;

export function extractUrls(text) {
  return Array.from(new Set((text.match(URL_RE) || []).map(u => u.replace(/[).,!؟?]+$/, ''))));
}

export function analyzeMessage(text) {
  const t = (text || '').trim();
  if (!t) return null;
  const hits = MSG_RULES.filter(r => r.re.test(t)).map(r => ({ key: r.key, w: r.w, title: r.title, desc: r.desc, match: (t.match(r.re) || [''])[0] }));
  const urls = extractUrls(t).map(u => ({ url: u, result: analyzeUrl(u) }));

  let risk = hits.reduce((a, h) => a + h.w, 0);
  if (urls.length) risk += 16;                                                     // وجود رابط بحد ذاته
  risk += urls.filter(u => u.result && u.result.level === 'danger').length * 30;
  risk += urls.filter(u => u.result && u.result.level === 'warn').length * 12;
  // تركيبة خطرة: رابط + (إلحاح أو تهديد أو جائزة)
  if (urls.length && hits.some(h => ['urgency', 'threat', 'prize'].includes(h.key))) risk += 10;
  risk = Math.min(100, risk);

  const level = risk >= 55 ? 'danger' : risk >= 25 ? 'warn' : 'safe';
  return { risk, level, hits, urls };
}

/* ============================================================
   scorePassword — تقدير قوة كلمة المرور (محلي)
   ============================================================ */
export const COMMON = ['123456','password','12345678','qwerty','111111','123123','abc123','iloveyou','admin','welcome','000000','1234567890','password1','qwerty123','123456789','000111','saudi123','p@ssw0rd','Aa123456','aa123456','1q2w3e4r'];

export function scorePassword(pw) {
  if (!pw) return null;
  let pool = 0;
  if (/[a-z]/.test(pw)) pool += 26;
  if (/[A-Z]/.test(pw)) pool += 26;
  if (/[0-9]/.test(pw)) pool += 10;
  if (/[^A-Za-z0-9]/.test(pw)) pool += 32;
  let entropy = pw.length * Math.log2(pool || 1);

  const has = (re) => re.test(pw);
  const notes = [
    { ok: pw.length >= 12, txt: '١٢ محرفاً فأكثر' },
    { ok: has(/[A-Z]/) && has(/[a-z]/), txt: 'حروف كبيرة وصغيرة' },
    { ok: has(/[0-9]/), txt: 'أرقام' },
    { ok: has(/[^A-Za-z0-9]/), txt: 'رموز خاصة (!@#…)' },
  ];

  const lower = pw.toLowerCase();
  const isCommon = COMMON.map(c => c.toLowerCase()).includes(lower);
  if (isCommon) { entropy = Math.min(entropy, 8); notes.push({ ok: false, txt: 'من أشهر كلمات المرور المسرّبة' }); }
  if (/^(.)\1+$/.test(pw)) entropy *= .3;
  if (/(0123|1234|2345|3456|4567|5678|6789|abcd|qwer|asdf)/i.test(pw)) entropy *= .6;
  if (/(19|20)\d{2}/.test(pw) && pw.length <= 8) entropy *= .7;

  let level, label, color, pct;
  if (entropy < 28)      { level = 0; label = 'ضعيفة جداً'; color = 'var(--rose)';    pct = 18; }
  else if (entropy < 44) { level = 1; label = 'ضعيفة';      color = 'var(--amber)';   pct = 42; }
  else if (entropy < 64) { level = 2; label = 'جيدة';        color = 'var(--cyan)';    pct = 68; }
  else                   { level = 3; label = 'قوية جداً';   color = 'var(--emerald)'; pct = 100; }

  const seconds = Math.pow(2, entropy) / 2 / 1e10;   // مهاجم ~10^10 محاولة/ثانية
  return { entropy: Math.round(entropy), notes, level, label, color, pct, crack: humanTime(seconds) };
}

export function humanTime(s) {
  if (s < 1) return 'أقل من ثانية';
  if (s > 31557600 * 1000) return 'أكثر من ألف سنة';
  const u = [['سنة', 31557600], ['يوم', 86400], ['ساعة', 3600], ['دقيقة', 60], ['ثانية', 1]];
  for (const [name, secs] of u) {
    if (s >= secs) { const n = Math.floor(s / secs); return `${n.toLocaleString('ar-EG')} ${name}`; }
  }
  return 'ثوانٍ';
}

/* خلط مصفوفة (Fisher–Yates) — يُستخدم في الاختبار */
export function shuffle(arr, rnd = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/* تهريب HTML لأي نص يدخله المستخدم قبل عرضه */
export function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
