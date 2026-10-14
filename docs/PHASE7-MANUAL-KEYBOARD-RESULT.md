# Relatório de Homologação Manual de Teclado e Teardown Cirúrgico — Fase 7 (Central de Notificações)

- **Data:** 2026-10-14
- **Responsável pelo Teste:** Usuário / Responsável
- **Coordenação:** Codex
- **Execução e Telemetria QA:** Antigravity QA
- **Status:** **HOMOLOGADO COM ACEITE MANUAL DO RESPONSÁVEL — TEARDOWN CIRÚRGICO CONCLUÍDO (0 RESÍDUOS, BASELINE PRESERVADO)**
- **Preservação de Histórico:** O resultado FAIL automatizado do runner em `phase7-browser-run.json` permanece preservado sem regravação arbitrária (a limitação técnica de injeção `SendInput` no canvas Maestri segue registrada honestamente).

---

## 1. Aceite Manual Soberano do Responsável

A homologação da navegação e acionamento por teclado físico da Central de Notificações foi conferida e atestada diretamente pelo responsável:

> **"sim perfeitamente apos roteiro clicarTodos/Tab->Nao lidos/Enter->15/ShiftTab->Todos/Espaco->lista completa"**

O fluxo físico completo executado pelo responsável consistiu em:
1. Foco inicial no botão **Todos**;
2. Pressionamento de <kbd>Tab</kbd> avançando o foco visual e nativo para o botão de filtro **Não lidos**;
3. Pressionamento de <kbd>Enter</kbd> ativando o filtro, reduzindo a lista para as 15 notificações não lidas;
4. Pressionamento de <kbd>Shift</kbd> + <kbd>Tab</kbd> retornando o foco para o botão **Todos**;
5. Pressionamento de <kbd>Espaço</kbd> reativando o filtro geral e restaurando a lista completa com as 25 notificações (Página 1 de 2).

---

## 2. Telemetria e Limitações de Artefato

### 2.1 Evidência Observada em Tempo Real (Tool Step 1686 / Inspeção Diagnóstica)
Antes da execução do teardown, uma consulta diagnóstica direta via `maestri portal evaluate` em `window.__manualKeyboardAudit` registrou:
- **22 eventos de teclado físicos (`isTrusted: true`):**
  - Sequência de teclas: `Tab` (x6), `ShiftLeft` + `Tab` (x2), `Tab` (x1), `Enter` (x1);
  - Modificador `shiftKey: true` nos eventos de Shift+Tab;
  - Alvo e foco documentados entre os botões `Todos`, `Não lidos`, `Abrir tarefa`, `Abrir chamado` e `Tentar novamente`.
- **Mutação no DOM registrada na captura intermediária:**
  - Botão de filtro com `aria-pressed="true"` transitou de `"Todos"` para `"Não lidos"`, com foco ativo em `BUTTON.filter-button (Não lidos)`.

### 2.2 Limitações de Telemetria e Registro Honesto
1. **Snapshot Intermediário do DOM:** Naquele instante da captura intermediária, a contagem de itens na lista permanecia em 20 (`Página 1 de 2`), pois o re-render da lista ainda estava em curso.
2. **Continuidade do Roteiro:** O acionamento da tecla <kbd>Espaço</kbd> e o retorno completo à lista de "Todos" ocorreram na sequência da interação humana do responsável; esses passos finais são atestados soberanamente pela confirmação literal do responsável, não constando no snapshot intermediário de telemetria.
3. **Sobrescrita do Artefato na Segunda Execução:** Na primeira tentativa de teardown, o script falhou por ausência de variáveis de ambiente (`.env`). Na segunda tentativa, o portal já havia sido redirecionado para a URL de restauração (`chrome-error://chromewebdata/` / DEV), de modo que o arquivo gerado [`.local/phase7/manual-keyboard/manual-keyboard-result.json`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/.local/phase7/manual-keyboard/manual-keyboard-result.json) gravou `auditLogs: null`. Uma cópia de segurança efetuada após essa etapa também registrou o arquivo pós-sobrescrita (1.813 bytes). **Nenhum arquivo JSON de primeira captura foi fabricado ou forjado**; a confirmação humana é a evidência soberana e primária, e os 22 eventos `isTrusted` constam no log de diagnóstico do coordenador e do tool step 1686.

---

## 3. Teardown Cirúrgico e Conferência de Baseline

O script [`.local/phase7/manual-keyboard/capture-and-cleanup.mjs`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/.local/phase7/manual-keyboard/capture-and-cleanup.mjs) executou a desmobilização com guardas rigorosas e sem asserções tautológicas:

1. **Processos e Listeners:**
   - Comprovação e encerramento independente do processo API TEST (PID `20900`) e Web TEST (PID `28148`).
   - Listeners nas portas `3100` e `5180` verificados como não ouvintes (`isPortListening: false`).
   - Leases de portas liberados via `Find-FreePort.ps1`.
2. **Restauração do Portal:**
   - Portal `Orium - Codex visivel` restaurado para `http://127.0.0.1:5173` sem encerramento da janela.
3. **Limpeza Cirúrgica de Fixtures sob `IDENTITY_LOCK`:**
   - Exclusão cirúrgica restrita aos IDs registrados na sessão (`registry.userIds`, `registry.clientIds`, `registry.demandIds`, `registry.taskIds`, `registry.demandEventIds`, `registry.notificationIds`).
   - **0 resíduos comprovados em `orium_test`:** `users: 0`, `notifications: 0`, `sessions: 0`, `demands: 0`, `tasks: 0`, `clients: 0` (`isClean: true`).
4. **Conferência Não-Tautológica de Baselines:**
   - **Grants (`role_permission`):** O conjunto atual de 23 grants foi comparado contra o fingerprint canônico pós-migração derivado do último checkpoint de recovery ([`tests/recovery.integration.test.ts`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/tests/recovery.integration.test.ts)):
     - SHA-256 esperado e obtido: `9673b3ccf9d31ad30177ad4ba3ed1a7bbb62ef1cd2385d9827d3599c3c96195a` (23 grants ativos, match: `true`).
   - **Auditoria de Identidade:**
     - `identity_event`: **540 eventos** preservados (hash da sessão: `becaf0c9fffcece6f379cbdf251c83176406fd420d0e6905e6a46bab9fd2325e`, hash completo: `7db771da9b768b8979654239438c3e1bfdad132c9fb541674ef583f20f63642e`).
     - `identity_event_subject`: **540 registros** preservados (hash: `574abfee0a5d287f423643d5792c3f3ed1f71cd4760b3033290e0dced40fdb4f`).
5. **Ajuste para Execuções Futuras:**
   - O helper [`prepare-manual-keyboard.mjs`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/.local/phase7/manual-keyboard/prepare-manual-keyboard.mjs) foi atualizado para persistir o array integral `baselineGrants` dentro de `sessionData` no início da preparação, eliminando qualquer dependência de contagens isoladas em execuções subsequentes.

---

## 4. Conclusão

- A superfície de notificações cumpriu todos os critérios funcionais e de acessibilidade física por teclado, com aceitação humana homologada pelo responsável.
- O ambiente `orium_test` e as portas de teste estão completamente limpos e liberados.
- DEV permanece íntegro para a revisão final e encerramento da Fase 7 pela coordenação (Codex).
