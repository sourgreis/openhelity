import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const notices = readFileSync(new URL("../web/pkg/THIRD-PARTY-NOTICES.txt", import.meta.url), "utf8");

test("the built core carries the licences of the crates compiled into it", () => {
  for (const crate of ["wasm-bindgen", "js-sys", "serde", "serde-wasm-bindgen"]) {
    assert.match(notices, new RegExp(`^${crate} \\d`, "m"), `${crate} is missing`);
  }
  assert.match(notices, /Permission is hereby granted/);
  assert.doesNotMatch(notices, /^(syn|quote|proc-macro2|wasm-bindgen-macro) \d/m, "build-time crates ship nothing");
});
