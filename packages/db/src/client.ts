import postgres, { type Sql } from "postgres";

export type { Sql };

/**
 * Opens a connection pool. For processes (such as the worker) that need
 * database access but should not depend on the driver package directly.
 */
export function createDatabaseClient(
  url: string,
  options: { max?: number } = {},
): Sql {
  return postgres(url, { max: options.max ?? 5 });
}
