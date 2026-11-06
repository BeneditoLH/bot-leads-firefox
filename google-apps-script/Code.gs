/* Automação escolar — Leads 2027, v1.0.2. Projeto independente do Google Apps Script. */
const BOT = Object.freeze({
  spreadsheet: 'CONFIGURE_SPREADSHEET_ID',
  sheet: 'Leads 2027', gid: 0, journal: '_Bot_Leads_2027',
  target: 'Primeiro Atendimento', version: '1.0.2', leaseMs: 300000
});
/** Normaliza texto para comparação de status sem diferenças de caixa, acentos ou espaços. */
function norm_(s) { return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase(); }
/** Extrai somente dígitos de um valor para a validação do telefone. */
function digits_(s) { return String(s || '').replace(/\D/g, ''); }
/** Valida o formato de celular brasileiro e acrescenta o código do país quando necessário. */
function phone_(s) {
  let p = digits_(s);
  if (p.length === 11) p = '55' + p;
  return /^55[1-9]\d9\d{8}$/.test(p) ? p : '';
}
/** Extrai o destinatário de um hiperlink WhatsApp reconhecido, sem acessar o link. */
function linkPhone_(url) {
  const s = String(url || '');
  const m = s.match(/^https?:\/\/(?:www\.)?wa\.me\/(\d+)/i) ||
    s.match(/^https?:\/\/(?:api|web)\.whatsapp\.com\/send\?[^#]*?\bphone=([^&#]+)/i);
  if (!m) return '';
  try { return phone_(decodeURIComponent(m[1])); } catch (_) { return ''; }
}
/** Cria uma chave estável dos dados da linha para detectar alterações antes de escrever o status. */
function digest_(s) { return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s).map(b => ('0' + ((b + 256) % 256).toString(16)).slice(-2)).join(''); }
/** Abre exclusivamente a planilha configurada neste projeto. */
function spreadsheet_() { return SpreadsheetApp.openById(BOT.spreadsheet); }
/** Confere nome e identificador da aba de origem para evitar escrita em outra planilha. */
function sheet_() {
  const s = spreadsheet_().getSheetByName(BOT.sheet);
  if (!s || s.getSheetId() !== BOT.gid) throw Error('A aba Leads 2027 não foi encontrada com o identificador esperado.');
  return s;
}
/** Obtém o diário de operações criado na configuração inicial; não recria histórico apagado silenciosamente. */
function journal_() {
  const s = spreadsheet_().getSheetByName(BOT.journal);
  if (!s) throw Error('Execute configurarBot no editor do Apps Script primeiro.');
  return s;
}
/** Inicializa o diário e a chave de acesso nas propriedades do projeto. Execute ao instalar seu próprio serviço. */
function configurarBot() {
  const lock = LockService.getScriptLock(); lock.waitLock(15000);
  let secret;
  try {
    sheet_();
    const p = PropertiesService.getScriptProperties();
    secret = p.getProperty('BOT_SECRET');
    if (!secret) { secret = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''); p.setProperty('BOT_SECRET', secret); }
    const ss = spreadsheet_();
    if (!ss.getSheetByName(BOT.journal)) {
      const s = ss.insertSheet(BOT.journal); s.getRange(1, 1, 1, 2).setValues([['Telefone / controle de envio', 'Registro do bot (não editar)']]); s.hideSheet();
    }
  } finally { lock.releaseLock(); }
  console.log('Configuração concluída. Abra Configurações do projeto > Propriedades do script e copie o valor de BOT_SECRET. Não compartilhe essa chave.');
}
/** Lê células, fórmulas e hiperlinks e constrói registros com inconsistências detectadas. */
function getRows_() {
  const s = sheet_(), last = s.getLastRow();
  if (last < 2) return [];
  const values = s.getRange(2, 1, last - 1, 7).getDisplayValues();
  const rich = s.getRange(2, 5, last - 1, 1).getRichTextValues();
  const formulas = s.getRange(2, 5, last - 1, 1).getFormulas();
  return values.map((v, i) => {
    const r = rich[i][0];
    const urls = r ? [r.getLinkUrl(), ...r.getRuns().map(x => x.getLinkUrl())].filter(Boolean) : [];
    const formulaUrl = (formulas[i][0] || '').match(/(?:HYPERLINK|HIPERLINK)\s*\(\s*"([^"]+)"/i);
    if (formulaUrl) urls.push(formulaUrl[1]);
    const linked = [...new Set(urls.map(linkPhone_).filter(Boolean))];
    const shown = phone_(v[4]);
    const phone = linked.length === 1 ? linked[0] : shown;
    let issue = '';
    if (linked.length > 1 || (shown && linked.length === 1 && shown !== phone)) issue = 'Telefone exibido e hiperlink divergentes.';
    else if (!phone) issue = 'Telefone celular inválido ou sem DDD.';
    else if (!String(v[5] || '').trim()) issue = 'Coluna F sem período de interesse.';
    const interest = String(v[5] || '').trim();
    if (interest.length > 300) issue = 'Período de interesse muito longo; revise a coluna F.';
    return {row: i + 2, name: v[2] || v[1] || 'Sem nome', student: v[1], phone, interest, status: v[6] || '', issue,
      key: digest_(JSON.stringify(v.slice(0, 6))),
      message: 'Olá! Vi que você manifestou interesse no ' + interest + '. Gostaria de agendar uma visita para conhecer a escola?'};
  });
}
/** Reconstrói o histórico persistido no diário de operações. */
function records_() {
  const s = journal_(), out = new Map();
  if (s.getLastRow() < 2) return out;
  s.getRange(2, 1, s.getLastRow() - 1, 2).getValues().forEach((v, i) => {
    if (!v[0] && !v[1]) return;
    let rec; try { rec = JSON.parse(v[1]); } catch (_) { throw Error('Registro do bot danificado na linha ' + (i + 2) + '. Não apague o histórico.'); }
    if (!rec || rec.phone !== String(v[0]) || out.has(rec.phone)) throw Error('Controle do bot inconsistente. Revise a aba ' + BOT.journal + '.');
    out.set(rec.phone, {...rec, _line: i + 2});
  });
  return out;
}
/** Grava ou atualiza um registro do diário, preservando a identidade da operação. */
function save_(rec) {
  const s = journal_(); const line = rec._line || s.getLastRow() + 1;
  const data = {...rec, updated: Date.now()}; delete data._line;
  s.getRange(line, 1, 1, 2).setValues([[String(rec.phone), JSON.stringify(data)]]);
  SpreadsheetApp.flush(); return {...data, _line: line};
}
/** Mantém bloqueadas tentativas ativas; somente reservas não iniciadas podem expirar. */
function active_(r) { return r && r.state !== 'cancelled' && !(r.state === 'reserved' && r.expires < Date.now()); }
/** Remove o índice interno do diário antes de devolver o registro ao cliente. */
function publicRec_(r) { const v = {...r}; delete v._line; return v; }
/** Localiza a linha pela chave de conteúdo, em vez de confiar apenas na posição física. */
function findRow_(key, rows) {
  const matches = rows.filter(r => r.key === key);
  if (matches.length !== 1) throw Error('O cadastro foi alterado ou ficou ambíguo na planilha. Nenhum status foi sobrescrito.');
  return matches[0];
}
/** Aceita somente Novo lead sem inconsistências de dados. */
function eligible_(row) { return norm_(row.status) === 'novo lead' && !row.issue; }
/** Valida o status de destino contra as regras da célula antes de realizar a atualização. */
function validTarget_(row) {
  const rule = sheet_().getRange(row.row, 7).getDataValidation();
  if (rule && rule.getCriteriaType() === SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST) {
    const values = rule.getCriteriaValues()[0];
    if (!values.includes(BOT.target)) throw Error('A lista de status não permite Primeiro Atendimento nesta linha.');
  }
}
/** Aplica as transições da operação: listagem, reserva, início, conclusão, cancelamento e número inválido. */
function dispatch_(q) {
  const recs = records_();
  if (q.action === 'list') {
    const rows = getRows_(), seen = new Set(), candidates = [], skipped = [];
    for (const row of rows) {
      if (norm_(row.status) !== 'novo lead') continue;
      let reason = row.issue;
      const rec = recs.get(row.phone);
      if (!reason && active_(rec)) reason = ({done:'Já processado pelo bot',sent:'Envio registrado; status pendente',sending:'Tentativa em revisão',reserved:'Reservado por uma execução'})[rec.state] || 'Bloqueado pelo histórico';
      if (!reason && seen.has(row.phone)) reason = 'Mesmo telefone de outro Novo lead';
      if (!reason) { seen.add(row.phone); candidates.push(row); } else skipped.push({...row, reason});
    }
    const pending = [...recs.values()].filter(r => ['sending','sent','invalid_pending'].includes(r.state)).map(publicRec_);
    return {version:BOT.version, spreadsheetId:BOT.spreadsheet, sheetId:BOT.gid, sheet:BOT.sheet, candidates, skipped, pending, history:[...recs.values()].map(r => ({phone:r.phone,requestId:r.requestId,state:r.state})), total:rows.filter(r => r.student || r.phone || r.status).length};
  }
  if (!q.phone || !q.requestId || !/^[a-zA-Z0-9-]{16,80}$/.test(q.requestId)) throw Error('Identificação da operação inválida.');
  const old = recs.get(q.phone);
  if (q.action === 'reserve') {
    if (active_(old)) {
      if (old.requestId === q.requestId && old.state === 'reserved') return {record:publicRec_(old)};
      throw Error('Este telefone já está reservado, processado ou aguardando revisão.');
    }
    const row = findRow_(q.key, getRows_());
    if (row.phone !== q.phone || !eligible_(row)) throw Error('Este lead deixou de ser elegível. Atualize a lista.');
    validTarget_(row);
    const record = save_({...row, _line:old?._line, requestId:q.requestId, state:'reserved', expires:Date.now()+BOT.leaseMs});
    return {record:publicRec_(record)};
  }
  if (!old || old.requestId !== q.requestId) throw Error('Esta operação não corresponde ao registro atual do telefone.');
  if (q.action === 'markInvalid') return markInvalid_(q, old);
  if (q.action === 'cancel') {
    if (old.state !== 'reserved') throw Error('Uma tentativa iniciada não pode ser liberada automaticamente.');
    return {record:publicRec_(save_({...old, state:'cancelled'}))};
  }
  if (q.action === 'begin') {
    if (old.state !== 'reserved' || old.expires < Date.now()) throw Error('Reserva expirada ou tentativa já iniciada. Atualize a fila.');
    const row = findRow_(old.key, getRows_());
    if (!eligible_(row) || row.phone !== old.phone || row.message !== old.message) throw Error('O cadastro ou status mudou antes do envio.');
    validTarget_(row);
    return {record:publicRec_(save_({...old, row:row.row, state:'sending'}))};
  }
  if (q.action === 'notClicked') {
    if (!['sending','reserved'].includes(old.state) || q.confirmedNoClick !== true) throw Error('Liberação inválida.');
    return {record:publicRec_(save_({...old, state:'cancelled'}))};
  }
  if (q.action === 'complete') {
    if (old.state === 'done') return {record:publicRec_(old), updated:false};
    if (!['sending','sent'].includes(old.state) || q.sendObserved !== true) throw Error('Envio ainda não registrado.');
    // Checkpoint BEFORE editing G: retries only synchronize; never send again.
    const sent = save_({...old, state:'sent'});
    const row = findRow_(old.key, getRows_());
    let updated = false, warning = '';
    if (norm_(row.status) === 'novo lead') {
      validTarget_(row);
      // Re-read identity and status immediately before writing, including moved rows.
      const cells = sheet_().getRange(row.row, 1, 1, 7).getDisplayValues()[0];
      if (digest_(JSON.stringify(cells.slice(0, 6))) !== old.key || norm_(cells[6]) !== 'novo lead') throw Error('A linha foi editada durante a atualização. Tente sincronizar novamente.');
      sheet_().getRange(row.row, 7).setValue(BOT.target); SpreadsheetApp.flush(); updated = true;
    } else if (norm_(row.status) !== norm_(BOT.target)) warning = 'O status foi alterado por outra pessoa e foi preservado: ' + row.status;
    return {record:publicRec_(save_({...sent, state:'done', row:row.row, warning})), updated, warning};
  }
  throw Error('Ação não reconhecida.');
}
/** Autentica a requisição, serializa operações com LockService e devolve resposta JSON de sucesso ou erro. */
function doPost(e) {
  let out, lock;
  try {
    const q = JSON.parse(e.postData.contents || '{}');
    const secret = PropertiesService.getScriptProperties().getProperty('BOT_SECRET');
    if (!secret || typeof q.secret !== 'string' || q.secret !== secret) throw Error('Chave inválida.');
    lock = LockService.getScriptLock(); lock.waitLock(20000);
    out = {ok:true, ...dispatch_(q)};
  } catch (err) { out = {ok:false, error:String(err.message || err)}; }
  finally { if (lock && lock.hasLock()) lock.releaseLock(); }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}
/** Retorna somente uma orientação pública, sem listar contatos ou expor a chave. */
function doGet() { return ContentService.createTextOutput('Bot Leads 2027. Configure a extensão do Firefox. Nenhum dado é fornecido por esta página.'); }

/** Executa diagnóstico de leitura com totais. Não envia mensagens nem altera status. */
function diagnosticarBot() {
  const r = dispatch_({action: "list"});
  console.log(JSON.stringify({version: r.version, spreadsheetId: r.spreadsheetId, sheet: r.sheet, disponiveis: r.candidates.length, ignorados: r.skipped.length, pendencias: r.pending.length}));
}

// Called only for an explicit WhatsApp number rejection, before any send attempt.
/** Registra rejeição explícita do número antes de qualquer clique e sincroniza Número Inválido sem sobrescrever um status externo. */
function markInvalid_(q, old) {
  if (q.numberRejected !== true) throw Error('Falta a confirmação do aviso de número não cadastrado.');
  if (old.state === 'invalid') return {record:publicRec_(old), updated:false};
  if (!['reserved','invalid_pending'].includes(old.state)) throw Error('Uma tentativa de envio iniciada não pode ser marcada como número inválido.');
  const rejected = save_({...old, state:'invalid_pending'});
  const row = findRow_(old.key, getRows_());
  if (row.phone !== old.phone) throw Error('O telefone da linha foi alterado.');
  const target = 'Número Inválido';
  let updated = false, warning = '';
  if (norm_(row.status) === 'novo lead') {
    const cell = sheet_().getRange(row.row, 7);
    const rule = cell.getDataValidation();
    if (rule && rule.getCriteriaType() === SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST && !rule.getCriteriaValues()[0].includes(target)) throw Error('Adicione Número Inválido à lista de status desta linha e sincronize novamente.');
    const cells = sheet_().getRange(row.row, 1, 1, 7).getDisplayValues()[0];
    if (digest_(JSON.stringify(cells.slice(0,6))) !== old.key || norm_(cells[6]) !== 'novo lead') throw Error('A linha foi editada durante a atualização. Tente sincronizar novamente.');
    cell.setValue(target); SpreadsheetApp.flush(); updated = true;
  } else if (norm_(row.status) !== norm_(target)) warning = 'O status alterado por outra pessoa foi preservado: ' + row.status;
  return {record:publicRec_(save_({...rejected,state:'invalid',row:row.row,warning})),updated,warning};
}
