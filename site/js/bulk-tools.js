import {syncThreats,threatMatch,getThreatCache} from './threat-sync.js';
import {analyzeUrl} from './analyzers.js';
const $=id=>document.getElementById(id);
let results=[];let threatData=getThreatCache();
const labels={danger:'مخاطر مرتفعة',warn:'تحتاج مراجعة',safe:'مؤشرات منخفضة'};
function cell(row,text,cls){const td=document.createElement('td');td.textContent=text;if(cls)td.className=cls;row.appendChild(td)}
function render(){const filter=$('filter').value;const body=$('rows');body.replaceChildren();for(const item of results.filter(x=>filter==='all'||(x.listed?'danger':x.result.level)===filter)){const tr=document.createElement('tr');cell(tr,item.url);cell(tr,item.result.registrable||item.result.host||'—');cell(tr,item.listed?'مدرج بقائمة تصيّد':(labels[item.result.level]||'غير معروف'),'risk-'+(item.listed?'danger':item.result.level));cell(tr,(item.result.flags||[]).filter(f=>f.t!=='good').map(f=>f.title).slice(0,4).join('، ')||'لم تظهر مؤشرات بارزة');body.appendChild(tr)}}
$('scan').addEventListener('click',()=>{const lines=$('links').value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);const unique=[...new Set(lines)];if(unique.length>100){$('status').textContent='الحد الأقصى 100 رابط. قلّل العدد وأعد المحاولة.';return}results=unique.map(url=>({url,result:analyzeUrl(url),listed:!!threatMatch(url,threatData)})).filter(x=>x.result);$('results').hidden=!results.length;$('status').textContent=results.length?`تم تحليل ${results.length} رابط محليًا. ${lines.length-unique.length} تكرارات أُزيلت.`:'أدخل رابطًا واحدًا على الأقل.';$('total').textContent=results.length;for(const k of ['danger','warn','safe'])$(k).textContent=results.filter(x=>(x.listed?'danger':x.result.level)===k).length;render()});
$('filter').addEventListener('change',render);
$('demo').addEventListener('click',()=>{$('links').value='https://example.com\nhttp://192.0.2.1/login\nhttps://absher.sa\nhttps://bit.ly/example';$('scan').click()});
$('clear').addEventListener('click',()=>{$('links').value='';results=[];$('results').hidden=true;$('status').textContent='تم المسح.'});
function csvValue(x){let s=String(x??'');if(/^[\s]*[=+@-]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"'}
$('csv').addEventListener('click',()=>{const rows=[['الرابط','النطاق','التصنيف','المؤشرات'],...results.map(x=>[x.url,x.result.registrable||x.result.host,labels[x.result.level],(x.result.flags||[]).map(f=>f.title).join(' | ')])];const blob=new Blob(['\ufeff'+rows.map(r=>r.map(csvValue).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'});const u=URL.createObjectURL(blob);const a=document.createElement('a');a.href=u;a.download='waqaya-url-analysis.csv';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000)});
$('copy').addEventListener('click',async()=>{const summary=results.map(x=>`${x.url} — ${labels[x.result.level]}`).join('\n');try{await navigator.clipboard.writeText(summary);$('status').textContent='تم نسخ الملخص.'}catch{$('status').textContent='تعذر النسخ؛ استخدم تنزيل CSV.'}});

const feedStatus=$('feed-sync-status');
function showFeedStatus(message){if(feedStatus)feedStatus.textContent=message}
async function updateFeed(force=false){
 showFeedStatus('جارٍ تحديث قوائم التهديدات…');
 try{
   threatData=await syncThreats(force);
   const when=new Date(threatData.at).toLocaleString('ar-SA');
   showFeedStatus(`${threatData.stale?'نسخة محفوظة (قديمة)':'آخر تحديث'}: ${when} — ${threatData.urls.length} رابط — ${threatData.sources.join('، ')}${threatData.failed?' (بعض المصادر غير متاحة)':''}`);
   if(results.length){results.forEach(x=>x.listed=!!threatMatch(x.url,threatData));$('scan').click()}
 }catch(e){showFeedStatus('تعذّر جلب القوائم. يستمر التحليل المحلي دون قاعدة التهديدات.')}
}
$('feed-sync').addEventListener('click',()=>updateFeed(true));
updateFeed();
setInterval(()=>updateFeed(),10*60*1000);
