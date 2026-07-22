import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import type {
  HexaAuditMutationRequest,
  HexaReviewRating,
  HexaWatchedSession,
} from "../../../hooks/useHexaData";

const RATINGS: Array<{ value: HexaReviewRating; label: string; color: string; fallback: string }> = [
  { value: "satisfied", label: "满意", color: "#22c55e", fallback: "这轮结果符合我的预期。" },
  { value: "average", label: "一般", color: "#f59e0b", fallback: "这轮部分达到预期，仍有需要改进的地方。" },
  { value: "unsatisfied", label: "不满意", color: "#f87171", fallback: "这轮结果没有解决我的主要问题。" },
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
      <div className="hexa-report-section-title"><span>这轮结果你觉得如何？</span><small>你的评价会进入本会话复盘</small></div>
      <div className="hexa-review-options" role="radiogroup" aria-label="用户复盘评价">
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
          <input aria-label="本轮复盘补充说明" className="kawaii-input" value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="可选：说说哪里做得好，或哪里需要改进" />
          <button type="button" className="kawaii-toggle-btn connected" onClick={() => void save()} disabled={state === "saving"}>
            <Save size={14} /> {state === "saved" ? "已记录" : "记录复盘"}
          </button>
        </div>
      )}
      {state === "error" && <div className="hexa-report-error">复盘保存失败，请重试。</div>}
    </section>
  );
}
