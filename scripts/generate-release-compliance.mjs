#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const mobileRoot = join(repositoryRoot, "mobile-app");
const releaseRoot = join(repositoryRoot, "release");
const version = "1.2.2";
const requestedEvidenceTime = process.env.RELEASE_EVIDENCE_UTC ?? new Date().toISOString();
const parsedEvidenceTime = new Date(requestedEvidenceTime);
if (Number.isNaN(parsedEvidenceTime.getTime())) {
  throw new Error(
    `RELEASE_EVIDENCE_UTC must be a valid ISO-8601 timestamp; received ${requestedEvidenceTime}`,
  );
}
const evidenceTime = parsedEvidenceTime.toISOString();

const sbomFilename = `calorie-steward-v${version}-npm-sbom.spdx.json`;
const licensesFilename = `calorie-steward-v${version}-third-party-licenses.txt`;

const rawSbom = execFileSync(
  "npm",
  [
    "sbom",
    "--package-lock-only",
    "--omit=dev",
    "--sbom-format=spdx",
    "--sbom-type=application",
  ],
  { cwd: mobileRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
);

const sbom = JSON.parse(rawSbom);
const packages = [...(sbom.packages ?? [])].sort((left, right) =>
  `${left.name}@${left.versionInfo ?? ""}`.localeCompare(
    `${right.name}@${right.versionInfo ?? ""}`,
  ),
);

// npm intentionally generates a random SPDX namespace and current timestamp.
// Normalize both so a fixed lockfile and RELEASE_EVIDENCE_UTC produce stable
// release metadata that can be compared across independent generation runs.
sbom.documentNamespace =
  `https://github.com/lzy2767865503-pixel/calorie-steward-ai/releases/download/` +
  `v${version}/${sbomFilename}`;
sbom.creationInfo = {
  ...(sbom.creationInfo ?? {}),
  created: evidenceTime,
};

const absolutePathPattern = /(?:\/Users\/|[A-Za-z]:\\Users\\)/;
if (absolutePathPattern.test(rawSbom)) {
  throw new Error("Refusing to publish an SBOM containing a local absolute path.");
}

writeFileSync(join(releaseRoot, sbomFilename), `${JSON.stringify(sbom, null, 2)}\n`);

const licenseNames = /^(?:licen[cs]e|copying|notice)(?:[._-].*)?$/i;
const textByDigest = new Map();
const inventory = [];

for (const packageEntry of packages) {
  const identifier = `${packageEntry.name}@${packageEntry.versionInfo ?? "unknown"}`;
  const declared = packageEntry.licenseDeclared ?? "NOASSERTION";
  const concluded = packageEntry.licenseConcluded ?? "NOASSERTION";
  const packagePath = packageEntry.packageFileName
    ? resolve(mobileRoot, packageEntry.packageFileName)
    : null;
  const sourceFiles = [];

  if (
    packagePath &&
    packagePath.startsWith(`${mobileRoot}/`) &&
    existsSync(packagePath)
  ) {
    for (const filename of readdirSync(packagePath).filter((name) => licenseNames.test(name)).sort()) {
      const fullPath = join(packagePath, filename);
      try {
        const content = readFileSync(fullPath, "utf8").trim();
        if (!content) continue;
        const digest = createHash("sha256").update(content).digest("hex");
        const existing = textByDigest.get(digest) ?? { content, packages: [], filenames: [] };
        existing.packages.push(identifier);
        existing.filenames.push(`${packageEntry.packageFileName}/${filename}`);
        textByDigest.set(digest, existing);
        sourceFiles.push(`${packageEntry.packageFileName}/${filename}`);
      } catch {
        // Binary/unreadable notice files remain represented by declared SPDX metadata.
      }
    }
  }

  inventory.push({
    identifier,
    declared,
    concluded,
    source: sourceFiles.length > 0 ? sourceFiles.join(", ") : "SPDX metadata only",
  });
}

const lines = [
  `Calorie Steward v${version} third-party license bundle`,
  `Generated: ${evidenceTime}`,
  "Developer: LAI ZEYU (\u6765\u6cfd\u5b87)",
  "",
  "Scope",
  "-----",
  "This release-specific bundle inventories production npm dependencies from",
  "mobile-app/package-lock.json. License texts are copied from installed package",
  "roots when available. Platform-optional packages absent from this macOS install",
  "remain listed with their SPDX-declared license and download metadata in the",
  "companion SPDX 2.3 SBOM. Android Maven dependencies are listed separately in",
  "the release runtime-dependency report; license/notice files retained by Android",
  "packaging also remain embedded in the APK.",
  "",
  "This document is informational and does not replace upstream license terms.",
  "",
  `Package inventory (${inventory.length})`,
  "=========================",
  "",
  ...inventory.map(
    (entry) =>
      `${entry.identifier} | declared=${entry.declared} | concluded=${entry.concluded} | source=${entry.source}`,
  ),
  "",
  `Unique installed license/notice texts (${textByDigest.size})`,
  "=====================================================",
  "",
];

for (const [digest, entry] of [...textByDigest.entries()].sort(([left], [right]) => left.localeCompare(right))) {
  lines.push(`SHA-256: ${digest}`);
  lines.push(`Packages: ${[...new Set(entry.packages)].sort().join(", ")}`);
  lines.push(`Files: ${[...new Set(entry.filenames)].sort().join(", ")}`);
  lines.push("-");
  lines.push(entry.content);
  lines.push("", "=".repeat(78), "");
}

const licenseOutput = `${lines.join("\n")}\n`;
if (absolutePathPattern.test(licenseOutput)) {
  throw new Error("Refusing to publish a license bundle containing a local absolute path.");
}
writeFileSync(join(releaseRoot, licensesFilename), licenseOutput);

console.log(
  `Generated ${sbomFilename} (${packages.length} packages) and ${licensesFilename} (${textByDigest.size} unique texts).`,
);
