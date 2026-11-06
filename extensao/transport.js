import {whatsappDom} from './whatsapp.js';
import {normalize} from './engine.js';
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
/** Valida a URL do Apps Script: exige HTTPS, domínio oficial e implantação /exec sem parâmetros. */
export function endpointValue(value) {
  let u; try { u=new URL(value.trim()); } catch (_) { throw Error('Cole a URL da implantação do Apps Script.'); }
  if(u.origin!=='https://script.google.com'||!/^\/macros\/s\/[a-zA-Z0-9_-]+\/exec$/.test(u.pathname)||u.search||u.hash) throw Error('Use a URL https://script.google.com/macros/s/.../exec, sem parâmetros.');
  return u.href;
}
/** Envia uma operação autenticada ao Apps Script e converte falhas HTTP, JSON e timeout em erros para o painel. */
export async function api(config, action, data={}) {
  const endpoint=endpointValue(config.endpoint);
  if(!config.secret?.trim()) throw Error('Preencha a chave de acesso.');
  const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),60000);
  try {
    const res=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({...data,action,secret:config.secret.trim()}),redirect:'follow',credentials:'omit',cache:'no-store',signal:controller.signal});
    if(!res.ok) throw Error('A conexão com a planilha retornou HTTP '+res.status+'.');
    let json; try { json=await res.json(); } catch (_) { throw Error('O Google não retornou dados do bot. Confira a implantação: executar como você, acesso Qualquer pessoa e URL /exec.'); }
    if(!json.ok) throw Error(json.error || 'A planilha recusou a operação.');
    return json;
  } catch(err) {
    if(err.name==='AbortError') throw Error('A planilha demorou a responder. Atualize o painel antes de retomar; o bot não repete uma tentativa iniciada.');
    throw err;
  } finally { clearTimeout(timer); }
}
/** Injeta o adaptador na aba escolhida e devolve seu resultado; ausência de resposta é tratada como falha. */
export async function dom(tabId, action, data={}) {
  const results=await browser.scripting.executeScript({target:{tabId},func:whatsappDom,args:[action,data]});
  if(!results.length||results[0].error) throw Error(results[0]?.error?.message || 'Não foi possível ler a aba do WhatsApp.');
  if(!results[0].result) throw Error('O WhatsApp não respondeu.');
  return results[0].result;
}
/** Abre o contato em um novo documento, preserva rascunhos divergentes e aguarda evidência de destinatário antes de liberar o envio. */
export async function prepare(tabId, row, paused, show) {
  const first=await dom(tabId,'probe',{message:row.message});
  const dismiss=async (errorText,documentToken)=>{
    const r=await dom(tabId,'dismissNumberError',{errorText,documentToken});
    if(!r.dismissed)throw Error(r.reason||'Não foi possível fechar o aviso de número inválido.');
  };
  if(first.numberError){
    await dismiss(first.numberError.text,first.documentToken);
    // A pre-existing modal can identify this row only when it names its phone.
    if(first.numberError.phone===row.phone)return {invalidNumber:true,reason:first.numberError.text};
  }
  // A sidebar selector is only a hint, not proof of login. The Business/home
  // layout may omit it. Navigate and wait for the actual recipient composer;
  // inspect/send still verify the draft, chat and send button before any click.
  if(first.draft && normalize(first.draft)!==normalize(row.message)) throw Error('Há um rascunho diferente na conversa aberta. Ele foi preservado; salve-o ou limpe o campo antes de continuar.');
  // Guard is active only for this requested navigation and unchanged draft.
  const armed=await browser.scripting.executeScript({target:{tabId},world:'MAIN',func:message=>globalThis.__schoolbotLeadsNavigationGuard?.arm(message) || {ok:false,reason:'Recarregue a aba do WhatsApp uma vez após instalar a extensão.'},args:[row.message]});
  if(!armed[0]?.result?.ok) throw Error(armed[0]?.result?.reason || 'Não foi possível preparar a navegação.');
  try {
    if(paused()) throw Error('Pausa solicitada antes de abrir o contato.');
    await browser.tabs.update(tabId,{url:'https://web.whatsapp.com/send?phone='+encodeURIComponent(row.phone)+'&text='+encodeURIComponent(row.message),active:true});
  } catch (err) {
    try { await browser.scripting.executeScript({target:{tabId},world:'MAIN',func:()=>globalThis.__schoolbotLeadsNavigationGuard?.cancel()}); } catch (_) {}
    throw err;
  }
  const deadline=Date.now()+90000; let stable='',count=0,last='Abrindo a conversa';
  while(Date.now()<deadline) {
    if(paused()) throw Error('Pausa solicitada. Nenhum envio foi acionado para este contato.');
    await sleep(650);
    let p; try { p=await dom(tabId,'probe',{message:row.message}); } catch (_) { continue; }
    if(p.documentToken===first.documentToken) continue;
    const payload={phone:row.phone,message:row.message,documentToken:p.documentToken};
    const check=await dom(tabId,'inspect',payload);
    if(check.fatal) throw Error(check.reason);
    if(check.invalidNumber){
      await dismiss(check.errorText,p.documentToken);
      return {invalidNumber:true,reason:check.errorText};
    }
    if(!check.ready) { stable='';count=0;last=check.reason;show(last);continue; }
    if(check.verified) return {documentToken:p.documentToken};
    // New document loaded by the bot + stable chat, without contradictory phone evidence.
    const sig=p.documentToken+'|'+check.signature;
    count=sig===stable?count+1:1;stable=sig;
    if(count>=2&&check.header) {
      const bound=await dom(tabId,'autoBind',{...payload,navigationAuthorized:true,expectedSignature:check.signature});
      if(bound.ok) return {documentToken:p.documentToken};
      last=bound.reason;
    }
  }
  throw Error('Não foi possível preparar o contato em 90 segundos. '+last+' Confira se o número possui WhatsApp.');
}
/** Aguarda o esvaziamento do editor após o clique. Isso não comprova entrega ou leitura; timeout impede repetição automática. */
export async function settle(tabId,row,prepared) {
  const until=Date.now()+12000;
  while(Date.now()<until) {
    const result=await dom(tabId,'settled',{phone:row.phone,message:row.message,...prepared});
    if(result.settled) return;
    if(result.fatal) throw Error(result.reason);
    await sleep(200);
  }
  throw Error('O clique de envio ocorreu, mas o campo não ficou vazio. O telefone está bloqueado para reenvio até a revisão.');
}
