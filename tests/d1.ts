import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
// Exercise real SQLite constraints, views, and transactions using the D1 interface.
export function database() {
  const sql = new DatabaseSync(":memory:");
  for (const name of readdirSync("migrations")
    .filter((n) => n.endsWith(".sql"))
    .sort())
    sql.exec(readFileSync(`migrations/${name}`, "utf8"));
  class Statement {
    constructor(
      private query: string,
      private args: unknown[] = [],
    ) {}
    bind(...args: unknown[]) {
      return new Statement(this.query, args);
    }
    async first() {
      return sql.prepare(this.query).get(...(this.args as never[])) ?? null;
    }
    async all() {
      return {
        results: sql.prepare(this.query).all(...(this.args as never[])),
        success: true,
      };
    }
    async run() {
      const result = sql.prepare(this.query).run(...(this.args as never[]));
      return { success: true, meta: { changes: Number(result.changes) } };
    }
  }
  const db = {
    prepare: (query: string) => new Statement(query),
    batch: async (statements: Statement[]) => {
      sql.exec("BEGIN");
      try {
        const results = [];
        for (const s of statements) results.push(await s.run());
        sql.exec("COMMIT");
        return results;
      } catch (e) {
        sql.exec("ROLLBACK");
        throw e;
      }
    },
  } as unknown as D1Database;
  return { db, sql };
}
