#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const mobileRoot = join(repositoryRoot, "mobile-app");
const releaseRoot = join(repositoryRoot, "release");
const version = "1.2.3";
const requestedEvidenceTime = process.env.RELEASE_EVIDENCE_UTC ?? new Date().toISOString();
const parsedEvidenceTime = new Date(requestedEvidenceTime);
if (Number.isNaN(parsedEvidenceTime.getTime())) {
  throw new Error(
    `RELEASE_EVIDENCE_UTC must be a valid ISO-8601 timestamp; received ${requestedEvidenceTime}`,
  );
}
const evidenceTime = parsedEvidenceTime.toISOString();
const reportPath =
  process.argv[2] ??
  join(releaseRoot, `calorie-steward-v${version}-android-runtime-dependencies.txt`);
const outputPath = join(
  releaseRoot,
  `calorie-steward-v${version}-android-third-party-licenses.txt`,
);

if (!existsSync(reportPath)) {
  throw new Error(`Missing Android dependency report: ${reportPath}`);
}

const report = readFileSync(reportPath, "utf8");
const coordinatePattern = /([A-Za-z0-9_.-]+):([A-Za-z0-9_.-]+)(?::([^\s()]+))?(?:\s+->\s+([^\s()]+))?/g;
const coordinates = new Map();

for (const line of report.split("\n")) {
  if (!/^[|+\\ ]/.test(line)) continue;
  for (const match of line.matchAll(coordinatePattern)) {
    const [, group, artifact, requestedVersion, selectedVersion] = match;
    let resolvedGroup = group;
    let resolvedArtifact = artifact;
    let resolvedVersion = selectedVersion ?? requestedVersion;

    if (selectedVersion?.includes(":")) {
      const replacement = selectedVersion.split(":");
      if (replacement.length !== 3) continue;
      [resolvedGroup, resolvedArtifact, resolvedVersion] = replacement;
    }
    if (
      !resolvedVersion ||
      resolvedVersion.startsWith("project") ||
      /[{}\[\],]/.test(resolvedVersion)
    ) {
      continue;
    }
    const coordinate = `${resolvedGroup}:${resolvedArtifact}:${resolvedVersion}`;
    coordinates.set(coordinate, {
      group: resolvedGroup,
      artifact: resolvedArtifact,
      version: resolvedVersion,
    });
  }
}

const gradleModules = join(homedir(), ".gradle", "caches", "modules-2", "files-2.1");
const absolutePathPattern = /(?:\/Users\/|[A-Za-z]:\\Users\\)/;
const licenseEntryPattern = /(?:^|\/)(?:licen[cs]e|notice|copying)(?:[._-].*)?$/i;
const textByDigest = new Map();
const dependencyRows = [];

function loadLocalExpoModuleCoverage() {
  const autolinkingBinary = join(
    mobileRoot,
    "node_modules",
    ".bin",
    "expo-modules-autolinking",
  );
  const companionSbomPath = join(
    releaseRoot,
    `calorie-steward-v${version}-npm-sbom.spdx.json`,
  );
  if (!existsSync(autolinkingBinary) || !existsSync(companionSbomPath)) {
    return new Map();
  }

  let resolvedModules;
  let companionSbomPackages;
  try {
    resolvedModules = JSON.parse(
      execFileSync(
        autolinkingBinary,
        ["resolve", "--platform", "android", "--json"],
        {
          cwd: mobileRoot,
          encoding: "utf8",
          maxBuffer: 16 * 1024 * 1024,
        },
      ),
    ).modules;
    companionSbomPackages = new Set(
      (JSON.parse(readFileSync(companionSbomPath, "utf8")).packages ?? []).map(
        (packageEntry) => `${packageEntry.name}@${packageEntry.versionInfo}`,
      ),
    );
  } catch {
    return new Map();
  }

  const coverage = new Map();
  for (const moduleEntry of resolvedModules ?? []) {
    const packageName = moduleEntry.packageName;
    const packageVersion = moduleEntry.packageVersion;
    const npmIdentifier = `${packageName}@${packageVersion}`;
    if (!companionSbomPackages.has(npmIdentifier)) continue;

    for (const project of moduleEntry.projects ?? []) {
      const publication = project.publication;
      if (!publication?.groupId || !publication?.artifactId || !publication?.version) {
        continue;
      }
      const coordinate =
        `${publication.groupId}:${publication.artifactId}:${publication.version}`;
      coverage.set(coordinate, npmIdentifier);
    }
  }
  return coverage;
}

const localExpoModuleCoverage = loadLocalExpoModuleCoverage();

function filesWithSuffix(directory, suffixes) {
  if (!existsSync(directory)) return [];
  const found = [];
  for (const hashDirectory of readdirSync(directory).sort()) {
    const candidateDirectory = join(directory, hashDirectory);
    try {
      if (!statSync(candidateDirectory).isDirectory()) continue;
    } catch {
      continue;
    }
    for (const filename of readdirSync(candidateDirectory).sort()) {
      if (suffixes.some((suffix) => filename.endsWith(suffix))) {
        found.push(join(candidateDirectory, filename));
      }
    }
  }
  return found;
}

function decodeXml(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .trim();
}

function collectPomLicenses(pomText) {
  const licenses = [];
  const licensesBlock = pomText.match(/<licenses>([\s\S]*?)<\/licenses>/i)?.[1] ?? "";
  for (const match of licensesBlock.matchAll(/<license>([\s\S]*?)<\/license>/gi)) {
    const block = match[1];
    const name = decodeXml(block.match(/<name>([\s\S]*?)<\/name>/i)?.[1] ?? "NOASSERTION");
    const url = decodeXml(block.match(/<url>([\s\S]*?)<\/url>/i)?.[1] ?? "");
    licenses.push(url ? `${name} (${url})` : name);
  }
  return [...new Set(licenses)];
}

function collectPomLicensesWithParents(pomPath, visited = new Set()) {
  if (visited.has(pomPath)) return [];
  visited.add(pomPath);
  let pomText;
  try {
    pomText = readFileSync(pomPath, "utf8");
  } catch {
    return [];
  }

  const licenses = new Set(collectPomLicenses(pomText));
  const parentBlock = pomText.match(/<parent>([\s\S]*?)<\/parent>/i)?.[1];
  if (parentBlock) {
    const parentGroup = decodeXml(parentBlock.match(/<groupId>([\s\S]*?)<\/groupId>/i)?.[1] ?? "");
    const parentArtifact = decodeXml(parentBlock.match(/<artifactId>([\s\S]*?)<\/artifactId>/i)?.[1] ?? "");
    const parentVersion = decodeXml(parentBlock.match(/<version>([\s\S]*?)<\/version>/i)?.[1] ?? "");
    if (parentGroup && parentArtifact && parentVersion && !parentVersion.includes("${")) {
      const parentDirectory = join(gradleModules, parentGroup, parentArtifact, parentVersion);
      const parentPom = filesWithSuffix(parentDirectory, [".pom"])[0];
      if (parentPom) {
        for (const license of collectPomLicensesWithParents(parentPom, visited)) {
          licenses.add(license);
        }
      }
    }
  }
  return [...licenses];
}

function addText(content, coordinate, source) {
  const normalized = content.replaceAll("\r\n", "\n").trim();
  if (!normalized || normalized.length > 2 * 1024 * 1024) return false;
  const digest = createHash("sha256").update(normalized).digest("hex");
  const entry = textByDigest.get(digest) ?? { content: normalized, coordinates: [], sources: [] };
  entry.coordinates.push(coordinate);
  entry.sources.push(source);
  textByDigest.set(digest, entry);
  return true;
}

for (const coordinate of [...coordinates.keys()].sort()) {
  const { group, artifact, version: resolvedVersion } = coordinates.get(coordinate);
  const cacheDirectory = join(gradleModules, group, artifact, resolvedVersion);
  const poms = filesWithSuffix(cacheDirectory, [".pom"]);
  const archives = filesWithSuffix(cacheDirectory, [".jar", ".aar"]);
  const pomLicenses = new Set();
  const embeddedSources = [];
  const companionNpmPackage = localExpoModuleCoverage.get(coordinate) ?? null;

  for (const pom of poms) {
    for (const license of collectPomLicensesWithParents(pom)) {
      pomLicenses.add(license);
    }
  }

  for (const archive of archives) {
    let entries = [];
    try {
      entries = execFileSync("unzip", ["-Z1", archive], {
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
      })
        .split("\n")
        .filter((entry) => licenseEntryPattern.test(entry));
    } catch {
      continue;
    }
    for (const entry of entries) {
      try {
        const content = execFileSync("unzip", ["-p", archive, entry], {
          encoding: "utf8",
          maxBuffer: 4 * 1024 * 1024,
        });
        if (addText(content, coordinate, `${basename(archive)}!/${entry}`)) {
          embeddedSources.push(`${basename(archive)}!/${entry}`);
        }
      } catch {
        // Binary or malformed entries remain represented by POM metadata.
      }
    }
  }

  dependencyRows.push({
    coordinate,
    pomLicenses: [...pomLicenses].sort(),
    embeddedSources: [...new Set(embeddedSources)].sort(),
    cachePresent: existsSync(cacheDirectory),
    companionNpmPackage,
  });
}

const missingMetadata = dependencyRows.filter(
  (row) =>
    !row.companionNpmPackage &&
    row.pomLicenses.length === 0 &&
    row.embeddedSources.length === 0,
);
const output = [
  `Calorie Steward v${version} Android third-party license metadata and texts`,
  `Generated: ${evidenceTime}`,
  "Developer: LAI ZEYU (\u6765\u6cfd\u5b87)",
  "Configuration: :app releaseRuntimeClasspath",
  "",
  "Scope",
  "-----",
  "Coordinates are parsed from the reviewed Gradle release runtime dependency",
  "inventory. License names/URLs come from cached Maven POM metadata. License,",
  "NOTICE and COPYING texts are extracted from resolved JAR/AAR archives when",
  "present. A Maven entry with NOASSERTION and no verified companion npm-package",
  "coverage requires upstream/manual review; this generator does not silently",
  "assign it a license.",
  "",
  "This document is informational and does not replace upstream license terms.",
  "",
  `Dependency inventory (${dependencyRows.length})`,
  "============================",
  "",
  ...dependencyRows.map((row) => {
    const licenses = row.pomLicenses.length > 0 ? row.pomLicenses.join("; ") : "NOASSERTION";
    const sources = row.embeddedSources.length > 0 ? row.embeddedSources.join(", ") : "none";
    const coverage = row.companionNpmPackage
      ? `local Expo project module; covered by companion npm package ${row.companionNpmPackage}`
      : "Android Maven metadata/archive";
    return `${row.coordinate} | pom_licenses=${licenses} | embedded_texts=${sources} | coverage=${coverage} | cache=${row.cachePresent ? "present" : "missing"}`;
  }),
  "",
  `Dependencies requiring upstream/manual license confirmation (${missingMetadata.length})`,
  "===================================================================",
  "",
  ...missingMetadata.map((row) => row.coordinate),
  "",
  `Unique embedded license/notice texts (${textByDigest.size})`,
  "=================================================",
  "",
];

for (const [digest, entry] of [...textByDigest.entries()].sort(([left], [right]) => left.localeCompare(right))) {
  output.push(`SHA-256: ${digest}`);
  output.push(`Dependencies: ${[...new Set(entry.coordinates)].sort().join(", ")}`);
  output.push(`Sources: ${[...new Set(entry.sources)].sort().join(", ")}`);
  output.push("-");
  output.push(entry.content);
  output.push("", "=".repeat(78), "");
}

const finalText = `${output.join("\n")}\n`;
if (absolutePathPattern.test(finalText)) {
  throw new Error("Refusing to publish an Android license bundle containing a local absolute path.");
}
writeFileSync(outputPath, finalText);

console.log(
  `Generated ${basename(outputPath)} with ${dependencyRows.length} dependencies, ${textByDigest.size} unique embedded texts and ${missingMetadata.length} unresolved entries.`,
);
