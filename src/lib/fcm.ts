import { supabase } from './supabase';
import { ensureOrderBroadcastChannel, ORDER_BROADCAST_CHANNEL_ID } from './androidReminders';
import { sendNotification } from '@tauri-apps/plugin-notification';

function isTauriAndroid(): boolean {
  return '__TAURI_INTERNALS__' in window && /Android/i.test(navigator.userAgent);
}

async function upsertToken(userId: string, token: string): Promise<void> {
  await supabase.from('fcm_tokens').upsert({ user_id: userId, token }, { onConflict: 'token' });
}

/** Registers for real Android push (delivered even when the app process is
 *  killed - see plan doc) and stores the FCM token server-side. Also shows a
 *  local notification on receipt while the app is foregrounded, since FCM's
 *  `notification`-type payloads only auto-display in background/killed
 *  state. No-ops outside the Tauri Android build. */
export async function initFcm(userId: string): Promise<() => void> {
  if (!isTauriAndroid()) return () => {};

  const { requestPermission, getToken, onNotificationReceived, onTokenRefresh } = await import(
    'tauri-plugin-mobile-push-api'
  );

  const { granted } = await requestPermission();
  if (!granted) return () => {};

  const token = await getToken();
  if (token) await upsertToken(userId, token);

  await ensureOrderBroadcastChannel();
  const receivedListener = await onNotificationReceived((notification) => {
    void sendNotification({
      channelId: ORDER_BROADCAST_CHANNEL_ID,
      title: notification.title ?? 'MealFlow',
      body: notification.body ?? ''
    });
  });
  const tokenListener = await onTokenRefresh(({ token: newToken }) => {
    void upsertToken(userId, newToken);
  });

  return () => {
    void receivedListener.unregister();
    void tokenListener.unregister();
  };
}
