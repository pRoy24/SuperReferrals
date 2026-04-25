import { NextResponse } from "next/server";
import { createSubAccountForCustomer } from "@/lib/orchestrator";
import { readStore } from "@/lib/store";

export async function GET() {
  const store = await readStore();
  return NextResponse.json({ subAccounts: store.subAccounts });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const account = await createSubAccountForCustomer(body);
    return NextResponse.json({ account });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Unable to create sub-account" },
      { status: 400 }
    );
  }
}
