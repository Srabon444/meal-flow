import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';
import { supabase } from './supabase';
import { localToday } from './meals';

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
    await notifyOnce('officemeal-employee-reminder', 'OfficeMeal', "You haven't ordered today yet.");
  }
}

async function checkAdminReminder(): Promise<void> {
  const now = new Date();
  if (now.getHours() < 10 || (now.getHours() === 10 && now.getMinutes() < 30)) return;
  const today = localToday();
  const { data } = await supabase
    .from('ordering_pause')
    .select('paused_date')
    .eq('paused_date', today)
    .maybeSingle();
  if (!data) {
    await notifyOnce('officemeal-admin-reminder', 'OfficeMeal', 'Ordering is still open — close it if needed.');
  }
}

/** Starts the Android-only foreground reminder loop. No-ops outside the Tauri
 *  Android build — web/desktop get real push instead (see push.ts). Returns
 *  a cleanup function for onDestroy. */
export function initAndroidReminders(userId: string, role: 'employee' | 'admin'): () => void {
  if (!isTauriAndroid()) return () => {};
  const check = () => {
    if (role === 'employee') void checkEmployeeReminder(userId);
    else void checkAdminReminder();
  };
  check();
  const interval = setInterval(check, 15 * 60 * 1000);
  return () => clearInterval(interval);
}
