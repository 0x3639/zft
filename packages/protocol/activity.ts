export type ActivityKind =
  | "profile_created"
  | "profile_updated"
  | "follow"
  | "unfollow"
  | "like"
  | "unlike"
  | "published"
  | "minted"
  | "transferred";
export type ActivityEvent = {
  id: string;
  kind: ActivityKind;
  occurredAt: number | null;
  source: "public" | "chain";
  actor: { address: string; name: string } | null;
  target: { address: string; name: string } | null;
  item: {
    tokenId: string;
    title: string;
    imageHash: string;
    href: string;
  } | null;
  chain: { block: number; transaction: string } | null;
};
export type ActivityPage = {
  events: ActivityEvent[];
  nextCursor: string | null;
  state: "ready" | "guest" | "no-follows";
};
