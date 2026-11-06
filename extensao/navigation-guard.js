// Runs before WhatsApp scripts. Normally inactive; arms for one bot navigation.
// It never reads cookies, messages in the conversation or private application APIs.
(() => {
  if(globalThis.__schoolbotLeadsNavigationGuard)return;
  const normalize=value=>String(value??'').replace(/\r\n?/g,'\n').replace(/\u00a0/g,' ').replace(/[\u200b-\u200f\ufeff]/g,'').trim().replace(/^[ \t]*[-*•](?=[ \t]+\S)/gm,'-').replace(/\s+/g,' ');
  const visible=el=>!!el&&!!(el.offsetWidth||el.offsetHeight||el.getClientRects().length);
  const read=()=>{
    const main=document.querySelector('#main');
    const editor=main&&[...main.querySelectorAll('footer [contenteditable="true"][role="textbox"], footer [contenteditable="true"][data-lexical-editor="true"]')].find(visible);
    const dialog=[...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].some(visible);
    return {main,editor,text:normalize(editor?.innerText??editor?.textContent),dialog};
  };
  let pending=null;
  globalThis.__schoolbotLeadsNavigationGuard={
    version:'1.0.2',
    arm(expected){
      pending=null;
      if(typeof expected!=='string'||!expected.trim())return {ok:false,reason:'Mensagem de destino ausente.'};
      const snapshot=read();
      if(snapshot.dialog)return {ok:false,reason:'Feche a janela aberta no WhatsApp antes de iniciar a fila.'};
      if(snapshot.text&&snapshot.text!==normalize(expected))return {ok:false,reason:'Há um rascunho diferente no WhatsApp. Ele foi preservado.'};
      pending={...snapshot,deadline:Date.now()+4000};return {ok:true};
    },
    cancel(){pending=null;}
  };
  window.addEventListener('beforeunload',event=>{
    const authorization=pending;pending=null;
    if(!authorization||Date.now()>authorization.deadline)return;
    const current=read();
    if(current.dialog||current.main!==authorization.main||current.editor!==authorization.editor||current.text!==authorization.text)return;
    // No preventDefault/returnValue: allow only this already requested navigation.
    event.stopImmediatePropagation();
  },{capture:true});
})();
