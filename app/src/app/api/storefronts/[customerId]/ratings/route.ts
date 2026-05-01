import { NextResponse } from "next/server";
import { mutateStore, readStore, upsertStorefrontRating } from "@/lib/store";
import { normalizeWallet } from "@/lib/ids";

export async function GET(_: Request, { params }: { params: Promise<{ customerId: string }> }) {
  const { customerId } = await params;
  const store = await readStore();
  const ratings = store.storefrontRatings.filter((rating) => rating.customerId === customerId);
  return NextResponse.json({ ratings, summary: summarizeRatings(ratings) });
}

export async function POST(request: Request, { params }: { params: Promise<{ customerId: string }> }) {
  try {
    const { customerId } = await params;
    const body = await request.json();
    const score = Number(body.score);
    if (!Number.isFinite(score) || score < 1 || score > 5) {
      throw new Error("score must be between 1 and 5");
    }

    const rating = await mutateStore((store) => {
      const customer = store.customers.find((item) => item.id === customerId);
      if (!customer) {
        throw new Error("storefront was not found");
      }

      const generationId = cleanOptionalString(body.generationId);
      const inftId = cleanOptionalString(body.inftId);
      const subAccountId = cleanOptionalString(body.subAccountId);
      const operation = cleanOptionalString(body.operation);

      if (generationId) {
        const generation = store.generations.find((item) => item.id === generationId && item.customerId === customerId);
        if (!generation) {
          throw new Error("generationId does not belong to this storefront");
        }
        if (generation.status !== "COMPLETED") {
          throw new Error("storefront ratings are available after the video completes");
        }
      }

      if (inftId) {
        const inft = store.infts.find((item) => item.id === inftId && item.customerId === customerId);
        if (!inft) {
          throw new Error("inftId does not belong to this storefront");
        }
      }

      if (!generationId && !inftId && !operation) {
        throw new Error("rating must reference a completed video or video operation");
      }

      const wallet = cleanOptionalString(body.wallet);
      return upsertStorefrontRating(store, {
        customerId,
        subAccountId,
        generationId,
        inftId,
        operation,
        wallet: wallet ? normalizeWallet(wallet) : undefined,
        score: Math.round(score),
        comment: cleanOptionalString(body.comment)
      });
    });

    const latestStore = await readStore();
    const ratings = latestStore.storefrontRatings.filter((item) => item.customerId === customerId);
    return NextResponse.json({ rating, summary: summarizeRatings(ratings) });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Unable to save storefront rating" },
      { status: 400 }
    );
  }
}

function summarizeRatings(ratings: Array<{ score: number }>) {
  const count = ratings.length;
  const average = count
    ? ratings.reduce((sum, rating) => sum + rating.score, 0) / count
    : 0;
  return { count, average };
}

function cleanOptionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
