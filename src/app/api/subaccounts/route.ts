import { NextResponse } from "next/server";
import { createSubAccountForCustomer } from "@/lib/orchestrator";
import { normalizeAppLanguage } from "@/lib/localization";
import { mutateStore, publicSubAccount, readStore, updateSubAccountPreferences } from "@/lib/store";

export async function GET() {
  const store = await readStore();
  return NextResponse.json({ subAccounts: store.subAccounts.map(publicSubAccount) });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const account = await createSubAccountForCustomer(body);
    return NextResponse.json({ account: publicSubAccount(account) });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Unable to create sub-account" },
      { status: 400 }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const preferences = {
      renderForm: isRecord(body.preferences?.renderForm) ? body.preferences.renderForm : undefined,
      renderFormMode: body.preferences?.renderFormMode === "simple" || body.preferences?.renderFormMode === "advanced"
        ? body.preferences.renderFormMode
        : undefined
    } as Parameters<typeof updateSubAccountPreferences>[1]["preferences"];
    const language = normalizeAppLanguage(body.preferences?.language || body.language);
    if (language) {
      preferences.language = language;
    }
    const account = await mutateStore((store) => updateSubAccountPreferences(store, {
      id: cleanOptionalString(body.subAccountId) || cleanOptionalString(body.id),
      customerId: cleanOptionalString(body.customerId),
      wallet: cleanOptionalString(body.wallet),
      preferences
    }));
    if (!account) {
      throw new Error("sub-account was not found");
    }
    return NextResponse.json({ account: publicSubAccount(account) });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Unable to save sub-account preferences" },
      { status: 400 }
    );
  }
}

function cleanOptionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
