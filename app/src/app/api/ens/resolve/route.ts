import { NextResponse } from "next/server";
import { resolveEnsName, reverseResolveEnsAddress } from "@/lib/ens";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (body.address) {
      const result = await reverseResolveEnsAddress(String(body.address || ""), {
        network: String(body.network || ""),
        chainId: Number(body.chainId) || undefined
      });
      return NextResponse.json({ result });
    }
    const result = await resolveEnsName(String(body.name || ""), {
      network: String(body.network || ""),
      chainId: Number(body.chainId) || undefined
    });
    return NextResponse.json({ result });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "ENS resolve failed" },
      { status: 400 }
    );
  }
}
