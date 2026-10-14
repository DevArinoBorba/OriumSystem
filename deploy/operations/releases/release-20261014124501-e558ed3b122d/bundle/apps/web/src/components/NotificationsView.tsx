import { useCallback, useEffect, useRef, useState } from 'react';
import type { Notification, NotificationKind, NotificationListResponse, SessionResponse } from '@orium/contracts';
import { api, ApiError } from '../api.js';

interface NotificationsViewProps {
  session: SessionResponse;
  onUnauthorized: () => void;
  onOpenItem: (target: { demandId: string; taskId?: string }) => void;
  refreshUnread: () => Promise<void>;
}

const PAGE_SIZE = 20;

const KIND_LABELS: Record<NotificationKind, string> = {
  task_assigned: 'Tarefa atribuída a você',
  task_unblocked: 'Tarefa desbloqueada',
  task_comment: 'Novo comentário na tarefa',
  task_review_submitted: 'Enviada para revisão',
  task_changes_requested: 'Ajustes solicitados',
  task_approved: 'Tarefa aprovada',
  task_important_change: 'Mudança importante na tarefa',
  demand_important_change: 'Mudança importante no chamado',
  task_due_today: 'Tarefa vence hoje',
  task_due_soon: 'Prazo próximo',
  task_overdue: 'Tarefa atrasada',
  demand_overdue: 'Chamado com prazo vencido',
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

export function NotificationsView({
  session,
  onUnauthorized,
  onOpenItem,
  refreshUnread,
}: NotificationsViewProps) {
  const isAdmin = session.roles.includes('administrator');
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());
  const hasDataRef = useRef(false);
  const requestRef = useRef<AbortController | null>(null);
  const markRequestsRef = useRef(new Map<string, AbortController>());
  const filtersRef = useRef({ page, unreadOnly });
  filtersRef.current = { page, unreadOnly };

  const load = useCallback(
    async (options?: { silent?: boolean }) => {
      const { page: pageToLoad, unreadOnly: unreadOnlyToLoad } = filtersRef.current;
      const silent = options?.silent === true;
      requestRef.current?.abort();
      const controller = new AbortController();
      requestRef.current = controller;
      if (!silent) {
        if (!hasDataRef.current) {
          setLoading(true);
          setError(null);
        } else {
          setUpdating(true);
        }
      }
      try {
        const response: NotificationListResponse = await api.listNotifications(
          { page: pageToLoad, pageSize: PAGE_SIZE, unreadOnly: unreadOnlyToLoad },
          controller.signal,
          () => {
            if (requestRef.current === controller && !controller.signal.aborted) onUnauthorized();
          },
        );
        if (requestRef.current === controller && !controller.signal.aborted) {
          setNotifications(response.notifications);
          setTotal(response.total);
          setPage(response.page);
          setUpdatedAt(response.updatedAt);
          hasDataRef.current = true;
          setError(null);
        }
      } catch (err) {
        if (controller.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) return;
        if (requestRef.current === controller) {
          if (err instanceof ApiError && err.status === 403) {
            setNotifications([]);
            setTotal(0);
            setUpdatedAt(null);
            hasDataRef.current = false;
            setError('Acesso às notificações foi revogado. Fale com um administrador.');
            void refreshUnread();
          } else if (err instanceof ApiError && err.status === 404) {
            // Recurso deixou de ser visível: recarrega a página atual
            void load({ silent: true });
          } else if (hasDataRef.current) {
            setError('Não foi possível atualizar as notificações. Mostrando a última atualização.');
          } else {
            setError('Não foi possível carregar as notificações. Tente novamente.');
          }
        }
      } finally {
        if (requestRef.current === controller) {
          setLoading(false);
          setUpdating(false);
          requestRef.current = null;
        }
      }
    },
    [onUnauthorized, refreshUnread],
  );

  // Carga inicial e reload quando filtro/página muda
  useEffect(() => {
    void load();
  }, [load, page, unreadOnly]);

  useEffect(() => () => {
    for (const controller of markRequestsRef.current.values()) controller.abort();
    markRequestsRef.current.clear();
  }, []);

  // Atualização silenciosa: só com documento visível, 60s + retorno ao foco
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === 'visible') {
        void load({ silent: true });
      }
    };
    window.addEventListener('focus', tick);
    const interval = window.setInterval(tick, 60_000);
    return () => {
      window.removeEventListener('focus', tick);
      window.clearInterval(interval);
      requestRef.current?.abort();
    };
  }, [load]);

  const handleFilterChange = (next: boolean) => {
    setUnreadOnly(next);
    setPage(1);
    // load é disparado pelo efeito acima após o render batched
  };

  const handleMarkRead = async (notification: Notification) => {
    if (markRequestsRef.current.has(notification.id)) return;
    const controller = new AbortController();
    markRequestsRef.current.set(notification.id, controller);
    setBusyIds((prev) => new Set(prev).add(notification.id));
    requestRef.current?.abort();
    try {
      await api.markNotificationRead(notification.id, controller.signal, () => {
        if (markRequestsRef.current.get(notification.id) === controller && !controller.signal.aborted) onUnauthorized();
      });
      if (controller.signal.aborted) return;
      // Depois do sucesso real do POST, recarrega lista/contador;
      // 404 remove/recarrega (item sem acesso) — tratado no load acima.
      await load({ silent: true });
      if (!controller.signal.aborted) await refreshUnread();
    } catch (err) {
      if (controller.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) return;
      if (err instanceof ApiError && err.status === 404) {
        // item deixou de ser visível — recarrega a lista
        await load({ silent: true });
      } else if (err instanceof ApiError && err.status === 403) {
        setNotifications([]);
        setTotal(0);
        setUpdatedAt(null);
        hasDataRef.current = false;
        setError('Acesso às notificações foi revogado. Fale com um administrador.');
        await refreshUnread();
      } else if (!(err instanceof ApiError && err.status === 401)) {
        setError('Não foi possível marcar como lida essa notificação. Tente novamente.');
      }
    } finally {
      if (markRequestsRef.current.get(notification.id) === controller) {
        markRequestsRef.current.delete(notification.id);
      }
      if (!controller.signal.aborted) setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(notification.id);
        return next;
      });
    }
  };

  const handleOpen = (notification: Notification) => {
    // Abrir não marca como lido implicitamente
    onOpenItem(notification.taskId
      ? { demandId: notification.demandId, taskId: notification.taskId }
      : { demandId: notification.demandId });
  };

  const hasData = hasDataRef.current || notifications.length > 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <section className="view-panel" aria-labelledby="notifications-heading">
      <div className="panel-header">
        <div>
          <h1 id="notifications-heading">Notificações</h1>
          <p className="panel-subtitle">
            Avisos pessoais {isAdmin ? 'administrativos' : 'de trabalho'} e prazos.
          </p>
        </div>
        <div className="dashboard-toolbar">
          {updatedAt && (
            <span className="dashboard-updated-at">Atualizado {formatDateTime(updatedAt)}</span>
          )}
          <button
            type="button"
            className="secondary-button"
            onClick={() => void load()}
            disabled={loading || updating}
          >
            {updating ? 'Atualizando…' : 'Atualizar'}
          </button>
        </div>
      </div>

      {error && (
        <div className="alert-banner error" role="alert" style={{ marginBottom: 16 }}>
          <span>{error}</span>
          <button
            type="button"
            className="primary-button small"
            onClick={() => void load()}
            disabled={loading}
          >
            Tentar novamente
          </button>
        </div>
      )}

      {loading && !hasData ? (
        <div className="dashboard-skeleton" role="status" aria-live="polite">
          <span className="sr-only">Carregando notificações…</span>
          <div className="skeleton-line" />
          <div className="skeleton-line" />
          <div className="skeleton-line" />
        </div>
      ) : (
        <>
          <div className="toolbar" style={{ display: 'inline-flex' as const }}>
            <div className="filter-group">
              <span className="filter-label">Filtro</span>
              <button
                type="button"
                className={`filter-button ${!unreadOnly ? 'active' : ''}`}
                onClick={() => handleFilterChange(false)}
                aria-pressed={!unreadOnly}
              >
                Todos
              </button>
              <button
                type="button"
                className={`filter-button ${unreadOnly ? 'active' : ''}`}
                onClick={() => handleFilterChange(true)}
                aria-pressed={unreadOnly}
              >
                Não lidos
              </button>
            </div>
          </div>

          {notifications.length === 0 ? (
            <div className="empty-state">
              <p className="empty-title">
                {unreadOnly ? 'Nenhuma notificação não lida.' : 'Nenhuma notificação no momento.'}
              </p>
              <p className="empty-description">
                {unreadOnly
                  ? 'Você está em dia.'
                  : 'Avisos sobre suas tarefas e prazos aparecerão aqui.'}
              </p>
            </div>
          ) : (
            <>
              <ul className="notifications-list">
                {notifications.map((notification) => (
                  <li
                    key={notification.id}
                    className={`notification-item${notification.readAt ? '' : ' unread'}`}
                  >
                    <div className="notification-item-main">
                      <div className="notification-item-title">
                        <span className={`notification-kind${notification.readAt ? '' : ' unread'}`}>
                          {KIND_LABELS[notification.kind] ?? notification.kind}
                        </span>
                        {!notification.readAt && (
                          <span className="notification-unread-dot" aria-label="Não lida" />
                        )}
                      </div>
                      <div className="notification-item-meta">
                        {notification.taskTitle ? (
                          <span>Você foi notificado sobre a tarefa <strong>{notification.taskTitle}</strong> no chamado <strong>{notification.demandTitle}</strong>.</span>
                        ) : (
                          <span>Chamado <strong>{notification.demandTitle}</strong>.</span>
                        )}
                      </div>
                      {notification.deliveryDate && (
                        <div className="notification-delivery">
                          Prazo: <strong>{formatDate(notification.deliveryDate)}</strong>
                        </div>
                      )}
                      <div className="notification-meta-row">
                        <span className="muted-notification">{formatDateTime(notification.createdAt)}</span>
                      </div>
                    </div>
                    <div className="notification-actions">
                      {!notification.readAt && (
                        <button
                          type="button"
                          className="action-btn edit"
                          onClick={() => void handleMarkRead(notification)}
                          disabled={busyIds.has(notification.id) || loading || updating}
                        >
                          {busyIds.has(notification.id) ? 'Marcando…' : 'Marcar como lida'}
                        </button>
                      )}
                      <button
                        type="button"
                        className="action-btn secondary"
                        onClick={() => handleOpen(notification)}
                        disabled={loading || updating}
                      >
                        {notification.taskId ? 'Abrir tarefa' : 'Abrir chamado'}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>

              <div className="pagination-bar">
                <span className="pagination-info">
                  Página {page} de {totalPages} ({total} {total === 1 ? 'notificação' : 'notificações'})
                </span>
                <div className="pagination-controls">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1 || loading || updating}
                  >
                    Anterior
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages || loading || updating}
                  >
                    Próxima
                  </button>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
