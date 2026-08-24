import { useSyncExternalStore } from "react";
import { z } from "zod";

import { WRENCHLESS_SERVICES } from "../lib/product-config";

const STORAGE_KEY = "wrenchless.hub-settings.v3";
const LEGACY_STORAGE_KEY = "wrenchless.hub-settings.v2";

const feltSchema = z.string().regex(/^0x[0-9a-fA-F]+$/);

const settingsSchema = z
  .object({
    schemaVersion: z.literal("wrenchless.hub-settings.v3"),
    sponsorUrl: z.string().url(),
    devicePasskeyId: z.string().nullable(),
    devicePasskeyPublicKey: z.string().nullable(),
    activeSafeStateId: feltSchema.nullable(),
  })
  .strict();

const transitionalSettingsSchema = settingsSchema
  .extend({ legacyRecoveryStateIds: z.array(feltSchema).max(24) })
  .strict();

const legacySettingsSchema = z
  .object({
    sponsorUrl: z.string().url().optional(),
    devicePasskeyId: z.string().nullable().optional(),
    devicePasskeyPublicKey: z.string().nullable().optional(),
    refillStateIds: z.array(feltSchema).max(24).optional(),
  })
  .passthrough();

export type HubSettings = z.infer<typeof settingsSchema>;

const EMPTY: HubSettings = {
  schemaVersion: "wrenchless.hub-settings.v3",
  sponsorUrl: WRENCHLESS_SERVICES.sponsorUrl,
  devicePasskeyId: null,
  devicePasskeyPublicKey: null,
  activeSafeStateId: null,
};

function parseStored(value: string | null): {
  settings: HubSettings;
  strippedUnusedData: boolean;
} | null {
  if (value === null) return null;
  try {
    const json = JSON.parse(value);
    const parsed = settingsSchema.safeParse(json);
    if (parsed.success) {
      return { settings: parsed.data, strippedUnusedData: false };
    }
    const transitional = transitionalSettingsSchema.safeParse(json);
    if (!transitional.success) return null;
    const {
      legacyRecoveryStateIds: _discarded,
      ...settings
    } = transitional.data;
    return {
      settings: settingsSchema.parse(settings),
      strippedUnusedData: true,
    };
  } catch {
    return null;
  }
}

function migrateLegacy(value: string | null): HubSettings | null {
  if (value === null) return null;
  try {
    const parsed = legacySettingsSchema.safeParse(JSON.parse(value));
    if (!parsed.success) return null;
    return settingsSchema.parse({
      ...EMPTY,
      sponsorUrl: parsed.data.sponsorUrl ?? EMPTY.sponsorUrl,
      devicePasskeyId: parsed.data.devicePasskeyId ?? null,
      devicePasskeyPublicKey: parsed.data.devicePasskeyPublicKey ?? null,
    });
  } catch {
    return null;
  }
}

function load(): HubSettings {
  const current = parseStored(localStorage.getItem(STORAGE_KEY));
  if (current !== null) {
    if (current.strippedUnusedData) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(current.settings));
    }
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    return current.settings;
  }
  const migrated = migrateLegacy(localStorage.getItem(LEGACY_STORAGE_KEY));
  if (migrated === null) return EMPTY;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
  // Successful migration deliberately strips old bearer capabilities.
  localStorage.removeItem(LEGACY_STORAGE_KEY);
  return migrated;
}

let snapshot: HubSettings = EMPTY;
let loaded = false;
const listeners = new Set<() => void>();

function current(): HubSettings {
  if (!loaded) {
    snapshot = load();
    loaded = true;
  }
  return snapshot;
}

export function writeSettings(
  patch: Partial<Omit<HubSettings, "schemaVersion">>,
): void {
  snapshot = settingsSchema.parse({ ...current(), ...patch });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useSettings(): HubSettings {
  return useSyncExternalStore(subscribe, current, () => EMPTY);
}

export function readSettings(): HubSettings {
  return current();
}
