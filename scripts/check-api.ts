import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { sha256, stringToBytes } from "viem";
import { challengeText, type Challenge } from "../packages/protocol/auth";
const origin = process.env.ZFT_TEST_ORIGIN ?? "http://localhost:5173",
  profile = privateKeyToAccount(generatePrivateKey());
const post = (
  path: string,
  body: string,
  headers: Record<string, string> = {},
) =>
  fetch(origin + path, {
    method: "POST",
    headers: { origin, "content-type": "application/json", ...headers },
    body,
  });
async function check(response: Response, status: number, label: string) {
  if (response.status !== status)
    throw new Error(`${label}: expected ${status}, got ${response.status}`);
  console.log(`${label}: ${status}`);
}
await check(
  await post("/api/uploads", "{}", { origin: "https://untrusted.invalid" }),
  403,
  "Cross-origin write rejected",
);
await check(await post("/api/uploads", "{}"), 401, "Unsigned write rejected");
await check(
  await post("/api/operations", "x".repeat(9000)),
  413,
  "Operation body limit enforced",
);
const c = (await (
  await post(
    "/api/challenges",
    JSON.stringify({
      address: profile.address,
      method: "POST",
      path: "/api/uploads",
      bodyHash: sha256(stringToBytes("{}")),
    }),
  )
).json()) as Challenge;
const headers = {
  "x-zft-challenge": c.id,
  "x-zft-signature": await profile.signMessage({ message: challengeText(c) }),
};
await check(
  await post("/api/uploads", '{"altered":true}', headers),
  401,
  "Body substitution rejected",
);
await check(
  await post("/api/uploads", "{}", headers),
  400,
  "Authenticated invalid upload rejected",
);
await check(
  await post("/api/uploads", "{}", headers),
  401,
  "Consumed challenge replay rejected",
);
