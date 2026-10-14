# Fase 7 — preparação do runner browser

Codex #2, 2026-10-13. Dono: Antigravity QA. Objetivo: preparar runner executável de homologação da superfície de notificações contra a API real do Incremento2, sem executar nesta tarefa. A API ainda está sob correção/revisão; execução posterior exige aceite TEST e exclusividade no banco com OpenCode.

Ownership exclusivo: .local/phase7/browser/ (runner, helpers e artefatos próprios) e docs/PHASE7-BROWSER-PREPARATION-RESULT.md. Todos os demais arquivos READONLY, inclusive QA-PLAN do OpenCode, frontend, backend e suites. Aplicar AGENTS.md, docs/AGENT-AUTONOMY.md, skills maestri-portal e Impeccable quando aplicável à homologação da UI incumbente; não redesenhar nem alterar produto.

Reutilizar conhecimento do runner Fase5 por símbolos/trechos, sem copiar seus PASS ou executar o runner antigo. Planejar startup temporário próprio com PORT_POLICY/Find-FreePort, bind local, configuração/Origin/proxy coerentes e prova de propriedade; somente orium_test, sem configuração/serviços/dados DEV. Capturar/restaurar URL e viewport originais do portal visível Orium - Codex visivel, sem fechar portal. Nenhum startup, banco, suite, build, migration, fixture ou navegação browser nesta preparação; checks de sintaxe são apenas sintaxe.

Casos executáveis: login/aba não inicial/caixa pessoal; contador acessível; Todos/Não lidos/paginação com totais exatos; ordem DESC/Cuiabá; abrir tarefa/chamado sem POST read e destino DOM real; marcar lida explícito/idempotência/request único; 401/403/404 verdadeiros e limpeza de estado/contador; erro/retry; foco e atualização silenciosa; desktop/mobile sem overflow e capturas válidas; teclado nativo e console. Backend usa persistência sem geração automática de avisos neste incremento: inserir fixtures próprias via migrator exclusivamente TEST para avaliar a superfície, sem mock/fallback em produto e sem declarar geração operacional concluída.

Wrappers portal evaluate devem recusar stdout Error/error mesmo com exit 0; em falha Maestri executar debug primeiro. Assert DOM e resposta real, não somente exit code. Sem ponte artificial keydown→click; limitações de teclado/captura são FAIL/LIMITAÇÃO honestas, não PASS. Capturas persistidas com validade/hash para posterior inspeção da coordenação.

Runner inclui teardown incondicional: drenar requests, remover somente fixtures e identity_event/subject próprios, preservar grants/histórico anteriores, comprovar resíduos zero, parar somente processos próprios, liberar somente leases próprios e restaurar portal/viewport. Falha de startup também executa teardown. Segredos jamais nos relatórios/capturas/logs.

Registrar início, evidências e conclusão exclusivamente na seção Antigravity QA de oriumsystem-acompanhamento. Reportar arquivo/syntax check e dependências sem PASS de execução. Avisar Codex #2 via helper sem esperar resposta. A execução será atribuída por checkpoint posterior; não iniciar quando apenas terminar de escrever runner.
