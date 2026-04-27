import { notFound } from "next/navigation";
import UserLandingPage from "@/components/UserLandingPage";
import { isPublicStorefrontCustomer, readStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function StorefrontLandingPage({ params }: { params: Promise<{ customerId: string }> }) {
  const { customerId } = await params;
  const store = await readStore();
  if (!store.customers.some((customer) => customer.id === customerId && isPublicStorefrontCustomer(customer))) {
    notFound();
  }
  return <UserLandingPage customerId={customerId} />;
}
