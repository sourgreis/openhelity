import init, * as wasm from "../pkg/openhelity.js";

await init();

export const core = wasm;

export const CONSTANTS = Object.freeze(wasm.constants());
