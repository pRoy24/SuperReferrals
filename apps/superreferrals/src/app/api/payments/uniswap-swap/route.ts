import { NextResponse } from "next/server";
import { createUniswapSwap } from "@/lib/uniswap";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const swap = await createUniswapSwap(body);
    return NextResponse.json({ swap });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Unable to create Uniswap swap transaction" },
      { status: 400 }
    );
  }
}
