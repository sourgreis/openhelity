// Node's fetch has no file: URLs, which the WebAssembly glue uses; import before web/js.
import { readFile } from "node:fs/promises";

const networkFetch = globalThis.fetch;
globalThis.fetch = async (url, ...rest) => {
  const href = String(url);
  if (!href.startsWith("file:")) return networkFetch(url, ...rest);
  const type = href.endsWith(".wasm") ? "application/wasm" : "application/octet-stream";
  return new Response(await readFile(new URL(href)), { headers: { "Content-Type": type } });
};
