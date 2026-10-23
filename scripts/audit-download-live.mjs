// Live localhost HTTP + Firebase Auth/Firestore + Stripe TEST mode verification.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { createDecipheriv, createHmac, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import admin from 'firebase-admin';
import Stripe from 'stripe';
import { unzipSync } from 'fflate';
if(process.env.KLONER_AUDIT_ENV_MODULE)await import(process.env.KLONER_AUDIT_ENV_MODULE);
assert.ok(process.env.STRIPE_SECRET_KEY_TEST?.startsWith('sk_test_'),'Test Stripe key required');
const stripe=new Stripe(process.env.STRIPE_SECRET_KEY_TEST);
const service=JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
if(!admin.apps.length)admin.initializeApp({credential:admin.credential.cert(service),storageBucket:process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET});
const uid=`download-audit-${Date.now()}`,appId='download-test';
const userRef=admin.firestore().collection('kloner_users').doc(uid);
const report={startedAt:new Date().toISOString(),steps:[]};
const record=(step,data)=>{report.steps.push({step,...data});fs.writeFileSync('/tmp/kloner-download-live.json',JSON.stringify(report,null,2));console.log(step,JSON.stringify(data));};
let customer,subscription,server,vercelProjectId,vercelToken,vercelTeamId;
try{
 customer=await stripe.customers.create({description:'Kloner isolated download audit (test mode)'});
 const payment=await stripe.paymentMethods.attach('pm_card_visa',{customer:customer.id});
 await stripe.customers.update(customer.id,{invoice_settings:{default_payment_method:payment.id}});
 const price=process.env.STRIPE_PRICE_BASIC_TEST||process.env.STRIPE_PRICE_PRO_TEST;
 assert.ok(price,'Test subscription price required');
 subscription=await stripe.subscriptions.create({customer:customer.id,items:[{price}],trial_period_days:7,default_payment_method:payment.id});
 await admin.auth().createUser({uid});
 await userRef.set({stripeCustomerId:customer.id,stripeSubscriptionId:subscription.id,stripeStatus:'trialing',tier:'pro'});
 await userRef.collection('kloner_apps').doc(appId).set({name:`kloner-audit-${Date.now()}`,files:{'index.html':{content:'saved code'},'asset.bin':{content:Buffer.from([0,255,137,80]).toString('base64'),encoding:'base64'}}});
 const custom=await admin.auth().createCustomToken(uid);
 const authResponse=await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${process.env.NEXT_PUBLIC_FIREBASE_API_KEY}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:custom,returnSecureToken:true})});
 const authData=await authResponse.json();assert.ok(authData.idToken,authData.error?.message||'Could not sign in test user');
 const log=fs.openSync('/tmp/kloner-download-next.log','w');
 server=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--webpack','--port','3097'],{env:{...process.env,NODE_ENV:'development'},stdio:['ignore',log,log]});
 const base='http://127.0.0.1:3097';
 for(let i=0;i<90;i++){try{await fetch(base+'/api/auth/csrf',{signal:AbortSignal.timeout(1000)});break;}catch{await new Promise(r=>setTimeout(r,1000));}}
 const csrf=randomUUID();
 const scope=Buffer.from(JSON.stringify({uid,appId,exp:Math.floor(Date.now()/1000)+1800,nonce:randomUUID()})).toString('base64url');
 const sig=createHmac('sha256',process.env.APP_BUILDER_SCOPE_SECRET||'dev-only-insecure-app-builder-scope-secret').update(scope).digest('base64url');
 const headers={authorization:`Bearer ${authData.idToken}`,'content-type':'application/json','x-csrf':csrf,cookie:`csrf=${csrf}; ab_scope=${scope}.${sig}`};
 const body=JSON.stringify({currentFile:{path:'index.html',content:'unsaved editor code'}});
 const trial=await fetch(base+`/api/app-builder/${appId}/download`,{method:'POST',headers,body});
 const trialData=await trial.json();record('trial-download',{status:trial.status,code:trialData.code});assert.equal(trial.status,402);assert.equal(trialData.code,'PAID_SUBSCRIPTION_REQUIRED');
 const activation=await fetch(base+'/api/billing/activate-subscription',{method:'POST',headers});const activationData=await activation.json();record('test-mode-paid-upgrade',{status:activation.status,ok:activationData.ok,error:activationData.error});assert.equal(activation.status,200);
 const paid=await fetch(base+`/api/app-builder/${appId}/download`,{method:'POST',headers,body});assert.equal(paid.status,200,await paid.clone().text());
 const bytes=new Uint8Array(await paid.arrayBuffer());const archive=unzipSync(bytes);assert.equal(Buffer.from(archive['index.html']).toString(),'unsaved editor code');assert.deepEqual([...archive['asset.bin']],[0,255,137,80]);record('paid-download',{status:paid.status,zipBytes:bytes.length,files:Object.keys(archive),editorBufferMatches:true,binaryBytesMatch:true});
 if(process.env.KLONER_AUDIT_DEPLOY === '1'){
  const integration=(await admin.firestore().collection('kloner_users').doc('FJPVD2BuHrXBLhOFOBWi9oW7Apt1').collection('integrations').doc('vercel').get()).data();
  assert.ok(integration?.accessToken,'Test account has no Vercel connection');
  await userRef.collection('integrations').doc('vercel').set(integration);
  const encrypted=integration.accessToken;
  if(typeof encrypted==='string')vercelToken=encrypted;
  else{const decipher=createDecipheriv('aes-256-gcm',Buffer.from(process.env.KLONER_ENCRYPTION_KEY,'base64'),Buffer.from(encrypted.iv,'base64'));decipher.setAuthTag(Buffer.from(encrypted.tag,'base64'));vercelToken=Buffer.concat([decipher.update(Buffer.from(encrypted.data,'base64')),decipher.final()]).toString('utf8');}
  vercelTeamId=integration.vercelTeamId;
  const deployed=await fetch(base+`/api/app-builder/${appId}/deploy`,{method:'POST',headers,body:'{}'});const deployedData=await deployed.json();
  record('deployment-created',{status:deployed.status,ok:deployedData.ok,error:deployedData.error,deploymentId:deployedData.deploymentId});
  vercelProjectId=deployedData.vercelProjectId||(await userRef.collection('kloner_apps').doc(appId).get()).data()?.vercelProjectId;
  assert.equal(deployed.status,200);
  const team=vercelTeamId?`?teamId=${encodeURIComponent(vercelTeamId)}`:'';
  let ready=false;
  for(let i=0;i<90;i++){
   const response=await fetch(`https://api.vercel.com/v13/deployments/${deployedData.deploymentId}${team}`,{headers:{authorization:`Bearer ${vercelToken}`}});const d=await response.json();
   if(d.readyState==='READY'){ready=true;break;}
   if(['ERROR','CANCELED'].includes(d.readyState))throw new Error(d.errorMessage||`Deployment ${d.readyState}`);
   await new Promise(r=>setTimeout(r,2000));
  }
  assert.equal(ready,true);
  const live=await fetch(deployedData.url);const liveText=await live.text();assert.equal(live.status,200);assert.match(liveText,/saved code/);
  const asset=await fetch(deployedData.url+'/asset.bin');assert.equal(asset.status,200);assert.deepEqual([...new Uint8Array(await asset.arrayBuffer())],[0,255,137,80]);
  record('deployment-live-content',{ok:true,htmlMatches:true,binaryBytesMatch:true,url:deployedData.url});
 }
 record('complete',{ok:true});
}catch(error){record('failure',{error:String(error.stack||error)});process.exitCode=1;}
finally{
 server?.kill('SIGTERM');
 if(vercelProjectId&&vercelToken){const suffix=vercelTeamId?`?teamId=${encodeURIComponent(vercelTeamId)}`:'';const removed=await fetch(`https://api.vercel.com/v9/projects/${vercelProjectId}${suffix}`,{method:'DELETE',headers:{authorization:`Bearer ${vercelToken}`}});record('test-deployment-cleanup',{ok:removed.ok,status:removed.status});}
 if(subscription)await stripe.subscriptions.cancel(subscription.id).catch(()=>{});
 if(customer)await stripe.customers.del(customer.id).catch(()=>{});
 await admin.firestore().recursiveDelete(userRef).catch(()=>{});
 await admin.auth().deleteUser(uid).catch(()=>{});
 record('cleanup',{ok:true});
}
process.exit(process.exitCode||0);
