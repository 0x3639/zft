import { it, expect } from "vitest";
import { hashTypedData } from "viem";
import {
  domain,
  mintTypes,
  mintSchema,
  operationSchema,
  canonical,
  uintSchema,
} from "../packages/protocol";
it("validates uint256 text before converting it to BigInt", () => {
  for (const value of [
    "bad",
    "1.5",
    "-1",
    "01",
    "",
    "0x1",
    (2n ** 256n).toString(),
  ])
    expect(uintSchema.safeParse(value).success).toBe(false);
  for (const value of ["0", (2n ** 256n - 1n).toString()])
    expect(uintSchema.parse(value)).toBe(value);
});
it("freezes the cross-language EIP-712 mint digest", () => {
  expect(
    hashTypedData({
      domain: domain("0x0000000000000000000000000000000000001234"),
      types: mintTypes,
      primaryType: "Mint",
      message: {
        imageHash: `0x${"11".repeat(32)}`,
        metadataHash: `0x${"22".repeat(32)}`,
        initialOwner: "0x0000000000000000000000000000000000000002",
        creator: "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf",
        creatorNonce: 0n,
        deadline: 1791150000n,
      },
    }),
  ).toBe("0x9a0711ff1b501708a73e1c10f34b04b6083e0d98097387101822c338aac2860e");
});
it("rejects non-I-JSON and unsupported operation fields", () => {
  expect(() => canonical({ bad: "\ud800" })).toThrow();
  expect(() => canonical(NaN)).toThrow();
  expect(
    operationSchema.safeParse({
      kind: "rotate",
      target: "0x123",
      privateKey: "secret",
    }).success,
  ).toBe(false);
  expect(mintSchema.safeParse({ creatorNonce: 9007199254740993 }).success).toBe(
    false,
  );
});
