import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent, ReactNode } from 'react';
import type { Demand, DriveEntry, DriveFileStatus, DriveMyFilesResponse, SessionResponse, Task } from '@orium/contracts';
import { api, ApiError, driveFileUrl } from '../api.js';
import { DeadlineDate } from './DeadlineDate.js';
import { showToast } from './Toasts.js';

/** Espelho da pasta Agent/ do Google Drive. Admin navega tudo; colaborador vê os arquivos das próprias tarefas. */
interface DriveViewProps {
  session: SessionResponse;
  onUnauthorized: () => void;
}

const CHUNK_BYTES = 4 * 1024 * 1024;
const CATEGORIES = ['Comprovantes', 'Contratos', 'Identidade Visual', 'Criativos e Midias', 'Relatorios', 'Documentos Gerais'];

const statusLabels: Record<DriveFileStatus, string> = { to_publish: 'A publicar', published: 'Publicado' };

function formatBytes(size: number | null): string {
  if (size === null || size < 0) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

const isImage = (entry: DriveEntry) => /^image\/(jpeg|png|gif|webp)$/.test(entry.mimeType ?? '');
const isVideo = (entry: DriveEntry) => /^video\//.test(entry.mimeType ?? '');

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    const byCode: Record<string, string> = {
      DRIVE_NOT_CONFIGURED: 'O Google Drive ainda não está conectado ao sistema.',
      DRIVE_UNAVAILABLE: 'O Google Drive não respondeu. Tente de novo em instantes.',
      UPLOAD_FOLDER_INVALID: 'Envie arquivos dentro de uma categoria do cliente (ex.: Criativos e Midias).',
      ALREADY_LINKED: 'Este arquivo já está vinculado a essa tarefa.',
      FORBIDDEN: 'Você não tem permissão para essa ação.',
      FILE_TOO_LARGE: 'Arquivo grande demais (limite de 1 GB).',
    };
    return byCode[error.code] ?? fallback;
  }
  return fallback;
}

function FileThumb({ entry }: { entry: DriveEntry }) {
  if (isImage(entry)) {
    return <img className="drive-thumb-img" src={driveFileUrl(entry.path)} alt="" loading="lazy" />;
  }
  const ext = entry.name.split('.').pop()?.toUpperCase().slice(0, 4) ?? '';
  return (
    <span className="drive-thumb-icon" aria-hidden="true">
      {isVideo(entry) ? '▶' : '📄'}
      <small>{ext}</small>
    </span>
  );
}

function StatusChip({ status }: { status: DriveFileStatus | null }) {
  if (!status) return null;
  return <span className={`drive-status ${status}`}>{statusLabels[status]}</span>;
}

/** Modal de visualização (imagem/vídeo) com download. */
function Preview({ entry, onClose }: { entry: DriveEntry; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={entry.name} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="drive-preview">
        <div className="drive-preview-head">
          <strong>{entry.name}</strong>
          <a className="secondary-button" href={driveFileUrl(entry.path, true)}>Baixar</a>
          <button type="button" className="close-button" onClick={onClose} aria-label="Fechar">✕</button>
        </div>
        {isImage(entry) && <img src={driveFileUrl(entry.path)} alt={entry.name} />}
        {isVideo(entry) && <video src={driveFileUrl(entry.path)} controls autoPlay />}
      </div>
    </div>
  );
}

/** Escolha de tarefa (demanda aberta → tarefa) para vincular um arquivo. */
function LinkTaskDialog({ entry, onClose, onLinked, onUnauthorized }: {
  entry: DriveEntry; onClose: () => void; onLinked: () => void; onUnauthorized: () => void;
}) {
  const [query, setQuery] = useState('');
  const [demands, setDemands] = useState<Demand[]>([]);
  const [demandId, setDemandId] = useState('');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [taskId, setTaskId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      api.listDemands({ q: query.trim() || undefined, status: 'open', pageSize: 20 }, controller.signal, onUnauthorized)
        .then((res) => setDemands(res.demands))
        .catch(() => undefined);
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, onUnauthorized]);

  useEffect(() => {
    setTaskId('');
    setTasks([]);
    if (!demandId) return;
    const controller = new AbortController();
    api.getDemand(demandId, controller.signal, onUnauthorized)
      .then((res) => setTasks(res.tasks.filter((t) => t.status !== 'completed')))
      .catch(() => undefined);
    return () => controller.abort();
  }, [demandId, onUnauthorized]);

  async function submit() {
    if (!taskId || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.linkDriveFile({ path: entry.path, taskId }, new AbortController().signal, onUnauthorized);
      showToast(`"${entry.name}" vinculado à tarefa.`);
      onLinked();
    } catch (err) {
      setError(errorMessage(err, 'Não foi possível vincular o arquivo.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="drive-link-title" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal-card">
        <div className="modal-header">
          <h2 id="drive-link-title">Vincular à tarefa</h2>
          <button type="button" className="close-button" onClick={onClose} disabled={busy} aria-label="Fechar">✕</button>
        </div>
        <div className="modal-body">
          <p className="muted-text">Arquivo: <strong>{entry.name}</strong>. O responsável pela tarefa passa a ver e baixar este arquivo, marcado como “a publicar”.</p>
          {error && <div className="alert-banner error" role="alert"><span>{error}</span></div>}
          <div className="form-field">
            <label htmlFor="drive-link-search">Demanda</label>
            <input id="drive-link-search" type="search" placeholder="Buscar demanda aberta…" value={query} onChange={(e) => setQuery(e.target.value)} />
            <select value={demandId} onChange={(e) => setDemandId(e.target.value)} aria-label="Demanda">
              <option value="">Selecione a demanda…</option>
              {demands.map((d) => <option key={d.id} value={d.id}>{d.client.name} — {d.title}</option>)}
            </select>
          </div>
          <div className="form-field">
            <label htmlFor="drive-link-task">Tarefa</label>
            <select id="drive-link-task" value={taskId} onChange={(e) => setTaskId(e.target.value)} disabled={!demandId}>
              <option value="">{demandId ? (tasks.length ? 'Selecione a tarefa…' : 'Nenhuma tarefa aberta nesta demanda') : 'Escolha a demanda primeiro'}</option>
              {tasks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
            </select>
          </div>
          <div className="modal-actions">
            <button type="button" className="secondary-button" onClick={onClose} disabled={busy}>Cancelar</button>
            <button type="button" className="primary-button" onClick={() => void submit()} disabled={!taskId || busy}>{busy ? 'Vinculando…' : 'Vincular'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function FileCard({ entry, onOpen, children }: { entry: DriveEntry; onOpen: () => void; children?: ReactNode }) {
  const previewable = isImage(entry) || isVideo(entry);
  return (
    <li className={`drive-card ${entry.status ?? ''}`}>
      <button type="button" className="drive-thumb" onClick={previewable ? onOpen : undefined} disabled={!previewable} aria-label={previewable ? `Visualizar ${entry.name}` : entry.name}>
        <FileThumb entry={entry} />
      </button>
      <div className="drive-card-body">
        <span className="drive-name" title={entry.name}>{entry.name}</span>
        <span className="drive-meta">
          {formatBytes(entry.size)}
          <StatusChip status={entry.status} />
        </span>
        {entry.links.length > 0 && (
          <span className="drive-links" title={entry.links.map((l) => `${l.taskTitle ?? ''} (${l.assigneeName ?? ''})`).join('\n')}>
            📎 {entry.links[0]!.taskTitle}{entry.links.length > 1 ? ` +${entry.links.length - 1}` : ''}
          </span>
        )}
        <div className="drive-actions">
          <a className="text-button" href={driveFileUrl(entry.path, true)}>Baixar</a>
          {children}
        </div>
      </div>
    </li>
  );
}

export function DriveView({ session, onUnauthorized }: DriveViewProps) {
  const isAdmin = session.roles.includes('administrator');
  return isAdmin ? <AdminDrive onUnauthorized={onUnauthorized} /> : <MyFiles onUnauthorized={onUnauthorized} />;
}

function AdminDrive({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [path, setPath] = useState('');
  const [entries, setEntries] = useState<DriveEntry[]>([]);
  const [configured, setConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [onlyToPublish, setOnlyToPublish] = useState(false);
  const [preview, setPreview] = useState<DriveEntry | null>(null);
  const [linking, setLinking] = useState<DriveEntry | null>(null);
  const [subject, setSubject] = useState('');
  const [uploading, setUploading] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const requestRef = useRef<AbortController | null>(null);

  const load = useCallback(async (target: string) => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const res = await api.listDrive(target, controller.signal, onUnauthorized);
      if (controller.signal.aborted) return;
      setConfigured(res.configured);
      setEntries(res.entries);
    } catch (err) {
      if (!controller.signal.aborted) setError(errorMessage(err, 'Não foi possível abrir esta pasta do Drive.'));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [onUnauthorized]);

  useEffect(() => {
    void load(path);
    return () => requestRef.current?.abort();
  }, [path, load]);

  const segments = path ? path.split('/') : [];
  const canUpload = segments.length >= 2 && CATEGORIES.includes(segments[1]!);
  const folders = entries.filter((e) => e.isDir);
  const files = entries.filter((e) => !e.isDir && (!onlyToPublish || e.status === 'to_publish'));
  const toPublishCount = useMemo(() => entries.filter((e) => e.status === 'to_publish').length, [entries]);

  async function changeStatus(entry: DriveEntry, status: DriveFileStatus | null) {
    try {
      await api.setDriveFileStatus({ fileId: entry.id, status }, new AbortController().signal, onUnauthorized);
      setEntries((list) => list.map((e) => (e.id === entry.id ? { ...e, status } : e)));
    } catch (err) {
      showToast(errorMessage(err, 'Não foi possível mudar o status.'));
    }
  }

  async function upload(list: File[]) {
    const valid = list.filter((f) => f.size > 0);
    if (!valid.length || uploading) return;
    const controller = new AbortController();
    let sent = 0;
    const duplicates: string[] = [];
    try {
      for (const [index, file] of valid.entries()) {
        const uploadId = crypto.randomUUID();
        const parts = Math.ceil(file.size / CHUNK_BYTES);
        for (let part = 0; part < parts; part += 1) {
          setUploading(`Enviando ${index + 1} de ${valid.length}: ${file.name} (${Math.round(((part + 1) / parts) * 100)}%)`);
          await api.uploadDriveChunk(uploadId, part, file.slice(part * CHUNK_BYTES, (part + 1) * CHUNK_BYTES), controller.signal, onUnauthorized);
        }
        const res = await api.completeDriveUpload(
          { uploadId, folder: path, fileName: file.name, subject: subject.trim() || undefined, numbered: valid.length > 1 },
          controller.signal,
          onUnauthorized,
        );
        sent += res.uploaded.length;
        duplicates.push(...res.duplicates.map((d) => d.name));
      }
      showToast(`${sent} arquivo(s) enviado(s)${duplicates.length ? `; ${duplicates.length} repetido(s) não duplicado(s)` : ''}.`);
    } catch (err) {
      showToast(errorMessage(err, `Envio interrompido. ${sent} arquivo(s) chegaram ao Drive.`));
    } finally {
      setUploading(null);
      void load(path);
    }
  }

  function onDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setDragOver(false);
    if (canUpload) void upload([...event.dataTransfer.files]);
  }

  if (!configured) {
    return <div className="empty-state"><p className="empty-title">Google Drive ainda não conectado</p><p className="empty-description">Peça ao administrador do sistema para ativar o espelho do Drive.</p></div>;
  }

  return (
    <section
      className={`drive-view ${dragOver ? 'drag-over' : ''}`}
      onDragOver={(e) => { if (canUpload) { e.preventDefault(); setDragOver(true); } }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <nav className="drive-breadcrumb" aria-label="Pastas">
        <button type="button" className="text-button" onClick={() => setPath('')}>Google Drive</button>
        {segments.map((segment, index) => (
          <span key={`${index}-${segment}`}>
            <span aria-hidden="true"> › </span>
            <button type="button" className="text-button" onClick={() => setPath(segments.slice(0, index + 1).join('/'))} aria-current={index === segments.length - 1 ? 'page' : undefined}>{segment}</button>
          </span>
        ))}
      </nav>

      <div className="drive-toolbar">
        {toPublishCount > 0 && (
          <label className="drive-filter">
            <input type="checkbox" checked={onlyToPublish} onChange={(e) => setOnlyToPublish(e.target.checked)} />
            Só “a publicar” ({toPublishCount})
          </label>
        )}
        {canUpload && (
          <div className="drive-upload">
            <input type="text" placeholder="Assunto (ex.: anúncios site)" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={80} aria-label="Assunto para o nome dos arquivos" />
            <input ref={fileInput} type="file" multiple hidden onChange={(e) => { void upload([...(e.target.files ?? [])]); e.target.value = ''; }} />
            <button type="button" className="primary-button" onClick={() => fileInput.current?.click()} disabled={Boolean(uploading)}>Enviar arquivos</button>
          </div>
        )}
      </div>
      {uploading && <p className="drive-progress" role="status">{uploading}</p>}
      {canUpload && !uploading && <p className="muted-text drive-hint">Arraste arquivos para esta pasta. Repetidos não são duplicados; nomes seguem o padrão data_assunto_NN.</p>}

      {error && <div className="alert-banner error" role="alert"><span>{error}</span><button type="button" className="secondary-button" onClick={() => void load(path)}>Tentar de novo</button></div>}
      {loading && entries.length === 0 && <p className="status-text">Carregando pasta…</p>}

      {folders.length > 0 && (
        <ul className="drive-folders">
          {folders.map((folder) => (
            <li key={folder.path}>
              <button type="button" className="drive-folder" onClick={() => setPath(folder.path)}>
                <span aria-hidden="true">📁</span> {folder.name}
              </button>
            </li>
          ))}
        </ul>
      )}

      {files.length > 0 && (
        <ul className="drive-grid">
          {files.map((entry) => (
            <FileCard key={entry.id || entry.path} entry={entry} onOpen={() => setPreview(entry)}>
              <select className="drive-status-select" value={entry.status ?? ''} onChange={(e) => void changeStatus(entry, (e.target.value || null) as DriveFileStatus | null)} aria-label={`Status de ${entry.name}`}>
                <option value="">Sem status</option>
                <option value="to_publish">A publicar</option>
                <option value="published">Publicado</option>
              </select>
              <button type="button" className="text-button" onClick={() => setLinking(entry)}>Vincular</button>
            </FileCard>
          ))}
        </ul>
      )}

      {!loading && !error && folders.length === 0 && files.length === 0 && (
        <div className="empty-state"><p className="empty-title">{onlyToPublish ? 'Nada a publicar aqui.' : 'Pasta vazia.'}</p></div>
      )}

      {preview && <Preview entry={preview} onClose={() => setPreview(null)} />}
      {linking && (
        <LinkTaskDialog entry={linking} onClose={() => setLinking(null)} onUnauthorized={onUnauthorized} onLinked={() => { setLinking(null); void load(path); }} />
      )}
    </section>
  );
}

function MyFiles({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [data, setData] = useState<DriveMyFilesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<DriveEntry | null>(null);

  const load = useCallback(() => {
    const controller = new AbortController();
    api.myDriveFiles(controller.signal, onUnauthorized)
      .then((res) => { setData(res); setError(null); })
      .catch((err) => { if (!controller.signal.aborted) setError(errorMessage(err, 'Não foi possível carregar seus arquivos.')); });
    return controller;
  }, [onUnauthorized]);

  useEffect(() => {
    const controller = load();
    return () => controller.abort();
  }, [load]);

  async function markPublished(entry: DriveEntry, published: boolean) {
    try {
      await api.setDriveFileStatus({ fileId: entry.id, status: published ? 'published' : 'to_publish' }, new AbortController().signal, onUnauthorized);
      setData((current) => current && {
        ...current,
        tasks: current.tasks.map((t) => ({ ...t, files: t.files.map((f) => (f.id === entry.id ? { ...f, status: published ? 'published' : 'to_publish' } : f)) })),
      });
      if (published) showToast(`"${entry.name}" marcado como publicado.`);
    } catch (err) {
      showToast(errorMessage(err, 'Não foi possível mudar o status.'));
    }
  }

  if (error) return <div className="alert-banner error" role="alert"><span>{error}</span></div>;
  if (!data) return <p className="status-text">Carregando seus arquivos…</p>;
  if (data.tasks.length === 0) {
    return <div className="empty-state"><p className="empty-title">Nenhum arquivo para você agora.</p><p className="empty-description">Quando uma tarefa sua tiver fotos, vídeos ou documentos, eles aparecem aqui para baixar e publicar.</p></div>;
  }

  return (
    <section className="drive-view">
      {data.tasks.map((task) => {
        const pending = task.files.filter((f) => f.status !== 'published').length;
        return (
          <article key={task.taskId} className="drive-task-group">
            <header>
              <h3>{task.taskTitle}</h3>
              <p className="muted-text">{task.clientName} · {task.demandTitle} · Entrega: <DeadlineDate date={task.deliveryDate} /> · {pending ? `${pending} a publicar` : 'tudo publicado ✓'}</p>
            </header>
            <ul className="drive-grid">
              {task.files.map((entry) => (
                <FileCard key={entry.id} entry={entry} onOpen={() => setPreview(entry)}>
                  <label className="drive-published-toggle">
                    <input type="checkbox" checked={entry.status === 'published'} onChange={(e) => void markPublished(entry, e.target.checked)} />
                    Publicado
                  </label>
                </FileCard>
              ))}
            </ul>
          </article>
        );
      })}
      {preview && <Preview entry={preview} onClose={() => setPreview(null)} />}
    </section>
  );
}
