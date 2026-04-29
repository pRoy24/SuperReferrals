import { notFound } from "next/navigation";
import FeedPage from "@/components/FeedPage";

export default async function FocusedDeviceFeedPage({
  params
}: {
  params: Promise<{ generationId: string; viewMode: string }>;
}) {
  const { generationId, viewMode } = await params;
  if (viewMode !== "mobile" && viewMode !== "desktop") {
    notFound();
  }
  return <FeedPage initialGenerationId={decodeURIComponent(generationId)} initialViewMode={viewMode} />;
}
