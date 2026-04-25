import { notFound } from "next/navigation";
import INFTPage from "@/components/INFTPage";
import { getINFT } from "@/lib/store";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const inft = await getINFT(id);
  if (!inft) {
    notFound();
  }
  return <INFTPage inft={inft} />;
}
