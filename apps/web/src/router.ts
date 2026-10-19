import type { ActiveTab } from './types.js';

/**
 * Rotas da aplicação baseadas no History API (sem dependências externas).
 * O nginx de produção e o Vite em DEV já fazem fallback para index.html.
 */
export type AppRoute = {
  tab: ActiveTab;
  demandId: string | null;
  taskId: string | null;
};

const tabPaths: Record<ActiveTab, string> = {
  dashboard: '/painel',
  mobile: '/meu-dia',
  clients: '/clientes',
  team: '/equipe',
  demands: '/demandas',
  materials: '/materiais',
  notifications: '/notificacoes',
  reports: '/relatorios',
  backups: '/backups',
  vault: '/cofre',
  profile: '/perfil',
};

const pathTabs = new Map<string, ActiveTab>(
  (Object.entries(tabPaths) as [ActiveTab, string][]).map(([tab, path]) => [path.slice(1), tab]),
);

/** Retorna null quando o caminho não corresponde a nenhuma tela (ex.: "/"). */
export function parseRoute(pathname: string): AppRoute | null {
  const segments = pathname.split('/').filter(Boolean).map((segment) => decodeURIComponent(segment));
  const tab = segments[0] ? pathTabs.get(segments[0]) : undefined;
  if (!tab) return null;
  if (tab !== 'demands') return { tab, demandId: null, taskId: null };
  const demandId = segments[1] ?? null;
  const taskId = demandId && segments[2] === 'tarefas' ? (segments[3] ?? null) : null;
  return { tab, demandId, taskId };
}

export function routePath(route: AppRoute): string {
  const base = tabPaths[route.tab];
  if (route.tab !== 'demands' || !route.demandId) return base;
  const demandPath = `${base}/${encodeURIComponent(route.demandId)}`;
  return route.taskId ? `${demandPath}/tarefas/${encodeURIComponent(route.taskId)}` : demandPath;
}
