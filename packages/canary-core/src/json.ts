import { z } from "zod";

export type JsonObject = {
  readonly [key: string]: JsonValue;
};

export type JsonValue =
  | boolean
  | null
  | number
  | string
  | JsonObject
  | readonly JsonValue[];

export const jsonValueSchema = z.json();

export function parseJsonText(text: string): JsonValue {
  return jsonValueSchema.parse(JSON.parse(text));
}
