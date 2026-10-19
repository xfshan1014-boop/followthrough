/* Self-test for the web version. Load it into docs/index.html on a local server:
   const s=document.createElement('script');s.src='../tests/hosted-test.js';document.body.appendChild(s)
   Mocks the network, so no real API key is used. Results land in <pre id="testout">. */
(async function(){
  const out=[];let pass=0,fail=0;
  const ok=(c,m)=>{if(c){pass++;out.push("PASS  "+m);}else{fail++;out.push("FAIL  "+m);}};
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  const q=s=>document.querySelector(s);
  const click=s=>{const el=typeof s==="string"?q(s):s;if(!el)throw new Error("missing "+s);el.click();};
  const type=(s,v)=>{const el=q(s);if(!el)throw new Error("missing "+s);el.value=v;el.dispatchEvent(new Event("input",{bubbles:true}));};
  const TR=window.TRACKER;

  /* fake network: records each request, answers like the real provider would */
  const reqs=[];
  window.fetch=async(url,opts={})=>{const body=opts.body?JSON.parse(opts.body):null;const h=opts.headers||{};reqs.push({url:String(url),method:opts.method||"GET",h,body});
    const res=(status,obj)=>({status,text:async()=>JSON.stringify(obj)});
    const u=String(url);
    if(h["x-api-key"]==="bad"||h.Authorization==="Bearer bad")return res(401,{error:{message:"invalid x-api-key"}});
    if(u.includes("/rest/v1/signups"))return res(201,{});
    if(u.endsWith("/models")){
      if(u.includes("anthropic"))return res(200,{data:[{id:"claude-haiku-5-5"},{id:"claude-sonnet-5-5"},{id:"claude-opus-5-5"}]});
      if(u.includes("googleapis"))return res(200,{models:[{name:"models/gemini-pro-x",supportedGenerationMethods:["generateContent"]},{name:"models/gemini-flash-x",supportedGenerationMethods:["generateContent"]},{name:"models/embed-x",supportedGenerationMethods:["embedContent"]}]});
      return res(200,{data:[{id:"model-large"},{id:"model-mini"},{id:"text-embedding-3"}]});}
    const reply='{"summary":"总结","items":[{"type":"next_action","taskId":"t_metric","title":"更新指标文档","detail":"","due":null,"quote":null}]}';
    if(u.includes("/messages"))return res(200,{content:[{type:"text",text:reply}],stop_reason:"end_turn"});
    if(u.includes(":generateContent"))return res(200,{candidates:[{content:{parts:[{text:"Gemini says hi"}]},finishReason:"STOP"}]});
    if(u.includes("/chat/completions"))return res(200,{choices:[{message:{content:"```json\n"+reply+"\n```"},finish_reason:"stop"}]});
    return res(404,{error:{message:"not found"}});
  };

  /* clean slate */
  try{localStorage.clear();}catch(e){}
  Object.assign(TR.P,{lang:"en",theme:"system",onboarded:false,email:"",name:"",project:"",role:"",ai:null});
  Object.assign(TR.OB,{start:"own",role:"",prov:"anthropic",key:"",base:"",models:[],main:"",fast:"",tested:false,testErr:"",people:[],vals:{},imp:null});
  S=sampleState();CLAUDE=null;TR.openOB("welcome");await wait(30);

  /* 1 welcome */
  ok(q(".ob-card h2").textContent.includes("Congrats"),"Welcome card opens on first visit");
  const pills=[...document.querySelectorAll(".ob-pill")].map(p=>Math.round(p.getBoundingClientRect().top));
  ok(new Set(pills).size===1||pills.length%2===0&&q(".ob-pills").classList.contains("ob-even"),"Feature pills: one line, or evenly split");
  click('[data-lang="zh"]');await wait(30);
  ok(q(".ob-card h2").textContent.includes("恭喜"),"Language switch turns the card Chinese");
  ok(q(".hello")&&/下午好|早上好|晚上好/.test(q(".hello").textContent),"Board behind the card turns Chinese too");
  ok(S.tasks[0].title.includes("锁定"),"Untouched sample week switches to the Chinese sample");
  click('[data-lang="en"]');await wait(30);
  ok(S.tasks[0].title.startsWith("Lock"),"Switching back restores the English sample");
  click('[data-obgo="next"]');await wait(20);

  /* 2 privacy */
  ok(q(".ob-card").textContent.includes("We store one thing: your email"),"Privacy step states we store only the email");
  ok(!q(".ob-card").textContent.includes("Erase everything"),"Privacy step has no action buttons");
  click('[data-obgo="next"]');await wait(20);

  /* 3 sign up: email only, required */
  ok(document.querySelectorAll(".ob-card input.inp").length===1,"Sign-up asks for email only");
  click("[data-obsignup]");await wait(20);
  ok(!q("#oberr-email").hidden&&TR.OB.screen==="signup","Empty email is blocked");
  type("#ob-email","justin@");click("[data-obsignup]");await wait(20);
  ok(q("#oberr-email").textContent.includes("valid"),"Malformed email is blocked");
  type("#ob-email","justin@example.com");click("[data-obsignup]");await wait(60);
  ok(TR.OB.screen==="about"&&TR.P.email==="justin@example.com","Valid email moves on and is saved");

  /* 4 about you: name + role, both required, no project question */
  ok(!q(".ob-card").textContent.includes("working on"),"No 'What are you working on' question");
  click("[data-obabout]");await wait(20);
  ok(!q("#oberr-name").hidden&&!q("#oberr-role").hidden,"Name and role are required");
  ok(document.querySelectorAll(".ob-role").length===6,"Six role options");
  type("#ob-name","Justin");click('[data-obrole="ops"]');click("[data-obabout]");await wait(30);
  ok(TR.OB.screen==="ai"&&/Justin/.test(q(".hello").textContent),"Greeting uses the name right away");
  ok(TR.P.role==="ops"&&S.sample&&S.people.some(p=>p.name==="Lina"),"Role Operations switches to the Operations sample week");
  ok(q(".banner").textContent.includes("Sample operations week"),"Banner names the role's sample week");

  /* 5 AI: providers, test, errors */
  click('[data-obtab="2"]');await wait(10);ok(q(".ob-demo").textContent.includes("Slack nudge"),"AI preview tabs switch");
  click('[data-obaisave="next"]');await wait(20);
  ok(q(".ob-card .ob-err")&&TR.OB.screen==="ai","Save without a key asks to test first");
  type("#ob-key","bad");click("[data-obtest]");await wait(40);
  ok(q(".ob-card .ob-err").textContent.includes("rejected"),"Rejected key shows a clear error");
  type("#ob-key","sk-ant-test");click("[data-obtest]");await wait(40);
  const ar=reqs.filter(r=>r.url==="https://api.anthropic.com/v1/models").pop();
  ok(ar&&ar.h["x-api-key"]==="sk-ant-test"&&ar.h["anthropic-version"]&&ar.h["anthropic-dangerous-direct-browser-access"]==="true","Anthropic: models request has the right headers");
  ok(TR.OB.main==="claude-sonnet-5-5"&&TR.OB.fast==="claude-haiku-5-5","Anthropic: picks Sonnet for reviews, Haiku for quick notes");
  click('[data-obaisave="next"]');await wait(30);
  ok(TR.P.ai&&TR.P.ai.ok&&TR.OB.screen==="mac","Key saved, moves to Mac app step");
  ok(q("#tbExtra").textContent.includes("Claude"),"Top bar shows AI: Claude");

  /* 6 mac + 7 done: choose how to start */
  ok(q('.ob-card a[href*="releases/latest"]'),"Mac step links to the download");
  click('[data-obgo="next"]');await wait(20);
  ok(q(".ob-card h2").textContent.includes("Justin")&&document.querySelectorAll(".ob-opt").length===2,"Done card asks how to start");
  ok(q('.ob-opt.on[data-obstart="own"]'),"Set up my board is the default");
  click('[data-obstart="sample"]');click("[data-obfinish]");await wait(30);
  ok(!q(".ob-scrim")&&TR.P.onboarded&&S.sample,"Sample week choice closes onboarding on the sample");

  /* AI through the board: Anthropic message format */
  const r1=await CLAUDE.json("Return JSON",{modelTier:"default"});
  const m1=reqs.filter(r=>r.url.endsWith("/v1/messages")).pop();
  ok(r1.summary==="总结"&&m1.body.model==="claude-sonnet-5-5"&&m1.body.max_tokens>0&&m1.body.messages[0].role==="user","Anthropic: messages call and JSON parse work");
  await CLAUDE("hi",{modelTier:"quick"});ok(reqs.filter(r=>r.url.endsWith("/v1/messages")).pop().body.model==="claude-haiku-5-5","Quick tier uses the fast model");

  /* other providers */
  const prov=async(provider,key,base)=>{TR.OB.prov=provider;TR.OB.key=key;TR.OB.base=base||"";TR.OB.tested=false;TR.OB.models=[];TR.OB.main="";TR.OB.fast="";TR.openOB("aiPanel");await wait(10);click("[data-obtest]");await wait(40);};
  await prov("openai","sk-oa");
  let r=reqs.filter(x=>x.url==="https://api.openai.com/v1/models").pop();
  ok(r&&r.h.Authorization==="Bearer sk-oa","OpenAI: models request uses a Bearer key");
  ok(TR.OB.main==="model-large"&&TR.OB.fast==="model-mini"&&!TR.OB.models.includes("x"),"OpenAI: sensible default models ("+TR.OB.main+", "+TR.OB.fast+")");
  click('[data-obaisave="close"]');await wait(20);
  const r2=await CLAUDE.json("x",{});r=reqs.filter(x=>x.url==="https://api.openai.com/v1/chat/completions").pop();
  ok(r&&r.body.model==="model-large"&&r2.items.length===1,"OpenAI: chat completions call, fenced JSON parsed");
  await prov("gemini","AIza-test");
  r=reqs.filter(x=>x.url.includes("googleapis.com/v1beta/models")&&x.method==="GET").pop();
  ok(r&&r.h["x-goog-api-key"]==="AIza-test"&&!r.url.includes("key="),"Gemini: key sent in a header, not the URL");
  ok(TR.OB.models.length===2&&!TR.OB.models.includes("embed-x"),"Gemini: only text models listed");
  click('[data-obaisave="close"]');await wait(20);
  const r3=await CLAUDE("hi",{});r=reqs.filter(x=>x.url.includes(":generateContent")).pop();
  ok(r3.text==="Gemini says hi"&&r.body.contents[0].parts[0].text.startsWith("hi"),"Gemini: generateContent call works");
  await prov("deepseek","sk-ds");ok(reqs.some(x=>x.url==="https://api.deepseek.com/models"),"DeepSeek: OpenAI-compatible base URL");
  await prov("openrouter","sk-or");ok(reqs.some(x=>x.url==="https://openrouter.ai/api/v1/models"),"OpenRouter: base URL");
  await prov("custom","","http://localhost:11434/v1/");ok(reqs.some(x=>x.url==="http://localhost:11434/v1/models"&&!x.h.Authorization),"Custom endpoint: trailing slash trimmed, no key needed");
  click('[data-obaisave="close"]');await wait(20);
  TR.P.lang="zh";await CLAUDE.json("x",{});r=reqs.filter(x=>x.url.includes("localhost:11434/v1/chat")).pop();
  ok(r.body.messages[0].content.includes("Simplified Chinese"),"Chinese mode tells the model to answer in Chinese");
  TR.P.lang="en";

  /* settings panel */
  click('[data-ob="settings"]');await wait(20);
  ok(q(".ob-card").textContent.includes("justin@example.com")&&q("[data-obexport]")&&q("[data-oberase]")&&q("[data-obtour]"),"Settings: account, export, erase, tour");
  click('[data-obtheme="dark"]');await wait(10);ok(document.documentElement.dataset.theme==="dark","Settings: appearance switch");
  click('[data-obtheme="system"]');await wait(10);
  click("[data-obtour]");await wait(20);ok(TR.OB.screen==="welcome","Settings: welcome tour can be reopened");
  TR.closeOB();await wait(10);
  click('[data-ob="ai"]');await wait(20);
  ok(TR.OB.screen==="aiPanel"&&!q(".ob-bars"),"AI: off button opens a standalone panel (no step bar)");
  TR.closeOB();

  /* export then import */
  let blobText=null;const _c=URL.createObjectURL;URL.createObjectURL=b=>{b.text().then(x=>blobText=x);return "blob:x";};
  click('[data-ob="settings"]');await wait(10);click("[data-obexport]");await wait(60);URL.createObjectURL=_c;
  ok(blobText&&JSON.parse(blobText).app==="followthrough"&&!blobText.includes("sk-"),"Export: backup file, API key not included");
  const tasksBefore=S.tasks.length;
  const file=new File([blobText],"tracker-backup.json",{type:"application/json"});
  TR.openOB("import");await wait(10);
  const dt=new DataTransfer();dt.items.add(file);const fi=q("#obFile");fi.files=dt.files;fi.dispatchEvent(new Event("change"));await wait(80);
  ok(TR.OB.screen==="scanned"&&q(".ob-counts .v").textContent==String(tasksBefore),"Import: backup scanned, counts shown before importing");
  click("[data-obimport]");await wait(30);
  ok(S.tasks.length===tasksBefore&&!S.sample,"Import: board replaced");
  const bad=new File(["just some text"],"notes.txt");TR.openOB("import");await wait(10);
  CLAUDE=null;const dt2=new DataTransfer();dt2.items.add(bad);q("#obFile").files=dt2.files;q("#obFile").dispatchEvent(new Event("change"));await wait(60);
  ok(q(".ob-err")&&q(".ob-err").textContent.includes("connect an AI"),"Import: notes without AI asks to connect a model");
  TR.closeOB();CLAUDE=TR.makeAdapter(TR.P.ai);

  /* start my own board -> setup card: people only */
  S=sampleState();S.sample=true;render();await wait(10);
  click('[data-act="fresh"]');await wait(10);click('[data-act="fresh-yes"]');await wait(30);
  ok(TR.OB.screen==="setup","Clearing the sample opens Set up your board");
  ok(!q(".ob-card").textContent.match(/first task|working on/i)&&document.querySelectorAll(".ob-card input").length===1,"Setup asks only for people");
  ok(document.querySelectorAll(".ob-teams .ob-sug").length===12,"11 team options for the role plus Other team");
  click("[data-obsetup]");await wait(20);
  ok(!q("#oberr-ppl").hidden,"At least one person is required");
  click('[data-obteam="Legal"]');await wait(20);
  ok(q("#oberr-ppl").textContent.includes("name first")&&!TR.OB.people.length,"Tapping a team without a name asks for the name");
  type("#ob-ppl","Omar");click('[data-obteam="Legal"]');await wait(20);
  ok(TR.OB.people[0]==="Omar · Legal"&&q("#ob-ppl").value==="","Name + team chip adds a person and clears the field");
  type("#ob-ppl","Zed");click('[data-obteam="__other"]');await wait(20);type("#ob-otherteam","Studio");click("[data-obaddother]");await wait(20);
  ok(TR.OB.people[1]==="Zed · Studio","Other team: type a custom team");
  click("[data-obsetup]");await wait(30);
  ok(S.people.length===2&&S.people[0].team==="Legal"&&S.tasks.length===0&&route()==="today"&&!S.sample,"Setup creates a board with just the people");
  ok(!q(".sub").textContent.includes("My project"),"No placeholder project name on Today");

  /* role samples in both languages */
  for(const [r,who] of [["product","Maya"],["design","Jon"],["marketing","Ana"],["program","Tom"],["other","Tom"]]){TR.P.role=r;S=sampleState();ok(S.people.some(p=>p.name===who)&&S.tasks.length===(r==="product"?8:6),"Sample week for "+r);}
  TR.P.lang="zh";TR.P.role="ops";S=sampleState();ok(S.tasks[0].title.includes("物料"),"Chinese Operations sample");TR.P.lang="en";
  TR.P.role="ops";S=sampleState();S.draft=null;go("capture");await wait(20);click('[data-act="replay"]');await wait(1900);
  ok(S.draft.personId==="p_kai"&&/ten percent/.test(S.draft.transcript),"Replay uses the role's own 1:1 (with Kai, about the budget)");
  click('[data-act="replay-stop"]');await wait(20);S.draft=null;go("today");await wait(10);

  /* Chinese board check */
  TR.P.lang="zh";render();await wait(20);
  const navZh=[...document.querySelectorAll(".nav a")].map(a=>a.textContent).join(",");
  ok(navZh==="今天,任务,问题,记录","Chinese nav ("+navZh+")");
  go("tasks");await wait(20);ok(q(".phead h1").textContent==="任务"&&q(".tbl th button").textContent.includes("任务"),"Chinese tasks page");
  go("questions");await wait(20);ok(q(".phead h1").textContent==="问题","Chinese questions page");
  go("capture");await wait(20);ok(q('[data-rec="start"]')&&q('[data-rec="start"]').textContent.includes("录音"),"Record button present (Chinese)");
  TR.P.lang="en";go("today");await wait(20);
  const navEn=[...document.querySelectorAll(".nav a")].map(a=>a.textContent).join(",");
  ok(navEn==="Today,Tasks,Questions,Capture","Switching back to English restores the nav ("+navEn+")");

  /* erase */
  click('[data-ob="settings"]');await wait(10);click("[data-oberase]");await wait(10);
  ok(q("[data-oberaseyes]")!==null,"Erase asks to confirm first");
  click("[data-oberaseno]");TR.closeOB();

  const pre=document.createElement("pre");pre.id="testout";pre.textContent=`${pass} passed, ${fail} failed\n`+out.join("\n");document.body.appendChild(pre);
})().catch(e=>{const pre=document.createElement("pre");pre.id="testout";pre.textContent="CRASH "+e.message+"\n"+e.stack;document.body.appendChild(pre);});
