/**
 * Vitest Setup File
 * 
 * Initializes source-map WASM before tests run
 */
import { SourceMapConsumer } from "source-map";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

// Initialize source-map WASM loader
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wasmPath = path.resolve(__dirname, "../node_modules/source-map/lib/mappings.wasm");

if (fs.existsSync(wasmPath)) {
  const wasmBuffer = fs.readFileSync(wasmPath);
  (SourceMapConsumer as any).initialize({
    "lib/mappings.wasm": wasmBuffer
  });
}

export {};
