/* ============================================================
   app.js — منطق الواجهة والأدوات التفاعلية
   ============================================================ */
import { Store } from './storage.js';
import { QUESTIONS } from './quiz-data.js';
import { generateTip, todayKey } from './daily-tip.js';
import { AI_CONFIG } from './ai-config.js';
import { analyzeUrl, analyzeMessage, scorePassword, shuffle, esc } from './analyzers.js';
import { initLearningFeatures } from './learning-ui.js';

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

/* ---------- التنبيهات ---------- */
function toast(msg, type = 'info') {
  let host = $('.toast-host');
  if (!host) { host = document.createElement('div'); host.className = 'toast-host'; document.body.appendChild(host); }
  const icon = type === 'ok' ? 'fa-circle-check' : type === 'err' ? 'fa-circle-xmark' : 'fa-circle-info';
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<i class="fas ${icon}"></i><span>${msg}</span>`;
  host.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateY(-10px)'; }, 2600);
  setTimeout(() => el.remove(), 3000);
}

/* ---------- السمة ---------- */
function initTheme() {
  const saved = Store.getTheme();
  if (saved === 'light') document.body.classList.add('theme-light');
  syncThemeIcon();
  $$('[data-theme-toggle]').forEach(b => b.addEventListener('click', () => {
    document.body.classList.toggle('theme-light');
    const light = document.body.classList.contains('theme-light');
    Store.setTheme(light ? 'light' : 'dark');
    syncThemeIcon();
  }));
}
function syncThemeIcon() {
  const light = document.body.classList.contains('theme-light');
  $$('[data-theme-icon]').forEach(i => i.className = light ? 'fas fa-moon' : 'fas fa-sun');
}

/* ---------- التنقل بالجوال ---------- */
function initNav() {
  const toggle = $('.nav-toggle'), links = $('.nav-links');
  if (toggle && links) {
    links.id ||= 'nav-menu';
    toggle.setAttribute('aria-controls', links.id);
    toggle.addEventListener('click', () => {
      const open = links.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(open));
    });
    $$('.nav-links a').forEach(a => a.addEventListener('click', () => { links.classList.remove('open'); toggle.setAttribute('aria-expanded', 'false'); }));
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && links.classList.contains('open')) {
        links.classList.remove('open'); toggle.setAttribute('aria-expanded', 'false'); toggle.focus();
      }
    });
    document.addEventListener('click', e => {
      if (links.classList.contains('open') && !links.contains(e.target) && !toggle.contains(e.target)) {
        links.classList.remove('open'); toggle.setAttribute('aria-expanded', 'false');
      }
    });
  }
  const top = $('.to-top');
  if (top) {
    top.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
    window.addEventListener('scroll', () => top.classList.toggle('show', window.scrollY > 400));
  }
}

/* ---------- عدّادات متحركة ---------- */
function initCounters() {
  const nums = $$('[data-count]');
  if (!nums.length) return;
  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (!e.isIntersecting) return;
      animate(e.target); io.unobserve(e.target);
    });
  }, { threshold: .5 });
  nums.forEach(n => io.observe(n));

  function animate(el) {
    const target = parseFloat(el.dataset.count);
    const suffix = el.dataset.suffix || '';
    const decimals = (el.dataset.count.split('.')[1] || '').length;
    const dur = 1400, t0 = performance.now();
    const step = (t) => {
      const p = Math.min((t - t0) / dur, 1);
      const val = target * (1 - Math.pow(1 - p, 3));
      el.textContent = val.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + suffix;
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
}

/* ============================================================
   0) نصيحة اليوم — مولّدة بالذكاء الاصطناعي مع بديل محلي
   ============================================================ */
function initDailyTip() {
  const box = $('#daily-tip');
  if (!box) return;
  const el = {
    title: $('#dt-title', box), tip: $('#dt-text', box), action: $('#dt-action', box),
    topic: $('#dt-topic', box), src: $('#dt-source', box), date: $('#dt-date', box),
    more: $('#dt-more', box), copy: $('#dt-copy', box),
  };
  const today = todayKey();
  el.date.textContent = new Date().toLocaleDateString('ar-SA', { weekday: 'long', day: 'numeric', month: 'long' });

  const show = (t) => {
    // textContent فقط — لا نُدخل مخرجات النموذج كـ HTML أبداً
    el.title.textContent = t.title;
    el.tip.textContent = t.tip;
    el.action.textContent = t.action;
    el.topic.textContent = t.topic || '';
    el.src.innerHTML = t.source === 'ai'
      ? `<i class="fas fa-wand-magic-sparkles"></i> مولّدة بالذكاء الاصطناعي · ${esc(t.provider || '')}`
      : '<i class="fas fa-book"></i> من مكتبة النصائح المُراجَعة';
    el.src.className = 'dt-source ' + (t.source === 'ai' ? 'ai' : 'local');
    box.classList.remove('loading'); box.setAttribute('aria-busy', 'false');
  };

  const load = async (offset) => {
    box.classList.add('loading'); box.setAttribute('aria-busy', 'true');
    el.src.className = 'dt-source';
    el.src.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جارٍ توليد نصيحة…';
    el.more.disabled = true;
    const t = await generateTip(AI_CONFIG, { offset });
    const saved = Store.getDaily();
    const refreshes = saved && saved.date === today ? saved.refreshes || 0 : 0;
    Store.saveDaily({ date: today, tip: t, offset, refreshes });
    show(t);
    el.more.disabled = refreshes >= AI_CONFIG.maxRefreshPerDay;
  };

  const cached = Store.getDaily();
  if (cached && cached.date === today && cached.tip) {
    show(cached.tip);
    el.more.disabled = (cached.refreshes || 0) >= AI_CONFIG.maxRefreshPerDay;
  } else {
    load(0);
  }

  el.more.addEventListener('click', () => {
    const s = Store.getDaily() || { date: today, refreshes: 0, offset: 0 };
    if ((s.refreshes || 0) >= AI_CONFIG.maxRefreshPerDay) { toast('وصلت للحد اليومي — عُد غداً لنصيحة جديدة', 'info'); return; }
    Store.saveDaily({ ...s, refreshes: (s.refreshes || 0) + 1 });
    load((s.offset || 0) + 7);   // محور مختلف
  });

  el.copy.addEventListener('click', async () => {
    const text = `💡 ${el.title.textContent}\n${el.tip.textContent}\n✅ ${el.action.textContent}\n— منصّة الوقاية من التصيّد الاحتيالي`;
    try {
      if (navigator.share) { await navigator.share({ text }); return; }
    } catch (e) { if (e && e.name === 'AbortError') return; /* المشاركة غير متاحة → ننسخ بدلاً منها */ }
    try { await navigator.clipboard.writeText(text); toast('نُسخت النصيحة—شاركها مع من تحب', 'ok'); }
    catch { toast('تعذّر النسخ تلقائياً—حدّد النص وانسخه يدوياً', 'err'); }
  });
}

/* ============================================================
   1) فاحص الروابط — المنطق في analyzers.js
   ============================================================ */
function initInspector() {
  const form = $('#inspector-form');
  if (!form) return;
  const input = $('#url-input'), out = $('#verdict');

  $$('.chip[data-url]').forEach(c => c.addEventListener('click', () => {
    input.value = c.dataset.url; runInspect();
  }));

  form.addEventListener('submit', (e) => { e.preventDefault(); runInspect(); });

  function runInspect() {
    const res = analyzeUrl(input.value);
    if (!res) { toast('الصق رابطاً أولاً', 'err'); return; }
    // مطابقة مع آخر نسخة محفوظة من قوائم التصيّد المباشرة (إن زار المستخدم صفحتها)
    const feed = Store.getFeed();
    if (feed && feed.lists && res.host) {
      const h = res.host.replace(/^www\./, '');
      const src = feed.lists.find(l => l.urls.some(u => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, '') === h; } catch { return false; } }));
      if (src) {
        res.flags.unshift({ t: 'bad', title: 'مُدرج في قوائم التصيّد المباشرة', desc: 'هذا النطاق مُبلَّغ عنه فعلاً كموقع تصيّد نشط في مصادر استخبارات التهديدات.' });
        res.flags = res.flags.filter(f => f.title !== 'لا مؤشرات خطر واضحة');
        res.level = 'danger'; res.score = Math.min(res.score, 5);
      }
    }
    const label = { safe: 'لم تظهر مؤشرات واضحة', warn: 'انتبه — مؤشرات مشبوهة', danger: 'خطر — علامات تصيّد قوية' }[res.level];
    const icon  = { safe: 'fa-shield-halved', warn: 'fa-triangle-exclamation', danger: 'fa-skull-crossbones' }[res.level];
    out.innerHTML = `
      <div class="verdict-banner ${res.level}">
        <i class="fas ${icon}"></i>
        <span>${label}</span>
        <span class="score" title="درجة استدلالية وليست احتمالًا إحصائيًا للسلامة">${res.score}/100</span>
      </div>
      ${res.registrable ? `<div class="domain-focus"><span>النطاق الفعلي الذي تحتاج إلى التحقّق منه</span><b dir="ltr">${esc(res.registrable)}</b><small>اسم الجهة في بداية الرابط لا يثبت ملكيتها له.</small></div>` : ''}
      <div class="flag-list">
        ${res.flags.map(f => `
          <div class="flag ${f.t}">
            <i class="fas ${f.t === 'good' ? 'fa-check' : f.t === 'mid' ? 'fa-circle-exclamation' : 'fa-xmark'}"></i>
            <div><b>${f.title}</b><small>${f.desc || ''}${f.code ? `<code dir="ltr">${esc(f.code)}</code>` : ''}${f.tail || ''}</small></div>
          </div>`).join('')}
      </div><p class="scan-disclaimer">الفحص استدلالي ولا يفتح الرابط. غياب المؤشرات لا يضمن السلامة؛ تحقّق من الجهة عبر قناة مستقلة.</p>`;
    out.classList.add('show');
  }
}

/* ============================================================
   1-ب) فاحص الرسائل — يحلّل نص SMS/واتساب/بريد محلياً
   ============================================================ */
function initMessageChecker() {
  const form = $('#msg-form');
  if (!form) return;
  const input = $('#msg-input'), out = $('#msg-verdict');

  $$('.chip[data-msg]').forEach(c => c.addEventListener('click', () => { input.value = c.dataset.msg; run(); }));
  form.addEventListener('submit', (e) => { e.preventDefault(); run(); });

  function run() {
    const r = analyzeMessage(input.value);
    if (!r) { toast('الصق نص الرسالة أولاً', 'err'); return; }
    const label = { safe: 'لا مؤشرات احتيال واضحة', warn: 'مشبوهة — تعامل بحذر', danger: 'احتيال مرجّح — لا تتفاعل معها' }[r.level];
    const icon  = { safe: 'fa-shield-halved', warn: 'fa-triangle-exclamation', danger: 'fa-skull-crossbones' }[r.level];
    const advice = r.level === 'safe'
      ? 'لم نرصد أساليب ضغط شائعة، لكن لا تشارك رموز التحقق مع أحد مهما كان.'
      : 'لا تضغط الرابط ولا ترد. تواصل مع الجهة عبر تطبيقها أو رقمها الرسمي، وأعد توجيه الرسالة إلى 330330.';
    out.innerHTML = `
      <div class="verdict-banner ${r.level}">
        <i class="fas ${icon}"></i><span>${label}</span><span class="score">خطورة ${r.risk}%</span>
      </div>
      <div class="flag-list">
        ${r.hits.map(h => `
          <div class="flag ${h.w >= 22 ? 'bad' : 'mid'}">
            <i class="fas ${h.w >= 22 ? 'fa-xmark' : 'fa-circle-exclamation'}"></i>
            <div><b>${h.title}</b><small>${h.desc} <span style="opacity:.8">— رصدنا: «${esc(h.match)}»</span></small></div>
          </div>`).join('')}
        ${r.urls.map(u => `
          <div class="flag ${u.result.level === 'safe' ? 'good' : u.result.level === 'warn' ? 'mid' : 'bad'}">
            <i class="fas fa-link"></i>
            <div><b>رابط داخل الرسالة: <code dir="ltr">${esc(u.url)}</code></b>
            <small>${u.result.flags.filter(f => f.t !== 'good').map(f => f.title).join(' · ') || 'لا مؤشرات واضحة على الرابط نفسه'}</small></div>
          </div>`).join('')}
        <div class="flag ${r.level === 'safe' ? 'good' : 'mid'}"><i class="fas fa-lightbulb"></i><div><b>ماذا أفعل؟</b><small>${advice}</small></div></div>
      </div>`;
    out.classList.add('show');
  }
}

/* ============================================================
   2) فاحص قوة كلمة المرور — محلي بالكامل، لا يُرسل شيئاً
   ============================================================ */
function initPasswordTool() {
  const input = $('#pw-input');
  if (!input) return;
  const bar = $('#pw-bar'), lbl = $('#pw-label'), time = $('#pw-time'), notes = $('#pw-notes');
  const toggle = $('#pw-toggle');
  if (toggle) toggle.addEventListener('click', () => {
    const t = input.type === 'password' ? 'text' : 'password';
    input.type = t; toggle.querySelector('i').className = t === 'text' ? 'fas fa-eye-slash' : 'fas fa-eye';
  });
  input.addEventListener('input', () => {
    const r = scorePassword(input.value);
    if (!r) { bar.style.width = '0'; lbl.textContent = '—'; time.textContent = ''; notes.innerHTML = ''; return; }
    bar.style.width = r.pct + '%'; bar.style.background = r.color;
    lbl.textContent = r.label; lbl.style.color = r.color;
    time.textContent = 'زمن الكسر المُقدّر: ' + r.crack;
    notes.innerHTML = r.notes.map(n => `
      <span class="${n.ok ? 'ok' : 'no'}"><i class="fas ${n.ok ? 'fa-circle-check' : 'fa-circle'}"></i>${n.txt}</span>`).join('');
  });
}

/* ============================================================
   3) الاختبار التفاعلي
   ============================================================ */
function initQuiz() {
  const root = $('#quiz');
  if (!root) return;
  const ROUND = 10;                       // عدد الأسئلة في كل جولة من بنك الأسئلة
  let deck = [], idx = 0, score = 0, answered = false, missed = [];

  // كل جولة: أسئلة عشوائية + ترتيب خيارات عشوائي (يمنع حفظ مواقع الإجابات)
  const newRound = () => {
    deck = shuffle(QUESTIONS).slice(0, Math.min(ROUND, QUESTIONS.length)).map(q => {
      const order = shuffle(q.options.map((_, i) => i));
      return { ...q, options: order.map(i => q.options[i]), answer: order.indexOf(q.answer) };
    });
    idx = 0; score = 0; missed = [];
  };

  const render = () => {
    if (idx >= deck.length) return renderResult();
    const q = deck[idx];
    answered = false;
    root.innerHTML = `
      <div class="quiz-progress" aria-hidden="true">${deck.map((_, i) => `<i class="${i < idx ? 'done' : ''}"></i>`).join('')}</div>
      <div class="q-num">سؤال ${idx + 1} من ${deck.length}${q.topic ? ` · <span style="color:var(--cyan)">${q.topic}</span>` : ''}</div>
      <div class="q-text" id="q-text">${q.q}</div>
      <div class="q-opts" role="group" aria-labelledby="q-text">
        ${q.options.map((o, i) => `<button class="q-opt" data-i="${i}">${o}</button>`).join('')}
      </div>
      <div class="q-explain" id="q-explain" aria-live="polite"></div>
      <div class="quiz-nav"><button class="btn btn-primary" id="q-next" style="display:none">${idx + 1 === deck.length ? 'النتيجة' : 'التالي'} <i class="fas fa-arrow-left"></i></button></div>`;
    $$('.q-opt', root).forEach(b => b.addEventListener('click', () => choose(parseInt(b.dataset.i), q)));
    $('#q-next', root).addEventListener('click', () => { idx++; render(); root.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  };

  const choose = (i, q) => {
    if (answered) return;
    answered = true;
    const opts = $$('.q-opt', root);
    opts.forEach(o => o.disabled = true);
    opts[q.answer].classList.add('correct');
    if (i === q.answer) score++;
    else { opts[i].classList.add('wrong'); missed.push(q); }
    const ex = $('#q-explain', root);
    ex.innerHTML = `<b>${i === q.answer ? 'إجابة صحيحة ✓' : 'الإجابة الصحيحة موضّحة'}:</b> ${q.why}`;
    ex.classList.add('show');
    const next = $('#q-next', root);
    next.style.display = 'inline-flex'; next.focus();
  };

  const renderResult = () => {
    const pct = Math.round((score / deck.length) * 100);
    const color = pct >= 75 ? 'var(--emerald)' : pct >= 50 ? 'var(--amber)' : 'var(--rose)';
    const msg = pct >= 75 ? 'وعيك الأمني مرتفع—استمر وشارك المعرفة.' : pct >= 50 ? 'أساس جيد، راجع أقسام الحماية لترفع جاهزيتك.' : 'ابدأ بقسمَي "أنواع التصيّد" و"الحماية"، ثم أعد الاختبار.';
    const prior = Store.getQuiz().at(-1);
    Store.saveQuiz(score, deck.length);
    window.dispatchEvent(new Event('wiqaya:progress'));
    const topics = [...new Set(missed.map(q => q.topic).filter(Boolean))];
    root.innerHTML = `
      <div class="quiz-result">
        <div class="ring" style="color:${color}">${score}/${deck.length}</div>
        <p style="color:var(--muted);margin:8px 0 6px">النتيجة ${pct}%</p>
        <p class="quiz-comparison" role="status">${prior ? `المحاولة السابقة: ${prior.pct}% · الفرق: ${pct-prior.pct>0?'+':''}${pct-prior.pct} نقطة مئوية.` : 'هذه نقطة البداية. راجع الشرح ثم أعد المحاولة لمقارنة أدائك.'}</p>
        <p style="color:var(--muted);font-size:.85rem">مؤشر تدريبي محلي؛ تختلف الأسئلة وقد يؤثر تذكّر الإجابات. لا يثبت الفرق وحده أثر التدريب أو الجاهزية المهنية.</p>
        <p style="font-weight:700;max-width:40ch;margin:0 auto 18px">${msg}</p>
        ${topics.length ? `<p style="color:var(--muted);font-size:.92rem;margin:0 auto 18px;max-width:48ch"><i class="fas fa-bullseye"></i> محاور تحتاج مراجعة: <b style="color:var(--amber)">${topics.join('، ')}</b></p>` : ''}
        <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
          <button class="btn btn-primary" id="q-again"><i class="fas fa-rotate-right"></i> جولة جديدة بأسئلة مختلفة</button>
          <a class="btn btn-ghost" href="pages/protection.html"><i class="fas fa-shield"></i> طرق الحماية</a>
        </div>
      </div>`;
    $('#q-again', root).addEventListener('click', () => { newRound(); render(); });
  };

  newRound(); render();
}

/* ============================================================
   4) قائمة التحقق التفاعلية (تُحفظ محلياً)
   ============================================================ */
function initChecklist() {
  const list = $('#checklist');
  if (!list) return;
  const state = Store.getChecklist();
  const items = $$('.check-item', list);
  const bar = $('#check-bar'), txt = $('#check-txt');

  const update = () => {
    const done = items.filter(i => i.classList.contains('done')).length;
    const pct = Math.round((done / items.length) * 100);
    if (bar) bar.style.width = pct + '%';
    if (txt) txt.textContent = `${done} من ${items.length} مكتملة (${pct}%)`;
  };

  items.forEach(item => {
    const key = item.dataset.key;
    if (state[key]) item.classList.add('done');
    // إمكانية الوصول: تعمل بلوحة المفاتيح وقارئ الشاشة
    item.setAttribute('role', 'checkbox');
    item.setAttribute('tabindex', '0');
    item.setAttribute('aria-checked', String(!!state[key]));
    item.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); item.click(); } });
    item.addEventListener('click', () => {
      item.classList.toggle('done');
      item.setAttribute('aria-checked', String(item.classList.contains('done')));
      const s = Store.getChecklist();
      s[key] = item.classList.contains('done');
      Store.saveChecklist(s);
      window.dispatchEvent(new Event('wiqaya:progress'));
      update();
    });
  });
  update();
}

/* ============================================================
   5) محاكاة التصيّد — تعرض الدرس، وتحفظ حدثاً مجهّلاً فقط
   ============================================================ */
function initSim() {
  const form = $('#sim-form');
  if (!form) return;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const id = $('#sim-id')?.value.trim() || '';
    const pw = $('#sim-pw')?.value || '';
    if (!id || !pw) { toast('أدخل الحقلين لتجربة المحاكاة', 'err'); return; }

    // ⚠️ لا نحفظ كلمة المرور الحقيقية — فقط طولها كحدث تدريبي مجهّل
    Store.logSimEvent({ vector: 'fake-login-form', inputLength: pw.length });

    const reveal = $('#sim-reveal');
    const outId = $('#out-id'), outPw = $('#out-pw');
    if (outId) outId.textContent = maskId(id);
    if (outPw) outPw.textContent = '•'.repeat(Math.min(pw.length, 16));
    if (reveal) { reveal.classList.add('show'); reveal.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
    form.reset();
  });
}
function maskId(v) {
  if (v.length <= 4) return v[0] + '•'.repeat(Math.max(0, v.length - 1));
  return v.slice(0, 2) + '•'.repeat(v.length - 4) + v.slice(-2);
}

/* ============================================================
   6) الاستبيان — يُحفظ محلياً (مجهّل) ويغذّي لوحة التحكم
   ============================================================ */
function initSurvey() {
  const form = $('#survey-form');
  if (!form) return;

  // إظهار عدد المشاركات السابقة
  const countEl = $('#survey-count');
  if (countEl) countEl.textContent = Store.getSurvey().length;

  form.addEventListener('submit', (e) => {
    e.preventDefault();

    const get = (name) => {
      const el = form.querySelector(`[name="${name}"]:checked`) || form.querySelector(`[name="${name}"]`);
      return el ? el.value : '';
    };

    const awareness = get('awareness');   // مستوى الوعي قبل/بعد
    const usefulness = get('usefulness');  // تقييم الفائدة 1-5
    const targeted   = get('targeted');    // هل تعرّض لتصيّد
    const feature    = get('feature');     // الأداة الأكثر فائدة

    if (!awareness || !usefulness) {
      toast('يرجى الإجابة على الأسئلة الأساسية', 'err');
      return;
    }

    // نحفظ تقييمات مجهّلة فقط — لا أسماء ولا بيانات تعريفية
    Store.saveSurvey({
      awareness: Number(awareness),
      usefulness: Number(usefulness),
      targeted,
      feature,
    });

    form.style.display = 'none';
    const done = $('#survey-done');
    if (done) { done.classList.add('show'); done.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    toast('شكراً لمشاركتك! تم الحفظ محلياً', 'ok');
  });
}


/* ---------- إبراز خطوة الرحلة الحالية في شريط التنقل ---------- */
function initScrollSpy() {
  const links = $$('.nav-links a[href^="#"]');
  if (!links.length || !('IntersectionObserver' in window)) return;
  const map = new Map(links.map(a => [a.getAttribute('href').slice(1), a]));
  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (!e.isIntersecting) return;
      links.forEach(a => a.classList.remove('active'));
      map.get(e.target.id)?.classList.add('active');
    });
  }, { rootMargin: '-45% 0px -50% 0px' });
  map.forEach((_, id) => { const s = document.getElementById(id); if (s) io.observe(s); });
}

/* ---------- تبويبات صندوق الأدوات (متوافقة مع لوحة المفاتيح) ---------- */
function initTabs() {
  $$('[role="tablist"]').forEach(list => {
    const tabs = $$('[role="tab"]', list);
    const select = (tab) => {
      tabs.forEach(t => {
        const on = t === tab;
        t.classList.toggle('active', on);
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
        const panel = document.getElementById(t.getAttribute('aria-controls'));
        if (panel) panel.hidden = !on;
      });
    };
    tabs.forEach((t, i) => {
      t.addEventListener('click', () => select(t));
      t.addEventListener('keydown', (e) => {
        if (e.key === 'Home' || e.key === 'End') {
          e.preventDefault(); const n = e.key === 'Home' ? tabs[0] : tabs[tabs.length - 1]; select(n); n.focus(); return;
        }
        const d = e.key === 'ArrowLeft' ? 1 : e.key === 'ArrowRight' ? -1 : 0;   // RTL
        if (!d) return;
        const n = tabs[(i + d + tabs.length) % tabs.length];
        select(n); n.focus();
      });
    });
  });
}

/* ---------- ملخصات حيّة في الرئيسية ---------- */
function initTeasers() {
  // قائمة المواقع المشبوهة: من آخر نسخة محفوظة (إن وُجدت)
  const ftTotal = $('#ft-total');
  if (ftTotal) {
    const feed = Store.getFeed();
    if (feed && feed.lists) {
      const urls = new Set(feed.lists.flatMap(l => l.urls));
      const sa = [...urls].filter(u => /absher|nafath|rajhi|alahli|snb|riyad|alinma|stc|mada|sadad|spl|tabby|tamara|\.sa[\/:]|\.sa$/i.test(u)).length;
      ftTotal.textContent = urls.size.toLocaleString('ar-EG');
      $('#ft-sa').textContent = sa.toLocaleString('ar-EG');
    } else {
      ftTotal.textContent = '—';
      $('#ft-sa').textContent = '—';
    }
  }
  // تقدّم قائمة التحصين
  const bar = $('#pc-bar');
  if (bar) {
    const done = Object.values(Store.getChecklist()).filter(Boolean).length;
    const total = 9;
    bar.style.width = Math.round(done / total * 100) + '%';
    if (done) $('#pc-progress-txt').textContent = `أنجزت ${done.toLocaleString('ar-EG')} من ${total.toLocaleString('ar-EG')} خطوات—أكمل الباقي.`;
  }
  // زر «افحص رابطاً الآن» ينقل التركيز لحقل الإدخال
  const heroBtn = $('#hero-check');
  if (heroBtn) heroBtn.addEventListener('click', (e) => {
    e.preventDefault();
    const inp = $('#url-input');
    inp.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => inp.focus({ preventScroll: true }), 350);
  });
}

/* ---------- الإقلاع ---------- */
document.addEventListener('DOMContentLoaded', () => {
  // الرقائق التفاعلية تعمل بلوحة المفاتيح أيضاً
  $$('.chip[data-url], .chip[data-msg]').forEach(c => {
    c.setAttribute('role', 'button'); c.setAttribute('tabindex', '0');
    c.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); c.click(); } });
  });
  initTheme(); initNav(); initCounters(); initDailyTip(); initScrollSpy(); initTabs(); initTeasers();
  initInspector(); initMessageChecker(); initPasswordTool(); initQuiz(); initChecklist(); initSim(); initSurvey();
  initLearningFeatures();
});

export { toast };
