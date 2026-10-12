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
