// Test-only Node adapter. Native browser DecompressionStream is qualified separately.
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
export class StrictTestDecoder extends TransformStream {
  constructor(format) {
    assert.equal(format, "deflate");
    const parts = [];
    super({
      transform(value) {
        parts.push(Buffer.from(value));
      },
      flush(controller) {
        const input = Buffer.concat(parts);
        const result = inflateSync(input, {
          info: true,
          maxOutputLength: 2 * 1024 * 1024,
        });
        assert.equal(
          result.engine.bytesWritten,
          input.length,
          "trailing zlib input",
        );
        controller.enqueue(new Uint8Array(result.buffer));
      },
    });
  }
}
