// Write the licence notices of the Rust crates compiled into the WebAssembly
// core. Their MIT and Apache-2.0 licences ask for the notice to travel with
// every copy, and the published page is one. Build-time crates (proc macros,
// build scripts) ship nothing and are left out; crates offered under MIT or
// Apache-2.0 are used under MIT, any other licence is copied in full.
// tools/build.sh runs this after wasm-pack, so the crate sources are there.
//
//   node tools/notices.mjs web/pkg/THIRD-PARTY-NOTICES.txt
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = process.argv[2] ?? join(root, "web", "pkg", "THIRD-PARTY-NOTICES.txt");

const metadata = JSON.parse(execFileSync(
  "cargo",
  ["metadata", "--format-version", "1", "--locked", "--filter-platform", "wasm32-unknown-unknown"],
  { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
));
const packages = new Map(metadata.packages.map((pkg) => [pkg.id, pkg]));
const nodes = new Map(metadata.resolve.nodes.map((node) => [node.id, node]));
const ours = new Set(metadata.workspace_members);
const isMacro = (pkg) => pkg.targets.some((target) => target.kind.includes("proc-macro"));

const shipped = new Set();
const visit = (id) => {
  if (shipped.has(id)) return;
  shipped.add(id);
  for (const dep of nodes.get(id).deps) {
    const normal = dep.dep_kinds.some((kind) => kind.kind === null);
    if (normal && !isMacro(packages.get(dep.pkg))) visit(dep.pkg);
  }
};
visit(metadata.packages.find((pkg) => pkg.name === "openhelity-wasm").id);

function licenceTexts(pkg) {
  const dir = dirname(pkg.manifest_path);
  const files = readdirSync(dir).filter((name) => /^(licen[cs]e|copying|notice)/i.test(name)).sort();
  const mit = files.filter((name) => /mit/i.test(name));
  const dual = /^(MIT OR Apache-2\.0|Apache-2\.0 OR MIT)$/.test(pkg.license ?? "");
  const chosen = dual && mit.length ? mit : files;
  if (!chosen.length) throw new Error(`${pkg.name} ${pkg.version}: no licence file in ${dir}`);
  return chosen.map((name) => readFileSync(join(dir, name), "utf8").trim());
}

const crates = [...shipped].map((id) => packages.get(id)).filter((pkg) => !ours.has(pkg.id))
  .sort((a, b) => a.name.localeCompare(b.name));
const rule = "=".repeat(72);
const sections = crates.map((pkg) => [
  rule,
  `${pkg.name} ${pkg.version} (${pkg.license ?? "see below"})${pkg.repository ? `\n${pkg.repository}` : ""}`,
  rule,
  ...licenceTexts(pkg),
].join("\n\n"));

const intro = "OpenHElity is MIT-licensed. Its WebAssembly core (openhelity_bg.wasm and the\n"
  + "openhelity.js glue) also contains the following crates, under these licences.";
writeFileSync(out, `${[intro, ...sections].join("\n\n")}\n`);
console.log(`Licence notices for ${crates.length} crates: ${out}`);
