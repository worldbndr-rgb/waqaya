import { Store } from './storage.js';
import { dailyChallenge, completeChallenge, activeStreak, INCIDENTS } from './learning.js';
import { esc } from './analyzers.js';

const $ = id => document.getElementById(id);
const CHECK_KEYS = ['2fa-email', '2fa-bank', 'pw-manager', 'unique-pw', 'updates', 'verify-sender', 'no-otp', 'backup', 'report-know'];

export function initLearningFeatures() {
  if (!$('learning-progress')) return;
  let challengeDay = '';
  function progress() {
    const state = Store.getLearning();
    const quizzes = Store.getQuiz();
    const quizScores = (Array.isArray(quizzes) ? quizzes : []).map(q => q?.pct).filter(n => Number.isFinite(n) && n >= 0 && n <= 100);
    const checks = Store.getChecklist();
    const done = CHECK_KEYS.filter(key => checks?.[key] === true).length;
    $('progress-streak').textContent = String(activeStreak(state));
    $('progress-best').textContent = quizScores.length ? Math.max(...quizScores) + '%' : '—';
    $('progress-check').textContent = done + ' / 9';
    const next = $('progress-next');
    if (done === 9) { next.textContent = 'راجع تحدي اليوم'; next.href = '#daily-challenge'; }
    else if (quizScores.length) { next.textContent = 'أكمل خطوات الحماية'; next.href = 'pages/protection.html#checklist'; }
    else { next.textContent = 'ابدأ اختبار الوعي'; next.href = '#train'; }
  }
  function renderChallenge() {
    const challenge = dailyChallenge();
    challengeDay = challenge.day;
    const state = Store.getLearning();
    const completed = state.lastDay === challenge.day;
    $('challenge-day').textContent = new Date().toLocaleDateString('ar-SA', { weekday: 'long', day: 'numeric', month: 'long' });
    $('challenge-channel').textContent = challenge.channel;
    $('challenge-title').textContent = challenge.title;
    $('challenge-message').textContent = challenge.message;
    const choices = $('challenge-choices');
    choices.replaceChildren();
    const feedback = $('challenge-feedback');
    feedback.replaceChildren(); feedback.hidden = true;
    const explain = correct => {
      feedback.hidden = false;
      feedback.className = 'challenge-feedback ' + (correct ? 'correct' : 'review');
      const title = document.createElement('strong');
      title.textContent = correct ? 'قرار واعٍ. أحسنت التحقّق.' : 'فرصة للتعلّم. هذا هو التصرف الأفضل.';
      const detail = document.createElement('p'); detail.textContent = challenge.explanation;
      const rule = document.createElement('p'); rule.className = 'challenge-rule'; rule.textContent = challenge.rule;
      feedback.append(title, detail, rule);
      $('challenge-status').textContent = 'اكتمل تحدي اليوم. يتغيّر الموقف غدًا؛ يمكنك مواصلة الاختبار الآن.';
    };
    challenge.choices.forEach((label, index) => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'challenge-choice';
      button.textContent = label; button.disabled = completed;
      if (completed && index === challenge.answer) button.classList.add('is-correct');
      button.addEventListener('click', () => {
        // A tab left open overnight must not record yesterday's question as today's challenge.
        if (dailyChallenge().day !== challengeDay) { renderChallenge(); return; }
        const already = Store.getLearning();
        if (already.lastDay === challengeDay) { renderChallenge(); return; }
        const correct = index === challenge.answer;
        const saved = Store.saveLearning(completeChallenge(already, new Date(), correct ? 1 : 0));
        choices.querySelectorAll('button').forEach((b, i) => {
          b.disabled = true; b.classList.toggle('is-correct', i === challenge.answer);
          if (i === index && !correct) b.classList.add('is-wrong');
        });
        explain(correct); progress();
        if (!saved) $('challenge-status').textContent = 'اكتمل التحدي، لكن متصفحك لم يسمح بحفظ التقدّم.';
        feedback.tabIndex = -1; feedback.focus({ preventScroll: true });
      });
      choices.append(button);
    });
    if (completed) explain(state.score === 1);
    else $('challenge-status').textContent = 'موقف واحد، وقرار واحد. لا تحتاج إلى تسجيل أو إدخال أي بيانات.';
  }
  progress(); renderChallenge();
  const resources = $('resource-videos');
  resources?.addEventListener('toggle', () => {
    resources.querySelectorAll('iframe[data-src]').forEach(frame => {
      if (resources.open && !frame.getAttribute('src')) frame.src = frame.dataset.src;
      else if (!resources.open) frame.removeAttribute('src');
    });
  });
  window.addEventListener('wiqaya:progress', progress);
  window.addEventListener('pageshow', () => { progress(); renderChallenge(); });
  window.addEventListener('storage', event => {
    if ([Store.KEYS.quiz, Store.KEYS.check, Store.KEYS.learning, null].includes(event.key)) { progress(); renderChallenge(); }
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { progress(); if (dailyChallenge().day !== challengeDay) renderChallenge(); }
  });
  initResponsePlan();
}

function initResponsePlan() {
  let selected = 'clicked';
  const options = [...document.querySelectorAll('[data-incident]')];
  const status = $('response-status');
  function select(key) {
    if (!Object.hasOwn(INCIDENTS, key)) return;
    selected = key;
    const incident = INCIDENTS[key];
    options.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.incident === key)));
    $('response-title').textContent = incident.title;
    $('response-priority').textContent = incident.priority;
    $('response-steps').innerHTML = incident.steps.map((step, index) =>
      `<li><label><input type="checkbox" data-response-step><span class="response-number" aria-hidden="true">${index + 1}</span><span>${esc(step)}</span></label></li>`).join('');
    $('response-steps').querySelectorAll('input').forEach(input => input.addEventListener('change', update));
    $('response-copy-fallback').hidden = true;
    status.textContent = 'خطتك جاهزة. أشر على الخطوات أثناء تنفيذها؛ لا يُحفظ اختيار الحالة أو يُرسل.';
    update();
  }
  function update() {
    const checked = $('response-steps').querySelectorAll('input:checked').length;
    $('response-count').textContent = checked + ' من ' + INCIDENTS[selected].steps.length + ' خطوات';
    $('response-progress').value = checked;
    $('response-progress').max = INCIDENTS[selected].steps.length;
  }
  const planText = () => {
    const incident = INCIDENTS[selected];
    return ['وقاية — خطة استجابة: ' + incident.label, incident.priority, '', ...incident.steps.map((step, i) => `${i + 1}. ${step}`), '', 'إرشاد عام؛ الإجراءات الفعلية يحددها البنك أو الجهة المختصة.'].join('\n');
  };
  options.forEach(button => button.addEventListener('click', () => select(button.dataset.incident)));
  $('response-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(planText()); status.textContent = 'نُسخت الخطة. لا تتضمن بيانات شخصية.'; }
    catch {
      const fallback = $('response-copy-fallback'); fallback.value = planText(); fallback.hidden = false; fallback.focus(); fallback.select();
      status.textContent = 'حدّدنا نص الخطة لتنسخه يدويًا.';
    }
  });
  $('response-save').addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob(['\uFEFF' + planText()], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = 'وقاية-خطة-استجابة.txt';
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    status.textContent = 'جهّزنا ملف الخطة للحفظ على جهازك.';
  });
  select(selected);
}
