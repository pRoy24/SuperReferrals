import { NextResponse } from "next/server";
import { getINFT } from "@/lib/store";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const inft = await getINFT(id);
  if (!inft) {
    return NextResponse.json({ message: "INFT not found" }, { status: 404 });
  }
  return NextResponse.json({ inft });
}
