import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import type {
  HexaAuditMutationRequest,
  HexaReviewRating,
  HexaWatchedSession,
} from "../../../hooks/useHexaData";
import { t } from "@/lib/i18n";

const RATINGS: Array<{ value: HexaReviewRating; label: string; color: string; fallback: string }> = [
  { value: "satisfied", label: t("hexa.reviewSatisfied"), color: "#22c55e", fallback: t("hexa.reviewSatisfiedFallback") },
  { value: "average", label: t("hexa.reviewAverage"), color: "#f59e0b", fallback: t("hexa.reviewAverageFallback") },
  { value: "unsatisfied", label: t("hexa.reviewUnsatisfied"), color: "#f87171", fallback: t("hexa.reviewUnsatisfiedFallback") },
];

export function HexaUserReview({
  session,
  onMutate,
}: {
  session: HexaWatchedSession;
  onMutate: (request: HexaAuditMutationRequest) => Promise<unknown>;
}) {
  const existing = session.audit.user_review;
  const [rating, setRating] = useState<HexaReviewRating | null>(existing?.rating ?? null);
  const [summary, setSummary] = useState(existing?.summary ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  useEffect(() => {
    setRating(session.audit.user_review?.rating ?? null);
    setSummary(session.audit.user_review?.summary ?? "");
    setState("idle");
  }, [session.session_id, session.audit.user_review?.created_at]);

  const save = async () => {
    if (!rating) return;
    const selected = RATINGS.find((item) => item.value === rating)!;
    setState("saving");
    try {
      await onMutate({
        session_id: session.session_id,
        action: "set_user_review",
        review: { rating, summary: summary.trim() || selected.fallback, evidence: [] },
      });
      setState("saved");
    } catch {
      setState("error");
    }
  };

  return (
    <section className="hexa-report-section hexa-user-review">
      <div className="hexa-report-section-title"><span>{t("hexa.reviewPrompt")}</span><small>{t("hexa.reviewPromptHint")}</small></div>
      <div className="hexa-review-options" role="radiogroup" aria-label={t("hexa.reviewRadioLabel")}>
        {RATINGS.map((item) => (
          <button
            key={item.value}
            type="button"
            role="radio"
            aria-checked={rating === item.value}
            className={rating === item.value ? "selected" : ""}
            style={rating === item.value ? { color: item.color, borderColor: `${item.color}66`, background: `${item.color}12` } : undefined}
            onClick={() => { setRating(item.value); setState("idle"); }}
          >
            {item.label}
          </button>
        ))}
      </div>
      {rating && (
        <div className="hexa-review-note">
          <input aria-label={t("hexa.reviewNoteLabel")} className="kawaii-input" value={summary} onChange={(event) => setSummary(event.target.value)} placeholder={t("hexa.reviewNotePlaceholder")} />
          <button type="button" className="kawaii-toggle-btn connected" onClick={() => void save()} disabled={state === "saving"}>
            <Save size={14} /> {state === "saved" ? t("hexa.reviewSaved") : t("hexa.reviewSave")}
          </button>
        </div>
      )}
      {state === "error" && <div className="hexa-report-error">{t("hexa.reviewSaveError")}</div>}
    </section>
  );
}
