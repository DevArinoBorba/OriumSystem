# Diagnóstico e Resolução Completa do Formulário de Demandas (P3-BR-02)

## 1. Contexto e Problema Observado no QA Runner
Durante a execução do runner da Fase 3 (`phase3-qa-runner.mjs`) no teste `P3-BR-02` (Criação de Demanda), a execução falhava com a mensagem:
> `Demanda recém-criada não abriu em tela de detalhes. Cabeçalho atual: ""` (ou com o cabeçalho genérico `"Detalhes do chamado"` em vez do título real da demanda).

---

## 2. Causas Raízes Identificadas e Mecanismo da Falha

### A. Causa Raiz 1: Colisão de ID no DOM (Duplicate ID)
No arquivo `apps/web/src/components/DemandsView.tsx`:
- Linha 927: `<h2 id="demand-form-title">Novo chamado</h2>` (título visual fora do `<form>`).
- Linha 970: `<input id="demand-form-title" ... />` (campo de texto obrigatório dentro do `<form>`).
- Análogo em tarefas: `<h2 id="task-form-title">` (linha 1256) vs `<input id="task-form-title">` (linha 1301).

**Mecanismo**: `document.querySelector('#demand-form-title')` retornava o elemento `<H2>`. Comandos de preenchimento (`maestri portal fill` e `setInputValue`) atuavam sobre o `<h2>`, deixando o `<input>` com `value: ""` e `valid: false`. Na submissão, a validação HTML5 barrava o envio ou a validação Zod no frontend acusava `"O título do chamado é obrigatório"`.

### B. Causa Raiz 2: Concorrência de Loaders e AbortController Compartilhado
Após o envio do formulário, `handleCreateDemand` executava:
```tsx
setSelectedDemandId(created.id);
void loadDemandDetail(created.id);
void loadDemands(page, status, priority, appliedSearch);
```
**Mecanismo**: Ambos os loaders compartilhavam a mesma referência `activeRequestRef`. Ao invocar `loadDemands` imediatamente após `loadDemandDetail`, o primeiro comando de `loadDemands` (`activeRequestRef.current?.abort()`) abortava a requisição em voo do detalhe da demanda. O estado `demand` permanecia `null`, fazendo com que o cabeçalho `#demand-detail-heading` exibisse o fallback genérico `'Detalhes do chamado'` em vez do título real da demanda (`demand?.title`), reprovando o assert `headingText.includes(demandTitle)` do QA runner.

---

## 3. Correções Aplicadas pelo OpenCode
1. **Desambiguação de IDs no DOM**:
   - Título do formulário de demanda renomeado para `id="demand-form-heading"`, alinhado a `aria-labelledby="demand-form-heading"`.
   - Título do formulário de tarefa renomeado para `id="task-form-heading"`, alinhado a `aria-labelledby="task-form-heading"`.
   - Título da edição renomeado para `id="edit-demand-heading"`.
   - Campos de input preservados com seus identificadores exclusivos: `id="demand-form-title"`, `id="task-form-title"` e `id="edit-demand-title"`.
2. **Separação de AbortControllers**:
   - `listRequestRef`: controla as requisições de listagem e filtros.
   - `detailRequestRef`: controla exclusivamente as requisições de detalhe da demanda, com abort restrito ao unmount do componente.
3. **Validações Estáticas**:
   - `tsc -p tsconfig.json --noEmit`: 0 erros.
   - `eslint apps/web/src`: 0 erros.
   - `pnpm --filter @orium/web build`: OK (dist gerado com sucesso).

---

## 4. Evidência Factual da Execução Oficial Isolada (`.local/phase3-demand-form-probe.mjs`)
Executado em ambiente 100% isolado (host `localhost`, portas `API=3003`, `Web=5175`, bind em `127.0.0.1`, banco `orium_test` na porta 5433), sem tocar no portal do QA nem no ambiente DEV.

### Comandos Oficiais Executados pelo Driver:
1. `maestri portal select "#demand-form-client" "<clientUUID>"` -> OK.
2. `maestri portal fill "#demand-form-title" "Pausa witness chamado b7709ec2"` -> OK (preenche o `<input>`, não o `<h2>`).
3. `maestri portal fill "#demand-form-description" "Descrição teste via driver oficial"` -> OK.
4. `maestri portal select "#demand-form-priority" "Alta"` -> OK.
5. `maestri portal fill "#demand-form-date" "2026-11-20"` -> OK.
6. `maestri portal click "button[type='submit']"` -> OK.

### Resultados Fatuais do Recibo (`.local/phase3-demand-form-probe-results.json`):
```json
{
  "duplicateIdDiagnosis": {
    "totalElementsWithDemandFormTitleId": 1,
    "firstElementTargetedByQuerySelector": "INPUT",
    "isFirstElementAnInput": true,
    "inputElementTag": "INPUT"
  },
  "fields": {
    "client": { "value": "0e32df24-8554-4d15-94ba-417aa66fab5c", "valid": true },
    "title": { "tagName": "INPUT", "value": "Pausa witness chamado b7709ec2", "valid": true },
    "desc": { "value": "Descrição teste via driver oficial", "valid": true },
    "priority": { "value": "high", "valid": true },
    "date": { "value": "2026-11-20", "valid": true }
  },
  "formValid": true,
  "invalidFields": [],
  "postSubmit": {
    "hasHeading": true,
    "headingText": "Pausa witness chamado b7709ec2",
    "subtitleText": "Pausa witness b7709ec2 • Prioridade Alta • Entrega geral: 2026-11-20 • Em aberto",
    "formStillOpen": false,
    "isExactTitle": true,
    "isGenericPlaceholder": false,
    "hasClientInSubtitle": true,
    "hasDateInSubtitle": true
  },
  "listBack": {
    "tableRendered": true,
    "hasDemandInTable": true,
    "matchingRowSample": "Pausa witness chamado b7709ec2#f5665ff6Pausa witness b7709ec2Alta2026-11-20Em abertoVer detalhes"
  },
  "demandCreatedInApi": true,
  "createdDemandDetail": {
    "id": "f5665ff6-f768-46a8-ae5c-a6f6296b9b72",
    "title": "Pausa witness chamado b7709ec2",
    "deliveryDate": "2026-11-20",
    "createdByUserId": "edf48a60-fce6-4f67-a223-dc85b800d2fd",
    "ownerMatchesAdmin": true
  }
}
```

---

## 5. Higiene e Teardown
1. **Limpeza do Banco**: Todas as fixtures criadas foram removidas cirurgicamente com asserção estrita de 0 órfãos nas tabelas `demand`, `client` e `auth_user`.
2. **Processos e Leases**: Processos API probe (PID 51236) e Web probe (PID 7364) finalizados (`ESRCH`); leases das portas 3003 e 5175 liberados via `Find-FreePort.ps1`.
3. **Portal**: `Orium - Fase3 pausa visivel` retornado e mantido aberto em `http://127.0.0.1:5173/`.
4. **DEV Intocado**: Servidor DEV na porta 3001 (PID 27784) e banco `orium_dev` (porta 55432) estritamente preservados.
