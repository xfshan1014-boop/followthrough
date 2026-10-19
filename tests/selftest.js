/* Temporary self-test: simulates a week of daily use with a mock Claude. Delete after testing. */
(async function(){
  const out=[];let pass=0,fail=0;
  const ok=(c,msg)=>{if(c){pass++;out.push("PASS  "+msg);}else{fail++;out.push("FAIL  "+msg);}};
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  const q=s=>document.querySelector(s);
  const click=s=>{const el=typeof s==="string"?q(s):s;if(!el)throw new Error("missing "+s);el.click();};
  const type=(s,v)=>{const el=q(s);if(!el)throw new Error("missing "+s);el.value=v;el.dispatchEvent(new Event("input",{bubbles:true}));el.dispatchEvent(new Event("change",{bubbles:true}));};
  const byText=(sel,txt)=>[...document.querySelectorAll(sel)].find(e=>e.textContent.includes(txt));
  const text=()=>document.body.innerText;

  /* mock Claude */
  const calls=[];
  function mock(input,opts){calls.push({kind:"text",input});return Promise.resolve({text:"Hi Leo, could you take a look at the tracking schema today? It's holding up the event spec for the referral test.",truncated:false});}
  mock.json=function(input,opts){calls.push({kind:"json",input,tier:opts&&opts.modelTier});
    return Promise.resolve({summary:"Maya confirmed a sample size of about 40k per arm and will send the power calc Thursday. Both platforms run together. Ask Priya about channel splits.",
      items:[
        {type:"answer",questionId:"q_ss",title:"Minimum sample size to detect a 2% lift?",detail:"About 40k users per arm at current traffic.",quote:"Roughly forty thousand users per arm"},
        {type:"next_action",taskId:"t_metric",title:"Update metric spec and share in Friday sync",detail:"",due:null,quote:"I'll update the metric spec today"},
        {type:"waiting",taskId:"t_metric",personId:"p_maya",title:"Power calc for the referral test",detail:"Promised by Thursday",due:addDays(3),quote:"I'll send you the power calc by Thursday"},
        {type:"question",personId:"p_priya",taskId:"t_base",title:"Does the baseline already split by channel?",detail:"",quote:null},
        {type:"task",title:"Note both-platform rollout in PRD",detail:"Add to the rollout section",quote:null},
        {type:"still_open",questionId:"q_gr",title:"Should the guardrail include cancel rate?",detail:"",quote:null},
        {type:"answer",questionId:"q_bogus",taskId:"t_fake",personId:"p_nobody",title:"Hallucinated ids should be cleaned",detail:"x"}]});};
  CLAUDE=mock;

  /* fresh start on the sample week */
  try{localStorage.removeItem(LS_KEY);}catch(e){}
  S=sampleState();UI.drawer=null;go("today");await wait(50);

  /* Day 1, morning: Today briefing */
  ok(/Good (morning|afternoon|evening)/.test(q(".hello").textContent),"Today greeting renders");
  ok(q(".hello").querySelector("br")!==null,"Greeting is split into two lines");
  const nextCount=document.querySelector(".main .sec").querySelectorAll(".item").length;
  ok(nextCount===2,"Two next actions shown on sample week ("+nextCount+")");
  const glued=[...document.querySelectorAll(".item .t")].every(el=>el.textContent.trim().split(/\s+/).length<4||/ \S+$/.test(el.textContent.trim()));
  ok(glued,"Last two words glued in task titles (no orphan words)");

  /* finish a step and set the next one */
  click('[data-act="advance"][data-id="t_metric"]');await wait(30);
  type("#advInput","Share metric spec in Friday sync");click('[data-act="adv-save"][data-id="t_metric"]');await wait(30);
  ok(task("t_metric").next==="Share metric spec in Friday sync","Next step updated from Today");
  ok(task("t_metric").history.some(h=>h.text.startsWith("Step done: Update metric spec")),"Old step logged in history");

  /* draft a nudge for Leo */
  render();await wait(30);
  click('[data-act="nudge"][data-id="t_track"]');await wait(80);
  ok(!!UI.nudge.t_track&&text().includes("tracking schema"),"Nudge drafted for Leo and shown");
  ok(calls.some(c=>c.kind==="text"&&/Leo/.test(c.input)),"Nudge prompt names Leo");

  /* Leo replies: clear the wait */
  click('[data-act="got-it"][data-id="t_track"]');await wait(30);
  ok(task("t_track").waiting===null&&task("t_track").status==="open","Got it clears waiting and unblocks");
  click('[data-act="undo"]');await wait(30);
  ok(task("t_track").waiting&&task("t_track").status==="blocked","Undo restores the wait");

  /* add a task with a brand-new person */
  click('[data-act="new-task"]');await wait(30);
  type("#fTitle","Write launch FAQ for support");type("#fNext","Ask Omar for the top 5 support questions");
  q("#fWaitWho").value="__new";q("#fWaitWho").dispatchEvent(new Event("change"));
  type("#fNewName","Omar");type("#fNewTeam","Operations");type("#fWaitWhat","Top support questions");
  q("#fPrio").value="P0";type("#fDue",addDays(0));
  click('[data-act="save-task"]');await wait(30);
  const faq=S.tasks.find(t=>t.title==="Write launch FAQ for support");
  ok(!!faq&&faq.waiting&&pName(faq.waiting.personId)==="Omar","New task saved with a new person to wait on");
  ok(S.people.some(p=>p.name==="Omar"&&p.team==="Operations"),"Omar added to people");
  click('[data-act="new-task"]');await wait(20);click('[data-act="save-task"]');await wait(20);
  ok(!q("#fErr").hidden,"Empty task name shows an inline error");
  click('.drawer [data-act="close-drawer"]');await wait(20);

  /* Tasks page */
  go("tasks");await wait(40);
  const rows=()=>document.querySelectorAll(".tbl tbody tr").length;
  ok(rows()===8,"Tasks table lists 8 open tasks ("+rows()+")");
  click('.fchip[data-id="waiting"]');await wait(20);
  ok(rows()===2,"Waiting filter shows 2 ("+rows()+")");
  click('.fchip[data-id="blocked"]');await wait(20);ok(rows()===1,"Blocked filter shows 1");
  click('.stat[data-id="soon"]');await wait(20);
  const soonN=rows();ok(soonN>=3,"Due in 2 days card filters ("+soonN+")");
  click('.fchip[data-id="open"]');await wait(20);
  click('[data-act="t-sort"][data-id="due"]');await wait(20);
  const firstDue=q(".tbl tbody tr td:nth-child(6)").textContent.trim();
  ok(firstDue==="Today","Sort by due puts today first ("+firstDue+")");
  click('[data-act="t-sort"][data-id="due"]');await wait(20);
  ok(q(".tbl tbody tr td:nth-child(6)").textContent.trim()==="—","Second click reverses sort");
  type("#tSearch","priya");await wait(30);
  ok(rows()===1&&document.activeElement.id==="tSearch","Search filters and keeps focus");
  type("#tSearch","");await wait(20);
  click('[data-act="t-done"][data-id="t_ideas"]');await wait(20);
  ok(task("t_ideas").status==="done"&&rows()===7,"Mark done from table");
  click('.fchip[data-id="done"]');await wait(20);
  ok(rows()===2,"Done filter shows 2 ("+rows()+")");
  click('.fchip[data-id="open"]');await wait(20);
  click(q('.tbl tbody tr[data-id="t_prd"] td:nth-child(2)'));await wait(30);
  ok(UI.drawer==="t_prd"&&q("#fTitle").value.startsWith("Draft PRD"),"Row click opens the task editor");
  click('.drawer [data-act="close-drawer"]');await wait(20);

  /* Questions page */
  go("questions");await wait(40);
  const qrows=()=>document.querySelectorAll(".qmain .qrow").length;
  ok(qrows()===4,"4 questions to ask ("+qrows()+")");
  const opts=[...q("#nqTask").options].map(o=>o.textContent);
  ok(opts.includes("Write launch FAQ for support")&&!opts.includes("Collect ideas for the next iteration"),"Related task list = current open tasks (new task in, done task out)");
  type("#nqText","Which support macros mention invites?");q("#nqPerson").value=S.people.find(p=>p.name==="Omar").id;q("#nqTask").value=faq.id;
  q("#addQ").dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));await wait(30);
  const nq=S.questions.find(x=>x.text.startsWith("Which support macros"));
  ok(nq&&nq.taskId===faq.id,"Question added and linked to the task");
  ok(qrows()===5,"Inbox shows 5 now");
  const link=byText(".qrow .tasklink","Write launch FAQ");click(link);await wait(30);
  ok(UI.drawer===faq.id,"Related-task link opens that task");
  click('.drawer [data-act="close-drawer"]');await wait(20);
  click(`[data-act="q-log"][data-id="q_dl"]`);await wait(20);
  type("#qaText","Yes, via a universal link.");click('[data-act="qa-save"][data-id="q_dl"]');await wait(30);
  ok(S.questions.find(x=>x.id==="q_dl").answer==="Yes, via a universal link.","Answer logged");
  ok(task("t_prd").history.some(h=>h.text.includes("universal link")),"Answer added to task history");
  click('[data-act="q-del"][data-id="q_sh"]');await wait(20);click('[data-act="qd-yes"][data-id="q_sh"]');await wait(20);
  ok(!S.questions.some(x=>x.id==="q_sh"),"Delete with inline confirm");
  click('[data-act="undo"]');await wait(20);
  ok(S.questions.some(x=>x.id==="q_sh"),"Undo restores the question");
  click('[data-act="q-person"][data-id="p_maya"]');await wait(20);
  ok(qrows()===2&&q(".agenda").textContent.includes("sample size"),"Filter by Maya and agenda lists her questions");
  click('[data-act="start-capture"]');await wait(40);
  ok(route()==="capture"&&S.draft&&S.draft.personId==="p_maya"&&S.draft.taskId==="t_metric","Start capture prefills Maya and the task");

  /* Capture: paste a transcript, read so far, review, apply */
  type("#cText","You: What sample size do we need for a 2% lift?\nMaya: Roughly forty thousand users per arm at current traffic. I'll send you the power calc by Thursday.\nYou: Great. I'll update the metric spec today.\nMaya: Run both platforms together.");
  render();await wait(40);
  ok(document.querySelectorAll("#lines .line").length===4,"Pasted transcript parsed into 4 lines");
  click('[data-act="live-extract"]');await wait(80);
  ok(S.draft.notes&&S.draft.notes.items.length===7,"Read so far: notes from Claude ("+(S.draft.notes&&S.draft.notes.items.length)+", bogus one dropped ids)");
  ok(q("#lines mark")!==null,"Quotes highlighted in the transcript");
  ok(calls.filter(c=>c.kind==="json").pop().tier==="quick","Live notes use the quick model");
  ok(q(".qbox.done")!==null,"Prepped question ticks off when answered");
  click('[data-act="finish"]');await wait(100);
  ok(S.draft.phase==="review"&&S.draft.review.items.length===7,"Review shows proposals");
  const bogus=S.draft.review.items.find(i=>i.title.startsWith("Hallucinated"));
  ok(bogus&&bogus.questionId===null&&bogus.taskId===null&&bogus.personId===null,"Unknown ids from Claude are nulled");
  click(`[data-act="skip"][data-i="${S.draft.review.items.indexOf(bogus)}"]`);await wait(20);
  click('[data-act="pe"][data-i="4"]');await wait(20);type("#peTitle","Add both-platform rollout to PRD");click('[data-act="pe-save"][data-i="4"]');await wait(20);
  click('[data-act="apply-all"]');await wait(30);
  ok(S.questions.find(x=>x.id==="q_ss").answer.startsWith("About 40k"),"Apply: answer saved to question");
  ok(task("t_metric").next==="Update metric spec and share in Friday sync","Apply: next step replaced");
  ok(task("t_metric").waiting&&pName(task("t_metric").waiting.personId)==="Maya","Apply: waiting on Maya for power calc");
  ok(S.questions.some(x=>x.text.startsWith("Does the baseline already split")&&x.personId==="p_priya"),"Apply: new question for Priya");
  ok(S.tasks.some(t=>t.title==="Add both-platform rollout to PRD"),"Apply: edited new task created");
  ok(!S.questions.some(x=>x.text.startsWith("Hallucinated")),"Skipped proposal not applied");
  ok(!S.questions.find(x=>x.id==="q_gr").answer,"Still-open question stays open");
  type("#askInput","When is the power calc due?");q("#askForm").dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));await wait(80);
  ok(S.draft.chat.length===2,"Ask about the meeting adds a reply");
  click('.ctrl [data-act="close-session"]');await wait(40);
  ok(route()==="today"&&S.sessions.length===1&&S.sessions[0].applied===6,"Done saves the session with 6 updates ("+(S.sessions[0]&&S.sessions[0].applied)+")");
  ok(text().includes("About 40k"),"New answer appears on Today");

  /* Replay sample */
  go("capture");await wait(30);
  click('[data-act="replay"]');await wait(3700);
  ok(parseLines(S.draft.transcript).length>=2&&q(".live"),"Replay streams lines in");
  click('[data-act="replay-stop"]');await wait(20);
  ok(!CAP.replay,"Stop ends the replay");
  S.draft=null;

  /* Claude unavailable */
  CLAUDE=null;go("today");await wait(20);
  ok(!q('[data-act="nudge"]'),"No Claude: nudge button hidden");
  go("capture");await wait(20);
  ok(/(Claude|AI) isn.t available/.test(text()),"No Claude: capture explains and still works");
  CLAUDE=mock;

  /* start fresh */
  go("today");await wait(20);
  click('[data-act="fresh"]');await wait(20);click('[data-act="fresh-yes"]');await wait(20);
  ok(S.tasks.length===0&&!S.sample&&text().includes("Add your first task"),"Start my own board gives an empty, guided Today");
  click('[data-act="undo"]');await wait(20);
  ok(S.sample&&S.tasks.length>8,"Undo brings the sample back");

  /* persistence in this browser */
  await wait(700);
  let saved=null;try{saved=JSON.parse(localStorage.getItem(LS_KEY));}catch(e){}
  ok(saved&&saved.sessions&&saved.sessions.length===1,"State saved to browser storage");

  /* layout: no horizontal page scroll at phone width is checked separately */
  const pre=document.createElement("pre");pre.id="testout";pre.textContent=`${pass} passed, ${fail} failed\n`+out.join("\n");
  document.body.dataset.tests=`${pass}/${pass+fail}`;document.body.appendChild(pre);
})().catch(e=>{const pre=document.createElement("pre");pre.id="testout";pre.textContent="CRASH "+e.message+"\n"+e.stack;document.body.appendChild(pre);});
