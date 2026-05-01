import { NextResponse } from "next/server";
import { getAxlTopology } from "@/lib/axl";

export async function GET() {
  try {
    return NextResponse.json({ topology: await getAxlTopology() });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "AXL topology failed" },
      { status: 400 }
    );
  }
}
