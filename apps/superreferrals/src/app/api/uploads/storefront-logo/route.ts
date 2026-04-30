import { NextResponse } from "next/server";
import { restoreConsoleCustomer } from "@/lib/console-auth";
import { env } from "@/lib/env";
import { createTempImageUpload } from "@/lib/temp-image-uploads";

export async function POST(request: Request) {
  try {
    const sessionCustomer = await restoreConsoleCustomer(request);
    if (!sessionCustomer) {
      throw new Error("Sign in with your Samsar account before uploading a storefront logo.");
    }
    const formData = await request.formData();
    const image = formData.get("image");
    if (!(image instanceof File)) {
      throw new Error("Upload a logo image file.");
    }
    const upload = await createTempImageUpload({
      bytes: Buffer.from(await image.arrayBuffer()),
      contentType: image.type,
      fileName: image.name,
      baseUrl: uploadBaseUrl(request),
      ttlSeconds: null
    });
    return NextResponse.json({ upload });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Unable to upload storefront logo" },
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
