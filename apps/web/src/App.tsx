import { useCallback, useEffect, useRef, useState } from 'react';
import type { SessionResponse } from '@orium/contracts';
import { api, ApiError } from './api.js';
import { Header } from './components/Header.js';
import { LoginView } from './components/LoginView.js';
import { ClientsView } from './components/ClientsView.js';
import { DashboardView } from './components/DashboardView.js';
import { DemandsView } from './components/DemandsView.js';
import { MaterialsView } from './components/MaterialsView.js';
import { NotificationsView } from './components/NotificationsView.js';
import { ReportsView } from './components/ReportsView.js';
import { TeamView } from './components/TeamView.js';
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
  const activeRequestRef = useRef<AbortController | null>(null);
  const unreadRequestRef = useRef<AbortController | null>(null);

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
        setUnreadCount(response.unreadCount);
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

        {activeTab === 'reports' && hasDemandsRead && (
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

        {/* Fallback if user lacks permissions for all tabs */}
        {!hasClientsRead && !hasDemandsRead && !hasUsersRead && !hasMaterialsRead && (
          <section className="view-panel" aria-labelledby="no-perm-heading">
            <h1 id="no-perm-heading">Área protegida</h1>
            <p className="panel-subtitle">
              Sua conta está conectada como <strong>{session.user.name}</strong>, mas ainda não possui permissões operacionais atribuídas.
            </p>
          </section>
        )}
      </main>
    </div>
  );
}
