import type { ActiveTab, SessionResponse } from '../types.js';
import { useTheme } from '../theme.js';
import logoHorizontal from '../assets/logo-horizontal.png';
import logoHorizontalLight from '../assets/logo-horizontal-light-theme.png';

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
  const [theme, , toggleTheme] = useTheme();
  const hasClientsRead = session.permissions.includes('clients.read');
  const hasUsersRead = session.permissions.includes('users.read');
  const hasDemandsRead = session.permissions.includes('demands.read');
  const hasTasksRead = session.permissions.includes('tasks.read');
  const isAdmin = session.roles.includes('administrator');
  const hasMaterialsRead = session.permissions.includes('materials.read');

  return (
    <header className="app-header">
      <div className="header-brand">
        <div className="brand-logo-container">
          <img
            src={theme === 'dark' ? logoHorizontal : logoHorizontalLight}
            alt="Orium Digital"
            className="brand-logo"
            height="32"
          />
          <span className="brand-title">OriumSystem</span>
        </div>
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
          {hasDemandsRead && (
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
      </div>

      <div className="header-user">
        <button
          type="button"
          className="theme-toggle-button"
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
