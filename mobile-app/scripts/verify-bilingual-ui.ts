import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import ts from "typescript";

const projectRoot = resolve(import.meta.dirname, "..");
const uiFiles = [
  "App.tsx",
  "src/screens/ApiSetupScreen.tsx",
  "src/screens/HomeScreen.tsx",
  "src/screens/CameraScreen.tsx",
  "src/screens/ReviewScreen.tsx",
  "src/screens/AnalysisScreen.tsx",
  "src/screens/ReportsScreen.tsx",
  "src/screens/SettingsScreen.tsx",
  "src/ui/components.tsx",
];
const translationCalls = new Set(["t", "localizedCopy"]);
const han = /[\u3400-\u9fff]/u;
const failures: string[] = [];
const read = (relativePath: string) =>
  readFileSync(resolve(projectRoot, relativePath), "utf8");

function isInsideTranslationCall(node: ts.Node): boolean {
  let current: ts.Node | undefined = node;
  while (current) {
    if (
      ts.isCallExpression(current) &&
      ts.isIdentifier(current.expression) &&
      translationCalls.has(current.expression.text)
    ) {
      return true;
    }
    if (ts.isStatement(current) || ts.isSourceFile(current)) return false;
    current = current.parent;
  }
  return false;
}

for (const relativePath of uiFiles) {
  const sourceText = read(relativePath);
  const source = ts.createSourceFile(
    relativePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const visit = (node: ts.Node) => {
    const text =
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isJsxText(node)
        ? node.getText(source)
        : null;
    if (text && han.test(text) && !isInsideTranslationCall(node)) {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
      failures.push(`${relativePath}:${line + 1}: ${JSON.stringify(text.slice(0, 100))}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

const appConfig = JSON.parse(read("app.json")) as {
  expo?: {
    locales?: Record<string, string>;
    plugins?: unknown[];
  };
};
assert.equal(appConfig.expo?.locales?.en, "./locales/en.json");
assert.equal(appConfig.expo?.locales?.zh, "./locales/zh.json");
assert.doesNotMatch(
  JSON.stringify(appConfig.expo?.plugins ?? []),
  han,
  "The native fallback permission copy must be English for unsupported locales",
);

const englishNativeCopy = read("locales/en.json");
const chineseNativeCopy = read("locales/zh.json");
assert.doesNotMatch(englishNativeCopy, han, "English native permission copy must not contain Chinese");
assert.match(chineseNativeCopy, han, "Chinese native permission copy is missing");
assert.match(read("android/app/src/main/res/values-en/strings.xml"), /Diet Steward/);
assert.match(read("android/app/src/main/res/values-zh/strings.xml"), /饮食管家/);
assert.match(read("ios/app/en.lproj/InfoPlist.strings"), /Allow Diet Steward/);
assert.match(read("ios/app/zh-Hans.lproj/InfoPlist.strings"), /允许饮食管家/);

assert.deepEqual(
  failures,
  [],
  `User-visible Chinese copy must be paired with English through t/localizedCopy:\n${failures.join("\n")}`,
);
process.stdout.write("Bilingual UI gate passed: Chinese and English copy are paired\n");
