export default function PaymentSuccessPage() {
  return (
    <main className="inft-layout">
      <div className="hero-band">
        <div className="eyebrow">Samsar Processor</div>
        <h1>Payment received</h1>
        <p className="subtle">
          Stripe will finish provisioning credits and the processor API key from the checkout email.
        </p>
        <div className="button-row">
          <a className="btn primary" href="/">Return to console</a>
        </div>
      </div>
    </main>
  );
}
