import { spawn } from "node:child_process";

const children = [];
let shuttingDown = false;

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

function start(name, command, args) {
  const child = spawn(command, args, {
    stdio: "inherit",
    env: process.env,
  });
  children.push(child);

  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    terminateAll();
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });

  child.on("error", (error) => {
    console.error(`[${name}] failed to start`, error);
    shutdown(1);
  });
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => shutdown(0));
}

start("server", "pnpm", ["server"]);
start("web", "pnpm", ["web:dev"]);
