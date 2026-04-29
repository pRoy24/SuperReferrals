import BreadcrumbNav from "@/components/BreadcrumbNav";

export default function PaymentCancelPage() {
  return (
    <main className="inft-layout">
      <div className="topbar hero-band">
        <div>
          <div className="eyebrow">SuperReferrals Checkout</div>
          <h1>Payment cancelled</h1>
          <p className="subtle">No credits were purchased. You can restart checkout from the console.</p>
        </div>
        <div className="page-top-actions">
          <BreadcrumbNav />
          <a className="btn primary" href="/dashboard">Return to console</a>
        </div>
      </div>
    </main>
  );
}
