// Anonymous read-only checks: no mail, AI calls or new records.
let origin;
try {
 const url=new URL(process.argv[2]);
 if(url.username||url.password||url.search||url.hash||url.pathname!=='/'||(url.protocol!=='https:'&&!(url.protocol==='http:'&&url.hostname==='localhost')))throw Error();
 origin=url.origin;
}catch{console.error('Usage: npm run smoke:pilot -- https://YOUR-PROJECT.vercel.app');process.exit(1);}
let failed=false;
for(const path of ['/login','/','/get-started','/company','/artists']){
 try{
  const response=await fetch(origin+path,{redirect:'manual',signal:AbortSignal.timeout(15000)});
  const location=response.headers.get('location');const redirect=location?new URL(location,origin):null;
  const statusOK=path==='/login'?response.status===200:[303,307,308].includes(response.status)&&redirect?.origin===origin&&redirect.pathname==='/login';
  const privateOK=/no-store/.test(response.headers.get('cache-control')||'');
  const ok=statusOK&&privateOK;
  console.log(`${ok?'PASS':'FAIL'} ${path}: HTTP ${response.status}, private response ${privateOK?'yes':'no'}`);
  if(!ok)failed=true;await response.body?.cancel();
 }catch{failed=true;console.error(`FAIL ${path}: request failed or timed out.`);}
}
console.log('Anonymous checks only. Signed-in, two-account and Google checks remain separate.');
if(failed)process.exitCode=1;
