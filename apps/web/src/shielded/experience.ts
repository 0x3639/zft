import type { Snapshot } from "../../../../packages/shielded/client.mjs";
export type Selection = NonNullable<Snapshot["selected"]>;
export function savedStatus(state: string) {
  return (
    (
      {
        prepared: "Saved draft",
        uncertain: "Check transaction status",
        unobserved: "Not yet observed on devnet",
        observed: "Observed on devnet",
        historical: "Transferred or already spent",
        conflicted: "Conflicting creation or claim",
      } as Record<string, string>
    )[state] ?? "Check status"
  );
}
export function nextAction(item: Selection) {
  if (item.needsObservation || item.state === "uncertain") return "check";
  if (item.state === "observed") return "complete";
  if (item.state === "historical" || item.state === "conflicted")
    return "history";
  if (!item.acknowledged) return "backup";
  if (item.creationProgress?.phase === "expired") return "renew";
  if (item.creationProgress?.phase === "waiting") return "wait";
  return item.proofReady ? "submit" : "prove";
}
export function stageDescription(item: Selection) {
  const action = nextAction(item);
  if (action === "complete")
    return "Your picture was observed on devnet. It is saved in this browser’s collection; keep your recovery file too. This is an RPC observation, not guaranteed finality.";
  if (action === "history")
    return "This saved copy is no longer the current picture, or conflicts with another operation. Keep it for your records. Do not submit it again.";
  if (action === "check")
    return "Your saved picture is safe to inspect. Check devnet to find out whether the transaction completed before trying again.";
  if (action === "backup")
    return "Your picture is saved locally. It has not been created or received on devnet yet. Save the recovery file and select that exact file to continue.";
  if (action === "renew")
    return "Creation permission has expired or changed. Renew it for this same picture, then save its updated recovery file.";
  if (action === "wait")
    return `Reservation recorded — creation is not finished. Wait for ${item.creationProgress?.blocksRemaining} more devnet block(s), then check progress.`;
  if (item.kind !== "create")
    return "Claim this picture into a new secret held by you. The sender’s copy can still race until your claim is observed.";
  return item.creationProgress?.phase === "reveal"
    ? "Reservation ready. Finish creating this same picture with the second transaction."
    : "First, reserve this picture on devnet. A second transaction will finish creation.";
}

// Match the existing input bounds before asking the client or wallet to act.
export function draftProblem(input: {
  ready: boolean;
  passwordLength: number;
  create: boolean;
  account: string;
  fileSize?: number;
  name: string;
  description: string;
}) {
  if (!input.ready) return "Open your collection above before saving a draft.";
  if (input.passwordLength < 12)
    return "Enter or generate a recovery password of at least 12 characters above.";
  if (input.create && !input.account)
    return "Connect your fee wallet above before saving. MetaMask will ask you to sign the public creation details; this does not send a transaction.";
  if (input.fileSize === undefined || input.fileSize < 1)
    return input.create
      ? "Choose a PNG or JPG image before saving your draft."
      : "Choose the bearer PNG picture you received before saving your draft.";
  if (input.fileSize > (input.create ? 10 : 11) * 1024 * 1024)
    return input.create
      ? "Choose an image no larger than 10 MiB."
      : "Choose a bearer PNG no larger than 11 MiB.";
  if (input.create) {
    if (!input.name.trim()) return "Give your picture a name before saving.";
    const utf8 = new TextEncoder();
    if (utf8.encode(input.name).length > 256)
      return "Shorten your picture’s name. It must fit within 256 UTF-8 bytes; emoji and some letters use more than one byte.";
    if (utf8.encode(input.description).length > 4096)
      return "Shorten your description. It must fit within 4096 UTF-8 bytes; emoji and some letters use more than one byte.";
  }
}
