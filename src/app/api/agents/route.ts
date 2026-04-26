import { NextResponse } from "next/server";
import { getAgentConsoleSnapshot, runAgentTownSimulation } from "@/lib/agent-framework";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const snapshot = await getAgentConsoleSnapshot(url.searchParams.get("customerId") || undefined);
    return NextResponse.json(snapshot);
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Unable to load agents" },
      { status: 400 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const result = await runAgentTownSimulation(body);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Unable to run agent job" },
      { status: 400 }
    );
  }
}
