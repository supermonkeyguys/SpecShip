import { spawn } from "node:child_process";
import { platform } from "node:os";

const children = [];
let shuttingDown = false;
const pnpmCmd = platform() === "win32" ? "pnpm.cmd" : "pnpm";

function prefixStream(stream, prefix) {
  let buffered = "";
  stream.on("data", (chunk) => {
    buffered += chunk.toString();
    const lines = buffered.split(/\r?\n/);
    buffered = lines.pop() ?? "";
    for (const line of lines) {
      if (line.length > 0) {
        process.stdout.write(`[${prefix}] ${line}\n`);
      }
    }
  });
  stream.on("end", () => {
    if (buffered.length > 0) {
      process.stdout.write(`[${prefix}] ${buffered}\n`);
      buffered = "";
    }
  });
}

function terminateAll(signal = "SIGTERM") {
  for (const child of children) {
    if (child.exitCode == null && child.signalCode == null) {
      child.kill(signal);
    }
  }
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  terminateAll();
  setTimeout(() => process.exit(code), 100);
}

function start(name, args) {
  const child = spawn(pnpmCmd, args, {
    stdio: ["inherit", "pipe", "pipe"],
    env: process.env,
  });
  children.push(child);

  prefixStream(child.stdout, name);
  prefixStream(child.stderr, name);

  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    if (signal) {
      process.stderr.write(`[${name}] exited via signal ${signal}\n`);
      shuttingDown = true;
      terminateAll();
      process.kill(process.pid, signal);
      return;
    }
    if ((code ?? 0) !== 0) {
      process.stderr.write(`[${name}] exited with code ${code}\n`);
      shuttingDown = true;
      terminateAll();
      process.exit(code ?? 1);
      return;
    }
  });

  child.on("error", (error) => {
    console.error(`[${name}] failed to start`, error);
    shutdown(1);
  });
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => shutdown(0));
}

start("server", ["server"]);
start("web", ["web:dev"]);
