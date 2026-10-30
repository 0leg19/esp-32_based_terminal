// Signed OTA: an ECDSA P-256 key pair kept in app/data. The public key is
// compiled into the firmware (OTA_PUBLIC_KEY_PEM in api_task.cpp); every
// image is signed with the private key (SHA-256, DER) before upload.

import crypto from "node:crypto";

import { readText, writeText } from "./store.ts";

const PRIVATE = "ota_private.pem";
const PUBLIC = "ota_public.pem";

export function otaPublicKey(): string | null {
  return readText(PUBLIC);
}

export function otaGenerateKeys(overwrite: boolean): string {
  if (readText(PRIVATE) && !overwrite) throw new Error("keys_exist");
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  writeText(PRIVATE, privateKey, true);
  writeText(PUBLIC, publicKey);
  return publicKey;
}

/** Hex of the DER-encoded signature, as the terminal expects in X-Signature. */
export function otaSign(image: Buffer): string {
  const key = readText(PRIVATE);
  if (!key) throw new Error("no_keys");
  return crypto.sign("sha256", image, { key, dsaEncoding: "der" }).toString("hex");
}

/** The public key as a C string literal for api_task.cpp. */
export function otaPublicKeyC(pem: string): string {
  const lines = pem.trim().split("\n").map((l) => `    "${l}\\n"`);
  return `static const char OTA_PUBLIC_KEY_PEM[] =\n${lines.join("\n")};`;
}
