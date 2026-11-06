// Executado no mundo isolado da extensão. Usa somente elementos da interface.
// Não usa APIs privadas, cookies, tokens, módulos internos ou mecanismos de evasão.
/** Executa uma operação isolada no DOM do WhatsApp. Valida destinatário e rascunho antes de clicar; não usa APIs privadas nem lê credenciais. */
export function whatsappDom(action, payload = {}) {
  const normalize = value => String(value ?? '').replace(/\r\n?/g,'\n').replace(/\u00a0/g,' ').replace(/[\u200b-\u200f\ufeff]/g,'').split('\n').map(s=>s.trimEnd()).join('\n').trim();
  // Keep in sync with messagesMatch in core.js; this function is injected alone.
  const comparableMessage = value => normalize(value).replace(/^[ \t]*[-*•](?=[ \t]+\S)/gm,'-').replace(/\s+/g,' ');
  const sameText = (actual, expected) => comparableMessage(actual) === comparableMessage(expected);
  const visible = el => !!el && !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const main = document.querySelector('#main');
  const composer = main && [...main.querySelectorAll('footer [contenteditable="true"][role="textbox"], footer [contenteditable="true"][data-lexical-editor="true"]')].find(visible);
  const draft = () => normalize(composer?.innerText ?? composer?.textContent);
  const header = main?.querySelector('header');
  const headerName = () => normalize(header?.querySelector('[title]')?.getAttribute('title') || header?.innerText);
  const routePhone = () => new URL(location.href).searchParams.get('phone');
  // WhatsApp clears the /send query after opening the conversation. Absence is
  // not a mismatch and never replaces the contact evidence/manual confirmation.
  const routeConflicts = expected => { const phone=routePhone();return phone!==null&&phone!==expected; };
  const state = globalThis.__schoolbotLeads ??= {};
  state.documentToken ??= crypto.randomUUID();
  if (payload.documentToken && payload.documentToken !== state.documentToken) return {ok:false,ready:false,clicked:false,fatal:true,reason:'A aba foi recarregada. A tentativa foi interrompida.'};
  const messageId = el => el.closest('[data-id]')?.getAttribute('data-id') || el.querySelector('[data-id]')?.getAttribute('data-id') || '';
  const outgoing = () => {
    if(!main)return [];
    const rows=new Map();
    for(const el of main.querySelectorAll('.message-out, [data-id^="true_"]')){
      const id=messageId(el);if(!id||rows.has(id))continue;
      rows.set(id,{el,id});
    }
    return [...rows.values()];
  };
  const signature = () => headerName() + '|' + (main ? [...main.querySelectorAll('[data-id]')].slice(-5).map(el=>el.getAttribute('data-id')).join('|') : '');
  const numbersIn = text => {
    const matches = String(text ?? '').match(/(?:\+?55[\s.-]*)?\(?[1-9]\d\)?[\s.-]*9\d{4}[\s.-]*\d{4}/g) || [];
    return [...new Set(matches.map(s=>s.replace(/\D/g,'')).map(s=>s.length===11?'55'+s:s).filter(s=>/^55\d{11}$/.test(s)))];
  };
  const detailPanels = () => {
    const panels = [...document.querySelectorAll('[data-testid="drawer-right"], [data-testid="contact-info-drawer"]')].filter(visible);
    // Text headings are preferable to volatile CSS class names.
    for (const label of document.querySelectorAll('h1,h2,span,div')) {
      if (label.children.length || !visible(label) || !/^(Dados do contato|Contact info|Informações do contato)$/.test(label.textContent.trim())) continue;
      let parent=label.parentElement;
      for(let i=0;parent && i<7;i++,parent=parent.parentElement){
        if(parent===main || parent.contains(main) || parent.id==='side') break;
        if(visible(parent) && numbersIn(parent.innerText).length && parent.innerText.length<15000){panels.push(parent);break;}
      }
    }
    return panels;
  };
  const evidence = expected => {
    const ids = new Set();
    if (main) for (const el of main.querySelectorAll('[data-id]')) {
      const m = /^(?:true|false)_(\d+)@(?:c\.us|s\.whatsapp\.net)_/.exec(el.getAttribute('data-id')||'');
      if(m) ids.add(m[1]);
    }
    const headerPhones=numbersIn(headerName());
    const panelPhones=[...new Set(detailPanels().flatMap(el=>numbersIn(el.innerText)))];
    for(const [type, values] of [['conversa', [...ids]],['cabeçalho',headerPhones],['dados do contato',panelPhones]]){
      if(values.length===1) return {ok:values[0]===expected, mismatch:values[0]!==expected, type, phone:values[0]};
      if(values.length>1) return {ok:false,mismatch:false,type:'mais de um número visível'};
    }
    return {ok:false,mismatch:false,type:'número não exposto pela interface'};
  };
  const sendButton = () => {
    if(!main)return null;
    const icon=main.querySelector('footer [data-icon="send"], footer [data-icon="wds-ic-send-filled"]');
    const candidate=icon?.closest('button,[role="button"]') || [...main.querySelectorAll('footer button,footer [role="button"]')].find(el=>/^(Enviar|Send)$/i.test(el.getAttribute('aria-label')||''));
    return candidate && visible(candidate) && !candidate.disabled && candidate.getAttribute('aria-disabled')!=='true' ? candidate : null;
  };
  // Only an explicit WhatsApp modal is evidence of an unregistered number.
  // Never infer invalidity from a timeout, missing composer, chat text or network errors.
  const numberError = () => {
    const matchesError = text => {
      const t=normalize(text).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
      return t.length<600 && (
        /\bnumero\b[\s\S]*\bnao (?:esta|e)(?: cadastrado| registrado)? (?:no|um numero (?:do|de)) whatsapp\b/.test(t) ||
        /\bnumero de telefone compartilhado[\s\S]*(?:url|link)[\s\S]*invalido\b/.test(t) ||
        /\bphone number shared via url is invalid\b/.test(t) ||
        /\b(?:phone )?number\b[\s\S]*(?:is not|isn't|isn’t|is not registered|isn't registered) on whatsapp\b/.test(t));
    };
    const dialogs=[...document.querySelectorAll('[role="dialog"], [role="alertdialog"], [data-animate-modal-popup="true"]')].filter(visible);
    // Some Business layouts omit dialog roles. Find only a small modal around OK,
    // outside the conversation and sidebar; never search arbitrary message text.
    for(const button of document.querySelectorAll('button,[role="button"]')){
      if(!visible(button)||!/^ok$/i.test(normalize(button.innerText||button.textContent)))continue;
      let node=button.parentElement;
      for(let n=0;node&&n<7;n++,node=node.parentElement){
        if(node===document.body||node===main||node.id==='side'||node.id==='pane-side'||node.closest?.('[data-id]')||main?.contains(node))break;
        if(matchesError(node.innerText||node.textContent)){dialogs.push(node);break;}
      }
    }
    for(const dialog of dialogs){
      if(main?.contains(dialog)||dialog.closest?.('[data-id]'))continue;
      const text=normalize(dialog.innerText||dialog.textContent);
      if(!matchesError(text))continue;
      const phones=numbersIn(text);
      if(phones.length>1)continue;
      const button=[...dialog.querySelectorAll('button,[role="button"]')].find(el=>visible(el)&&/^ok$/i.test(normalize(el.innerText||el.textContent)));
      return {text,phone:phones[0]||null,button};
    }
    return null;
  };
  const rejection=numberError();
  if(action==='dismissNumberError'){
    if(!rejection)return {ok:true,dismissed:true};
    if(rejection.text!==payload.errorText||!rejection.button)return {ok:false,reason:'O aviso mudou ou seu botão OK não foi encontrado.'};
    rejection.button.click();return {ok:true,dismissed:true};
  }
  if(action==='probe') return {numberError:rejection?{text:rejection.text,phone:rejection.phone}:null,documentToken:state.documentToken,connected:(!!composer || !!document.querySelector('#pane-side, #side')) ? true : null, conversation:!!main, draft:draft(), draftMatches:typeof payload.message==='string' && sameText(draft(),payload.message), routePhone:routePhone(), header:headerName()};
  if(action==='diagnose') return {
    adapterVersion:'1.0.3', draft:draft(), draftMatches:typeof payload.message==='string'&&sameText(draft(),payload.message),
    editorFound:!!composer,
    innerText:composer?.innerText??null, textContent:composer?.textContent??null,
    editorCount:main?[...main.querySelectorAll('footer [contenteditable="true"]')].filter(visible).length:0,
    blocks:composer?[...composer.querySelectorAll('p,div,li,ul,ol,br')].slice(0,100).map(el=>({tag:el.tagName,text:el.tagName==='LI'?el.textContent:null})):[]
  };
  if(action==='openDetails'){
    if(!header)return {ok:false};
    const title=header.querySelector('[title]');
    const clickable=title?.closest('[role="button"],button') || title;
    if(!clickable)return {ok:false};
    clickable.click();return {ok:true};
  }
  if(action==='inspect'){
    if(rejection){
      if(routeConflicts(payload.phone)||(rejection.phone&&rejection.phone!==payload.phone))return {ready:false,fatal:true,reason:'O aviso de número inválido pertence a outro telefone.'};
      return {ready:false,invalidNumber:true,errorText:rejection.text,errorPhone:rejection.phone,reason:'O WhatsApp informou que este número não está cadastrado.'};
    }
    if(!main||!composer)return {ready:false,reason:'Aguardando a conversa ou login do WhatsApp.'};
    if([...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].some(visible))return {ready:false,reason:'O WhatsApp mostra uma janela sobre a conversa. Confira o aviso antes de continuar.'};
    if(routeConflicts(payload.phone))return {ready:false,fatal:true,reason:'O número presente no endereço da aba é diferente do destinatário. Reabra a conversa pelo painel.'};
    if(!sameText(draft(),payload.message))return {ready:false,reason:'A mensagem ainda não apareceu como rascunho ou difere da prévia.'};
    if(!sendButton())return {ready:false,reason:'Botão Enviar não identificado na interface.'};
    const proof=evidence(payload.phone);
    if(proof.mismatch)return {ready:false,fatal:true,reason:'O número visível não corresponde ao destinatário. Nenhum envio realizado.'};
    const token={phone:payload.phone,message:normalize(payload.message),main,header:headerName(),signature:signature(),proof:proof.ok,preparedAt:Date.now(),used:false};
    state.prepared=token;
    return {ready:true,verified:proof.ok,header:token.header,evidence:proof.type,signature:token.signature};
  }
  if(action==='autoBind'){
    const p=state.prepared;
    if(!p||p.used||p.phone!==payload.phone||p.message!==normalize(payload.message)||main!==p.main||headerName()!==p.header||p.signature!==signature()||routeConflicts(p.phone)||!sameText(draft(),p.message))return {ok:false,reason:'A conversa mudou. Prepare novamente.'};
    if(evidence(p.phone).mismatch)return {ok:false,reason:'Número diferente do esperado.'};
    {
      if(payload.navigationAuthorized!==true||payload.expectedSignature!==p.signature||!p.header)return {ok:false,reason:'Navegação automática não foi validada.'};
      p.routed=true;
    }
    p.preparedAt=Date.now();return {ok:true};
  }
  if(action==='send'){
    const p=state.prepared;
    if(!p||p.used||Date.now()-p.preparedAt>180000)return {ok:false,clicked:false,reason:'Preparação expirada. Prepare novamente.'};
    if(p.phone!==payload.phone||p.message!==normalize(payload.message)||main!==p.main||routeConflicts(p.phone)||headerName()!==p.header||!sameText(draft(),p.message))return {ok:false,clicked:false,reason:'Conversa ou rascunho mudou. Envio cancelado.'};
    const proof=evidence(p.phone);
    if(proof.mismatch||(!proof.ok&&!p.routed)||(!proof.ok&&p.signature!==signature()))return {ok:false,clicked:false,reason:'Não foi possível reconfirmar o destinatário.'};
    const button=sendButton();if(!button)return {ok:false,clicked:false,reason:'Botão Enviar indisponível.'};
    state.attempt={phone:p.phone,message:p.message,ids:outgoing().map(m=>m.id),at:Date.now(),main,header:p.header};
    p.used=true;
    button.click();
    return {ok:true,clicked:true};
  }
  if(action==='settled'){
    const a=state.attempt;
    if(!a||a.phone!==payload.phone||a.message!==normalize(payload.message))return {settled:false,fatal:true,reason:'Registro do clique não está disponível nesta aba.'};
    if(!main||!composer)return {settled:false,reason:'Aguardando o campo de mensagem ficar disponível.'};
    if(main!==a.main||headerName()!==a.header||routeConflicts(a.phone))return {settled:false,fatal:true,reason:'A conversa mudou depois do clique de envio.'};
    return {settled:draft()==='',reason:'Aguardando o WhatsApp liberar o campo de mensagem.'};
  }
  return {ok:false,reason:'Ação desconhecida.'};
}
