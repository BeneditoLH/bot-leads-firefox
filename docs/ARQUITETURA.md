# Arquitetura e manutenção

## Responsabilidades

| Módulo | Responsabilidade |
| --- | --- |
| panel.js | Eventos de interface, estado visual, persistência e recuperação. |
| whatsapp.js | Adaptador isolado do DOM: leitura, validação e clique. |
| navigation-guard.js | Autorização breve de navegação, vinculada ao rascunho atual. |
| background.js | Abertura do painel pela ação da extensão. |
| engine.js | Validação e processamento sequencial com dependências injetadas. |
| transport.js | Comunicação com Apps Script e coordenação da aba WhatsApp. |
| google-apps-script/Code.gs | Autenticação, reservas, diário e escrita de status. |

## Ordem da operação

O painel seleciona itens elegíveis, prepara o contato, registra a tentativa, aciona o clique e observa o campo vazio. A atualização do histórico vem depois dessa observação. Não existe transação atômica entre WhatsApp e armazenamento: uma falha após o clique pode exigir revisão, nunca reenvio cego.

O adaptador deve permanecer autocontido porque é serializado e injetado na aba. Evite dependências externas ou variáveis de módulo dentro dele. Mudanças de seletores precisam distinguir carregamento, conversa incorreta e rascunho divergente.

## Recuperação

Preserve o histórico ao atualizar. Não renomeie registros ou apague o diário para forçar reenvios. O controle é de tentativas, não de entrega ou leitura. Pause antes de fechar o painel; o processo depende da página aberta.

## Testes

`npm test` executa os testes unitários distribuídos. Eles não acessam WhatsApp nem Google e não cobrem toda a integração real. Mudanças no envio devem ser verificadas em conta e destinatário de teste autorizados, incluindo interrupção após o clique e recuperação sem duplicação.
