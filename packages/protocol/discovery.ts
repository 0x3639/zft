import type { Metadata } from "./index";
export const searchKey = (value: string) =>
  value.normalize("NFKC").toLowerCase().trim();
export type DiscoveredItem = {
  tokenId: string;
  metadataHash: string;
  metadata: Metadata;
  owner: string;
  nonce: string;
  mintBlock: number;
  href: string;
};
export type CollectionEntry = {
  avatar?: string | null;
  cover?: string | null;
  address: string;
  name: string;
  createdAt: number | null;
  collected: number;
  followers: number;
  likes: number;
  liked: boolean;
  preview: DiscoveredItem | null;
};
export type DiscoveryPage<T> = {
  items: T[];
  nextCursor: string | null;
  total: number;
  pending: number;
};
