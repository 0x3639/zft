import { sha256, stringToBytes } from "viem";
import type { Identity } from "./identity";
import { canonical } from "../../../packages/protocol";
import { challengeText, type Challenge } from "../../../packages/protocol/auth";
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "omit",
    cache: "no-store",
  });
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok)
    throw new ApiError(response.status, data.error ?? "Request failed.");
  return data;
}
export async function signedRequest<T>(
  path: string,
  data: unknown,
  account: Identity,
): Promise<T> {
  await account.assertCurrent?.();
  const body = canonical(data);
  const c = await api<Challenge>("/api/challenges", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      address: account.address,
      method: "POST",
      path,
      bodyHash: sha256(stringToBytes(body)),
    }),
  });
  if (
    c.origin !== location.origin ||
    c.address !== account.address ||
    c.method !== "POST" ||
    c.path !== path ||
    c.bodyHash !== sha256(stringToBytes(body)) ||
    c.expires < Date.now() / 1000 ||
    c.expires > Date.now() / 1000 + 600
  )
    throw new Error("Unexpected request challenge.");
  const signature = await account.signMessage({ message: challengeText(c) });
  await account.assertCurrent?.();
  return api<T>(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-zft-challenge": c.id,
      "x-zft-signature": signature,
    },
    body,
  });
}
