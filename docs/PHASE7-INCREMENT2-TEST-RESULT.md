# Fase 7 — resultado real dos testes da central pessoal

Conclusão: Codex #2, 13/10/2026. Estado: ACEITO EM TEST. Suíte inicial OpenCode, correções intermediárias Antigravity; conclusão da concorrência/cleanup/cobertura pela coordenação após indisponibilidade dos agentes. Sem ativação DEV.

- Vitest real orium_test: 25/25 PASS, zero skips, exit 0, rodada 20:44:04 local, 4,62s. Comando: node --env-file=.env node_modules/vitest/vitest.mjs run tests/notifications.integration.test.ts.
- ESLint focal da suíte e módulos novos: exit 0.
- pnpm exec tsc -p tsconfig.json --noEmit: exit 0.
- pnpm --filter @orium/api typecheck: exit 0.
- Regressão anterior 73/73 permanece evidência do implementador; não foi repetida neste gate sem mudança de produto que a justificasse.

Cobertura: schemas/inputs/body obrigatório/vazio real/projeção/ordenação/paginação; caixa pessoal e atribuição atual; terceiros em demanda compartilhada e vínculos task/demand incoerentes, inclusive admin; leitura idempotente/concorrente, Origin/JSON/headers; expiração/revogação/desativação/grants em voo; expiração natural depois do advisory/lock de sessão; sign-out real esperando pela sessão mantida pela central e revogando apenas a própria sessão; constraints/dedup/FKs/privilégios e exclusão temporal provisória.

PORT_POLICY/checker aplicados; orium-local-postgres-test-1 confirmado por labels projeto/diretório/serviço. TEST reutilizado sem listener HTTP/reinício; leases próprios liberados. Nenhum mock ou fallback de produto.

Artefatos .local/phase7/increment2/tests/fixture-ids.json e cleanup-report.json: grants/fingerprints de identity_event/subjects preservados, 23 grants e 449 eventos/subjects antes/depois; todas as oito contagens de resíduos próprios zero. 397 era a contagem da rodada histórica anterior, não baseline atual; nenhum histórico não rastreado foi removido para forçá-la. Suíte anterior preservada para continuidade.

Rodadas intermediárias falharam em fixtures/sincronização e foram corrigidas sem PASS antecipado. Destinatários administrativos confirmados pelo usuário. Geração/materialização, browser e ativação são gates posteriores, ainda não concluídos.
