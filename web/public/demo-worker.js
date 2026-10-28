/* No outbound network requests beyond loading our own WASM static assets.
 * Every worker belongs to one browser tab and is terminated after parsing.
 */
importScripts('./vendor/demoparser2.js');
importScripts('./replay-adapter.js');
let ready;
function initWasm(){
  if(!ready)ready=wasm_bindgen('./vendor/demoparser2_bg.wasm');
  return ready;
}
onmessage=async ({data})=>{
  if(data?.type!=='parse')return;
  try{
    postMessage({type:'progress',text:'Initializing Counter-Strike parser…'});
    await initWasm();
    // Diagnostic build: expose Rust panic location/message, not demo contents.
    if (typeof wasm_bindgen.installOpenReplayPanicHook !== 'function') {
      throw new Error('Diagnostic WASM hook is missing from the generated parser build.');
    }
    wasm_bindgen.installOpenReplayPanicHook();
    const file=new Uint8Array(data.bytes);
    postMessage({type:'progress',text:'Decoding match events and positions…'});
    // Raw recording is never transmitted: all extraction occurs inside this worker.
    const output=OpenReplayAdapter.parse(file,String(data.filename||'demo.dem'),wasm_bindgen,msg=>postMessage({type:'progress',text:msg}));
    postMessage({type:'result',data:output});
  }catch(e){
    const message=String(e?.message||e||'Unrecognized demo').slice(0,1000);
    console.warn('OpenReplay WASM parser error (no file data logged):', message);
    postMessage({type:'error',message});
  }
};
