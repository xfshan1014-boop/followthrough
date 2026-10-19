/* ===== Platform layer: web version and Mac app. The claude.ai Artifact boots without this file. =====
   Adds onboarding, settings, bring-your-own AI provider, import/export, board setup, Chinese UI,
   and live transcription. Everything is stored on the user's device; only an email is sent at sign-up. */
(function(){
const CFG=window.TRACKER_CONFIG||{};
const IS_MAC=!!(window.webkit&&window.webkit.messageHandlers&&window.webkit.messageHandlers.tracker);
/* Inside claude.ai the page is an Artifact: Claude is built in and the board is saved to the viewer's Claude account. */
const IS_ARTIFACT=!IS_MAC&&!!(window.claude&&window.claude.use);
const REPO_URL=CFG.repo||"https://github.com/xfshan1014-boop/followthrough";
const DOWNLOAD_URL=REPO_URL+"/releases/latest";
const ICON_SVG='<svg viewBox="0 0 512 512" aria-hidden="true"><rect width="512" height="512" rx="112" fill="#1c1b19"/><path d="M118 330 C 170 330, 190 170, 270 170 C 345 170, 345 270, 280 270 C 220 270, 230 340, 360 340" fill="none" stroke="#f6f6f3" stroke-width="40" stroke-linecap="round"/><circle cx="376" cy="340" r="38" fill="#e68d66"/></svg>';
const VERSION=CFG.version||"1.0.0";

/* ---------- preferences (this device only) ---------- */
const PREF_KEY="pm-tracker-prefs";
const P=Object.assign({lang:(navigator.language||"").toLowerCase().startsWith("zh")?"zh":"en",theme:"system",onboarded:false,email:"",signupPending:false,name:"",project:"",role:"",ai:null});
/* Mac app: data is kept in files under ~/Library/Application Support/Followthrough (the app injects them at start).
   Web: browser storage. Same keys either way. */
const MACSTORE=IS_MAC&&window.__trackerStore?window.__trackerStore:null;
function kvGet(k){if(MACSTORE){if(k in MACSTORE)return MACSTORE[k];try{const v=localStorage.getItem(k);if(v!=null){kvSet(k,v);return v;}}catch(e){}return null;}try{return localStorage.getItem(k);}catch(e){return null;}}
function kvSet(k,v){if(MACSTORE){if(v==null)delete MACSTORE[k];else MACSTORE[k]=v;native("store.set",{key:k,value:v==null?null:String(v)}).catch(()=>{});return;}try{v==null?localStorage.removeItem(k):localStorage.setItem(k,v);}catch(e){}}
function readPrefs(){try{return JSON.parse(kvGet(PREF_KEY)||"{}");}catch(e){return {};}}
function savePrefs(){kvSet(PREF_KEY,JSON.stringify(P));}
const L=()=>P.lang;

/* ---------- native bridge (Mac app) ---------- */
const pending={};let seq=0;
function native(kind,payload){return new Promise((resolve,reject)=>{const id="n"+(++seq);pending[id]={resolve,reject};
  window.webkit.messageHandlers.tracker.postMessage(Object.assign({id,kind},payload||{}));});}
window.__trackerNative={
  reply(id,ok,data){const p=pending[id];if(!p)return;delete pending[id];ok?p.resolve(data):p.reject(data);},
  speech(ev){REC.onNative(ev);}
};

Object.assign(P,readPrefs());

/* ---------- AI providers (the user's own key; requests go straight to the provider) ---------- */
const PROVIDERS={
  anthropic:{label:"Anthropic",sub:"Claude",name:"Claude",base:"https://api.anthropic.com/v1",ph:"sk-ant-…",site:"console.anthropic.com",main:"claude-sonnet-5-5",fast:"claude-haiku-5-5"},
  openai:{label:"OpenAI",sub:"GPT",name:"GPT",base:"https://api.openai.com/v1",ph:"sk-…",site:"platform.openai.com"},
  gemini:{label:"Google",sub:"Gemini",name:"Gemini",base:"https://generativelanguage.googleapis.com/v1beta",ph:"AIza…",site:"aistudio.google.com"},
  deepseek:{label:"DeepSeek",sub:"DeepSeek",name:"DeepSeek",base:"https://api.deepseek.com",ph:"sk-…",site:"platform.deepseek.com"},
  openrouter:{label:"OpenRouter",sub:"Any model",name:"AI",base:"https://openrouter.ai/api/v1",ph:"sk-or-…",site:"openrouter.ai"},
  custom:{label:"Other",sub:"OpenAI-compatible",name:"AI",base:"",ph:"Key, if needed",site:""}
};
const PROV_ORDER=["anthropic","openai","gemini","deepseek","openrouter","custom"];
function aiName(){if(IS_ARTIFACT)return "Claude";return P.ai&&P.ai.ok?(PROVIDERS[P.ai.provider]||{}).name||"AI":"AI";}
async function http(url,opts){
  if(IS_MAC)return native("fetch",{url,method:opts.method||"GET",headers:opts.headers||{},body:opts.body||null});
  let r;try{r=await fetch(url,opts);}catch(e){throw {code:"network",message:String(e&&e.message||e)};}
  return {status:r.status,text:await r.text()};
}
function headersFor(a){
  if(a.provider==="anthropic")return {"x-api-key":a.key,"anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true","content-type":"application/json"};
  if(a.provider==="gemini")return {"x-goog-api-key":a.key,"content-type":"application/json"};
  const h={"content-type":"application/json"};if(a.key)h.Authorization="Bearer "+a.key;
  if(a.provider==="openrouter"){h["HTTP-Referer"]=REPO_URL;h["X-Title"]="Followthrough";}
  return h;
}
function baseFor(a){return (a.provider==="custom"?(a.base||""):PROVIDERS[a.provider].base).replace(/\/+$/,"");}
function failFrom(res){
  let msg="";try{const j=JSON.parse(res.text);msg=(j.error&&(j.error.message||j.error))||j.message||"";}catch(e){msg=res.text.slice(0,200);}
  const c=res.status===401||res.status===403?"auth":res.status===429?"rate_limited":res.status===413?"prompt_too_large":res.status===404?"no_model":"upstream_error";
  return {code:c,message:String(msg),status:res.status};
}
async function listModels(a){
  const b=baseFor(a);if(!b)throw {code:"no_base",message:"Missing base URL"};
  const res=await http(b+"/models",{headers:headersFor(a)});
  if(res.status>=300)throw failFrom(res);
  let j;try{j=JSON.parse(res.text);}catch(e){throw {code:"upstream_error",message:"Unexpected reply"};}
  if(a.provider==="gemini")return (j.models||[]).filter(m=>(m.supportedGenerationMethods||[]).includes("generateContent")).map(m=>m.name.replace(/^models\//,""));
  return (j.data||[]).map(m=>m.id).filter(Boolean);
}
function pickModels(provider,ids){
  const pv=PROVIDERS[provider];const has=id=>ids.includes(id);
  if(pv.main&&has(pv.main))return [pv.main,has(pv.fast)?pv.fast:pv.main];
  const chat=ids.filter(id=>!/embed|whisper|tts|dall|image|audio|moderation|realtime|transcribe|search|vision-preview/i.test(id));
  const pool=chat.length?chat:ids;
  const fast=pool.find(id=>/mini|flash|haiku|lite|small|chat/i.test(id))||pool[0];
  const main=pool.find(id=>!/mini|flash-lite|lite|small|nano/i.test(id))||pool[0];
  return [main,fast||main];
}
async function complete(a,messages,model){
  const b=baseFor(a),h=headersFor(a);let res,j;
  if(a.provider==="anthropic"){
    res=await http(b+"/messages",{method:"POST",headers:h,body:JSON.stringify({model,max_tokens:4096,messages})});
    if(res.status>=300)throw failFrom(res);j=JSON.parse(res.text);
    return {text:(j.content||[]).filter(c=>c.type==="text").map(c=>c.text).join(""),truncated:j.stop_reason==="max_tokens"};
  }
  if(a.provider==="gemini"){
    res=await http(b+"/models/"+encodeURIComponent(model)+":generateContent",{method:"POST",headers:h,body:JSON.stringify({contents:messages.map(m=>({role:m.role==="assistant"?"model":"user",parts:[{text:m.content}]}))})});
    if(res.status>=300)throw failFrom(res);j=JSON.parse(res.text);
    const c=(j.candidates||[])[0]||{};return {text:((c.content||{}).parts||[]).map(p=>p.text||"").join(""),truncated:c.finishReason==="MAX_TOKENS"};
  }
  res=await http(b+"/chat/completions",{method:"POST",headers:h,body:JSON.stringify({model,messages})});
  if(res.status>=300)throw failFrom(res);j=JSON.parse(res.text);
  const ch=(j.choices||[])[0]||{};return {text:(ch.message&&ch.message.content)||"",truncated:ch.finish_reason==="length"};
}
function parseJSONLoose(t){
  try{return JSON.parse(t);}catch(e){}
  const f=t.match(/```(?:json)?\s*([\s\S]*?)```/);if(f){try{return JSON.parse(f[1]);}catch(e){}}
  const i=Math.min(...["{","["].map(c=>{const k=t.indexOf(c);return k<0?1e9:k;})),k=Math.max(t.lastIndexOf("}"),t.lastIndexOf("]"));
  if(i<1e9&&k>i){try{return JSON.parse(t.slice(i,k+1));}catch(e){}}
  throw {code:"invalid_json",message:"No JSON in reply",text:t};
}
function langNote(json){return L()==="zh"?(json?"\n\nKeep JSON keys and the \"type\" values in English. Write every human-readable value (summary, title, detail) in Simplified Chinese.":"\n\nReply in Simplified Chinese."):"";}
function makeAdapter(a){
  const run=async(input,opts,json)=>{opts=opts||{};
    let msgs=typeof input==="string"?[{role:"user",content:input}]:input.map(m=>({role:m.role,content:m.content}));
    msgs[0]={role:"user",content:msgs[0].content+langNote(json)};
    const model=opts.modelTier==="quick"?(a.fast||a.model):a.model;
    if(opts.signal&&opts.signal.aborted)throw {code:"cancelled"};
    const r=await complete(a,msgs,model);
    if(opts.signal&&opts.signal.aborted)throw {code:"cancelled"};
    if(!r.text.trim())throw {code:"empty_completion"};
    if(opts.onText)opts.onText({text:r.text,delta:r.text});
    return r;
  };
  const fn=(input,opts)=>run(input,opts,false);
  fn.json=async(input,opts)=>parseJSONLoose((await run(input,opts,true)).text);
  return fn;
}

/* ---------- strings ---------- */
const T={
en:{ai_off:"AI: off",ai_on:n=>"AI: "+n,mac:"Mac app",settings:"Settings",
 back:"Back",cont:"Continue",skip:"Skip for now",cancel:"Cancel",save:"Save",done:"Done",
 err_req:"Fill this in to continue.",err_email:"Enter a valid email, like you@example.com.",err_people:"Add at least one person, then press Enter.",
 w_eb:"Welcome",tagline:"Every ask, answer, and follow-up in one place.",w_h:"Congrats, you found Followthrough.",w_p:"Built for anyone whose work runs through other people: the asks, answers, and follow-ups that pile up between meetings.",
 w_pills:["Next actions","Who you're waiting on","Questions to ask","1:1 captures"],w_oss:"<b>Open source.</b> If it helps you, fork it and change anything to fit how you work.",w_go:"Get started",imp_link:"Used Followthrough before? Import your data",
 p_eb:"Before you start",p_h:"Your work stays with you.",p_p:"Here is exactly what happens to your data.",
 p_rows:mac=>[["✓","ok","Your work stays on your computer","Tasks, questions, transcripts, and your API key never reach us."],
  ["@","acc","We store one thing: your email","Only so we know who signed up and can send product updates. Never shared or sold."],
  ["→","acc","AI requests go straight to your provider","Sent from your computer to the AI provider you pick, with your own key."],
  ["◐","warn",mac?"Transcription runs on your Mac":"Transcription uses your browser",mac?"The Mac app uses Apple's on-device speech recognition.":"The browser's speech service is used. The Mac app transcribes on-device with Apple's speech recognition."],
  ["✕","mute","Never","No analytics, trackers, or ads."]],
 p_rows_a:[["✓","ok","Your board is saved to your Claude account","Only you can see it. Nothing reaches us."],
  ["✳","acc","AI is Claude, built in","Reviews, nudges, and answers run on your own Claude account. No API key needed."],
  ["◐","warn","Paste transcripts here","claude.ai can't use the microphone. Paste a transcript, or record in the Mac app."],
  ["✕","mute","Never","No analytics, trackers, or ads."]],
 st_dataL_a:"Saved to your Claude account",rec_art:"claude.ai can't use the microphone. Paste a transcript, or record in the Mac app.",
 p_more:"Export or erase your data anytime in Settings.",p_code:"Read the code ↗",p_go:"Sounds good",
 s_eb:"Sign up",s_h:"Sign up with your email",s_p:"Your email is the only thing we store. It tells us who uses Followthrough, and we send an update when a new version ships.",s_email:"Email",s_note:"Never shared or sold. Your board stays on this computer.",s_go:"Sign up",s_busy:"Signing up…",
 ab_eb:"About you",ab_h:"Tell us a little about you",ab_p:"This stays on your computer. It sets your greeting and the sample week.",ab_name:"Your name",ab_role:"Your role",ab_hint:"Sets your sample week and team options. Change it in Settings.",err_role:"Pick the role closest to yours.",
 a_eb:"Optional",a_title:"AI settings",a_h:"Connect an AI model",a_p:"AI turns what people said into answers, next steps, and follow-ups. Use any provider you already pay for.",
 a_tabs:["Capture","Review","Nudges","Ask"],a_prov:"Provider",a_how:p=>p==="Other"?"How to set up a custom endpoint":`How to get ${/^[AEIOU]/.test(p)?"an":"a"} ${p} API key`,
 a_steps:s=>[`Sign in at <code>${s}</code>.`,"Open API keys and create a new key.","Copy the key and paste it below."],
 a_custom:["Works with any OpenAI-compatible endpoint, such as Groq, Together, or local Ollama.","Enter the base URL, for example <code>http://localhost:11434/v1</code>.","Ollama in a browser needs <code>OLLAMA_ORIGINS</code> set; the Mac app works without it."],
 a_tail:"Usage bills to your own account, usually cents per meeting.",a_key:"API key",a_base:"Base URL",a_test:"Test",a_testing:"Testing…",a_ok:n=>`Connected. ${n} models found.`,a_m1:"Model for reviews",a_m2:"Model for quick notes",
 a_keynote:"Your key stays on this computer and is sent only to the provider above.",a_save:"Save and continue",a_off:"Disconnect",a_need:"Test the key first, or skip for now.",
 a_errs:{auth:"That key was rejected. Check it and try again.",network:"Couldn't reach the provider. Check your connection.",no_base:"Add the base URL first.",rate_limited:"The provider is rate limiting. Try again in a minute.",no_model:"The provider didn't recognize that model.",other:"The provider returned an error."},
 m_eb:"Recommended",m_h:"Get the Mac app",m_p:"Same board, always one glance away.",
 m_perks:[["▣","Floats on your desktop","Keep it on top of other windows, or open it from the menu bar."],["◐","Apple's on-device transcription","Record a 1:1 and transcribe it privately on your Mac."],["↻","Opens when you log in","Your day's moves are waiting before your first meeting."]],
 m_dl:"Download for Mac",m_meta:["Free","macOS 13+","Apple silicon or Intel"],m_first:["First time on macOS 14: right-click the app, then choose Open.","On macOS 15 or later: open it once, then go to System Settings › Privacy & Security and click Open Anyway."],m_later:"Keep using the browser",
 d_eb:"All set",d_h:n=>`You're ready, ${n}.`,d_p:"How do you want to start?",o1h:"Set up my board",o1d:"Add the people you work with. Takes a minute.",o2h:"Look around a sample week first",o2d:r=>`A made-up ${r} week. Switch to your own board anytime.`,d_go:"Continue",
 st_lang:"Language",st_theme:"Appearance",st_themes:[["system","System"],["light","Light"],["dark","Dark"]],st_ai:"AI",st_aiOff:"Not connected",st_aiOn:(p,m)=>`${p} · ${m}`,st_aiBtn:"Set up",st_aiEdit:"Change",
 st_data:"Your data",st_dataL:IS_MAC?"Saved on this Mac only":"Saved in this browser only",st_exp:"Export",st_imp:"Import",st_erase:"Erase everything",st_eraseQ:"Erase your board, settings, and key from this device?",st_eraseYes:"Erase",
 st_acct:"Account",st_noAcct:"Not signed up",st_signup:"Sign up",st_help:"Help",st_tour:"Show the welcome tour again",st_ver:v=>"Version "+v,
 su_eb:"Your own board",su_h:"Set up your board",su_p:"Add the people you work with most. Type a name, then tap their team.",su_people:"People you work with",su_name:"Name, like Maya",su_team:"Their team",su_other:"Other team…",su_otherPh:"Team name",su_add:"Add",su_after:"You'll add tasks and questions on your board, as many as you need.",su_go:"Create my board",su_cta:"Set up your board",err_name:"Type a name first.",b_sample:r=>`<b>Sample ${r.toLowerCase()} week.</b> Made-up data so you can try everything. Edits are saved.`,st_role:"Role",
 imp_eb:"Import",imp_h:"Bring your board back",imp_p:"Choose a backup you exported from Followthrough. The file is checked on this computer before anything is added.",imp_drop:"Drop a file here",imp_pick:"Choose file",
 imp_kinds:[["Followthrough backup (.json)","Read instantly on this computer. No AI needed."],["Other notes or exports (.csv, .md, .txt)","AI sorts them into tasks and questions. Needs an AI model connected."]],
 imp_found:"Looks good. Here's what we found:",imp_c:["Tasks","Questions","People","Captures"],imp_from:(d,v)=>`Exported ${d} · Followthrough ${v}`,imp_ai:n=>`Sorted by ${n} from your notes`,imp_replace:"This replaces your current board. You can undo right after.",imp_go:n=>`Import ${n} items`,imp_other:"Choose another file",
 imp_bad:"That file isn't a Followthrough backup. Try another file, or connect an AI model to import notes.",imp_reading:"Reading your notes…",imp_none:"Nothing to import was found in that file.",imp_done:"Board imported",
 exp_done:"Backup saved",rec:"Record",rec_stop:"Stop recording",rec_who:"Speaking:",rec_me:"You",rec_them:"Them",rec_web:"Live transcription uses your browser's speech service.",rec_local:"Transcribing on this device.",rec_mac:"Transcribing on your Mac with Apple's on-device speech recognition.",rec_none:"This browser can't transcribe live. Use Chrome or Safari, or paste a transcript.",rec_denied:"Microphone access was denied. Allow it in system settings, then try again.",rec_hint:"Press Record to transcribe the meeting as it happens, or paste a transcript.",
 signed:"Thanks for signing up"},
zh:{ai_off:"AI：未连接",ai_on:n=>"AI："+n,mac:"Mac 应用",settings:"设置",
 back:"返回",cont:"继续",skip:"先跳过",cancel:"取消",save:"保存",done:"完成",
 err_req:"填写后才能继续。",err_email:"请输入有效邮箱，例如 you@example.com。",err_people:"至少添加一位对接人，输入后按回车。",
 w_eb:"欢迎",tagline:"所有请求、答复和待跟进，都在一处。",w_h:"恭喜，你找到了 Followthrough。",w_p:"为所有需要和别人协作推进工作的人而做：会议之间那些零散的需求、答复和待跟进事项，都在这里接住。",
 w_pills:["下一步行动","在等谁","要问的问题","1:1 记录"],w_oss:"<b>开源项目。</b>用得顺手的话，欢迎 fork，按你的工作方式随意改。",w_go:"开始",imp_link:"以前用过？导入你的数据",
 p_eb:"开始之前",p_h:"你的工作内容，只属于你。",p_p:"你的数据去了哪里，一条一条说清楚。",
 p_rows:mac=>[["✓","ok","工作内容只存在你的电脑上","任务、问题、转写稿和 API key，都不会传给我们。"],
  ["@","acc","我们只存一样东西：你的邮箱","只用来统计注册人数和发送产品更新。不分享，不出售。"],
  ["→","acc","AI 请求直接发给你选的服务商","从你的电脑直接发出，使用你自己的 key。"],
  ["◐","warn",mac?"转写在你的 Mac 本地完成":"转写使用浏览器的语音服务",mac?"Mac 应用使用苹果的本地语音识别。":"浏览器版使用浏览器自带的语音服务；Mac 应用则用苹果的本地语音识别。"],
  ["✕","mute","绝不会有","没有数据分析、追踪器或广告。"]],
 p_rows_a:[["✓","ok","看板保存在你的 Claude 账号里","只有你自己能看到，不会传给我们。"],
  ["✳","acc","AI 就是内置的 Claude","整理、催办和答复都用你自己的 Claude 账号，不需要 API key。"],
  ["◐","warn","在这里粘贴转写稿","claude.ai 里不能用麦克风。可以粘贴转写稿，或者用 Mac 应用录音。"],
  ["✕","mute","绝不会有","没有数据分析、追踪器或广告。"]],
 st_dataL_a:"保存在你的 Claude 账号里",rec_art:"claude.ai 里不能用麦克风。可以粘贴转写稿，或者用 Mac 应用录音。",
 p_more:"随时可以在设置里导出或清除你的数据。",p_code:"查看源代码 ↗",p_go:"明白了",
 s_eb:"注册",s_h:"用邮箱注册",s_p:"邮箱是我们唯一会保存的信息，用来了解有多少人在用 Followthrough，并在新版本发布时通知你。",s_email:"邮箱",s_note:"绝不分享或出售。看板内容只留在这台电脑上。",s_go:"注册",s_busy:"注册中…",
 ab_eb:"关于你",ab_h:"简单介绍一下你自己",ab_p:"这些只保存在你的电脑上，用来设置问候语和示例周。",ab_name:"你的名字",ab_role:"你的角色",ab_hint:"决定示例周和团队选项，可在设置里修改。",err_role:"选一个最接近你的角色。",
 a_eb:"可选",a_title:"AI 设置",a_h:"连接 AI 模型",a_p:"AI 会把对话内容整理成答复、下一步和待跟进事项。用你已经在付费的任意服务商都可以。",
 a_tabs:["记录","整理","催办","提问"],a_prov:"服务商",a_how:p=>p==="Other"?"如何设置自定义接口":`如何获取 ${p} API key`,
 a_steps:s=>[`登录 <code>${s}</code>。`,"进入 API keys，新建一个 key。","复制 key，粘贴到下面。"],
 a_custom:["支持任何 OpenAI 兼容接口，例如 Groq、Together 或本地 Ollama。","填入接口地址，例如 <code>http://localhost:11434/v1</code>。","在浏览器里用 Ollama 需要设置 <code>OLLAMA_ORIGINS</code>；Mac 应用不需要。"],
 a_tail:"费用记在你自己的账户上，一次会议通常只要几分钱。",a_key:"API key",a_base:"接口地址",a_test:"测试",a_testing:"测试中…",a_ok:n=>`已连接，找到 ${n} 个模型。`,a_m1:"整理用的模型",a_m2:"速记用的模型",
 a_keynote:"key 只保存在这台电脑上，只会发给上面选的服务商。",a_save:"保存并继续",a_off:"断开连接",a_need:"请先测试 key，或者先跳过。",
 a_errs:{auth:"key 被拒绝了，检查一下再试。",network:"连不上服务商，检查一下网络。",no_base:"请先填写接口地址。",rate_limited:"服务商限流了，一分钟后再试。",no_model:"服务商不认识这个模型。",other:"服务商返回了错误。"},
 m_eb:"推荐",m_h:"下载 Mac 应用",m_p:"同一个看板，抬眼就能看到。",
 m_perks:[["▣","悬浮在桌面上","可以置顶在其他窗口之上，也可以从菜单栏打开。"],["◐","苹果本地语音转写","录下 1:1，在你的 Mac 上私密转写。"],["↻","开机自动打开","第一个会议之前，今天要推的事已经摆在眼前。"]],
 m_dl:"下载 Mac 版",m_meta:["免费","macOS 13+","Apple 芯片或 Intel"],m_first:["macOS 14 首次打开：右键点 App，选择「打开」。","macOS 15 及以上：先双击一次，再到「系统设置 › 隐私与安全性」点「仍要打开」。"],m_later:"继续用浏览器",
 d_eb:"准备好了",d_h:n=>`一切就绪，${n}。`,d_p:"你想怎么开始？",o1h:"搭建我的看板",o1d:"添加你常对接的人，一分钟就好。",o2h:"先看看示例周",o2d:r=>`一周虚构的${r}工作，随时可以切换到你自己的看板。`,d_go:"继续",
 st_lang:"语言",st_theme:"外观",st_themes:[["system","跟随系统"],["light","浅色"],["dark","深色"]],st_ai:"AI",st_aiOff:"未连接",st_aiOn:(p,m)=>`${p} · ${m}`,st_aiBtn:"去设置",st_aiEdit:"更改",
 st_data:"你的数据",st_dataL:IS_MAC?"只保存在这台 Mac 上":"只保存在这个浏览器里",st_exp:"导出",st_imp:"导入",st_erase:"清除全部数据",st_eraseQ:"从这台设备上清除看板、设置和 key？",st_eraseYes:"清除",
 st_acct:"账号",st_noAcct:"还没注册",st_signup:"注册",st_help:"帮助",st_tour:"重新查看欢迎引导",st_ver:v=>"版本 "+v,
 su_eb:"你自己的看板",su_h:"搭建你的看板",su_p:"添加你最常对接的人：输入名字，再点选 TA 的团队。",su_people:"常对接的人",su_name:"名字，比如 Maya",su_team:"TA 的团队",su_other:"其他团队…",su_otherPh:"团队名称",su_add:"添加",su_after:"任务和问题之后在看板上添加，想加多少都行。",su_go:"创建我的看板",su_cta:"搭建你的看板",err_name:"请先输入名字。",b_sample:r=>`<b>${r}示例周。</b>虚构数据，方便你把功能都试一遍。改动会被保存。`,st_role:"角色",
 imp_eb:"导入",imp_h:"把你的看板搬回来",imp_p:"选择你之前从 Followthrough 导出的备份。文件会先在这台电脑上检查，确认无误再导入。",imp_drop:"把文件拖到这里",imp_pick:"选择文件",
 imp_kinds:[["Followthrough 备份（.json）","在这台电脑上直接读取，不需要 AI。"],["其他笔记或导出文件（.csv、.md、.txt）","由 AI 整理成任务和问题，需要先连接 AI 模型。"]],
 imp_found:"检查通过，识别到以下内容：",imp_c:["任务","问题","对接人","会议记录"],imp_from:(d,v)=>`${d} 导出 · Followthrough ${v}`,imp_ai:n=>`由 ${n} 从你的笔记整理`,imp_replace:"导入会替换当前看板，导入后可以立即撤销。",imp_go:n=>`导入 ${n} 项`,imp_other:"换一个文件",
 imp_bad:"这不是 Followthrough 备份文件。换一个文件，或者连接 AI 模型来导入笔记。",imp_reading:"正在阅读你的笔记…",imp_none:"这个文件里没有找到可导入的内容。",imp_done:"看板已导入",
 exp_done:"备份已保存",rec:"录音",rec_stop:"停止录音",rec_who:"正在说话：",rec_me:"我",rec_them:"对方",rec_web:"实时转写使用浏览器的语音服务。",rec_local:"正在本设备上转写。",rec_mac:"正在用苹果的本地语音识别在你的 Mac 上转写。",rec_none:"这个浏览器不支持实时转写，请用 Chrome 或 Safari，或者粘贴转写稿。",rec_denied:"麦克风权限被拒绝了，请在系统设置里允许后再试。",rec_hint:"点「录音」边开会边转写，或者直接粘贴转写稿。",
 signed:"注册成功，谢谢"}};
const t=k=>T[L()][k];
const ROLES={en:[["product","Product","PRDs, launches, metrics"],["ops","Operations","Vendors, campaigns, approvals"],["design","Design","Reviews, feedback, handoff"],["marketing","Marketing","Launches, content, partners"],["program","Program / project","Timelines, owners, risks"],["other","Something else","Start general"]],
 zh:[["product","产品","PRD、上线、指标"],["ops","运营","供应商、活动、审批"],["design","设计","评审、反馈、交付"],["marketing","市场","发布、内容、合作方"],["program","项目管理","排期、负责人、风险"],["other","其他","通用模板"]]};
const TEAMS={en:{product:["Engineering","Design","Data science","Data analytics","QA","Marketing","Operations","Sales","Support","Legal","Leadership"],
  ops:["Data analytics","Product","Engineering","Marketing","Sales","Support","Finance","Legal","Agency","Vendors","Leadership"],
  design:["Product","Engineering","Research","Brand","Content","Marketing","Data analytics","QA","Support","Accessibility","Leadership"],
  marketing:["Product","Sales","Agency","Brand","Content","Data analytics","Design","Partnerships","Support","Legal","Leadership"],
  program:["Engineering","Product","Design","Data analytics","QA","Security","Legal","Finance","Operations","Vendors","Leadership"]},
 zh:{product:["研发","设计","数据科学","数据分析","测试","市场","运营","销售","客服","法务","管理层"],
  ops:["数据分析","产品","研发","市场","销售","客服","财务","法务","代理商","供应商","管理层"],
  design:["产品","研发","用户研究","品牌","内容","市场","数据分析","测试","客服","无障碍","管理层"],
  marketing:["产品","销售","代理商","品牌","内容","数据分析","设计","商务合作","客服","法务","管理层"],
  program:["研发","产品","设计","数据分析","测试","安全","法务","财务","运营","供应商","管理层"]}};
const roleKey=()=>P.role&&P.role!=="other"?P.role:(P.role==="other"?"program":"product");
const roleLabel=()=>{const r=ROLES[L()].find(x=>x[0]===roleKey());return r?r[1]:"";};

/* ---------- Chinese for the board UI (the board's own strings are English) ---------- */
const ZH={"A made-up PM internship so you can try everything. Edits are saved.":"一段虚构的 PM 实习经历，方便你把功能都试一遍。改动会被保存。","Sample week.":"示例周。","Start my own board":"开始我自己的看板","Clear the sample and start empty?":"清除示例数据，从空白开始？","Clear it":"清除","Keep it":"保留",
"Today":"今天","Tasks":"任务","Questions":"问题","Capture":"记录","Next actions":"下一步","Blocked":"受阻","Later":"稍后","This week":"本周","Done":"已完成","Add task":"添加任务",
"Nothing due today. Pick something from Later.":"今天没有到期的事，可以从「稍后」里挑一件。","Add your first task to see your next moves here.":"添加第一个任务，这里就会出现你的下一步。","No due dates in the next seven days.":"未来七天没有截止日期。",
"Waiting on":"在等","Nobody owes you anything right now.":"现在没有人欠你东西。","New answers":"新答复","Answers you log or capture show up here.":"你记录的答复会出现在这里。","Questions to ask":"要问的问题","Add":"添加","No open questions.":"没有待问的问题。",
"Capture a 1:1 and let Claude pull out answers":"记录一次 1:1，让 Claude 提炼出答复","Draft a nudge":"起草催办","Drafting…":"起草中…","Got it":"收到了","Copy":"复制","Close":"关闭","Finish this step":"完成这一步","What's the next step?":"下一步是什么？","Set next step":"设为下一步","Task is done":"任务已完成","Cancel":"取消","No next step yet":"还没有下一步",
"Answer":"答复","What did they say?":"对方怎么说？","Save answer":"保存答复","Who to ask":"问谁","New person…":"新的人…","Name":"名字","Team":"团队","Is the baseline split by channel?":"基线数据有按渠道拆分吗？","Question":"问题","Related task":"相关任务","No related task":"无相关任务","Add question":"添加问题",
"New task":"新任务","Task":"任务","Next action":"下一步","Priority":"优先级","Due":"截止","Status":"状态","Open":"进行中","Nobody":"无","What they owe you":"对方要给你什么","History":"历史","Save":"保存","Delete":"删除","Delete this task?":"删除这个任务？","Keep":"保留","Give the task a name first.":"先给任务起个名字。","Add the new person's name.":"填写新对接人的名字。","Ask Maya how D7 retention is defined":"问 Maya D7 留存怎么定义","Lock success metric for referral test":"锁定 referral 实验的成功指标",
"Copied":"已复制","Couldn't copy. Select the text and copy it instead.":"复制失败，请手动选中文字复制。","Sample cleared":"示例已清除","Undo":"撤销","Next step set":"下一步已设置","Marked done":"已标记完成","Cleared":"已清除","Reopened":"已重新打开","Answer saved":"答复已保存","Moved back to To ask":"已移回待问","Question deleted":"问题已删除","Transcript cleared":"转写已清除","Board updated":"看板已更新",
"Every task, its next step, and who it depends on":"每个任务、它的下一步，以及在等谁","Search tasks":"搜索任务","Waiting on others":"在等别人","Due in 2 days":"两天内到期","All open":"全部进行中","Mine to do":"我来做","Waiting":"等待中","Task → next action":"任务 → 下一步","Age":"天数","Click a row to open the task. Click a column header to sort.":"点一行打开任务，点列标题排序。","No tasks match this filter.":"没有符合筛选条件的任务。","No tasks yet. Add your first one to get started.":"还没有任务，先添加第一个吧。","Mark done":"标记完成","Reopen":"重新打开","Waiting on others ":"在等别人",
"Everything you need to ask, and what people told you":"所有要问的问题，以及大家的答复","Anyone":"所有人","Person":"对接人","Ask whom":"问谁","Does the baseline already split by channel?":"基线数据已经按渠道拆分了吗？","New question":"新问题","Log answer":"记录答复","Edit":"编辑","Delete?":"删除？","Mark as not answered":"标为未答复","By person":"按人","Show everyone":"显示全部","Nobody to ask right now.":"现在没有要问的人。","Copy agenda":"复制议程","Start capture":"开始记录","Nothing here for this filter.":"这个筛选下没有内容。",
"No questions yet. Add one above, or capture a 1:1 and Claude will find follow-ups.":"还没有问题。可以在上面添加，或者记录一次 1:1，Claude 会帮你找出待跟进事项。","Write the question first.":"先写下问题。","Add the person's name.":"填写对方的名字。","Agenda for your next 1:1":"下次 1:1 的议程",
"Meeting":"会议","With":"和谁","About":"关于","Group or no one":"多人或无","No specific task":"无特定任务","New capture":"新记录","Replay sample 1:1":"回放示例 1:1","Replaying":"回放中","Stop":"停止","Finish and review":"结束并整理","Finish":"结束",
"Paste a transcript from Zoom, Otter, or Voice Memos, or type notes as you go. Use \"Name: what they said\" on each line so Claude knows who said what.":"粘贴 Zoom、Otter 或语音备忘录的转写，或者边开会边记。每行用「名字: 说的话」的格式，Claude 就知道是谁说的。","Or press Replay sample 1:1 to watch a meeting come in.":"也可以点「回放示例 1:1」看一场会议如何被记录。",
"Done editing":"完成编辑","Edit transcript":"编辑转写","Clear":"清除","Claude's notes":"Claude 的笔记","Read so far":"整理目前内容","Update notes":"更新笔记","Reading the transcript…":"正在阅读转写…","Claude pulls answers, your next steps, and promises from the conversation.":"Claude 会从对话中提炼答复、你的下一步和对方的承诺。",
"Claude isn't available in this view. Finish to add updates by hand.":"还没连接 AI，结束后可以手动添加更新。","Pick who you're meeting to see your prepared questions.":"选择和谁开会，就能看到你准备好的问题。","Past captures":"过往记录","Your next step":"你的下一步","Waiting on them":"在等对方","Still open":"仍待解决",
"Capture · review":"记录 · 整理","Back to transcript":"返回转写","Copy summary":"复制摘要","Summary":"摘要","Proposed updates to your board":"建议的看板更新","Skip the rest":"跳过其余","Back to Today":"返回今天","No board updates found in this meeting.":"这次会议没有找到需要更新看板的内容。","Claude is reading the whole meeting. This takes up to a minute.":"Claude 正在阅读整场会议，最多需要一分钟。","Try again":"重试","Key moments":"关键时刻","Transcript":"转写","Ask about this meeting":"询问这场会议","Why exclude reactivated users?":"为什么要排除回流用户？","Ask":"提问","Thinking…":"思考中…","Added":"已添加","Undo skip":"撤销跳过","Skip":"跳过","Still open → keep for next time":"仍待解决 → 留到下次","Answer → question":"答复 → 问题","New task ":"新任务","Title":"标题","Detail":"详情",
"Claude isn't available in this view. Add answers and next steps on the Today page.":"还没连接 AI，可以在「今天」页面手动添加答复和下一步。","Claude couldn't finish that. Try again.":"Claude 没能完成，请重试。","Too many requests right now. Try again in a minute.":"请求太多了，请一分钟后再试。","Claude's reply came back in the wrong shape. Try again.":"Claude 的回复格式不对，请重试。","That transcript is too long. Trim it and try again.":"转写太长了，删减一些后再试。","Claude isn't available for this page. You can still add everything by hand.":"当前无法使用 AI，你仍然可以手动添加所有内容。",
"Saved in this browser only":"只保存在这个浏览器里","Saved on this Mac only":"只保存在这台 Mac 上","Loading your board…":"正在加载看板…","Live microphone recording comes with the desktop app. In the browser, paste a transcript or type notes.":"","Edit":"编辑","Add ":"添加","Detail ":"详情","Sort":"排序"};
const NUM={one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10};
const toN=w=>NUM[String(w).toLowerCase()]||w;
const ZDOW={Sun:"周日",Mon:"周一",Tue:"周二",Wed:"周三",Thu:"周四",Fri:"周五",Sat:"周六"};
const ZMON={Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12,January:1,February:2,March:3,April:4,June:6,July:7,August:8,September:9,October:10,November:11,December:12};
const ZDAY={Sunday:"星期日",Monday:"星期一",Tuesday:"星期二",Wednesday:"星期三",Thursday:"星期四",Friday:"星期五",Saturday:"星期六"};
const RULES=[
 [/^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday), (\w+) (\d+)$/,(m,d,mo,dd)=>`${ZMON[mo]} 月 ${dd} 日 ${ZDAY[d]}`],
 [/^Good (morning|afternoon|evening)(?:, (.+))?\.$/,(m,p,n)=>({morning:"早上好",afternoon:"下午好",evening:"晚上好"}[p])+(n?"，"+n:"")+"。"],
 [/^(One move|\w+ moves|No urgent moves) today(?:, (one person|\w+ people) to nudge)?\.$/,(m,a,b)=>{const mv=/^No urgent moves$/.test(a)?"今天没有紧急的事":`今天有 ${toN(a.replace(/ moves?$/i,""))} 件要推进`;return mv+(b?`，${toN(b.replace(/ (person|people)$/,""))} 个人要催`:"")+"。";}],
 [/^Nothing urgent\. A good day to get ahead\.$/,()=>"今天不急，正好提前推进。"],
 [/^(\d+)d late$/,(m,n)=>`逾期 ${n} 天`],[/^(\d+)d$/,(m,n)=>`${n} 天`],[/^(\d+)d old$/,(m,n)=>`${n} 天前`],
 [/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)$/,(m,d)=>ZDOW[d]],[/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d+)$/,(m,mo,d)=>`${ZMON[mo]} 月 ${d} 日`],
 [/^Yesterday$/,()=>"昨天"],[/^Tomorrow$/,()=>"明天"],[/^today$/,()=>"今天"],
 [/^answered (.+)$/,(m,w)=>`${zhDay(w)}答复`],
 [/^(\d+) open$/,(m,n)=>`${n} 项进行中`],[/^(\d+) blocked$/,(m,n)=>`${n} 项受阻`],[/^(\d+) answers? since yesterday$/,(m,n)=>`昨天以来 ${n} 条答复`],
 [/^Questions for (.+)$/,(m,n)=>`要问 ${n} 的问题`],[/^Agenda for your next 1:1 with (.+)$/,(m,n)=>`下次和 ${n} 1:1 的议程`],[/^No open questions for (.+)\.$/,(m,n)=>`没有要问 ${n} 的问题。`],
 [/^To ask (\d+)$/,(m,n)=>`待问 ${n}`],[/^Answered (\d+)$/,(m,n)=>`已答复 ${n}`],[/^All (\d+)$/,(m,n)=>`全部 ${n}`],[/^(\d+) of (\d+)$/,(m,a,b)=>`${a} / ${b}`],
 [/^(\d+) lines?$/,(m,n)=>`${n} 行`],[/^Speakers: (.+)$/,(m,n)=>`发言人：${n==="none yet"?"暂无":n}`],
 [/^Waiting on (.+?) → (.+)$/,(m,a,b)=>`在等 ${a==="someone"?"某人":a} → ${b==="new task"?"新任务":b}`],[/^Next step → (.+)$/,(m,b)=>`下一步 → ${b==="new task"?"新任务":b}`],[/^New question → (.+)$/,(m,b)=>`新问题 → ${b}`],
 [/^(Answer|Your next step|Waiting on them|New question|New task|Still open) · (.+)$/,(m,k,n)=>`${ZH[k]||k} · ${n}`],
 [/^From (.+?)'s answer: (.*)$/,(m,n,a)=>`来自 ${n} 的答复：${a}`],[/^Deleted (.+)$/,(m,n)=>`已删除「${n}」`],[/^1:1 with (.+)$/,(m,n)=>`与 ${n} 的 1:1`],
 [/^(\d+) updates applied$/,(m,n)=>`已应用 ${n} 项更新`],[/^(\d+) added · (\d+) to review$/,(m,a,b)=>`已添加 ${a} · 待处理 ${b}`],[/^Apply all (\d+)$/,(m,n)=>`全部应用（${n}）`],
 [/^Step done: (.+)$/,(m,n)=>`完成一步：${n}`],[/^Capture · live$/,()=>"记录 · 进行中"],[/^due (.+)$/,(m,d)=>`截止 ${zhDay(d)}`],
 [/^(.*) · waiting on (.+)$/,(m,a,n)=>`${a} · 在等 ${n}`],[/^Nobody\. It's your move\.$/,()=>"无，轮到你了。"],[/^Questions$/,()=>"问题"]
];
function zhDay(w){const k=w.charAt(0).toUpperCase()+w.slice(1);return ZDOW[k]||({Today:"今天",Yesterday:"昨天",Tomorrow:"明天"}[k])||(/^\w{3} \d+$/.test(k)?`${ZMON[k.slice(0,3)]} 月 ${k.slice(4)} 日`:w);}
function zh1(s){if(Object.prototype.hasOwnProperty.call(ZH,s))return ZH[s];for(const [re,f] of RULES){const m=s.match(re);if(m)return f(...m);}return null;}
/* a line like "7 open · 1 blocked" is translated part by part */
function zh(s){const one=zh1(s);if(one!=null)return one;if(!s.includes(" · "))return null;const parts=s.split(" · "),out=parts.map(x=>zh1(x));return out.some(x=>x!=null)?parts.map((x,i)=>out[i]!=null?out[i]:x).join(" · "):null;}
const ORIG=new WeakMap();
function localize(root){
  const nm=aiName();
  const fix=v=>v.replace(/\bClaude\b/g,nm);
  const w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{acceptNode:n=>n.parentNode&&n.parentNode.closest&&n.parentNode.closest("textarea,script,style,[data-raw]")?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT});
  const nodes=[];let n;while(n=w.nextNode())nodes.push(n);
  nodes.forEach(n=>{if(!ORIG.has(n))ORIG.set(n,n.nodeValue);const raw=ORIG.get(n);if(!raw.trim())return;const key=raw.replace(/\u00a0/g," ").trim();
    let out=L()==="zh"?zh(key):null;if(out==null)out=raw;else{const lead=raw.match(/^\s*/)[0],trail=raw.match(/\s*$/)[0];out=lead+out+trail;}
    out=fix(out);if(out!==n.nodeValue)n.nodeValue=out;});
  root.querySelectorAll&&root.querySelectorAll("[placeholder],[aria-label],[title]").forEach(el=>["placeholder","aria-label","title"].forEach(a=>{const k="data-en-"+a;if(!el.hasAttribute(k)&&el.hasAttribute(a))el.setAttribute(k,el.getAttribute(a));const v=el.getAttribute(k);if(!v)return;let o=L()==="zh"?zh(v):null;o=fix(o==null?v:o);if(o!==el.getAttribute(a))el.setAttribute(a,o);}));
}

/* ---------- Chinese sample week ---------- */
const enSample=sampleState;
function zhSample(){const D=addDays;return {v:1,sample:true,pristine:true,project:"Referral 项目 v2",updatedAt:Date.now(),
  people:[{id:"p_maya",name:"Maya",team:"Data science"},{id:"p_priya",name:"Priya",team:"Data analytics"},{id:"p_leo",name:"Leo",team:"Engineering"},{id:"p_ana",name:"Ana",team:"Design"},{id:"p_sam",name:"Sam",team:"Mentor, PM"}],
  tasks:[{id:"t_metric",title:"锁定 referral 实验的成功指标",prio:"P0",status:"open",next:"按 Maya 的 cohort 口径更新指标文档",due:D(0),waiting:null,history:[{at:D(-4),text:"创建。PRD 评审前需要定一个主指标。"},{at:D(-3),text:"问 Maya：D7 留存按 cohort 还是滚动计算？"},{at:D(-1),text:"Maya 答复：按注册 cohort，排除回流用户。"}]},
   {id:"t_prd",title:"写 App 内 referral 入口的 PRD",prio:"P1",status:"open",next:"补上边界情况一节",due:D(2),waiting:null,history:[{at:D(-5),text:"和 Sam 开完 kickoff 后创建。"}]},
   {id:"t_track",title:"和研发对齐埋点文档",prio:"P0",status:"blocked",next:"催 Leo 评审埋点 schema",due:D(1),waiting:{personId:"p_leo",what:"埋点 schema 评审",since:D(-3)},history:[{at:D(-3),text:"把 schema 文档发给 Leo 评审。"}]},
   {id:"t_base",title:"漏斗基线数据",prio:"P1",status:"open",next:"数据到了就合进指标文档",due:D(3),waiting:{personId:"p_priya",what:"近 30 天分渠道漏斗数据",since:D(-1)},history:[{at:D(-1),text:"找 Priya 要 30 天基线。"}]},
   {id:"t_design",title:"设计评审：referral 入口",prio:"P1",status:"open",next:"为设计评审准备三个问题",due:D(1),waiting:null,history:[]},
   {id:"t_sync",title:"周会材料",prio:"P1",status:"open",next:"加一页指标定义和基线",due:D(3),waiting:null,history:[]},
   {id:"t_ideas",title:"收集下一轮迭代的想法",prio:"P2",status:"open",next:"翻一遍带 invite 标签的客服工单",due:null,waiting:null,history:[]},
   {id:"t_kick",title:"给相关方发 kickoff 纪要",prio:"P1",status:"done",next:"",due:D(-4),waiting:null,history:[{at:D(-4),text:"完成。"}]}],
  questions:[{id:"q_d7",personId:"p_maya",taskId:"t_metric",text:"D7 留存按 cohort 还是滚动计算？",answer:"按注册 cohort；排除回流用户。",answeredAt:D(-1),created:D(-3)},
   {id:"q_ss",personId:"p_maya",taskId:"t_metric",text:"检测 2% 提升最少需要多少样本？",answer:"",answeredAt:null,created:D(-3)},
   {id:"q_gr",personId:"p_maya",taskId:"t_metric",text:"护栏指标要不要包含取消率？",answer:"",answeredAt:null,created:D(-3)},
   {id:"q_dl",personId:"p_leo",taskId:"t_prd",text:"referral 入口能从短信深链跳转吗？",answer:"",answeredAt:null,created:D(-6)},
   {id:"q_sh",personId:"p_ana",taskId:"t_design",text:"分享面板用系统原生的还是自定义？",answer:"",answeredAt:null,created:D(-5)}],
  sessions:[],draft:null};}
const EN_TRANSCRIPT=SAMPLE_TRANSCRIPT.slice();
const ZH_TRANSCRIPT=[["我","谢谢抽时间。referral 实验的 D7 留存，按 cohort 算还是滚动算？PRD 里我想放一个数。"],["Maya","按注册 cohort 算。回流用户要排除，不然邀请渠道会显得比实际好。"],["我","明白。要看到 2% 的提升，需要多少样本？"],["Maya","按现在的流量，每组大概四万人。周四前我把样本量计算发你。"],["我","好，我今天更新指标文档，周五周会上同步。"],["Maya","另外问下 Priya，基线是不是已经按渠道拆了。没拆的话没法比较邀请和自然流量。"],["我","好的，我下午问她。还有，要不要先在 Android 上跑？"],["Maya","建议双端一起跑。拆开的话样本减半，要等两倍时间。"],["我","好，双端一起。我写进 PRD 的上线方案里。"]];
function roleSpec(){const r=roleKey();return r==="product"?null:(window.TRACKER_SAMPLES||{})[r]?.[L()]||null;}
function buildSample(sp){const D=addDays,me=L()==="zh"?"我":"You";return {v:1,sample:true,pristine:true,sampleRole:roleKey(),project:"",updatedAt:Date.now(),
  people:sp.people.map(([id,name,team])=>({id,name,team})),
  tasks:sp.tasks.map(([id,title,next,prio,due,status,w])=>({id,title,next,prio,status,due:due==null?null:D(due),waiting:w?{personId:w[0],what:w[1],since:D(-w[2])}:null,history:[{at:D(-4),text:L()==="zh"?"创建。":"Created."}],created:D(-4)})),
  questions:sp.questions.map(([id,personId,taskId,text,answer,ans,cr])=>({id,personId,taskId,text,answer,answeredAt:ans==null?null:D(-ans),created:D(-cr)})),
  sessions:[],draft:null,replay:{person:sp.replay.person,task:sp.replay.task,title:sp.replay.title}};}
function applySampleLang(){const sp=roleSpec();SAMPLE_TRANSCRIPT.splice(0,SAMPLE_TRANSCRIPT.length,...(sp?sp.replay.lines:(L()==="zh"?ZH_TRANSCRIPT:EN_TRANSCRIPT)));}
sampleState=function(){const sp=roleSpec();const s=sp?buildSample(sp):(L()==="zh"?zhSample():enSample());s.pristine=true;s.project="";s.sampleRole=roleKey();return s;};
const _startReplay=startReplay;
startReplay=function(){const d=draft();if(S.replay&&person(S.replay.person)){d.personId=S.replay.person;d.taskId=S.replay.task;d.title=S.replay.title;}applySampleLang();_startReplay();};
const _save=save;save=function(){if(S&&S.pristine)S.pristine=false;_save();};

/* ---------- hooks into the board ---------- */
if(!IS_ARTIFACT){
lsGet=function(){try{const v=kvGet(LS_KEY);return v?JSON.parse(v):null;}catch(e){return null;}};
lsSet=function(o){kvSet(LS_KEY,JSON.stringify(o));};
window.addEventListener("pagehide",()=>{if(S)lsSet(S);});
}
if(IS_MAC)copy=async function(text){try{await native("copy",{text:String(text)});toast("Copied");}catch(e){toast("Couldn't copy. Select the text and copy it instead.");}};
if(!IS_ARTIFACT)renderFoot=function(){$("#foot").textContent=IS_MAC?"Saved on this Mac only":"Saved in this browser only";localize($("#foot"));};
if(!IS_ARTIFACT)initClaude=async function(){CLAUDE=P.ai&&P.ai.ok?makeAdapter(P.ai):null;render();};
const _empty=emptyState;emptyState=function(){const b=_empty();b.project="";return b;};
const _norm=normalize;normalize=function(){_norm();if(S&&S.project==="My project")S.project="";};
const _err=claudeErr;
claudeErr=function(e){const c=e&&e.code,E=t("a_errs");
  if(c==="auth")return E.auth;if(c==="network")return E.network;if(c==="no_model")return E.no_model;if(c==="empty_completion")return E.other;return _err(e);};
const _render=render,_overlay=renderOverlay,_toast=renderToast;
render=function(){_render();chrome();localize(document.body);glue();evenRows(document);};
renderOverlay=function(){_overlay();localize($("#overlay"));glue($("#overlay"));};
renderToast=function(){_toast();localize($("#toast"));};

function chrome(){
  const tb=$("#themeBtn");if(tb)tb.hidden=true;
  const br=$(".brand");if(br&&!br.dataset.ft){br.dataset.ft="1";br.setAttribute("data-raw","");br.innerHTML=ICON_SVG+"<span>Followthrough</span>";}
  const bn=$(".banner > span");if(bn&&S.sample){bn.setAttribute("data-raw","");bn.innerHTML=t("b_sample")(roleLabel());}
  let x=$("#tbExtra");
  if(!x){x=document.createElement("div");x.id="tbExtra";x.className="tb-extra";$(".top").appendChild(x);}
  const on=!!(P.ai&&P.ai.ok);
  x.innerHTML=`${IS_ARTIFACT?"":`<button class="tb-btn" data-ob="ai" type="button"><span class="dot${on?" on":""}"></span><span class="lbl" data-raw>${esc(on?t("ai_on")(aiName()):t("ai_off"))}</span></button>`}${IS_MAC?"":`<a class="tb-btn" href="${DOWNLOAD_URL}" target="_blank" rel="noopener" data-raw>↓ <span class="lbl">${t("mac")}</span></a>`}<button class="tb-btn icon" data-ob="settings" type="button" aria-label="${t("settings")}" data-raw>⚙</button>`;
  const r=route();
  if(r==="capture")captureChrome();
  if(r==="today"&&!S.sample&&!S.tasks.length){const m=$(".main .sec");if(m&&!$("#setupCta")){m.insertAdjacentHTML("beforeend",`<div class="setup-cta" id="setupCta" data-raw><button class="btn pri" data-ob="setup" type="button">${t("su_cta")}</button></div>`);}}
}

/* ---------- even rows: never leave one chip or button alone on a line ---------- */
function rowsOf(kids){const rows=[];let bottom=-1e9;kids.map(k=>[k,k.getBoundingClientRect()]).sort((a,b)=>a[1].top-b[1].top).forEach(([k,r])=>{if(r.top>=bottom-1){rows.push([k]);bottom=r.bottom;}else{rows[rows.length-1].push(k);bottom=Math.max(bottom,r.bottom);}});return rows;}
function evenRows(root){(root||document).querySelectorAll(".ob-pills,.ob-chips,.ob-setrow,.fbar,.chips,.txbar,.ob-provs").forEach(el=>{
  el.classList.remove("ob-even");el.style.gridTemplateColumns="";
  const kids=[...el.children].filter(k=>k.getBoundingClientRect().width>0&&!k.classList.contains("grow")&&!k.classList.contains("l"));if(kids.length<3)return;
  const rows=rowsOf(kids);if(rows.length<2||rows[rows.length-1].length!==1)return;
  el.classList.add("ob-even");el.style.gridTemplateColumns=`repeat(${Math.ceil(kids.length/rows.length)},minmax(0,auto))`;});}
window.addEventListener("resize",()=>evenRows(document));

/* ---------- theme ---------- */
function applyTheme(){const r=document.documentElement;if(P.theme==="system")delete r.dataset.theme;else r.dataset.theme=P.theme;}

/* ---------- onboarding and panels ---------- */
const OB={start:"own",role:"",pplName:"",otherTeam:false,screen:null,tab:0,prov:P.ai?P.ai.provider:"anthropic",key:P.ai?P.ai.key:"",base:P.ai?P.ai.base||"":"",models:P.ai&&P.ai.models||[],main:P.ai?P.ai.model:"",fast:P.ai?P.ai.fast:"",tested:!!(P.ai&&P.ai.ok),testing:false,testErr:"",people:[],vals:{},imp:null,impBusy:false,impErr:"",erase:false,busy:false};
const STEPS=()=>IS_ARTIFACT?["welcome","privacy","about","mac","done"]:IS_MAC?["welcome","privacy","signup","about","ai","done"]:["welcome","privacy","signup","about","ai","mac","done"];
const DEMO={en:[
 `<div class="ob-live"><i></i>Recording · 12:47</div><div class="ln"><span class="sp" style="color:var(--violet)">Maya</span>Per signup cohort. <mark>Exclude reactivated users</mark>, otherwise the invite channel looks better.</div><div class="ln"><span class="sp" style="color:var(--accent)">You</span>I'll update the metric spec today.</div><div class="cap">Transcribed live. AI highlights answers and promises.</div>`,
 `<div class="row"><span class="ic" style="background:var(--ok-soft);color:var(--ok)">A</span>D7 retention = per signup cohort</div><div class="row"><span class="ic" style="background:var(--accent-soft);color:var(--accent)">N</span>Update metric spec, share Friday</div><div class="row"><span class="ic" style="background:var(--warn-soft);color:var(--warn)">W</span>Waiting on Maya: power calc, Thu</div><div class="cap">Accept or skip each update. One click applies them.</div>`,
 `<div class="bub">Hi Leo, could you look at the tracking schema today? It's holding up the event spec for the referral test.</div><div class="cap">AI drafts a friendly Slack nudge. Copy, tweak, send.</div>`,
 `<div class="bub" style="color:var(--ink-2)">Why exclude reactivated users?</div><div class="bub">Maya said they return through invite links more often, which would inflate the referral channel's retention.</div><div class="cap">Ask anything about a meeting you captured.</div>`],
zh:[
 `<div class="ob-live"><i></i>录音中 · 12:47</div><div class="ln"><span class="sp" style="color:var(--violet)">Maya</span>按注册 cohort 算。<mark>回流用户要排除</mark>，不然邀请渠道会显得更好。</div><div class="ln"><span class="sp" style="color:var(--accent)">我</span>我今天就更新指标文档。</div><div class="cap">实时转写，AI 标出答复和承诺。</div>`,
 `<div class="row"><span class="ic" style="background:var(--ok-soft);color:var(--ok)">答</span>D7 留存按注册 cohort 计算</div><div class="row"><span class="ic" style="background:var(--accent-soft);color:var(--accent)">下</span>更新指标文档，周五同步</div><div class="row"><span class="ic" style="background:var(--warn-soft);color:var(--warn)">等</span>等 Maya：样本量计算，周四</div><div class="cap">每条更新可以接受或跳过，一键写进看板。</div>`,
 `<div class="bub">Leo，今天能帮忙看下埋点 schema 吗？referral 实验的事件文档在等它。</div><div class="cap">AI 帮你起草一条友好的 Slack 催办，复制、改改就能发。</div>`,
 `<div class="bub" style="color:var(--ink-2)">为什么要排除回流用户？</div><div class="bub">Maya 说回流用户更常通过邀请链接回来，会抬高 referral 渠道的留存。</div><div class="cap">对任何一次记录过的会议提问。</div>`]};

function openOB(s){OB.screen=s;OB.testErr="";OB.impErr="";OB.erase=false;if(s==="setup"){OB.people=S.sample?[]:S.people.map(p=>p.name+(p.team?" · "+p.team:""));OB.pplName="";OB.otherTeam=false;}if(s==="about"){OB.role=P.role||"";if(!OB.vals.name&&!P.name&&window.__trackerUser)OB.vals.name=window.__trackerUser;}drawOB();}
function closeOB(){OB.screen=null;drawOB();}
function bars(){const st=STEPS(),i=st.indexOf(OB.screen);return i<0?"":`<div class="ob-bars">${st.map((s,j)=>`<i class="${j<=i?"on":""}"></i>`).join("")}</div>`;}
function head(eb,close){return `<div class="ob-head"><span class="ob-eb">${eb}</span>${close?`<button class="ob-x" data-obclose aria-label="${t("cancel")}">×</button>`:""}</div>`;}
function langSeg(){return `<div class="ob-langs" role="group" aria-label="${t("st_lang")}"><button type="button" data-lang="en" class="${L()==="en"?"on":""}">English</button><button type="button" data-lang="zh" class="${L()==="zh"?"on":""}">中文</button></div>`;}
function field(id,label,type,ph){const v=OB.vals[id]!=null?OB.vals[id]:"";return `<label><span class="ob-label">${label}<span class="ob-req">*</span></span><input class="inp" id="ob-${id}" type="${type}" placeholder="${esc(ph)}" value="${esc(v)}" data-obf="${id}" autocomplete="${type==="email"?"email":"off"}"></label><div class="ob-err" id="oberr-${id}" hidden></div>`;}
function nextStep(){const st=STEPS();return st[st.indexOf(OB.screen)+1];}
function prevStep(){const st=STEPS();return st[Math.max(0,st.indexOf(OB.screen)-1)];}
function aiBlock(){const pv=PROVIDERS[OB.prov];
  const how=OB.prov==="custom"?t("a_custom"):t("a_steps")(pv.site);
  return `<div class="ob-tabs">${t("a_tabs").map((x,i)=>`<button type="button" class="${i===OB.tab?"on":""}" data-obtab="${i}">${x}</button>`).join("")}</div><div class="ob-demo">${DEMO[L()][OB.tab]}</div>
   <span class="ob-label" style="margin-top:14px">${t("a_prov")}</span><div class="ob-provs">${PROV_ORDER.map(k=>`<button type="button" class="ob-prov${k===OB.prov?" on":""}" data-obprov="${k}">${PROVIDERS[k].label}<small>${PROVIDERS[k].sub}</small></button>`).join("")}</div>
   <details><summary>${t("a_how")(pv.label)}</summary><ol>${how.map(h=>`<li>${h}</li>`).join("")}<li>${t("a_tail")}</li></ol></details>
   ${OB.prov==="custom"?`<label><span class="ob-label">${t("a_base")}</span><input class="inp" id="ob-base" value="${esc(OB.base)}" placeholder="http://localhost:11434/v1" style="font-family:var(--mono);font-size:12.5px"></label>`:""}
   <div class="ob-keyrow"><input class="inp" id="ob-key" type="password" value="${esc(OB.key)}" placeholder="${pv.ph}" aria-label="${t("a_key")}" autocomplete="off" spellcheck="false"><button class="btn" type="button" data-obtest ${OB.testing?"disabled":""}>${OB.testing?t("a_testing"):t("a_test")}</button></div>
   ${OB.testErr?`<div class="ob-err">${esc(OB.testErr)}</div>`:OB.tested&&OB.models.length?`<div class="ob-ok">✓ ${t("a_ok")(OB.models.length)}</div>`:""}
   ${OB.tested&&OB.models.length?`<div class="ob-two"><label><span class="ob-label" style="margin-top:6px">${t("a_m1")}</span><select class="sel" id="ob-main">${OB.models.map(m=>`<option${m===OB.main?" selected":""}>${esc(m)}</option>`).join("")}</select></label><label><span class="ob-label" style="margin-top:6px">${t("a_m2")}</span><select class="sel" id="ob-fast">${OB.models.map(m=>`<option${m===OB.fast?" selected":""}>${esc(m)}</option>`).join("")}</select></label></div>`:""}
   <p class="ob-hint">${t("a_keynote")}</p>`;}
function cardHTML(){const s=OB.screen;
  if(s==="welcome")return `${bars()}<div class="ob-head"><span class="ob-eb">${t("w_eb")}</span>${langSeg()}</div><div class="ob-brand">${ICON_SVG}<div><div class="nm">Followthrough</div><div class="tg">${t("tagline")}</div></div></div>
    <h2>${t("w_h")}</h2><p>${t("w_p")}</p>
    <div class="ob-pills">${t("w_pills").map(x=>`<span class="ob-pill">${x}</span>`).join("")}</div>
    <div class="ob-oss"><span aria-hidden="true">◇</span><span>${t("w_oss")}</span></div>
    <div class="ob-acts"><button class="btn pri" type="button" data-obgo="next">${t("w_go")}</button><span class="grow"></span><button class="ob-lnk" type="button" data-obgo="import">${t("imp_link")}</button></div>`;
  if(s==="privacy")return `${bars()}${head(t("p_eb"))}<h2>${t("p_h")}</h2><p>${t("p_p")}</p>
    <div class="ob-flow">${(IS_ARTIFACT?t("p_rows_a"):t("p_rows")(IS_MAC)).map(([ic,k,h,d])=>{const c={ok:"var(--ok-soft);color:var(--ok)",acc:"var(--accent-soft);color:var(--accent)",warn:"var(--warn-soft);color:var(--warn)",mute:"var(--surface-2);color:var(--ink-2)"}[k];return `<div class="ob-fl"><span class="ic" style="background:${c}">${ic}</span><div><div class="h">${h}</div><div class="d">${d}</div></div></div>`;}).join("")}</div>
    <p class="ob-hint" style="margin-top:10px">${t("p_more")} <a class="ob-lnk" style="font-size:12px" href="${REPO_URL}" target="_blank" rel="noopener">${t("p_code")}</a></p>
    <div class="ob-acts"><button class="btn pri" type="button" data-obgo="next">${t("p_go")}</button><span class="grow"></span><button class="ob-skip" type="button" data-obgo="prev">${t("back")}</button></div>`;
  if(s==="signup"||s==="signupOnly")return `${s==="signup"?bars():""}${head(t("s_eb"),s==="signupOnly")}<h2>${t("s_h")}</h2><p>${t("s_p")}</p>
    ${field("email",t("s_email"),"email","you@example.com")}<p class="ob-hint">${t("s_note")}</p>
    <div class="ob-acts"><button class="btn pri" type="button" data-obsignup ${OB.busy?"disabled":""}>${OB.busy?t("s_busy"):t("s_go")}</button><span class="grow"></span>${s==="signup"?`<button class="ob-skip" type="button" data-obgo="prev">${t("back")}</button>`:""}</div>`;
  if(s==="about")return `${bars()}${head(t("ab_eb"))}<h2>${t("ab_h")}</h2><p>${t("ab_p")}</p>
    ${field("name",t("ab_name"),"text","Justin")}
    <span class="ob-label">${t("ab_role")}<span class="ob-req">*</span></span>
    <div class="ob-roles">${ROLES[L()].map(([k,n,d])=>`<button type="button" class="ob-role${OB.role===k?" on":""}" data-obrole="${k}">${n}<small>${d}</small></button>`).join("")}</div>
    <div class="ob-err" id="oberr-role" hidden>${t("err_role")}</div>
    <p class="ob-hint">${t("ab_hint")}</p>
    <div class="ob-acts"><button class="btn pri" type="button" data-obabout>${t("cont")}</button><span class="grow"></span><button class="ob-skip" type="button" data-obgo="prev">${t("back")}</button></div>`;
  if(s==="ai")return `${bars()}${head(t("a_eb"))}<h2>${t("a_h")}</h2><p>${t("a_p")}</p>${aiBlock()}
    <div class="ob-acts"><button class="btn pri" type="button" data-obaisave="next">${t("a_save")}</button><span class="grow"></span><button class="ob-skip" type="button" data-obgo="next">${t("skip")}</button></div>`;
  if(s==="aiPanel")return `${head(t("a_title"),true)}<h2>${t("a_h")}</h2><p>${t("a_p")}</p>${aiBlock()}
    <div class="ob-acts"><button class="btn pri" type="button" data-obaisave="close">${t("save")}</button><button class="btn" type="button" data-obclose>${t("cancel")}</button><span class="grow"></span>${P.ai&&P.ai.ok?`<button class="ob-skip" type="button" data-obaioff>${t("a_off")}</button>`:""}</div>`;
  if(s==="mac")return `${bars()}${head(t("m_eb"))}<h2>${t("m_h")}</h2><p>${t("m_p")}</p>
    <div class="ob-perks">${t("m_perks").map(([ic,h,d])=>`<div class="ob-perk"><span class="ic" aria-hidden="true">${ic}</span><div><div class="h">${h}</div><div class="d">${d}</div></div></div>`).join("")}</div>
    <div class="ob-dl"><div class="ob-appicon">${ICON_SVG}</div><div style="min-width:0"><div style="font-weight:500">Followthrough</div><div class="ob-hint" style="margin:0">${t("m_meta").map(x=>`<span style="white-space:nowrap">${x}</span>`).join(" · ")}</div></div><span class="grow"></span><a class="btn pri" href="${DOWNLOAD_URL}" target="_blank" rel="noopener">${t("m_dl")}</a></div>
    <div class="ob-open"><div class="ob-open-h">${L()==="zh"?"第一次打开":"Opening it the first time"}</div>${t("m_first").map(x=>`<p class="ob-hint">${x}</p>`).join("")}</div>
    <div class="ob-acts"><button class="btn pri" type="button" data-obgo="next">${t("cont")}</button><span class="grow"></span><button class="ob-skip" type="button" data-obgo="next">${t("m_later")}</button></div>`;
  if(s==="done")return `${bars()}${head(t("d_eb"))}<h2>${t("d_h")(esc(P.name||""))}</h2><p>${t("d_p")}</p>
    <div class="ob-choice"><button type="button" class="ob-opt${OB.start!=="sample"?" on":""}" data-obstart="own"><span class="ic" aria-hidden="true">＋</span><span><span class="h">${t("o1h")}</span><span class="d">${t("o1d")}</span></span></button>
    <button type="button" class="ob-opt${OB.start==="sample"?" on":""}" data-obstart="sample"><span class="ic" aria-hidden="true">◎</span><span><span class="h">${t("o2h")}</span><span class="d">${t("o2d")(roleLabel())}</span></span></button></div>
    <div class="ob-acts"><button class="btn pri" type="button" data-obfinish>${t("d_go")}</button></div>`;
  if(s==="settings"){const pv=P.ai&&P.ai.ok?PROVIDERS[P.ai.provider]:null;
    return `${head(t("settings"),true)}
    <div class="ob-set"><h3>${t("st_lang")}</h3>${langSeg().replace("margin-left:auto","")}</div>
    <div class="ob-set"><h3>${t("st_role")}</h3><div class="ob-roles">${ROLES[L()].map(([k,n])=>`<button type="button" class="ob-role sm${(P.role||"product")===k?" on":""}" data-obsetrole="${k}">${n}</button>`).join("")}</div></div>
    <div class="ob-set"><h3>${t("st_theme")}</h3><div class="ob-seg">${t("st_themes").map(([k,l])=>`<button type="button" data-obtheme="${k}" class="${P.theme===k?"on":""}">${l}</button>`).join("")}</div></div>
    ${IS_ARTIFACT?"":`<div class="ob-set"><h3>${t("st_ai")}</h3><div class="ob-setrow"><span class="l">${pv?esc(t("st_aiOn")(pv.label,P.ai.model)):t("st_aiOff")}</span><button class="btn sm" type="button" data-ob="ai">${pv?t("st_aiEdit"):t("st_aiBtn")}</button></div></div>`}
    <div class="ob-set"><h3>${t("st_data")}</h3><div class="ob-setrow"><span class="l">${IS_ARTIFACT?t("st_dataL_a"):t("st_dataL")}</span><button class="btn sm" type="button" data-obexport>${t("st_exp")}</button><button class="btn sm" type="button" data-obgo="import">${t("st_imp")}</button><button class="btn sm" type="button" data-oberase style="color:var(--danger)">${t("st_erase")}</button></div>
      ${OB.erase?`<div class="ob-setrow" style="margin-top:8px"><span class="l" style="color:var(--danger)">${t("st_eraseQ")}</span><button class="btn sm" type="button" data-oberaseyes style="color:var(--danger);border-color:var(--danger)">${t("st_eraseYes")}</button><button class="btn sm" type="button" data-oberaseno>${t("cancel")}</button></div>`:""}</div>
    ${IS_ARTIFACT?"":`<div class="ob-set"><h3>${t("st_acct")}</h3><div class="ob-setrow"><span class="l">${P.email?esc(P.email):t("st_noAcct")}</span>${P.email?"":`<button class="btn sm" type="button" data-obgo="signupOnly">${t("st_signup")}</button>`}</div></div>`}
    <div class="ob-set"><h3>${t("st_help")}</h3><div class="ob-setrow"><button class="ob-lnk" type="button" data-obtour>${t("st_tour")}</button><span class="grow"></span><a class="ob-lnk" href="${REPO_URL}" target="_blank" rel="noopener">${t("p_code")}</a></div><p class="ob-hint">${t("st_ver")(VERSION)}</p></div>
    <div class="ob-acts"><button class="btn pri" type="button" data-obclose>${t("done")}</button></div>`;}
  if(s==="setup")return `${head(t("su_eb"),true)}<h2>${t("su_h")}</h2><p>${t("su_p")}</p>
    <span class="ob-label">${t("su_people")}<span class="ob-req">*</span></span>
    <input class="inp" id="ob-ppl" placeholder="${esc(t("su_name"))}" value="${esc(OB.pplName||"")}" autocomplete="off">
    <div class="ob-hint">${t("su_team")}</div>
    <div class="ob-teams">${TEAMS[L()][roleKey()].map(x=>`<button type="button" class="ob-sug" data-obteam="${esc(x)}">${esc(x)}</button>`).join("")}<button type="button" class="ob-sug${OB.otherTeam?" on":""}" data-obteam="__other">${t("su_other")}</button></div>
    ${OB.otherTeam?`<div class="ob-keyrow"><input class="inp" id="ob-otherteam" placeholder="${esc(t("su_otherPh"))}" style="font-family:inherit"><button class="btn" type="button" data-obaddother>${t("su_add")}</button></div>`:""}
    <div class="ob-err" id="oberr-ppl" hidden></div>
    <div class="ob-chips">${OB.people.map((p,i)=>`<span class="ob-chip">${esc(p)}<button type="button" data-obrm="${i}" aria-label="×">×</button></span>`).join("")}</div>
    <p class="ob-hint" style="margin-top:12px">${t("su_after")}</p>
    <div class="ob-acts"><button class="btn pri" type="button" data-obsetup>${t("su_go")}</button></div>`;
  if(s==="import")return `${head(t("imp_eb"),true)}<h2>${t("imp_h")}</h2><p>${t("imp_p")}</p>
    <div class="ob-drop" id="obDrop"><span class="big" aria-hidden="true">⇪</span><span>${t("imp_drop")}</span><label class="btn sm" style="cursor:pointer">${t("imp_pick")}<input type="file" id="obFile" accept=".json,.csv,.md,.markdown,.txt,application/json,text/plain,text/csv,text/markdown" hidden></label></div>
    ${OB.impBusy?`<div class="thinking" style="margin-top:8px"><span class="dots"><i></i><i></i><i></i></span>${t("imp_reading")}</div>`:""}
    ${OB.impErr?`<div class="ob-err">${esc(OB.impErr)}</div>`:""}
    <div class="ob-kinds">${t("imp_kinds").map(([h,d])=>`<div class="ob-kind"><span aria-hidden="true">•</span><span><b>${h}</b><br>${d}</span></div>`).join("")}</div>`;
  if(s==="scanned"){const im=OB.imp,c=[im.board.tasks.length,im.board.questions.length,im.board.people.length,(im.board.sessions||[]).length],total=c[0]+c[1]+c[2]+c[3];
    return `${head(t("imp_eb"),true)}<h2>${t("imp_h")}</h2>
    <div class="ob-scan"><div class="f">${esc(im.file)}</div><div style="margin-top:6px;font-size:13px">✓ ${t("imp_found")}</div>
      <div class="ob-counts">${t("imp_c").map((l,i)=>`<div class="ob-cnt"><div class="v">${c[i]}</div><div class="l">${l}</div></div>`).join("")}</div>
      <div class="ob-hint">${im.ai?esc(t("imp_ai")(aiName())):esc(t("imp_from")(im.date,im.version))}</div></div>
    <p class="ob-hint">${t("imp_replace")}</p>
    <div class="ob-acts"><button class="btn pri" type="button" data-obimport>${t("imp_go")(total)}</button><span class="grow"></span><button class="ob-skip" type="button" data-obgo="import">${t("imp_other")}</button></div>`;}
  return "";
}
function drawOB(){
  let root=$("#obRoot");if(!root){root=document.createElement("div");root.id="obRoot";document.body.appendChild(root);}
  if(!OB.screen){root.innerHTML="";return;}
  const wide=OB.screen==="settings"||OB.screen==="aiPanel";
  root.innerHTML=`<div class="ob-scrim" data-obscrim><div class="ob-card${wide?" wide":""}" role="dialog" aria-modal="true" data-obstop>${cardHTML()}</div></div>`;
  wireOB();glue(root);evenRows(root);
  const first=root.querySelector("input.inp:not([type=password])");if(first&&!first.value)setTimeout(()=>first.focus(),0);
}
function wireOB(){
  document.querySelectorAll("[data-obf]").forEach(el=>el.addEventListener("input",()=>{OB.vals[el.dataset.obf]=el.value;el.classList.remove("bad");const e=$("#oberr-"+el.dataset.obf);if(e)e.hidden=true;}));
  const k=$("#ob-key");if(k)k.addEventListener("input",()=>{OB.key=k.value.trim();OB.tested=false;OB.models=[];});
  const b=$("#ob-base");if(b)b.addEventListener("input",()=>{OB.base=b.value.trim();OB.tested=false;});
  const m=$("#ob-main");if(m)m.onchange=()=>OB.main=m.value;const f=$("#ob-fast");if(f)f.onchange=()=>OB.fast=f.value;
  const p=$("#ob-ppl");if(p){p.addEventListener("input",()=>{OB.pplName=p.value;$("#oberr-ppl").hidden=true;});p.addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.isComposing){e.preventDefault();addPerson2("");}});}
  const ot=$("#ob-otherteam");if(ot){setTimeout(()=>ot.focus(),0);ot.addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.isComposing){e.preventDefault();addPerson2(ot.value.trim());}});}
  const file=$("#obFile");if(file)file.onchange=()=>{if(file.files[0])readImport(file.files[0]);};
  const drop=$("#obDrop");if(drop){drop.ondragover=e=>{e.preventDefault();drop.classList.add("over");};drop.ondragleave=()=>drop.classList.remove("over");drop.ondrop=e=>{e.preventDefault();drop.classList.remove("over");const f=e.dataTransfer.files[0];if(f)readImport(f);};}
}
function check(ids){let ok=true,first=null;ids.forEach(([id,kind])=>{
  if(id==="ppl"){const bad=!OB.people.length;const e=$("#oberr-ppl");e.textContent=t("err_people");e.hidden=!bad;if(bad){ok=false;first=first||$("#ob-ppl");}return;}
  if(id==="role"){const bad=!OB.role;$("#oberr-role").hidden=!bad;if(bad)ok=false;return;}
  const el=$("#ob-"+id),e=$("#oberr-"+id),v=el.value.trim();let msg="";
  if(!v)msg=t("err_req");else if(kind==="email"&&!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v))msg=t("err_email");
  el.classList.toggle("bad",!!msg);e.textContent=msg;e.hidden=!msg;if(msg){ok=false;first=first||el;}});
  if(first)first.focus();return ok;}

async function sendSignup(){
  /* No sign-up backend configured yet: keep the email on this device and send it once a later version has one. */
  if(!CFG.signupUrl||!CFG.signupKey){P.signupPending=true;savePrefs();return true;}
  try{const res=await http(CFG.signupUrl.replace(/\/+$/,"")+"/rest/v1/signups",{method:"POST",headers:Object.assign({apikey:CFG.signupKey,"content-type":"application/json",Prefer:"return=minimal"},/^eyJ/.test(CFG.signupKey)?{Authorization:"Bearer "+CFG.signupKey}:{}),body:JSON.stringify({email:P.email,lang:P.lang,source:IS_MAC?"mac":"web",app_version:VERSION})});
    const ok=res.status<300||res.status===409;P.signupPending=!ok;savePrefs();return ok;}
  catch(e){P.signupPending=true;savePrefs();return false;}
}
async function testKey(){
  OB.prov=OB.prov||"anthropic";const a={provider:OB.prov,key:OB.key,base:OB.base};
  if(!a.key&&OB.prov!=="custom"){OB.testErr=t("a_errs").auth;drawOB();return false;}
  OB.testing=true;OB.testErr="";drawOB();
  try{const ids=(await listModels(a)).sort();if(!ids.length)throw {code:"no_model"};
    const [mm,ff]=pickModels(OB.prov,ids);OB.models=ids;OB.main=OB.main&&ids.includes(OB.main)?OB.main:mm;OB.fast=OB.fast&&ids.includes(OB.fast)?OB.fast:ff;OB.tested=true;}
  catch(e){OB.tested=false;OB.models=[];const E=t("a_errs");OB.testErr=E[e&&e.code]||E.other+(e&&e.message?" ("+String(e.message).slice(0,120)+")":"");}
  OB.testing=false;drawOB();return OB.tested;
}
function saveAI(){P.ai={provider:OB.prov,key:OB.key,base:OB.base,model:OB.main,fast:OB.fast,models:OB.models,ok:true};savePrefs();CLAUDE=makeAdapter(P.ai);render();}

/* ---------- export / import ---------- */
function backupJSON(){return JSON.stringify({app:"followthrough",version:VERSION,exportedAt:new Date().toISOString(),board:S},null,2);}
async function exportData(){
  const name="followthrough-backup-"+TODAY()+".json",data=backupJSON();
  try{if(IS_ARTIFACT){const dl=await window.claude.use("downloads");if(!dl)throw {code:"unavailable"};await dl.save({filename:name,data});}
    else if(IS_MAC){await native("saveFile",{name,data});}
    else{const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([data],{type:"application/json"}));a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),2000);}
    toast(t("exp_done"));}catch(e){}
}
function validBoard(b){return b&&Array.isArray(b.tasks)&&Array.isArray(b.questions)&&Array.isArray(b.people);}
function readImport(file){
  OB.impErr="";const r=new FileReader();
  r.onload=async()=>{const text=String(r.result||"");let j=null;try{j=JSON.parse(text);}catch(e){}
    const board=j&&(validBoard(j.board)?j.board:validBoard(j)?j:null);
    if(board){OB.imp={file:file.name+" · "+Math.max(1,Math.round(file.size/1024))+" KB",board,date:j.exportedAt?fmtDate(j.exportedAt):"—",version:j.version||"1.0",ai:false};openOB("scanned");return;}
    if(!CLAUDE){OB.impErr=t("imp_bad");drawOB();return;}
    OB.impBusy=true;drawOB();
    try{const out=await CLAUDE.json(`Turn these notes into a task board for someone who coordinates work with other people. Today is ${TODAY()}.
Reply with only JSON: {"people":[{"name":"","team":""}],"tasks":[{"title":"","next":"","prio":"P0|P1|P2","due":"YYYY-MM-DD or null","waitingOn":"person name or null","waitingFor":"what they owe or null"}],"questions":[{"text":"","person":"person name","answer":"answer if the notes contain one, else empty"}]}
Use only what the notes say. At most 40 tasks and 40 questions.

Notes (${file.name}):
"""
${text.slice(0,60000)}
"""`,{modelTier:"default"});
      const b=fromAI(out);if(!b.tasks.length&&!b.questions.length)throw {code:"empty"};
      OB.imp={file:file.name+" · "+Math.max(1,Math.round(file.size/1024))+" KB",board:b,ai:true};OB.impBusy=false;openOB("scanned");
    }catch(e){OB.impBusy=false;OB.impErr=e&&e.code==="empty"?t("imp_none"):claudeErr(e);drawOB();}
  };
  r.readAsText(file);
}
function fmtDate(isoStr){const d=new Date(isoStr);if(isNaN(d))return "—";return L()==="zh"?`${d.getMonth()+1} 月 ${d.getDate()} 日`:MON[d.getMonth()]+" "+d.getDate();}
function fromAI(o){const b=emptyState();b.project=P.project||b.project;const byName={};
  const pid=n=>{n=String(n||"").trim();if(!n)return "";const k=n.toLowerCase();if(!byName[k]){const p={id:uid("p_"),name:n,team:""};b.people.push(p);byName[k]=p.id;}return byName[k];};
  (o.people||[]).forEach(p=>{const id=pid(p.name);const pp=b.people.find(x=>x.id===id);if(pp&&p.team)pp.team=String(p.team);});
  (o.tasks||[]).slice(0,40).forEach(x=>{if(!x||!x.title)return;const w=x.waitingOn?{personId:pid(x.waitingOn),what:String(x.waitingFor||"A reply"),since:TODAY()}:null;
    b.tasks.push({id:uid("t_"),title:String(x.title),prio:["P0","P1","P2"].includes(x.prio)?x.prio:"P1",status:"open",next:String(x.next||""),due:/^\d{4}-\d{2}-\d{2}$/.test(x.due||"")?x.due:null,waiting:w,history:[{at:TODAY(),text:"Imported."}],created:TODAY()});});
  (o.questions||[]).slice(0,40).forEach(x=>{if(!x||!x.text)return;b.questions.push({id:uid("q_"),personId:pid(x.person||"Someone"),taskId:"",text:String(x.text),answer:String(x.answer||""),answeredAt:x.answer?TODAY():null,created:TODAY()});});
  return b;}
function doImport(){undoSnap=JSON.stringify(S);const b=JSON.parse(JSON.stringify(OB.imp.board));b.sample=false;b.pristine=false;b.draft=null;S=b;normalize();save();P.onboarded=true;savePrefs();OB.imp=null;closeOB();render();toast(t("imp_done"),true);}

/* ---------- board setup ---------- */
function addPerson2(team){
  const name=(OB.pplName||"").trim(),e=$("#oberr-ppl");
  if(!name){e.textContent=t("err_name");e.hidden=false;$("#ob-ppl").focus();return;}
  OB.people.push(name+(team?" · "+team:""));OB.pplName="";OB.otherTeam=false;drawOB();$("#ob-ppl").focus();
}
function createBoard(){
  if(!check([["ppl"]]))return;
  const b=emptyState();b.project="";
  OB.people.forEach(s=>{const [n,...rest]=s.split(/\s*[·,，]\s*/);if(n)b.people.push({id:uid("p_"),name:n,team:rest.join(", ")});});
  S=b;normalize();save();P.onboarded=true;savePrefs();closeOB();go("today");
}

/* ---------- live transcription ---------- */
const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
const REC={on:false,who:"me",rec:null,t0:0,local:false,err:"",
  can(){return !IS_ARTIFACT&&(IS_MAC||!!SR);},
  start(){const d=draft();this.err="";this.on=true;this.t0=Date.now()-CAP.elapsed*1000;CAP.editing=false;
    const lang=L()==="zh"?"zh-CN":"en-US";
    CAP.tick=setInterval(()=>{CAP.elapsed=Math.round((Date.now()-this.t0)/1000);const tm=$("#timer");if(tm)tm.textContent=fmtClock(CAP.elapsed);
      document.querySelectorAll("#wave span").forEach((s,j)=>{if(j>95)s.style.height=Math.round(6+Math.random()*24)+"px";});},1000);
    if(IS_MAC){native("speech.start",{lang}).catch(e=>{this.fail(e&&e.code==="denied"?t("rec_denied"):String(e&&e.message||e));});render();return;}
    const r=new SR();r.lang=lang;r.continuous=true;r.interimResults=true;this.rec=r;
    const go=()=>{try{r.start();}catch(e){}};
    if(SR.available&&"processLocally" in r){SR.available({langs:[lang],processLocally:true}).then(st=>{if(st==="available"){r.processLocally=true;this.local=true;}go();render();}).catch(()=>go());}else go();
    r.onresult=e=>{let interim="";for(let i=e.resultIndex;i<e.results.length;i++){const x=e.results[i];if(x.isFinal)this.line(x[0].transcript);else interim+=x[0].transcript;}const el=$("#interim");if(el)el.textContent=interim;};
    r.onerror=e=>{if(e.error==="not-allowed"||e.error==="service-not-allowed")this.fail(t("rec_denied"));};
    r.onend=()=>{if(this.on)go();};
    render();
  },
  line(text){text=String(text||"").trim();if(!text)return;const d=draft();const p=person(d.personId);
    const sp=this.who==="me"?(L()==="zh"?"我":"You"):(p?p.name:t("rec_them"));
    d.transcript+=(d.transcript?"\n":"")+`[${fmtClock(CAP.elapsed)}] ${sp}: ${text.charAt(0).toUpperCase()+text.slice(1)}`;save();render();},
  onNative(ev){if(ev.type==="final")this.line(ev.text);else if(ev.type==="partial"){const el=$("#interim");if(el)el.textContent=ev.text;}else if(ev.type==="error")this.fail(ev.code==="denied"?t("rec_denied"):ev.message);},
  stop(){this.on=false;clearInterval(CAP.tick);if(IS_MAC)native("speech.stop").catch(()=>{});else if(this.rec)try{this.rec.stop();}catch(e){}save();render();},
  fail(msg){this.err=msg;this.stop();}
};
function captureChrome(){
  const d=S.draft;if(!d||d.phase==="review")return;
  const ctrl=$(".sess .ctrl");if(!ctrl)return;
  const hint=[...document.querySelectorAll(".tx > p.hint")].pop();
  if(hint)hint.textContent=IS_ARTIFACT?t("rec_art"):!REC.can()?t("rec_none"):REC.on?(IS_MAC?t("rec_mac"):REC.local?t("rec_local"):t("rec_web")):(REC.err||t("rec_hint"));
  if(!REC.can()||CAP.replay)return;
  const p=person(d.personId);
  if(REC.on){
    ctrl.querySelectorAll('[data-act="replay"]').forEach(b=>b.remove());
    ctrl.insertAdjacentHTML("afterbegin",`<span class="live" data-raw><i></i>${L()==="zh"?"录音中":"Recording"}</span>`);
    ctrl.insertAdjacentHTML("beforeend",`<button class="btn stop" type="button" data-rec="stop" data-raw>${t("rec_stop")}</button>`);
    $(".wave")&&$(".wave").classList.add("on");
    const tx=$(".tx");tx.insertAdjacentHTML("afterbegin",`<div class="rec-bar" data-raw><span class="hint">${t("rec_who")}</span><button type="button" class="who-btn${REC.who==="me"?" on":""}" data-who="me">${t("rec_me")}</button><button type="button" class="who-btn${REC.who==="them"?" on":""}" data-who="them">${esc(p?p.name:t("rec_them"))}</button></div>`);
    const lines=$("#lines")||$(".emptytx");if(lines)lines.insertAdjacentHTML("afterend",`<div class="interim" id="interim" data-raw></div>`);
    const et=$(".emptytx");if(et&&!d.transcript)et.hidden=true;
  }else{
    ctrl.insertAdjacentHTML("afterbegin",`<button class="btn" type="button" data-rec="start" data-raw><span class="rec" style="display:inline-block;margin-right:6px;vertical-align:1px"></span>${t("rec")}</button>`);
  }
}

/* ---------- events ---------- */
document.addEventListener("click",async e=>{
  const g=k=>e.target.closest(k);let el;
  if(el=g("[data-ob]")){openOB(el.dataset.ob==="ai"?"aiPanel":el.dataset.ob);return;}
  if(el=g("[data-rec]")){el.dataset.rec==="start"?REC.start():REC.stop();return;}
  if(el=g("[data-who]")){REC.who=el.dataset.who;document.querySelectorAll(".who-btn").forEach(b=>b.classList.toggle("on",b===el));return;}
  if(!OB.screen){
    if(g('[data-act="fresh-yes"]')&&!S.sample)openOB("setup");
    return;}
  if(g("[data-obscrim]")&&!g("[data-obstop]")){if(!["welcome","privacy","signup","about","ai","mac","done","setup"].includes(OB.screen))closeOB();return;}
  if(el=g("[data-lang]")){P.lang=el.dataset.lang;savePrefs();document.documentElement.lang=P.lang==="zh"?"zh-CN":"en";applySampleLang();if(S&&S.sample&&S.pristine){S=sampleState();}render();drawOB();return;}
  if(el=g("[data-obgo]")){const v=el.dataset.obgo;openOB(v==="next"?nextStep():v==="prev"?prevStep():v);return;}
  if(g("[data-obclose]")){closeOB();return;}
  if(el=g("[data-obtab]")){OB.tab=+el.dataset.obtab;drawOB();return;}
  if(el=g("[data-obprov]")){if(OB.prov!==el.dataset.obprov){OB.prov=el.dataset.obprov;OB.tested=false;OB.models=[];OB.testErr="";OB.main="";OB.fast="";if(!P.ai||P.ai.provider!==OB.prov)OB.key="";else OB.key=P.ai.key;}drawOB();return;}
  if(g("[data-obtest]")){testKey();return;}
  if(el=g("[data-obaisave]")){if(!OB.tested){if(!OB.key&&OB.prov!=="custom"){OB.testErr=t("a_need");drawOB();return;}if(!(await testKey()))return;}saveAI();el.dataset.obaisave==="next"?openOB(nextStep()):closeOB();return;}
  if(g("[data-obaioff]")){P.ai=null;savePrefs();CLAUDE=null;OB.tested=false;OB.models=[];OB.key="";closeOB();render();return;}
  if(g("[data-obsignup]")){if(!check([["email","email"]]))return;P.email=$("#ob-email").value.trim();savePrefs();OB.busy=true;drawOB();await sendSignup();OB.busy=false;if(OB.screen==="signupOnly"){toast(t("signed"));openOB("settings");}else openOB(nextStep());return;}
  if(el=g("[data-obrole]")){OB.role=el.dataset.obrole;document.querySelectorAll(".ob-role").forEach(b=>b.classList.toggle("on",b===el));$("#oberr-role").hidden=true;return;}
  if(g("[data-obabout]")){if(!check([["name"],["role"]]))return;P.name=$("#ob-name").value.trim();const roleChanged=P.role!==OB.role;P.role=OB.role;ME=P.name;if(roleChanged&&S.sample&&S.pristine){S=sampleState();applySampleLang();}savePrefs();render();openOB(nextStep());return;}
  if(el=g("[data-obstart]")){OB.start=el.dataset.obstart;document.querySelectorAll(".ob-opt").forEach(b=>b.classList.toggle("on",b===el));return;}
  if(g("[data-obfinish]")){P.onboarded=true;savePrefs();if(OB.start==="sample"){if(!S.sample){S=sampleState();applySampleLang();save();}closeOB();go("today");}else openOB("setup");return;}
  if(el=g("[data-obteam]")){if(el.dataset.obteam==="__other"){OB.otherTeam=!OB.otherTeam;OB.pplName=($("#ob-ppl")||{}).value||OB.pplName;drawOB();}else{OB.pplName=($("#ob-ppl")||{}).value||"";addPerson2(el.dataset.obteam);}return;}
  if(g("[data-obaddother]")){addPerson2(($("#ob-otherteam")||{}).value.trim());return;}
  if(el=g("[data-obsetrole]")){P.role=el.dataset.obsetrole;savePrefs();if(S.sample&&S.pristine){S=sampleState();applySampleLang();}render();drawOB();return;}
  if(el=g("[data-obtheme]")){P.theme=el.dataset.obtheme;savePrefs();applyTheme();drawOB();return;}
  if(g("[data-obexport]")){exportData();return;}
  if(g("[data-oberase]")){OB.erase=true;drawOB();return;}
  if(g("[data-oberaseno]")){OB.erase=false;drawOB();return;}
  if(g("[data-oberaseyes]")){if(IS_ARTIFACT&&typeof dbRef!=="undefined"&&dbRef){try{await dbRef.delete();}catch(x){}}kvSet(LS_KEY,null);kvSet(PREF_KEY,null);kvSet("pm-tracker-theme",null);try{localStorage.clear();}catch(x){}location.reload();return;}
  if(g("[data-obtour]")){openOB("welcome");return;}
  if(el=g("[data-obrm]")){OB.people.splice(+el.dataset.obrm,1);drawOB();return;}
  if(g("[data-obsetup]")){createBoard();return;}
  if(g("[data-obimport]")){doImport();return;}
});
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&OB.screen&&!["welcome","privacy","signup","about","ai","mac","done","setup"].includes(OB.screen))closeOB();});

/* ---------- start ---------- */
document.documentElement.lang=P.lang==="zh"?"zh-CN":"en";
applyTheme();applySampleLang();ME=P.name||"";
if(!IS_ARTIFACT&&P.signupPending&&P.email)sendSignup();
window.TRACKER={IS_ARTIFACT,P,OB,REC,PROVIDERS,listModels,pickModels,makeAdapter,parseJSONLoose,localize,zh,openOB,closeOB,IS_MAC};
boot();
if(!P.onboarded)openOB("welcome");
})();
