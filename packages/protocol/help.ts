export type HelpView = "basics" | "cryptography";
export const HELP_VIEWS = {
  basics: {
    title: "Keep it. Pass it on.",
    description:
      "Learn to mint, send and receive ZFT collectibles, keep file keys safe, and recover your collection on ZVM devnet.",
    label: "How it works",
    subtitle: "MINT / SEND / CLAIM / RECOVER",
  },
  cryptography: {
    title: "The picture. The key. The proof.",
    description:
      "How ZFT hashes pictures, signs ownership changes, verifies public proofs and protects local file keys on ZVM devnet.",
    label: "Technical guide",
    subtitle: "SHA-256 / EIP-712 / ZVM",
  },
} as const;

/** Normalize both help aliases without carrying unrelated query data into shares. */
export function helpPage(url: URL) {
  if (!["/about", "/how-it-works"].includes(url.pathname)) return null;
  const view: HelpView =
    url.searchParams.get("view") === "cryptography" ? "cryptography" : "basics";
  return {
    view,
    path: `/how-it-works${view === "cryptography" ? "?view=cryptography" : ""}`,
    imagePath: `/api/og/page/how-it-works${view === "cryptography" ? "-technical" : ""}.png`,
    ...HELP_VIEWS[view],
  };
}
