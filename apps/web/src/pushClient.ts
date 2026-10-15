async function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, {
    ...init,
    credentials: 'include',
  });
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export interface PushSubscribeResult {
  ok: boolean;
  permission: NotificationPermission | 'unsupported';
  reason?: string;
}

/**
 * Registers or refreshes the browser's Web Push (VAPID) subscription with the Orium backend
 * so push notifications arrive in the background even when the app is closed.
 */
export async function ensurePushSubscription(options?: {
  requestPermission?: boolean;
}): Promise<PushSubscribeResult> {
  if (
    typeof window === 'undefined' ||
    !('Notification' in window) ||
    !('serviceWorker' in navigator) ||
    !('PushManager' in window)
  ) {
    return { ok: false, permission: 'unsupported', reason: 'unsupported' };
  }

  let permission = Notification.permission;
  if (permission === 'default' && options?.requestPermission) {
    permission = await Notification.requestPermission();
  }

  if (permission !== 'granted') {
    return { ok: false, permission, reason: 'permission_not_granted' };
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    const vapidRes = await apiFetch('/api/v1/push/vapid-public-key');
    if (!vapidRes.ok) {
      return { ok: false, permission, reason: 'vapid_key_unavailable' };
    }
    const { publicKey } = (await vapidRes.json()) as { publicKey: string };
    const applicationServerKey = urlBase64ToUint8Array(publicKey);

    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey as unknown as BufferSource,
      });
    }

    const subJson = subscription.toJSON();
    if (!subJson.endpoint || !subJson.keys?.p256dh || !subJson.keys?.auth) {
      return { ok: false, permission, reason: 'invalid_subscription_keys' };
    }

    const saveRes = await apiFetch('/api/v1/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        endpoint: subJson.endpoint,
        keys: {
          p256dh: subJson.keys.p256dh,
          auth: subJson.keys.auth,
        },
        userAgent: navigator.userAgent.slice(0, 500),
      }),
    });

    if (!saveRes.ok) {
      return { ok: false, permission, reason: 'backend_save_failed' };
    }

    localStorage.setItem('orium_push_subscribed_v1', 'true');
    return { ok: true, permission: 'granted' };
  } catch (err) {
    return {
      ok: false,
      permission,
      reason: err instanceof Error ? err.message : 'subscribe_error',
    };
  }
}

export async function triggerServerTestPush(): Promise<{
  ok: boolean;
  sent: number;
  totalDevices: number;
}> {
  await ensurePushSubscription({ requestPermission: true });
  const res = await apiFetch('/api/v1/push/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    return { ok: false, sent: 0, totalDevices: 0 };
  }
  const data = (await res.json()) as { sent: number; totalDevices: number };
  return { ok: true, sent: data.sent, totalDevices: data.totalDevices };
}
