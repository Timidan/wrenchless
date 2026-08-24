import {
  coverEnrollment,
  type HubSettings,
} from "../adapters/settings.js";
import {
  readVaultControlKey,
  resolveRestorePause,
  retrieveRestorePauseCommands,
  type RestorePauseState,
} from "./vault-control.js";

export async function assertNewRestoreAllowed(input: {
  settings: HubSettings;
}): Promise<RestorePauseState> {
  if (
    input.settings.controlInboxId === null ||
    input.settings.controlInboxReceiveCapability === null
  ) {
    throw new Error("Finish guardian pairing before sending a restore.");
  }
  const key = await readVaultControlKey();
  if (key === null) {
    throw new Error("This device cannot verify whether restores are paused.");
  }
  const enrollment = coverEnrollment(input.settings);
  if (enrollment === null) {
    throw new Error("Finish guardian pairing before sending a restore.");
  }
  const commands = await retrieveRestorePauseCommands({
    mailboxUrl: input.settings.mailboxUrl,
    mailboxId: input.settings.controlInboxId,
    receiveCapability: input.settings.controlInboxReceiveCapability,
    controlPrivateKey: key.privateKey,
    guardianPublicKey: enrollment.guardianPublicKey,
  });
  const state = resolveRestorePause(commands, input.settings.pauseLiftedAt);
  if (state.active) {
    throw new Error("New restores are paused.");
  }
  return state;
}
