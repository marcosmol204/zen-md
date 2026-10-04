import { spawnSync, spawn } from "node:child_process";
import { homedir } from "node:os";
import { join, delimiter } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const cargoBin = join(homedir(), ".cargo", "bin");
if (existsSync(cargoBin)) {
  const paths = (process.env.PATH || "").split(delimiter);
  if (!paths.includes(cargoBin)) {
    process.env.PATH = [cargoBin, process.env.PATH].filter(Boolean).join(delimiter);
  }
}

process.chdir(fileURLToPath(new URL(".", import.meta.url)));

const { productName } = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
const mac = process.platform === "darwin";
const win = process.platform === "win32";
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: win });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

run("npx", ["tauri", "build", ...(mac ? ["--bundles", "app"] : ["--no-bundle"])]);

const release = "src-tauri/target/release";
if (mac) {
  run("open", [`${release}/bundle/macos/${productName}.app`]);
} else {
  // ponytail: untested on Windows/Linux; assumes binary = productName; keep it equal to the Cargo package name when renaming.
  const exe = `${release}/${productName}${win ? ".exe" : ""}`;
  spawn(exe, { stdio: "inherit" }).on("exit", (code) => process.exit(code ?? 0));
}
