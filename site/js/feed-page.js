import { fetchSnapshot } from './scheduled-feed.js';
/* ============================================================
   feed-page.js — واجهة صفحة «المواقع المشبوهة الآن»
   ------------------------------------------------------------
   • تجلب القوائم مباشرة من الإنترنت عند فتح الصفحة، ثم كل 10 دقائق.
   • تحفظ آخر نسخة ناجحة محلياً لتعمل حتى دون اتصال، ولتُميّز
     الروابط الجديدة منذ آخر تحديث.
   • الروابط تُعرض «معطّلة» (hxxp و [.]) وغير قابلة للنقر أبداً.
   ============================================================ */
import { Store } from './storage.js';
import { FEEDS, parseFeed, buildItems, summarize, defang, lookup, hostOf } from './threat-feed.js';
import { esc } from './analyzers.js';

const $ = (s, r = document) => r.querySelector(s);
const REFRESH_MS = 10 * 60 * 1000;
const PAGE = 60;

let liveLoaded = false, items = [], shown = PAGE, prevSet = new Set(), hostSet = new Set(), lastAt = null, nextAt = 0;
const filter = { q: '', source: 'all', saOnly: false, newOnly: false };

async function fetchFeed(feed) {
  let lastErr;
  for (const url of feed.urls) {
    try {
      const c = new AbortController();
      const t = setTimeout(() => c.abort(), 20000);
      const r = await fetch(url, { cache: 'no-store', signal: c.signal });
      clearTimeout(t);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const urls = parseFeed(await r.text());
      if (!urls.length) throw new Error('empty');
      return urls;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('failed');
}

function setStatus(kind, text) {
  const el = $('#feed-status');
  el.className = 'feed-status ' + kind;
  el.innerHTML = text;
}

async function refresh(manual = false) {
  const btn = $('#feed-refresh');
  btn.disabled = true;
  btn.querySelector('i').classList.add('fa-spin');
  setStatus('loading', '<i class="fas fa-satellite-dish"></i> جارٍ جلب أحدث القوائم من الإنترنت…');

  // Prefer the server-side scheduled data (works even if the visitor was away).
  try {
    const snapshot=await fetchSnapshot('../data/threats.json');
    btn.disabled=false;
    btn.querySelector('i').classList.remove('fa-spin');
    nextAt=Date.now()+REFRESH_MS;
    const newCount=apply(snapshot.lists,snapshot.at,true);
    const details = document.getElementById('source-health') || document.createElement('div');
    details.id = 'source-health';
    details.setAttribute('role', 'status');
    details.style.cssText = 'margin:16px 0;padding:16px;border:1px solid currentColor;border-radius:12px;line-height:2';
    details.replaceChildren();
    const heading = document.createElement('strong'); heading.textContent = 'حالة المصادر — آخر جلب ناجح (وليس وقت اكتشاف التهديد)'; details.append(heading);
    for (const [source, health] of Object.entries(snapshot.sourceStatus)) {
      const row = document.createElement('div');
      row.textContent = `${source}: ${health.ok ? 'متاح' : health.cached ? 'تعذّر الجلب — نسخة محفوظة' : 'غير متاح'} · ${health.lastSuccessAt ? new Date(health.lastSuccessAt).toLocaleString('ar-SA') : 'لم يُسجّل جلب ناجح'}`;
      details.append(row);
    }
    if (snapshot.disabled.length) {const row=document.createElement('div');row.textContent='URLhaus غير مفعّل: يحتاج مفتاح API.';details.append(row);}
    document.getElementById('feed-status').after(details);
    liveLoaded=true;
    Store.saveFeed({at:snapshot.at,lists:snapshot.lists});
    const stale=Date.now()-snapshot.at>60*60*1000;
    setStatus(stale?'offline':'live',
      `${stale?'⚠️ آخر نسخة مجدولة قديمة':'<span class="live-dot"></span> تحديث مجدول'} — ${new Date(snapshot.at).toLocaleString('ar-SA')} · ${items.length.toLocaleString('ar-EG')} رابط`+
      (snapshot.failed.length?' · تعذّر بعض المصادر: '+snapshot.failed.join('، '):''));
    return;
  } catch(e) { console.warn('Scheduled snapshot not available, fetching feeds directly',e); }
  const results = await Promise.allSettled(FEEDS.map(fetchFeed));
  const lists = [], failed = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') lists.push({ source: FEEDS[i].id, urls: r.value });
    else failed.push(FEEDS[i].name);
  });

  btn.disabled = false;
  btn.querySelector('i').classList.remove('fa-spin');
  nextAt = Date.now() + REFRESH_MS;

  if (!lists.length) {
    const cache = Store.getFeed();
    if (cache && !liveLoaded) {
      if (!items.length) apply(cache.lists, cache.at, false);
      setStatus('offline', `<i class="fas fa-plug-circle-xmark"></i> تعذّر الاتصال بالمصادر—نعرض آخر نسخة محفوظة ${fmtAgo(cache.at)}.`);
    } else if (!items.length) {
      setStatus('offline', '<i class="fas fa-plug-circle-xmark"></i> تعذّر جلب القوائم. تحقّق من اتصالك بالإنترنت ثم اضغط «تحديث».');
      $('#feed-list').innerHTML = '<div class="empty">لا توجد بيانات بعد.</div>';
    } else {
      setStatus('offline', '<i class="fas fa-plug-circle-xmark"></i> فشل التحديث الأخير—البيانات المعروضة من التحديث السابق.');
    }
    return;
  }

  const newCount = apply(lists, Date.now(), true);
  liveLoaded = true;
  Store.saveFeed({ at: lastAt, lists });
  const partial = failed.length ? ` <span class="warn-txt">(تعذّر: ${failed.join('، ')})</span>` : '';
  const fresh = prevSet.size && newCount ? ` · <b class="new-txt">${newCount.toLocaleString('ar-EG')} رابط جديد</b> منذ آخر تحديث` : '';
  setStatus('live', `<span class="live-dot"></span> مباشر — آخر تحديث ${new Date(lastAt).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' })}${fresh}${partial}`);
  if (manual && !newCount && prevSet.size) toast('القوائم محدّثة—لا روابط جديدة منذ آخر جلب');
}

/* يطبّق البيانات ويعيد عدد الروابط الجديدة */
function apply(lists, at, markNew) {
  const oldSet = items.length ? new Set(items.map(i => i.url)) : prevSet;
  items = buildItems(lists);
  let newCount = 0;
  items.forEach(it => {
    it.isNew = markNew && oldSet.size > 0 && !oldSet.has(it.url);
    if (it.isNew) newCount++;
  });
  // الجديد أولاً
  items.sort((a, b) => (b.isNew ? 1 : 0) - (a.isNew ? 1 : 0));
  prevSet = oldSet;
  hostSet = new Set(items.map(i => i.host));
  lastAt = at;
  shown = PAGE;
  renderStats();
  renderList();
  return newCount;
}

function fmtAgo(ts) {
  const plural = (n, one, two, few, many) => n === 1 ? one : n === 2 ? two : n <= 10 ? `${n} ${few}` : `${n} ${many}`;
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return 'قبل لحظات';
  if (m < 60) return 'قبل ' + plural(m, 'دقيقة', 'دقيقتين', 'دقائق', 'دقيقة');
  const h = Math.round(m / 60);
  if (h < 48) return 'قبل ' + plural(h, 'ساعة', 'ساعتين', 'ساعات', 'ساعة');
  return 'قبل ' + plural(Math.round(h / 24), 'يوم', 'يومين', 'أيام', 'يوماً');
}

function renderStats() {
  const s = summarize(items);
  const n = (v) => Number(v).toLocaleString('ar-EG');
  $('#st-total').textContent = n(s.total);
  $('#st-domains').textContent = n(s.domains);
  $('#st-sa').textContent = n(s.saudi);
  $('#st-https').textContent = s.httpsPct + '%';

  const bars = (rows, id) => {
    const max = rows.length ? rows[0][1] : 1;
    $(id).innerHTML = rows.length ? rows.map(([k, v]) => `
      <div class="bar-row"><span class="bar-k" dir="auto">${esc(k)}</span>
        <span class="bar-track"><i style="width:${Math.max(4, Math.round(v / max * 100))}%"></i></span>
        <span class="bar-v">${n(v)}</span></div>`).join('') : '<div class="empty" style="padding:10px">لا بيانات</div>';
  };
  bars(s.topBrands, '#top-brands');
  bars(s.topTlds, '#top-tlds');
  bars(s.topHosting, '#top-hosting');

  const counts = {};
  items.forEach(i => { counts[i.source] = (counts[i.source] || 0) + 1; });
  document.querySelectorAll('[id^=src-]').forEach(el => {el.textContent=n(counts[el.id.slice(4)]||0);});
}

function filtered() {
  const q = filter.q.toLowerCase();
  return items.filter(i =>
    (filter.source === 'all' || i.source === filter.source) &&
    (!filter.saOnly || i.sa) &&
    (!filter.newOnly || i.isNew) &&
    (!q || i.url.toLowerCase().includes(q) || (i.target || '').toLowerCase().includes(q)));
}

function renderList() {
  const list = filtered();
  $('#feed-count').textContent = `${list.length.toLocaleString('ar-EG')} نتيجة`;
  const box = $('#feed-list');
  if (!list.length) { box.innerHTML = '<div class="empty">لا نتائج مطابقة.</div>'; $('#feed-more').hidden = true; return; }
  const srcName = {...Object.fromEntries(FEEDS.map(f => [f.id, f.name])),phishunt:'Phishunt',urlhaus:'URLhaus'};
  box.innerHTML = list.slice(0, shown).map(i => `
    <div class="feed-row${i.isNew ? ' is-new' : ''}">
      <div class="fr-main">
        <code class="fr-url" dir="ltr">${esc(defang(i.url))}</code>
        <div class="fr-tags">
          ${i.isNew ? '<span class="tag new">جديد</span>' : ''}
          ${i.target ? `<span class="tag tgt${i.sa ? ' sa' : ''}"><i class="fas fa-bullseye"></i> ${esc(i.target)}</span>` : ''}
          ${i.hosting ? `<span class="tag">استضافة مجانية: ${esc(i.hosting)}</span>` : ''}
          <span class="tag dim" dir="ltr">.${esc(i.tld)}</span>
          <span class="tag dim">${esc(srcName[i.source] || i.source)}</span>
        </div>
      </div>
      <button class="icon-btn fr-copy" data-u="${esc(defang(i.url))}" aria-label="نسخ الرابط المعطّل"><i class="fas fa-copy"></i></button>
    </div>`).join('');
  $('#feed-more').hidden = list.length <= shown;
}

function toast(msg) {
  let host = $('.toast-host');
  if (!host) { host = document.createElement('div'); host.className = 'toast-host'; document.body.appendChild(host); }
  const el = document.createElement('div');
  el.className = 'toast info';
  el.innerHTML = `<i class="fas fa-circle-info"></i><span>${esc(msg)}</span>`;
  host.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

function initChecker() {
  const form = $('#lookup-form'), out = $('#lookup-out');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const r = lookup($('#lookup-input').value, hostSet);
    if (!r) { out.innerHTML = ''; return; }
    if (!items.length) { out.className = 'lookup-out warn'; out.textContent = 'انتظر حتى تُحمَّل القوائم ثم أعد المحاولة.'; return; }
    out.className = 'lookup-out ' + (r.listed ? 'bad' : 'ok');
    out.innerHTML = r.listed
      ? `<i class="fas fa-skull-crossbones"></i> النطاق <code dir="ltr">${esc(r.host)}</code> <b>مُدرج</b> في قوائم التصيّد الحالية. لا تفتحه، وبلّغ عنه.`
      : `<i class="fas fa-circle-info"></i> <code dir="ltr">${esc(r.host)}</code> غير موجود في القوائم الحالية—وهذا <b>لا يعني</b> أنه آمن؛ المواقع الجديدة تظهر كل دقيقة. افحصه أيضاً في <a href="../index.html#inspector">فاحص الروابط</a>.`;
  });
}

document.addEventListener('DOMContentLoaded', () => {
  // عرض آخر نسخة محفوظة فوراً (إن وُجدت) ثم الجلب المباشر
  const cache = Store.getFeed();
  if (cache && cache.lists) {
    apply(cache.lists, cache.at, false);
    prevSet = new Set(items.map(i => i.url));
    setStatus('loading', `<i class="fas fa-clock-rotate-left"></i> نسخة محفوظة ${fmtAgo(cache.at)} — جارٍ التحديث…`);
  }

  $('#feed-refresh').addEventListener('click', () => refresh(true));
  $('#feed-q').addEventListener('input', (e) => { filter.q = e.target.value.trim(); shown = PAGE; renderList(); });
  $('#feed-src').addEventListener('change', (e) => { filter.source = e.target.value; shown = PAGE; renderList(); });
  $('#feed-sa').addEventListener('change', (e) => { filter.saOnly = e.target.checked; shown = PAGE; renderList(); });
  $('#feed-new').addEventListener('change', (e) => { filter.newOnly = e.target.checked; shown = PAGE; renderList(); });
  $('#feed-more').addEventListener('click', () => { shown += PAGE; renderList(); });
  $('#feed-list').addEventListener('click', async (e) => {
    const b = e.target.closest('.fr-copy');
    if (!b) return;
    try { await navigator.clipboard.writeText(b.dataset.u); toast('نُسخ الرابط بصيغته المعطّلة الآمنة'); } catch { /* ignore */ }
  });
  initChecker();

  refresh();
  // تحديث تلقائي كل 10 دقائق + عدّاد تنازلي (يتوقف مؤقتاً إذا كانت الصفحة مخفية)
  setInterval(() => {
    const left = Math.max(0, nextAt - Date.now());
    const el = $('#feed-next');
    if (el && nextAt) el.textContent = `التحديث التلقائي بعد ${Math.floor(left / 60000)}:${String(Math.floor(left / 1000) % 60).padStart(2, '0')}`;
    if (nextAt && left === 0 && document.visibilityState === 'visible') { nextAt = Date.now() + REFRESH_MS; refresh(); }
  }, 1000);
});

export { hostOf };
