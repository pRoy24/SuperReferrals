export default function PaymentCancelPage() {
  return (
    <main className="inft-layout">
      <div className="hero-band">
        <div className="eyebrow">Samsar Processor</div>
        <h1>Payment cancelled</h1>
        <p className="subtle">No credits were purchased. You can restart checkout from the console.</p>
        <div className="button-row">
          <a className="btn primary" href="/">Return to console</a>
        </div>
      </div>
    </main>
  );
}
