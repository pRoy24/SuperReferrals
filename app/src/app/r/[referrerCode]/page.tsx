import UserLandingPage from "@/components/UserLandingPage";

export default async function ReferrerPage({ params }: { params: Promise<{ referrerCode: string }> }) {
  const { referrerCode } = await params;
  return <UserLandingPage referrerCode={referrerCode} />;
}
