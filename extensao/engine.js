/* Sequential queue; dependency injection keeps irreversible send separate from sync. */
export const VERSION = '1.0.3';
/** Normaliza espaços e marcadores de lista para comparar o rascunho com o texto esperado. */
export function normalize(value) {
  return String(value ?? '').replace(/\r\n?/g,'\n').replace(/\u00a0/g,' ').replace(/[\u200b-\u200f\ufeff]/g,'').trim().replace(/^[ \t]*[-*•](?=[ \t]+\S)/gm,'-').replace(/\s+/g,' ');
}
/** Monta o convite usando o interesse informado na planilha, preservando seu texto. */
export function messageFor(interest) {
  return `Olá! Vi que você manifestou interesse no ${String(interest).trim()}. Gostaria de agendar uma visita para conhecer a escola?`;
}
/** Exige um limite inteiro de mensagens dentro da faixa permitida pelo painel. */
export function limitValue(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 1000) throw Error('Informe uma quantidade inteira entre 1 e 1000.');
  return n;
}
/** Confere telefone, interesse e correspondência do texto antes de reservar uma tentativa. */
export function validateLead(row) {
  if (!/^55[1-9]\d9\d{8}$/.test(row.phone) || !row.interest?.trim() || row.message !== messageFor(row.interest)) throw Error('Dados de contato ou mensagem inválidos. Atualize a lista.');
}
/** Processa itens sequencialmente com dependências injetadas. Persiste a tentativa antes do clique e separa envio de sincronização. */
export async function runQueue(rows, limit, d) {
  limitValue(limit);
  const summary = {sent:0, synchronized:0, invalid:0, paused:false};
  for (const row of rows) {
    if (summary.sent >= limit || d.paused()) { summary.paused=d.paused(); break; }
    validateLead(row);
    const requestId = d.uuid();
    const op = {phone:row.phone, key:row.key, requestId};
    let reserved=false, begun=false;
    try {
      d.show(row, 'Reservando lead');
      await d.api('reserve', op); reserved=true;
      await d.remember({...row,...op,state:'reserved'});
      const prepared = await d.prepare(row);
      if (d.paused()) {
        await d.api('cancel', op);
        await d.remember({...row,...op,state:'cancelled'});
        summary.paused=true; break;
      }
      if(prepared?.invalidNumber){
        // Durable rejection checkpoint; a lost status response must only be synchronized.
        begun=true;
        await d.remember({...row,...op,state:'invalid_pending',reason:prepared.reason});
        d.show(row, 'Número não cadastrado — atualizando o status');
        const result=await d.api('markInvalid',{...op,numberRejected:true});
        await d.remember({...row,...op,state:'invalid',reason:prepared.reason,warning:result.warning||''});
        summary.invalid++;
        d.show(row,result.warning||'Número Inválido — seguindo para o próximo contato',summary);
        continue;
      }
      d.show(row, 'Conferindo status antes do envio');
      // Persist uncertainty before begin: even a lost API response cannot permit a re-send.
      begun=true;
      await d.remember({...row,...op,state:'sending'});
      await d.api('begin', op);
      d.show(row, 'Enviando');
      const result = await d.send(row, prepared);
      if (!result?.clicked) {
        if (result?.clicked === false) {
          await d.api('notClicked', {...op,confirmedNoClick:true});
          await d.remember({...row,...op,state:'cancelled'});
        }
        throw Error(result?.reason || 'Resultado do clique desconhecido. Confira a conversa antes de liberar este telefone.');
      }
      summary.sent++;
      await d.remember({...row,...op,state:'clicked'});
      await d.settle(row, prepared);
      await d.remember({...row,...op,state:'sent'});
      d.show(row, 'Atualizando para Primeiro Atendimento');
      const sync = await d.api('complete', {...op,sendObserved:true});
      await d.remember({...row,...op,state:'done',warning:sync.warning || ''});
      summary.synchronized++;
      d.show(row, sync.warning || 'Primeiro Atendimento — concluído', summary);
    } catch (error) {
      if (reserved && !begun) {
        try { await d.api('cancel', op); await d.remember({...row,...op,state:'cancelled'}); } catch (_) { /* reservation expires; no send happened */ }
      }
      error.summary=summary; throw error;
    }
  }
  return summary;
}
