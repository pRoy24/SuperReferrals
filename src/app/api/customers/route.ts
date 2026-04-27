import { NextResponse } from "next/server";
import { processorSessionFromCustomer, setProcessorAccountSessionCookie } from "@/lib/account-session";
import { createOrUpdateCustomer } from "@/lib/orchestrator";
import { publicCustomer, readStore } from "@/lib/store";

export async function GET() {
  const store = await readStore();
  return NextResponse.json({ customers: store.customers.map(publicCustomer) });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const customer = await createOrUpdateCustomer(body);
    const response = NextResponse.json({ customer: publicCustomer(customer) });
    setProcessorAccountSessionCookie(response, processorSessionFromCustomer(customer));
    return response;
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Unable to save customer" },
      { status: 400 }
    );
  }
}
