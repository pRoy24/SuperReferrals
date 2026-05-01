import { notFound } from "next/navigation";
import FeedPage from "@/components/FeedPage";
import { readStore } from "@/lib/store";
import { storefrontFeedPageProps } from "@/lib/storefront-routing";

export const dynamic = "force-dynamic";

export default async function StorefrontFeedPage({
  params,
  searchParams
}: {
  params: Promise<{ customerId: string }>;
  searchParams?: Promise<{ focusId?: string; view?: string }>;
}) {
  const { customerId } = await params;
  const query = await searchParams;
  const store = await readStore();
  const customer = store.customers.find((item) => item.id === customerId);
  if (!customer) {
    notFound();
  }
  const view = query?.view === "desktop" || query?.view === "mobile" ? query.view : undefined;
  return (
    <FeedPage
      initialGenerationId={query?.focusId ? decodeURIComponent(query.focusId) : ""}
      initialViewMode={view}
      {...storefrontFeedPageProps(customer)}
    />
  );
}
