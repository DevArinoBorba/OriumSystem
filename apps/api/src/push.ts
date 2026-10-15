import crypto from 'node:crypto';
import type { Database } from './db.js';
import { AppError } from './errors.js';

const DEFAULT_VAPID_PUBLIC_KEY =
  'BPAWbYii7f6CqC0W7Q5-iS1z9Fk9zaO5di8tJ8s3dP5lgmhHstkYlf0IjYNsMFeVbquFupqJVkRGtzI0T8TBm8g';
const DEFAULT_VAPID_PRIVATE_KEY =
  'bkTKHqrK2dK8OteRXZrdQlvuwraks9P7GZ9DC3VfVEo';
const DEFAULT_VAPID_SUBJECT = 'mailto:oriumdigitalrino@gmail.com';

export function getVapidConfig() {
  const publicKey = (process.env.VAPID_PUBLIC_KEY || DEFAULT_VAPID_PUBLIC_KEY).trim();
  const privateKey = (process.env.VAPID_PRIVATE_KEY || DEFAULT_VAPID_PRIVATE_KEY).trim();
  const subject = (process.env.VAPID_SUBJECT || DEFAULT_VAPID_SUBJECT).trim();
  return { publicKey, privateKey, subject };
}

function base64UrlDecode(input: string): Buffer {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + pad, 'base64');
}

function base64UrlEncode(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

/**
 * Generates an RFC 8292 VAPID Authorization header (`vapid t=<jwt>, k=<publicKey>`)
 * signed with ES256 (P-256 IEEE P1363 64-byte signature).
 */
function createVapidAuthHeader(endpoint: string): string {
  const { publicKey, privateKey, subject } = getVapidConfig();
  const url = new URL(endpoint);
  const audience = `${url.protocol}//${url.host}`;
  const exp = Math.floor(Date.now() / 1000) + 12 * 3600;

  const headerSegment = base64UrlEncode(
    Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' }), 'utf8'),
  );
  const payloadSegment = base64UrlEncode(
    Buffer.from(JSON.stringify({ aud: audience, exp, sub: subject }), 'utf8'),
  );
  const unsignedToken = `${headerSegment}.${payloadSegment}`;

  const pubBytes = base64UrlDecode(publicKey);
  if (pubBytes.length !== 65 || pubBytes[0] !== 0x04) {
    throw new Error('Invalid uncompressed P-256 VAPID public key');
  }
  const x = base64UrlEncode(pubBytes.subarray(1, 33));
  const y = base64UrlEncode(pubBytes.subarray(33, 65));

  const jwkKey = crypto.createPrivateKey({
    key: {
      kty: 'EC',
      crv: 'P-256',
      x,
      y,
      d: privateKey,
    },
    format: 'jwk',
  });

  const signature = crypto.sign('sha256', Buffer.from(unsignedToken, 'ascii'), {
    key: jwkKey,
    dsaEncoding: 'ieee-p1363',
  });

  const jwt = `${unsignedToken}.${base64UrlEncode(signature)}`;
  return `vapid t=${jwt}, k=${publicKey}`;
}

/**
 * Encrypts a UTF-8 JSON payload according to RFC 8291 (Web Push Message Encryption)
 * using the `aes128gcm` content encoding (RFC 8188).
 */
export function encryptWebPushPayload(
  payloadText: string,
  p256dhBase64Url: string,
  authBase64Url: string,
): Buffer {
  const uaPublic = base64UrlDecode(p256dhBase64Url);
  const authSecret = base64UrlDecode(authBase64Url);

  if (uaPublic.length !== 65 || uaPublic[0] !== 0x04) {
    throw new Error('Invalid subscriber p256dh key');
  }
  if (authSecret.length < 16) {
    throw new Error('Invalid subscriber auth secret');
  }

  const ecdh = crypto.createECDH('prime256v1');
  const asPublic = ecdh.generateKeys();
  const sharedSecret = ecdh.computeSecret(uaPublic);

  const keyInfo = Buffer.concat([
    Buffer.from('WebPush: info\0', 'ascii'),
    uaPublic,
    asPublic,
  ]);
  const ikm = Buffer.from(
    crypto.hkdfSync('sha256', sharedSecret, authSecret, keyInfo, 32),
  );

  const salt = crypto.randomBytes(16);
  const cekInfo = Buffer.from('Content-Encoding: aes128gcm\0', 'ascii');
  const nonceInfo = Buffer.from('Content-Encoding: nonce\0', 'ascii');

  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, cekInfo, 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, nonceInfo, 12));

  // RFC 8188 final record delimiter is 0x02
  const plaintextRecord = Buffer.concat([
    Buffer.from(payloadText, 'utf8'),
    Buffer.from([0x02]),
  ]);

  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const encrypted = Buffer.concat([cipher.update(plaintextRecord), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // RFC 8188 aes128gcm header: salt(16) || rs(4, uint32BE=4096) || idlen(1, uint8=65) || keyid(65)
  const header = Buffer.alloc(16 + 4 + 1 + asPublic.length);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header.writeUInt8(asPublic.length, 20);
  asPublic.copy(header, 21);

  return Buffer.concat([header, encrypted, authTag]);
}

export interface WebPushPayload {
  title: string;
  body: string;
  tag?: string;
  url?: string;
}

export interface PushSubscriptionRow {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export async function sendWebPushMessage(
  subscription: PushSubscriptionRow,
  payload: WebPushPayload,
): Promise<{ ok: boolean; status: number; gone: boolean }> {
  const bodyBuffer = encryptWebPushPayload(
    JSON.stringify(payload),
    subscription.p256dh,
    subscription.auth,
  );
  const authHeader = createVapidAuthHeader(subscription.endpoint);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(subscription.endpoint, {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(bodyBuffer.length),
        TTL: '86400',
        Urgency: 'high',
      },
      body: new Uint8Array(bodyBuffer),
      signal: controller.signal,
    });
    const gone = response.status === 404 || response.status === 410;
    return { ok: response.ok, status: response.status, gone };
  } finally {
    clearTimeout(timeout);
  }
}

export async function savePushSubscription(
  database: Database,
  userId: string,
  input: {
    endpoint: string;
    keys: { p256dh: string; auth: string };
    userAgent?: string | null;
  },
): Promise<{ id: string; subscribed: true }> {
  const parsedUrl = new URL(input.endpoint);
  if (parsedUrl.protocol !== 'https:') {
    throw new AppError(400, 'INVALID_INPUT');
  }

  const res = await database.pool.query<{ id: string }>(
    `INSERT INTO public.push_subscription (id, user_id, endpoint, p256dh, auth, user_agent, created_at, updated_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, NOW(), NOW())
     ON CONFLICT (endpoint)
     DO UPDATE SET
       user_id = EXCLUDED.user_id,
       p256dh = EXCLUDED.p256dh,
       auth = EXCLUDED.auth,
       user_agent = COALESCE(EXCLUDED.user_agent, public.push_subscription.user_agent),
       updated_at = NOW()
     RETURNING id`,
    [
      userId,
      input.endpoint,
      input.keys.p256dh,
      input.keys.auth,
      input.userAgent ?? null,
    ],
  );

  return { id: res.rows[0]!.id, subscribed: true };
}

export async function removePushSubscription(
  database: Database,
  userId: string,
  endpoint: string,
): Promise<{ removed: boolean }> {
  const res = await database.pool.query(
    `DELETE FROM public.push_subscription WHERE user_id = $1 AND endpoint = $2`,
    [userId, endpoint],
  );
  return { removed: (res.rowCount ?? 0) > 0 };
}

export async function dispatchPushToUser(
  database: Database,
  userId: string,
  payload: WebPushPayload,
): Promise<{ sent: number; failed: number; totalDevices: number }> {
  const subsRes = await database.pool.query<PushSubscriptionRow>(
    `SELECT id, user_id, endpoint, p256dh, auth
     FROM public.push_subscription
     WHERE user_id = $1`,
    [userId],
  );

  let sent = 0;
  let failed = 0;

  for (const sub of subsRes.rows) {
    try {
      const result = await sendWebPushMessage(sub, payload);
      if (result.ok) {
        sent += 1;
        await database.pool.query(
          `UPDATE public.push_subscription SET last_notified_at = NOW() WHERE id = $1`,
          [sub.id],
        );
      } else {
        failed += 1;
        if (result.gone) {
          await database.pool.query(
            `DELETE FROM public.push_subscription WHERE id = $1`,
            [sub.id],
          );
        }
      }
    } catch {
      failed += 1;
    }
  }

  return { sent, failed, totalDevices: subsRes.rows.length };
}

function formatNotificationPushPayload(row: {
  id: string;
  kind: string;
  demand_title: string;
  task_title: string | null;
}): WebPushPayload {
  const subject = row.task_title
    ? `${row.task_title} (${row.demand_title})`
    : row.demand_title;

  switch (row.kind) {
    case 'task_assigned':
      return {
        title: '📌 Nova tarefa atribuída a você',
        body: subject,
        tag: `orium-notif-${row.id}`,
        url: '/',
      };
    case 'task_review_submitted':
      return {
        title: '🔎 Tarefa aguardando sua revisão',
        body: subject,
        tag: `orium-notif-${row.id}`,
        url: '/',
      };
    case 'task_review_approved':
      return {
        title: '✅ Sua tarefa foi aprovada!',
        body: subject,
        tag: `orium-notif-${row.id}`,
        url: '/',
      };
    case 'task_review_rejected':
      return {
        title: '⚠️ Ajustes solicitados na tarefa',
        body: subject,
        tag: `orium-notif-${row.id}`,
        url: '/',
      };
    case 'task_pause_requested':
      return {
        title: '⏸️ Pedido de pausa em tarefa',
        body: subject,
        tag: `orium-notif-${row.id}`,
        url: '/',
      };
    case 'task_pause_approved':
      return {
        title: '⏸️ Pausa de tarefa aprovada',
        body: subject,
        tag: `orium-notif-${row.id}`,
        url: '/',
      };
    case 'task_pause_rejected':
      return {
        title: '▶️ Pedido de pausa recusado',
        body: subject,
        tag: `orium-notif-${row.id}`,
        url: '/',
      };
    case 'task_unblocked':
      return {
        title: '🔓 Tarefa desbloqueada e pronta!',
        body: subject,
        tag: `orium-notif-${row.id}`,
        url: '/',
      };
    case 'deadline_approaching':
      return {
        title: '⏰ Prazo próximo de entrega',
        body: subject,
        tag: `orium-notif-${row.id}`,
        url: '/',
      };
    case 'deadline_overdue':
      return {
        title: '🚨 Prazo vencido — atenção imediata',
        body: subject,
        tag: `orium-notif-${row.id}`,
        url: '/',
      };
    default:
      return {
        title: '🔔 Orium — Nova atualização',
        body: subject,
        tag: `orium-notif-${row.id}`,
        url: '/',
      };
  }
}

/**
 * Scans `public.notification` for recently created notifications (`pushed_at IS NULL`)
 * whose recipient has at least one active Web Push subscription, sends background Web Push,
 * and marks `pushed_at = NOW()`. Works for both API-created notifications and WhatsApp
 * Hermes Agent notifications (`orium-hermes-query`).
 */
export async function dispatchPendingNotificationsPush(database: Database): Promise<number> {
  try {
    const pendingRes = await database.pool.query<{
      id: string;
      recipient_user_id: string;
      kind: string;
      demand_title: string;
      task_title: string | null;
    }>(
      `SELECT n.id, n.recipient_user_id, n.kind, d.title AS demand_title, t.title AS task_title
       FROM public.notification n
       JOIN public.demand d ON d.id = n.demand_id
       LEFT JOIN public.task t ON t.id = n.task_id
       WHERE n.pushed_at IS NULL
         AND n.read_at IS NULL
         AND n.created_at >= NOW() - INTERVAL '2 hours'
         AND EXISTS (
           SELECT 1 FROM public.push_subscription ps
           WHERE ps.user_id = n.recipient_user_id
         )
       ORDER BY n.created_at ASC
       LIMIT 30`,
    );

    let dispatched = 0;
    for (const row of pendingRes.rows) {
      await database.pool.query(
        `UPDATE public.notification SET pushed_at = NOW() WHERE id = $1`,
        [row.id],
      );
      const payload = formatNotificationPushPayload(row);
      const res = await dispatchPushToUser(database, row.recipient_user_id, payload);
      if (res.sent > 0) dispatched += 1;
    }
    return dispatched;
  } catch {
    return 0;
  }
}
