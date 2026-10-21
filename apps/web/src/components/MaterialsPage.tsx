import { useState } from 'react';
import type { SessionResponse } from '@orium/contracts';
import type { MaterialNavigationTarget } from '../types.js';
import { DriveView } from './DriveView.js';
import { MaterialsView } from './MaterialsView.js';

type MaterialsTab = 'drive' | 'links';

interface MaterialsPageProps {
  session: SessionResponse;
  onUnauthorized: () => void;
  initialTarget?: MaterialNavigationTarget;
  onTargetConsumed?: () => void;
}

/** Materiais: espelho do Google Drive (padrão) e os links cadastrados. */
export function MaterialsPage({ session, onUnauthorized, initialTarget, onTargetConsumed }: MaterialsPageProps) {
  const isAdmin = session.roles.includes('administrator');
  // Vindo de "Materiais" de um cliente/demanda, abre direto os links filtrados.
  const [tab, setTab] = useState<MaterialsTab>(initialTarget ? 'links' : 'drive');

  return (
    <section className="view-panel" aria-labelledby="materials-page-heading">
      <div className="panel-header">
        <div>
          <h1 id="materials-page-heading">Materiais</h1>
          <p className="panel-subtitle">
            {isAdmin ? 'Arquivos dos clientes no Google Drive e links cadastrados.' : 'Arquivos das suas tarefas para baixar e publicar.'}
          </p>
        </div>
      </div>
      <div className="materials-tabs" role="tablist" aria-label="Materiais">
        <button type="button" role="tab" aria-selected={tab === 'drive'} className={`nav-tab ${tab === 'drive' ? 'active' : ''}`} onClick={() => setTab('drive')}>
          {isAdmin ? 'Google Drive' : 'Meus arquivos'}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'links'} className={`nav-tab ${tab === 'links' ? 'active' : ''}`} onClick={() => setTab('links')}>
          Links
        </button>
      </div>
      {tab === 'drive' ? (
        <DriveView session={session} onUnauthorized={onUnauthorized} />
      ) : (
        <MaterialsView session={session} onUnauthorized={onUnauthorized} initialTarget={initialTarget ?? null} onTargetConsumed={onTargetConsumed} />
      )}
    </section>
  );
}
