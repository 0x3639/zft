// Isolated workerd fixture: real sharing code/HTMLRewriter, no hosted bindings or keys.
import { shareHTML } from "../../apps/api/sharing";
import type { Env } from "../../apps/api/types";

export default {
  async fetch(request: Request) {
    const mode = request.headers.get("x-fixture");
    const unavailable = () => {
      throw new Error("private storage failure detail");
    };
    const statement = {
      bind() {
        return this;
      },
      async first() {
        return null;
      },
      async all() {
        return { results: [] };
      },
    };
    const env = {
      PUBLIC_ORIGIN: "https://devnet.zft.foo",
      DB: {
        prepare(query: string) {
          if (mode === "database-outage") unavailable();
          return {
            ...statement,
            async first() {
              if (
                mode === "published-profile" &&
                query.includes("FROM profiles")
              )
                return {
                  name: "A published collector",
                  bio: "",
                  revision: 1,
                  featured: null,
                };
              if (query.includes("COUNT(*)")) return { n: 0 };
              if (
                mode === "metadata-outage" &&
                query.includes("FROM indexed_items")
              )
                return { token_id: "42", metadata_hash: `0x${"1".repeat(64)}` };
              return null;
            },
          };
        },
      },
      MEDIA: {
        async get() {
          return unavailable();
        },
        async head() {
          if (mode === "head-outage") unavailable();
          return null;
        },
        async put() {
          if (mode === "put-outage") unavailable();
        },
      },
      ASSETS: {
        async fetch() {
          return new Response(
            '<!doctype html><html><head><title>Old title</title><meta name="robots" content="index"><meta property="og:image" content="stale-image"><meta name="twitter:image" content="stale-image"></head><body><div id="root"></div><script type="module" src="/assets/app.js"></script></body></html>',
            {
              status: mode === "shell-outage" ? 502 : 200,
              headers: {
                "content-type": "text/html; charset=utf-8",
                etag: "stale",
              },
            },
          );
        },
      },
    } as unknown as Env;
    return shareHTML(request, env);
  },
};
