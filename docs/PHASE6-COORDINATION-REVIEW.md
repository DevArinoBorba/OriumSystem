# Fase 6 — revisão da coordenação

08/10/2026. Fase em andamento; não há encerramento ou integração externa.

## Incremento HTTP aceito

Codex examinou a alteração em `app.ts` e a versão final de `security-http.test.ts`. Cabeçalhos aplicados antes das guardas; constante interna, sem exportação criada apenas para teste. Preservados Origin/JSON, cookies, logger e sanitização de erros. O teste espelhando a constante foi substituído por resposta real de JSON malformado400. Antigravity reportou execução final8/8PASS, typecheck API e lint focal exit0 em `PHASE6-HTTP-RESULT.md`.

Os testes usam Fastify `app.inject` real com stub explícito restrito ao startup de banco; não provam integração PostgreSQL, autorização do cofre ou proteção do documento web. Não houve rerun de suítes verdes sem alteração pertinente.

## Ativação DEV aceita

Relatório `PHASE6-DEV-ACTIVATION.md` revisado: Find-FreePort aplicado, build API único, sem listener anterior3002 a encerrar; WEB5173 do próprio projeto reutilizado. Startup API com caminho absoluto, PID19884; persistência verificada pelo executor em invocação independente. Snapshot readonly reporta contagens/permissões/migrations preservadas e duas contas administrativas ativas com credenciais.

Verificação independente Codex: listeners3002/PID19884 e5173/PID26472 com caminho absoluto deste projeto; readiness3002=200; CSP, X-Frame-Options DENY, Referrer-Policy no-referrer e Permissions-Policy corretos. Proxy5173 `/api/v1/me`=401 com CSP/referrer corretos. Nenhuma migração ou credencial real usada pela coordenação. API permanece dependente da persistência do servidor de agentes.

## Decisões e pendências

Responsável escolheu Bitwarden oficial, referências somente administradores e hospedagem posterior. ADR0006/contexto/contrato/roadmap e nota contínua atualizados. Nenhuma instância, API do cofre ou autorização externa presumida.

Auditoria de identidade READONLY do OpenCode revisada após correção. Aceitos o inventário estático, a ausência de eventos persistentes de identidade e a retirada da generalização L2: `materials.ts` usa IDENTITY_LOCK e revalidateActor nas mutações; `demands.ts` usa revalidateActorInsideTransaction. Não há vulnerabilidade concorrente comprovada nem aceite de segurança concorrente baseado apenas nessa leitura.

Ressalva de coordenação para L2/T2: revalidar dentro de uma transação não prova, sozinho, exclusão de revogação posterior; é necessário examinar locks e ordem efetiva. Não exigir 401/403 para toda execução concorrente: uma mutação serializada antes da revogação pode legitimamente concluir. Testes futuros devem controlar a ordem e comprovar que uma revogação concluída antes da fronteira autorizada impede a escrita, preservando o caso inverso. Esta ressalva prevalece sobre a sugestão de erro universal no commit presente em T2.

Próximo contrato deve tratar auditoria e endurecimento independente do cofre, sem inventar retenção, MFA obrigatório ou bloqueio heurístico de textos. Referências e homologação externa dependem da instância futura. Pendências históricas da Fase4 preservadas.

## Incremento 2 contratado

Responsável confirmou leitura por administradores e pelo próprio usuário, com retenção12meses. Contrato `PHASE6-IDENTITY-IMPLEMENTATION-CONTRACT.md` publicado; implementação foi concluída pelo OpenCode após transferência explícita. Gravação transacional de ações administrativas, subjects históricos para leitura própria, grants app append-only e função de limpeza somente de expirados. Limpeza física oportunista e agendamento/backups posteriores explicitados. Aceite TEST concedido; migration DEV ainda não aplicada.

Revisão final: schemas estritos por ação e rotina SQL de retenção com search_path restrito examinados; serviço lê sob IDENTITY_LOCK e mantém microsegundos no cursor. Calendário impossível é rejeitado com 400. Verificações PostgreSQL reais estão nos relatórios de implementação e QA.

## Inventário de clientes

`PHASE6-CLIENT-AUTHORIZATION-REVIEW.md` examinado; assimetria estática confirmada em create/update/archive/restore: autorização na rota, serviços auto-commit sem ator/lock/revalidação. Sequência concorrente não foi executada; não há declaração de vulnerabilidade. Correção terá contrato separado após liberar ownership app.ts/testes. Nos testes futuros, login de conta inativa deve seguir o comportamento real da API (401 genérico), e escrita anterior à revogação pode concluir legitimamente; não copiar expectativas de erro universal ou status não confirmado do plano sugerido.
## Gate Codex — incremento 2 aceito

08/10/2026: revisão final concluída após transferência explícita ao OpenCode. `identity.ts`, `recovery.ts`, `app.ts` e `identity-audit.ts` estão integrados; cursor rejeita calendário impossível; contratos, schema e migration 0004 estão alinhados. Evidências reais: contracts build, API/web typecheck, API build e ESLint focal verdes; auditoria PostgreSQL 18/18 PASS; auth/recovery/RBAC 82/82 PASS; clients/demands/dashboard/materials 122/122 PASS. Cleanup próprio removeu 61 eventos/33 usuários, sem órfãos e com permissões restauradas.

O gate aceita somente o incremento 2 em TEST. Não autoriza migration, rebuild, restart ou substituição do processo DEV. Não inclui UI/browser, MFA, login audit, proteção heurística de textos, Bitwarden ou hospedagem externa. A retenção física continua oportunista, sem agendamento/backups de Fase10. A assimetria de autorização de clientes permanece inventário separado, sem vulnerabilidade declarada.

## Ativação DEV — aceita

Após backup e snapshot, migration 0004 foi aplicada ao `orium_dev` local. `PHASE6-DEV-ACTIVATION.md` registra backup, migration, grants, PID/caminho e snapshots antes/depois. Verificação independente confirmou API PID11204 persistente em 127.0.0.1:3002, readiness200, proxy5173 identity-events401 e dados/contas preservados. Nenhuma fixture DEV, reset, frontend/browser ou integração Bitwarden foi usada.
