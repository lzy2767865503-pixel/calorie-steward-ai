const {
  withAndroidManifest,
  withAppBuildGradle,
  withDangerousMod,
} = require("@expo/config-plugins");
const { mkdir, readFile, writeFile } = require("node:fs/promises");
const { dirname, join } = require("node:path");

const OFFICIAL_DEVELOPER_META_DATA =
  "com.laisystems.dietsteward.OFFICIAL_DEVELOPER";
const GRADLE_BLOCK_START =
  "// <diet-steward-managed-android-configuration>";
const GRADLE_BLOCK_END =
  "// </diet-steward-managed-android-configuration>";
const RELEASE_SIGNING_PLACEHOLDER =
  "            // Release signing is assigned by the Diet Steward managed block below.";
const GRADLE_9_3_1_DISTRIBUTION_SHA256 =
  "b266d5c9b8ca6f4b3e8733a59783df9e430ddb034a5bb4a5ef7f4f0b4e3aff06";

const GRADLE_CONFIGURATION = `${GRADLE_BLOCK_START}
// Native libraries can embed absolute header paths through __FILE__. Map the
// current build user's home directory to a neutral prefix so official APKs do
// not disclose a developer or CI runner path.
def dietStewardBuildHome = System.getProperty('user.home')
android.defaultConfig.externalNativeBuild.cmake {
    cFlags "-ffile-prefix-map=\${dietStewardBuildHome}=."
    cppFlags "-ffile-prefix-map=\${dietStewardBuildHome}=."
}

// The product has no barcode-scanning path. Expo Camera's generated aggregate
// module can still expose its compile-only scanner coordinates transitively, so
// the application runtime must exclude them explicitly.
configurations.configureEach {
    exclude group: 'com.google.android.gms', module: 'play-services-code-scanner'
    exclude group: 'com.google.mlkit', module: 'barcode-scanning'
    exclude group: 'androidx.camera', module: 'camera-mlkit-vision'
}

def dietStewardForbiddenRuntimeModules = [
    'com.google.android.gms:play-services-code-scanner',
    'com.google.mlkit:barcode-scanning',
    'androidx.camera:camera-mlkit-vision',
] as Set
def dietStewardVerifyNoBarcodeRuntime = tasks.register('verifyNoBarcodeRuntimeDependencies') {
    doLast {
        def present = configurations.releaseRuntimeClasspath
            .incoming
            .resolutionResult
            .allComponents
            .findAll { component ->
                component.id instanceof org.gradle.api.artifacts.component.ModuleComponentIdentifier
            }
            .collect { component -> "\${component.id.group}:\${component.id.module}" }
            .findAll { coordinate -> dietStewardForbiddenRuntimeModules.contains(coordinate) }
            .toSet()
        if (!present.isEmpty()) {
            throw new GradleException(
                'Unused barcode-scanner dependencies entered the release runtime: ' +
                present.sort().join(', ')
            )
        }
    }
}

def dietReleaseStoreFile = System.getenv('DIET_RELEASE_STORE_FILE')
def dietReleaseStorePassword = System.getenv('DIET_RELEASE_STORE_PASSWORD')
def dietReleaseKeyAlias = System.getenv('DIET_RELEASE_KEY_ALIAS')
def dietReleaseKeyPassword = System.getenv('DIET_RELEASE_KEY_PASSWORD')
def dietHasEnterpriseSigning = [
    dietReleaseStoreFile,
    dietReleaseStorePassword,
    dietReleaseKeyAlias,
    dietReleaseKeyPassword,
].every { value -> value != null && value.toString().trim() }

if (dietHasEnterpriseSigning) {
    android.signingConfigs.create('dietEnterpriseRelease') {
        storeFile file(dietReleaseStoreFile)
        storePassword dietReleaseStorePassword
        keyAlias dietReleaseKeyAlias
        keyPassword dietReleaseKeyPassword
    }
    android.buildTypes.getByName('release').signingConfig =
        android.signingConfigs.getByName('dietEnterpriseRelease')
} else {
    // Never inherit the Expo template's debug key for a release artifact.
    android.buildTypes.getByName('release').signingConfig = null
}

def dietStewardProjectRoot = rootDir.getAbsoluteFile().getParentFile().getAbsolutePath()
def dietStewardVerifyOfficialAttribution = tasks.register('verifyOfficialAttribution', Exec) {
    workingDir dietStewardProjectRoot
    commandLine 'node', '--import', 'tsx', 'scripts/verify-official-attribution.ts'
}
def dietStewardVerifyBilingualUi = tasks.register('verifyBilingualUi', Exec) {
    workingDir dietStewardProjectRoot
    commandLine 'node', '--import', 'tsx', 'scripts/verify-bilingual-ui.ts'
}

tasks.named('preBuild').configure {
    dependsOn dietStewardVerifyOfficialAttribution,
        dietStewardVerifyBilingualUi,
        dietStewardVerifyNoBarcodeRuntime
}

gradle.taskGraph.whenReady { graph ->
    def requestedRelease = graph.allTasks.any { task ->
        task.project == project && task.name.toLowerCase().contains('release')
    }
    if (requestedRelease && !dietHasEnterpriseSigning) {
        throw new GradleException(
            'Enterprise release signing is required. Supply DIET_RELEASE_STORE_FILE, ' +
            'DIET_RELEASE_STORE_PASSWORD, DIET_RELEASE_KEY_ALIAS and DIET_RELEASE_KEY_PASSWORD. ' +
            'Release builds never fall back to the debug signing key.'
        )
    }
}
${GRADLE_BLOCK_END}`;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function withManagedAppBuildGradle(contents) {
  const managedBlock = new RegExp(
    `\\n?${escapeRegExp(GRADLE_BLOCK_START)}[\\s\\S]*?${escapeRegExp(GRADLE_BLOCK_END)}\\n?`,
    "g",
  );
  let next = contents.replace(managedBlock, "\n").trimEnd();
  const unsafeReleaseFallback =
    "            signingConfig signingConfigs.debug\n" +
    "            def enableShrinkResources";
  if (next.includes(unsafeReleaseFallback)) {
    next = next.replace(
      unsafeReleaseFallback,
      `${RELEASE_SIGNING_PLACEHOLDER}\n            def enableShrinkResources`,
    );
  } else if (!next.includes(RELEASE_SIGNING_PLACEHOLDER)) {
    throw new Error(
      "Could not locate the Expo release signing fallback in android/app/build.gradle.",
    );
  }
  return `${next}\n\n${GRADLE_CONFIGURATION}\n`;
}

function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function upsertStringResource(contents, name, value) {
  const element = `  <string name="${name}">${escapeXml(value)}</string>`;
  const pattern = new RegExp(
    `<string\\s+name=["']${escapeRegExp(name)}["'][^>]*>[\\s\\S]*?<\\/string>`,
  );
  if (pattern.test(contents)) return contents.replace(pattern, element.trim());
  if (!contents.includes("</resources>")) {
    throw new Error(`Invalid Android string resource while adding ${name}.`);
  }
  return contents.replace("</resources>", `${element}\n</resources>`);
}

async function upsertStringsFile(filePath, values) {
  await mkdir(dirname(filePath), { recursive: true });
  let contents;
  try {
    contents = await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    contents = "<resources>\n</resources>\n";
  }
  for (const [name, value] of Object.entries(values)) {
    contents = upsertStringResource(contents, name, value);
  }
  await writeFile(filePath, contents.endsWith("\n") ? contents : `${contents}\n`, "utf8");
}

async function pinGradleDistributionChecksum(platformProjectRoot) {
  const wrapperPropertiesPath = join(
    platformProjectRoot,
    "gradle",
    "wrapper",
    "gradle-wrapper.properties",
  );
  let contents = await readFile(wrapperPropertiesPath, "utf8");
  if (!contents.includes("gradle-9.3.1-bin.zip")) {
    throw new Error(
      "Update the verified Gradle distribution checksum before changing Gradle versions.",
    );
  }
  const checksumLine =
    `distributionSha256Sum=${GRADLE_9_3_1_DISTRIBUTION_SHA256}`;
  if (/^distributionSha256Sum=.*$/m.test(contents)) {
    contents = contents.replace(/^distributionSha256Sum=.*$/m, checksumLine);
  } else {
    contents = contents.replace(
      /^(distributionUrl=.*)$/m,
      `$1\n${checksumLine}`,
    );
  }
  await writeFile(
    wrapperPropertiesPath,
    contents.endsWith("\n") ? contents : `${contents}\n`,
    "utf8",
  );
}

module.exports = function withPrivateAndroidManifest(config) {
  config = withAndroidManifest(config, (modConfig) => {
    const manifest = modConfig.modResults.manifest;
    const features = manifest["uses-feature"] ?? [];
    manifest["uses-feature"] = features.filter(
      (entry) => entry?.$?.["android:name"] !== "android.hardware.camera",
    );
    manifest["uses-feature"].push({
      $: {
        "android:name": "android.hardware.camera",
        "android:required": "false",
      },
    });
    const application = modConfig.modResults.manifest.application?.[0];
    if (application?.$) {
      application.$["android:allowBackup"] = "false";
      const metaData = application["meta-data"] ?? [];
      application["meta-data"] = metaData.filter(
        (entry) => entry?.$?.["android:name"] !== OFFICIAL_DEVELOPER_META_DATA,
      );
      application["meta-data"].push({
        $: {
          "android:name": OFFICIAL_DEVELOPER_META_DATA,
          "android:value": "@string/official_developer",
        },
      });
    }
    return modConfig;
  });

  config = withAppBuildGradle(config, (modConfig) => {
    modConfig.modResults.contents = withManagedAppBuildGradle(
      modConfig.modResults.contents,
    );
    return modConfig;
  });

  config = withDangerousMod(config, ["android", async (modConfig) => {
    const resourceRoot = join(
      modConfig.modRequest.platformProjectRoot,
      "app",
      "src",
      "main",
      "res",
    );
    await upsertStringsFile(join(resourceRoot, "values", "strings.xml"), {
      official_developer: "Developed by LAI ZEYU 来泽宇",
    });
    await upsertStringsFile(join(resourceRoot, "values-en", "strings.xml"), {
      app_name: "Diet Steward",
      official_developer: "Developed by LAI ZEYU 来泽宇",
    });
    await upsertStringsFile(join(resourceRoot, "values-zh", "strings.xml"), {
      app_name: "饮食管家",
      official_developer: "由 LAI ZEYU 来泽宇 开发",
    });
    await pinGradleDistributionChecksum(
      modConfig.modRequest.platformProjectRoot,
    );
    return modConfig;
  }]);

  return config;
};
