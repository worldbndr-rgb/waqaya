import { FEEDS, parseFeed } from './threat-feed.js';
import { fetchSnapshot } from './scheduled-feed.js';
const KEY='waqaya_threat_sync_v1', TTL=10*60*1000;
let current=null;
export function getThreatCache(){try {return JSON.parse(localStorage.getItem(KEY))}catch{return null}}
export async function syncThreats(force=false){
 const old=getThreatCache();
 if(!force && old && Date.now()-old.at<TTL){current=old;return old}
 try {
   const snapshot=await fetchSnapshot('../data/threats.json');
   if(snapshot.lists.length){
     const merged={at:snapshot.at,sources:snapshot.sources,failed:snapshot.failed.length,
       urls:[...new Set(snapshot.lists.flatMap(x=>x.urls))],stale:Date.now()-snapshot.at>60*60*1000};
     current=merged;
     try{localStorage.setItem(KEY,JSON.stringify(merged))}catch{}
     return merged;
   }
 }catch(e){console.warn('Scheduled snapshot unavailable; using public feeds',e)}
 const settled=await Promise.allSettled(FEEDS.map(async feed=>{
   for(const url of feed.urls){
     try{
       const c=new AbortController(), timer=setTimeout(()=>c.abort(),15000);
       let response;
       try {response=await fetch(url,{cache:'no-store',signal:c.signal})}finally{clearTimeout(timer)}
       if(!response.ok)continue;
       const urls=parseFeed(await response.text(),5000);
       if(urls.length)return {source:feed.name,urls};
     }catch{}
   }
   throw new Error(feed.name);
 }));
 const good=settled.filter(x=>x.status==='fulfilled').map(x=>x.value);
 if(!good.length){if(old){current={...old,stale:true};return current}throw new Error('تعذّر جلب بيانات المصادر')}
 const merged={at:Date.now(),sources:good.map(x=>x.source),failed:FEEDS.length-good.length,
  urls:[...new Set(good.flatMap(x=>x.urls))]};
 current=merged;
 try{localStorage.setItem(KEY,JSON.stringify(merged))}catch{}
 return merged;
}
export function threatMatch(url,data=current||getThreatCache()){
 if(!data?.urls)return null;
 let target;
 try {const u=new URL(url);target=(u.origin+u.pathname).replace(/\/$/,'').toLowerCase()}catch{return null}
 const matched=data.urls.some(x=>{try {const u=new URL(x);return (u.origin+u.pathname).replace(/\/$/,'').toLowerCase()===target}catch{return false}});
 return matched?{matched:true,at:data.at}:null;
}
