# Privacidade e dados locais

A distribuição contém somente código, documentação e testes genéricos. Cada instalação deve fornecer sua própria configuração. Não há servidor do desenvolvedor nem telemetria implementada.

O painel pode armazenar contatos, textos e histórico no perfil do navegador durante o uso. Exportações e diagnósticos podem conter esses dados: não os publique em issues ou commits. A versão com Apps Script também mantém um diário na planilha configurada e exige uma chave privada nas propriedades do projeto.

O .gitignore reduz inclusões acidentais, mas não remove arquivos já versionados. Revise o diff antes de publicar. Em caso de exposição de chave, substitua-a no projeto e no painel; apagar um arquivo do último commit não remove o histórico Git.
