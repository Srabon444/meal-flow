// Wires Firebase Cloud Messaging into the freshly-generated Android project
// (gen/android isn't committed, regenerated every CI run - see
// patch-android-signing.mjs for the same pattern). tauri-plugin-fcm's own
// Android module (github.com/srod/tauri-plugin-fcm) brings the
// firebase-messaging dependency, FcmMessagingService, and its own
// AndroidManifest.xml (POST_NOTIFICATIONS + service registration) - those
// merge into the app automatically via Android's standard library-manifest
// merge, so only the google-services Gradle plugin (which must be applied at
// the app level, not by a library module) and the config file need wiring
// here.
//
// Anchors are regex, not literal lines: the actual generated project (Tauri
// CLI's own template, not the raw cargo-mobile2 upstream one) uses a
// different AGP version and extra plugin ids than the first attempt at this
// script assumed, and those values are exactly the kind of thing that drifts
// between Tauri CLI releases - matching by structure instead of exact
// version/attribute strings survives that drift.
import { readFileSync, writeFileSync } from 'node:fs';

const rootGradlePath = 'src-tauri/gen/android/build.gradle.kts';
const appGradlePath = 'src-tauri/gen/android/app/build.gradle.kts';

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
