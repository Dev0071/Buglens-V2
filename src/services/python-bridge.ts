import { spawn } from "child_process";
import path from "node:path";
import { config } from "../utils/config.js";
import { logger } from "../utils/logger.js";

interface PythonBridgeOptions {
  module: string;
  timeoutMs?: number;
}

export class PythonBridge {
  private readonly module: string;
  private readonly timeoutMs: number;

  constructor(options: PythonBridgeOptions) {
    this.module = options.module;
    this.timeoutMs = options.timeoutMs ?? config.PYTHON_ANALYZER_TIMEOUT_MS;
  }

  async execute<TInput extends object, TOutput = unknown>(
    payload: TInput
  ): Promise<TOutput> {
    return new Promise<TOutput>((resolve, reject) => {
      const pythonExecutable = config.PYTHON_BIN;
      const cwd = path.resolve(process.cwd(), "python");

      const child = spawn(pythonExecutable, ["-m", this.module], {
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          PYTHONUNBUFFERED: "1",
        },
      });

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error(`Python module ${this.module} timed out`));
      }, this.timeoutMs);

      child.stdout.on("data", (chunk: Buffer) => {
        stdoutChunks.push(chunk);
      });

      child.stderr.on("data", (chunk: Buffer) => {
        stderrChunks.push(chunk);
      });

      child.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });

      child.on("close", (code) => {
        clearTimeout(timer);
        const stdout = Buffer.concat(stdoutChunks).toString("utf-8").trim();
        const stderr = Buffer.concat(stderrChunks).toString("utf-8").trim();

        if (code !== 0) {
          logger.error(
            { module: this.module, stderr, exitCode: code },
            "Python analyzer exited with non-zero code"
          );
          reject(
            new Error(
              `Python module ${this.module} failed: ${stderr || "unknown error"}`
            )
          );
          return;
        }

        try {
          const parsed = stdout
            ? (JSON.parse(stdout) as TOutput)
            : ({} as TOutput);
          resolve(parsed);
        } catch (error) {
          logger.error(
            { module: this.module, stdout },
            "Failed to parse Python output"
          );
          reject(error);
        }
      });

      child.stdin.write(JSON.stringify(payload));
      child.stdin.end();
    });
  }
}
