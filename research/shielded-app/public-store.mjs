// Disposable in-memory R2 substitute for local acceptance only. Never uses remote storage.
export function publicStore() {
  const objects = new Map();
  return {
    async put(key, value) {
      objects.set(
        key,
        typeof value === "string"
          ? new TextEncoder().encode(value)
          : new Uint8Array(value),
      );
    },
    async get(key) {
      const value = objects.get(key);
      return value
        ? {
            json: async () => JSON.parse(new TextDecoder().decode(value)),
            arrayBuffer: async () => value.slice().buffer,
          }
        : null;
    },
    async list({ prefix, limit, cursor }) {
      const keys = [...objects.keys()]
        .filter((key) => key.startsWith(prefix))
        .sort();
      // Key cursor preserves position if new records arrive during a local trial.
      const remaining = keys.filter((key) => !cursor || key > cursor),
        page = remaining.slice(0, limit);
      return {
        objects: page.map((key) => ({ key })),
        truncated: remaining.length > page.length,
        cursor: page.at(-1),
      };
    },
  };
}
