import { useCallback, useEffect, useRef, useState } from 'react';
import type { SessionResponse } from '@orium/contracts';
import { api, ApiError } from './api.js';
import { Header } from './components/Header.js';
import { LoginView } from './components/LoginView.js';
import { BackupsView } from './components/BackupsView.js';
import { ClientsView } from './components/ClientsView.js';
import { DashboardView } from './components/DashboardView.js';
import { DemandsView } from './components/DemandsView.js';
import { MaterialsView } from './components/MaterialsView.js';
import { NotificationsView } from './components/NotificationsView.js';
import { ProfileView } from './components/ProfileView.js';
import { ReportsView } from './components/ReportsView.js';
import { TeamView } from './components/TeamView.js';
import { VaultView } from './components/VaultView.js';
import { MobileAppView } from './components/MobileAppView.js';
import { ensurePushSubscription, triggerServerTestPush } from './pushClient.js';
import type { ActiveTab, MaterialNavigationTarget } from './types.js';

type ViewState = 'checking' | 'signed-out' | 'signed-in';

type DemandNavigationTarget = {
  demandId: string;
  taskId?: string;
};

export function App() {
  const [view, setView] = useState<ViewState>('checking');
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>('clients');
  const [demandNavTarget, setDemandNavTarget] = useState<DemandNavigationTarget | null>(null);
  const [materialNavTarget, setMaterialNavTarget] = useState<MaterialNavigationTarget | null>(null);
  const [unreadCount, setUnreadCount] = useState<number | null>(null);
  const [busySignOut, setBusySignOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [showPushOnboarding, setShowPushOnboarding] = useState(false);
  const [activatingPush, setActivatingPush] = useState(false);
  const activeRequestRef = useRef<AbortController | null>(null);
  const unreadRequestRef = useRef<AbortController | null>(null);
  const prevUnreadCountRef = useRef<number | null>(null);

  useEffect(() => {
    const onSessionUpdated = (event: Event) => {
      const custom = event as CustomEvent<SessionResponse>;
      if (custom.detail) {
        setSession(custom.detail);
      }
    };
    window.addEventListener('orium:session-updated', onSessionUpdated);
    return () => window.removeEventListener('orium:session-updated', onSessionUpdated);
  }, []);

  useEffect(() => {
    if (view !== 'signed-in') return;
    if (typeof window === 'undefined' || !('Notification' in window)) return;

    if (Notification.permission === 'granted') {
      void ensurePushSubscription({ requestPermission: false });
    } else if (
      Notification.permission === 'default' &&
      sessionStorage.getItem('orium_push_prompt_dismissed') !== '1'
    ) {
      const timer = window.setTimeout(() => {
        setShowPushOnboarding(true);
      }, 900);
      return () => window.clearTimeout(timer);
    }
  }, [view]);

  useEffect(() => {
    const onAppInstalled = () => {
      if (typeof Notification !== 'undefined' && Notification.permission !== 'granted') {
        sessionStorage.removeItem('orium_push_prompt_dismissed');
        setShowPushOnboarding(true);
      } else if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        void ensurePushSubscription({ requestPermission: false });
      }
    };
    window.addEventListener('appinstalled', onAppInstalled);
    return () => window.removeEventListener('appinstalled', onAppInstalled);
  }, []);

  const handleUnauthorized = useCallback(() => {
    setSession(null);
    setDemandNavTarget(null);
    setMaterialNavTarget(null);
    setUnreadCount(null);
    setView('signed-out');
  }, []);

  const handleOpenItem = useCallback((target: DemandNavigationTarget) => {
    setDemandNavTarget(target);
    setActiveTab('demands');
  }, []);

  const clearDemandNav = useCallback(() => setDemandNavTarget(null), []);

  const handleOpenMaterials = useCallback((target: MaterialNavigationTarget) => {
    setMaterialNavTarget(target);
    setActiveTab('materials');
  }, []);

  const clearMaterialNav = useCallback(() => setMaterialNavTarget(null), []);

  const refreshUnread = useCallback(async () => {
    if (unreadRequestRef.current) {
      unreadRequestRef.current.abort();
    }
    const controller = new AbortController();
    unreadRequestRef.current = controller;
    try {
      const response = await api.listNotifications(
        { page: 1, pageSize: 1, unreadOnly: true },
        controller.signal,
        () => {
          if (unreadRequestRef.current === controller && !controller.signal.aborted) handleUnauthorized();
        },
      );
      if (unreadRequestRef.current === controller && !controller.signal.aborted) {
        const prev = prevUnreadCountRef.current;
        prevUnreadCountRef.current = response.unreadCount;
        setUnreadCount(response.unreadCount);
        if (
          prev !== null &&
          response.unreadCount > prev &&
          typeof Notification !== 'undefined' &&
          Notification.permission === 'granted'
        ) {
          const diff = response.unreadCount - prev;
          const title = 'Orium System — Nova Notificação';
          const body =
            diff === 1
              ? 'Você recebeu 1 nova atualização operacional.'
              : `Você recebeu ${diff} novas atualizações operacionais.`;
          if ('serviceWorker' in navigator) {
            void navigator.serviceWorker.ready
              .then((reg) => reg.showNotification(title, { body, icon: '/favicon-192x192.png' }))
              .catch(() => new Notification(title, { body, icon: '/favicon-192x192.png' }));
          } else {
            new Notification(title, { body, icon: '/favicon-192x192.png' });
          }
        }
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 403
          && unreadRequestRef.current === controller && !controller.signal.aborted) {
        setUnreadCount(null);
      }
      // Falha de rede/abort: mantém o contador anterior (não zera).
    } finally {
      if (unreadRequestRef.current === controller) {
        unreadRequestRef.current = null;
      }
    }
  }, [handleUnauthorized]);

  // Contador de não lidos: ao entrar e a cada 60s somente com documento visível + retorno ao foco.
  useEffect(() => {
    if (view !== 'signed-in') return;
    void refreshUnread();
    const tick = () => {
      if (document.visibilityState === 'visible') {
        void refreshUnread();
      }
    };
    window.addEventListener('focus', tick);
    const interval = window.setInterval(tick, 60_000);
    return () => {
      window.removeEventListener('focus', tick);
      window.clearInterval(interval);
      unreadRequestRef.current?.abort();
    };
  }, [view, refreshUnread]);

  const initialTabFor = (permissions: string[]): ActiveTab => {
    if (permissions.includes('demands.read') && permissions.includes('tasks.read')) {
      return 'dashboard';
    }
    if (permissions.includes('clients.read')) return 'clients';
    if (permissions.includes('demands.read')) return 'demands';
    if (permissions.includes('materials.read')) return 'materials';
    if (permissions.includes('users.read')) return 'team';
    return 'dashboard';
  };

  useEffect(() => {
    const controller = new AbortController();
    activeRequestRef.current = controller;

    void api
      .getMe(controller.signal, () => {
        setSession(null);
        setDemandNavTarget(null);
        setMaterialNavTarget(null);
        setUnreadCount(null);
        setView('signed-out');
      })
      .then((current) => {
        setDemandNavTarget(null);
        setMaterialNavTarget(null);
        setSession(current);
        setActiveTab(initialTabFor(current.permissions));
        setView('signed-in');
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setView('signed-out');
      });

    return () => {
      controller.abort();
      activeRequestRef.current?.abort();
    };
  }, []);

  async function handleSignOut() {
    const controller = new AbortController();
    activeRequestRef.current = controller;
    setBusySignOut(true);
    setSignOutError(null);

    try {
      const response = await api.signOut(controller.signal);
      if (response.ok || response.status === 401) {
        setSession(null);
        setDemandNavTarget(null);
        setMaterialNavTarget(null);
        setUnreadCount(null);
        setView('signed-out');
        setSignOutError(null);
      } else {
        setSignOutError('Não foi possível encerrar a sessão no servidor. Tente novamente.');
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setSignOutError('Falha de rede ao tentar sair. Verifique sua conexão e tente novamente.');
    } finally {
      setBusySignOut(false);
      if (activeRequestRef.current === controller) {
        activeRequestRef.current = null;
      }
    }
  }

  function handleLoginSuccess(newSession: SessionResponse) {
    setDemandNavTarget(null);
    setMaterialNavTarget(null);
    setSession(newSession);
    setUnreadCount(null);
    setSignOutError(null);
    setActiveTab(initialTabFor(newSession.permissions));
    setView('signed-in');
  }

  if (view === 'checking') {
    return (
      <main className="shell" aria-live="polite">
        <p className="status">Verificando sua sessão…</p>
      </main>
    );
  }

  if (view === 'signed-out' || !session) {
    return <LoginView onSuccess={handleLoginSuccess} activeRequestRef={activeRequestRef} />;
  }

  const isAdmin = session.roles.includes('administrator');
  const hasClientsRead = session.permissions.includes('clients.read');
  const hasUsersRead = session.permissions.includes('users.read');
  const hasDemandsRead = session.permissions.includes('demands.read');
  const hasTasksRead = session.permissions.includes('tasks.read');
  const hasMaterialsRead = session.permissions.includes('materials.read');
  const hasNotificationsRead = hasDemandsRead && hasTasksRead;

  return (
    <div className="app-layout">
      <Header
        session={session}
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        onSignOut={() => void handleSignOut()}
        busy={busySignOut}
        unreadCount={unreadCount}
      />

      <main className="main-content">
        {signOutError && (
          <div className="alert-banner error" role="alert" style={{ marginBottom: 16 }}>
            <span>{signOutError}</span>
            <button
              type="button"
              className="close-alert"
              onClick={() => setSignOutError(null)}
              aria-label="Fechar aviso de erro ao sair"
            >
              ✕
            </button>
          </div>
        )}

        {activeTab === 'dashboard' && hasDemandsRead && hasTasksRead && (
          <DashboardView
            session={session}
            onUnauthorized={handleUnauthorized}
            onOpenItem={handleOpenItem}
          />
        )}

        {activeTab === 'mobile' && hasDemandsRead && hasTasksRead && (
          <MobileAppView
            session={session}
            unreadCount={unreadCount}
            onUnauthorized={handleUnauthorized}
            onOpenItem={handleOpenItem}
            onOpenNotifications={() => setActiveTab('notifications')}
          />
        )}

        {activeTab === 'clients' && hasClientsRead && (
          <ClientsView
            session={session}
            onUnauthorized={handleUnauthorized}
            onOpenMaterials={handleOpenMaterials}
          />
        )}

        {activeTab === 'demands' && hasDemandsRead && (
          <DemandsView
            session={session}
            onUnauthorized={handleUnauthorized}
            initialDemandId={demandNavTarget?.demandId ?? null}
            initialTaskId={demandNavTarget?.taskId ?? null}
            onNavigationConsumed={clearDemandNav}
            onOpenMaterials={handleOpenMaterials}
          />
        )}

        {activeTab === 'reports' && isAdmin && hasDemandsRead && (
          <ReportsView
            session={session}
            onUnauthorized={handleUnauthorized}
          />
        )}

        {activeTab === 'materials' && hasMaterialsRead && (
          <MaterialsView
            session={session}
            onUnauthorized={handleUnauthorized}
            initialTarget={materialNavTarget}
            onTargetConsumed={clearMaterialNav}
          />
        )}

        {activeTab === 'notifications' && hasNotificationsRead && (
          <NotificationsView
            session={session}
            onUnauthorized={handleUnauthorized}
            onOpenItem={handleOpenItem}
            refreshUnread={refreshUnread}
          />
        )}

        {activeTab === 'team' && hasUsersRead && (
          <TeamView session={session} onUnauthorized={handleUnauthorized} />
        )}

        {activeTab === 'vault' && isAdmin && (
          <VaultView onUnauthorized={handleUnauthorized} />
        )}

        {activeTab === 'backups' && isAdmin && (
          <BackupsView session={session} onUnauthorized={handleUnauthorized} />
        )}

        {activeTab === 'profile' && (
          <ProfileView session={session} onUnauthorized={handleUnauthorized} />
        )}

        {/* Fallback if user lacks permissions for all tabs */}
        {activeTab !== 'profile' && !hasClientsRead && !hasDemandsRead && !hasUsersRead && !hasMaterialsRead && (
          <section className="view-panel" aria-labelledby="no-perm-heading">
            <h1 id="no-perm-heading">Área protegida</h1>
            <p className="panel-subtitle">
              Sua conta está conectada como <strong>{session.user.name}</strong>, mas ainda não possui permissões operacionais atribuídas.
            </p>
          </section>
        )}
      </main>

      {/* Barra Inferior Mobile Nativa (Fase 8 — Aplicativo Interno) */}
      <nav className="mobile-bottom-nav" aria-label="Navegação rápida mobile">
        {hasDemandsRead && hasTasksRead && (
          <button
            type="button"
            className={`mobile-bottom-tab ${activeTab === 'mobile' ? 'active' : ''}`}
            onClick={() => setActiveTab('mobile')}
          >
            <span className="mobile-bottom-icon">⚡</span>
            <span>Meu Dia</span>
          </button>
        )}
        {hasDemandsRead && hasTasksRead && (
          <button
            type="button"
            className={`mobile-bottom-tab ${activeTab === 'dashboard' ? 'active' : ''}`}
            onClick={() => setActiveTab('dashboard')}
          >
            <span className="mobile-bottom-icon">📊</span>
            <span>Painel</span>
          </button>
        )}
        {hasDemandsRead && (
          <button
            type="button"
            className={`mobile-bottom-tab ${activeTab === 'demands' ? 'active' : ''}`}
            onClick={() => setActiveTab('demands')}
          >
            <span className="mobile-bottom-icon">📋</span>
            <span>Demandas</span>
          </button>
        )}
        {hasClientsRead && (
          <button
            type="button"
            className={`mobile-bottom-tab ${activeTab === 'clients' ? 'active' : ''}`}
            onClick={() => setActiveTab('clients')}
          >
            <span className="mobile-bottom-icon">🏢</span>
            <span>Clientes</span>
          </button>
        )}
        {hasNotificationsRead && (
          <button
            type="button"
            className={`mobile-bottom-tab ${activeTab === 'notifications' ? 'active' : ''}`}
            onClick={() => setActiveTab('notifications')}
          >
            <span className="mobile-bottom-icon">
              🔔{typeof unreadCount === 'number' && unreadCount > 0 ? `(${unreadCount})` : ''}
            </span>
            <span>Alertas</span>
          </button>
        )}
      </nav>

      {/* Modal Automático de Ativação de Notificações em Segundo Plano (Fase 8 PWA) */}
      {showPushOnboarding && (
        <div
          className="push-onboarding-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="push-onboarding-title"
        >
          <div className="push-onboarding-modal">
            <div className="push-onboarding-header">
              <span className="push-onboarding-icon-wrap" aria-hidden="true">
                <span className="push-onboarding-icon">🔔</span>
              </span>
              <div>
                <span className="push-onboarding-badge">
                  APLICATIVO ORIUM • SEGUNDO PLANO
                </span>
                <h2 id="push-onboarding-title" className="push-onboarding-title">
                  Ativar Notificações no Celular?
                </h2>
              </div>
            </div>

            <p className="push-onboarding-desc">
              Ative os alertas em segundo plano para receber avisos de{' '}
              <strong>novas tarefas, revisões, prazos e ações do Orium Agent</strong> diretamente na
              tela de bloqueio do seu Android ou iPhone — mesmo com o aplicativo fechado.
            </p>

            <div className="push-onboarding-actions">
              <button
                type="button"
                className="btn-primary push-onboarding-primary-btn"
                disabled={activatingPush}
                onClick={() => {
                  setActivatingPush(true);
                  void ensurePushSubscription({ requestPermission: true })
                    .then(async (res) => {
                      if (res.ok) {
                        await triggerServerTestPush().catch(() => null);
                      }
                    })
                    .finally(() => {
                      setActivatingPush(false);
                      setShowPushOnboarding(false);
                    });
                }}
              >
                {activatingPush ? (
                  <>
                    <span
                      style={{
                        width: 16,
                        height: 16,
                        border: '2px solid rgba(255,255,255,0.3)',
                        borderTopColor: '#fff',
                        borderRadius: '50%',
                        display: 'inline-block',
                        animation: 'spin 0.8s linear infinite',
                        marginRight: 8,
                      }}
                    />
                    Ativando notificações...
                  </>
                ) : (
                  <>
                    <span>🔔</span> Permitir Notificações em Segundo Plano
                  </>
                )}
              </button>

              <button
                type="button"
                className="btn-secondary push-onboarding-secondary-btn"
                disabled={activatingPush}
                onClick={() => {
                  sessionStorage.setItem('orium_push_prompt_dismissed', '1');
                  setShowPushOnboarding(false);
                }}
              >
                Agora não
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
