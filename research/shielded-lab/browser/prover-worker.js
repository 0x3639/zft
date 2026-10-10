// A responsiveness boundary, not isolation from the application delivering this worker.
self.onmessage = async ({ data }) => {
  const { id, name, input, artifacts } = data;
  try {
    if (!["create", "spend"].includes(name) || typeof id !== "string")
      throw Error("job");
    const bytes = {};
    for (const [kind, entry] of Object.entries(artifacts)) {
      if (
        !["library", "wasm", "key", "verificationKey"].includes(kind) ||
        !entry.url.startsWith("/") ||
        entry.url.startsWith("//") ||
        !Number.isInteger(entry.bytes) ||
        entry.bytes < 1 ||
        entry.bytes > 32 * 1024 * 1024
      )
        throw Error("artifact");
      const response = await fetch(entry.url, {
        redirect: "error",
        cache: "no-store",
        credentials: "omit",
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw Error("fetch");
      const reader = response.body.getReader(),
        parts = [];
      let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > entry.bytes) throw Error("bound");
          parts.push(value);
        }
      } finally {
        await reader.cancel();
      }
      if (size !== entry.bytes) throw Error("size");
      const buffer = new Uint8Array(size);
      let at = 0;
      for (const part of parts) {
        buffer.set(part, at);
        at += part.length;
      }
      const hash =
        "0x" +
        Array.from(
          new Uint8Array(await crypto.subtle.digest("SHA-256", buffer)),
          (b) => b.toString(16).padStart(2, "0"),
        ).join("");
      if (hash !== entry.sha256) throw Error("digest");
      bytes[kind] = buffer;
    }
    // Execute only the bundle whose bytes were checked, avoiding a second fetch race.
    const script = URL.createObjectURL(
      new Blob([bytes.library], { type: "text/javascript" }),
    );
    try {
      importScripts(script);
    } finally {
      URL.revokeObjectURL(script);
    }
    self.postMessage({ id, status: "proving" });
    const start = performance.now();
    const result = await self.snarkjs.groth16.fullProve(
      input,
      bytes.wasm,
      bytes.key,
      undefined,
      undefined,
      { singleThread: true },
    );
    const vkey = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes.verificationKey),
    );
    if (
      !(await self.snarkjs.groth16.verify(
        vkey,
        result.publicSignals,
        result.proof,
      ))
    )
      throw Error("verify");
    const milliseconds = performance.now() - start;
    self.postMessage({
      id,
      status: "complete",
      milliseconds,
      publicSignals: result.publicSignals,
      proof: result.proof,
    });
  } catch {
    self.postMessage({
      id,
      status: "failed",
      message: "Proof or artifact validation failed.",
    });
  }
};
