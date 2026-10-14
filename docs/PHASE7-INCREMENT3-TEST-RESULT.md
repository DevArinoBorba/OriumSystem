# Fase 7 — Incremento 3: verificação da coordenação

Estado: ACEITO EM TEST pelo Codex #2 em 13/10/2026. Browser/DEV continuam gates posteriores. Antigravity ficou preso em leitura por mais de dez minutos sem alterar os arquivos; sua execução foi interrompida e o CLI encerrado antes de Codex assumir demands.ts/notifications.ts. Não houve edição concorrente.

## Implementação

notifications-producer.ts determina destinatários ativos por papel e grants atuais, exclui autor e usa o UUID real do evento, preservando primeira criação/leitura com ON CONFLICT DO NOTHING. As 18 inserções de auditoria das mutações e cascata em demands.ts passaram pelo helper recordDemandEvent no mesmo PoolClient antes COMMIT. Falha de persistência reverte a mutação e evento. Capturas explícitas de status anterior distinguem transições reais de requisitos/dependências; edição de demanda compara campos anteriores sob lock.

notifications-calendar.ts usa data civil America/Cuiaba; GET materializa somente a caixa pessoal após autorização. Predicado temporal uniforme em items/total/unreadCount/read elimina avisos atualmente inaplicáveis, preservando origem/leitura no banco. Relógio injetável é opção privada de serviço, nunca HTTP e nunca relógio de autenticação. Sem cron ou backfill.

## Execuções reais

PORT_POLICY lida, Find-FreePort executado para 5433 e container reutilizado somente após comprovar compose orium-local, serviço postgres-test e diretório deste projeto. Lease alternativa c92d37f9-e993-4db6-993f-f32cafc06424 liberada após testes. Nenhum DEV alterado nesta janela.

- Vitest sequencial geração + calendário: **11/11 PASS**, 2 arquivos, exit 0, início local 21:01:04, duração 10,68 s.
- Vitest sequencial fundação + demands-authorization + demands: primeira rodada **79 PASS/2 FAIL**, exit 1. Somente duas expectativas da fundação precisavam incorporar o aviso task_assigned real; as **56 regressões passaram**.
- Fundação corrigida: **25/25 PASS**, exit 0, início local 21:02:19, duração 6,85 s. Paginação exige 6 total/5 unread incluindo atribuição real; ordenação compara explicitamente os eventos de demanda. Datas da fixture deslocadas para 2099 para evitar materialização temporal acidental conforme envelhece o teste.
- Resultado final pertinente: **92 casos aprovados** (11 novos + 25 fundação + 56 regressões). Falhas intermediárias preservadas neste relato.
- ESLint focal produto/módulos/suites e recheck da fundação: exit 0.
- API typecheck e root tsc: exit 0 após ligação. Erros intermediários de HTTPMethods no helper e assinatura do relógio em implementação foram corrigidos.
- Build API único: exit 0; build web único: exit 0, Vite 122 módulos.

## Higiene

Artefatos .local/phase7/increment3/tests/generation-cleanup.json e calendar-cleanup.json verificam igualdade completa dos 23 grants e fingerprints de identity_event/identity_event_subject antes/depois, ambos com baseline atual 449 registros. Sete contagens de resíduos próprias zeradas. Não apagar histórico não rastreado para voltar ao baseline histórico 397 do Incremento1.

Regressão demands recebeu cleanup cirúrgico da auditoria dos usuários próprios antes da remoção das contas, via migrator TEST/IDENTITY_LOCK, evitando novos órfãos sem tocar histórico anterior. Nenhuma conta ou dado DEV foi usado como fixture.

## Pendências

QA browser executa janela exclusiva TEST após correções do runner, evidência real de teclado, contagens atuais, estados e capturas. Codex revisa imagens/resultados. Ativação DEV e encerramento somente após esses gates.
