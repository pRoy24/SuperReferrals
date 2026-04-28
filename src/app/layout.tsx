import type { Metadata } from "next";
import PageAssistant from "@/components/PageAssistant";
import ProductionHackathonBanner from "@/components/ProductionHackathonBanner";
import TextareaAutosizeInstaller from "@/components/TextareaAutosizeInstaller";
import "./globals.css";

export const metadata: Metadata = {
  title: "SuperReferrals",
  description: "Turn referral links into product marketing videos with catalog data, creative styles, and creator campaign pages.",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" }
    ],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }
    ]
  }
};

const deploymentEnvironment =
  process.env.NEXT_PUBLIC_DEPLOYMENT_ENV ||
  process.env.DEPLOYMENT_ENV ||
  process.env.NEXT_PUBLIC_APP_ENV ||
  "";
const hackathonStagingUrl =
  process.env.NEXT_PUBLIC_HACKATHON_STAGING_URL ||
  process.env.NEXT_PUBLIC_STAGING_WEBSITE_URL ||
  "https://super-referrals-git-develop-proy24s-projects.vercel.app";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <TextareaAutosizeInstaller />
        <ProductionHackathonBanner
          enabled={deploymentEnvironment === "production"}
          stagingUrl={hackathonStagingUrl}
        />
        {children}
        <PageAssistant />
      </body>
    </html>
  );
}
