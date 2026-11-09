// PostToolUse hook: format the file Claude just edited with the repo's Prettier config.
// Reads the hook payload from stdin; never fails the tool call.
import { spawnSync } from "node:child_process";
import process from "node:process";

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (raw += chunk));
process.stdin.on("end", () => {
  let file;
  try {
    file = JSON.parse(raw)?.tool_input?.file_path;
  } catch {
    process.exit(0);
  }
  if (typeof file !== "string" || file.length === 0) process.exit(0);
  spawnSync("pnpm", ["exec", "prettier", "--write", "--ignore-unknown", file], {
    stdio: "ignore",
    shell: process.platform === "win32",
  });
  process.exit(0);
});
