import { supabase } from './supabase';
import { ensureOrderBroadcastChannel, ORDER_BROADCAST_CHANNEL_ID } from './androidReminders';
import { sendNotification } from '@tauri-apps/plugin-notification';

function isTauriAndroid(): boolean {
  return '__TAURI_INTERNALS__' in window && /Android/i.test(navigator.userAgent);
}

// TEMPORARY debug aid: fcm_tokens stayed empty on a real device with no way
// to see console.error output, so failures get routed into a visible local
// notification instead. Remove once FCM registration is confirmed working.
async function debugNotify(message: string): Promise<void> {
  console.error('[fcm debug]', message);
  try {
    await ensureOrderBroadcastChannel();
    await sendNotification({
      channelId: ORDER_BROADCAST_CHANNEL_ID,
      title: 'FCM DEBUG',
      body: message.slice(0, 200)
    });
  } catch {
    // If even the debug notification fails, there's nothing left to surface to.
  }
}

async function upsertToken(userId: string, token: string): Promise<void> {
  const { error } = await supabase
    .from('fcm_tokens')
    .upsert({ user_id: userId, token }, { onConflict: 'token' });
  if (error) {
    await debugNotify(`upsert failed: ${error.message}`);
  } else {
    await debugNotify(`token stored: ${token.slice(0, 12)}...`);
  }
}

/** Registers for real Android push (delivered even when the app process is
 *  killed - see plan doc) and stores the FCM token server-side. Also shows a
 *  local notification on receipt while the app is foregrounded, since FCM's
 *  `notification`-type payloads only auto-display in background/killed
 *  state. No-ops outside the Tauri Android build. */
export async function initFcm(userId: string): Promise<() => void> {
  if (!isTauriAndroid()) return () => {};

  try {
    const { requestPermission, getToken, onNotificationReceived, onTokenRefresh } = await import(
      'tauri-plugin-mobile-push-api'
    );

    const { granted } = await requestPermission();
    if (!granted) {
      await debugNotify('permission not granted');
      return () => {};
    }

    const token = await getToken();
    if (!token) {
      await debugNotify('getToken returned empty');
      return () => {};
    }
    await upsertToken(userId, token);

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
  } catch (e) {
    await debugNotify(`exception: ${e instanceof Error ? e.message : String(e)}`);
    return () => {};
  }
}
