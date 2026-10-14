# Retomada 14/10/2026 — revisão Codex

## Entregas

Inventário OpenCode aceito como levantamento READONLY de artefatos, distinguindo publicação VPS relatada de verificação independente. ROADMAP e nota oficial reconciliados. Revisão browser atualizada: 15 PASS/1 FAIL de teclado, com limites de BR09 preservados. Nenhuma publicação, restart ou migração DEV executados nesta retomada.

Correção focal de recuperação revisada em `tests/recovery.integration.test.ts`: senha vazia/129 caracteres rejeitadas sem alteração de hash/sessões; senha curta válida recupera acesso e revoga sessões anteriores. Cleanup usa migrator TEST e IDENTITY_LOCK, rastreia usuários próprios incluindo lote concorrente, remove apenas auditoria ligada a esses IDs e preserva o rastreio até commit. Restauração de roles.manage depende de DELETE RETURNING, sob lock. Fingerprint usa todas as colunas de eventos e sujeitos.

QA reporta rodada final iniciada 07:35:07: 16/16 PASS, exit0, duração61,05s; lint e root tsc aprovados. Assertions no teardown comparam grants e fingerprints completos com baseline pós-migração. Relatório: `docs/RESUME-2026-10-14-AUTH-TEST-RESULT.md`. Não repetir suíte verde sem novo motivo.

## Limite de higiene

A primeira rodada de recovery, antes da correção do cleanup, passou16 casos e verificou apenas usuários/sessões. O histórico TEST passou de449 eventos/sujeitos da rodada browser para540 no baseline final de recovery. Portanto não afirmar preservação do baseline449 ao longo de toda esta retomada nem zero resíduos históricos globais. A nova rodada prova preservação do baseline540 pós-migração, com23grants e usuários próprios zerados. Histórico não rastreado foi preservado; não apagar eventos antigos para fabricar retorno ao baseline449. Aceite focal dos testes corrigidos não encerra a Fase7.

## Continuidade

Resolver gate de teclado com evidência desta superfície ou decisão de aceite qualificado conforme contrato, mantendo FAIL explícito. Depois ativação DEV com backup/snapshot/migration e verificação independente. Publicação VPS relatada não substitui DEV; login real, Monique, registro Coolify, backup externo/restauração e monitoramento continuam pendentes. Nenhuma integração Bitwarden comprovada.
