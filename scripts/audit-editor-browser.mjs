// Browser-driven editor evaluation. Uses only the isolated audit account.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require(require.resolve('playwright',{paths:[process.cwd(),path.resolve('../backend.tracksitechanges.io')]}));
const auth=JSON.parse(await fs.readFile('/tmp/kloner-audit-tools/auth.json','utf8'));
const session=JSON.parse(await fs.readFile('/tmp/kloner-audit-tools/http-session.json','utf8'));
if(!auth.uid.startsWith('kloner-audit-'))throw Error('Expected isolated audit account');
if(process.env.AUDIT_APP_ID)session.appId=process.env.AUDIT_APP_ID;
const base=process.env.AUDIT_FRONTEND_ORIGIN||'http://localhost:3098';
const output=process.env.AUDIT_EDITOR_OUTPUT||'/tmp/kloner-editor-browser';await fs.mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const waitForAgentEnqueue=page=>page.waitForResponse(r=>/\/api\/app-embeddings\/(agent-v3|edit-plan)$/.test(new URL(r.url()).pathname)&&r.request().method()==='POST',{timeout:120000}).catch(()=>null);
const context=await browser.newContext({viewport:{width:1440,height:1000}});
await context.addCookies(session.cookies.split('; ').map(pair=>{const i=pair.indexOf('=');return{name:pair.slice(0,i),value:pair.slice(i+1),url:base}}));
const page=await context.newPage();const report={startedAt:new Date().toISOString(),steps:[],errors:[]};
page.on('pageerror',error=>report.errors.push(error.message));
try{
 await page.goto(base+'/signup',{waitUntil:'domcontentloaded',timeout:120000});
 await page.evaluate(async auth=>{
  const state={uid:auth.uid,email:null,emailVerified:false,isAnonymous:false,providerData:[],stsTokenManager:{refreshToken:auth.refreshToken,accessToken:auth.idToken,expirationTime:Date.now()+3500000},createdAt:String(Date.now()),lastLoginAt:String(Date.now()),apiKey:auth.apiKey,appName:'[DEFAULT]'};
  await new Promise((resolve,reject)=>{const open=indexedDB.open('firebaseLocalStorageDb',1);open.onupgradeneeded=()=>open.result.createObjectStore('firebaseLocalStorage',{keyPath:'fbase_key'});open.onerror=()=>reject(open.error);open.onsuccess=()=>{const db=open.result;const tx=db.transaction('firebaseLocalStorage','readwrite');tx.objectStore('firebaseLocalStorage').put({fbase_key:`firebase:authUser:${auth.apiKey}:[DEFAULT]`,value:state});tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>reject(tx.error)}});
  localStorage.setItem('kloner:theme','dark');
  localStorage.setItem('kloner.cookieConsent.v1','necessary');
 },auth);
 const started=Date.now();await page.goto(base+'/app-builder/'+session.appId,{waitUntil:'domcontentloaded',timeout:180000});
 for(let i=0;i<4;i++){
  const skip=page.getByRole('button',{name:/^skip$/i}).first();
  if(await skip.count()&&await skip.evaluate(element=>getComputedStyle(element).pointerEvents!=='none')){await skip.click({timeout:3000}).catch(()=>{});break}
  const next=page.getByRole('button',{name:/^Next/}).first();if(await next.count())await next.click({timeout:3000}).catch(()=>{});await page.waitForTimeout(500)
 }
 const input=page.getByPlaceholder('Ask me to change something...');await input.waitFor({timeout:180000});
 await page.waitForFunction(()=>{const input=document.querySelector('textarea[placeholder="Ask me to change something..."]');return input&&!input.disabled},null,{timeout:180000});
 report.steps.push({name:'editor_ready',ms:Date.now()-started});await page.screenshot({path:path.join(output,'editor-ready.png')});
 const dismissTour=async()=>{for(let i=0;i<8;i++){const skip=page.getByRole('button',{name:/^skip$/i}).last();if(await skip.count()&&await skip.isVisible().catch(()=>false)){await skip.click({timeout:3000}).catch(()=>{});return true}await page.waitForTimeout(500)}return false};
 const preview=()=>page.frames().find(frame=>frame!==page.mainFrame()&&/preview|webcontainer/.test(frame.url()));
 let baselinePreviewText='';let baselineSourceHtml='';
 if(process.env.AUDIT_VERIFY_IFRAME==='1'){
  let frame;for(let i=0;i<180;i++){frame=preview();if(frame&&await frame.locator('h1').count().catch(()=>0))break;await page.waitForTimeout(1000)}
  if(!frame)throw Error('Preview iframe never loaded');
  const content=await frame.locator('body').innerText({timeout:15000});baselinePreviewText=content;if(/^RIFF/.test(content.trim())||content.trim().length<30)throw Error('Invalid preview document');
  const filesResponse=await page.request.get(`${base}/api/app-builder/${session.appId}/files?audit=${Date.now()}`,{timeout:120000});const filesData=await filesResponse.json();baselineSourceHtml=filesData.files?.['public/index.html']?.content||'';if(!filesResponse.ok()||!baselineSourceHtml)throw Error('Could not capture the source-file restore baseline');
  report.steps.push({name:'iframe_visible',ms:Date.now()-started,title:await frame.title(),text:content.slice(0,350)});await page.screenshot({path:path.join(output,'iframe-visible.png')});
 }
 await dismissTour();
 if(process.env.AUDIT_CLEAN_RESTORE==='1'){
  const undo=page.getByRole('button',{name:/^undo(?: edit)?$/i}).last();
  if(await undo.count()&&await undo.isVisible().catch(()=>false)){
   await undo.click();await page.waitForTimeout(12000);
   report.steps.push({name:'cleanup_prior_audit_edit',status:'undone'});
  }
 }
 const requests=process.env.AUDIT_AGENT_QUERIES?JSON.parse(process.env.AUDIT_AGENT_QUERIES):['Can you change the business name to Greenleaf'];
 for(const query of requests){
  const begin=Date.now();const queued=waitForAgentEnqueue(page);
  await input.fill(query);await page.getByRole('button',{name:'Send message',exact:true}).click();const response=await queued;if(!response)throw Error('No agent enqueue response');const enqueue=await response.json();
  if(!response.ok())throw Error(`Agent enqueue failed: ${enqueue.error||response.status()}`);
  let statusUrl=enqueue.statusUrl||enqueue.job?.statusUrl;if(!statusUrl)throw Error('Agent returned no status URL');
  statusUrl=new URL(statusUrl,base).pathname;let terminal;
  for(let i=0;i<120;i++){
   const status=await page.request.get(base+statusUrl,{timeout:60000}).catch(()=>null);if(!status){await page.waitForTimeout(2000);continue}const data=await status.json().catch(()=>null);if(!data){await page.waitForTimeout(2000);continue}const job=data.job||data;
   if(['completed','failed','cancelled','expired'].includes(job.status)){terminal=job;break}await page.waitForTimeout(2000);
  }
  if(!terminal)throw Error('Agent job did not finish within four minutes');
  await page.waitForTimeout(12000);const frame=preview();const visible=frame?await frame.locator('body').innerText({timeout:10000}).catch(()=>''):'';
  const step={name:'agent_request',query,status:terminal.status,code:terminal.result?.code,summary:terminal.result?.summary,changedFiles:terminal.result?.changedFiles,ms:Date.now()-begin,previewText:visible.slice(0,1600)};report.steps.push(step);console.log(JSON.stringify(step));
  const renameTarget=/business name.*?\bto\s+(.+)$/i.exec(query)?.[1]?.trim();
  if(renameTarget&&!visible.toLowerCase().includes(renameTarget.toLowerCase()))throw Error('Agent completed but the requested business name was not visible in the iframe');
  await page.screenshot({path:path.join(output,`agent-${report.steps.length}.png`)});
  if(process.env.AUDIT_TEST_RESTORE==='1'&&renameTarget){
   const undo=page.getByRole('button',{name:/^undo(?: edit)?$/i}).last();await undo.waitFor({state:'visible',timeout:30000});await undo.click();
   const baselineMarker=baselinePreviewText.split('\n')[0].trim();let restored='';
   for(let i=0;i<90;i++){
    const frameAfter=preview();restored=frameAfter?await frameAfter.locator('body').innerText({timeout:3000}).catch(()=> ''):'';
    if(restored.includes(baselineMarker)&&!restored.toLowerCase().includes(renameTarget.toLowerCase()))break;
    await page.waitForTimeout(1000);
   }
   const restoredFiles=await page.request.get(`${base}/api/app-builder/${session.appId}/files?audit=${Date.now()}`,{timeout:120000}).then(r=>r.json());const restoredHtml=restoredFiles.files?.['public/index.html']?.content||'';
   if(!restored.includes(baselineMarker)||restored.toLowerCase().includes(renameTarget.toLowerCase())||restoredHtml!==baselineSourceHtml)throw Error('Undo action did not restore the source and iframe content');
   report.steps.push({name:'agent_undo_preview_refresh',status:'passed',restoredBaseline:restored.slice(0,200)});await page.screenshot({path:path.join(output,'agent-undo.png')});
  }
 }

 if(process.env.AUDIT_EDITOR_FEATURES==='1'){
  await dismissTour();
  if(process.env.AUDIT_TEST_PALETTE!=='0'){
  let frame;for(let i=0;i<180;i++){frame=preview();if(frame&&await frame.locator('h1').count().catch(()=>0))break;await page.waitForTimeout(1000)}if(!frame)throw Error('No live preview frame');
  await page.getByRole('button',{name:'Preview color schemes',exact:true}).click();
  await page.getByRole('button',{name:'Midnight',exact:true}).click();
  await frame.waitForFunction(()=>{const style=document.getElementById('kloner-color-preview');return Boolean(style&&style.textContent.trim())},null,{timeout:20000});
  const previewRules=await frame.locator('#kloner-color-preview').textContent();
  if(!previewRules||!previewRules.includes('#38BDF8'))throw Error('Palette preview did not apply its visible theme rules');
  await page.screenshot({path:path.join(output,'palette-preview.png')});
  await page.getByRole('button',{name:'Reset',exact:true}).click();
  await frame.waitForFunction(()=>!document.getElementById('kloner-color-preview'));
  report.steps.push({name:'palette_preview_reset',previewRuleCount:previewRules.split('\n').length});
  await page.getByRole('button',{name:'Midnight',exact:true}).click();
  const queued=waitForAgentEnqueue(page);
  await page.getByRole('button',{name:'Save scheme',exact:true}).click();
  const response=await queued;const data=await response.json();if(!response.ok())throw Error('Palette agent enqueue failed');
  const statusUrl=new URL(data.statusUrl||data.job?.statusUrl,base).pathname;
  let result;
  for(let i=0;i<120;i++){
   const status=await page.request.get(base+statusUrl,{timeout:60000}).catch(()=>null);const snapshot=status?await status.json().catch(()=>null):null;const job=snapshot?.job||snapshot;
   if(job&&['completed','failed'].includes(job.status)){result=job;break}await page.waitForTimeout(2000);
  }
  if(result?.status!=='completed')throw Error('Palette save did not complete');
  await page.waitForTimeout(15000);
  report.steps.push({name:'palette_save',status:result.status,summary:result.result?.summary,restorePointId:result.result?.restorePointId});
  if(await page.getByText(/Apply the Midnight color scheme/i).count())throw Error('Internal palette instruction was exposed in chat');
  let savedFrame;for(let i=0;i<90;i++){savedFrame=preview();if(savedFrame&&await savedFrame.locator('#kloner-saved-color-scheme').count().catch(()=>0))break;await page.waitForTimeout(1000)}
  if(!savedFrame||!(await savedFrame.locator('#kloner-saved-color-scheme').count().catch(()=>0)))throw Error('Saved palette did not reach the rendered iframe');
  await page.screenshot({path:path.join(output,'palette-saved.png')});
  const undoPalette=page.getByRole('button',{name:/^undo(?: edit)?$/i}).last();
  if(await undoPalette.count()&&await undoPalette.isVisible().catch(()=>false)){
   await undoPalette.click();let paletteRestored=false;
   for(let i=0;i<90;i++){const filesAfterUndo=await page.request.get(`${base}/api/app-builder/${session.appId}/files?audit=${Date.now()}`,{timeout:120000}).then(r=>r.json()).catch(()=>null);const htmlAfterUndo=filesAfterUndo?.files?.['public/index.html']?.content||'';paletteRestored=Boolean(htmlAfterUndo&&htmlAfterUndo===baselineSourceHtml);if(paletteRestored)break;await page.waitForTimeout(1000)}
   if(!paletteRestored)throw Error('Undo did not remove the saved palette from the iframe');
   report.steps.push({name:'palette_undo_preview_refresh',status:'passed'});
  }
  }
  if(process.env.AUDIT_TEST_IMAGE!=='0'){
  const uploadResponse=page.waitForResponse(r=>r.url().includes('/chat-attachments')&&r.request().method()==='POST',{timeout:120000}).catch(()=>null);
  const imageBase64=(await fs.readFile(path.join(output,'editor-ready.png'))).toString('base64');
  await input.evaluate((textarea,base64)=>{
   const bytes=Uint8Array.from(atob(base64),char=>char.charCodeAt(0));
   const transfer=new DataTransfer();transfer.items.add(new File([bytes],'editor-ready.png',{type:'image/png'}));
   textarea.parentElement?.parentElement?.dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:transfer}));
  },imageBase64);
  const uploaded=await uploadResponse;
  if(!uploaded)throw Error('Image attachment did not reach the upload endpoint');
  const uploadBody=await uploaded.json().catch(()=>({}));
  if(!uploaded.ok())throw Error(`Image upload failed (${uploaded.status()}): ${uploadBody.error||'unknown error'}`);
  await page.getByRole('button',{name:/Remove editor-ready/}).waitFor({timeout:30000});
  report.steps.push({name:'image_upload',status:uploaded.status(),thumbnailVisible:true});
  await page.screenshot({path:path.join(output,'image-attached.png')});
  const imageOnlyEnqueue=waitForAgentEnqueue(page);
  await page.getByRole('button',{name:'Send message',exact:true}).click();
  const imageOnlyResponse=await imageOnlyEnqueue;const imageOnlyData=await imageOnlyResponse.json();
  if(!imageOnlyResponse.ok())throw Error('Image-only analysis could not be queued');
  const imageOnlyStatusUrl=new URL(imageOnlyData.statusUrl||imageOnlyData.job?.statusUrl,base).pathname;
  let imageOnlyJob;
  for(let i=0;i<120;i++){
   const status=await page.request.get(base+imageOnlyStatusUrl,{timeout:60000}).catch(()=>null);const snapshot=status?await status.json().catch(()=>null):null;const job=snapshot?.job||snapshot;
   if(job&&['completed','failed'].includes(job.status)){imageOnlyJob=job;break}await page.waitForTimeout(2000);
  }
  if(imageOnlyJob?.status!=='completed')throw Error('Image-only analysis did not complete');
  await page.getByRole('button',{name:/Remove editor-ready/}).waitFor({state:'detached',timeout:30000});
  const imageReply=await page.locator('text=/would you like me to fix|want me to fix|should I fix/i').last().innerText({timeout:30000}).catch(()=>imageOnlyJob.result?.summary||'');
  report.steps.push({name:'image_only_analysis',status:imageOnlyJob.status,changedFiles:imageOnlyJob.result?.changedFiles||[],summary:imageOnlyJob.result?.summary||imageReply});
  if((imageOnlyJob.result?.changedFiles||[]).length)throw Error('Image analysis unexpectedly changed project files');
 }
 }
 await context.storageState({path:path.join(output,'browser-state.json')});await fs.chmod(path.join(output,'browser-state.json'),0o600);
}catch(error){report.failure=String(error.message||error).split('\n')[0];console.error(report.failure);process.exitCode=1;await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{})}
finally{await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));await browser.close()}
