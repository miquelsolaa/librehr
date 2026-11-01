import PgBoss from "pg-boss";
import pino from "pino";
import { handleEmailSend } from "./queues/email.send.js";
import { handleLeaveAccrue } from "./queues/leave.accrue.js";
import { handleTimeCloseDay } from "./queues/time.close-day.js";
import { handleRetentionEnforce } from "./queues/retention.enforce.js";
import { handleAuditVerifyChain } from "./queues/audit.verify-chain.js";

const logger = pino({
  level: process.env["LOG_LEVEL"] || "info",
  timestamp: pino.stdTimeFunctions.isoTime,
});

async function startWorker() {
  const dbUrl =
    process.env["DATABASE_URL"] ||
    "postgres://openhr_app:openhr_dev_password@localhost:5432/openhr";

  logger.info({ msg: "Bootstrapping OpenHR Background Worker (pg-boss)..." });

  const boss = new PgBoss({
    connectionString: dbUrl,
    schema: "pgboss",
  });

  boss.on("error", (err) => {
    logger.error({ msg: "pg-boss internal error", err: String(err) });
  });

  await boss.start();
  logger.info({ msg: "pg-boss started successfully" });

  // Register queues
  await boss.work("email.send", async (jobs) => {
    const jobList = Array.isArray(jobs) ? jobs : [jobs];
    for (const job of jobList) {
      if (!job) continue;
      logger.info({
        msg: "Processing email.send",
        jobId: (job as { id?: string }).id,
      });
      const dummyMailer = {
        sendMail: async () => {},
      };
      await handleEmailSend(
        job as unknown as Parameters<typeof handleEmailSend>[0],
        dummyMailer,
      );
    }
  });

  await boss.work("leave.accrue", async (jobs) => {
    const job = Array.isArray(jobs) ? jobs[0] : jobs;
    if (job)
      await handleLeaveAccrue(
        job as unknown as Parameters<typeof handleLeaveAccrue>[0],
      );
  });

  await boss.work("time.close-day", async (jobs) => {
    const job = Array.isArray(jobs) ? jobs[0] : jobs;
    if (job)
      await handleTimeCloseDay(
        job as unknown as Parameters<typeof handleTimeCloseDay>[0],
      );
  });

  await boss.work("retention.enforce", async (jobs) => {
    const job = Array.isArray(jobs) ? jobs[0] : jobs;
    if (job)
      await handleRetentionEnforce(
        job as unknown as Parameters<typeof handleRetentionEnforce>[0],
      );
  });

  await boss.work("audit.verify-chain", async (jobs) => {
    const job = Array.isArray(jobs) ? jobs[0] : jobs;
    if (job)
      await handleAuditVerifyChain(
        job as unknown as Parameters<typeof handleAuditVerifyChain>[0],
      );
  });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ msg: `Received ${signal}, gracefully stopping worker...` });
    await boss.stop({ graceful: true, timeout: 5000 });
    logger.info({ msg: "Worker stopped cleanly" });
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

if (process.argv[1] && process.argv[1].endsWith("index.ts")) {
  startWorker().catch((err) => {
    logger.error({ msg: "Fatal worker start error", err: String(err) });
    process.exit(1);
  });
}
