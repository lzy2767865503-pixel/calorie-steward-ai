#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const androidRoot = join(repositoryRoot, "mobile-app", "android");
const releaseRoot = join(repositoryRoot, "release");
const version = "1.2.1";
const requestedEvidenceTime = process.env.RELEASE_EVIDENCE_UTC ?? new Date().toISOString();
const parsedEvidenceTime = new Date(requestedEvidenceTime);
if (Number.isNaN(parsedEvidenceTime.getTime())) {
  throw new Error(
    `RELEASE_EVIDENCE_UTC must be a valid ISO-8601 timestamp; received ${requestedEvidenceTime}`,
  );
}
const evidenceTime = parsedEvidenceTime.toISOString();

const gradleOutput = execFileSync(
  join(androidRoot, "gradlew"),
  [
    ":app:dependencies",
    "--configuration",
    "releaseRuntimeClasspath",
    "--no-daemon",
    "--console=plain",
  ],
  {
    cwd: androidRoot,
    encoding: "utf8",
    env: process.env,
    maxBuffer: 64 * 1024 * 1024,
  },
);

const normalizedOutput = gradleOutput.replaceAll("\r\n", "\n");
const start = normalizedOutput.indexOf(
  "releaseRuntimeClasspath - Runtime classpath",
);
if (start < 0) {
  throw new Error("Gradle output did not contain releaseRuntimeClasspath.");
}

let tree = normalizedOutput.slice(start);
const endMarker =
  "(*) - Indicates repeated occurrences of a transitive dependency subtree.";
const endMarkerStart = tree.indexOf(endMarker);
if (endMarkerStart < 0) {
  throw new Error("Gradle dependency legend was incomplete.");
}
const endLine = tree.indexOf("\n", endMarkerStart);
tree = tree.slice(0, endLine < 0 ? tree.length : endLine).trim();

const forbiddenCoordinates = [
  "com.google.android.gms:play-services-code-scanner",
  "com.google.mlkit:barcode-scanning",
  "androidx.camera:camera-mlkit-vision",
];
const forbiddenPresent = forbiddenCoordinates.filter((coordinate) =>
  tree.includes(coordinate),
);
if (forbiddenPresent.length > 0) {
  throw new Error(
    `Unused barcode-scanner runtime dependencies remain: ${forbiddenPresent.join(", ")}`,
  );
}

const absolutePathPattern = /(?:\/Users\/|[A-Za-z]:\\Users\\)/;
if (absolutePathPattern.test(tree)) {
  throw new Error("Refusing to publish an inventory containing a local absolute path.");
}

const report = [
  `Calorie Steward v${version} Android release runtime dependency inventory`,
  `Generated: ${evidenceTime}`,
  "Developer: LAI ZEYU (来泽宇)",
  "Configuration: :app releaseRuntimeClasspath",
  "",
  tree,
  "",
].join("\n");

mkdirSync(releaseRoot, { recursive: true });
const outputPath = join(
  releaseRoot,
  `calorie-steward-v${version}-android-runtime-dependencies.txt`,
);
writeFileSync(outputPath, report);
console.log(
  `Generated ${outputPath} (${tree.split("\n").length} dependency-tree lines; no barcode/ML Kit runtime modules).`,
);
