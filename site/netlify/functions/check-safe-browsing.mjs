const json = (status, obj) => new Response(JSON.stringify(obj), {
  status, headers: {"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}
});
export default async (request) => {
  if (request.method !== "POST") return json(405, {error:"استخدم POST"});
  const key = Netlify.env.get("GOOGLE_SAFE_BROWSING_API_KEY");
  if (!key) return json(503,{error:"خدمة Google Safe Browsing غير مفعلة؛ أضف المفتاح في إعدادات Netlify."});
  if (Number(request.headers.get("content-length") || 0) > 4096) return json(413,{error:"الطلب كبير"});
  let body;
  try { body = await request.json(); } catch { return json(400,{error:"JSON غير صالح"}); }
  const value = String(body?.url || "").trim();
  if (value.length > 2048 || !/^https?:\/\//i.test(value)) return json(400,{error:"أدخل رابط HTTP/HTTPS صحيحًا"});
  try {
    const parsed = new URL(value);
    if (!parsed.hostname.includes(".") || parsed.username || parsed.password) throw new Error("Invalid");
    const endpoint = "https://safebrowsing.googleapis.com/v4/threatMatches:find?key=" + encodeURIComponent(key);
    const controller = new AbortController();
    const timer = setTimeout(()=>controller.abort(),10000);
    let response;
    try {
      response = await fetch(endpoint,{
        method:"POST", signal:controller.signal,
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          client:{clientId:"waqaya",clientVersion:"2.0.0"},
          threatInfo:{
            threatTypes:["MALWARE","SOCIAL_ENGINEERING","UNWANTED_SOFTWARE","POTENTIALLY_HARMFUL_APPLICATION"],
            platformTypes:["ANY_PLATFORM"],threatEntryTypes:["URL"],
            threatEntries:[{url:value}]
          }
        })
      });
    } finally {clearTimeout(timer)}
    if (!response.ok) return json(502,{error:"تعذّر التحقق لدى Google. راجع المفتاح والحصة وشروط الخدمة."});
    const result=await response.json();
    const matches=Array.isArray(result.matches)?result.matches.map(m=>({type:m.threatType,platform:m.platformType})):[];
    return json(200,{checked:true,listed:matches.length>0,matches,
      note:"عدم ظهور تطابق لا يضمن سلامة الرابط."});
  } catch {return json(502,{error:"تعذّر إتمام الفحص. حاول لاحقًا."})}
};
