import { createInterface } from "node:readline/promises";
import postgres from "postgres";
import { recoverAccount } from "../lib/recover-account.js";

function readSecret(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    let value = "";
    process.stdout.write(prompt);
    input.setRawMode(true);
    input.setEncoding("utf8");
    input.resume();
    const finish = () => {
      input.removeListener("data", onData);
      input.setRawMode(false);
      input.pause();
      process.stdout.write("\n");
    };
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\u0003" || char === "\u0004") {
          finish();
          reject(new Error("Cancelled"));
          return;
        }
        if (char === "\r" || char === "\n") {
          finish();
          resolve(value);
          return;
        }
        if (char === "\u007f" || char === "\b")
          value = Array.from(value).slice(0, -1).join("");
        else if (char >= " " && char !== "\u001b") value += char;
        if (value.length > 1024) {
          finish();
          reject(new Error("Password too long"));
          return;
        }
      }
    };
    input.on("data", onData);
  });
}

async function main(): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new Error("An interactive terminal is required");
  if (process.argv.length !== 2)
    throw new Error("This command does not accept arguments");
  const databaseUrl = process.env["DATABASE_URL"];
  if (!databaseUrl) throw new Error("DATABASE_URL must be configured");
  const terminal = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const email = (await terminal.question("Account email: ")).trim();
  const confirmation = await terminal.question(
    `Reset password and revoke all sessions for ${email}? Type YES: `,
  );
  terminal.close();
  if (confirmation !== "YES") throw new Error("Cancelled");
  const password = await readSecret("New password: ");
  const repeated = await readSecret("Repeat new password: ");
  if (password !== repeated) throw new Error("Passwords do not match");
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    if (!(await recoverAccount(sql, email, password)))
      throw new Error("Account not found");
    process.stdout.write("Password reset and sessions revoked.\n");
  } finally {
    await sql.end();
  }
}

main().catch(() => {
  process.stderr.write(
    "Recovery failed. Check the account, password length, terminal and database connection.\n",
  );
  process.exitCode = 1;
});
