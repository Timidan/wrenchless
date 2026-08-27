import {
  createDevicePasskey,
  type DevicePasskey,
  verifyDevicePasskey,
} from "../../adapters/device-passkey";
import { readSettings, writeSettings } from "../../adapters/settings";
import { unlockTravelSafeTicketStorage } from "../../lib/refill-ticket";

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
  });
}
