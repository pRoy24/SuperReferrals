import Dashboard from "@/components/Dashboard";

export default async function ReferrerPage({ params }: { params: Promise<{ referrerCode: string }> }) {
  const { referrerCode } = await params;
  return <Dashboard initialReferrerCode={referrerCode} />;
}
