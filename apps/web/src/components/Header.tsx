import { useState, useRef, useEffect } from 'react';
import type { ActiveTab, SessionResponse } from '../types.js';
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
}: HeaderProps) {
  const [theme, , toggleTheme] = useTheme();
  const [profileOpen, setProfileOpen] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);

  const hasClientsRead = session.permissions.includes('clients.read');
  const hasUsersRead = session.permissions.includes('users.read');
  const hasDemandsRead = session.permissions.includes('demands.read');
  const hasTasksRead = session.permissions.includes('tasks.read');
  const isAdmin = session.roles.includes('administrator');
  const hasMaterialsRead = session.permissions.includes('materials.read');

  // Fechar ao clicar fora ou apertar Escape
  useEffect(() => {
    if (!profileOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(event.target as Node)) {
        setProfileOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setProfileOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [profileOpen]);

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
        {isAdmin && (
          <button
            type="button"
            className={`nav-tab ${activeTab === 'vault' ? 'active' : ''}`}
            onClick={() => onSelectTab('vault')}
            aria-current={activeTab === 'vault' ? 'page' : undefined}
          >
            Cofre &amp; Hermes
          </button>
        )}
        {isAdmin && (
          <button
            type="button"
            className={`nav-tab ${activeTab === 'backups' ? 'active' : ''}`}
            onClick={() => onSelectTab('backups')}
            aria-current={activeTab === 'backups' ? 'page' : undefined}
          >
            Backups
          </button>
        )}
      </nav>

      {/* 3. Ações no canto direito: Notificações + Tema + Perfil Circular estilo Google */}
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

          {/* Botão de notificações */}
          <button
            type="button"
            className={`header-icon-button notifications-icon-btn ${activeTab === 'notifications' ? 'active' : ''}`}
            onClick={() => onSelectTab('notifications')}
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
            onClick={() => setProfileOpen((prev) => !prev)}
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
