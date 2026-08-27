import { z } from "zod";

import type { BrowserWallet } from "./wallet";

const STARKNET_MAINNET = "starknet:SNMAIN";
const STARKNET_MAINNET_FELT = "0x534e5f4d41494e";
const READY_WALLET_API_VERSION = "0.10.3";

export const READY_MOBILE_METHODS = [
  "starknet_account",
  "starknet_signTypedData",
  "wallet_supportedWalletApi",
  "wallet_strk20Balances",
  "wallet_strk20PrepareInvoke",
  "wallet_strk20InvokeTransaction",
] as const;

const READY_MOBILE_EVENTS = ["accountsChanged", "chainChanged"] as const;

const sessionSchema = z.object({
  topic: z.string().min(1),
  namespaces: z.object({
    starknet: z.object({
      accounts: z.array(z.string().min(1)).min(1),
      methods: z.array(z.string()),
      events: z.array(z.string()),
    }),
  }),
});

const jsonValueSchema = z.json();

export type MobileSession = z.infer<typeof sessionSchema>;
export type MobileJsonValue = z.infer<typeof jsonValueSchema>;

export type MobileConnectInput = {
  requiredNamespaces: {
    starknet: {
      chains: string[];
      methods: string[];
      events: string[];
    };
  };
};

export type MobileRequestInput = {
  topic: string;
  chainId: string;
  request: { method: string; params?: MobileJsonValue };
};

export type ReadyMobileClient = {
  session: { getAll(): MobileSession[] };
  connect(input: MobileConnectInput): Promise<{
    uri: string | undefined;
    approval(): Promise<MobileSession>;
  }>;
  request(input: MobileRequestInput): Promise<MobileJsonValue>;
};

export type ReadyMobileClientFactory = (input: {
  projectId: string;
  metadata: {
    name: string;
    description: string;
    url: string;
    icons: string[];
  };
}) => Promise<ReadyMobileClient>;

const typedDataSchema = z
  .object({ api_version: z.string().optional() })
  .passthrough();

const signatureResultSchema = z.union([
  z.array(z.string()),
  z.object({ signature: z.array(z.string()) }),
]);

function accountFromSession(session: MobileSession): string {
  const accountId = session.namespaces.starknet.accounts[0];
  const parts = accountId?.split(":") ?? [];
  const address = parts[2];
  if (
    parts.length !== 3 ||
    parts[0] !== "starknet" ||
    parts[1] !== "SNMAIN" ||
    address === undefined ||
    !/^0x[0-9a-fA-F]+$/.test(address)
  ) {
    throw new Error("Ready returned an invalid Starknet mainnet account");
  }
  return address;
}

function supportsPrivateActions(session: MobileSession): boolean {
  const methods = new Set(session.namespaces.starknet.methods);
  return READY_MOBILE_METHODS.every((method) => methods.has(method));
}

function reusableSession(candidates: readonly MobileSession[]): MobileSession | null {
  for (const candidate of candidates) {
    if (!supportsPrivateActions(candidate)) continue;
    try {
      accountFromSession(candidate);
      return candidate;
    } catch {
      continue;
    }
  }
  return null;
}

async function createReadyMobileClient(input: {
  projectId: string;
  metadata: {
    name: string;
    description: string;
    url: string;
    icons: string[];
  };
}): Promise<ReadyMobileClient> {
  const { default: SignClient } = await import("@walletconnect/sign-client");
  const client = await SignClient.init(input);
  return {
    session: {
      getAll: () =>
        client.session.getAll().flatMap((candidate) => {
          const parsed = sessionSchema.safeParse(candidate);
          return parsed.success ? [parsed.data] : [];
        }),
    },
    async connect(connectInput) {
      const connected = await client.connect(connectInput);
      return {
        uri: connected.uri,
        approval: async () => sessionSchema.parse(await connected.approval()),
      };
    },
    async request(requestInput) {
      return jsonValueSchema.parse(await client.request({
        ...requestInput,
        request: {
          ...requestInput.request,
          params: requestInput.request.params ?? {},
        },
      }));
    },
  };
}

export async function connectReadyMobileWallet(input: {
  projectId: string;
  applicationUrl: string;
  createClient?: ReadyMobileClientFactory;
  openUrl(url: string): void;
}): Promise<{ wallet: BrowserWallet; account: string }> {
  const projectId = input.projectId.trim();
  if (projectId.length === 0) {
    throw new Error("Mobile wallet connection is not configured");
  }
  const applicationUrl = new URL(input.applicationUrl).origin;
  const client = await (input.createClient ?? createReadyMobileClient)({
    projectId,
    metadata: {
      name: "Wrenchless",
      description: "Private trip allowance for STRK and USDC on Starknet",
      url: applicationUrl,
      icons: [new URL("/favicon.svg", applicationUrl).toString()],
    },
  });
  let session = reusableSession(client.session.getAll());
  if (session === null) {
    const { uri, approval } = await client.connect({
      requiredNamespaces: {
        starknet: {
          chains: [STARKNET_MAINNET],
          events: [...READY_MOBILE_EVENTS],
          methods: [...READY_MOBILE_METHODS],
        },
      },
    });
    if (uri === undefined) {
      throw new Error("Ready did not provide a mobile connection link");
    }
    input.openUrl(`ready://wc?uri=${encodeURIComponent(uri)}`);
    session = sessionSchema.parse(await approval());
    if (!supportsPrivateActions(session)) {
      throw new Error("Ready mobile did not approve private actions");
    }
  }
  const account = accountFromSession(session);
  const wallet: BrowserWallet = {
    id: "ready-mobile",
    name: "Ready Wallet",
    selectedAddress: account,
    async request<T>(request: {
      params?: unknown;
      type: string;
    }): Promise<T> {
      if (request.type === "wallet_requestAccounts") {
        // SAFETY: wallet_requestAccounts is specified to return an address array.
        return [account] as T;
      }
      if (request.type === "wallet_requestChainId") {
        // SAFETY: wallet_requestChainId is specified to return the chain felt.
        return STARKNET_MAINNET_FELT as T;
      }
      if (request.type === "wallet_supportedWalletApi") {
        // SAFETY: the approved private methods establish this Wallet API version.
        return [READY_WALLET_API_VERSION] as T;
      }
      let method = request.type;
      let params: MobileJsonValue | undefined;
      if (request.type === "wallet_signTypedData") {
        method = "starknet_signTypedData";
        const typedData = { ...typedDataSchema.parse(request.params) };
        delete typedData.api_version;
        params = jsonValueSchema.parse({ accountAddress: account, typedData });
      } else if (request.params !== undefined) {
        params = jsonValueSchema.parse(request.params);
      }
      if (!session.namespaces.starknet.methods.includes(method)) {
        throw new Error(`Ready mobile did not approve ${request.type}`);
      }
      input.openUrl("ready://");
      const remoteRequest: MobileRequestInput["request"] = { method };
      if (params !== undefined) remoteRequest.params = params;
      const result = await client.request({
        topic: session.topic,
        chainId: STARKNET_MAINNET,
        request: remoteRequest,
      });
      if (request.type === "wallet_signTypedData") {
        const signature = signatureResultSchema.parse(result);
        // SAFETY: wallet_signTypedData is specified to return the signature array.
        return (Array.isArray(signature) ? signature : signature.signature) as T;
      }
      // SAFETY: callers bind T to the documented result for the named wallet method.
      return result as T;
    },
  };
  return { wallet, account };
}
