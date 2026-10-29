// Read the deployment's server-updated snapshot; do not fetch or visit suspicious URLs.
export async function fetchSnapshot(path = '../data/threats.json') {
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),15000);
  try{
    const response=await fetch(path,{cache:'no-store',signal:controller.signal});
    if(!response.ok)throw new Error('snapshot HTTP '+response.status);
    const data=await response.json();
    if(data.schema!==1 || !Number.isFinite(data.at) || !Array.isArray(data.lists) || !data.lists.length)
      throw new Error('snapshot not initialized');
    const lists=data.lists.filter(x=>x && typeof x.source==='string' && Array.isArray(x.urls))
      .map(x=>({source:x.source,urls:x.urls.filter(u=>typeof u==='string' && /^https?:\/\//i.test(u))}));
    if(!lists.length)throw new Error('empty snapshot');
    return {at:data.at,lists,sources:data.sources||lists.map(x=>x.source),
      failed:Array.isArray(data.failed)?data.failed:[]};
  } finally{clearTimeout(timeout)}
}
