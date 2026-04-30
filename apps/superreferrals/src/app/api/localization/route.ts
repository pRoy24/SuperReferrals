import { NextResponse } from "next/server";
import {
  processorAuthTokenFromRequest,
  type ProcessorAccountCookieSession,
  readProcessorAccountSessionCookie
} from "@/lib/account-session";
import { restoreConsoleCustomer } from "@/lib/console-auth";
import {
  appLanguageFromCookieHeader,
  appLanguageForCountryCode,
  countryCodeFromHeaders,
  normalizeAppLanguage
} from "@/lib/localization";
import {
  customerMatchesProcessorSession,
  customersShareProcessorAccount
} from "@/lib/orchestrator";
import {
  mutateStore,
  readStore,
  updateSubAccountPreferences,
  upsertCustomer
} from "@/lib/store";
import type { Customer } from "@/lib/types";

export async function GET(request: Request) {
  const countryCode = countryCodeFromHeaders(request.headers);
  const defaultLanguage = appLanguageForCountryCode(countryCode);
  const cookieLanguage = appLanguageFromCookieHeader(request.headers.get("cookie"));
  const authCustomer = processorAuthTokenFromRequest(request)
    ? await restoreConsoleCustomer(request).catch(() => undefined)
    : undefined;
  const cookieSession = readProcessorAccountSessionCookie(request.headers.get("cookie"));
  const store = await readStore();
  const accountCustomer = authCustomer || findAccountSessionCustomer(store.customers, cookieSession);
  const persistedLanguage = normalizeAppLanguage(accountCustomer?.preferences?.language);

  return NextResponse.json({
    language: persistedLanguage || cookieLanguage || defaultLanguage,
    persistedLanguage,
    cookieLanguage,
    defaultLanguage,
    countryCode: countryCode || null,
    source: persistedLanguage ? "account" : cookieLanguage ? "cookie" : countryCode ? "geo" : "default"
  });
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const language = normalizeAppLanguage(body.language);
    if (!language) {
      throw new Error("language must be one of: en, zh");
    }

    const sessionCustomer = await restoreConsoleCustomer(request).catch(() => undefined);
    let accountPreferencesSaved = false;
    let subAccountPreferencesSaved = false;

    if (sessionCustomer) {
      accountPreferencesSaved = await mutateStore((store) => {
        const customers = store.customers.filter((customer) =>
          customer.id === sessionCustomer.id || customersShareProcessorAccount(customer, sessionCustomer)
        );
        for (const customer of customers) {
          upsertCustomer(store, {
            id: customer.id,
            preferences: { language }
          });
        }
        return customers.length > 0;
      });
    }

    const subAccountId = cleanOptionalString(body.subAccountId || body.id);
    const customerId = cleanOptionalString(body.customerId);
    const wallet = cleanOptionalString(body.wallet);
    if (subAccountId || (customerId && wallet)) {
      const subAccount = await mutateStore((store) => updateSubAccountPreferences(store, {
        id: subAccountId,
        customerId,
        wallet,
        preferences: { language }
      }));
      subAccountPreferencesSaved = Boolean(subAccount);
    }

    return NextResponse.json({
      language,
      persisted: accountPreferencesSaved || subAccountPreferencesSaved,
      accountPreferencesSaved,
      subAccountPreferencesSaved
    });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Unable to save language preference" },
      { status: 400 }
    );
  }
}

function findAccountSessionCustomer(
  customers: Customer[],
  session?: ProcessorAccountCookieSession
) {
  if (!session) {
    return undefined;
  }
  const exact = customers.find((customer) => customer.id === session.customerId);
  if (exact && customerMatchesProcessorSession(exact, session)) {
    return exact;
  }
  const userId = session.userId?.trim();
  if (userId) {
    const match = customers.find((customer) => customer.samsarAccount?.userId === userId);
    if (match) {
      return match;
    }
  }
  const email = session.email?.trim().toLowerCase();
  return email
    ? customers.find((customer) => customer.samsarAccount?.email?.trim().toLowerCase() === email)
    : undefined;
}

function cleanOptionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
