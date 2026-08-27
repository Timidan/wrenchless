import {
  createDevicePasskey,
  devicePasskeysAvailable,
  type DevicePasskey,
  verifyDevicePasskey,
} from "../../adapters/device-passkey";
import {
  requestWalletAccount,
  type BrowserWallet,
} from "../../adapters/wallet";
import { readSettings, writeSettings } from "../../adapters/settings";
import { unlockTravelSafeTicketStorage } from "../../lib/refill-ticket";
import {
  confirmTravelSafeWalletAccess,
  selectTravelSafeDeviceAccess,
} from "./travel-safe-wallet-access";

type ConnectedWallet = {
  wallet: BrowserWallet;
  account: string;
};

export function travelSafePasskey(): DevicePasskey | null {
  const settings = readSettings();
  if (
    settings.devicePasskeyId === null ||
    settings.devicePasskeyPublicKey === null
  ) {
    return null;
  }
  return {
    credentialId: settings.devicePasskeyId,
    publicKey: settings.devicePasskeyPublicKey,
  };
}

export async function unlockTravelSafeWithPasskey(
  passkey: DevicePasskey,
  allowLocalKeyCreation = false,
): Promise<void> {
  const verification = await verifyDevicePasskey(passkey);
  await unlockTravelSafeTicketStorage(
    verification.prfSecret,
    allowLocalKeyCreation,
  );
}

export async function createOrVerifyTravelSafePasskey(
  account: string,
): Promise<void> {
  const existing = travelSafePasskey();
  if (existing !== null) {
    await unlockTravelSafeWithPasskey(
      existing,
      readSettings().activeSafeStateId === null,
    );
    return;
  }
  const created = await createDevicePasskey(`Travel Safe ${account.slice(0, 8)}`);
  await unlockTravelSafeWithPasskey(created, true);
  writeSettings({
    devicePasskeyId: created.credentialId,
    devicePasskeyPublicKey: created.publicKey,
    deviceWalletAccount: null,
  });
}

export async function createOrVerifyTravelSafeDeviceAccess(
  connected: ConnectedWallet,
): Promise<"passkey" | "wallet"> {
  const method = selectTravelSafeDeviceAccess(devicePasskeysAvailable());
  if (method === "passkey") {
    await createOrVerifyTravelSafePasskey(connected.account);
    return method;
  }
  const account = await confirmTravelSafeWalletAccess(
    connected.wallet,
    connected.account,
  );
  await unlockTravelSafeTicketStorage(
    null,
    readSettings().activeSafeStateId === null,
  );
  writeSettings({
    devicePasskeyId: null,
    devicePasskeyPublicKey: null,
    deviceWalletAccount: account,
  });
  return method;
}

export async function unlockTravelSafeDeviceAccess(
  connected?: ConnectedWallet,
): Promise<ConnectedWallet | null> {
  const passkey = travelSafePasskey();
  if (passkey !== null && devicePasskeysAvailable()) {
    await unlockTravelSafeWithPasskey(passkey);
    return null;
  }
  const expectedAccount = readSettings().deviceWalletAccount;
  if (expectedAccount === null) {
    throw new Error(
      "This browser cannot open this Travel Safe. Use your recovery words instead.",
    );
  }
  const active = connected ?? (await requestWalletAccount());
  await confirmTravelSafeWalletAccess(active.wallet, expectedAccount);
  await unlockTravelSafeTicketStorage(null);
  return active;
}
