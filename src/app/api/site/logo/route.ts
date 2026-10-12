import { NextResponse, type NextRequest } from "next/server";
import { getLogoAsset } from "@/modules/site/content";

/** Public logo image. Versioned URLs (?v=<digest prefix>) are cached for a year; unversioned for five minutes. */
export async function GET(req: NextRequest) {
  const asset = await getLogoAsset();
  if (!asset) return new NextResponse("Not found", { status: 404, headers: { "cache-control": "no-store" } });
  const version = asset.sha256.slice(0, 16);
  const requested = req.nextUrl.searchParams.get("v");
  const cacheControl = requested === version ? "public, max-age=31536000, immutable" : "public, max-age=300";
  if (req.headers.get("if-none-match") === `"${version}"`) return new NextResponse(null, { status: 304, headers: { etag: `"${version}"`, "cache-control": cacheControl } });
  return new NextResponse(new Uint8Array(asset.bytes), {
    headers: {
      "content-type": asset.mime,
      "content-length": String(asset.sizeBytes),
      "cache-control": cacheControl,
      etag: `"${version}"`,
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'",
    },
  });
}
