import { chmodSync, copyFileSync, statSync } from "node:fs";

const wasmPath = new URL(
  "../target/wasm32-unknown-unknown/release/chopsticks.wasm",
  import.meta.url,
);
const outputPath = new URL("../frontend/chopsticks.wasm", import.meta.url);

copyFileSync(wasmPath, outputPath);
chmodSync(outputPath, 0o644);

console.log(
  `Wrote ${outputPath.pathname} (${statSync(outputPath).size} bytes)`,
);
