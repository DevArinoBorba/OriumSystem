# Fase 7 — Incremento 2: revisão independente

Codex #2, 2026-10-13. Estado atual: ACEITO EM TEST após execução real da coordenação (25/25, zero skips) e inspeção das correções. Sem ativação DEV. Achados iniciais preservados abaixo.

## Gate da coordenação

Codex #2 assumiu os casos complexos de concorrência e teardown após indisponibilidade da sessão Antigravity; nenhum Vitest estava ativo, e a suíte salva foi preservada em .local/phase7/increment2/notifications-before-codex.ts. Corrigidos drain incondicional, restauração pós-resposta, contexto interno real para expiração depois de advisory/espera da sessão, sign-out da sessão correta preservando outras sessões e fixtures com cookies válidos/recipientes dedicados. Adicionados tarefa de terceiro no chamado compartilhado e vínculo task/demand incoerente inclusive na caixa administrativa.

Execução real final: node --env-file=.env node_modules/vitest/vitest.mjs run tests/notifications.integration.test.ts, 25/25 PASS, exit 0 (20:44:04 local), zero skips. Lint focal, API typecheck e root tsc --noEmit exit 0. Correções backend clock pós-lock, limites inclusivos, exclusão temporal provisória e body obrigatório confirmadas no código. Rodadas intermediárias falharam e foram corrigidas; não foram aceitas como verdes.

cleanup-report.json demonstra grants/fingerprints de histórico iguais antes/depois e oito contagens de resíduos próprios zero. Baseline atual: 23 grants e 449 eventos/subjects; a contagem histórica 397 do Incremento1 não foi forçada apagando histórico não rastreado. Remoção transacional apenas dos IDs, eventos/subjects e grants próprios. Sem mocks/fallback ou listener HTTP; TEST identificado por labels de container/diretório e política de portas aplicada.

Aceite libera Incremento3 conforme contrato. Não comprova geração operacional, homologação browser ou ativação DEV.

## Backend — Antigravity

1. Em listNotifications e markNotificationAsRead, clock_timestamp é projetado no mesmo SELECT FOR SHARE. A projeção pode acontecer antes da espera por lock; o contrato exige lock da sessão primeiro e validação temporal em comando subsequente no mesmo client. Separar aquisição de lock e validação de todos os campos atuais (usuário/active/expiração absoluta/inatividade), usando clock_timestamp depois da espera. O limite de sete dias/doze horas deve negar também igualdade, em conformidade com authenticate, que exige datas estritamente posteriores ao limite.
2. As quatro queries de visibilidade aceitam qualquer aviso de calendário cujo prazo não tenha mudado. Isso não verifica hoje/+3 dias/status/início/pausa/conclusão. Para esta fundação, aplicar a alternativa já autorizada pelo contrato: excluir explicitamente os quatro kinds temporais em listagem, total, unreadCount e POST até o incremento de materialização. Não declarar filtro temporal atual implementado por comparar somente source_delivery_date. Manter schema/dedup temporal para futura implementação.
3. A rota POST read substitui body ausente por {} antes do parser. O contrato exige corpo strict {} obrigatório. Validar request.body diretamente e rejeitar ausência, null, array e campos extras. O teste deve usar um UUID/aviso válido para não aprovar o parser de corpo apenas pelo erro do ID.

Preservar schema/migration, API pública e ownership. Não reiniciar/migrar DEV. Após correção, informar checkpoint estável ao OpenCode; não rodar suites concorrentes.

## Suíte — OpenCode

1. Os testes de expiração/revogação/desativação/grants aguardam pending dentro do try antes de liberar o advisory no finally. Essa ordem impede a resposta de concluir. Declarar promises fora do try, lançar/confirmar fila/aplicar alteração, liberar holder em finally, drenar promises com Promise.allSettled e só então verificar respostas. No teste de grants, cookieFor deve acontecer antes de adquirir IDENTITY_LOCK, pois login também usa esse advisory.
2. O teste de sign-out atual apenas mantém um lock manual do migrator, sem executar a central; sign-out pode esperar no UPDATE de authenticate antes de chegar ao DELETE. Não comprova que o serviço notification mantém o lock da sessão. Exercitar POST read real bloqueado em uma linha notification da fixture; observar backend específico que possui advisory e lock da sessão e espera pelo holder do aviso; iniciar sign-out e demonstrar espera pelo PID do backend real. Liberar holder e drenar ambas as operações, verificar leitura/saída e sessão removida. Se ordem de requests não estiver estabelecida, não aceitar arbitrariamente 200 ou 401 como prova do cenário.
3. Cobrir espera na linha da sessão após aquisição do advisory com expiração natural durante a espera (deadline curto controlado na sessão privada já autenticada, sem mocks). Usar clock_timestamp do banco e barreiras reais para demonstrar que o serviço não usa horário anterior à espera. Não confundir expiração antes do advisory com este caso.
4. Cobrir exclusão dos quatro kinds temporais na fundação e manter testes das constraints/dedup; não retirar checks de segurança para acompanhar comportamento defeituoso. Em cada negativa, verificar readAt intacto. Testar tanto GET quanto POST para revalidação de sessão/grants relevante.
5. O afterAll atual remove auth_user sem limpar identity_event/identity_event_subject das fixtures criadas por provisionUser; essas tabelas preservam histórico sem FK para usuário. Restaurar grants próprios também no teardown incondicional, remover exclusivamente eventos/subjects vinculados aos IDs rastreados e comparar baseline de grants/histórico antes/depois. Produzir artefato de cleanup com contagens de resíduos verificadas, não apenas comandos DELETE. Não remover histórico alheio nem resetar grants hardcoded.
6. O teste de corpo extra usa ID inválido, podendo passar sem verificar corpo strict. Separar inputs: aviso válido para corpo ausente/null/array/campo extra; ID inválido com corpo {}. Cobrir também tarefa de terceiro em demanda compartilhada e combinação tarefa/demanda incoerente destinada ao próprio ator (listas/counts/POST), além do simples aviso de outro destinatário.

### Verificação do WIP após transferência

Na primeira edição Antigravity, a restauração de active/grants ainda ocorre antes de drenar a requisição, criando corrida na negativa. Liberar holder, drenar, restaurar baseline em finally nessa ordem. A expiração curta é alterada em transação não comitada e o polling usa outra conexão, que observa o prazo antigo; além disso, chamar HTTP sob holder de sessão bloqueia primeiro no UPDATE de authenticate, não demonstra revalidação do serviço após advisory. Obter contexto confiável antes da fixture de espera e exercitar serviço real após deadline curto comitado, com barreira do PID que já possui advisory.

O filtro de espera com INNER JOIN pg_class e database no lock de transactionid descarta justamente essa espera (relation e database são nulos). Filtrar o banco pelo PID em pg_stat_activity, ou pelo advisory concedido no PID do serviço, mantendo pg_blocking_pids para o holder exato. Fonte primária consultada: [PostgreSQL — pg_locks](https://www.postgresql.org/docs/current/view-pg-locks.html), descrição das colunas e da espera de locks de linha. Não retirar a prova de banco atual; aplicar ao registro correto.

Executar apenas após checkpoint backend estável, respeitando PORT_POLICY e isolamento orium_test. Preservar baseline, cleanup rastreado e DEV. Relatar novos testes/regressões/exit codes e limitações reais; plano QA continua preparação até execução real.
