import { supabase } from './supabase';

function isTauriAndroid(): boolean {
  return '__TAURI_INTERNALS__' in window && /Android/i.test(navigator.userAgent);
}

async function upsertToken(userId: string, token: string): Promise<void> {
  await supabase.from('fcm_tokens').upsert({ user_id: userId, token }, { onConflict: 'token' });
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

  const { requestPermissions, register, getToken, onTokenRefresh } = await import(
    'tauri-plugin-fcm'
  );

  const permission = await requestPermissions();
  if (permission !== 'granted') return () => {};

  await register();
  const { token } = await getToken();
  if (!token) return () => {};
  await upsertToken(userId, token);

  const tokenListener = await onTokenRefresh(({ token: newToken }) => {
    void upsertToken(userId, newToken);
  });
  return () => void tokenListener.unregister();
}
