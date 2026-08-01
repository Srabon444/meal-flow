// `tauri android init` regenerates gen/android from scratch every CI run, and its
// default template has no release signingConfig at all (verified against the
// actual Tauri CLI template) - installs get an "unsigned APK" warning. This patches
// the freshly-generated app/build.gradle.kts to sign release builds from
// gen/android/keystore.properties, written by the workflow step just before this
// one only when the ANDROID_KEYSTORE_BASE64 secret is set.
import { readFileSync, writeFileSync } from 'node:fs';

const path = 'src-tauri/gen/android/app/build.gradle.kts';
const original = readFileSync(path, 'utf8');

if (original.includes('signingConfigs')) {
  console.log('build.gradle.kts already has a signingConfigs block, skipping.');
  process.exit(0);
}

const signingConfigsBlock = `    signingConfigs {
        create("release") {
            val props = java.util.Properties()
            val propsFile = rootProject.file("keystore.properties")
            if (propsFile.exists()) {
                props.load(java.io.FileInputStream(propsFile))
                storeFile = rootProject.file(props["storeFile"] as String)
                storePassword = props["password"] as String
                keyAlias = props["keyAlias"] as String
                keyPassword = props["password"] as String
            }
        }
    }
    buildTypes {`;

const withSigningConfigs = original.replace('    buildTypes {', signingConfigsBlock);
if (withSigningConfigs === original) {
  console.error('Could not find "    buildTypes {" anchor - template must have changed.');
  process.exit(1);
}

const withReleaseSigning = withSigningConfigs.replace(
  '        getByName("release") {\n            isMinifyEnabled = true',
  '        getByName("release") {\n            signingConfig = signingConfigs.getByName("release")\n            isMinifyEnabled = true'
);
if (withReleaseSigning === withSigningConfigs) {
  console.error('Could not find release buildType anchor - template must have changed.');
  process.exit(1);
}

writeFileSync(path, withReleaseSigning);
console.log('Patched build.gradle.kts with release signing config.');
