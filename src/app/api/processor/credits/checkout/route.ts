import { NextResponse } from "next/server";
import { nowIso } from "@/lib/ids";
import { appBaseUrl, env } from "@/lib/env";
import {
  buildCustomerSamsarExternalUser,
  createSamsarProcessorCreditCheckout
} from "@/lib/samsar-processor";
import { mutateStore, readStore, upsertCustomer } from "@/lib/store";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const checkoutEmail = String(body.customerEmail || "").trim().toLowerCase();
    const store = await readStore();
    const customer = body.customerId
      ? store.customers.find((item) => item.id === body.customerId)
      : store.customers[0];
    const internalApiKey = env("SAMSAR_API_KEY") || undefined;
    const parentApiKey = internalApiKey || customer?.samsarAccount?.apiKey;
    const externalUser = customer && checkoutEmail && parentApiKey
      ? buildCustomerSamsarExternalUser(customer, checkoutEmail)
      : undefined;
    const checkout = await createSamsarProcessorCreditCheckout({
      amountCents: body.amountCents ?? body.amount_cents,
      apiKey: parentApiKey,
      authToken: parentApiKey ? undefined : customer?.samsarAccount?.authToken,
      customerEmail: checkoutEmail || undefined,
      externalUser,
      metadata: {
        ...(body.metadata || {}),
        ...(customer ? { superreferralsCustomerId: customer.id } : {}),
        ...(customer?.name ? { superreferralsCustomerName: customer.name } : {}),
        ...(checkoutEmail ? { superreferralsAccountEmail: checkoutEmail } : {})
      },
      webhookUrl: `${appBaseUrl()}/api/webhooks/processor/credits`
    });
    if (customer) {
      await mutateStore((mutableStore) => upsertCustomer(mutableStore, {
        id: customer.id,
        samsarAccount: {
          ...(customer.samsarAccount || {}),
          email: checkoutEmail || customer.samsarAccount?.email,
          username: customer.samsarAccount?.username || customer.name,
          userId: customer.samsarAccount?.userId || customer.id,
          externalProvider: customer.samsarAccount?.externalProvider,
          externalUserId: customer.samsarAccount?.externalUserId,
          apiKey: customer.samsarAccount?.apiKey,
          checkoutSessionId: checkout.checkoutSessionId,
          checkoutUrl: checkout.url,
          paymentStatusEndpoint: checkout.paymentStatusEndpoint,
          externalPaymentId: checkout.externalPaymentId || customer.samsarAccount?.externalPaymentId,
          updatedAt: nowIso()
        },
        subscription: {
          status: Number(customer.subscription.creditsRemaining || 0) > 0
            ? "active"
            : "not_started",
          creditsRemaining: customer.subscription.creditsRemaining ?? 0
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
