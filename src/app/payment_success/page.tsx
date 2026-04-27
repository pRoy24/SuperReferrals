export default function PaymentSuccessPage() {
  return (
    <main className="inft-layout">
      <div className="hero-band">
        <div className="eyebrow">Samsar Processor</div>
        <h1>Payment received</h1>
        <p className="subtle">
          Stripe will finish provisioning credits for the samsar-js sub-account. Return to the console and refresh credits to unlock storefront setup.
        </p>
        <div className="button-row">
          <a className="btn primary" href="/dashboard">Return to console</a>
        </div>
      </div>
    </main>
  );
}
