// Test-server PKI: a long-lived local CA plus a server certificate for this
// computer's LAN addresses. The terminal is provisioned with the CA
// (ca_cert), so the server certificate can be re-issued whenever the
// addresses change without re-provisioning the terminal.

import crypto from "node:crypto";
import forge from "node-forge";

import { lanInterfaces, readJson, readText, writeJson, writeText } from "./store.ts";

export interface ServerCredentials {
  key: string;
  cert: string;
  caCert: string;
  names: string[];
}

const CA_KEY = "ca.key";
const CA_CERT = "ca.crt";
const SERVER_KEY = "server.key";
const SERVER_CERT = "server.crt";
const SERVER_META = "server.json";

function rsaKeyPair(): { privatePem: string; publicPem: string } {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  return { privatePem: privateKey, publicPem: publicKey };
}

function serialNumber(): string {
  // Positive, 16 bytes.
  const bytes = crypto.randomBytes(16);
  bytes[0] &= 0x7f;
  return bytes.toString("hex");
}

function years(from: Date, n: number): Date {
  const d = new Date(from);
  d.setFullYear(d.getFullYear() + n);
  return d;
}

function loadOrCreateCa(): { key: forge.pki.rsa.PrivateKey; cert: forge.pki.Certificate; pem: string } {
  const keyPem = readText(CA_KEY);
  const certPem = readText(CA_CERT);
  if (keyPem && certPem) {
    return { key: forge.pki.privateKeyFromPem(keyPem) as forge.pki.rsa.PrivateKey, cert: forge.pki.certificateFromPem(certPem), pem: certPem };
  }

  const { privatePem, publicPem } = rsaKeyPair();
  const cert = forge.pki.createCertificate();
  cert.publicKey = forge.pki.publicKeyFromPem(publicPem);
  cert.serialNumber = serialNumber();
  const now = new Date();
  cert.validity.notBefore = new Date(now.getTime() - 24 * 3600 * 1000);
  cert.validity.notAfter = years(now, 20);
  const subject = [
    { name: "commonName", value: "NFC Terminal Manager Test CA" },
    { name: "organizationName", value: "0leg19" },
  ];
  cert.setSubject(subject);
  cert.setIssuer(subject);
  cert.setExtensions([
    { name: "basicConstraints", cA: true, critical: true },
    { name: "keyUsage", keyCertSign: true, cRLSign: true, critical: true },
    { name: "subjectKeyIdentifier" },
  ]);
  const key = forge.pki.privateKeyFromPem(privatePem) as forge.pki.rsa.PrivateKey;
  cert.sign(key, forge.md.sha256.create());
  const pem = forge.pki.certificateToPem(cert);
  writeText(CA_KEY, privatePem, true);
  writeText(CA_CERT, pem);
  return { key, cert, pem };
}

function issueServerCert(
  ca: { key: forge.pki.rsa.PrivateKey; cert: forge.pki.Certificate },
  names: string[],
): { keyPem: string; certPem: string } {
  const { privatePem, publicPem } = rsaKeyPair();
  const cert = forge.pki.createCertificate();
  cert.publicKey = forge.pki.publicKeyFromPem(publicPem);
  cert.serialNumber = serialNumber();
  const now = new Date();
  cert.validity.notBefore = new Date(now.getTime() - 24 * 3600 * 1000);
  cert.validity.notAfter = years(now, 10);
  cert.setSubject([{ name: "commonName", value: names[0] }]);
  cert.setIssuer(ca.cert.subject.attributes);
  // Every IP address goes in both as iPAddress and as dNSName: mbedTLS
  // versions without IP SAN matching compare the host string to dNSName.
  const altNames: { type: number; value?: string; ip?: string }[] = [];
  for (const n of names) {
    if (/^\d+\.\d+\.\d+\.\d+$/.test(n)) altNames.push({ type: 7, ip: n });
    altNames.push({ type: 2, value: n });
  }
  cert.setExtensions([
    { name: "basicConstraints", cA: false },
    { name: "keyUsage", digitalSignature: true, keyEncipherment: true, critical: true },
    { name: "extKeyUsage", serverAuth: true },
    { name: "subjectAltName", altNames },
  ]);
  cert.sign(ca.key, forge.md.sha256.create());
  return { keyPem: privatePem, certPem: forge.pki.certificateToPem(cert) };
}

/** Current credentials; the server certificate is re-issued when the LAN addresses change. */
export function serverCredentials(): ServerCredentials {
  const ca = loadOrCreateCa();
  const names = [...lanInterfaces().map((i) => i.address), "localhost", "127.0.0.1"];
  const meta = readJson<{ names: string[] }>(SERVER_META, { names: [] });
  let key = readText(SERVER_KEY);
  let cert = readText(SERVER_CERT);
  if (!key || !cert || meta.names.join(",") !== names.join(",")) {
    const issued = issueServerCert(ca, names);
    key = issued.keyPem;
    cert = issued.certPem;
    writeText(SERVER_KEY, key, true);
    writeText(SERVER_CERT, cert);
    writeJson(SERVER_META, { names });
  }
  return { key, cert, caCert: ca.pem, names };
}
