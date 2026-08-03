// Wires Firebase Cloud Messaging into the freshly-generated Android project
// (gen/android isn't committed, regenerated every CI run - see
// patch-android-signing.mjs for the same pattern). tauri-plugin-mobile-push's
// own Android module (github.com/yanqianglu/tauri-plugin-mobile-push) brings
// the firebase-messaging dependency and FCMService class itself, but ships
// an empty AndroidManifest.xml, so the app module must register the service
// and apply the google-services Gradle plugin itself - neither is something
// a Tauri plugin's Gradle module can inject into the app/root build files.
// Anchors verified against the actual cargo-mobile2 android-studio templates
// (tauri-apps/cargo-mobile2, templates/platforms/android-studio) and the
// plugin's own android/build.gradle.kts + AndroidManifest.xml.
import { readFileSync, writeFileSync } from 'node:fs';

const rootGradlePath = 'src-tauri/gen/android/build.gradle.kts';
const appGradlePath = 'src-tauri/gen/android/app/build.gradle.kts';
const manifestPath = 'src-tauri/gen/android/app/src/main/AndroidManifest.xml';

function patch(path, marker, anchor, insert, label) {
  const original = readFileSync(path, 'utf8');
  if (original.includes(marker)) {
    console.log(`${path} already has ${label}, skipping.`);
    return;
  }
  const patched = original.replace(anchor, insert);
  if (patched === original) {
    console.error(`Could not find anchor for ${label} in ${path} - template must have changed.`);
    process.exit(1);
  }
  writeFileSync(path, patched);
  console.log(`Patched ${path} with ${label}.`);
}

patch(
  rootGradlePath,
  'com.google.gms:google-services',
  '        classpath("com.android.tools.build:gradle:8.0.0")',
  '        classpath("com.android.tools.build:gradle:8.0.0")\n        classpath("com.google.gms:google-services:4.4.2")',
  'google-services classpath'
);

patch(
  appGradlePath,
  'com.google.gms.google-services',
  '    id("rust")',
  '    id("rust")\n    id("com.google.gms.google-services")',
  'google-services plugin'
);

patch(
  manifestPath,
  'app.tauri.mobilepush.FCMService',
  'android:theme="@style/AppTheme">',
  `android:theme="@style/AppTheme">
        <service
            android:name="app.tauri.mobilepush.FCMService"
            android:exported="false">
            <intent-filter>
                <action android:name="com.google.firebase.MESSAGING_EVENT" />
            </intent-filter>
        </service>`,
  'FCMService registration'
);
