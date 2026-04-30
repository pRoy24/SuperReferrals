import { notFound } from "next/navigation";
import FeedPage from "@/components/FeedPage";
import { readStore } from "@/lib/store";
import { storefrontFeedPageProps } from "@/lib/storefront-routing";

export const dynamic = "force-dynamic";

export default async function FocusedStorefrontFeedPage({
  params
}: {
  params: Promise<{ customerId: string; generationId: string }>;
}) {
  const { customerId, generationId } = await params;
  const store = await readStore();
  const customer = store.customers.find((item) => item.id === customerId);
  if (!customer) {
    notFound();
  }
  return <FeedPage initialGenerationId={decodeURIComponent(generationId)} {...storefrontFeedPageProps(customer)} />;
}
