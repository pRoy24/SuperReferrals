import { NextResponse } from "next/server";
import { bootstrap } from "@/lib/orchestrator";

export async function GET() {
  return NextResponse.json(await bootstrap());
}
