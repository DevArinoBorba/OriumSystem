import { useState, useRef, useEffect, useCallback } from 'react';
import type { Notification, NotificationKind } from '@orium/contracts';
import type { ActiveTab, SessionResponse } from '../types.js';
import { api } from '../api.js';
import { useTheme } from '../theme.js';
import { OriumLogo } from './OriumLogo.js';

interface HeaderProps {
  session: SessionResponse;
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  onSignOut: () => void;
  busy: boolean;
  unreadCount: number | null;
  onOpenSearch: () => void;
  onOpenItem?: (target: { demandId: string; taskId?: string }) => void;
  onUnauthorized?: () => void;
  refreshUnread?: () => Promise<void>;
}

const POPUP_MAX_ITEMS = 5;

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

function formatShortDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const day = date.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'America/Cuiaba',
  });
  const time = date.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Cuiaba',
  });
  return `${day} às ${time}`;
}

function getInitials(name: string): string {
  if (!name) return 'U';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0];
  if (!first) return 'U';
  if (parts.length === 1) return first.slice(0, 2).toUpperCase();
  const last = parts[parts.length - 1];
  const firstChar = first[0] ?? '';
  const lastChar = last?.[0] ?? '';
  return (firstChar + lastChar).toUpperCase() || 'U';
}

export function Header({
  session,
  activeTab,
  onSelectTab,
  onSignOut,
  busy,
  unreadCount,
  onOpenSearch,
  onOpenItem,
  onUnauthorized,
  refreshUnread,
}: HeaderProps) {
  const [theme, , toggleTheme] = useTheme();
  const [profileOpen, setProfileOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifItems, setNotifItems] = useState<Notification[]>([]);
  const [notifTotal, setNotifTotal] = useState(0);
  const [notifLoading, setNotifLoading] = useState(false);
  const [notifError, setNotifError] = useState<string | null>(null);
  const [markingId, setMarkingId] = useState<string | null>(null);

  const profileMenuRef = useRef<HTMLDivElement>(null);
  const notifMenuRef = useRef<HTMLDivElement>(null);
  const notifReqRef = useRef<AbortController | null>(null);

  const hasClientsRead = session.permissions.includes('clients.read');
  const hasUsersRead = session.permissions.includes('users.read');
  const hasDemandsRead = session.permissions.includes('demands.read');
  const hasTasksRead = session.permissions.includes('tasks.read');
  const isAdmin = session.roles.includes('administrator');
  const hasMaterialsRead = session.permissions.includes('materials.read');

  const loadPopupNotifications = useCallback(async () => {
    notifReqRef.current?.abort();
    const controller = new AbortController();
    notifReqRef.current = controller;
    setNotifLoading(true);
    setNotifError(null);
    try {
      const res = await api.listNotifications(
        { page: 1, pageSize: POPUP_MAX_ITEMS + 1, unreadOnly: false },
        controller.signal,
        () => {
          if (notifReqRef.current === controller && !controller.signal.aborted) {
            onUnauthorized?.();
          }
        },
      );
      if (notifReqRef.current === controller && !controller.signal.aborted) {
        setNotifItems(res.notifications.slice(0, POPUP_MAX_ITEMS));
        setNotifTotal(res.total);
      }
    } catch (err) {
      if (controller.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) return;
      if (notifReqRef.current === controller) {
        setNotifError('Não foi possível carregar as notificações.');
      }
    } finally {
      if (notifReqRef.current === controller) {
        setNotifLoading(false);
        notifReqRef.current = null;
      }
    }
  }, [onUnauthorized]);

  useEffect(() => {
    if (notifOpen) {
      void loadPopupNotifications();
    } else {
      notifReqRef.current?.abort();
    }
  }, [notifOpen, loadPopupNotifications]);

  // Fechar popovers ao clicar fora ou apertar Escape
  useEffect(() => {
    if (!profileOpen && !notifOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (profileOpen && profileMenuRef.current && !profileMenuRef.current.contains(target)) {
        setProfileOpen(false);
      }
      if (notifOpen && notifMenuRef.current && !notifMenuRef.current.contains(target)) {
        setNotifOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setProfileOpen(false);
        setNotifOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [profileOpen, notifOpen]);

  const handleMarkPopupItemRead = async (n: Notification) => {
    if (markingId) return;
    setMarkingId(n.id);
    const controller = new AbortController();
    try {
      await api.markNotificationRead(n.id, controller.signal, () => onUnauthorized?.());
      await loadPopupNotifications();
      await refreshUnread?.();
    } catch {
      // Mantém estado atual em caso de falha transitória
    } finally {
      setMarkingId(null);
    }
  };

  const handleOpenNotificationTarget = (n: Notification) => {
    setNotifOpen(false);
    if (onOpenItem) {
      onOpenItem(n.taskId ? { demandId: n.demandId, taskId: n.taskId } : { demandId: n.demandId });
    } else {
      onSelectTab('notifications');
    }
  };

  return (
    <header className="app-header">
      {/* 1. Brand Logo no canto esquerdo */}
      <div className="header-brand-container">
        <button
          type="button"
          className="brand-logo-button"
          onClick={() => onSelectTab(hasDemandsRead && hasTasksRead ? 'dashboard' : 'demands')}
          title="Orium System"
        >
          <OriumLogo theme={theme} />
        </button>
      </div>

      {/* 2. Navegação centralizada */}
      <nav className="header-nav header-center-nav" aria-label="Navegação principal">
        {hasDemandsRead && hasTasksRead && (
          <button
            type="button"
            className={`nav-tab ${activeTab === 'dashboard' ? 'active' : ''}`}
            onClick={() => onSelectTab('dashboard')}
            aria-current={activeTab === 'dashboard' ? 'page' : undefined}
          >
            Painel
          </button>
        )}
        {hasDemandsRead && hasTasksRead && (
          <button
            type="button"
            className={`nav-tab ${activeTab === 'mobile' ? 'active' : ''}`}
            onClick={() => onSelectTab('mobile')}
            aria-current={activeTab === 'mobile' ? 'page' : undefined}
          >
            App Rápido
          </button>
        )}
        {hasClientsRead && (
          <button
            type="button"
            className={`nav-tab ${activeTab === 'clients' ? 'active' : ''}`}
            onClick={() => onSelectTab('clients')}
            aria-current={activeTab === 'clients' ? 'page' : undefined}
          >
            Clientes
          </button>
        )}
        {hasDemandsRead && (
          <button
            type="button"
            className={`nav-tab ${activeTab === 'demands' ? 'active' : ''}`}
            onClick={() => onSelectTab('demands')}
            aria-current={activeTab === 'demands' ? 'page' : undefined}
          >
            {isAdmin ? 'Demandas' : 'Minhas demandas'}
          </button>
        )}
        {isAdmin && hasDemandsRead && (
          <button
            type="button"
            className={`nav-tab ${activeTab === 'reports' ? 'active' : ''}`}
            onClick={() => onSelectTab('reports')}
            aria-current={activeTab === 'reports' ? 'page' : undefined}
          >
            Relatórios
          </button>
        )}
        {hasMaterialsRead && (
          <button
            type="button"
            className={`nav-tab ${activeTab === 'materials' ? 'active' : ''}`}
            onClick={() => onSelectTab('materials')}
            aria-current={activeTab === 'materials' ? 'page' : undefined}
          >
            Materiais
          </button>
        )}
        {hasUsersRead && (
          <button
            type="button"
            className={`nav-tab ${activeTab === 'team' ? 'active' : ''}`}
            onClick={() => onSelectTab('team')}
            aria-current={activeTab === 'team' ? 'page' : undefined}
          >
            Equipe
          </button>
        )}
      </nav>

      {/* 3. Ações no canto direito: Notificações (Pop-up) + Tema + Perfil Circular */}
      <div className="header-actions-container">
        <div className="header-quick-actions">
          {/* Busca global (Ctrl+K) */}
          <button
            type="button"
            className="header-icon-button"
            onClick={onOpenSearch}
            aria-label="Buscar (Ctrl+K)"
            title="Buscar (Ctrl+K)"
          >
            <svg className="action-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
          </button>

          {/* Botão de notificações com Pop-up (até 5 itens + "Ver todas" se > 5) */}
          <div className="header-notifications-wrapper" ref={notifMenuRef}>
            <button
              type="button"
              className={`header-icon-button notifications-icon-btn ${notifOpen || activeTab === 'notifications' ? 'active' : ''}`}
              onClick={() => {
                setProfileOpen(false);
                setNotifOpen((prev) => !prev);
              }}
              aria-expanded={notifOpen}
              aria-haspopup="dialog"
              aria-label={
                typeof unreadCount === 'number' && unreadCount > 0
                  ? `${unreadCount} notificações não lidas`
                  : 'Notificações'
              }
              title={
                typeof unreadCount === 'number' && unreadCount > 0
                  ? `${unreadCount} notificações não lidas`
                  : 'Notificações'
              }
            >
              <svg
                className="action-icon"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
              {typeof unreadCount === 'number' && unreadCount > 0 && (
                <span
                  className="notifications-badge"
                  aria-label={`${unreadCount} notificações não lidas`}
                >
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </button>

            {notifOpen && (
              <div className="notifications-popover-dropdown" role="dialog" aria-label="Notificações recentes">
                <div className="notifications-popover-header">
                  <div className="notifications-popover-title-group">
                    <span className="notifications-popover-title">Notificações</span>
                    {typeof unreadCount === 'number' && unreadCount > 0 && (
                      <span className="notifications-popover-unread-pill">
                        {unreadCount} não lida{unreadCount > 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    className="profile-dropdown-close"
                    onClick={() => setNotifOpen(false)}
                    aria-label="Fechar notificações"
                    title="Fechar"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>

                <div className="profile-dropdown-divider" />

                <div className="notifications-popover-body">
                  {notifLoading && notifItems.length === 0 ? (
                    <div className="notifications-popover-empty">
                      <span>Carregando notificações…</span>
                    </div>
                  ) : notifError ? (
                    <div className="notifications-popover-empty">
                      <span>{notifError}</span>
                    </div>
                  ) : notifItems.length === 0 ? (
                    <div className="notifications-popover-empty">
                      <strong>Tudo em dia!</strong>
                      <span>Nenhuma notificação no momento.</span>
                    </div>
                  ) : (
                    <ul className="notifications-popover-list">
                      {notifItems.map((n) => (
                        <li
                          key={n.id}
                          className={`notifications-popover-item ${n.readAt ? '' : 'unread'}`}
                        >
                          <div
                            className="notifications-popover-item-main"
                            role="button"
                            tabIndex={0}
                            onClick={() => handleOpenNotificationTarget(n)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                handleOpenNotificationTarget(n);
                              }
                            }}
                          >
                            <div className="notifications-popover-item-top">
                              <span className="notifications-popover-kind">
                                {!n.readAt && <span className="notification-unread-dot" aria-hidden="true" />}
                                {KIND_LABELS[n.kind] ?? n.kind}
                              </span>
                              <span className="notifications-popover-time">
                                {formatShortDateTime(n.createdAt)}
                              </span>
                            </div>
                            <p className="notifications-popover-text">
                              {n.taskTitle ? (
                                <>
                                  <strong>{n.taskTitle}</strong> · {n.demandTitle}
                                </>
                              ) : (
                                <strong>{n.demandTitle}</strong>
                              )}
                            </p>
                          </div>
                          {!n.readAt && (
                            <button
                              type="button"
                              className="notifications-popover-mark-btn"
                              onClick={() => void handleMarkPopupItemRead(n)}
                              disabled={markingId === n.id}
                              title="Marcar como lida"
                            >
                              {markingId === n.id ? '…' : 'Lida'}
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {notifTotal > POPUP_MAX_ITEMS && (
                  <>
                    <div className="profile-dropdown-divider" />
                    <button
                      type="button"
                      className="notifications-popover-view-all-btn"
                      onClick={() => {
                        setNotifOpen(false);
                        onSelectTab('notifications');
                      }}
                    >
                      <span>Ver todas ({notifTotal})</span>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Botão de alternar tema */}
          <button
            type="button"
            className="header-icon-button theme-toggle-button"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Alternar para tema claro' : 'Alternar para tema escuro'}
            title={theme === 'dark' ? 'Alternar para tema claro' : 'Alternar para tema escuro'}
          >
            {theme === 'dark' ? (
              <svg
                className="theme-icon"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="5" />
                <line x1="12" y1="1" x2="12" y2="3" />
                <line x1="12" y1="21" x2="12" y2="23" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                <line x1="1" y1="12" x2="3" y2="12" />
                <line x1="21" y1="12" x2="23" y2="12" />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
              </svg>
            ) : (
              <svg
                className="theme-icon"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            )}
          </button>
        </div>

        <div className="header-divider" aria-hidden="true" />

        {/* Perfil Circular no Header com Popover estilo Google */}
        <div className="header-profile-wrapper" ref={profileMenuRef}>
          <button
            type="button"
            className={`profile-avatar-trigger ${profileOpen || activeTab === 'profile' ? 'active' : ''}`}
            onClick={() => {
              setNotifOpen(false);
              setProfileOpen((prev) => !prev);
            }}
            aria-expanded={profileOpen}
            aria-haspopup="true"
            aria-label="Menu de perfil do usuário"
            title={`${session.user.name} (${session.user.email})`}
          >
            <div className="user-avatar-circle" aria-hidden="true">
              {session.user.image ? (
                <img src={session.user.image} alt="" className="user-avatar-image" />
              ) : (
                getInitials(session.user.name)
              )}
            </div>
          </button>

          {/* Popover flutuante estilo Google Account */}
          {profileOpen && (
            <div className="google-profile-dropdown" role="dialog" aria-label="Menu do perfil">
              <div className="profile-dropdown-header">
                <div className="profile-dropdown-user">
                  <div className="profile-dropdown-avatar-large" aria-hidden="true">
                    {session.user.image ? (
                      <img src={session.user.image} alt="" className="user-avatar-image" />
                    ) : (
                      getInitials(session.user.name)
                    )}
                  </div>
                  <div className="profile-dropdown-info">
                    <span className="profile-dropdown-name">{session.user.name}</span>
                    <span className="profile-dropdown-email">{session.user.email}</span>
                    <div className="profile-dropdown-badge-container">
                      <span className={`role-badge ${isAdmin ? 'admin' : 'collab'}`}>
                        {isAdmin ? 'Administrador' : 'Colaborador'}
                      </span>
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  className="profile-dropdown-close"
                  onClick={() => setProfileOpen(false)}
                  aria-label="Fechar menu"
                  title="Fechar"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>

              <div className="profile-dropdown-divider" />

              <div className="profile-dropdown-menu">
                <button
                  type="button"
                  className="profile-dropdown-item primary-action"
                  onClick={() => {
                    setProfileOpen(false);
                    onSelectTab('profile');
                  }}
                >
                  <div className="profile-dropdown-item-icon">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                      <circle cx="12" cy="7" r="4" />
                    </svg>
                  </div>
                  <div className="profile-dropdown-item-text">
                    <span className="profile-dropdown-item-title">
                      {isAdmin ? 'Perfil do Administrador' : 'Perfil do Colaborador'}
                    </span>
                    <span className="profile-dropdown-item-desc">
                      Gerenciar preferências e dados da conta
                    </span>
                  </div>
                  <svg className="profile-dropdown-item-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>

                <button
                  type="button"
                  className="profile-dropdown-item danger-action"
                  onClick={() => {
                    setProfileOpen(false);
                    onSignOut();
                  }}
                  disabled={busy}
                >
                  <div className="profile-dropdown-item-icon danger">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                      <polyline points="16 17 21 12 16 7" />
                      <line x1="21" y1="12" x2="9" y2="12" />
                    </svg>
                  </div>
                  <div className="profile-dropdown-item-text">
                    <span className="profile-dropdown-item-title">
                      {busy ? 'Saindo…' : 'Sair da conta'}
                    </span>
                    <span className="profile-dropdown-item-desc">
                      Encerrar sessão com segurança
                    </span>
                  </div>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
