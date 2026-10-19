import { useCallback, useEffect, useRef, useState } from 'react';
import type { DashboardItem, DashboardResponse, SessionResponse } from '@orium/contracts';
import { api, ApiError } from '../api.js';
import { formatCalendarDate, relativeDeadline } from '../dates.js';
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

const formatDate = formatCalendarDate;

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Atualização automática silenciosa enquanto a aba está visível. */
const AUTO_REFRESH_MS = 120_000;

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

type KanbanQuickFilter = 'all' | 'mine' | 'overdue' | 'dueToday' | 'urgent';

interface KanbanColumnMeta {
  key: string;
  title: string;
  subtitle: string;
  accentClass: string;
  iconType: 'blocked' | 'ready' | 'production' | 'review' | 'changes' | 'paused';
  statuses: string[];
}

const kanbanColumns: KanbanColumnMeta[] = [
  {
    key: 'blocked',
    title: 'Aguardando / Bloqueadas',
    subtitle: 'Dependências, requisitos ou pausas',
    accentClass: 'col-blocked',
    iconType: 'blocked',
    statuses: ['blocked', 'paused'],
  },
  {
    key: 'ready',
    title: 'Prontas para Iniciar',
    subtitle: 'Requisitos atendidos p/ produção',
    accentClass: 'col-ready',
    iconType: 'ready',
    statuses: ['ready'],
  },
  {
    key: 'in_production',
    title: 'Em Produção',
    subtitle: 'Relógio operacional em andamento',
    accentClass: 'col-production',
    iconType: 'production',
    statuses: ['in_production'],
  },
  {
    key: 'in_review',
    title: 'Em Revisão / Ajustes',
    subtitle: 'Avaliação e refinamento de entrega',
    accentClass: 'col-review',
    iconType: 'review',
    statuses: ['in_review', 'changes_requested'],
  },
];

function renderColumnIcon(type: KanbanColumnMeta['iconType']) {
  switch (type) {
    case 'blocked':
      return (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
        </svg>
      );
    case 'ready':
      return (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      );
    case 'production':
      return (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polygon points="5 3 19 12 5 21 5 3" />
        </svg>
      );
    case 'review':
      return (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      );
    case 'changes':
      return (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
        </svg>
      );
    case 'paused':
      return (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="6" y="4" width="4" height="16" />
          <rect x="14" y="4" width="4" height="16" />
        </svg>
      );
  }
}

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
  const [kanbanQuickFilter, setKanbanQuickFilter] = useState<KanbanQuickFilter>('all');
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

  // Mantém o Painel atual sem clique: a cada 2 min com a aba visível e ao voltar para ela.
  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible' && hasDataRef.current && !requestRef.current) {
        void load(true);
      }
    };
    const interval = window.setInterval(refreshIfVisible, AUTO_REFRESH_MS);
    document.addEventListener('visibilitychange', refreshIfVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', refreshIfVisible);
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
    <li
      key={item.id}
      className="dashboard-item"
      onClick={() => handleOpen(item)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleOpen(item);
        }
      }}
      aria-label={`Abrir ${item.kind === 'task' ? 'tarefa' : 'chamado'} ${item.title}`}
    >
      <div className="dashboard-item-main">
        <div className="dashboard-item-title">
          <span className={`dashboard-kind ${item.kind}`}>{item.kind === 'task' ? 'Tarefa' : 'Chamado'}</span>
          <span className="dashboard-title-text">{item.title}</span>
          <span className={`priority-badge ${item.priority}`}>{priorityLabels[item.priority] ?? item.priority}</span>
        </div>
        <div className="dashboard-item-meta">
          {item.demandTitle && <span className="muted-dash">Chamado: <strong>{item.demandTitle}</strong></span>}
          <span>Cliente: <strong>{item.client.name}</strong></span>
          <span>
            Entrega: <strong>{formatDate(item.deliveryDate)}</strong>
            {(() => {
              const rel = data && item.status !== 'completed' ? relativeDeadline(item.deliveryDate, data.today) : null;
              return rel ? <span className={`deadline-chip ${rel.tone}`}>{rel.label}</span> : null;
            })()}
          </span>
          {item.status && <span className={`status-badge ${item.status === 'completed' ? 'complete' : 'open'}`}>{statusLabelFor(item)}</span>}
          {item.kind === 'task' && item.assignedTo ? (
            <span>Responsável: <strong>{item.assignedTo.name}</strong></span>
          ) : null}
        </div>
        {item.reason && <p className="dashboard-item-reason">{item.reason}</p>}
      </div>
      <span className="action-btn edit dashboard-open-btn" aria-hidden="true">
        <span>{item.kind === 'task' ? 'Abrir tarefa' : 'Abrir chamado'}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </span>
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

    const overdueSet = new Set((data.sections.overdueTasks?.items ?? []).map((i) => i.id));
    const dueTodaySet = new Set((data.sections.dueToday?.items ?? []).map((i) => i.id));
    const overdueDemands = data.sections.overdueDemands?.items ?? [];

    const myTasksCount = allTasks.filter((t) => t.assignedTo?.id === session.user.id).length;
    const overdueCount = allTasks.filter((t) => overdueSet.has(t.id) || t.deliveryDate < data.today).length;
    const dueTodayCount = allTasks.filter((t) => dueTodaySet.has(t.id) || t.deliveryDate === data.today).length;
    const urgentCount = allTasks.filter((t) => t.priority === 'urgent').length;

    const normalizedQuery = kanbanSearch.trim().toLowerCase();

    const filteredTasks = allTasks.filter((task) => {
      const isOverdue = overdueSet.has(task.id) || task.deliveryDate < data.today;
      const isDueToday = dueTodaySet.has(task.id) || task.deliveryDate === data.today;

      // Filtro Rápido ativo
      if (kanbanQuickFilter === 'mine' && task.assignedTo?.id !== session.user.id) {
        return false;
      }
      if (kanbanQuickFilter === 'overdue' && !isOverdue) {
        return false;
      }
      if (kanbanQuickFilter === 'dueToday' && !isDueToday) {
        return false;
      }
      if (kanbanQuickFilter === 'urgent' && task.priority !== 'urgent') {
        return false;
      }

      // Filtros específicos
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

    const isFiltered =
      Boolean(kanbanSearch) ||
      kanbanAssigneeFilter !== 'all' ||
      kanbanPriorityFilter !== 'all' ||
      kanbanQuickFilter !== 'all';

    return (
      <div className="dashboard-kanban-wrapper" aria-label="Quadro Kanban Operacional">
        {/* Barra de resumo rápida e filtros interativos do Kanban */}
        <div className="kanban-controls-bar">
          <div className="kanban-quick-row">
            <div className="kanban-quick-filters" role="group" aria-label="Filtros rápidos do Kanban">
              <button
                type="button"
                className={`kanban-quick-pill ${kanbanQuickFilter === 'all' ? 'active' : ''}`}
                onClick={() => setKanbanQuickFilter('all')}
                title="Mostrar todas as tarefas"
              >
                <span>Todas</span>
                <span className="quick-pill-badge">{allTasks.length}</span>
              </button>

              {session.user?.id && (
                <button
                  type="button"
                  className={`kanban-quick-pill ${kanbanQuickFilter === 'mine' ? 'active' : ''}`}
                  onClick={() => setKanbanQuickFilter((curr) => (curr === 'mine' ? 'all' : 'mine'))}
                  title="Ver apenas tarefas atribuídas a você"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                  <span>Minhas tarefas</span>
                  <span className="quick-pill-badge">{myTasksCount}</span>
                </button>
              )}

              {overdueCount > 0 && (
                <button
                  type="button"
                  className={`kanban-quick-pill pill-danger ${kanbanQuickFilter === 'overdue' ? 'active' : ''}`}
                  onClick={() => setKanbanQuickFilter((curr) => (curr === 'overdue' ? 'all' : 'overdue'))}
                  title="Filtrar tarefas atrasadas"
                >
                  <span className="quick-pill-dot danger" aria-hidden="true" />
                  <span>Atrasadas</span>
                  <span className="quick-pill-badge danger">{overdueCount}</span>
                </button>
              )}

              {dueTodayCount > 0 && (
                <button
                  type="button"
                  className={`kanban-quick-pill pill-warning ${kanbanQuickFilter === 'dueToday' ? 'active' : ''}`}
                  onClick={() => setKanbanQuickFilter((curr) => (curr === 'dueToday' ? 'all' : 'dueToday'))}
                  title="Filtrar tarefas que vencem hoje"
                >
                  <span className="quick-pill-dot warning" aria-hidden="true" />
                  <span>Vencem hoje</span>
                  <span className="quick-pill-badge warning">{dueTodayCount}</span>
                </button>
              )}

              {urgentCount > 0 && (
                <button
                  type="button"
                  className={`kanban-quick-pill pill-urgent ${kanbanQuickFilter === 'urgent' ? 'active' : ''}`}
                  onClick={() => setKanbanQuickFilter((curr) => (curr === 'urgent' ? 'all' : 'urgent'))}
                  title="Filtrar tarefas com prioridade urgente"
                >
                  <span className="quick-pill-dot urgent" aria-hidden="true" />
                  <span>Urgentes</span>
                  <span className="quick-pill-badge urgent">{urgentCount}</span>
                </button>
              )}
            </div>

            <div className="kanban-stat-counter">
              <span>
                Exibindo <strong>{filteredTasks.length}</strong> de <strong>{allTasks.length}</strong> tarefas
              </span>
            </div>
          </div>

          <div className="kanban-filter-row">
            <div className="kanban-search-box">
              <svg className="search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="text"
                className="kanban-search-input"
                placeholder="Buscar tarefa, cliente, chamado…"
                aria-label="Buscar cartões do Kanban"
                value={kanbanSearch}
                onChange={(e) => setKanbanSearch(e.target.value)}
              />
              {kanbanSearch && (
                <button
                  type="button"
                  className="search-clear-btn"
                  onClick={() => setKanbanSearch('')}
                  aria-label="Limpar texto da busca"
                  title="Limpar busca"
                >
                  ✕
                </button>
              )}
            </div>

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

            {isFiltered && (
              <button
                type="button"
                className="kanban-clear-filters-btn"
                onClick={() => {
                  setKanbanSearch('');
                  setKanbanAssigneeFilter('all');
                  setKanbanPriorityFilter('all');
                  setKanbanQuickFilter('all');
                }}
                title="Limpar todos os filtros aplicados"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
                <span>Limpar filtros</span>
              </button>
            )}
          </div>
        </div>

        {/* Alerta de chamados com prazo vencido se houver */}
        {overdueDemands.length > 0 && (
          <div className="kanban-overdue-demands-bar" role="region" aria-label="Chamados com prazo vencido">
            <div className="kanban-overdue-demands-title">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
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
                  <span className="chip-title">{d.title}</span>
                  <span className="chip-meta">{d.client.name} · {formatDate(d.deliveryDate)}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Colunas do Quadro Kanban */}
        <div className="kanban-board-grid">
          {kanbanColumns.map((col) => {
            const colItems = filteredTasks.filter((t) => col.statuses.includes(t.status));
            const colOverdueCount = colItems.filter(
              (t) => overdueSet.has(t.id) || t.deliveryDate < data.today
            ).length;

            return (
              <section
                key={col.key}
                className={`kanban-column ${col.accentClass}`}
                aria-labelledby={`kanban-col-${col.key}-title`}
              >
                <header className="kanban-column-header">
                  <div className="kanban-column-title-row">
                    <div className="kanban-column-title-group">
                      <span className={`kanban-status-icon-badge ${col.accentClass}`} aria-hidden="true">
                        {renderColumnIcon(col.iconType)}
                      </span>
                      <h2 className="kanban-column-title" id={`kanban-col-${col.key}-title`}>
                        {col.title}
                      </h2>
                    </div>
                    <div className="kanban-column-header-badges">
                      {colOverdueCount > 0 && (
                        <span className="kanban-col-alert-tag" title={`${colOverdueCount} tarefa(s) atrasada(s)`}>
                          {colOverdueCount} atrasada{colOverdueCount > 1 ? 's' : ''}
                        </span>
                      )}
                      <span className={`kanban-column-count stat-value ${col.accentClass}`}>{colItems.length}</span>
                    </div>
                  </div>
                  <p className="kanban-column-subtitle">{col.subtitle}</p>
                </header>

                <div className="kanban-column-body">
                  {colItems.length === 0 ? (
                    <div className="kanban-empty-slot">
                      <div className="kanban-empty-icon" aria-hidden="true">
                        {renderColumnIcon(col.iconType)}
                      </div>
                      <span className="kanban-empty-title">Nenhuma tarefa</span>
                      <span className="kanban-empty-desc">Nenhum item nesta etapa</span>
                    </div>
                  ) : (
                    <ul className="kanban-card-list">
                      {colItems.map((item) => {
                        const isOverdue = overdueSet.has(item.id) || item.deliveryDate < data.today;
                        const isDueToday = dueTodaySet.has(item.id) || item.deliveryDate === data.today;
                        const rel = relativeDeadline(item.deliveryDate, data.today);
                        const isSoon = !isOverdue && !isDueToday && rel?.tone === 'soon';
                        const dateText = isOverdue
                          ? rel?.tone === 'overdue'
                            ? capitalize(rel.label)
                            : `Atrasada · ${formatDate(item.deliveryDate)}`
                          : isDueToday
                            ? 'Hoje'
                            : isSoon && rel
                              ? capitalize(rel.label)
                              : formatDate(item.deliveryDate);

                        return (
                          <li
                            key={item.id}
                            className={`kanban-card ${isOverdue ? 'is-overdue' : ''} ${item.priority === 'urgent' ? 'is-urgent' : ''}`}
                            onClick={() => handleOpen(item)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                handleOpen(item);
                              }
                            }}
                            tabIndex={0}
                            role="button"
                            aria-label={`Abrir detalhes da tarefa ${item.title}`}
                          >
                            <div className="kanban-card-top">
                              <div className="kanban-card-top-row">
                                <span className="kanban-card-client" title={`Cliente: ${item.client.name}`}>
                                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                    <rect x="4" y="2" width="16" height="20" rx="2" />
                                    <line x1="9" y1="6" x2="9" y2="6.01" />
                                    <line x1="15" y1="6" x2="15" y2="6.01" />
                                    <line x1="9" y1="10" x2="9" y2="10.01" />
                                    <line x1="15" y1="10" x2="15" y2="10.01" />
                                    <line x1="9" y1="14" x2="9" y2="14.01" />
                                    <line x1="15" y1="14" x2="15" y2="14.01" />
                                    <line x1="9" y1="18" x2="15" y2="18" />
                                  </svg>
                                  <span>{item.client.name}</span>
                                </span>

                                <span className={`priority-badge ${item.priority}`}>
                                  {priorityLabels[item.priority] ?? item.priority}
                                </span>
                              </div>

                              {item.demandTitle && (
                                <div className="kanban-card-sub-row">
                                  <span className="kanban-card-demand-tag" title={`Chamado: ${item.demandTitle}`}>
                                    #{item.demandTitle}
                                  </span>
                                </div>
                              )}
                            </div>

                            <h3 className="kanban-card-title">{item.title}</h3>

                            {(() => {
                              const isBoilerplate =
                                item.reason === 'Pronta aguardando início da produção' ||
                                item.reason === 'Pronta aguardando aceite do responsável' ||
                                item.reason === 'Submetida para revisão (aguardando avaliação do administrador)' ||
                                item.reason === 'Bloqueada por requisitos ou dependências pendentes' ||
                                item.reason === 'Aguardando ação operacional';
                              if (!item.reason || isBoilerplate) return null;
                              return (
                                <div className="kanban-card-reason">
                                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                    <circle cx="12" cy="12" r="10" />
                                    <line x1="12" y1="8" x2="12" y2="12" />
                                    <line x1="12" y1="16" x2="12.01" y2="16" />
                                  </svg>
                                  <span>{item.reason}</span>
                                </div>
                              );
                            })()}

                            <div className="kanban-card-footer">
                              <div className="kanban-card-meta">
                                {item.assignedTo ? (
                                  <span className="kanban-card-assignee" title={`Responsável: ${item.assignedTo.name}`}>
                                    <span className="assignee-avatar" aria-hidden="true">
                                      {item.assignedTo.name.charAt(0).toUpperCase()}
                                    </span>
                                    <span className="assignee-name">{item.assignedTo.name.split(' ')[0]}</span>
                                  </span>
                                ) : (
                                  <span className="kanban-card-unassigned" title="Sem responsável atribuído">
                                    Sem resp.
                                  </span>
                                )}

                                <span
                                  className={`kanban-card-date-badge ${
                                    isOverdue ? 'date-overdue' : isDueToday ? 'date-today' : isSoon ? 'date-soon' : ''
                                  }`}
                                  title={`Entrega: ${formatDate(item.deliveryDate)}`}
                                >
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                    <circle cx="12" cy="12" r="10" />
                                    <polyline points="12 6 12 12 16 14" />
                                  </svg>
                                  <span>
                                    {dateText}
                                  </span>
                                </span>
                              </div>
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
