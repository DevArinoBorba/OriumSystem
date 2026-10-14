# Relatório e Planejamento de Validação CLI — Fase 1 (Fundação)

**Documento Oficial de Garantia da Qualidade (QA)**  
**Escopo**: Validação Funcional, de Segurança e de Concorrência da Linha de Comando (Bootstrap e Recuperação Administrativa)  
**Conformidade**: [ADR-0007](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/docs/adr/0007-politicas-fundacao.md), [PROJECT_CONTEXT.md](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/PROJECT_CONTEXT.md), [ROADMAP.md](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/ROADMAP.md) e [PHASE1-RECOVERY.md](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/docs/PHASE1-RECOVERY.md).  
**Validador Exclusivo**: Antigravity QA  

---

## 1. Princípios e Regras Inegociáveis (Revisão Root)

1. **Terminal ConPTY Nativo e Real via Maestri**:
   - Rejeição absoluta de shims, fakes ou monkeypatches de `process.stdin.isTTY` e `setRawMode`.
   - A execução interativa de `pnpm db:bootstrap` e `pnpm db:recover` ocorre em um terminal Shell dedicado no canvas do Maestri (`QA Entrada`), provisionado pelo root diretamente com `node --env-file=.env .local/phase1-cli-runner.mjs`.
   - A automação interativa é conduzida pelo controlador `.local/phase1-cli-controller.mjs`, que envia entradas raw (`maestri ask "QA Entrada" --raw ...`) aguardando cada prompt em tela (`maestri check`) sem colar entradas em lote.
2. **Isolamento Rígido no Banco de Testes**:
   - As execuções de CLI apontam exclusivamente para o banco de teste (`DATABASE_URL=TEST_DATABASE_URL`).
   - Validação prévia mandante: protocolo `postgresql:` ou `postgres:`, loopback (`127.0.0.1`, `localhost`, `[::1]`), base `/orium_test` e usuário `orium_app`.
   - O usuário de conexão atende a `assertApplicationDatabase` (proibição estrita de superusuário, sem bypass de RLS e privilégios mínimos).
3. **Proteção Total de Segredos e Senhas em Memória**:
   - Nenhuma senha real ou fixture é impressa em tela, gravada em disco ou passada por argumentos de processo (`process.argv`) ou variáveis de ambiente.
   - As contas reais (`arinoborba@gmail.com` e `moniquiborges_5@gmail.com`) **NÃO** são utilizadas em testes automatizados nem cadastradas por agentes; aguardam o provisionamento definitivo pelo usuário humano em sessão local após homologação completa.
   - Todas as senhas de teste são geradas em memória volátil com alta entropia (mínimo de 32 a 36 caracteres hexadecimais).
4. **Preservação de Dados e Limpeza Cirúrgica em Bloco `finally`**:
   - O banco de teste deve possuir 0 usuários antes do bootstrap. Registros desconhecidos preexistentes jamais são apagados em lote.
   - Qualquer fixture criada durante os testes é rastreada por seus identificadores únicos (IDs) e removida cirurgicamente no bloco `finally`, garantindo a restauração do banco a 0 usuários mesmo em caso de falha.

---

## 2. Matriz de Casos de Teste — CLI Bootstrap

| Caso | Cenário / Entrada | Comportamento Esperado | Critério de Aceite |
| :--- | :--- | :--- | :--- |
| **BT-01** | **Pré-condição e Privilégios Mínimos** | Verificar que `TEST_DATABASE_URL` aponta para `127.0.0.1`, `/orium_test`, usuário `orium_app`, e que o banco possui 0 usuários. | Conexão válida, `assertApplicationDatabase` aprovado, contagem inicial = 0. |
| **BT-02** | **Cancelamento via Ctrl+C (`\x03`)** | Durante a digitação da senha oculta de Arino, enviar byte de interrupção (`\x03` / SIGINT). | O processo aborta com erro `Entrada cancelada.`, transação sofre `ROLLBACK`, e o banco permanece com 0 usuários. |
| **BT-03** | **Confirmação Incorreta de Senha** | Informar senha válida e confirmar com valor divergente. | O processo rejeita com `Confirmação não corresponde.`, nenhum usuário é persistido no banco (0 usuários). |
| **BT-04** | **Bootstrap Bem-Sucedido (ConPTY Real)** | Fornecer 2 e-mails fixture com UUID e senhas aleatórias (min 12 chars), com confirmação idêntica. | Transação comitada sob `IDENTITY_LOCK`. Criados exatamente 2 usuários em `auth_user`, 2 credenciais em `auth_account` com hash BetterAuth (scrypt via `node:crypto scrypt` confirmado em código) válido, e 2 papéis em `user_role` como `administrator`. |
| **BT-05** | **Bloqueio em Banco Ocupado** | Tentar executar o bootstrap novamente com o banco já contendo usuários. | Rejeição imediata antes de solicitar e-mails ou senhas (`Bootstrap somente em banco sem usuários; não é recuperação.`). Nenhuma credencial solicitada. |
| **BT-06** | **Limpeza Cirúrgica de Fixtures (finally)** | Excluir exclusivamente os IDs criados no caso BT-04. | O banco de teste retorna a 0 usuários limpos. |

---

## 3. Matriz de Casos de Teste — CLI Recovery

| Caso | Cenário / Entrada | Comportamento Esperado | Critério de Aceite |
| :--- | :--- | :--- | :--- |
| **RC-01** | **Reautenticação Inválida** | Administrador informa senha incorreta na reautenticação. | Aborta com `Falha na autenticação do administrador autorizador: senha incorreta.`. Nenhuma alteração no alvo. |
| **RC-02** | **Autorizador sem Papel de Administrador** | Usuário com papel `collaborator` tenta autorizar recuperação. | Aborta com `Administrador autorizador não possui papel administrator e permissão roles.manage.`. |
| **RC-03** | **Conta Alvo Inexistente ou Inativa** | Administrador válido tenta recuperar e-mail não cadastrado ou com `active = false`. | Aborta com `Conta alvo não encontrada.` ou `Conta alvo inativa. Recuperação não reativa contas.`. |
| **RC-04** | **Recuperação Bem-Sucedida e Revogação Atômica de Sessões** | Administrador válido recupera conta alvo. A conta alvo possui sessões ativas prévias em `auth_session`. | Hash atualizado na transação sob `IDENTITY_LOCK`. Todas as sessões da conta alvo são excluídas (`DELETE FROM auth_session`). Emite recibo JSON com `action: password_recovery`, `actorId`, `targetId`, `revokedCount`. Nova senha valida login; senha antiga é rejeitada. |
| **RC-05** | **Limpeza Cirúrgica de Fixtures de Recuperação** | Exclusão pontual dos usuários de teste criados para o teste de recuperação. | Banco permanece íntegro e limpo. |

---

## 4. Arquivos e Componentes de Execução

- **Runner Local**: `.local/phase1-cli-runner.mjs` — executa diretamente o CLI oficial sob verificação estrita de URL, loopback e role `orium_app`.
- **Controlador Interativo**: `.local/phase1-cli-controller.mjs` — orquestra as sessões interativas no terminal real ConPTY `QA Entrada` via comandos Maestri sem expor credenciais.
- **Evidências Geradas**: `.local/phase1-cli-results.json`.

---

## 5. Resultados e Evidências da Execução ConPTY Real (2026-10-05)

Execução realizada no terminal nativo **`QA Entrada`** (ConPTY real, `process.stdin.isTTY = true`), sem shims nem monkeypatches.

| ID | Caso de Teste | Status | Detalhes da Execução / Asserções |
| :--- | :--- | :---: | :--- |
| **BT-01** | Estado Inicial do TestDB e Privilégios Mínimos | **PASS** | Banco de testes `/orium_test` verificado com contagem zero (`auth_user: 0`), loopback local, protocolo `postgresql:` e usuário `orium_app` aprovado em `assertApplicationDatabase`. |
| **BT-02** | Cancelamento via Ctrl+C no Hidden Password | **PASS** | Interrupção por sinal (`\x03`) durante a digitação oculta resultou em `Entrada cancelada.`, rollback transacional atômico e `auth_user: 0`. |
| **BT-03** | Rejeição de Confirmação Incorreta de Senha | **PASS** | Divergência entre senha e confirmação resultou em `Confirmação não corresponde.`, término imediato e `auth_user: 0`. |
| **BT-04** | Bootstrap Concluído com Sucesso (2 Admins) | **PASS** | 2 contas fixture criadas sob `IDENTITY_LOCK`. Hashes BetterAuth (scrypt via `node:crypto scrypt`) verificados via ESM (`verifyPassword: true`). Papéis `administrator` atribuídos a ambas as contas. |
| **BT-05** | Recusa de Bootstrap em Banco Ocupado | **PASS** | Rejeição imediata antes de solicitar credenciais: `Bootstrap somente em banco sem usuários; não é recuperação.`. Nenhum prompt de e-mail/senha foi exibido. |
| **RC-01** | Reautenticação Falha na Recuperação (Senha Incorreta) | **PASS** | Administrador informou senha errada; abortou com `Falha na autenticação do administrador autorizador: senha incorreta.`. Nenhuma alteração na conta alvo. |
| **RC-04** | Recuperação Válida com Revogação Atômica de Sessões | **PASS** | Recuperação autorizada com sucesso. Emissão de recibo estruturado JSON (`action: password_recovery`, `revokedCount: 1`). Sessões ativas em `auth_session` revogadas atomicamente (1 -> 0). Nova senha autenticada; senha antiga desativada. |
| **BT-06** | Limpeza Cirúrgica de Fixtures (finally) | **PASS** | Remoção exclusiva dos IDs criados durante o teste (`ownedUserIds`). Banco restaurado a exatamente `auth_user: 0`, preservando integridade. |

**Resumo da Bateria**: 8 casos executados, **8 aprovados (100%)**, 0 falhas.  
Evidência estruturada persistida em [`.local/phase1-cli-results.json`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/.local/phase1-cli-results.json).

