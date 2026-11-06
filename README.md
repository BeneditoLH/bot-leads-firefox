# Bot de leads para Firefox

Extensão Firefox 1.0.3 com Google Apps Script 1.0.2. Fila por série, quantidade por execução, pausa, histórico e sincronização de status.

## Configuração
1. Crie sua própria planilha: aba `Leads 2027`, telefone na coluna E, interesse em F e status em G. Cadastre Novo lead, Primeiro Atendimento e Número Inválido na lista suspensa.
2. Em `google-apps-script/Code.gs`, substitua `CONFIGURE_SPREADSHEET_ID` pelo ID de sua planilha e `gid: 0` pelo identificador da aba. Em `extensao/panel.js`, ajuste os mesmos valores na verificação de origem.
3. Crie um projeto independente no Google Apps Script, cole Code.gs e execute configurarBot. Guarde a chave BOT_SECRET gerada nas propriedades do script; não a adicione ao código nem ao Git.
4. Publique como App da Web, executando como sua conta, com acesso Qualquer pessoa. As operações exigem a chave. Não publique a planilha.
5. No Firefox, abra `about:debugging#/runtime/this-firefox`, carregue temporariamente `extensao/manifest.json` e recarregue o WhatsApp Web.
6. No painel, configure URL /exec e chave. Marque as séries, escolha a quantidade e inicie.

A instalação temporária dura até reiniciar o Firefox. Instalação permanente requer assinatura Mozilla.

## Regras
Somente Novo lead entra na fila. Envio observado atualiza para Primeiro Atendimento. Aviso explícito de número não cadastrado grava Número Inválido e segue, sem consumir a quantidade. Timeouts não invalidam telefones. Seleção vazia não envia. Pendências de sincronização não reenviam automaticamente.

Não altere ou ordene a planilha durante a execução. O clique e o esvaziamento do editor não comprovam entrega/leitura. O WhatsApp pode alterar sua interface.

## Testes e privacidade
Execute `npm test` com Node.js 20+. Dados de teste são sintéticos e não devem ser usados para envio real. Não há contatos, planilhas preenchidas, credenciais ou URLs de implantação neste repositório. Não publique o histórico nem a chave. Os IDs e a identidade visual são genéricos; configure sua própria instalação.

A distribuição pública inclui testes unitários sem telefones nem dados financeiros. As configurações são marcadores genéricos e precisam ser preenchidas localmente.

## Documentação para desenvolvedores

- [Arquitetura e fluxo de execução](docs/ARQUITETURA.md)
- [Contribuição e validação](CONTRIBUTING.md)
- [Privacidade e armazenamento](PRIVACIDADE.md)

As funções principais possuem comentários no código explicando responsabilidades e limites. JavaScript nativo e APIs de extensão são usados em tempo de execução, sem etapa de compilação. Node.js é necessário apenas para testes.

## Solução de problemas

| Sintoma | Ação |
| --- | --- |
| Aba do WhatsApp não aparece | Abra no mesmo perfil do navegador e atualize a lista de abas. |
| Rascunho diferente | Guarde o texto existente antes de limpar o campo. |
| Atualização não aparece | Recarregue a extensão, a aba WhatsApp e o painel. |
| Tentativa incerta | Confira aquela conversa antes de liberar uma nova tentativa. |

## Licenciamento

Nenhuma licença de redistribuição foi definida nesta publicação. A disponibilidade pública do código não implica concessão de uma licença de software livre.
