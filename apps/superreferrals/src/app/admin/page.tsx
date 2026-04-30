import { notFound } from "next/navigation";
import AdminPage from "@/components/AdminPage";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export default function AdminRoutePage() {
  if (!env("ADMIN_SECRET")) {
    notFound();
  }
  return <AdminPage />;
}
