import React, { useEffect, useRef, useState } from "react";
import { type PsBridge, type Result, type PresentationReport } from "./bridge";
import {
  connectPsWallet,
  assertPsWallet,
  signPsPresentation,
  type PsWallet,
} from "./wallet";
import type { WalletChoice, WalletProvider } from "../wallet";
type Props = {
  credential: string;
  bridge: PsBridge;
  busy: boolean;
  active: (epoch: number) => void;
  run: (
    label: string,
    work: (epoch: number) => Promise<Result | void>,
    success?: string,
  ) => Promise<void>;
};
export default function PresentationControls({
  credential,
  bridge,
  busy,
  run,
  active,
}: Props) {
  const [choices, setChoices] = useState<WalletChoice[]>([]),
    [selected, setSelected] = useState("");
  const [session, setSession] = useState<PsWallet>(),
    [draft, setDraft] = useState<Result["presentation"]>();
  const [consent, setConsent] = useState(false),
    [time, setTime] = useState(Date.now());
  const held = useRef<PsWallet | undefined>(undefined);
  useEffect(() => {
    const receive = (e: Event) => {
      const d = (e as CustomEvent<WalletChoice>).detail;
      if (
        typeof d?.info?.uuid === "string" &&
        typeof d.info.name === "string" &&
        typeof d.provider?.request === "function"
      )
        setChoices((old) =>
          old.some((x) => x.info.uuid === d.info.uuid)
            ? old
            : [...old, d].slice(0, 8),
        );
    };
    window.addEventListener("eip6963:announceProvider", receive);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    const injected = (window as unknown as { ethereum?: WalletProvider })
      .ethereum;
    if (injected?.isMetaMask)
      setChoices((old) =>
        old.length
          ? old
          : [
              {
                info: {
                  uuid: "legacy-metamask",
                  name: "MetaMask",
                  rdns: "io.metamask",
                },
                provider: injected,
              },
            ],
      );
    const timer = setInterval(() => setTime(Date.now()), 1000);
    return () => {
      clearInterval(timer);
      window.removeEventListener("eip6963:announceProvider", receive);
      held.current?.disconnect();
    };
  }, []);
  const report = draft?.report,
    fresh = !!report && Math.floor(time / 1000) < report.expiresAt;
  return (
    <section className="ps-proof-controls">
      <h2>Public evidence</h2>
      <p>
        Show a credential proof and the issuer’s timestamped report. Publication
        reveals the artwork, its proof/nullifier and any signing wallet. It
        cannot reserve ownership or hide these links.
      </p>
      <label>
        Optional wallet signing key
        <select
          disabled={busy || !!session}
          value={selected}
          onChange={(e) => {
            setSelected(e.target.value);
            setDraft(undefined);
            setConsent(false);
          }}
        >
          <option value="">No wallet endorsement</option>
          {choices.map((c) => (
            <option key={c.info.uuid} value={c.info.uuid}>
              {c.info.name}
            </option>
          ))}
        </select>
      </label>
      {selected && !session && (
        <button
          disabled={busy}
          onClick={() =>
            void run(
              "Connecting signing wallet…",
              async (n) => {
                const c = choices.find((x) => x.info.uuid === selected);
                if (!c) throw new Error("Select a wallet.");
                const s = await connectPsWallet(c.provider);
                try {
                  active(n);
                } catch (e) {
                  s.disconnect();
                  throw e;
                }
                held.current = s;
                setSession(s);
                setDraft(undefined);
              },
              "Wallet selected for public endorsement only.",
            )
          }
        >
          Connect signing wallet
        </button>
      )}
      {session && (
        <p className="ps-hash">
          Signing address: {session.account} · chain {session.chainId}{" "}
          <button
            disabled={busy}
            onClick={() => {
              session.disconnect();
              held.current = undefined;
              setSession(undefined);
              setDraft(undefined);
              setConsent(false);
            }}
          >
            Disconnect signing wallet
          </button>
        </p>
      )}
      <button
        disabled={busy || (!!selected && !session)}
        onClick={() =>
          void run(
            "Preparing public evidence…",
            async (n) => {
              setDraft(undefined);
              setConsent(false);
              if (session) await assertPsWallet(session);
              active(n);
              const r = await bridge.call("prepare-presentation", {
                credential,
                wallet: session
                  ? session.account.slice(2).toLowerCase()
                  : "00".repeat(20),
                chainId: session?.chainId ?? 0,
              });
              active(n);
              setDraft(r.presentation);
              return r;
            },
            "Review the report before public sharing. It expires after 60 seconds.",
          )
        }
      >
        Prepare public evidence
      </button>
      {report && (
        <>
          <EvidenceReport report={report} now={Math.floor(time / 1000)} />
          {draft?.message && (
            <details>
              <summary>Exact wallet endorsement text</summary>
              <pre className="ps-endorsement-text">{draft.message}</pre>
            </details>
          )}
          {!draft?.id && (
            <>
              <label className="ps-check">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                />
                Publish this public artwork and evidence on this local issuer.
              </label>
              <button
                disabled={busy || !consent || !fresh}
                onClick={() =>
                  void run(
                    "Publishing public evidence…",
                    async (n) => {
                      let signature = null;
                      if (session) {
                        signature = await signPsPresentation(
                          session,
                          draft!.message!,
                        );
                        active(n);
                        await assertPsWallet(session);
                      }
                      active(n);
                      const r = await bridge.call("publish-presentation", {
                        signature,
                      });
                      active(n);
                      setDraft(r.presentation);
                      setConsent(false);
                      return r;
                    },
                    "Public evidence published. The link contains no bearer file.",
                  )
                }
              >
                {session
                  ? "Sign and publish evidence"
                  : "Publish without wallet endorsement"}
              </button>
            </>
          )}
          {!fresh && (
            <p>
              This report has expired. Prepare a new report before publishing.
            </p>
          )}
          {draft?.id && (
            <a
              href={"/ps/proof/" + draft.id}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open public evidence
            </a>
          )}
        </>
      )}
    </section>
  );
}
export function EvidenceReport({
  report,
  now,
}: {
  report: PresentationReport;
  now: number;
}) {
  return (
    <dl className="ps-evidence">
      <dt>Credential proof</dt>
      <dd>{report.credentialValid ? "Verified" : "Unverified"}</dd>
      <dt>Wallet signing key</dt>
      <dd>
        {report.walletSigningKeyValid ? "Signature verified" : "Not endorsed"}.
        Contract-wallet validity is not checked.
      </dd>
      <dt>Issuer report</dt>
      <dd>
        Reported {report.issuerReported} at{" "}
        {new Date(report.observedAt * 1000).toISOString()}.{" "}
        {now >= report.expiresAt
          ? "Historical — interval expired."
          : "Within its 60-second observation interval."}{" "}
        This is a snapshot, not a reservation or guaranteed current ownership.
      </dd>
    </dl>
  );
}
