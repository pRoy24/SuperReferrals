import { NextResponse } from "next/server";
import { nowIso } from "@/lib/ids";
import {
  buildCustomerSamsarExternalUser,
  createSamsarProcessorCreditCheckout,
  ensureSamsarProcessorSubAccount
} from "@/lib/samsar-processor";
import { mutateStore, readStore, upsertCustomer } from "@/lib/store";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const store = await readStore();
    const customer = body.customerId
      ? store.customers.find((item) => item.id === body.customerId)
      : store.customers[0];
    const externalUser = customer
      ? buildCustomerSamsarExternalUser(customer, body.customerEmail || customer.samsarAccount?.email)
      : undefined;
    const externalSession = externalUser
      ? await ensureSamsarProcessorSubAccount(externalUser)
      : undefined;
    const checkout = await createSamsarProcessorCreditCheckout({
      amountCents: body.amountCents ?? body.amount_cents,
      customerEmail: body.customerEmail || customer?.samsarAccount?.email,
      externalUser,
      metadata: body.metadata
    });
    if (customer) {
      await mutateStore((mutableStore) => upsertCustomer(mutableStore, {
        id: customer.id,
        samsarAccount: {
          ...(customer.samsarAccount || {}),
          email: String(body.customerEmail || customer.samsarAccount?.email || "") || undefined,
          username: customer.samsarAccount?.username || customer.name,
          userId: customer.samsarAccount?.userId || customer.id,
          externalProvider: externalUser?.provider,
          externalUserId: String(externalUser?.external_user_id || externalUser?.externalUserId || customer.id),
          apiKey: externalSession?.externalApiKey || customer.samsarAccount?.apiKey,
          checkoutSessionId: checkout.checkoutSessionId,
          checkoutUrl: checkout.url,
          paymentStatusEndpoint: checkout.paymentStatusEndpoint,
          updatedAt: nowIso()
        },
        subscription: {
          status: Number(externalSession?.creditsRemaining || customer.subscription.creditsRemaining || 0) > 0
            ? "active"
            : "not_started",
          creditsRemaining: externalSession?.creditsRemaining ?? customer.subscription.creditsRemaining ?? 0
        }
      }));
    }
    return NextResponse.json({ checkout });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Unable to create processor checkout" },
      { status: 400 }
    );
  }
}
