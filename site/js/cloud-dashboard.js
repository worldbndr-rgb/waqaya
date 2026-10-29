import { Store } from './storage.js';
const $ = id => document.getElementById(id);
const DAYS = ['الأحد','الإثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
const VECTORS = { 'fake-login-form': 'نموذج مضمّن', 'fullscreen-fake-login': 'صفحة كاملة', 'fake-domain': 'نطاق مزيّف' };
const FEATURES = { inspector: 'فاحص الروابط', password: 'فاحص كلمة المرور', quiz: 'الاختبار', checklist: 'قائمة التحصين' };
const number = v => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0;
let summary = null, busy = false;

if (Store.getTheme() === 'light') document.body.classList.add('theme-light');
$('summary-theme').addEventListener('click', () => {
  document.body.classList.toggle('theme-light');
  Store.setTheme(document.body.classList.contains('theme-light') ? 'light' : 'dark');
});

function metric(label, value) {
  const card = document.createElement('div'); card.className = 'card';
  const term = document.createElement('dt'); term.textContent = label;
  const detail = document.createElement('dd'); detail.textContent = value;
  card.append(term, detail); $('summary-metrics').append(card);
}
function bars(id, rows) {
  const target = $(id); target.replaceChildren();
  const max = Math.max(1, ...rows.map(([, n]) => number(n)));
  for (const [label, n] of rows) {
    const row = document.createElement('div'); row.className = 'summary-row';
    const text = document.createElement('span'); text.textContent = label;
    const progress = document.createElement('progress'); progress.max = max; progress.value = number(n); progress.setAttribute('aria-label', label);
    const value = document.createElement('b'); value.textContent = number(n).toLocaleString('ar-SA');
    row.append(text, progress, value); target.append(row);
  }
}
function render(s) {
  $('summary-metrics').replaceChildren();
  metric('تفاعلات المحاكاة', number(s.simCount).toLocaleString('ar-SA'));
  metric('نسبة الوقوع في المحاكاة الكاملة', number(s.counters?.fl_views) ? Math.round(number(s.counters?.fl_submits) / number(s.counters.fl_views) * 100) + '%' : '—');
  metric('محاولات الاختبار', number(s.quizCount).toLocaleString('ar-SA'));
  metric('نسبة النجاح في الاختبار', s.passRate == null ? '—' : number(s.passRate) + '%');
  metric('متوسط طول الإدخال', s.avgLength == null ? '—' : number(s.avgLength) + ' محرف');
  metric('عدد الاستبيانات', number(s.surveyCount).toLocaleString('ar-SA'));
  metric('متوسط تقييم الفائدة', s.usefulnessAvg == null ? '—' : number(s.usefulnessAvg) + ' / 5');
  metric('آخر يوم تفاعل (UTC)', /^\d{4}-\d{2}-\d{2}$/.test(s.lastDay || '') ? s.lastDay : '—');
  bars('summary-days', DAYS.map((day, i) => [day, s.byDay?.[i]]));
  bars('summary-vectors', Object.entries(VECTORS).map(([key, label]) => [label, s.vectors?.[key]]));
  bars('summary-features', Object.entries(FEATURES).map(([key, label]) => [label, s.features?.[key]]));
  $('summary-survey').textContent = `متوسط الوعي: ${s.awarenessAvg == null ? '—' : number(s.awarenessAvg)} / 5. عدد من ذكروا تعرّضهم للتصيّد: ${number(s.targetedCount)}. الإجمالي: ${number(s.surveyCount)} استبياناً.`;
}
async function refresh() {
  if (busy) return;
  busy = true; $('summary-refresh').disabled = true;
  try {
    const result = await Store.getRemoteAll();
    if (!result?.summary) throw new Error('unavailable');
    summary = result.summary; render(summary);
    $('summary-status').textContent = 'المصدر: Supabase — إحصاءات مجمّعة. آخر تحديث: ' + new Date().toLocaleTimeString('ar-SA');
    $('summary-csv').disabled = false; $('summary-json').disabled = false;
  } catch {
    $('summary-status').textContent = summary ? 'تعذّر التحديث؛ الأرقام الظاهرة من آخر اتصال ناجح.' : 'تعذّر الاتصال بالإحصاءات المجمّعة. يمكنك فتح سجل هذا المتصفح أو المحاولة مجدداً.';
  } finally { busy = false; $('summary-refresh').disabled = false; }
}
function download(name, mime, body) {
  const url = URL.createObjectURL(new Blob([body], { type: mime + ';charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('summary-json').addEventListener('click', () => {
  if (summary) download('وقاية_إحصاءات_مجمعة.json', 'application/json', JSON.stringify({ source: 'aggregate', summary }, null, 2));
});
$('summary-csv').addEventListener('click', () => {
  if (!summary) return;
  const rows = [['المؤشر', 'القيمة'], ...[...$('summary-metrics').children].map(card => [card.querySelector('dt').textContent, card.querySelector('dd').textContent])];
  const quote = v => '"' + String(v).replace(/"/g, '""') + '"';
  download('وقاية_إحصاءات_مجمعة.csv', 'text/csv', '\uFEFF' + rows.map(row => row.map(quote).join(',')).join('\n'));
});
$('summary-refresh').addEventListener('click', refresh);
refresh();
setInterval(() => { if (!document.hidden) refresh(); }, 60000);
