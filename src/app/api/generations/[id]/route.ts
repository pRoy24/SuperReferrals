import { NextResponse } from "next/server";
import { getGeneration } from "@/lib/store";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const generation = await getGeneration(id);
  if (!generation) {
    return NextResponse.json({ message: "generation not found" }, { status: 404 });
  }
  return NextResponse.json({ generation });
}
