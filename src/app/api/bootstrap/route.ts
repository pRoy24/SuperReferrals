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
import {
  bootstrap,
  customersShareProcessorAccount,
  restoreProcessorAccountSession,
  restoreProcessorAuthTokenSession
} from "@/lib/orchestrator";
import { reconcileProcessorCreditWebhook } from "@/lib/processor-credit-webhook";
import { fetchSamsarProcessorCreditCheckoutStatus } from "@/lib/samsar-processor";
import { emptyStore, readStore } from "@/lib/store";
import type { Customer, SuperReferralsStore } from "@/lib/types";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const accountScope = url.searchParams.get("scope") === "account";
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
  const sessionCustomer = restoredCustomer || pendingCheckoutCustomer;
  const store = accountScope
    ? sessionCustomer
      ? accountScopedStore(
        await bootstrap(sessionCustomer.id),
        sessionCustomer
      )
      : emptyStore()
    : orderActiveCustomerFirst(
      await bootstrap(),
      restoredCustomer?.id || pendingCheckoutCustomer?.id || accountSession?.customerId || pendingCheckout?.customerId
    );
  const response = NextResponse.json(store);
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

function accountScopedStore(store: SuperReferralsStore, activeCustomer?: Customer) {
  if (!activeCustomer) {
    return {
      ...store,
      customers: [],
      subAccounts: [],
      quotes: [],
      generations: [],
      infts: [],
      storefrontRatings: [],
      feedLikes: [],
      feedComments: [],
      feedViews: [],
      agents: [],
      agentJobs: [],
      agentTownEvents: []
    } satisfies SuperReferralsStore;
  }
  const customers = orderActiveCustomerFirst({
    ...store,
    customers: store.customers.filter((customer) =>
      customer.id === activeCustomer.id || customersShareProcessorAccount(customer, activeCustomer)
    )
  }, activeCustomer.id).customers;
  const customerIds = new Set(customers.map((customer) => customer.id));
  const generationIds = new Set(
    store.generations
      .filter((generation) => customerIds.has(generation.customerId))
      .map((generation) => generation.id)
  );
  const inftIds = new Set(
    store.infts
      .filter((inft) => customerIds.has(inft.customerId))
      .map((inft) => inft.id)
  );
  const agentIds = new Set(
    store.agents
      .filter((agent) => agent.customerId && customerIds.has(agent.customerId))
      .map((agent) => agent.id)
  );
  const jobIds = new Set(
    store.agentJobs
      .filter((job) => customerIds.has(job.customerId))
      .map((job) => job.id)
  );
  return {
    ...store,
    customers,
    subAccounts: store.subAccounts.filter((account) => customerIds.has(account.customerId)),
    quotes: store.quotes.filter((quote) => customerIds.has(quote.customerId)),
    generations: store.generations.filter((generation) => customerIds.has(generation.customerId)),
    infts: store.infts.filter((inft) => customerIds.has(inft.customerId)),
    storefrontRatings: store.storefrontRatings.filter((rating) => customerIds.has(rating.customerId)),
    feedLikes: store.feedLikes.filter((like) => generationIds.has(like.generationId)),
    feedComments: store.feedComments.filter((comment) => generationIds.has(comment.generationId)),
    feedViews: store.feedViews.filter((view) => generationIds.has(view.generationId)),
    agents: store.agents.filter((agent) => agent.customerId && customerIds.has(agent.customerId)),
    agentJobs: store.agentJobs.filter((job) => customerIds.has(job.customerId)),
    agentTownEvents: store.agentTownEvents.filter((event) =>
      Boolean(
        (event.jobId && jobIds.has(event.jobId)) ||
        agentIds.has(event.fromAgentId) ||
        (event.toAgentId && agentIds.has(event.toAgentId))
      )
    ),
    deletedVideoReferences: store.deletedVideoReferences.filter((reference) =>
      Boolean(
        (reference.generationId && generationIds.has(reference.generationId)) ||
        (reference.inftId && inftIds.has(reference.inftId))
      )
    )
  } satisfies SuperReferralsStore;
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
