import { NextResponse } from "next/server";
import { receiveAxlMessages } from "@/lib/axl";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit") || 25);
    return NextResponse.json({ inbox: await receiveAxlMessages(limit) });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "AXL receive failed" },
      { status: 400 }
    );
  }
}
