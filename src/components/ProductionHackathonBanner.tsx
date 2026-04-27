"use client";

import { ExternalLink, X } from "lucide-react";
import { useEffect, useState } from "react";

const collapseStorageKey = "superreferrals:production-hackathon-banner:collapsed";

export default function ProductionHackathonBanner({
  enabled,
  stagingUrl
}: {
  enabled: boolean;
  stagingUrl: string;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    setVisible(window.localStorage.getItem(collapseStorageKey) !== "true");
  }, [enabled]);

  function collapse() {
    window.localStorage.setItem(collapseStorageKey, "true");
    setVisible(false);
  }

  if (!enabled || !visible) {
    return null;
  }

  return (
    <div className="production-hackathon-banner" role="region" aria-label="ETHGlobal hackathon staging notice">
      <div className="production-hackathon-banner-inner">
        <span className="production-hackathon-banner-badge">Coming soon</span>
        <span className="production-hackathon-banner-copy">
          Production launch is coming soon. For ETHGlobal hackathon testing, use the staging website.
        </span>
        <a className="production-hackathon-banner-link" href={stagingUrl} target="_blank" rel="noreferrer">
          Open staging <ExternalLink size={14} />
        </a>
        <button
          aria-label="Hide ETHGlobal staging banner"
          className="production-hackathon-banner-close"
          onClick={collapse}
          title="Hide banner"
          type="button"
        >
          <X size={15} />
        </button>
      </div>
    </div>
  );
}
