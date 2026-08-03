// Wires Firebase Cloud Messaging into the freshly-generated Android project
// (gen/android isn't committed, regenerated every CI run - see
// patch-android-signing.mjs for the same pattern). tauri-plugin-mobile-push's
// own Android module (github.com/yanqianglu/tauri-plugin-mobile-push) brings
// the firebase-messaging dependency and FCMService class itself, but ships
// an empty AndroidManifest.xml, so the app module must register the service
// and apply the google-services Gradle plugin itself - neither is something
// a Tauri plugin's Gradle module can inject into the app/root build files.
//
// Anchors are regex, not literal lines: the actual generated project (Tauri
// CLI's own template, not the raw cargo-mobile2 upstream one) uses a
// different AGP version and extra plugin ids than expected on the first
// attempt at this script, and the AGP/theme values are exactly the kind of
// thing that drifts between Tauri CLI releases - matching by structure
// instead of exact version/attribute strings survives that drift.
import { readFileSync, writeFileSync } from 'node:fs';

const rootGradlePath = 'src-tauri/gen/android/build.gradle.kts';
const appGradlePath = 'src-tauri/gen/android/app/build.gradle.kts';
const manifestPath = 'src-tauri/gen/android/app/src/main/AndroidManifest.xml';

function patch(path, marker, anchorRegex, insert, label) {
  const original = readFileSync(path, 'utf8');
  if (original.includes(marker)) {
    console.log(`${path} already has ${label}, skipping.`);
    return;
  }
  const match = original.match(anchorRegex);
  if (!match) {
    console.error(`Could not find anchor for ${label} in ${path} - template must have changed.`);
    process.exit(1);
  }
  const patched = original.replace(anchorRegex, insert(match));
  writeFileSync(path, patched);
  console.log(`Patched ${path} with ${label}.`);
}

patch(
  rootGradlePath,
  'com.google.gms:google-services',
  /([ \t]*)classpath\("com\.android\.tools\.build:gradle:[^"]+"\)/,
  (m) => `${m[0]}\n${m[1]}classpath("com.google.gms:google-services:4.4.2")`,
  'google-services classpath'
);

patch(
  appGradlePath,
  'com.google.gms.google-services',
  /([ \t]*)id\("rust"\)/,
  (m) => `${m[1]}id("com.google.gms.google-services")\n${m[0]}`,
  'google-services plugin'
);

patch(
  manifestPath,
  'app.tauri.mobilepush.FCMService',
  /<application[^>]*>/,
  (m) => `${m[0]}
        <service
            android:name="app.tauri.mobilepush.FCMService"
            android:exported="false">
            <intent-filter>
                <action android:name="com.google.firebase.MESSAGING_EVENT" />
            </intent-filter>
        </service>`,
  'FCMService registration'
);
