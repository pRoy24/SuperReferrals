import UserLandingPage from "@/components/UserLandingPage";

export const dynamic = "force-dynamic";

export default async function StorefrontLandingPage({ params }: { params: Promise<{ customerId: string }> }) {
  const { customerId } = await params;
  return <UserLandingPage customerId={customerId} />;
}
