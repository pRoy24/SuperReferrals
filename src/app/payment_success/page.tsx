export default function PaymentSuccessPage() {
  return (
    <main className="inft-layout">
      <div className="hero-band">
        <div className="eyebrow">SuperReferrals Checkout</div>
        <h1>Payment received</h1>
        <p className="subtle">
          Stripe will finish provisioning credits for your SuperReferrals account. Return to the console and refresh credits to unlock storefront setup.
        </p>
        <div className="button-row">
          <a className="btn primary" href="/dashboard">Return to console</a>
        </div>
      </div>
    </main>
  );
}
