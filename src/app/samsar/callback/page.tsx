"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import BreadcrumbNav from "@/components/BreadcrumbNav";
import LanguageSelector from "@/components/LanguageSelector";
import { syncStoredAppLanguagePreference } from "@/lib/app-language-client";
import {
  authCredentialsFromCurrentUrl,
  fetchWithSamsarAuth,
  removeAuthCredentialsFromCurrentUrl,
  storeSamsarCredentials
} from "@/lib/storefront-auth-client";

export default function SamsarCallbackPage() {
  const router = useRouter();
  const [message, setMessage] = useState("Connecting your SuperReferrals account.");

  useEffect(() => {
    let cancelled = false;

    async function connectAccount() {
      const credentials = authCredentialsFromCurrentUrl();
      if (!credentials.authToken) {
        throw new Error("SuperReferrals did not return an auth token.");
      }
      storeSamsarCredentials(credentials);
      const response = await fetchWithSamsarAuth("/api/processor/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(credentials),
        credentials: "same-origin"
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.message || "Unable to connect SuperReferrals account.");
      }
      storeSamsarCredentials({
        authToken: data.account?.authToken || credentials.authToken,
        refreshToken: data.account?.refreshToken || credentials.refreshToken,
        expiryDate: data.account?.expiryDate || credentials.expiryDate,
        refreshTokenExpiresAt: data.account?.refreshTokenExpiresAt || credentials.refreshTokenExpiresAt
      });
      await syncStoredAppLanguagePreference().catch(() => undefined);
      removeAuthCredentialsFromCurrentUrl();
      if (!cancelled) {
        router.replace("/dashboard?auth=connected");
      }
    }

    connectAccount().catch((error) => {
      if (!cancelled) {
        removeAuthCredentialsFromCurrentUrl();
        setMessage(error instanceof Error ? error.message : "Unable to connect SuperReferrals account.");
      }
    });

    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <main className="inft-layout">
      <div className="topbar hero-band">
        <div>
          <div className="eyebrow">SuperReferrals Account</div>
          <h1>Account connection</h1>
          <p className="subtle">{message}</p>
        </div>
        <div className="page-top-actions">
          <LanguageSelector />
          <BreadcrumbNav />
          <a className="btn primary" href="/dashboard">Open dashboard</a>
          <span className="badge">
            <RefreshCw size={14} /> Syncing
          </span>
        </div>
      </div>
    </main>
  );
}
