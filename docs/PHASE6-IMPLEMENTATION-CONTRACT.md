# Fase 6 — Segurança e referências ao Bitwarden

Contrato Codex, 08/10/2026. Fase em andamento; este documento não declara implantação nem homologação.

## Decisões confirmadas pelo responsável

- Produto escolhido: **Bitwarden oficial**, substituindo a candidatura do Vaultwarden no ADR-0006.
- Hospedagem do Bitwarden oficial será feita **posteriormente**, conforme resposta do responsável nesta retomada. Não provisionar cofre nem presumir conta Cloud neste incremento; homologação externa fica pendente da instância futura.
- Somente administradores podem visualizar referências no OriumSystem. Atribuição de tarefa não concede acesso; concessão isolada de permissão a colaborador também não concede acesso.
- Preservar a fronteira do ADR-0006: apenas referências; nenhum valor de senha, token, TOTP, chave, sessão do cofre ou conteúdo de item no banco, API, logs ou frontend.
- Permissões dentro do Bitwarden são independentes: administrador do OriumSystem não recebe automaticamente acesso a coleções ou itens.

## Incremento 1 autorizado — proteção HTTP da API

Dono: Antigravity. Arquivos exclusivos: `apps/api/src/app.ts`, novo `tests/security-http.test.ts`, `docs/PHASE6-HTTP-RESULT.md`. Não editar frontend, contratos, schema, migrations ou configurações locais. Não compilar API enquanto outro dono tiver build ativo.

Adicionar proteção consistente às respostas da API: `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`. Preservar no-store/nosniff, cookies e guardas Origin/JSON. CSP da API não comprova proteção do documento web. HSTS pertence à implantação HTTPS; não ativar em HTTP local.

Aceite: verificar por `app.inject` real as respostas live200, rota inexistente404, mutação sem Origin403 e corpo oversized413; todos com cabeçalhos esperados e erros sem dados sensíveis. Os testes podem usar um stub explícito para a consulta de identidade do banco em startup, retornando `unsafe:false`; não apresentar isto como integração PostgreSQL. Não adicionar bypass ao código de produção. Nenhum servidor/listener necessário. Typecheck da API e lint dos arquivos alterados. Se houver serviços, aplicar PORT_POLICY/Find-FreePort antes, preservar dados e processos.

Aplicar `docs/AGENT-AUTONOMY.md`: implementar, diagnosticar, corrigir e verificar autonomamente no escopo; registrar início, evidências e conclusão exclusivamente na própria seção de `oriumsystem-acompanhamento` via note edit; resumo até dez linhas. Codex revisa código e evidências antes do aceite.

### Gate Codex do incremento HTTP

Código e teste final revisados em 08/10: constante interna aplicada antes das guardas, sem modificar autenticação, sessão ou tratamento sanitizado. Oito testes finais PASS reportados após revisão, incluindo JSON malformado400; typecheck e lint focal exit0. Aceite do incremento concedido, limitado à API e aos testes HTTP sem PostgreSQL. Não equivale ao encerramento da Fase6 nem à proteção do documento frontend.

Ativação DEV autorizada ao Antigravity: build API e substituição apenas do processo comprovadamente deste projeto, sem migrations/dados; aplicar PORT_POLICY/Find-FreePort, preservar configuração e conferir readiness200, cabeçalhos via API e proxy protegido401, persistência em invocação independente. Evidências em `docs/PHASE6-DEV-ACTIVATION.md` quando entregue; ativação ainda não comprovada neste gate.

## Incrementos seguintes — aguardam contrato complementar

Referências: entidade administrativa vinculada a cliente, schemas estritos, versionamento otimista, validação de vínculo e auditoria transacional. Sem campo livre de metadata/segredo. Listagem, detalhe e mutações exigirão administrador ativo revalidado no banco e permissão específica. Colaborador não verá presença, contagem ou histórico da referência, inclusive na timeline e dashboard. Não implementar ainda: formato e endereço do cofre precisam de verificação real.

URLs de abertura terão HTTPS e host configurado explicitamente após confirmação da instância/região; não aceitar links arbitrários, credenciais embutidas, links públicos de compartilhamento, parâmetros de sessão/token ou conteúdo de segredo. Nenhum fetch server-side ao cofre. A abertura será navegação direta com proteção de referer; não registrar como acesso comprovado ao item.

Auditoria de identidade, MFA e proteção de textos livres precisam de escopo próprio antes de implementação. Não criar detector que prometa ausência de segredos nem bloquear textos por heurística sem decisão. Não persistir senha, cookie, token, corpo de login, e-mail de tentativa inexistente, IP ou user-agent por conveniência.

## Dependências externas e critérios de conclusão

Necessários: instância/região do Bitwarden, formato real de referência, coleções e acessos de teste definidos pelo responsável, custódia/backup e política de MFA. Não pedir credenciais por chat. Usar dados de teste e autenticação pessoal no cofre quando disponível.

A documentação oficial diferencia Public API (membros, coleções, grupos, eventos e políticas) da Vault Management API, que requer servidor local do CLI. Nenhuma dessas APIs faz parte deste incremento: https://bitwarden.com/help/public-api/ e https://bitwarden.com/help/bitwarden-apis/ (consultadas em 08/10/2026).

Conclusão da fase exige testes de autorização administrativa/anti-IDOR, rejeição de campos secretos, auditoria e revogação concorrente, verificação browser no portal visível, prova real da abertura/autorização no Bitwarden e evidências de segurança dos incrementos aprovados. Preservar pendências da Fase4; não declarar integração ou publicação sem acesso real.
