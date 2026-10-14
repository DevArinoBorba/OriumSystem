import { useCallback, useEffect, useRef, useState } from 'react';
import type { DashboardItem, DashboardResponse, SessionResponse } from '@orium/contracts';
import { api, ApiError } from '../api.js';
import type { DashboardSectionKey } from '../types.js';

interface DashboardViewProps {
  session: SessionResponse;
  onUnauthorized: () => void;
  onOpenItem: (target: { demandId: string; taskId?: string }) => void;
}

const DAY_LIMIT = 20;

const taskStatusLabels: Record<string, string> = {
  blocked: 'Aguardando',
  ready: 'Pronta',
  in_production: 'Em produção',
  in_review: 'Em revisão',
  changes_requested: 'Ajustes pedidos',
  paused: 'Pausada',
  completed: 'Concluída',
};

const priorityLabels: Record<string, string> = {
  low: 'Baixa',
  normal: 'Normal',
  high: 'Alta',
  urgent: 'Urgente',
};

function formatDate(calendar: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(calendar);
  if (!m) return calendar;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const day = date.toLocaleDateString('pt-BR', { timeZone: 'America/Cuiaba' });
  const time = date.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Cuiaba',
  });
  return `${day} às ${time} (horário de Cuiabá)`;
}

function statusLabelFor(item: DashboardItem): string {
  if (item.kind === 'demand') {
    return item.status === 'completed' ? 'Concluído' : 'Aberto';
  }
  return taskStatusLabels[item.status] ?? item.status;
}

type SectionMeta = {
  key: DashboardSectionKey;
  title: string;
  description: string;
  headline: string; // verb/noun used to describe a single item
  kindNote?: boolean;
};

const topSections: SectionMeta[] = [
  {
    key: 'production',
    title: 'Em produção',
    description: 'Trabalhos com relógio operacional em andamento.',
    headline: 'Tarefa',
  },
  {
    key: 'awaitingAction',
    title: 'Dependendo de ação',
    description: 'Itens aguardando revisão, aprovação, material, retorno ou decisão.',
    headline: 'Ação pendente',
  },
];

const pendingSections: SectionMeta[] = [
  {
    key: 'overdueTasks',
    title: 'Atrasadas na operação',
    description: 'Tarefas atrasadas no prazo operacional (começaram e não foram concluídas).',
    headline: 'Atraso operacional',
  },
  {
    key: 'overdueDemands',
    title: 'Chamados com prazo vencido',
    description: 'Chamados abertos cujo prazo de entrega já passou.',
    headline: 'Prazo do chamado vencido',
  },
  {
    key: 'dueToday',
    title: 'Vencem hoje',
    description: 'Entregas previstas para o dia de hoje.',
    headline: 'Vence hoje',
  },
  {
    key: 'upcoming',
    title: 'Próximos 3 dias',
    description: 'De amanhã até os próximos três dias.',
    headline: 'Entrega próxima',
  },
  {
    key: 'urgent',
    title: 'Urgentes',
    description: 'Trabalhos de prioridade urgente em aberto.',
    headline: 'Urgente',
  },
];

type DashboardViewMode = 'list' | 'kanban';

interface KanbanColumnMeta {
  key: 'blocked' | 'ready' | 'in_production' | 'in_review' | 'changes_requested' | 'paused';
  title: string;
  subtitle: string;
  accentClass: string;
}

const kanbanColumns: KanbanColumnMeta[] = [
  {
    key: 'blocked',
    title: 'Bloqueadas / Aguardando',
    subtitle: 'Dependências ou requisitos pendentes',
    accentClass: 'col-blocked',
  },
  {
    key: 'ready',
    title: 'Prontas para Iniciar',
    subtitle: 'Requisitos atendidos, prontas p/ produção',
    accentClass: 'col-ready',
  },
  {
    key: 'in_production',
    title: 'Em Produção',
    subtitle: 'Relógio operacional em andamento',
    accentClass: 'col-production',
  },
  {
    key: 'in_review',
    title: 'Em Revisão',
    subtitle: 'Aguardando avaliação administrativa',
    accentClass: 'col-review',
  },
  {
    key: 'changes_requested',
    title: 'Ajustes Pedidos',
    subtitle: 'Correções solicitadas na revisão',
    accentClass: 'col-changes',
  },
  {
    key: 'paused',
    title: 'Pausadas',
    subtitle: 'Pausa operacional aprovada',
    accentClass: 'col-paused',
  },
];

function getInitialDashboardViewMode(): DashboardViewMode {
  if (typeof window === 'undefined') return 'list';
  try {
    const saved = localStorage.getItem('orium-dashboard-view');
    return saved === 'kanban' ? 'kanban' : 'list';
  } catch {
    return 'list';
  }
}

export function DashboardView({ session, onUnauthorized, onOpenItem }: DashboardViewProps) {
  const isAdmin = session.roles.includes('administrator');
  const hasUsersRead = session.permissions.includes('users.read');
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<DashboardViewMode>(getInitialDashboardViewMode);
  const [kanbanSearch, setKanbanSearch] = useState('');
  const [kanbanAssigneeFilter, setKanbanAssigneeFilter] = useState<string>('all');
  const [kanbanPriorityFilter, setKanbanPriorityFilter] = useState<string>('all');
  const hasDataRef = useRef(false);
  const requestRef = useRef<AbortController | null>(null);

  const handleSelectViewMode = (mode: DashboardViewMode) => {
    setViewMode(mode);
    try {
      localStorage.setItem('orium-dashboard-view', mode);
    } catch {
      // Ignore storage error
    }
  };

  const load = useCallback(
    async (refresh = false) => {
      if (refresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
        setError(null);
      }
      requestRef.current?.abort();
      const controller = new AbortController();
      requestRef.current = controller;
      try {
        const response = await api.getDashboard({ limit: DAY_LIMIT }, controller.signal, onUnauthorized);
        if (requestRef.current === controller && !controller.signal.aborted) {
          setData(response);
          setUpdatedAt(response.generatedAt);
          hasDataRef.current = true;
          setError(null);
        }
      } catch (err) {
        if (controller.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) return;
        if (requestRef.current === controller) {
          if (err instanceof ApiError && err.status === 403) {
            setData(null);
            setUpdatedAt(null);
            hasDataRef.current = false;
            setError('Acesso ao Painel foi revogado. Atualize a página ou fale com um administrador.');
          } else if (hasDataRef.current) {
            // mantém updatedAt anterior para o label de staleness
            setError('Não foi possível atualizar o Painel. Mostrando os dados da última atualização.');
          } else {
            setError('Não foi possível carregar o Painel. Tente novamente.');
          }
        }
      } finally {
        if (requestRef.current === controller) {
          setLoading(false);
          setRefreshing(false);
          requestRef.current = null;
        }
      }
    },
    [onUnauthorized],
  );

  useEffect(() => {
    void load();
    return () => {
      requestRef.current?.abort();
    };
  }, [load]);

  const handleOpen = (item: DashboardItem) => {
    if (item.kind === 'task') {
      onOpenItem({ demandId: item.demandId, taskId: item.taskId ?? item.id });
    } else {
      onOpenItem({ demandId: item.demandId });
    }
  };

  const showWorkload = isAdmin && hasUsersRead && data?.workloadAvailable === true;

  const renderItem = (item: DashboardItem) => (
    <li key={item.id} className="dashboard-item">
      <div className="dashboard-item-main">
        <div className="dashboard-item-title">
          <span className={`dashboard-kind ${item.kind}`}>{item.kind === 'task' ? 'Tarefa' : 'Chamado'}</span>
          <span className="dashboard-title-text">{item.title}</span>
          <span className={`priority-badge ${item.priority}`}>{priorityLabels[item.priority] ?? item.priority}</span>
        </div>
        <div className="dashboard-item-meta">
          {item.demandTitle && <span className="muted-dash">Chamado: <strong>{item.demandTitle}</strong></span>}
          <span>Cliente: <strong>{item.client.name}</strong></span>
          <span>Entrega: <strong>{formatDate(item.deliveryDate)}</strong></span>
          {item.status && <span className={`status-badge ${item.status === 'completed' ? 'complete' : 'open'}`}>{statusLabelFor(item)}</span>}
          {item.kind === 'task' && item.assignedTo ? (
            <span>Responsável: <strong>{item.assignedTo.name}</strong></span>
          ) : null}
        </div>
        {item.reason && <p className="dashboard-item-reason">{item.reason}</p>}
      </div>
      <button
        type="button"
        className="action-btn edit"
        onClick={() => handleOpen(item)}
      >
        {item.kind === 'task' ? 'Abrir tarefa' : 'Abrir chamado'}
      </button>
    </li>
  );

  const renderSection = (meta: SectionMeta) => {
    const section = data?.sections[meta.key];
    if (!section) return null;
    const shown = section.items.length;
    const truncated = section.total > shown;
    return (
      <section className="dashboard-section" aria-labelledby={`section-${meta.key}-heading`}>
        <div className="section-heading-row">
          <div>
            <h2 className="section-heading" id={`section-${meta.key}-heading`}>{meta.title}</h2>
            <p className="muted-text">{meta.description}</p>
          </div>
          <span className="dashboard-count">
            {section.total} {section.total === 1 ? 'item' : 'itens'}
            {truncated && <span className="dashboard-limit-note"> · exibindo {shown} de {section.total}</span>}
          </span>
        </div>
        {section.items.length === 0 ? (
          <div className="empty-state" style={{ marginTop: 12 }}>
            <p className="empty-title">Nada por aqui no momento.</p>
            <p className="empty-description">{meta.title} sem itens.</p>
          </div>
        ) : (
          <ul className="dashboard-item-list">
            {section.items.map(renderItem)}
          </ul>
        )}
      </section>
    );
  };

  const renderWorkload = () => {
    if (!showWorkload || !data) return null;
    return (
      <section className="dashboard-section" aria-labelledby="section-workload-heading">
        <div className="section-heading-row">
          <div>
            <h2 className="section-heading" id="section-workload-heading">Carga da equipe</h2>
            <p className="muted-text">Volume de trabalho atual por pessoa.</p>
          </div>
        </div>
        {data.workload.length === 0 ? (
          <div className="empty-state" style={{ marginTop: 12 }}>
            <p className="empty-title">Sem dados de carga.</p>
            <p className="empty-description">Não há cargas para exibir no momento.</p>
          </div>
        ) : (
          <div className="workload-table-wrap">
            <table className="workload-table">
              <thead>
                <tr>
                  <th scope="col">Pessoa</th>
                  <th scope="col" className="text-right">Em produção</th>
                  <th scope="col" className="text-right">Dependendo de ação</th>
                  <th scope="col" className="text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {data.workload.map((row) => (
                  <tr key={row.userId}>
                    <td>
                      {row.name}
                      {!row.active && <span className="muted-dash"> · inativa(o)</span>}
                    </td>
                    <td className="text-right">{row.production}</td>
                    <td className="text-right">{row.awaitingAction}</td>
                    <td className="text-right"><strong>{row.total}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    );
  };

  const renderKanbanBoard = () => {
    if (!data) return null;

    // Consolidar tarefas únicas de todas as seções do Painel preservando reason (se houver em awaitingAction)
    const tasksById = new Map<string, DashboardItem>();
    const allSectionKeys: DashboardSectionKey[] = [
      'awaitingAction',
      'production',
      'overdueTasks',
      'dueToday',
      'upcoming',
      'urgent',
    ];

    for (const key of allSectionKeys) {
      const items = data.sections[key]?.items ?? [];
      for (const item of items) {
        if (item.kind !== 'task') continue;
        const existing = tasksById.get(item.id);
        if (!existing) {
          tasksById.set(item.id, item);
        } else if (!existing.reason && item.reason) {
          tasksById.set(item.id, { ...existing, reason: item.reason });
        }
      }
    }

    const allTasks = Array.from(tasksById.values());

    // Extrair lista única de responsáveis presentes ou do workload
    const assigneeMap = new Map<string, string>();
    for (const w of data.workload) {
      assigneeMap.set(w.userId, w.name);
    }
    for (const t of allTasks) {
      if (t.assignedTo) {
        assigneeMap.set(t.assignedTo.id, t.assignedTo.name);
      }
    }
    const assignees = Array.from(assigneeMap.entries()).map(([id, name]) => ({ id, name }));

    const normalizedQuery = kanbanSearch.trim().toLowerCase();

    const filteredTasks = allTasks.filter((task) => {
      if (kanbanPriorityFilter !== 'all' && task.priority !== kanbanPriorityFilter) {
        return false;
      }
      if (kanbanAssigneeFilter !== 'all' && task.assignedTo?.id !== kanbanAssigneeFilter) {
        return false;
      }
      if (normalizedQuery) {
        const haystack = `${task.title} ${task.demandTitle ?? ''} ${task.client.name} ${task.assignedTo?.name ?? ''}`.toLowerCase();
        if (!haystack.includes(normalizedQuery)) return false;
      }
      return true;
    });

    const overdueSet = new Set((data.sections.overdueTasks?.items ?? []).map((i) => i.id));
    const dueTodaySet = new Set((data.sections.dueToday?.items ?? []).map((i) => i.id));
    const overdueDemands = data.sections.overdueDemands?.items ?? [];

    return (
      <div className="dashboard-kanban-wrapper" aria-label="Quadro Kanban Operacional">
        {/* Barra de resumo rápida e filtros do Kanban */}
        <div className="kanban-controls-bar">
          <div className="kanban-search-group">
            <input
              type="search"
              className="kanban-search-input"
              placeholder="Filtrar por tarefa, chamado ou cliente…"
              aria-label="Filtrar cartões do Kanban"
              value={kanbanSearch}
              onChange={(e) => setKanbanSearch(e.target.value)}
            />
            {isAdmin && assignees.length > 0 && (
              <select
                className="kanban-filter-select"
                aria-label="Filtrar por responsável"
                value={kanbanAssigneeFilter}
                onChange={(e) => setKanbanAssigneeFilter(e.target.value)}
              >
                <option value="all">Todos os responsáveis</option>
                {assignees.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            )}
            <select
              className="kanban-filter-select"
              aria-label="Filtrar por prioridade"
              value={kanbanPriorityFilter}
              onChange={(e) => setKanbanPriorityFilter(e.target.value)}
            >
              <option value="all">Todas as prioridades</option>
              <option value="urgent">Urgente</option>
              <option value="high">Alta</option>
              <option value="normal">Normal</option>
              <option value="low">Baixa</option>
            </select>
            {(kanbanSearch || kanbanAssigneeFilter !== 'all' || kanbanPriorityFilter !== 'all') && (
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  setKanbanSearch('');
                  setKanbanAssigneeFilter('all');
                  setKanbanPriorityFilter('all');
                }}
              >
                Limpar filtros
              </button>
            )}
          </div>

          <div className="kanban-summary-pills">
            <span className="kanban-stat-pill">
              Total no quadro: <strong className="stat-value">{filteredTasks.length}</strong>
            </span>
            {data.sections.overdueTasks.total > 0 && (
              <span className="kanban-stat-pill pill-danger">
                Atrasadas: <strong className="stat-value">{data.sections.overdueTasks.total}</strong>
              </span>
            )}
            {data.sections.dueToday.total > 0 && (
              <span className="kanban-stat-pill pill-warning">
                Vencem hoje: <strong className="stat-value">{data.sections.dueToday.total}</strong>
              </span>
            )}
            {data.sections.urgent.total > 0 && (
              <span className="kanban-stat-pill pill-urgent">
                Urgentes: <strong className="stat-value">{data.sections.urgent.total}</strong>
              </span>
            )}
          </div>
        </div>

        {/* Alerta compacto de chamados com prazo vencido se houver */}
        {overdueDemands.length > 0 && (
          <div className="kanban-overdue-demands-bar" role="region" aria-label="Chamados com prazo vencido">
            <div className="kanban-overdue-demands-title">
              <span className="priority-badge urgent">Atenção</span>
              <strong>{data.sections.overdueDemands.total} chamado(s) com prazo de entrega vencido:</strong>
            </div>
            <div className="kanban-overdue-demands-list">
              {overdueDemands.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  className="kanban-overdue-demand-chip"
                  onClick={() => handleOpen(d)}
                >
                  <span>{d.title}</span>
                  <span className="muted-dash">({d.client.name} · {formatDate(d.deliveryDate)})</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Colunas do Quadro Kanban */}
        <div className="kanban-board-grid">
          {kanbanColumns.map((col) => {
            const colItems = filteredTasks.filter((t) => t.status === col.key);
            return (
              <section
                key={col.key}
                className={`kanban-column ${col.accentClass}`}
                aria-labelledby={`kanban-col-${col.key}-title`}
              >
                <header className="kanban-column-header">
                  <div className="kanban-column-title-row">
                    <div className="kanban-column-title-group">
                      <span className={`kanban-status-dot ${col.accentClass}`} aria-hidden="true" />
                      <h2 className="kanban-column-title" id={`kanban-col-${col.key}-title`}>
                        {col.title}
                      </h2>
                    </div>
                    <span className="kanban-column-count stat-value">{colItems.length}</span>
                  </div>
                  <p className="kanban-column-subtitle">{col.subtitle}</p>
                </header>

                <div className="kanban-column-body">
                  {colItems.length === 0 ? (
                    <div className="kanban-empty-slot">
                      <span>Nenhuma tarefa</span>
                    </div>
                  ) : (
                    <ul className="kanban-card-list">
                      {colItems.map((item) => {
                        const isOverdue = overdueSet.has(item.id) || item.deliveryDate < data.today;
                        const isDueToday = dueTodaySet.has(item.id) || item.deliveryDate === data.today;
                        return (
                          <li
                            key={item.id}
                            className={`kanban-card ${isOverdue ? 'is-overdue' : ''} ${item.priority === 'urgent' ? 'is-urgent' : ''}`}
                          >
                            <div className="kanban-card-top">
                              <span className="kanban-card-client">{item.client.name}</span>
                              <span className={`priority-badge ${item.priority}`}>
                                {priorityLabels[item.priority] ?? item.priority}
                              </span>
                            </div>

                            <h3 className="kanban-card-title">{item.title}</h3>

                            {item.demandTitle && (
                              <p className="kanban-card-demand">
                                Chamado: <strong>{item.demandTitle}</strong>
                              </p>
                            )}

                            {item.reason && (
                              <p className="kanban-card-reason">{item.reason}</p>
                            )}

                            <div className="kanban-card-footer">
                              <div className="kanban-card-meta">
                                <span
                                  className={`kanban-card-date ${
                                    isOverdue ? 'date-overdue' : isDueToday ? 'date-today' : ''
                                  }`}
                                >
                                  {isOverdue ? 'Atrasada · ' : isDueToday ? 'Hoje · ' : 'Entrega: '}
                                  <strong>{formatDate(item.deliveryDate)}</strong>
                                </span>
                                {item.assignedTo && (
                                  <span className="kanban-card-assignee" title={`Responsável: ${item.assignedTo.name}`}>
                                    <span className="assignee-avatar" aria-hidden="true">
                                      {item.assignedTo.name.charAt(0).toUpperCase()}
                                    </span>
                                    <span>{item.assignedTo.name}</span>
                                  </span>
                                )}
                              </div>

                              <button
                                type="button"
                                className="action-btn edit kanban-open-btn"
                                onClick={() => handleOpen(item)}
                              >
                                Abrir tarefa
                              </button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </section>
            );
          })}
        </div>

        {renderWorkload()}
      </div>
    );
  };

  const updatedAtLabel = updatedAt
    ? `${error && hasDataRef.current ? 'Dados da última atualização: ' : 'Atualizado '}${formatDateTime(updatedAt)}`
    : undefined;

  return (
    <section className="view-panel" aria-labelledby="dashboard-heading">
      <div className="panel-header">
        <div>
          <h1 id="dashboard-heading">Painel</h1>
          <p className="panel-subtitle">
            {data && data.scope === 'assigned'
              ? 'Visão das entregas atribuídas a você.'
              : 'Acompanhe a produção, as pendências e a carga da equipe.'}
          </p>
        </div>
        <div className="dashboard-toolbar">
          {updatedAtLabel && <span className="dashboard-updated-at">{updatedAtLabel}</span>}
          <div className="dashboard-view-switcher" role="group" aria-label="Modo de visualização do Painel">
            <button
              type="button"
              className={`view-switch-btn ${viewMode === 'list' ? 'active' : ''}`}
              onClick={() => handleSelectViewMode('list')}
              aria-pressed={viewMode === 'list'}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="8" y1="6" x2="21" y2="6" />
                <line x1="8" y1="12" x2="21" y2="12" />
                <line x1="8" y1="18" x2="21" y2="18" />
                <line x1="3" y1="6" x2="3.01" y2="6" />
                <line x1="3" y1="12" x2="3.01" y2="12" />
                <line x1="3" y1="18" x2="3.01" y2="18" />
              </svg>
              <span>Lista</span>
            </button>
            <button
              type="button"
              className={`view-switch-btn ${viewMode === 'kanban' ? 'active' : ''}`}
              onClick={() => handleSelectViewMode('kanban')}
              aria-pressed={viewMode === 'kanban'}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="3" width="5" height="18" rx="1" />
                <rect x="10" y="3" width="5" height="12" rx="1" />
                <rect x="17" y="3" width="5" height="15" rx="1" />
              </svg>
              <span>Kanban</span>
            </button>
          </div>
          <button
            type="button"
            className="secondary-button"
            onClick={() => void load(true)}
            disabled={loading || refreshing}
          >
            {refreshing ? 'Atualizando…' : 'Atualizar'}
          </button>
        </div>
      </div>

      {error && (
        <div className="alert-banner error" role="alert" style={{ marginBottom: 16 }}>
          <span>{error}</span>
          <button
            type="button"
            className="primary-button small"
            onClick={() => void load(false)}
            disabled={loading}
          >
            Tentar novamente
          </button>
        </div>
      )}

      {loading && !data ? (
        <div className="dashboard-skeleton" role="status" aria-live="polite">
          <span className="sr-only">Carregando o Painel…</span>
          <div className="skeleton-line" />
          <div className="skeleton-line" />
          <div className="skeleton-line" />
        </div>
      ) : data ? (
        viewMode === 'kanban' ? (
          renderKanbanBoard()
        ) : (
          <div className="dashboard-sections">
            {topSections.map(renderSection)}

            <section className="dashboard-section dashboard-section-pending" aria-labelledby="section-pending-heading">
              <div className="section-heading-row">
                <div>
                  <h2 className="section-heading" id="section-pending-heading">Pendências</h2>
                  <p className="muted-text">
                    Atrasos, vencimentos e urgências que pedem atenção.
                  </p>
                </div>
              </div>
              <div className="dashboard-pending-groups">
                {pendingSections.map(renderSection)}
              </div>
            </section>

            {renderWorkload()}
          </div>
        )
      ) : null}
    </section>
  );
}
