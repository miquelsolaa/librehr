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
    });
    expect(env.SMTP).toBeNull();
  });
});
