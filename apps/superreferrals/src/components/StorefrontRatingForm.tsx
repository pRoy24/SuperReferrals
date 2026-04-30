"use client";

import { Send, Star } from "lucide-react";
import { useState } from "react";

type StorefrontRatingFormProps = {
  customerId: string;
  wallet?: string;
  subAccountId?: string;
  generationId?: string;
  inftId?: string;
  operation?: string;
  title?: string;
};

export default function StorefrontRatingForm({
  customerId,
  wallet,
  subAccountId,
  generationId,
  inftId,
  operation,
  title = "Rate storefront"
}: StorefrontRatingFormProps) {
  const [score, setScore] = useState(5);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submitRating() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/storefronts/${customerId}/ratings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          score,
          comment,
          wallet,
          subAccountId,
          generationId,
          inftId,
          operation
        })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || "Unable to save rating");
      }
      const average = Number(data.summary?.average || score).toFixed(1);
      const count = Number(data.summary?.count || 1);
      setMessage(`Saved. Storefront rating is ${average} from ${count} rating${count === 1 ? "" : "s"}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save rating");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rating-form">
      <div className="rating-form-header">
        <strong>{title}</strong>
        <span className="badge">{operation || (generationId ? "video" : "operation")}</span>
      </div>
      <div className="rating-stars" role="radiogroup" aria-label="Storefront rating">
        {[1, 2, 3, 4, 5].map((value) => (
          <button
            type="button"
            className={value <= score ? "active" : ""}
            onClick={() => setScore(value)}
            aria-label={`${value} star${value === 1 ? "" : "s"}`}
            aria-checked={score === value}
            role="radio"
            key={value}
          >
            <Star size={18} />
          </button>
        ))}
      </div>
      <div className="field">
        <label>Optional rating note</label>
        <input value={comment} onChange={(event) => setComment(event.target.value)} placeholder="What worked or what should improve?" />
      </div>
      <div className="button-row">
        <button className="btn small" onClick={submitRating} disabled={busy}>
          <Send size={15} /> {busy ? "Saving..." : "Save rating"}
        </button>
        {message && <span className="subtle">{message}</span>}
      </div>
    </div>
  );
}
