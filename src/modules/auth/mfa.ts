import { authenticator } from "otplib";
import QRCode from "qrcode";
import { decrypt, encrypt, randomToken, sha256 } from "@/lib/crypto";

authenticator.options = { window: 1, step: 30 };

export function generateMfaSecret() {
  const secret = authenticator.generateSecret();
  return { secret, encrypted: encrypt(secret) };
}

export async function mfaQrDataUrl(email: string, secret: string): Promise<string> {
  const uri = authenticator.keyuri(email, "KATDICT SPIMP", secret);
  return QRCode.toDataURL(uri, { margin: 1, width: 220 });
}

export function verifyTotp(encryptedSecret: string, code: string): boolean {
  const clean = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(clean)) return false;
  try {
    return authenticator.verify({ token: clean, secret: decrypt(encryptedSecret) });
  } catch {
    return false;
  }
}

export function generateRecoveryCodes(n = 10): { codes: string[]; hashes: string[] } {
  const codes = Array.from({ length: n }, () => randomToken(6).replace(/[-_]/g, "x").slice(0, 10).toUpperCase());
  return { codes, hashes: codes.map((c) => sha256(c)) };
}

/** Exposed for tests. */
export function currentTotp(secret: string) {
  return authenticator.generate(secret);
}
