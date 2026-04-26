import type { Metadata } from "next";
import TextareaAutosizeInstaller from "@/components/TextareaAutosizeInstaller";
import "./globals.css";

export const metadata: Metadata = {
  title: "SuperReferrals",
  description: "On-chain Samsar image-list-to-video referrer adapter"
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
