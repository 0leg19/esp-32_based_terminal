// Signatures must verify the way the firmware checks them: ECDSA P-256,
// SHA-256 over the whole image, DER-encoded, sent as hex.

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

process.env.NFC_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "nfc-tm-ota-"));
const { otaGenerateKeys, otaPublicKey, otaPublicKeyC, otaSign } = await import("./ota.ts");

after(() => fs.rmSync(process.env.NFC_DATA_DIR!, { recursive: true, force: true }));

test("no key until one is generated; no silent overwrite", () => {
  assert.equal(otaPublicKey(), null);
  assert.throws(() => otaSign(Buffer.from("x")), /no_keys/);
  otaGenerateKeys(false);
  assert.throws(() => otaGenerateKeys(false), /keys_exist/);
});

test("signature verifies with the public key (DER, SHA-256)", () => {
  const image = crypto.randomBytes(300_000);
  image[0] = 0xe9;
  const sig = Buffer.from(otaSign(image), "hex");
  const pub = otaPublicKey()!;
  assert.ok(crypto.verify("sha256", image, { key: pub, dsaEncoding: "der" }, sig));
  image[1000] ^= 1;
  assert.ok(!crypto.verify("sha256", image, { key: pub, dsaEncoding: "der" }, sig));
  assert.ok(sig.length <= 80, "fits the firmware's 80-byte signature buffer");
});

test("C literal reproduces the PEM exactly", () => {
  const pem = otaPublicKey()!;
  const c = otaPublicKeyC(pem);
  assert.match(c, /^static const char OTA_PUBLIC_KEY_PEM\[\] =\n/);
  const literal = [...c.matchAll(/"([^"]*)"/g)].map((m) => m[1].replace(/\\n/g, "\n")).join("");
  assert.equal(literal, pem.trim() + "\n");
});
