import { NextResponse } from "next/server";
import { processorSessionFromCustomer, setProcessorAccountSessionCookie } from "@/lib/account-session";
import { restoreConsoleCustomer } from "@/lib/console-auth";
import {
  createOrUpdateCustomer,
  customersShareProcessorAccount
} from "@/lib/orchestrator";
import { publicCustomer, readStore } from "@/lib/store";

export async function GET() {
  const store = await readStore();
  return NextResponse.json({ customers: store.customers.map(publicCustomer) });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const sessionCustomer = await restoreConsoleCustomer(request);
    if (!sessionCustomer) {
      throw new Error("Sign in with your Samsar account before saving a storefront.");
    }
    if (body.id) {
      const store = await readStore();
      const requestedCustomer = store.customers.find((customer) => customer.id === String(body.id));
      if (!requestedCustomer || !customersShareProcessorAccount(requestedCustomer, sessionCustomer)) {
        return NextResponse.json(
          { message: "That storefront does not belong to the signed-in Samsar account." },
          { status: 403 }
        );
      }
    }
    const customer = await createOrUpdateCustomer({
      ...body,
      accountCustomerId: sessionCustomer.id
    });
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
