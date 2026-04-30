import { notFound } from "next/navigation";
import StorefrontPublicMosaicPage from "@/components/StorefrontPublicMosaicPage";
import { listPublicFeedItems } from "@/lib/feed";
import { readStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function StorefrontMosaicPage({ params }: { params: Promise<{ customerId: string }> }) {
  const { customerId } = await params;
  const store = await readStore();
  const customer = store.customers.find((item) => item.id === customerId);
  if (!customer) {
    notFound();
  }
  const feed = await listPublicFeedItems({ customerId, sort: "newest", limit: 100 });
  return <StorefrontPublicMosaicPage customer={customer} items={feed.items} />;
}
