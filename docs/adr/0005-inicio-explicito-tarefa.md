# ADR-0005 — Início explícito do relógio operacional

Status: **Aceito pelo responsável**. Data do registro: 05/10/2026. Fase de implementação: 3.

## Contexto

A disponibilidade de requisitos libera trabalho, mas não significa que a execução começou. A interpretação anterior da proposta, que iniciava o relógio em `ready_at`, foi expressamente corrigida pelo responsável.

## Decisão aprovada

```text
BLOQUEADA
  → todos os requisitos obrigatórios atendidos
  → PRONTA PARA INICIAR: registrar ready_at
  → usuário autorizado clica INICIAR TAREFA
  → registrar started_at e iniciar relógio operacional
  → EM PRODUÇÃO
```

`ready_at` identifica quando os requisitos obrigatórios foram atendidos. `started_at` identifica o início efetivo solicitado por usuário autorizado. O tempo entre esses momentos não consome prazo operacional e deve permanecer mensurável para análise futura de fila/capacidade. Desbloquear não inicia o relógio.

Bloqueios precisam de causa válida e histórico. Não permitir marcação manual de bloqueio apenas para esconder atraso.

## Consequências

Prontidão, fila, bloqueio e produção são conceitos distintos. A futura API deve revalidar autorização e requisitos no início e impedir duplicidade de início/intervalo sob concorrência. Antes do primeiro início, espera pronta não é atraso operacional; pode afetar entrega da demanda.

## Pendências e fontes de verdade

Calendário, pausas posteriores, reabertura, retomada, invalidação de materiais e novos ciclos de prontidão não foram decididos. `PROJECT_CONTEXT.md`, seções 4 e 6, e `ROADMAP.md` foram sincronizados com esta aprovação. Este ADR registra o domínio conceitualmente; a Fase 1 não implementa tarefas ou relógio e não antecipa a Fase 3.
