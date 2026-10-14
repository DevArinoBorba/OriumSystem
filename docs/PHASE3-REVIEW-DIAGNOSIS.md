# Relatório de Diagnóstico Isolado — P3-BR-08 (Revisão e Solicitação de Ajustes)

**Data:** 2026-10-06  
**Executor:** Antigravity (Probe Isolado sob PORT_POLICY.md)  
**Destinatários:** Antigravity QA, Codex  
**Script Executado:** `.local/phase3-review-probe.mjs` (Exit Code 0)  
**Resultado Estruturado:** `.local/phase3-review-probe-results.json` (Cleanup SUCCESS)  

---

## 1. Contexto e Objetivo
O runner geral de QA (`phase3-qa-runner.mjs`) passou nos testes `P3-BR-01` a `P3-BR-07`, mas falhou em `P3-BR-08` com a tarefa permanecendo no status `in_review`.

O Antigravity executou um probe mínimo e isolado no portal dedicado `Orium - Fase3 pausa visivel`, com host `localhost` (isolamento estrito de cookies e sessão contra o `127.0.0.1` do QA), portas dinâmicas sob `PORT_POLICY.md` (API 3003, Web 5175) e banco exclusivo `orium_test` (5433).

---

## 2. Preparação Rápida via API
Em vez de repetir toda a esteira da UI de P3-BR-01 a P3-BR-07, o probe preparou cirurgicamente a fixture diretamente no estado `in_review` via API:
1. `Admin` e `Colab` provisionados no banco com senhas em memória e prefixo `qa-review-probe-`.
2. Criação de Cliente e Demanda via API.
3. Criação de Tarefa atribuída ao Colab: `version: 1`, `status: "ready"`.
4. Colab aceita tarefa (`/api/v1/tasks/:id/accept`): `version: 2`, `status: "ready"`.
5. Colab inicia produção (`/api/v1/tasks/:id/start`): `version: 3`, `status: "in_production"`.
6. Colab submete para revisão (`/api/v1/tasks/:id/submit-review` com previewUrl): `version: 4`, `status: "in_review"`.

---

## 3. Inspeção DOM e Evidências Reais do Probe Isolado

### 3.1. Abertura do Painel e DOM Antes da Interação
O probe navegou até a tarefa e acionou o botão `Avaliar / Revisar Tarefa`:
```json
{
  "hasForm": true,
  "radios": {
    "complete": { "exists": true, "checked": true, "value": "complete" },
    "changes_requested": { "exists": true, "checked": false, "value": "changes_requested" }
  },
  "textarea": {
    "exists": true,
    "value": "",
    "required": true,
    "valid": false
  },
  "submitBtn": {
    "text": "Concluir Avaliação",
    "disabled": false
  },
  "formValid": false,
  "invalidFields": [
    {
      "id": "reviewFeedback",
      "name": "",
      "tagName": "TEXTAREA",
      "validationMessage": "Preencha este campo."
    }
  ],
  "banner": null
}
```
* **Fato:** O formulário inicia com `formValid: false` porque `#reviewFeedback` é obrigatório (`required`) e está vazio.

### 3.2. Seleção do Rádio `changes_requested`
Executado o clique no label do rádio (`radioChanges.closest('label').click()`) + `focus` e dispatch de evento `change`:
```json
{
  "beforeChangesChecked": false,
  "beforeCompleteChecked": true,
  "afterLabelClickChangesChecked": true,
  "afterLabelClickCompleteChecked": false,
  "finalChangesChecked": true,
  "finalCompleteChecked": false
}
```
* **Fato:** O rádio transiciona para `checked: true` e desmarca `complete: false`.

### 3.3. Preenchimento de `#reviewFeedback` e Inspeção Pré-Submit
Aplicando o native setter no textarea + dispatch de `input` e `change`:
```json
{
  "radios": {
    "complete": { "checked": false },
    "changes_requested": { "checked": true }
  },
  "textarea": {
    "value": "Aumentar contraste no hero e padronizar espaçamento dos cards",
    "valid": true
  },
  "submitBtn": {
    "text": "Concluir Avaliação",
    "disabled": false
  },
  "formValid": true,
  "invalidFields": [],
  "banner": null
}
```
* **Fato:** Com o feedback preenchido, `formValid` torna-se `true` e `invalidFields` é esvaziado (`[]`). O botão de submit está habilitado (`disabled: false`).

### 3.4. Submissão Form-Scoped e Confirmação de Sucesso
Submetendo o formulário via `form.querySelector('button[type="submit"]').click()`:
- **DOM Pós-Submit:**
  * `formStillOpen`: `false` (o painel de revisão foi fechado com sucesso).
  * `bannerError`: `null`.
- **API Task Final (`GET /api/v1/tasks/:id`):**
  * `id`: `20fcc5a6-7b18-4eb2-aaef-ecc96e725ef9`
  * `status`: `"changes_requested"` (PASSOU funcionalmente com sucesso!).
  * `version`: `5`.
  * `updatedAt`: `2026-10-06T15:22:13.638Z`
- **Banco de Dados (`demand_event`):**
  * Evento gravado: `action: 'task_changes_requested'`
  * Motivo (`reason`): `"Aumentar contraste no hero e padronizar espaçamento dos cards"`

---

## 4. Diagnóstico Factual do QA Runner (QA 3196) vs Probe Isolado

A telemetria da rodada geral QA 3196 revelou os seguintes fatos concretos:
1. **Formulário Ausente no QA (`formFound: false`):**
   - Na inspeção pré-submit do QA 3196, o formulário retornou `formFound: false`.
   - Os rádios retornaram `changesRequestedChecked: false` e `completeChecked: false`.
   - Na inspeção pós-submit, `formStillOpen` retornou `false`.
   - O status da tarefa no backend permaneceu `in_review`.
2. **Causa Real: O Painel de Avaliação NÃO Abriu no QA:**
   - O clique no botão `Avaliar / Revisar Tarefa` não abriu o formulário antes de o runner tentar interagir com ele.
   - Conforme regra de `AGENTS.md`, o Maestri `portal evaluate` pode retornar texto contendo `error:` no stdout com exit code 0. Se o comando de clique ou navegação falhou silenciosamente ou retornou erro textual no stdout ignorado pelo runner, o código prosseguiu para preenchimento de elementos inexistentes.
   - Sem o formulário aberto (`formFound: false`), nenhuma interação foi realizada, nenhum submit foi emitido e a tarefa permaneceu inalterada em `in_review`.
3. **Retratação de Hipótese Não Comprovada:**
   - A hipótese anterior de incompatibilidade entre `form.requestSubmit(btn)` e React 18/19 **não foi testada no mesmo painel válido** e **não é a causa-raiz da falha**. A causa comprovada é a **ausência do formulário no DOM (`formFound: false`)**.

---

## 5. Recomendação Cirúrgica para o QA Runner (`phase3-qa-runner.mjs`)
Para destravar `P3-BR-08` no runner geral:
1. **Adicionar Guard Explícito de Abertura do Painel:**
   Após clicar em `Avaliar / Revisar Tarefa`, fazer polling com asserção estrita de que o formulário está presente no DOM antes de prosseguir:
   ```javascript
   // Abrir painel
   await portalEvaluate(`(() => {
     const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Avaliar / Revisar') || b.textContent.includes('Revisar'));
     if (!btn) throw new Error('Botão Avaliar / Revisar Tarefa não encontrado');
     btn.click();
   })()`);

   // Guard: aguardar obrigatoriamente abertura de #reviewFeedback
   let panelOpened = false;
   for (let i = 0; i < 20; i++) {
     await sleep(200);
     const res = await portalEvaluate("String(Boolean(document.querySelector('#reviewFeedback')))");
     if (res === 'true') { panelOpened = true; break; }
   }
   if (!panelOpened) throw new Error('Painel de avaliação (#reviewFeedback) não abriu após clique no botão.');
   ```
2. **Rejeição de Erros Textuais no `portalEvaluate`:**
   Conferir o stdout do `portal evaluate` para rejeitar strings com `error:` ou `Error:` mesmo em exit code 0, evitando avançar em falso.
3. **Submit com Formulário Confirmado:**
   Com o painel confirmado no DOM (`formFound: true`), selecionar o rádio `changes_requested`, preencher `#reviewFeedback` e disparar o submit.

---

## 6. Higiene e Teardown
O probe executou seu cleanup rigoroso e independente:
- **Banco (`orium_test`):** Conferência via script confirmou **0 registros órfãos** (`{"users":0,"clients":0,"demands":0,"tasks":0}`).
- **Processos:** Filhos de API (PID 45728) e Web (PID 20240) finalizados comprovadamente (`ESRCH`).
- **Leases de Portas:** Leases 3003 e 5175 liberados no `Find-FreePort.ps1`.
- **Portal:** Restaurado com sucesso para `http://127.0.0.1:5173/` mantendo a janela aberta.
- **DEV (3001/55432):** 100% intacto, não ativado.
