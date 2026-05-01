import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SuperStores",
  description: "A wallet-first storefront framework for digital collectible marketplaces."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
