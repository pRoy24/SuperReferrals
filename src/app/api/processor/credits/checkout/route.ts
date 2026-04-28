import { NextResponse } from "next/server";
import { pendingCheckoutCookie, processorAuthTokenFromRequest, setPendingCreditCheckoutCookie } from "@/lib/account-session";
import { nowIso } from "@/lib/ids";
import { appBaseUrl } from "@/lib/env";
import { restoreProcessorAuthTokenSession } from "@/lib/orchestrator";
import { createSamsarProcessorCreditCheckout } from "@/lib/samsar-processor";
import { mutateStore, readStore, upsertCustomer } from "@/lib/store";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const checkoutEmail = String(body.customerEmail || "").trim().toLowerCase();
    if (!checkoutEmail) {
      throw new Error("Email is required to purchase SuperReferrals credits.");
    }
    const requestAuthToken = processorAuthTokenFromRequest(request);
    const sessionCustomer = requestAuthToken
      ? await restoreProcessorAuthTokenSession(requestAuthToken).catch(() => undefined)
      : undefined;
    const store = await readStore();
    const customer = body.customerId
      ? store.customers.find((item) => item.id === body.customerId)
      : sessionCustomer || store.customers[0];
    const requestOrigin = requestOriginFromRequest(request);
    const checkout = await createSamsarProcessorCreditCheckout({
      amountCents: body.amountCents ?? body.amount_cents,
      appBaseUrl: requestOrigin,
      customerEmail: checkoutEmail,
      redirectUrl: `${requestOrigin}/samsar/callback`,
      metadata: {
        ...(body.metadata || {}),
        signupMode: "first_class_user",
        returnOrigin: requestOrigin,
        authRedirectUrl: `${requestOrigin}/samsar/callback`,
        storefrontPortalUrl: `${requestOrigin}/dashboard`,
        ...(customer ? { superreferralsCustomerId: customer.id } : {}),
        ...(customer?.name ? { superreferralsCustomerName: customer.name } : {}),
        superreferralsAccountEmail: checkoutEmail
      },
      webhookUrl: `${requestOrigin}/api/webhooks/processor/credits`
    });
    if (customer) {
      await mutateStore((mutableStore) => upsertCustomer(mutableStore, {
        id: customer.id,
        samsarAccount: {
          ...(customer.samsarAccount || {}),
          email: checkoutEmail,
          username: customer.samsarAccount?.username || customer.name,
          userId: customer.samsarAccount?.userId || customer.id,
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
    const response = NextResponse.json({ checkout });
    setPendingCreditCheckoutCookie(response, pendingCheckoutCookie({
      checkoutSessionId: checkout.checkoutSessionId,
      paymentIntentId: checkout.paymentIntentId,
      externalPaymentId: checkout.externalPaymentId,
      paymentStatusEndpoint: checkout.paymentStatusEndpoint,
      customerId: customer?.id,
      email: checkoutEmail,
      amountCents: checkout.amountCents,
      credits: checkout.credits,
      checkoutUrl: checkout.url
    }));
    return response;
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Unable to create processor checkout" },
      { status: 400 }
    );
  }
}

function requestOriginFromRequest(request: Request) {
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  if (forwardedHost) {
    return `${forwardedProto || "https"}://${forwardedHost}`.replace(/\/+$/, "");
  }
  return new URL(request.url).origin || appBaseUrl();
}
