import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Private object storage abstraction.
 * - "s3": any S3-compatible service (AWS S3, Cloudflare R2, MinIO, Supabase Storage S3 API).
 *   The bucket must be PRIVATE. Downloads use short-lived presigned URLs issued
 *   only after an authorisation check.
 * - "local": development-only driver writing to ./.local-storage (refused in production).
 */
export interface StorageDriver {
  readonly name: string;
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  /** Short-lived URL for direct download, or null if the driver streams through the app. */
  signedDownloadUrl(key: string, filename: string, contentType: string, ttlSeconds: number): Promise<string | null>;
}

class LocalDriver implements StorageDriver {
  readonly name = "local";
  private root = path.join(process.cwd(), ".local-storage");
  private resolve(key: string) {
    const p = path.join(this.root, key);
    if (!p.startsWith(this.root)) throw new Error("Invalid storage key");
    return p;
  }
  async put(key: string, body: Uint8Array) {
    const p = this.resolve(key);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, body);
  }
  async get(key: string) {
    return new Uint8Array(await readFile(this.resolve(key)));
  }
  async signedDownloadUrl() {
    return null;
  }
}

class S3Driver implements StorageDriver {
  readonly name = "s3";
  private client: S3Client;
  constructor(private bucket: string) {
    this.client = new S3Client({
      region: process.env.OBJECT_STORAGE_REGION || "auto",
      endpoint: process.env.OBJECT_STORAGE_ENDPOINT || undefined,
      forcePathStyle: !!process.env.OBJECT_STORAGE_ENDPOINT,
      credentials: {
        accessKeyId: process.env.OBJECT_STORAGE_ACCESS_KEY ?? "",
        secretAccessKey: process.env.OBJECT_STORAGE_SECRET_KEY ?? "",
      },
    });
  }
  async put(key: string, body: Uint8Array, contentType: string) {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType, ServerSideEncryption: process.env.OBJECT_STORAGE_SSE === "none" ? undefined : "AES256" }));
  }
  async get(key: string) {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return new Uint8Array(await res.Body!.transformToByteArray());
  }
  async signedDownloadUrl(key: string, filename: string, contentType: string, ttlSeconds: number) {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket, Key: key, ResponseContentType: contentType,
        ResponseContentDisposition: `attachment; filename="${filename.replace(/"/g, "")}"`,
      }),
      { expiresIn: ttlSeconds },
    );
  }
}

let driver: StorageDriver | null = null;

export function getStorage(): StorageDriver {
  if (driver) return driver;
  const kind = process.env.STORAGE_DRIVER ?? "local";
  if (kind === "s3") {
    const bucket = process.env.OBJECT_STORAGE_BUCKET;
    if (!bucket) throw new Error("STORAGE_DRIVER=s3 requires OBJECT_STORAGE_BUCKET");
    driver = new S3Driver(bucket);
  } else {
    if (process.env.NODE_ENV === "production" && process.env.UNSAFE_ALLOW_LOCAL_STORAGE !== "true") throw new Error("Local file storage is disabled in production. Configure S3-compatible storage.");
    driver = new LocalDriver();
  }
  return driver;
}

export function setStorage(d: StorageDriver | null) {
  driver = d;
}
