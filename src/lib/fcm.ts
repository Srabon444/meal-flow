import { supabase } from './supabase';
import { ensureOrderBroadcastChannel, ORDER_BROADCAST_CHANNEL_ID } from './androidReminders';
import { sendNotification } from '@tauri-apps/plugin-notification';

function isTauriAndroid(): boolean {
  return '__TAURI_INTERNALS__' in window && /Android/i.test(navigator.userAgent);
}

// TEMPORARY debug aid: the first plugin tried here (tauri-plugin-mobile-push)
// turned out to hardcode granted:false/empty-token on Android with no way to
// see console.error output on a real device - failures get routed into a
// visible local notification too. Remove once FCM registration is confirmed
// solid across a few real installs.
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
 *  killed - see plan doc) and stores the FCM token server-side. No-ops
 *  outside the Tauri Android build. Foreground display of pushes is handled
 *  by the existing order_broadcasts Realtime fallback (androidReminders.ts),
 *  since this plugin has no incoming-message JS bridge - it only handles
 *  token registration, which is all that's needed for background/killed
 *  delivery (that path is native OS/Play Services behavior, no plugin code
 *  involved). */
export async function initFcm(userId: string): Promise<() => void> {
  if (!isTauriAndroid()) return () => {};

  try {
    const { requestPermissions, register, getToken, onTokenRefresh } = await import(
      'tauri-plugin-fcm'
    );

    const permission = await requestPermissions();
    if (permission !== 'granted') {
      await debugNotify(`permission not granted: ${permission}`);
      return () => {};
    }

    await register();
    const { token } = await getToken();
    if (!token) {
      await debugNotify('getToken returned empty');
      return () => {};
    }
    await upsertToken(userId, token);

    const tokenListener = await onTokenRefresh(({ token: newToken }) => {
      void upsertToken(userId, newToken);
    });
    return () => void tokenListener.unregister();
  } catch (e) {
    await debugNotify(`exception: ${e instanceof Error ? e.message : String(e)}`);
    return () => {};
  }
}
