import { CONDITIONS, Condition, TRUST_LABEL, Trust } from "@/lib/fields";
import { STEP_LABEL, Step } from "@/lib/access";

export function CondBadge({ c }: { c: Condition | null }) {
  if (!c) return null;
  const def = CONDITIONS.find((x) => x.key === c)!;
  return <span className={`badge b-${c}`} title={def.label}>{def.short}</span>;
}

export function TrustBadge({ t }: { t?: Trust }) {
  if (!t) return null;
  return <span className={`badge ${t === "stated" ? "" : "b-ok"}`}>{TRUST_LABEL[t]}</span>;
}

export function stepsText(steps: Step[]) {
  return steps.map((s) => STEP_LABEL[s]).join(" → ");
}
