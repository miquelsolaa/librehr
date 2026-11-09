import { PgBoss } from "pg-boss";
import pino from "pino";
import { loadWorkerEnv } from "./env.js";
import { handleEmailSend } from "./queues/email.send.js";
import { handleLeaveAccrue } from "./queues/leave.accrue.js";
import { handleTimeCloseDay } from "./queues/time.close-day.js";
import { handleRetentionEnforce } from "./queues/retention.enforce.js";
import { handleAuditVerifyChain } from "./queues/audit.verify-chain.js";
import { createSmtpMailer } from "./lib/smtp-mailer.js";
import { processBatch, type BatchJob } from "./lib/process-batch.js";
import type { QueueName } from "./lib/enqueue.js";
import { ensureQueues } from "./lib/queue-setup.js";

const env = loadWorkerEnv();

const logger = pino({
  level: env.LOG_LEVEL,
  timestamp: pino.stdTimeFunctions.isoTime,
});

async function startWorker() {
  logger.info({ msg: "Bootstrapping LibreHR Background Worker (pg-boss)..." });

  const mailer = env.SMTP ? createSmtpMailer(env.SMTP) : null;
  if (!mailer) {
    logger.warn({
      msg: "SMTP_HOST is not set: email.send jobs will fail and be retried until SMTP is configured",
    });
  }

  const boss = new PgBoss({
    connectionString: env.DATABASE_URL,
    schema: "pgboss",
  });

  boss.on("error", (err: unknown) => {
    logger.error({
      msg: "pg-boss internal error",
      err: err instanceof Error ? (err.stack ?? err.message) : String(err),
    });
  });

  await boss.start();
  logger.info({ msg: "pg-boss started successfully" });

  // Creates missing queues and warns about existing ones whose policy pg-boss cannot change.
  await ensureQueues(boss, logger);

  // perJobResults: every job in a batch is settled on its own, so one bad job cannot fail or
  // block the rest of the batch.
  const register = (
    queue: QueueName,
    handler: (job: BatchJob<unknown>) => Promise<unknown>,
  ) =>
    boss.work<unknown>(queue, { perJobResults: true }, (jobs) =>
      processBatch(queue, jobs, handler, logger),
    );

  await register("email.send", (job) => handleEmailSend(job, mailer));
  await register("leave.accrue", (job) => handleLeaveAccrue(job, logger));
  await register("time.close-day", (job) => handleTimeCloseDay(job, logger));
  await register("retention.enforce", (job) =>
    handleRetentionEnforce(job, logger),
  );
  await register("audit.verify-chain", (job) =>
    handleAuditVerifyChain(job, logger),
  );

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
  startWorker().catch((err: unknown) => {
    logger.error({
      msg: "Fatal worker start error",
      err: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
  });
}
