import { NextResponse } from "next/server";
import { rollbackAgentJob } from "@/lib/agent-framework";
import { restoreConsoleCustomer } from "@/lib/console-auth";
import {
  customersShareProcessorAccount
} from "@/lib/orchestrator";
import { readStore } from "@/lib/store";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const sessionCustomer = await restoreConsoleCustomer(request);
    if (!sessionCustomer) {
      throw new Error("Sign in with your Samsar account before rolling back Agent Town jobs.");
    }
    const store = await readStore();
    const existingJob = store.agentJobs.find((job) => job.id === id);
    const customer = store.customers.find((item) => item.id === existingJob?.customerId);
    if (!existingJob || !customer || !customersShareProcessorAccount(customer, sessionCustomer)) {
      return NextResponse.json(
        { message: "That Agent Town job does not belong to the signed-in Samsar account." },
        { status: 403 }
      );
    }
    const job = await rollbackAgentJob(id, String(body.reason || "Manual rollback requested"));
    return NextResponse.json({ job });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Unable to roll back agent job" },
      { status: 400 }
    );
  }
}
