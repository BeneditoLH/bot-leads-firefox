import {VERSION, runQueue, limitValue} from './engine.js';
import {api, endpointValue, dom, prepare, settle} from './transport.js';
const $=id=>document.getElementById(id);
let config={}, local={}, logs=[], snapshot=null, running=false, paused=false, selected='', lastSummary={sent:0,synchronized:0};
let interests=null; // null = all; [] = none, persisted in this Firefox profile.
/** Agrupa variações textuais de uma mesma série; interesses não reconhecidos permanecem como texto normalizado. */
function interestKey(value){
 const text=String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
 const year=text.match(/(?:^|\s)([1-9])\s*[º°oa]?\s*(?:ano|serie)\b/);
 return year ? year[1]+'º ano' : text.replace(/\s+/g,' ');
}
/** Desenha as caixas de seleção a partir da planilha. null significa todas; uma lista vazia significa nenhum envio. */
function renderInterests(){
 const values=[...new Set([...(snapshot?.candidates||[]).map(r=>interestKey(r.interest)),...(interests||[])])].sort((a,b)=>a.localeCompare(b,'pt-BR',{numeric:true}));
 const frag=document.createDocumentFragment();
 for(const value of values){
  const label=document.createElement('label'),input=document.createElement('input');
  input.type='checkbox';input.checked=interests===null||interests.includes(value);input.disabled=running;
  input.onchange=async()=>{if(running)return;const chosen=new Set(interests===null?values:interests);if(input.checked)chosen.add(value);else chosen.delete(value);interests=[...chosen];await browser.storage.local.set({leadsInterests:interests});render();};
  label.append(input,document.createTextNode(value));frag.append(label);
 }
 $('interestOptions').replaceChildren(frag);
 $('filterHint').textContent=interests===null?'Todas as séries.':interests.length?'Selecionadas: '+interests.join(', '):'Nenhuma série selecionada. Nenhuma mensagem será enviada.';
}
const blocked=new Set(['sending','clicked','sent','done','invalid_pending','invalid']);
const busyIds=['start','refresh','saveConfig','endpoint','secret','limit','tabs','openWA','whatsapp','allInterests','noInterests','interestFilter'];
/** Atualiza a mensagem de acompanhamento e o destaque visual de erro. */
function notice(message,error=false){$('notice').textContent=message;$('notice').classList.toggle('error',error);}
/** Salva operações e registros no perfil local do navegador para recuperação posterior. */
async function persist(){await browser.storage.local.set({leadsOperations:local,leadsLogs:logs});}
/** Acrescenta um evento com horário e limita o tamanho do histórico exibido. */
function addLog(message){logs.unshift({time:new Date().toISOString(),message});logs=logs.slice(0,300);renderLogs();}
/** Reconstrói o histórico usando nós de texto, sem interpretar conteúdo como HTML. */
function renderLogs(){const frag=document.createDocumentFragment();for(const item of logs.slice(0,150)){const li=document.createElement('li'),time=document.createElement('time');time.textContent=new Date(item.time).toLocaleTimeString('pt-BR');li.append(time,document.createTextNode(item.message));frag.append(li);}$('log').replaceChildren(frag);}
/** Bloqueia controles concorrentes enquanto a operação atual está em andamento. */
function setBusy(value){running=value;for(const id of busyIds)$(id).disabled=value;$('pause').disabled=!value;document.querySelectorAll('#pending button').forEach(b=>b.disabled=value);}
/** Cria uma célula de tabela com texto puro, evitando interpretação de marcação vinda da planilha. */
function td(text){const el=document.createElement('td');el.textContent=text??'';return el;}
/** Exibe o destinatário e a mensagem do item; selecionar uma prévia não aciona envio. */
function preview(row){selected=row.key;$('previewName').textContent=`Linha ${row.row} · ${row.name} · +${row.phone}`;$('previewText').textContent=row.message;for(const tr of $('queue').rows)tr.classList.toggle('selected',tr.dataset.key===selected);}
/** Aplica o filtro de séries e exclui telefones bloqueados pelo histórico local. */
function candidates(){return (snapshot?.candidates||[]).filter(row=>!blocked.has(local[row.phone]?.state)&&(interests===null||interests.includes(interestKey(row.interest))));}
/** Combina pendências locais e do servidor para permitir sincronização sem reenvio. */
function pendingRows(){
  const rows=new Map((snapshot?.pending||[]).map(r=>[r.phone,{...r}]));
  for(const record of Object.values(local)) if(['sending','clicked','sent','invalid_pending'].includes(record.state)) {
    const server=rows.get(record.phone);
    if(!server||server.requestId===record.requestId) rows.set(record.phone,{...record,state:server?.state==='sent'?'sent':record.state});
  }
  return [...rows.values()];
}
/** Atualiza a fila, contadores, prévia e ações de recuperação a partir do estado atual. */
function render(){
  renderInterests();
  const queue=candidates(), pend=pendingRows();
  $('eligible').textContent=queue.length;$('pendingCount').textContent=pend.length;$('pendingSection').hidden=!pend.length;
  const frag=document.createDocumentFragment();
  for(const row of queue){const tr=document.createElement('tr');tr.dataset.key=row.key;tr.append(td(row.row),td(row.name),td('+'+row.phone),td(row.interest));tr.tabIndex=0;tr.onclick=()=>preview(row);tr.onkeydown=e=>{if(e.key==='Enter')preview(row);};frag.append(tr);}
  $('queue').replaceChildren(frag);$('queueHint').textContent=queue.length+' contatos';
  if(!queue.length){selected='';$('previewName').textContent='Nenhum contato no filtro selecionado.';$('previewText').textContent='';}
  if(queue.length&&!queue.some(r=>r.key===selected))preview(queue[0]);
  const skips=[...(snapshot?.skipped||[]),...(snapshot?.candidates||[]).filter(r=>blocked.has(local[r.phone]?.state)).map(r=>({...r,reason:'Histórico local: '+local[r.phone].state}))];
  $('skipCount').textContent=skips.length;
  const sf=document.createDocumentFragment();for(const row of skips){const tr=document.createElement('tr');tr.append(td(row.row),td(row.name),td(row.reason));sf.append(tr);}$('skipped').replaceChildren(sf);
  $('pending').replaceChildren();
  for(const row of pend){
    const box=document.createElement('div');box.className='pending-item';
    const title=document.createElement('b');title.textContent=`${row.name||'Contato'} · +${row.phone}`;
    const desc=document.createElement('p');desc.textContent=row.state==='invalid_pending'?'O WhatsApp recusou o número. Falta sincronizar Número Inválido na planilha.':row.state==='sent'?'Envio registrado. Falta sincronizar o status na planilha.':'A execução foi interrompida. Confira a conversa: o bot não reenviará automaticamente.';
    const actions=document.createElement('div');actions.className='row';
    const sync=document.createElement('button');sync.textContent=row.state==='invalid_pending'?'Sincronizar Número Inválido':row.state==='sent'?'Sincronizar status sem reenviar':'Já foi enviada: atualizar status';sync.disabled=running;sync.onclick=()=>resolve(row,true);
    actions.append(sync);
    if(!['sent','invalid_pending'].includes(row.state)) {const release=document.createElement('button');release.textContent='Não foi enviada: liberar telefone';release.disabled=running;release.onclick=()=>resolve(row,false);actions.append(release);}
    box.append(title,desc,actions);$('pending').append(box);
  }
}
/** Reflete no painel os envios, sincronizações e números inválidos da execução. */
function updateCounters(s){lastSummary=s;$('sentCount').textContent=s.sent;$('syncCount').textContent=s.synchronized;$('invalidCount').textContent=s.invalid||0;$('progress').value=s.sent;}
/** Recarrega a planilha, confere versão e origem esperadas e reconcilia o histórico remoto com o local. */
async function refreshData(){
  snapshot=await api(config,'list');
  if(!['1.0.2',VERSION].includes(snapshot.version)) throw Error(`Versão do Apps Script (${snapshot.version}) diferente da extensão (${VERSION}). Atualize a implantação.`);
  if(snapshot.spreadsheetId!=='CONFIGURE_SPREADSHEET_ID'||snapshot.sheetId!==0) throw Error('A conexão ainda aponta para outra planilha. Atualize o Code.gs e publique uma nova versão da implantação para usar a cópia correta.');
  // Server history survives temporary extension removal and resolves older local uncertainty.
  for(const h of snapshot.history||[]) {
    const r=local[h.phone];
    if(r&&r.requestId!==h.requestId) local[h.phone]={...r,state:'superseded'};
    else if(r&&['cancelled','done','invalid'].includes(h.state)) local[h.phone]={...r,state:h.state};
  }
  await persist();render();$('connection').textContent='Conectado · '+snapshot.sheet;
}
/** Localiza abas do WhatsApp e mantém a seleção anterior quando ainda disponível. */
async function tabs(){
  const before=$('whatsapp').value;
  const found=await browser.tabs.query({url:'https://web.whatsapp.com/*'});
  $('whatsapp').replaceChildren(new Option('Selecione a aba do WhatsApp',''));
  for(const tab of found)$('whatsapp').add(new Option(`${tab.title||'WhatsApp'} · aba ${tab.id}`,String(tab.id)));
  if(found.some(t=>String(t.id)===before))$('whatsapp').value=before;else if(found.length===1)$('whatsapp').value=String(found[0].id);
}
/** Executa trabalho sob um bloqueio compartilhado entre painéis e restaura os controles mesmo se ocorrer erro. */
async function exclusive(fn){
  if(running)return;
  return navigator.locks.request('schoolbot-leads-2027-operation',{ifAvailable:true},async lock=>{
    if(!lock){notice('Já existe uma execução em outro painel. Use o painel aberto.',true);return;}
    setBusy(true);
    try{await fn();}catch(err){notice(err.message,true);addLog(err.message);await persist();}
    finally{setBusy(false);render();}
  });
}
/** Resolve uma pendência registrada; sincronização de status nunca deve disparar novamente uma mensagem. */
async function resolve(row,sent){
  if(running)return;
  if(!['sent','invalid_pending'].includes(row.state)){
    const text=sent?`Você conferiu que a mensagem para +${row.phone} foi enviada? O bot apenas atualizará o status, sem reenviar.`:`Você conferiu que NÃO houve envio para +${row.phone}? Liberar permite uma nova tentativa. Se a mensagem já saiu, isso pode gerar duplicação.`;
    if(!window.confirm(text))return;
  }
  await exclusive(async()=>{
    const op={phone:row.phone,requestId:row.requestId};
    if(row.state==='invalid_pending'){
      await api(config,'markInvalid',{...op,numberRejected:true});
      local[row.phone]={...row,state:'invalid'};addLog(`Número Inválido sincronizado para +${row.phone}. Nenhuma mensagem enviada.`);
    }else if(sent){
      local[row.phone]={...row,state:'sent'};await persist();
      await api(config,'complete',{...op,sendObserved:true});
      local[row.phone]={...row,state:'done'};addLog(`Status sincronizado para +${row.phone}. Nenhuma mensagem reenviada.`);
    }else{
      await api(config,'notClicked',{...op,confirmedNoClick:true});
      local[row.phone]={...row,state:'cancelled'};addLog(`Telefone +${row.phone} liberado após revisão manual de ausência de envio.`);
    }
    await persist();await refreshData();notice('Pendência resolvida.');
  });
}
$('allInterests').onclick=async()=>{if(running)return;interests=null;await browser.storage.local.set({leadsInterests:interests});render();};
$('noInterests').onclick=async()=>{if(running)return;interests=[];await browser.storage.local.set({leadsInterests:interests});render();};
$('saveConfig').onclick=()=>exclusive(async()=>{
  config={endpoint:endpointValue($('endpoint').value),secret:$('secret').value.trim()};
  if(config.secret.length<32)throw Error('Cole o valor completo de BOT_SECRET nas propriedades do Apps Script.');
  await browser.storage.local.set({leadsConfig:config});
  notice('Conectando à planilha…');await refreshData();$('settings').open=false;notice('Conexão salva. Confira a prévia, escolha a quantidade e inicie a fila.');
});
$('refresh').onclick=()=>exclusive(async()=>{notice('Lendo a planilha…');await refreshData();notice(`${candidates().length} contatos disponíveis. Lista atualizada.`);});
$('tabs').onclick=()=>tabs().catch(e=>notice(e.message,true));
$('openWA').onclick=async()=>{await browser.tabs.create({url:'https://web.whatsapp.com/'});await tabs();};
$('pause').onclick=()=>{paused=true;$('pause').disabled=true;notice('Pausa solicitada. Se o envio já começou, o bot termina a atualização deste contato.');};
$('start').onclick=()=>exclusive(async()=>{
  const limit=limitValue($('limit').value),tabId=Number($('whatsapp').value);
  if(!tabId)throw Error('Selecione a aba do WhatsApp.');
  paused=false;updateCounters({sent:0,synchronized:0});$('progress').max=limit;
  notice('Atualizando a fila antes de iniciar…');await refreshData();
  const rows=candidates();if(!rows.length){notice('Nenhum Novo lead elegível para enviar.');return;}
  const runConfig={...config};
  addLog(`Início: até ${limit} mensagens, somente Novo lead; séries: ${interests===null?'todas':interests.join(', ')}.`);
  try{
    const result=await runQueue(rows,limit,{
      api:(action,data)=>api(runConfig,action,data),paused:()=>paused,uuid:()=>crypto.randomUUID(),
      remember:async record=>{local[record.phone]={...record,updated:new Date().toISOString()};await persist();render();},
      prepare:row=>prepare(tabId,row,()=>paused,reason=>notice(`${row.name}: ${reason}`)),
      send:(row,prepared)=>dom(tabId,'send',{phone:row.phone,message:row.message,...prepared}),
      settle:(row,prepared)=>settle(tabId,row,prepared),
      show:(row,status,summary)=>{preview(row);notice(`${row.name} · +${row.phone}\n${status}`);if(summary){updateCounters(summary);addLog(`${row.name} · +${row.phone}: ${status}`);}}
    });
    updateCounters(result);addLog(`${result.paused?'Pausado':'Concluído'}: ${result.sent} envios acionados; ${result.synchronized} atualizações de envio; ${result.invalid} números inválidos.`);
    await persist();await refreshData();notice(`${result.paused?'Fila pausada':'Execução concluída'}. ${result.sent} mensagens enviadas e ${result.synchronized} status de envio processados. ${result.invalid} números inválidos ignorados.`);
  }catch(err){
    if(err.summary)updateCounters(err.summary);
    addLog('Fila interrompida: '+err.message);await persist();
    try{await refreshData();}catch(_){}
    notice((paused?'Fila pausada. ':'Fila interrompida. ')+err.message,true);
  }
});
$('exportLog').onclick=()=>{
  const data={version:VERSION,exportedAt:new Date().toISOString(),operations:Object.values(local),logs};
  const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download='historico-leads-2027-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
/** Restaura preferências e histórico, conecta as fontes disponíveis e prepara o painel. */
async function init(){
  const saved=await browser.storage.local.get(['leadsConfig','leadsOperations','leadsLogs','leadsInterests']);
  interests=Array.isArray(saved.leadsInterests)?saved.leadsInterests:null;
  config=saved.leadsConfig||{};local=saved.leadsOperations||{};logs=saved.leadsLogs||[];
  $('endpoint').value=config.endpoint||'';$('secret').value=config.secret||'';$('version').textContent='· v'+VERSION;
  $('settings').open=!config.endpoint;renderLogs();render();await tabs();
  if(config.endpoint)await exclusive(async()=>{notice('Conectando e recuperando o histórico…');await refreshData();notice('Pronto. Escolha a quantidade e inicie a fila.');});
}
init().catch(err=>notice(err.message,true));
