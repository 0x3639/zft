export type Pins = {
  chainId: string;
  contracts: { registry: { address: `0x${string}` } };
} & Record<string, unknown>;
export type Configuration = {
  format: string;
  pins: Pins;
  rpc: string;
  artifacts: Record<string, { url: string; bytes: number; sha256: string }>;
};
export type Wallet = {
  address: string;
  assertCurrent(): Promise<void>;
  signCreation(value: unknown): Promise<string>;
  send(name: string, args: unknown[]): Promise<string>;
  close(): void;
};
export type Provider = {
  request(value: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(name: string, listener: () => void): void;
  removeListener?(name: string, listener: () => void): void;
};
export type Prover = {
  prove(
    name: string,
    input: unknown,
    config: Configuration,
  ): Promise<{ publicSignals: string[]; proof: unknown }>;
  cancel(): void;
};
export type Snapshot = {
  busy: boolean;
  operations: {
    id: string;
    state: string;
    acknowledged: boolean;
    attempts: number;
    transactionHashes: string[];
  }[];
  selected: null | {
    id: string;
    kind: string;
    name: string;
    assetId: string;
    imageHash: string;
    state: string;
    acknowledged: boolean;
    proofReady: boolean;
    needsObservation: boolean;
    creationProgress?: {
      phase: "commit" | "waiting" | "reveal" | "expired";
      blocksRemaining: number;
    };
    image: Uint8Array;
  };
};
export type ShieldedClient = {
  config: Configuration;
  configurationId: string;
  snapshot(): Promise<Snapshot>;
  setWallet(wallet: Wallet): void;
  prepareCreate(
    bytes: Uint8Array,
    name: string,
    description: string,
    password: string,
  ): Promise<void>;
  prepareClaim(bytes: Uint8Array, password: string): Promise<void>;
  exportRecovery(): Promise<string>;
  acknowledge(text: string, password: string): Promise<void>;
  restore(text: string, password: string): Promise<boolean>;
  inspect(
    id: string,
    password: string,
  ): Promise<{ id: string; name: string; image: Uint8Array }>;
  unlock(id: string, password: string): Promise<void>;
  observe(password: string): Promise<string>;
  renewCreation(password: string): Promise<void>;
  prove(): Promise<void>;
  submit(
    password: string,
  ): Promise<{ phase: string; state: string; hash: string }>;
  exportBearer(password: string): Promise<Uint8Array>;
  exportPublic(): Promise<Uint8Array>;
  exportPublication(): Promise<import("./public").Publication>;
  cancelProof(): void;
  close(): void;
};
export function parseConfiguration(text: string, origin: string): Configuration;
export function configurationId(config: unknown): string;
export function connectWallet(provider: Provider, pins: Pins): Promise<Wallet>;
export function createShieldedClient(options: {
  text: string;
  origin: string;
  prover: Prover;
  indexedDB?: IDBFactory;
}): Promise<ShieldedClient>;
export const MESSAGES: Readonly<
  Record<"unavailable" | "busy" | "closed", string>
>;
