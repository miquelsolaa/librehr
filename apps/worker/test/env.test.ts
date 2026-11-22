import { describe, it, expect } from "vitest";
import { loadWorkerEnv } from "../src/env.js";

describe("worker env", () => {
  it("applies dev defaults outside production", () => {
    const env = loadWorkerEnv({ NODE_ENV: "development" });
    expect(env.NODE_ENV).toBe("development");
    expect(env.DATABASE_URL).toContain("localhost");
    expect(env.SMTP).toEqual({
      host: "localhost",
      port: 1025,
      from: "LibreHR <noreply@librehr.local>",
    });
  });

  it("prefers DATABASE_MIGRATION_URL over DATABASE_URL", () => {
    const env = loadWorkerEnv({
      NODE_ENV: "test",
      DATABASE_URL: "postgres://app@db/librehr",
      DATABASE_MIGRATION_URL: "postgres://owner@db/librehr",
    });
    expect(env.DATABASE_URL).toBe("postgres://owner@db/librehr");
  });

  it("fails in production when the database url is missing", () => {
    expect(() => loadWorkerEnv({ NODE_ENV: "production" })).toThrow(
      /DATABASE_URL/,
    );
  });

  it("fails in production when a value still contains a dev password", () => {
    expect(() =>
      loadWorkerEnv({
        NODE_ENV: "production",
        DATABASE_URL:
          "postgres://librehr_owner:librehr_dev_password@db:5432/librehr",
      }),
    ).toThrow(/dev_password/);
  });

  it("does not echo secret values in the error message", () => {
    try {
      loadWorkerEnv({
        NODE_ENV: "production",
        DATABASE_URL: "postgres://u:prod_secret@db/x",
        SMTP_PASS: "smtp_dev_password",
      });
      expect.unreachable();
    } catch (err) {
      expect(String(err)).toContain("SMTP_PASS");
      expect(String(err)).not.toContain("prod_secret");
      expect(String(err)).not.toContain("smtp_dev_password");
    }
  });

  it("rejects an unparseable database url without echoing it", () => {
    // A base64 password containing `/` breaks URL parsing unless URL-encoded.
    let message = "";
    try {
      loadWorkerEnv({
        NODE_ENV: "development",
        DATABASE_MIGRATION_URL: "postgres://librehr_owner:ab/cd+ef=@db/librehr",
      });
    } catch (err) {
      message = String(err);
    }
    expect(message).toContain("DATABASE_MIGRATION_URL");
    expect(message).toContain("URL-encode");
    expect(message).not.toContain("ab/cd");
  });

  it("leaves SMTP unconfigured in production when SMTP_HOST is absent", () => {
    const env = loadWorkerEnv({
      NODE_ENV: "production",
      DATABASE_URL: "postgres://u:strong@db/librehr",
      TIME_CHAIN_KEY: "prod-time-chain-key-9d1c5f3a7e2b6d0c4a8f",
    });
    expect(env.SMTP).toBeNull();
  });

  it("requires a real TIME_CHAIN_KEY in production", () => {
    expect(() =>
      loadWorkerEnv({
        NODE_ENV: "production",
        DATABASE_URL: "postgres://u:strong@db/librehr",
      }),
    ).toThrow(/TIME_CHAIN_KEY/);
    expect(() =>
      loadWorkerEnv({
        NODE_ENV: "production",
        DATABASE_URL: "postgres://u:strong@db/librehr",
        TIME_CHAIN_KEY: "dev_time_chain_key_must_be_changed_in_production_32",
      }),
    ).toThrow(/TIME_CHAIN_KEY/);
    const env = loadWorkerEnv({
      NODE_ENV: "production",
      DATABASE_URL: "postgres://u:strong@db/librehr",
      TIME_CHAIN_KEY: "prod-time-chain-key-9d1c5f3a7e2b6d0c4a8f",
    });
    expect(env.TIME_CHAIN_KEY).toBe("prod-time-chain-key-9d1c5f3a7e2b6d0c4a8f");
  });

  it("uses the development chain key outside production", () => {
    expect(
      loadWorkerEnv({ NODE_ENV: "test" }).TIME_CHAIN_KEY.length,
    ).toBeGreaterThanOrEqual(32);
  });

  describe("scheduler (issue #115)", () => {
    it("is enabled by default with a 15-minute UTC tick, 30 minutes of grace and every job but accrual", () => {
      expect(loadWorkerEnv({ NODE_ENV: "test" }).SCHEDULER).toEqual({
        enabled: true,
        tickCron: "*/15 * * * *",
        graceMinutes: 30,
        jobs: ["time.close-day", "audit.verify-chain", "retention.enforce"],
      });
    });

    it("reads the flag, cron, grace and job list", () => {
      const env = loadWorkerEnv({
        NODE_ENV: "test",
        SCHEDULER_ENABLED: "false",
        SCHEDULER_TICK_CRON: " 5,35 * * * * ",
        SCHEDULER_GRACE_MINUTES: "90",
        SCHEDULER_JOBS: "leave.accrue, time.close-day,leave.accrue",
      });
      expect(env.SCHEDULER).toEqual({
        enabled: false,
        tickCron: "5,35 * * * *",
        graceMinutes: 90,
        jobs: ["leave.accrue", "time.close-day"],
      });
    });

    it("treats empty values as the defaults", () => {
      const env = loadWorkerEnv({
        NODE_ENV: "test",
        SCHEDULER_ENABLED: "",
        SCHEDULER_GRACE_MINUTES: "",
      });
      expect(env.SCHEDULER).toMatchObject({ enabled: true, graceMinutes: 30 });
    });

    it("treats an empty job list as the defaults, leaving accrual opt-in", () => {
      const { jobs } = loadWorkerEnv({
        NODE_ENV: "test",
        SCHEDULER_JOBS: "",
      }).SCHEDULER;
      expect(jobs).toEqual([
        "time.close-day",
        "audit.verify-chain",
        "retention.enforce",
      ]);
      expect(jobs).not.toContain("leave.accrue");
    });

    it("schedules accrual only when listed explicitly", () => {
      expect(
        loadWorkerEnv({
          NODE_ENV: "test",
          SCHEDULER_JOBS:
            "time.close-day,audit.verify-chain,retention.enforce,leave.accrue",
        }).SCHEDULER.jobs,
      ).toContain("leave.accrue");
    });

    it.each([
      ["SCHEDULER_ENABLED", "yes"],
      ["SCHEDULER_TICK_CRON", "every 15 minutes"],
      ["SCHEDULER_TICK_CRON", "*/15 * * *"],
      ["SCHEDULER_GRACE_MINUTES", "-1"],
      ["SCHEDULER_GRACE_MINUTES", "721"],
      ["SCHEDULER_JOBS", "leave.accrue,email.send"],
      ["SCHEDULER_JOBS", " , "],
    ])("rejects %s=%s", (key, value) => {
      expect(() => loadWorkerEnv({ NODE_ENV: "test", [key]: value })).toThrow();
    });
  });
});
