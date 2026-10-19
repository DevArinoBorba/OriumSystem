import { describe, expect, it } from 'vitest';
import { parseRoute, routePath } from '../apps/web/src/router.js';
import { formatCalendarDate, queueWait, relativeDeadline } from '../apps/web/src/dates.js';

describe('rotas do frontend', () => {
  it('reconhece telas e ignora caminhos desconhecidos', () => {
    expect(parseRoute('/painel')).toEqual({ tab: 'dashboard', demandId: null, taskId: null });
    expect(parseRoute('/clientes/')).toEqual({ tab: 'clients', demandId: null, taskId: null });
    expect(parseRoute('/')).toBeNull();
    expect(parseRoute('/inexistente')).toBeNull();
    // Telas removidas da interface: endereços antigos caem na tela inicial.
    expect(parseRoute('/cofre')).toBeNull();
    expect(parseRoute('/backups')).toBeNull();
  });

  it('extrai chamado e tarefa somente em /demandas', () => {
    expect(parseRoute('/demandas/abc')).toEqual({ tab: 'demands', demandId: 'abc', taskId: null });
    expect(parseRoute('/demandas/abc/tarefas/t1')).toEqual({ tab: 'demands', demandId: 'abc', taskId: 't1' });
    expect(parseRoute('/demandas/abc/outra/t1')).toEqual({ tab: 'demands', demandId: 'abc', taskId: null });
    expect(parseRoute('/clientes/abc')).toEqual({ tab: 'clients', demandId: null, taskId: null });
  });

  it('gera caminhos que voltam à mesma rota', () => {
    const routes = [
      { tab: 'demands', demandId: 'd-1', taskId: 't-1' },
      { tab: 'demands', demandId: 'd-1', taskId: null },
      { tab: 'reports', demandId: null, taskId: null },
    ] as const;
    for (const route of routes) {
      expect(parseRoute(routePath(route))).toEqual(route);
    }
    expect(routePath({ tab: 'clients', demandId: 'ignorado', taskId: null })).toBe('/clientes');
  });
});

describe('prazos relativos', () => {
  const today = '2026-10-19';

  it('classifica atraso, hoje, próximos dias e depois', () => {
    expect(relativeDeadline('2026-10-17', today)).toEqual({ label: 'atrasada há 2 dias', tone: 'overdue' });
    expect(relativeDeadline('2026-10-18', today)).toEqual({ label: 'atrasada há 1 dia', tone: 'overdue' });
    expect(relativeDeadline('2026-10-19', today)).toEqual({ label: 'vence hoje', tone: 'today' });
    expect(relativeDeadline('2026-10-20', today)).toEqual({ label: 'amanhã', tone: 'soon' });
    expect(relativeDeadline('2026-10-22', today)).toEqual({ label: 'em 3 dias', tone: 'soon' });
    expect(relativeDeadline('2026-10-30', today)).toEqual({ label: 'em 11 dias', tone: 'later' });
  });

  it('atravessa meses/anos e rejeita datas inválidas', () => {
    expect(relativeDeadline('2027-01-01', '2026-12-31')?.label).toBe('amanhã');
    expect(relativeDeadline('invalida', today)).toBeNull();
    expect(formatCalendarDate('2026-10-19')).toBe('19/10/2026');
  });
});

describe('espera na fila', () => {
  it('conta dias no fuso da agência desde ready_at', () => {
    // 02:00Z do dia 19 ainda é dia 18 em Cuiabá (UTC-4)
    expect(queueWait('2026-10-19T02:00:00Z', '2026-10-19')).toEqual({ label: 'na fila há 1 dia', stale: false });
    expect(queueWait('2026-10-19T15:00:00Z', '2026-10-19')).toEqual({ label: 'pronta hoje', stale: false });
    expect(queueWait('2026-10-15T15:00:00Z', '2026-10-19')).toEqual({ label: 'na fila há 4 dias', stale: true });
    expect(queueWait('invalida', '2026-10-19')).toBeNull();
  });
});
