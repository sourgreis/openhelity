// Localisation check.
//
// English is built into web/js/i18n.js and the code tables of web/js/keys.js;
// every other language is a flat JSON file in web/locales/. Strings are
// substituted by key, so a typo or an edit that silently failed leaves the key
// itself or the old text on screen. This script therefore:
//
//   * matches the keys the code and the markup ask for against the dictionary;
//   * rejects keys a translation invents and reports the ones it still lacks;
//   * checks that {name} placeholders survive translation;
//   * keeps web/locales/index.json in step with the files actually present,
//     since that catalogue is what puts a language into the interface.
//
//   node tools/check-i18n.mjs                 check
//   node tools/check-i18n.mjs --fix           rewrite index.json from the files
//   node tools/check-i18n.mjs --new de Deutsch    scaffold a new translation

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { BASE } from "../web/js/i18n.js";
import { NAME_TABLES } from "../web/js/keys.js";

const web = new URL("../web/", import.meta.url).pathname;
const locales = join(web, "locales");
const NAME_KEY = "language.name";
const CODE = /^[a-z]{2}(-[A-Za-z0-9]+)?$/;

// Everything a translation may fill in: the dictionary plus the name tables,
// whose keys are built at runtime as `<namespace>.<code>`.
const english = new Map(Object.entries(BASE));
for (const [namespace, table] of Object.entries(NAME_TABLES)) {
  for (const [code, name] of Object.entries(table)) english.set(`${namespace}.${code}`, name);
}

const holders = (text) => new Set([...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]));
const relative = (path) => path.split("/web/")[1] ?? path;

const problems = [];
const notes = [];

// --- The dictionary against the code ---------------------------------------
const sources = [
  ...readdirSync(join(web, "js")).map((name) => join(web, "js", name)),
  join(web, "index.html"),
].filter((path) => path.endsWith(".js") || path.endsWith(".html"));

// A key may reach t() through a ternary or a variable rather than as a
// literal, so any string matching a dictionary key counts as used.
const used = new Map();
for (const path of sources) {
  if (path.endsWith("i18n.js")) continue;
  const text = readFileSync(path, "utf8");
  for (const match of text.matchAll(/["']([\w.]+)["']/g)) {
    if (match[1] in BASE) used.set(match[1], path);
  }
  for (const match of text.matchAll(/data-i18n="([\w.]+)"/g)) {
    if (!(match[1] in BASE)) problems.push(`missing from the dictionary: ${match[1]} (${relative(path)})`);
    used.set(match[1], path);
  }
}
for (const key of Object.keys(BASE)) {
  if (!used.has(key)) problems.push(`declared but unused: ${key}`);
}

// --- The translations -------------------------------------------------------
const files = readdirSync(locales)
  .filter((name) => name.endsWith(".json") && name !== "index.json")
  .sort();

const catalogue = [];
for (const file of files) {
  const code = file.slice(0, -".json".length);
  if (code === "en") {
    problems.push("en.json: English is built into web/js/i18n.js, so this file would never be read");
    continue;
  }
  if (!CODE.test(code)) {
    problems.push(`${file}: the name must be a language code, such as de.json or pt-BR.json`);
    continue;
  }

  let table;
  try {
    table = JSON.parse(readFileSync(join(locales, file), "utf8"));
  } catch (error) {
    problems.push(`${file}: not valid JSON (${error.message})`);
    continue;
  }

  const name = table[NAME_KEY];
  if (!name) problems.push(`${file}: no "${NAME_KEY}" — the language would have no name in the menu`);
  catalogue.push({ code, name: name || code });

  const unknown = Object.keys(table).filter((key) => key !== NAME_KEY && !english.has(key));
  for (const key of unknown) problems.push(`${file}: unknown key ${key}`);

  const missing = [...english.keys()].filter((key) => !(key in table));
  if (missing.length) {
    notes.push(`${file}: ${missing.length} untranslated (falls back to English), first: ${missing.slice(0, 3).join(", ")}`);
  }

  for (const [key, source] of english) {
    const translated = table[key];
    if (typeof translated !== "string") continue;
    const inEnglish = holders(source);
    const inTranslation = holders(translated);
    const differ = [...inEnglish].filter((holder) => !inTranslation.has(holder))
      .concat([...inTranslation].filter((holder) => !inEnglish.has(holder)));
    if (differ.length) problems.push(`${file}: placeholders differ in ${key}: ${differ.join(", ")}`);
  }
}

// --- Scaffolding a new translation ------------------------------------------
// The file starts out as a copy of the English strings, so a translator edits
// values and never has to hunt for keys. Untranslated ones fall back anyway.
const newAt = process.argv.indexOf("--new");
if (newAt >= 0) {
  const code = process.argv[newAt + 1];
  if (!code || !CODE.test(code) || code === "en") {
    console.error("Usage: node tools/check-i18n.mjs --new <language code> [name in that language]");
    process.exit(2);
  }
  const name = process.argv[newAt + 2] ?? code;
  writeFileSync(join(locales, `${code}.json`),
    `${JSON.stringify({ [NAME_KEY]: name, ...Object.fromEntries(english) }, null, 2)}\n`);
  catalogue.push({ code, name });
  catalogue.sort((a, b) => a.code.localeCompare(b.code));
  notes.push(`web/locales/${code}.json created with ${english.size} English strings to translate`);
}

// --- The catalogue ----------------------------------------------------------
// This is what the interface reads to know which languages exist, so it has to
// list exactly the files that are there.
const indexPath = join(locales, "index.json");
const wanted = catalogue.map(({ code, name }) => ({ code, name }));

if (process.argv.includes("--fix") || newAt >= 0) {
  writeFileSync(indexPath, `${JSON.stringify(wanted, null, 2)}\n`);
  notes.push(`index.json rewritten: ${wanted.map((entry) => entry.code).join(", ") || "no translations"}`);
} else {
  let index = null;
  try {
    index = JSON.parse(readFileSync(indexPath, "utf8"));
  } catch (error) {
    problems.push(`index.json: cannot be read (${error.message})`);
  }
  if (index && JSON.stringify(index) !== JSON.stringify(wanted)) {
    problems.push("index.json does not match the files in web/locales/ — run: node tools/check-i18n.mjs --fix");
  }
}

for (const note of notes) console.log(`  ${note}`);
if (problems.length) {
  console.error(`Problems found: ${problems.length}`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log(`Dictionary is fine: ${Object.keys(BASE).length} keys in use, `
  + `${english.size} translatable strings, `
  + `${catalogue.length} translation${catalogue.length === 1 ? "" : "s"}.`);
