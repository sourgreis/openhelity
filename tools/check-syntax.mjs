// Parse every script of the page as an ES module, the way the browser does.
// `node --check` reads them as plain scripts and misses errors such as a
// name declared twice in one scope, which stop the whole page from loading.
//
//   node --experimental-vm-modules tools/check-syntax.mjs
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "web");
const files = ["sw.js", ...readdirSync(join(root, "js")).map((name) => join("js", name))];
let failed = 0;
for (const file of files) {
  const source = readFileSync(join(root, file), "utf8");
  try {
    if (file === "sw.js") new vm.Script(source, { filename: file });
    else new vm.SourceTextModule(source, { identifier: file });
  } catch (error) {
    failed += 1;
    console.error(`${file}: ${error.message}`);
  }
}
if (failed) process.exit(1);
console.log(`Syntax is fine: ${files.length} files.`);
