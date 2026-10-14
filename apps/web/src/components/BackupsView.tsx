import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api.js';
import type { BackupStatusResponse, SessionResponse } from '../types.js';

interface BackupsViewProps {
  session: SessionResponse;
  onUnauthorized: () => void;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(2)} MB`;
}

function formatAge(ageSec: number | null): string {
  if (ageSec === null || !Number.isFinite(ageSec)) return 'Nenhum backup registrado';
  if (ageSec < 60) return 'Há menos de 1 minuto';
  const min = Math.floor(ageSec / 60);
  if (min < 60) return `Há ${min} ${min === 1 ? 'minuto' : 'minutos'}`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `Há ${hours} ${hours === 1 ? 'hora' : 'horas'}`;
  const days = Math.floor(hours / 24);
  return `Há ${days} ${days === 1 ? 'dia' : 'dias'}`;
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  // Handle compact stamp like 2026-10-14T134645Z
  const normalized = iso.replace(
    /^(\d{4}-\d{2}-\d{2}T\d{2})(\d{2})(\d{2})Z$/,
    '$1:$2:$3Z',
  );
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function BackupsView({ session, onUnauthorized }: BackupsViewProps) {
  const isAdmin = session.roles.includes('administrator');
  const [status, setStatus] = useState<BackupStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [runningBackup, setRunningBackup] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [copiedHash, setCopiedHash] = useState<string | null>(null);
  const isRunningRef = useRef(false);

  const loadStatus = useCallback(
    async (signal?: AbortSignal) => {
      const controller = new AbortController();
      const effectiveSignal = signal ?? controller.signal;
      setLoading(true);
      setError(null);
      try {
        const res = await api.getBackupStatus(effectiveSignal, onUnauthorized);
        if (!effectiveSignal.aborted) {
          setStatus(res);
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError('Não foi possível carregar o status do sistema de backups.');
      } finally {
        if (!effectiveSignal.aborted) {
          setLoading(false);
        }
      }
    },
    [onUnauthorized],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadStatus(controller.signal);
    return () => controller.abort();
  }, [loadStatus]);

  async function handleRunBackup() {
    if (isRunningRef.current) return;
    isRunningRef.current = true;
    setRunningBackup(true);
    setError(null);
    setSuccessMessage(null);

    const controller = new AbortController();
    try {
      const result = await api.triggerBackup(controller.signal, onUnauthorized);
      setStatus(result.status);
      setSuccessMessage(
        `${result.message} (${result.file} • ${formatBytes(result.sizeBytes)})`,
      );
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      if (err instanceof ApiError && err.status === 403) {
        setError('Apenas administradores podem executar backups manuais.');
      } else {
        setError('Falha ao executar o ciclo de backup. Verifique os logs da operação.');
      }
    } finally {
      isRunningRef.current = false;
      setRunningBackup(false);
    }
  }

  async function handleCopySha(sha: string) {
    try {
      await navigator.clipboard.writeText(sha);
      setCopiedHash(sha);
      setTimeout(() => {
        setCopiedHash((prev) => (prev === sha ? null : prev));
      }, 2000);
    } catch {
      // Ignore clipboard failure
    }
  }

  if (!isAdmin) {
    return (
      <section className="view-panel" aria-labelledby="backups-forbidden-heading">
        <h1 id="backups-forbidden-heading">Acesso restrito</h1>
        <p className="panel-subtitle">
          A gestão de Backups e Cofre Google Drive é exclusiva para Administradores.
        </p>
      </section>
    );
  }

  const pipelineSteps = [
    {
      step: '01',
      title: 'Dump Consistente',
      desc: 'Snapshot transacional do PostgreSQL sem exposição de credenciais.',
      done: Boolean(status && status.files.length > 0),
    },
    {
      step: '02',
      title: 'Manifesto SHA-256',
      desc: 'Cálculo de hash criptográfico individual e catálogo de retenção.',
      done: Boolean(status && status.files.length > 0),
    },
    {
      step: '03',
      title: 'Criptografia rclone crypt',
      desc: 'Conteúdo e nomes de arquivos criptografados antes de sair do servidor.',
      done: Boolean(status?.driveConfigured),
    },
    {
      step: '04',
      title: 'Upload Google Drive',
      desc: `Envio isolado para pasta exclusiva (${status?.driveFolder ?? 'OriumSystem'}) com escopo drive.file.`,
      done: Boolean(status?.driveConfigured && !status?.dryRun),
    },
    {
      step: '05',
      title: 'Verificação & Freshness',
      desc: 'Auditoria cryptcheck pós-envio e validação de RPO (24 horas).',
      done: Boolean(status?.ok),
    },
  ];

  return (
    <section className="view-panel backups-view-panel" aria-labelledby="backups-heading">
      {/* Cabeçalho */}
      <div className="panel-header backups-header">
        <div>
          <div className="profile-title-row">
            <h1 id="backups-heading">Backups &amp; Google Drive</h1>
            {status && (
              <span
                className={`status-badge ${
                  status.driveConfigured && !status.dryRun
                    ? 'active'
                    : status.ok
                      ? 'onboarding'
                      : 'paused'
                }`}
              >
                {status.driveConfigured && !status.dryRun
                  ? 'Google Drive Ativo (rclone crypt)'
                  : status.driveConfigured
                    ? 'Google Drive Configurado (Dry-Run)'
                    : 'Backup Local Ativo'}
              </span>
            )}
          </div>
          <p className="panel-subtitle">
            Orquestração fail-closed de backups do PostgreSQL com criptografia cliente-side (
            <code>rclone crypt</code>) e offload para o Google Drive.
          </p>
        </div>

        <div className="backups-header-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={() => void loadStatus()}
            disabled={loading || runningBackup}
          >
            Atualizar status
          </button>
          <button
            type="button"
            className="primary-button backup-run-cta"
            onClick={() => void handleRunBackup()}
            disabled={runningBackup}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <span>{runningBackup ? 'Executando backup…' : 'Executar Backup Agora'}</span>
          </button>
        </div>
      </div>

      {successMessage && (
        <div className="alert-banner success" role="status">
          <div className="profile-alert-content">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
            <span>{successMessage}</span>
          </div>
          <button
            type="button"
            className="close-alert"
            onClick={() => setSuccessMessage(null)}
            aria-label="Fechar confirmação de backup"
          >
            ✕
          </button>
        </div>
      )}

      {error && (
        <div className="alert-banner error" role="alert">
          <span>{error}</span>
          <button
            type="button"
            className="close-alert"
            onClick={() => setError(null)}
            aria-label="Fechar aviso de erro"
          >
            ✕
          </button>
        </div>
      )}

      {/* KPIs */}
      <div className="backups-kpi-grid">
        <article className="backup-kpi-card">
          <span className="backup-kpi-label">Saúde &amp; RPO (24h)</span>
          <strong className={`backup-kpi-value ${status?.ok ? 'text-success' : 'text-warning'}`}>
            {loading ? 'Verificando…' : status?.ok ? 'Fresco & Íntegro' : 'Aguardando Backup'}
          </strong>
          <span className="backup-kpi-meta">
            {status ? formatAge(status.ageSec) : '—'}
          </span>
        </article>

        <article className="backup-kpi-card">
          <span className="backup-kpi-label">Destino Google Drive</span>
          <strong className="backup-kpi-value">
            {status?.driveConfigured ? 'Conectado (OAuth 2.0)' : 'Modo Local'}
          </strong>
          <span className="backup-kpi-meta">
            Remote: <code>{status?.remoteName ?? 'orium-crypt'}</code> / Pasta:{' '}
            <code>{status?.driveFolder ?? 'OriumSystem'}</code>
          </span>
        </article>

        <article className="backup-kpi-card">
          <span className="backup-kpi-label">Agendamento &amp; Retenção</span>
          <strong className="backup-kpi-value">03:00 (Cuiabá)</strong>
          <span className="backup-kpi-meta">
            Retenção de {status?.retentionDays ?? 30} dias • escopo mínimo <code>drive.file</code>
          </span>
        </article>

        <article className="backup-kpi-card">
          <span className="backup-kpi-label">Snapshots Verificados</span>
          <strong className="backup-kpi-value">
            {status ? `${status.files.length} ${status.files.length === 1 ? 'arquivo' : 'arquivos'}` : '—'}
          </strong>
          <span className="backup-kpi-meta">
            Volume total: {status ? formatBytes(status.totalBytes) : '—'}
          </span>
        </article>
      </div>

      {/* Pipeline de 5 Estágios (Fase 10) */}
      <article className="profile-card backup-pipeline-card" aria-labelledby="pipeline-heading">
        <div className="profile-card-header">
          <div>
            <h2 id="pipeline-heading" className="profile-card-title">
              Pipeline Fail-Closed de Criptografia &amp; Offload (Fase 10)
            </h2>
            <p className="profile-card-subtitle">
              Nenhum dump em texto puro ou chave de descriptografia é enviado ao Google Drive.
            </p>
          </div>
        </div>

        <div className="backup-pipeline-steps">
          {pipelineSteps.map((item) => (
            <div
              key={item.step}
              className={`backup-pipeline-step ${item.done ? 'done' : 'pending'}`}
            >
              <div className="backup-pipeline-step-top">
                <span className="backup-step-number">ETAPA {item.step}</span>
                <span className={`backup-step-dot ${item.done ? 'done' : ''}`} />
              </div>
              <strong className="backup-step-title">{item.title}</strong>
              <p className="backup-step-desc">{item.desc}</p>
            </div>
          ))}
        </div>
      </article>

      {/* Tabela de Snapshots */}
      <article className="profile-card" aria-labelledby="snapshots-heading">
        <div className="profile-card-header">
          <div>
            <h2 id="snapshots-heading" className="profile-card-title">
              Catálogo de Snapshots &amp; Checksums SHA-256
            </h2>
            <p className="profile-card-subtitle">
              Arquivos de dump gerados, validados no manifesto e sincronizados com o cofre criptografado.
            </p>
          </div>
        </div>

        {loading ? (
          <p className="empty-state">Carregando catálogo de backups…</p>
        ) : !status || status.files.length === 0 ? (
          <div className="empty-state">
            <p>Nenhum snapshot encontrado no diretório de staging.</p>
            <button
              type="button"
              className="primary-button"
              onClick={() => void handleRunBackup()}
              disabled={runningBackup}
            >
              Gerar Primeiro Backup Agora
            </button>
          </div>
        ) : (
          <div className="table-responsive">
            <table className="data-table backups-table">
              <thead>
                <tr>
                  <th>Arquivo de Dump</th>
                  <th>Data / Hora</th>
                  <th>Tamanho</th>
                  <th>Checksum SHA-256</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {status.files.map((item, idx) => (
                  <tr key={item.file}>
                    <td>
                      <div className="backup-file-cell">
                        <code className="backup-filename">{item.file}</code>
                        {idx === 0 && <span className="role-badge admin">Mais recente</span>}
                      </div>
                    </td>
                    <td>{formatDateTime(item.createdAt)}</td>
                    <td>{formatBytes(item.sizeBytes)}</td>
                    <td>
                      <div className="backup-sha-cell">
                        <code className="backup-sha-code" title={item.sha256}>
                          {item.sha256.slice(0, 16)}…{item.sha256.slice(-8)}
                        </code>
                        <button
                          type="button"
                          className="ghost-button backup-copy-sha-btn"
                          onClick={() => void handleCopySha(item.sha256)}
                          title="Copiar SHA-256 completo"
                        >
                          {copiedHash === item.sha256 ? 'Copiado!' : 'Copiar'}
                        </button>
                      </div>
                    </td>
                    <td>
                      <span className="verified-email-badge">
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                        SHA-256 Íntegro
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </article>
    </section>
  );
}
