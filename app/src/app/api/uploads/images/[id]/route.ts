import { NextResponse } from "next/server";
import { getTempImageUpload } from "@/lib/temp-image-uploads";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const upload = await getTempImageUpload(id);
  if (!upload) {
    return NextResponse.json({ message: "Uploaded image was not found or has expired." }, { status: 404 });
  }
  return new Response(new Uint8Array(upload.bytes), {
    headers: {
      "cache-control": "public, max-age=86400, immutable",
      "content-disposition": `inline; filename="${upload.fileName.replace(/"/g, "")}"`,
      "content-length": String(upload.sizeBytes),
      "content-type": upload.contentType,
      "x-superreferrals-temp-image-expires-at": upload.expiresAt
    }
  });
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
