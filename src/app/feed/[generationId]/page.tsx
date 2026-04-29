import FeedPage from "@/components/FeedPage";

export default async function FocusedFeedPage({ params }: { params: Promise<{ generationId: string }> }) {
  const { generationId } = await params;
  return <FeedPage initialGenerationId={decodeURIComponent(generationId)} />;
}
