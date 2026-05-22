import { randomBytes } from "node:crypto";

/** GitHub-style prefixed identifier, e.g. `repo_a1b2c3...`. */
export const newId = (prefix: string): string =>
  `${prefix}_${randomBytes(9).toString("hex")}`;

/** A 40-character hex commit SHA. */
export const newSha = (): string => randomBytes(20).toString("hex");
