import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Demand, SessionResponse, Task, TaskComment } from '@orium/contracts';
import { api, ApiError } from '../api.js';
import { ensurePushSubscription, triggerServerTestPush } from '../pushClient.js';

interface MobileAppViewProps {
  session: SessionResponse;
  unreadCount: number | null;
  onUnauthorized: () => void;
  onOpenItem: (target: { demandId: string; taskId?: string }) => void;
  onOpenNotifications: () => void;
}

type TaskWithContext = {
  task: Task;
  demandTitle: string;
  clientName: string;
};

type QuickFilter = 'mine' | 'ready_prod' | 'review' | 'all';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const statusLabels: Record<string, string> = {
  blocked: 'Bloqueada',
  ready: 'Pronta p/ iniciar',
  in_production: 'Em produção',
  in_review: 'Em revisão',
  changes_requested: 'Ajustes solicitados',
  paused: 'Pausada',
  completed: 'Concluída',
};

const priorityLabels: Record<string, string> = {
  low: 'Baixa',
  normal: 'Normal',
  high: 'Alta',
  urgent: 'Urgente',
};

function formatDateBr(dateStr: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) return dateStr;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

export function MobileAppView({
  session,
  unreadCount,
  onUnauthorized,
  onOpenItem,
  onOpenNotifications,
}: MobileAppViewProps) {
  const isAdmin = session.roles.includes('administrator');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [demands, setDemands] = useState<Demand[]>([]);
  const [tasksWithCtx, setTasksWithCtx] = useState<TaskWithContext[]>([]);
  const [clientMap, setClientMap] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<QuickFilter>(isAdmin ? 'all' : 'mine');

  // Action busy state per taskId
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);

  // Inline review submission state
  const [reviewFormTaskId, setReviewFormTaskId] = useState<string | null>(null);
  const [deliveryNotes, setDeliveryNotes] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');

  // Inline comments state
  const [openCommentsTaskId, setOpenCommentsTaskId] = useState<string | null>(null);
  const [commentsByTask, setCommentsByTask] = useState<Record<string, TaskComment[]>>({});
  const [loadingCommentsTaskId, setLoadingCommentsTaskId] = useState<string | null>(null);
  const [newCommentText, setNewCommentText] = useState('');
  const [sendingComment, setSendingComment] = useState(false);

  // PWA & Push Notifications state
  const [pushPermission, setPushPermission] = useState<NotificationPermission>(
    typeof Notification !== 'undefined' ? Notification.permission : 'default',
  );
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const activeReqRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const loadData = useCallback(async () => {
    activeReqRef.current?.abort();
    const controller = new AbortController();
    activeReqRef.current = controller;
    setLoading(true);
    setError(null);

    try {
      const [demandsRes, clientsRes] = await Promise.all([
        api.listDemands({ status: 'open', page: 1, pageSize: 25 }, controller.signal, onUnauthorized),
        session.permissions.includes('clients.read')
          ? api.listClients({ status: 'active', page: 1, pageSize: 50 }, controller.signal, onUnauthorized).catch(() => ({ clients: [] }))
          : Promise.resolve({ clients: [] }),
      ]);

      const cMap: Record<string, string> = {};
      for (const c of clientsRes.clients) {
        cMap[c.id] = c.name;
      }
      setClientMap(cMap);
      setDemands(demandsRes.demands);

      const details = await Promise.all(
        demandsRes.demands.slice(0, 15).map((d: Demand) =>
          api
            .getDemand(d.id, controller.signal, onUnauthorized)
            .then((res) => ({
              demand: res.demand,
              tasks: res.tasks,
            }))
            .catch(() => null),
        ),
      );

      const allTasks: TaskWithContext[] = [];
      for (const item of details) {
        if (!item) continue;
        const cName = cMap[item.demand.clientId] || 'Cliente Orium';
        for (const t of item.tasks) {
          if (t.status !== 'completed') {
            allTasks.push({
              task: t,
              demandTitle: item.demand.title,
              clientName: cName,
            });
          }
        }
      }

      allTasks.sort((a, b) => a.task.deliveryDate.localeCompare(b.task.deliveryDate));
      setTasksWithCtx(allTasks);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError('Não foi possível carregar suas tarefas rápidas. Tente atualizar.');
    } finally {
      if (activeReqRef.current === controller) {
        setLoading(false);
      }
    }
  }, [onUnauthorized, session.permissions]);

  useEffect(() => {
    void loadData();
    return () => activeReqRef.current?.abort();
  }, [loadData]);

  const kpis = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    let inProduction = 0;
    let ready = 0;
    let inReview = 0;
    let urgentOrOverdue = 0;

    for (const { task } of tasksWithCtx) {
      if (task.status === 'in_production') inProduction++;
      if (task.status === 'ready' || task.status === 'changes_requested') ready++;
      if (task.status === 'in_review') inReview++;
      if (task.priority === 'urgent' || task.deliveryDate < today) urgentOrOverdue++;
    }
    return { inProduction, ready, inReview, urgentOrOverdue };
  }, [tasksWithCtx]);

  const filteredTasks = useMemo(() => {
    return tasksWithCtx.filter(({ task }) => {
      if (filter === 'mine') return task.assignedToUserId === session.user.id;
      if (filter === 'ready_prod') {
        return task.status === 'ready' || task.status === 'in_production' || task.status === 'changes_requested';
      }
      if (filter === 'review') return task.status === 'in_review';
      return true;
    });
  }, [tasksWithCtx, filter, session.user.id]);

  async function handleQuickAccept(t: Task) {
    if (busyTaskId) return;
    setBusyTaskId(t.id);
    setError(null);
    setNotice(null);
    const controller = new AbortController();
    try {
      await api.acceptTask(t.id, { version: t.version }, controller.signal, onUnauthorized);
      setNotice(`Tarefa "${t.title}" aceita com sucesso.`);
      await loadData();
    } catch (err) {
      setError(err instanceof ApiError ? `Erro ao aceitar tarefa (${err.code}).` : 'Não foi possível aceitar a tarefa.');
    } finally {
      setBusyTaskId(null);
    }
  }

  async function handleQuickStart(t: Task) {
    if (busyTaskId) return;
    setBusyTaskId(t.id);
    setError(null);
    setNotice(null);
    const controller = new AbortController();
    try {
      if (!t.acceptedAt && t.assignedToUserId === session.user.id) {
        const accepted = await api.acceptTask(t.id, { version: t.version }, controller.signal, onUnauthorized);
        await api.startTask(t.id, { version: accepted.task.version }, controller.signal, onUnauthorized);
      } else {
        await api.startTask(t.id, { version: t.version }, controller.signal, onUnauthorized);
      }
      setNotice(`Relógio operacional iniciado para "${t.title}"!`);
      await loadData();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? `Não foi possível iniciar (${err.code}). Verifique se os requisitos obrigatórios estão concluídos.`
          : 'Erro ao iniciar a tarefa.',
      );
    } finally {
      setBusyTaskId(null);
    }
  }

  async function handleQuickSubmitReview(t: Task) {
    if (busyTaskId) return;
    const notesTrimmed = deliveryNotes.trim() || 'Entregue via Aplicativo Interno Orium.';
    setBusyTaskId(t.id);
    setError(null);
    setNotice(null);
    const controller = new AbortController();
    try {
      await api.submitTaskReview(
        t.id,
        {
          version: t.version,
          deliveryNotes: notesTrimmed,
          previewUrl: previewUrl.trim() ? previewUrl.trim() : null,
        },
        controller.signal,
        onUnauthorized,
      );
      setReviewFormTaskId(null);
      setDeliveryNotes('');
      setPreviewUrl('');
      setNotice(`Tarefa "${t.title}" enviada para revisão!`);
      await loadData();
    } catch (err) {
      setError(err instanceof ApiError ? `Falha ao enviar p/ revisão (${err.code}).` : 'Erro ao enviar para revisão.');
    } finally {
      setBusyTaskId(null);
    }
  }

  async function handleQuickApprove(t: Task) {
    if (busyTaskId) return;
    setBusyTaskId(t.id);
    setError(null);
    setNotice(null);
    const controller = new AbortController();
    try {
      await api.reviewTask(
        t.id,
        { version: t.version, decision: 'complete', feedback: 'Aprovada via Ação Rápida (App Interno).' },
        controller.signal,
        onUnauthorized,
      );
      setNotice(`Tarefa "${t.title}" aprovada e concluída!`);
      await loadData();
    } catch (err) {
      setError(err instanceof ApiError ? `Erro ao aprovar tarefa (${err.code}).` : 'Não foi possível aprovar a tarefa.');
    } finally {
      setBusyTaskId(null);
    }
  }

  async function toggleComments(taskId: string) {
    if (openCommentsTaskId === taskId) {
      setOpenCommentsTaskId(null);
      return;
    }
    setOpenCommentsTaskId(taskId);
    setLoadingCommentsTaskId(taskId);
    const controller = new AbortController();
    try {
      const res = await api.getTaskComments(taskId, controller.signal, onUnauthorized);
      setCommentsByTask((prev) => ({ ...prev, [taskId]: res.comments }));
    } catch {
      // ignore
    } finally {
      setLoadingCommentsTaskId(null);
    }
  }

  async function handleSendComment(taskId: string) {
    const content = newCommentText.trim();
    if (!content || sendingComment) return;
    setSendingComment(true);
    const controller = new AbortController();
    try {
      const res = await api.addTaskComment(taskId, { content }, controller.signal, onUnauthorized);
      setCommentsByTask((prev) => ({ ...prev, [taskId]: res.comments }));
      setNewCommentText('');
      setNotice('Comentário registrado na tarefa.');
    } catch {
      setError('Não foi possível enviar o comentário.');
    } finally {
      setSendingComment(false);
    }
  }

  async function handleEnablePush() {
    if (typeof Notification === 'undefined') {
      setError('Este navegador não suporta notificações Push.');
      return;
    }
    try {
      const subRes = await ensurePushSubscription({ requestPermission: true });
      setPushPermission(typeof Notification !== 'undefined' ? Notification.permission : 'default');
      if (subRes.ok) {
        setNotice('Notificações em Segundo Plano (Web Push VAPID) ativadas neste dispositivo!');
        await triggerTestPush(
          'Orium App Ativo em 2º Plano',
          'Você receberá alertas mesmo com o aplicativo fechado ou tela bloqueada.',
        );
      } else if (subRes.permission === 'granted') {
        setNotice('Permissão de notificação ativa neste dispositivo.');
      }
    } catch {
      setError('Não foi possível solicitar permissão de notificação.');
    }
  }

  async function triggerTestPush(title: string, body: string) {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    try {
      const serverRes = await triggerServerTestPush();
      if (serverRes.ok && serverRes.sent > 0) {
        setNotice('Push enviado pelo servidor em segundo plano! Confira a barra de notificações do seu aparelho.');
        return;
      }
    } catch {
      // fallback to local ServiceWorker notification
    }
    try {
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.ready;
        await reg.showNotification(title, {
          body,
          icon: '/favicon-192x192.png',
          badge: '/favicon-32x32.png',
        });
        return;
      }
    } catch {
      // fallback to standard Notification
    }
    new Notification(title, { body, icon: '/favicon-192x192.png' });
  }

  async function handleInstallPwa() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    setInstallPrompt(null);
  }

  return (
    <section className="view-panel mobile-app-view" aria-labelledby="mobile-app-heading">
      {/* Cabeçalho compacto de App Interno */}
      <div className="panel-header mobile-app-header">
        <div>
          <span className="mobile-app-pill">APLICATIVO INTERNO • FASE 8</span>
          <h1 id="mobile-app-heading">Olá, {session.user.name.split(' ')[0]}</h1>
          <p className="panel-subtitle">
            Resumo rápido, minhas tarefas, início de produção em 1 toque, comentários e alertas Push.
          </p>
        </div>
        <div className="mobile-app-header-actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => void loadData()}
            disabled={loading}
          >
            {loading ? 'Atualizando…' : '↻ Atualizar'}
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={onOpenNotifications}
          >
            🔔 Alertas {typeof unreadCount === 'number' && unreadCount > 0 ? `(${unreadCount})` : ''}
          </button>
        </div>
      </div>

      {error && (
        <div className="alert-banner error" role="alert">
          <span>{error}</span>
          <button type="button" className="close-alert" onClick={() => setError(null)} aria-label="Fechar erro">
            ✕
          </button>
        </div>
      )}

      {notice && (
        <div className="alert-banner success" role="status">
          <span>{notice}</span>
          <button type="button" className="close-alert" onClick={() => setNotice(null)} aria-label="Fechar aviso">
            ✕
          </button>
        </div>
      )}

      {/* Barra PWA & Notificações Push */}
      <div className="mobile-push-card">
        <div className="mobile-push-info">
          <strong>📲 Aplicativo &amp; Notificações Push no Dispositivo</strong>
          <span>
            {pushPermission === 'granted'
              ? 'Notificações Push ativas neste aparelho para novas tarefas, comentários e revisões.'
              : 'Ative os alertas Push para receber avisos imediatos no celular ou computador.'}
          </span>
        </div>
        <div className="mobile-push-actions">
          {pushPermission !== 'granted' ? (
            <button type="button" className="btn-primary" onClick={() => void handleEnablePush()}>
              Ativar Push
            </button>
          ) : (
            <button
              type="button"
              className="btn-secondary"
              onClick={() =>
                void triggerTestPush(
                  'Orium System — Alerta Operacional',
                  `Você possui ${filteredTasks.length} tarefa(s) na fila rápida.`,
                )
              }
            >
              Testar Push
            </button>
          )}
          {installPrompt && (
            <button type="button" className="btn-primary" onClick={() => void handleInstallPwa()}>
              ⬇ Instalar App
            </button>
          )}
        </div>
      </div>

      {/* KPIs Resumidos */}
      <div className="kpi-grid mobile-kpi-grid" aria-label="Resumo operacional rápido">
        <div className="kpi-card">
          <span className="kpi-label">Em Produção</span>
          <strong className="kpi-value">{kpis.inProduction}</strong>
          <span className="kpi-meta">Relógio ativo</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">Prontas p/ Iniciar</span>
          <strong className="kpi-value">{kpis.ready}</strong>
          <span className="kpi-meta">Liberadas na fila</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">Em Revisão</span>
          <strong className="kpi-value">{kpis.inReview}</strong>
          <span className="kpi-meta">Aguardando aprovação</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">Urgentes / Atrasadas</span>
          <strong className="kpi-value">{kpis.urgentOrOverdue}</strong>
          <span className="kpi-meta">Atenção prioritária</span>
        </div>
      </div>

      {/* Filtros Rápidos de Tarefas */}
      <div className="mobile-filter-bar" role="tablist" aria-label="Filtro rápido de tarefas">
        <button
          type="button"
          role="tab"
          aria-selected={filter === 'mine'}
          className={`mobile-filter-chip ${filter === 'mine' ? 'active' : ''}`}
          onClick={() => setFilter('mine')}
        >
          Minhas tarefas
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={filter === 'ready_prod'}
          className={`mobile-filter-chip ${filter === 'ready_prod' ? 'active' : ''}`}
          onClick={() => setFilter('ready_prod')}
        >
          Prontas &amp; Em Produção
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={filter === 'review'}
          className={`mobile-filter-chip ${filter === 'review' ? 'active' : ''}`}
          onClick={() => setFilter('review')}
        >
          Em Revisão ({kpis.inReview})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={filter === 'all'}
          className={`mobile-filter-chip ${filter === 'all' ? 'active' : ''}`}
          onClick={() => setFilter('all')}
        >
          Todas Abertas ({tasksWithCtx.length})
        </button>
      </div>

      {/* Lista de Tarefas com Ações Rápidas */}
      <div className="mobile-tasks-section">
        <h2 className="section-subtitle">Fila de Ação Rápida ({filteredTasks.length})</h2>
        {loading ? (
          <p className="status">Carregando tarefas e demandas…</p>
        ) : filteredTasks.length === 0 ? (
          <div className="empty-state">
            <p>Nenhuma tarefa pendente neste filtro.</p>
          </div>
        ) : (
          <div className="mobile-task-list">
            {filteredTasks.map(({ task, demandTitle, clientName }) => {
              const isBusy = busyTaskId === task.id;
              const isReviewOpen = reviewFormTaskId === task.id;
              const isCommentsOpen = openCommentsTaskId === task.id;
              const comments = commentsByTask[task.id] || [];

              return (
                <article key={task.id} className="mobile-task-card">
                  <div className="mobile-task-card-top">
                    <span className="mobile-task-client">{clientName} • {demandTitle}</span>
                    <div className="mobile-task-badges">
                      <span className={`badge priority-${task.priority}`}>
                        {priorityLabels[task.priority] ?? task.priority}
                      </span>
                      <span className={`badge status-${task.status}`}>
                        {statusLabels[task.status] ?? task.status}
                      </span>
                    </div>
                  </div>

                  <h3 className="mobile-task-title">{task.title}</h3>
                  {task.description && (
                    <p className="mobile-task-desc">{task.description}</p>
                  )}

                  <div className="mobile-task-meta">
                    <span>📅 Prazo: <strong>{formatDateBr(task.deliveryDate)}</strong></span>
                    {task.startedAt && <span>⏱ Em produção</span>}
                  </div>

                  {/* Barra de Ações Rápidas em 1 Toque */}
                  <div className="mobile-quick-actions">
                    {!task.acceptedAt && task.assignedToUserId === session.user.id && (
                      <button
                        type="button"
                        className="btn-secondary btn-sm"
                        disabled={isBusy}
                        onClick={() => void handleQuickAccept(task)}
                      >
                        ✓ Aceitar
                      </button>
                    )}

                    {task.status === 'ready' && (
                      <button
                        type="button"
                        className="btn-primary btn-sm"
                        disabled={isBusy}
                        onClick={() => void handleQuickStart(task)}
                      >
                        ▶ Iniciar Tarefa
                      </button>
                    )}

                    {(task.status === 'in_production' || task.status === 'changes_requested') && (
                      <button
                        type="button"
                        className="btn-primary btn-sm"
                        disabled={isBusy}
                        onClick={() => {
                          setReviewFormTaskId(isReviewOpen ? null : task.id);
                          setDeliveryNotes(task.deliveryNotes || '');
                          setPreviewUrl(task.previewUrl || '');
                        }}
                      >
                        ✓ Enviar p/ Revisão
                      </button>
                    )}

                    {isAdmin && task.status === 'in_review' && (
                      <button
                        type="button"
                        className="btn-primary btn-sm"
                        disabled={isBusy}
                        onClick={() => void handleQuickApprove(task)}
                      >
                        ✓ Aprovar e Concluir
                      </button>
                    )}

                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      onClick={() => void toggleComments(task.id)}
                    >
                      💬 Comentários {comments.length > 0 ? `(${comments.length})` : ''}
                    </button>

                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      onClick={() => onOpenItem({ demandId: task.demandId, taskId: task.id })}
                    >
                      Abrir Completo →
                    </button>
                  </div>

                  {/* Formulário Inline Rápido de Envio para Revisão */}
                  {isReviewOpen && (
                    <div className="mobile-inline-drawer">
                      <h4>Enviar entrega para revisão</h4>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="Notas da entrega (ex: Layout finalizado conforme briefing)"
                        value={deliveryNotes}
                        onChange={(e) => setDeliveryNotes(e.target.value)}
                      />
                      <input
                        type="url"
                        className="form-input"
                        placeholder="URL de preview (opcional, ex: https://figma.com/...)"
                        value={previewUrl}
                        onChange={(e) => setPreviewUrl(e.target.value)}
                      />
                      <div className="mobile-inline-drawer-actions">
                        <button
                          type="button"
                          className="btn-primary btn-sm"
                          disabled={isBusy}
                          onClick={() => void handleQuickSubmitReview(task)}
                        >
                          Confirmar Envio
                        </button>
                        <button
                          type="button"
                          className="btn-secondary btn-sm"
                          onClick={() => setReviewFormTaskId(null)}
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Gaveta Inline de Comentários Rápidos */}
                  {isCommentsOpen && (
                    <div className="mobile-inline-drawer">
                      <h4>Comentários da Tarefa</h4>
                      {loadingCommentsTaskId === task.id ? (
                        <p className="status">Carregando comentários…</p>
                      ) : comments.length === 0 ? (
                        <p className="panel-subtitle">Nenhum comentário ainda.</p>
                      ) : (
                        <ul className="mobile-comment-list">
                          {comments.map((c) => (
                            <li key={c.id} className="mobile-comment-item">
                              <strong>{c.authorName}:</strong> {c.content}
                            </li>
                          ))}
                        </ul>
                      )}
                      <div className="mobile-comment-form">
                        <input
                          type="text"
                          className="form-input"
                          placeholder="Escreva um comentário rápido…"
                          value={newCommentText}
                          onChange={(e) => setNewCommentText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              void handleSendComment(task.id);
                            }
                          }}
                        />
                        <button
                          type="button"
                          className="btn-primary btn-sm"
                          disabled={sendingComment || !newCommentText.trim()}
                          onClick={() => void handleSendComment(task.id)}
                        >
                          Enviar
                        </button>
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>

      {/* Demandas em Aberto Resumidas */}
      <div className="mobile-demands-section">
        <h2 className="section-subtitle">Demandas em Andamento ({demands.length})</h2>
        <div className="mobile-demand-grid">
          {demands.slice(0, 8).map((d) => (
            <div key={d.id} className="mobile-demand-card">
              <div>
                <span className="mobile-task-client">{clientMap[d.clientId] || 'Cliente'}</span>
                <h4>{d.title}</h4>
                <span className="mobile-demand-due">Entrega: {formatDateBr(d.deliveryDate)}</span>
              </div>
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={() => onOpenItem({ demandId: d.id })}
              >
                Ver Demanda
              </button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
