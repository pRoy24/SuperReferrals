import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { createTempImageUpload } from "@/lib/temp-image-uploads";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const image = formData.get("image");
    if (!(image instanceof File)) {
      throw new Error("Upload an image file.");
    }
    const upload = await createTempImageUpload({
      bytes: Buffer.from(await image.arrayBuffer()),
      contentType: image.type,
      fileName: image.name,
      baseUrl: uploadBaseUrl(request)
    });
    return NextResponse.json({ upload });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Unable to upload image" },
      { status: 400 }
    );
  }
}

function uploadBaseUrl(request: Request) {
  const configured = env("APP_BASE_URL");
  if (configured) {
    return configured;
  }
  return new URL(request.url).origin;
}

export const maxDuration = 20;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
