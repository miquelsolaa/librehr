import type { Sql } from "postgres";

/** Answers one tagged-template query with rows, given its SQL text and params. */
export type QueryHandler = (text: string, params: unknown[]) => unknown[];

/**
 * A fake `postgres` client for route unit tests that run without Docker. Each
 * query's template strings are joined with `?` and passed, whitespace
 * collapsed, to the handler; unmatched queries return no rows (like
 * route-errors.test.ts). `tx.json()` is supported for repositories that use it.
 */
export function scriptedSql(handler: QueryHandler): Sql {
  const run = async (strings: TemplateStringsArray, ...params: unknown[]) => {
    const text = strings.join("?").replace(/\s+/g, " ").trim();
    const rows = handler(text, params);
    return Object.assign([...rows], { count: rows.length });
  };
  // withTenant brands each transaction with a non-configurable property, so
  // every begin() needs a fresh function object.
  const newTx = () =>
    Object.assign(
      (strings: TemplateStringsArray, ...params: unknown[]) =>
        run(strings, ...params),
      { json: (value: unknown) => value },
    );
  return Object.assign(run, {
    begin: async (fn: (t: unknown) => Promise<unknown>) => fn(newTx()),
    json: (value: unknown) => value,
  }) as unknown as Sql;
}

/** Matches the policy-context lookup issued by EmployeeRepository. */
export function isPolicyIdentityQuery(text: string): boolean {
  return text.includes('as "reports"') && text.includes("FROM employees e");
}
