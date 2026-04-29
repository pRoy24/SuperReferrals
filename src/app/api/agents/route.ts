import { NextResponse } from "next/server";
import { getAgentConsoleSnapshot, runAgentTownSimulation } from "@/lib/agent-framework";
import { restoreConsoleCustomer } from "@/lib/console-auth";
import {
  customersShareProcessorAccount
} from "@/lib/orchestrator";
import { readStore } from "@/lib/store";

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
    const sessionCustomer = await restoreConsoleCustomer(request);
    if (!sessionCustomer) {
      throw new Error("Sign in with your Samsar account before running Agent Town.");
    }
    const store = await readStore();
    const customer = store.customers.find((item) => item.id === String(body.customerId || ""));
    if (!customer || !customersShareProcessorAccount(customer, sessionCustomer)) {
      return NextResponse.json(
        { message: "That storefront does not belong to the signed-in Samsar account." },
        { status: 403 }
      );
    }
    const result = await runAgentTownSimulation({
      ...body,
      customerId: customer.id
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Unable to run agent job" },
      { status: 400 }
    );
  }
}
