// Bounded durable public data, sharing the observer transaction database.
import * as p from "./profile.mjs";
import { boundDatabase } from "./persistent.mjs";
export function durablePublic(observer) {
  const db = observer.db;
  boundDatabase(db);
  db.exec(`CREATE TABLE IF NOT EXISTS public_requests (id TEXT PRIMARY KEY REFERENCES challenges(id), chain INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS public_records (id TEXT PRIMARY KEY, wire TEXT NOT NULL, published INTEGER NOT NULL);`);
  return {
    requests: {
      get size() {
        return db.prepare("SELECT COUNT(*) AS n FROM challenges").get().n;
      },
      set(id, value) {
        db.prepare("INSERT INTO public_requests VALUES (?,?)").run(
          id,
          value.chain_id,
        );
      },
      get(id) {
        const r = db
          .prepare(
            "SELECT c.context,c.wire,c.receipt,p.chain FROM public_requests p JOIN challenges c ON c.id=p.id WHERE p.id=?",
          )
          .get(id);
        return r
          ? {
              context: p.parse(r.context),
              chain_id: r.chain,
              showing: r.wire === null ? null : p.parse(r.wire).showing,
              receipt: r.receipt,
            }
          : undefined;
      },
    },
    records: {
      get size() {
        return db.prepare("SELECT COUNT(*) AS n FROM public_records").get().n;
      },
      has(id) {
        return !!db.prepare("SELECT 1 FROM public_records WHERE id=?").get(id);
      },
      get(id) {
        const r = db
          .prepare(
            "SELECT wire,published AS publishedAt FROM public_records WHERE id=?",
          )
          .get(id);
        return r ?? undefined;
      },
      set(id, r) {
        db.prepare("INSERT INTO public_records VALUES (?,?,?)").run(
          id,
          r.wire,
          r.publishedAt,
        );
      },
      entries() {
        return db
          .prepare(
            "SELECT id,wire,published AS publishedAt FROM public_records",
          )
          .all()
          .map(({ id, ...r }) => [id, r]);
      },
    },
  };
}
