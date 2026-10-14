import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type {
  BottlenecksReportResponse,
  ProductivityReportResponse,
  SessionResponse,
} from '@orium/contracts';
import { api, ApiError } from '../api.js';

interface ReportsViewProps {
  session: SessionResponse;
  onUnauthorized: () => void;
}

function toLocalDateInput(offsetDays: number): string {
  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offsetDays);
  const y = target.getFullYear();
  const m = String(target.getMonth() + 1).padStart(2, '0');
  const d = String(target.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function ReportsView({ session, onUnauthorized }: ReportsViewProps) {
  const hasClientsRead = session.permissions.includes('clients.read');
  const isAdmin = session.roles.includes('administrator');

  // ---------------- Filters ----------------
  const [startDate, setStartDate] = useState(() => toLocalDateInput(-29));
  const [endDate, setEndDate] = useState(() => toLocalDateInput(0));
  const [clientId, setClientId] = useState('');
  const [appliedClientId, setAppliedClientId] = useState('');
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  const [filtersDirty, setFiltersDirty] = useState(false);

  // ---------------- Data ----------------
  const [productivity, setProductivity] = useState<ProductivityReportResponse | null>(null);
  const [bottlenecks, setBottlenecks] = useState<BottlenecksReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);

  // ---------------- Clients loader (filters) ----------------
  const loadClients = useCallback(async () => {
    if (!hasClientsRead) return;
    const controller = new AbortController();
    try {
      const response = await api.listClients(
        { status: 'active', page: 1, pageSize: 100 },
        controller.signal,
        onUnauthorized,
      );
      setClients(response.clients);
    } catch (error) {
      if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) return;
    }
  }, [hasClientsRead, onUnauthorized]);

  useEffect(() => {
    void loadClients();
  }, [loadClients]);

  // ---------------- Loaders ----------------
  const loadReports = useCallback(
    async (currentStart: string, currentEnd: string, currentClientId: string) => {
      requestRef.current?.abort();
      const controller = new AbortController();
      requestRef.current = controller;
      setLoading(true);
      setError(null);
      try {
        const reportQuery = {
          startDate: currentStart,
          endDate: currentEnd,
          clientId: currentClientId || undefined,
        };
        const [prod, bottle] = await Promise.all([
          api.getProductivityReport(reportQuery, controller.signal, onUnauthorized),
          api.getBottlenecksReport(controller.signal, onUnauthorized),
        ]);
        if (requestRef.current === controller && !controller.signal.aborted) {
          setProductivity(prod);
          setBottlenecks(bottle);
        }
      } catch (err) {
        if (controller.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) return;
        if (requestRef.current === controller) {
          if (err instanceof ApiError && err.status === 403) {
            setError('Você não tem permissão para visualizar relatórios operacionais.');
          } else if (err instanceof ApiError && err.status === 400) {
            setError('O período informado é inválido. Verifique as datas e tente novamente.');
          } else {
            setError('Não foi possível carregar os relatórios. Tente novamente.');
          }
        }
      } finally {
        if (requestRef.current === controller) {
          setLoading(false);
          requestRef.current = null;
        }
        setFiltersDirty(false);
      }
    },
    [onUnauthorized],
  );

  useEffect(() => {
    void loadReports(startDate, endDate, appliedClientId);
    return () => {
      requestRef.current?.abort();
    };
  }, [loadReports, startDate, endDate, appliedClientId]);

  function handleApplyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAppliedClientId(clientId);
    setFiltersDirty(true);
  }

  // ---------------- Derived ----------------
  const summary = productivity?.summary;
  const byAssignee = productivity?.byAssignee ?? [];
  const bottleSummary = bottlenecks?.summary;
  const stageAverages = bottlenecks?.stageAverages;
  const pausedTasks = bottlenecks?.pausedTasks ?? [];

  const formatNumber = (value: number, digits = 1): string => {
    return new Intl.NumberFormat('pt-BR', {
      minimumFractionDigits: 0,
      maximumFractionDigits: digits,
    }).format(value);
  };

  const formatHours = (hours: number): string => {
    if (hours >= 24) {
      const days = hours / 24;
      return `${formatNumber(days, 1)}d`;
    }
    return `${formatNumber(hours, 1)}h`;
  };

  const renderKpiCard = (
    label: string,
    value: string | number | null | undefined,
    suffix = '',
    help = '',
  ) => (
    <div className="kpi-card">
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">
        {typeof value === 'number' ? formatNumber(value) : value ?? '—'}
        {suffix && typeof value === 'number' ? suffix : ''}
      </span>
      {help && <span className="kpi-help muted-text">{help}</span>}
    </div>
  );

  const KPI = {
    demandsCreated: summary?.demandsCreated ?? 0,
    demandsCompleted: summary?.demandsCompleted ?? 0,
    tasksCompleted: summary?.tasksCompleted ?? 0,
    onTimeDeliveryRate: summary?.onTimeDeliveryRate ?? 0,
    averageLeadTimeHours: summary?.averageLeadTimeHours ?? 0,
    averageCycleTimeHours: summary?.averageCycleTimeHours ?? 0,
    averageReadyWaitHours: stageAverages?.averageReadyWaitHours ?? 0,
    averageProductionHours: stageAverages?.averageProductionHours ?? 0,
  };

  if (loading) {
    return (
      <section className="view-panel" aria-labelledby="reports-heading">
        <div className="panel-header">
          <div>
            <h1 id="reports-heading">Relatórios</h1>
            <p className="panel-subtitle">Indicadores de produtividade e gargalos operacionais.</p>
          </div>
        </div>
        <div className="empty-state" aria-live="polite">
          <p className="status-text">Carregando relatórios…</p>
        </div>
      </section>
    );
  }

  return (
    <section className="view-panel" aria-labelledby="reports-heading">
      <div className="panel-header">
        <div>
          <h1 id="reports-heading">Relatórios</h1>
          <p className="panel-subtitle">
            {isAdmin
              ? 'Visão de produtividade da equipe e gargalos operacionais do período.'
              : 'Visão das suas tarefas e gargalos do período.'}
          </p>
        </div>
      </div>

      {error ? (
        <div className="empty-state error" role="alert">
          <p className="error-text">{error}</p>
          <button
            type="button"
            className="secondary-button"
            onClick={() => void loadReports(startDate, endDate, appliedClientId)}
          >
            Tentar novamente
          </button>
        </div>
      ) : (
        <>
          {/* Filters */}
          <form className="report-filters" onSubmit={handleApplyFilters} noValidate>
            <div className="form-row">
              <div className="form-field">
                <label htmlFor="report-start-date">Data inicial</label>
                <input
                  id="report-start-date"
                  type="date"
                  value={startDate}
                  max={endDate}
                  onChange={(event) => setStartDate(event.target.value)}
                />
              </div>
              <div className="form-field">
                <label htmlFor="report-end-date">Data final</label>
                <input
                  id="report-end-date"
                  type="date"
                  value={endDate}
                  min={startDate}
                  onChange={(event) => setEndDate(event.target.value)}
                />
              </div>
              {hasClientsRead && (
                <div className="form-field">
                  <label htmlFor="report-client">Cliente</label>
                  <select
                    id="report-client"
                    value={clientId}
                    onChange={(event) => setClientId(event.target.value)}
                  >
                    <option value="">Todos os clientes</option>
                    {clients.map((client) => (
                      <option key={client.id} value={client.id}>
                        {client.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            <div className="panel-actions" style={{ marginTop: 4 }}>
              <button type="submit" className="primary-button" disabled={!filtersDirty && !loading}>
                Aplicar filtros
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setStartDate(toLocalDateInput(-29));
                  setEndDate(toLocalDateInput(0));
                  setClientId('');
                  setAppliedClientId('');
                }}
              >
                Últimos 30 dias
              </button>
            </div>
          </form>

          {/* Productivity KPIs */}
          <div className="kpi-grid" role="group" aria-label="Indicadores de produtividade">
            {renderKpiCard('Demandas criadas', KPI.demandsCreated, '', 'No período')}
            {renderKpiCard('Demandas concluídas', KPI.demandsCompleted, '', 'No período')}
            {renderKpiCard('Tarefas concluídas', KPI.tasksCompleted, '', 'No período')}
            {renderKpiCard('Entrega no prazo', KPI.onTimeDeliveryRate, '%', 'OTD das entregas')}
            {renderKpiCard('Lead time médio', KPI.averageLeadTimeHours, ' h', 'Da abertura à conclusão da demanda')}
            {renderKpiCard('Cycle time médio', KPI.averageCycleTimeHours, ' h', 'Da prontidão à conclusão da tarefa')}
          </div>

          {/* Bottlenecks */}
          {bottlenecks && (
            <section className="report-section" aria-labelledby="bottlenecks-heading">
              <h2 className="section-heading" id="bottlenecks-heading">Gargalos operacionais</h2>
              <div className="kpi-grid">
                {renderKpiCard('Tarefas bloqueadas', bottleSummary?.currentlyBlockedTasks ?? 0, '', 'Aguardando requisitos/dependências')}
                {renderKpiCard('Tarefas pausadas', bottleSummary?.currentlyPausedTasks ?? 0, '', 'Pausas aprovadas')}
                {renderKpiCard('Tarefas em revisão', bottleSummary?.currentlyInReviewTasks ?? 0, '', 'Aguardando aprovação')}
                {renderKpiCard('Atrasadas em aberto', bottleSummary?.overdueOpenTasks ?? 0, '', 'Fora do prazo e não concluídas')}
                {renderKpiCard('Espera média (ready)', stageAverages?.averageReadyWaitHours ?? 0, ' h', 'Da prontidão ao início da produção')}
                {renderKpiCard('Produção média', stageAverages?.averageProductionHours ?? 0, ' h', 'Do início da produção à revisão')}
              </div>

              {pausedTasks.length > 0 && (
                <>
                  <div className="section-heading-row" style={{ marginTop: 24 }}>
                    <h3 className="section-heading">Tarefas pausadas</h3>
                  </div>
                  <div className="table-container">
                    <table className="data-table" aria-label="Tarefas pausadas com motivo e tempo no status">
                      <thead>
                        <tr>
                          <th scope="col">Tarefa</th>
                          <th scope="col">Demanda</th>
                          <th scope="col">Cliente</th>
                          <th scope="col">Responsável</th>
                          <th scope="col">Motivo da pausa</th>
                          <th scope="col" className="text-right">Dias no status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pausedTasks.map((task) => (
                          <tr key={task.taskId}>
                            <td>
                              <div className="demand-title">{task.taskTitle}</div>
                              <div className="client-notes">#{task.taskId.slice(0, 8)}</div>
                            </td>
                            <td>{task.demandTitle}</td>
                            <td>{task.clientName}</td>
                            <td>{task.assignedToName || '—'}</td>
                            <td className="contact-info">{task.pauseReason || <em>Sem motivo informado</em>}</td>
                            <td className="text-right">
                              <span className="date-value">
                                {formatNumber(task.daysInCurrentStatus, 1)} dia(s)
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
              {pausedTasks.length === 0 && (
                <p className="muted-text" style={{ marginTop: 12 }}>Nenhuma tarefa pausada no momento.</p>
              )}
            </section>
          )}

          {/* Assignee table */}
          <section className="report-section" aria-labelledby="assignee-heading" style={{ marginTop: 24 }}>
            <h2 className="section-heading" id="assignee-heading">Produtividade por responsável</h2>
            {byAssignee.length === 0 ? (
              <p className="muted-text">Sem dados no período para responsáveis.</p>
            ) : (
              <div className="table-container">
                <table className="data-table" aria-label="Produtividade por responsável">
                  <thead>
                    <tr>
                      <th scope="col">Responsável</th>
                      <th scope="col">Tarefas concluídas</th>
                      <th scope="col">Cycle time médio</th>
                      <th scope="col">No prazo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byAssignee.map((row) => (
                      <tr key={row.userId}>
                        <td className="client-name">{row.userName}</td>
                        <td>{formatNumber(row.tasksCompleted, 0)}</td>
                        <td>{formatHours(row.averageCycleTimeHours)}</td>
                        <td>
                          <span
                            className={`status-badge ${row.onTimeRate >= 80 ? 'complete' : row.onTimeRate > 0 ? 'open' : 'muted'}`}
                          >
                            {formatNumber(row.onTimeRate, 0)}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </section>
  );
}
