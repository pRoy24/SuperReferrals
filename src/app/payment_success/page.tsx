"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import BreadcrumbNav from "@/components/BreadcrumbNav";
import { syncStoredAppLanguagePreference } from "@/lib/app-language-client";
import {
  authCredentialsFromCurrentUrl,
  fetchWithSamsarAuth,
  removeAuthCredentialsFromCurrentUrl,
  storeSamsarCredentials
} from "@/lib/storefront-auth-client";

type CheckoutSyncState = {
  status: "syncing" | "ready" | "waiting" | "failed";
  message: string;
};

export default function PaymentSuccessPage() {
  const router = useRouter();
  const attempts = useRef(0);
  const [syncState, setSyncState] = useState<CheckoutSyncState>({
    status: "syncing",
    message: "Confirming checkout and preparing your storefront session."
  });

  useEffect(() => {
    let cancelled = false;
    let timeout: number | undefined;

    async function syncCheckoutSession() {
      attempts.current += 1;
      try {
        const credentials = authCredentialsFromCurrentUrl();
        if (credentials.authToken) {
          storeSamsarCredentials(credentials);
          await fetchWithSamsarAuth("/api/processor/session", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(credentials)
          }).catch(() => undefined);
          await syncStoredAppLanguagePreference().catch(() => undefined);
          removeAuthCredentialsFromCurrentUrl();
        }
        const response = await fetchWithSamsarAuth("/api/bootstrap?scope=account", {
          cache: "no-store",
          credentials: "same-origin"
        });
        const store = await response.json();
        if (!response.ok) {
          throw new Error(store.message || "Unable to refresh account state.");
        }
        const customer = Array.isArray(store.customers) ? store.customers[0] : undefined;
        const creditsRemaining = Number(customer?.subscription?.creditsRemaining || 0);
        const account = customer?.samsarAccount || {};
        const hasSession = Boolean(account.hasSession || account.authToken || account.apiKey);
        if (creditsRemaining > 0 && hasSession) {
          await syncStoredAppLanguagePreference().catch(() => undefined);
          if (cancelled) return;
          setSyncState({
            status: "ready",
            message: `${creditsRemaining} credits are ready. Opening your storefront dashboard.`
          });
          timeout = window.setTimeout(() => router.replace("/dashboard?payment=success"), 800);
          return;
        }
        if (attempts.current >= 30) {
          if (cancelled) return;
          setSyncState({
            status: "waiting",
            message: "Payment was received, but the credit webhook is still finishing. Open the dashboard and refresh credits in a moment."
          });
          return;
        }
        if (!cancelled) {
          setSyncState({
            status: "syncing",
            message: "Payment received. Waiting for credits to appear in this storefront session."
          });
          timeout = window.setTimeout(syncCheckoutSession, 2000);
        }
      } catch (error) {
        if (cancelled) return;
        if (attempts.current >= 5) {
          setSyncState({
            status: "failed",
            message: error instanceof Error ? error.message : "Unable to refresh account state."
          });
          return;
        }
        timeout = window.setTimeout(syncCheckoutSession, 2000);
      }
    }

    syncCheckoutSession().catch(() => undefined);
    return () => {
      cancelled = true;
      if (timeout) window.clearTimeout(timeout);
    };
  }, [router]);

  return (
    <main className="inft-layout">
      <div className="topbar hero-band">
        <div>
          <div className="eyebrow">SuperReferrals Checkout</div>
          <h1>Payment received</h1>
          <p className="subtle">{syncState.message}</p>
        </div>
        <div className="page-top-actions">
          <BreadcrumbNav />
          <a className="btn primary" href="/dashboard">Open dashboard</a>
          {syncState.status === "syncing" && (
            <span className="badge">
              <RefreshCw size={14} /> Syncing
            </span>
          )}
        </div>
      </div>
    </main>
  );
}
