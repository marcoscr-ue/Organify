import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const [keystorePath] = process.argv.slice(2);
const { KEY_ALIAS, KEYSTORE_PASSWORD, KEY_PASSWORD } = process.env;
if (!keystorePath || !KEY_ALIAS || !KEYSTORE_PASSWORD || !KEY_PASSWORD) {
  throw new Error("Falta la configuración de firma Android.");
}

const packageJson = JSON.parse(
  await readFile(new URL("./package.json", import.meta.url), "utf8"),
);
const [major, minor, patch] = packageJson.version.split(".").map(Number);
if (
  [major, minor, patch].some(
    (part) => !Number.isSafeInteger(part) || part < 0,
  ) ||
  minor >= 1_000 ||
  patch >= 1_000
) {
  throw new Error("La versión Android debe usar major.minor.patch.");
}
const versionCode = major * 1_000_000 + minor * 1_000 + patch;
if (versionCode > 2_100_000_000) {
  throw new Error("La versión excede el máximo permitido para versionCode.");
}

const gradlePath = new URL("./android/app/build.gradle", import.meta.url);
let gradle = await readFile(gradlePath, "utf8");
if (!/defaultConfig\s*\{/.test(gradle)) {
  throw new Error("No se encontró defaultConfig en android/app/build.gradle.");
}
const versionName = `"${packageJson.version}"`;
if (/^\s*versionCode\s+\d+\s*$/m.test(gradle)) {
  gradle = gradle.replace(
    /^\s*versionCode\s+\d+\s*$/m,
    `        versionCode ${versionCode}`,
  );
} else {
  gradle = gradle.replace(
    /defaultConfig\s*\{\s*\n/,
    (block) => `${block}        versionCode ${versionCode}\n`,
  );
}
if (/^\s*versionName\s+['"].*['"]\s*$/m.test(gradle)) {
  gradle = gradle.replace(
    /^\s*versionName\s+['"].*['"]\s*$/m,
    `        versionName ${versionName}`,
  );
} else {
  gradle = gradle.replace(/defaultConfig\s*\{[^}]*\}/s, (block) =>
    block.replace(/\n\s*\}$/, `\n        versionName ${versionName}\n    }`),
  );
}

const buildTypesIndex = gradle.search(/buildTypes\s*\{/);
if (buildTypesIndex < 0) {
  throw new Error("No se encontró buildTypes en android/app/build.gradle.");
}
const groovyString = (value) =>
  `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
gradle =
  gradle.slice(0, buildTypesIndex) +
  `signingConfigs {\n        release {\n            storeFile file(${groovyString(resolve(keystorePath).replaceAll("\\\\", "/"))})\n            storePassword ${groovyString(KEYSTORE_PASSWORD)}\n            keyAlias ${groovyString(KEY_ALIAS)}\n            keyPassword ${groovyString(KEY_PASSWORD)}\n        }\n    }\n\n    ` +
  gradle.slice(buildTypesIndex);
const releaseBuildType = /buildTypes\s*\{\s*release\s*\{/;
if (!releaseBuildType.test(gradle)) {
  throw new Error(
    "No se encontró buildTypes.release en android/app/build.gradle.",
  );
}
gradle = gradle.replace(
  releaseBuildType,
  `buildTypes {\n        release {\n            signingConfig signingConfigs.release`,
);
await writeFile(gradlePath, gradle);
