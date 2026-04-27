import type { Metadata } from "next";
import TextareaAutosizeInstaller from "@/components/TextareaAutosizeInstaller";
import "./globals.css";

export const metadata: Metadata = {
  title: "SuperReferrals",
  description: "Turn referral links into product marketing videos with catalog data, creative styles, and creator campaign pages."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <TextareaAutosizeInstaller />
        {children}
      </body>
    </html>
  );
}
