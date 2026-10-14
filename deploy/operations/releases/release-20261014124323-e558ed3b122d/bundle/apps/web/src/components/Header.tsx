import type { ActiveTab, SessionResponse } from '../types.js';

interface HeaderProps {
  session: SessionResponse;
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  onSignOut: () => void;
  busy: boolean;
  unreadCount: number | null;
}

export function Header({
  session,
  activeTab,
  onSelectTab,
  onSignOut,
  busy,
  unreadCount,
}: HeaderProps) {
  const hasClientsRead = session.permissions.includes('clients.read');
  const hasUsersRead = session.permissions.includes('users.read');
  const hasDemandsRead = session.permissions.includes('demands.read');
  const hasTasksRead = session.permissions.includes('tasks.read');
  const isAdmin = session.roles.includes('administrator');
  const hasMaterialsRead = session.permissions.includes('materials.read');

  return (
    <header className="app-header">
      <div className="header-brand">
        <span className="brand-title">OriumSystem</span>
        <nav className="header-nav" aria-label="Navegação principal">
          {hasDemandsRead && hasTasksRead && (
            <>
              <button
                type="button"
                className={`nav-tab ${activeTab === 'dashboard' ? 'active' : ''}`}
                onClick={() => onSelectTab('dashboard')}
                aria-current={activeTab === 'dashboard' ? 'page' : undefined}
              >
                Painel
              </button>
              <button
                type="button"
                className={`nav-tab ${activeTab === 'notifications' ? 'active' : ''}`}
                onClick={() => onSelectTab('notifications')}
                aria-current={activeTab === 'notifications' ? 'page' : undefined}
              >
                Notificações
                {typeof unreadCount === 'number' && unreadCount > 0 && (
                  <span
                    className="notifications-counter"
                    aria-label={
                      unreadCount === 1
                        ? '1 notificação não lida'
                        : `${unreadCount} notificações não lidas`
                    }
                  >
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </button>
            </>
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
      </div>

      <div className="header-user">
        <div className="user-info">
          <span className="user-name">{session.user.name}</span>
          <span className="user-meta">
            {session.user.email} •{' '}
            <span className={`role-badge ${isAdmin ? 'admin' : 'collab'}`}>
              {isAdmin ? 'Administrador' : 'Colaborador'}
            </span>
          </span>
        </div>
        <button
          type="button"
          className="signout-button secondary"
          onClick={onSignOut}
          disabled={busy}
        >
          {busy ? 'Saindo…' : 'Sair'}
        </button>
      </div>
    </header>
  );
}
