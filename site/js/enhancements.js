/* Progressive enhancements: no dependencies and no changes to existing app state. */
(() => {
  'use strict';
  const ready = () => {
    const progress = document.createElement('div');
    progress.className = 'ux-progress';
    progress.setAttribute('aria-hidden','true');
    document.body.append(progress);

    const top = document.createElement('button');
    top.type = 'button';
    top.className = 'ux-top';
    top.textContent = '↑';
    top.setAttribute('aria-label','العودة إلى أعلى الصفحة');
    top.title = 'العودة إلى الأعلى';
    top.addEventListener('click', () => window.scrollTo({
      top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'
    }));
    document.body.append(top);

    const banner = document.createElement('div');
    banner.className = 'ux-offline';
    banner.hidden = true;
    banner.setAttribute('role','status');
    banner.textContent = 'أنت غير متصل بالإنترنت؛ بعض الخدمات المباشرة قد لا تعمل.';
    document.body.append(banner);

    const updateConnection = () => { banner.hidden = navigator.onLine !== false; };
    addEventListener('online',updateConnection);
    addEventListener('offline',updateConnection);
    updateConnection();

    let scheduled = false;
    const updateScroll = () => {
      const max = Math.max(0,document.documentElement.scrollHeight - innerHeight);
      progress.style.width = (max ? Math.min(100,Math.max(0,scrollY/max*100)) : 0) + '%';
      top.classList.toggle('visible',scrollY > 400);
      scheduled = false;
    };
    const schedule = () => {
      if (!scheduled) { scheduled = true; requestAnimationFrame(updateScroll); }
    };
    addEventListener('scroll',schedule,{passive:true});
    addEventListener('resize',schedule,{passive:true});
    updateScroll();

    document.querySelectorAll('a[target="_blank"]').forEach(a => {
      const rel = new Set((a.getAttribute('rel') || '').split(/\s+/).filter(Boolean));
      rel.add('noopener'); rel.add('noreferrer');
      a.setAttribute('rel',Array.from(rel).join(' '));
    });
    document.querySelectorAll('img:not([loading])').forEach(img => {
      if (!img.closest('header,.hero,.home-hero')) img.loading = 'lazy';
      if (!img.hasAttribute('alt')) img.alt = '';
    });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',ready,{once:true});
  else ready();
})();
