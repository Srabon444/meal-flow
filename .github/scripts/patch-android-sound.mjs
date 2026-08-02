// Bundles a custom notification sound into the freshly-generated Android
// project (gen/android isn't committed, regenerated every CI run - see
// patch-android-signing.mjs for the same pattern). Android resource names
// must be lowercase with no extension in code, so the file becomes
// res/raw/order_notify.wav and JS references it as `sound: 'order_notify'`.
//
// No-ops if the source file doesn't exist yet - the app then falls back to
// the channel's default sound (see androidReminders.ts). Drop a .wav at
// static/sounds/order-notification.wav to activate it.
import { existsSync, mkdirSync, copyFileSync } from 'node:fs';

const source = 'static/sounds/order-notification.wav';
const destDir = 'src-tauri/gen/android/app/src/main/res/raw';
const dest = `${destDir}/order_notify.wav`;

if (!existsSync(source)) {
  console.log(`${source} not found, skipping custom notification sound.`);
  process.exit(0);
}

mkdirSync(destDir, { recursive: true });
copyFileSync(source, dest);
console.log(`Bundled ${source} -> ${dest}`);
