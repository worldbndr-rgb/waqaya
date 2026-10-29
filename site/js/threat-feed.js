/* ============================================================
   threat-feed.js — منطق قوائم التصيّد المباشرة (بدون واجهة)
   ------------------------------------------------------------
   المصادر: قوائم مفتوحة يحدّثها باحثو أمن حول العالم وتُقرأ
   مباشرة من المتصفح (GitHub يسمح بالقراءة عبر CORS):
     • OpenPhish Community Feed  — يُحدَّث كل 12 ساعة (استخدام غير تجاري)
     • Phishing.Database          — روابط جديدة اليوم، تُحدَّث عدة مرات يومياً (MIT)
   ============================================================ */
import { registrableDomain } from './analyzers.js';

export const FEEDS = [
  {
    id: 'openphish', name: 'OpenPhish', home: 'https://openphish.com',
    note: 'تغذية مجتمعية، تُحدَّث كل 12 ساعة',
    urls: ['https://raw.githubusercontent.com/openphish/public_feed/main/feed.txt'],
  },
  {
    id: 'phishdb', name: 'Phishing.Database', home: 'https://github.com/Phishing-Database/Phishing.Database',
    note: 'روابط تصيّد جديدة مكتشفة اليوم',
    urls: [
      'https://raw.githubusercontent.com/Phishing-Database/Phishing.Database/master/phishing-links-NEW-today.txt',
      'https://raw.githubusercontent.com/mitchellkrogza/Phishing.Database/master/phishing-links-NEW-today.txt',
    ],
  },
];

export const MAX_PER_FEED = 5000;

/* يحوّل نص القائمة إلى روابط سليمة (يتجاهل الأسطر الفارغة والتعليقات) */
export function parseFeed(text, max = MAX_PER_FEED) {
  const out = [];
  const seen = new Set();
  for (const line of String(text || '').split(/\r?\n/)) {
    let u = line.trim();
    if (!u || u.startsWith('#') || u.startsWith('!') || /\s/.test(u)) continue;
    if (!/^https?:\/\//i.test(u)) u = 'http://' + u;
    let host;
    try { host = new URL(u).hostname.toLowerCase(); } catch { continue; }
    if (!host.includes('.')) continue;
    if (seen.has(u)) continue;
    seen.add(u); out.push(u);
    if (out.length >= max) break;
  }
  return out;
}

export function hostOf(u) {
  try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
}

/* «تعطيل» الرابط ليُعرض بأمان ولا يصبح قابلاً للنقر: hxxps://evil[.]com/login */
export function defang(u) {
  const m = String(u).match(/^(https?):\/\/([^/?#]+)(.*)$/i);
  if (!m) return String(u).replace(/\./g, '[.]');
  const scheme = m[1].toLowerCase().replace(/^http/, 'hxxp');
  return `${scheme}://${m[2].replace(/\./g, '[.]')}${m[3]}`;
}

/* الجهات المستهدفة: كلمة مفتاحية ← اسم للعرض */
export const TARGETS = [
  // سعودية
  { k: ['absher'], n: 'أبشر', sa: true },
  { k: ['nafath'], n: 'نفاذ', sa: true },
  { k: ['alrajhi', 'rajhi'], n: 'مصرف الراجحي', sa: true },
  { k: ['alahli', 'snb'], n: 'البنك الأهلي', sa: true },
  { k: ['riyadbank', 'riyad'], n: 'بنك الرياض', sa: true },
  { k: ['alinma', 'inma'], n: 'مصرف الإنماء', sa: true },
  { k: ['sabb'], n: 'ساب', sa: true },
  { k: ['albilad', 'bankalbilad'], n: 'بنك البلاد', sa: true },
  { k: ['stcpay', 'stc'], n: 'STC', sa: true },
  { k: ['mada'], n: 'مدى', sa: true },
  { k: ['sadad'], n: 'سداد', sa: true },
  { k: ['splonline', 'saudipost', 'spl'], n: 'البريد السعودي', sa: true },
  { k: ['tabby'], n: 'تابي', sa: true },
  { k: ['tamara'], n: 'تمارا', sa: true },
  { k: ['moi', 'muroor', 'tawakkalna', 'qiwa', 'najiz'], n: 'جهة حكومية سعودية', sa: true },
  // عالمية
  { k: ['paypal'], n: 'PayPal' },
  { k: ['apple', 'icloud', 'itunes'], n: 'Apple' },
  { k: ['microsoft', 'outlook', 'office365', 'office', 'onedrive', 'sharepoint', 'o365', 'hotmail'], n: 'Microsoft' },
  { k: ['google', 'gmail'], n: 'Google' },
  { k: ['amazon', 'amzn'], n: 'Amazon' },
  { k: ['netflix'], n: 'Netflix' },
  { k: ['facebook', 'meta', 'fb'], n: 'Facebook / Meta' },
  { k: ['instagram'], n: 'Instagram' },
  { k: ['whatsapp'], n: 'WhatsApp' },
  { k: ['telegram'], n: 'Telegram' },
  { k: ['dhl'], n: 'DHL' },
  { k: ['aramex'], n: 'Aramex' },
  { k: ['fedex'], n: 'FedEx' },
  { k: ['usps'], n: 'USPS' },
  { k: ['binance', 'coinbase', 'metamask', 'trustwallet', 'wallet', 'crypto'], n: 'منصّات عملات رقمية' },
  { k: ['chase', 'wellsfargo', 'bankofamerica', 'citi', 'hsbc'], n: 'بنوك عالمية' },
  { k: ['steam', 'roblox', 'epicgames'], n: 'منصّات ألعاب' },
  { k: ['adobe', 'docusign', 'dropbox', 'wetransfer'], n: 'خدمات مستندات' },
];

/* يصنّف الرابط: الجهة المستهدفة، هل يخص السعودية، الامتداد، مكان الاستضافة */
export function classify(u) {
  const host = hostOf(u);
  let path = '';
  try { path = decodeURIComponent(new URL(u).pathname).toLowerCase(); } catch { /* ignore */ }
  const tokens = (host + ' ' + path).split(/[^a-z0-9]+/).filter(Boolean);
  let target = null;
  for (const t of TARGETS) {
    if (tokens.some(tk => t.k.some(k => tk === k || (k.length >= 5 && tk.includes(k))))) { target = t; break; }
  }
  const tld = host.split('.').pop() || '';
  const sa = !!(target && target.sa) || tld === 'sa';
  const HOSTING = ['vercel.app', 'netlify.app', 'github.io', 'pages.dev', 'workers.dev', 'web.app', 'firebaseapp.com', 'weebly.com', 'wixsite.com', 'blogspot.com', 'glitch.me', 'r2.dev', 'webflow.io', 'framer.app', 'ipfs.io', 'godaddysites.com', 'square.site', 'sites.google.com'];
  const hosting = HOSTING.find(h => host === h || host.endsWith('.' + h) || (h.includes('/') && (host + path).includes(h))) || null;
  return { host, domain: registrableDomain(host), tld, target: target ? target.n : null, sa, hosting };
}

/* يدمج القوائم ويزيل التكرار ويصنّف كل رابط */
export function buildItems(lists) {
  const seen = new Set();
  const items = [];
  for (const { source, urls } of lists) {
    for (const url of urls) {
      if (seen.has(url)) continue;
      seen.add(url);
      items.push({ url, source, ...classify(url) });
    }
  }
  return items;
}

function top(map, n) {
  return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, n);
}

export function summarize(items) {
  const brands = {}, tlds = {}, hosts = {};
  const domains = new Set();
  let sa = 0, https = 0;
  for (const it of items) {
    if (it.target) brands[it.target] = (brands[it.target] || 0) + 1;
    if (it.tld) tlds['.' + it.tld] = (tlds['.' + it.tld] || 0) + 1;
    if (it.hosting) hosts[it.hosting] = (hosts[it.hosting] || 0) + 1;
    if (it.sa) sa++;
    if (it.url.startsWith('https://')) https++;
    domains.add(it.domain);
  }
  return {
    total: items.length,
    domains: domains.size,
    saudi: sa,
    httpsPct: items.length ? Math.round((https / items.length) * 100) : 0,
    topBrands: top(brands, 8),
    topTlds: top(tlds, 8),
    topHosting: top(hosts, 6),
  };
}

/* هل الرابط/النطاق موجود في القائمة؟ (مطابقة المضيف بالكامل) */
export function lookup(input, hostSet) {
  let u = String(input || '').trim();
  if (!u) return null;
  if (!/^https?:\/\//i.test(u)) u = 'http://' + u;
  const h = hostOf(u);
  if (!h) return null;
  return { host: h, listed: hostSet.has(h) };
}
