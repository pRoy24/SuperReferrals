import { NextResponse } from "next/server";
import {
  clearPendingCreditCheckoutCookie,
  type PendingCreditCheckoutCookie,
  processorAuthTokenFromRequest,
  processorSessionFromCustomer,
  readPendingCreditCheckoutCookie,
  readProcessorAccountSessionCookie,
  setProcessorAccountSessionCookie
} from "@/lib/account-session";
import { bootstrap, restoreProcessorAccountSession, restoreProcessorAuthTokenSession } from "@/lib/orchestrator";
import { reconcileProcessorCreditWebhook } from "@/lib/processor-credit-webhook";
import { fetchSamsarProcessorCreditCheckoutStatus } from "@/lib/samsar-processor";
import { readStore } from "@/lib/store";
import type { Customer, SuperReferralsStore } from "@/lib/types";

export async function GET(request: Request) {
  const cookieHeader = request.headers.get("cookie");
  const accountSession = readProcessorAccountSessionCookie(cookieHeader);
  const pendingCheckout = readPendingCreditCheckoutCookie(cookieHeader);
  const requestAuthToken = processorAuthTokenFromRequest(request);
  const restoredAuthCustomer = requestAuthToken && requestAuthToken !== accountSession?.authToken
    ? await restoreProcessorAuthTokenSession(requestAuthToken).catch(() => undefined)
    : undefined;
  const restoredCustomer = restoredAuthCustomer || await restoreProcessorAccountSession(accountSession);
  const pendingCheckoutCustomer = !restoredCustomer && pendingCheckout
    ? await restorePendingCreditCheckout(pendingCheckout)
    : undefined;
  const store = orderActiveCustomerFirst(
    await bootstrap(),
    restoredCustomer?.id || pendingCheckoutCustomer?.id || accountSession?.customerId || pendingCheckout?.customerId
  );
  const response = NextResponse.json(store);
  const sessionCustomer = restoredCustomer || pendingCheckoutCustomer;
  if (sessionCustomer) {
    setProcessorAccountSessionCookie(response, processorSessionFromCustomer(sessionCustomer, {
      email: pendingCheckout?.email || accountSession?.email || sessionCustomer.samsarAccount?.email,
      authToken: requestAuthToken || accountSession?.authToken,
      refreshToken: accountSession?.refreshToken || sessionCustomer.samsarAccount?.refreshToken,
      expiryDate: accountSession?.expiryDate || sessionCustomer.samsarAccount?.expiryDate,
      refreshTokenExpiresAt: accountSession?.refreshTokenExpiresAt || sessionCustomer.samsarAccount?.refreshTokenExpiresAt,
      appKeyHash: sessionCustomer.samsarAccount?.appKeyHash || accountSession?.appKeyHash,
      appKeyPrefix: sessionCustomer.samsarAccount?.appKeyPrefix || accountSession?.appKeyPrefix,
      appKeyLast4: sessionCustomer.samsarAccount?.appKeyLast4 || accountSession?.appKeyLast4,
      apiKey: accountSession?.apiKey,
      creditsRemaining: sessionCustomer.subscription.creditsRemaining
    }));
  }
  if (pendingCheckoutCustomer) {
    clearPendingCreditCheckoutCookie(response);
  }
  return response;
}

async function findCustomerForPendingCheckout(checkoutSessionId?: string, email?: string) {
  if (!checkoutSessionId && !email) {
    return undefined;
  }
  const store = await readStore();
  return store.customers.find((customer) => {
    const sameCheckout = checkoutSessionId && customer.samsarAccount?.checkoutSessionId === checkoutSessionId;
    const sameEmail = email && customer.samsarAccount?.email?.toLowerCase() === email.toLowerCase();
    return Boolean(sameCheckout || sameEmail);
  });
}

async function restorePendingCreditCheckout(pendingCheckout: PendingCreditCheckoutCookie) {
  const existingCustomer = await findCustomerForPendingCheckout(
    pendingCheckout.checkoutSessionId,
    pendingCheckout.email
  );
  if (existingCustomer) {
    return existingCustomer;
  }
  if (!pendingCheckout.paymentStatusEndpoint) {
    return undefined;
  }
  try {
    const status = await fetchSamsarProcessorCreditCheckoutStatus(pendingCheckout.paymentStatusEndpoint);
    const result = await reconcileProcessorCreditWebhook({
      ...status,
      checkoutSessionId: pendingCheckout.checkoutSessionId,
      paymentIntentId: pendingCheckout.paymentIntentId,
      externalPaymentId: pendingCheckout.externalPaymentId,
      paymentStatusEndpoint: pendingCheckout.paymentStatusEndpoint,
      customerEmail: pendingCheckout.email,
      amountCents: pendingCheckout.amountCents,
      credits: pendingCheckout.credits
    });
    return result.customer;
  } catch {
    return undefined;
  }
}

function orderActiveCustomerFirst(store: SuperReferralsStore, activeCustomerId?: string) {
  if (!activeCustomerId) {
    return store;
  }
  const activeCustomer = store.customers.find((customer) => customer.id === activeCustomerId);
  if (!activeCustomer) {
    return store;
  }
  return {
    ...store,
    customers: [
      activeCustomer,
      ...store.customers.filter((customer) => customer.id !== activeCustomerId)
    ] as Customer[]
  };
}
