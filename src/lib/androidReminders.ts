import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
  createChannel,
  Importance
} from '@tauri-apps/plugin-notification';
import { supabase } from './supabase';
import { localToday } from './meals';

const ORDER_BROADCAST_CHANNEL_ID = 'order-broadcast';
let orderChannelReady = false;

// Sound resource is bundled from static/sounds/order-notification.wav into
// gen/android/app/src/main/res/raw/order_notify.wav at build time - see
// .github/scripts/patch-android-sound.mjs. Android resource names must be
// lowercase with no extension when referenced from code.
async function ensureOrderBroadcastChannel(): Promise<void> {
  if (orderChannelReady) return;
  await createChannel({
    id: ORDER_BROADCAST_CHANNEL_ID,
    name: 'Order reminders',
    importance: Importance.High,
    sound: 'order_notify'
  });
  orderChannelReady = true;
}

function isTauriAndroid(): boolean {
  return '__TAURI_INTERNALS__' in window && /Android/i.test(navigator.userAgent);
}

function alreadyNotifiedToday(key: string): boolean {
  return localStorage.getItem(key) === localToday();
}

function markNotifiedToday(key: string): void {
  localStorage.setItem(key, localToday());
}

async function notifyOnce(key: string, title: string, body: string): Promise<void> {
  if (alreadyNotifiedToday(key)) return;
  let granted = await isPermissionGranted();
  if (!granted) {
    granted = (await requestPermission()) === 'granted';
  }
  if (!granted) return;
  sendNotification({ title, body });
  markNotifiedToday(key);
}

// Device-local clock, same philosophy as localToday() elsewhere in this app —
// the office runs in one timezone and every existing "today" check is already
// client-local, not server-side Asia/Dhaka.
async function checkEmployeeReminder(userId: string): Promise<void> {
  const now = new Date();
  if (now.getHours() < 9) return;
  const today = localToday();
  const { data } = await supabase
    .from('meal_entries')
    .select('id')
    .eq('user_id', userId)
    .eq('entry_date', today)
    .eq('status', 'CONFIRMED')
    .maybeSingle();
  if (!data) {
    await notifyOnce(
      `mealflow-employee-reminder-${userId}`,
      'MealFlow',
      "You haven't ordered today yet."
    );
  }
}

async function checkAdminReminder(userId: string): Promise<void> {
  const now = new Date();
  if (now.getHours() < 10 || (now.getHours() === 10 && now.getMinutes() < 30)) return;
  const today = localToday();
  const { data } = await supabase
    .from('ordering_pause')
    .select('paused_date')
    .eq('paused_date', today)
    .maybeSingle();
  if (!data) {
    await notifyOnce(
      `mealflow-admin-reminder-${userId}`,
      'MealFlow',
      'Ordering is still open — close it if needed.'
    );
  }
}

// Android has no background push (no FCM), so the admin's on-demand "notify
// to order" broadcast (see notify-order edge function) only reaches an
// Android app that's open — via this Realtime subscription on the row it
// inserts, same constraint as the scheduled reminders above.
function initOrderBroadcastListener(): () => void {
  void ensureOrderBroadcastChannel();
  const channel = supabase
    .channel('order-broadcast-listener')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'order_broadcasts' },
      () => {
        void (async () => {
          let granted = await isPermissionGranted();
          if (!granted) granted = (await requestPermission()) === 'granted';
          if (!granted) return;
          sendNotification({
            channelId: ORDER_BROADCAST_CHANNEL_ID,
            title: 'MealFlow',
            body: 'Time to order your meal!'
          });
        })();
      }
    )
    .subscribe();
  return () => void supabase.removeChannel(channel);
}

/** Starts the Android-only foreground reminder loop (and, for employees, the
 *  on-demand order-broadcast listener). No-ops outside the Tauri Android
 *  build — web/desktop get real push instead (see push.ts). Returns a
 *  cleanup function for onDestroy. */
export function initAndroidReminders(userId: string, role: 'employee' | 'admin'): () => void {
  if (!isTauriAndroid()) return () => {};
  const check = () => {
    if (role === 'employee') void checkEmployeeReminder(userId);
    else void checkAdminReminder(userId);
  };
  check();
  const interval = setInterval(check, 15 * 60 * 1000);
  const stopBroadcastListener = role === 'employee' ? initOrderBroadcastListener() : () => {};
  return () => {
    clearInterval(interval);
    stopBroadcastListener();
  };
}
