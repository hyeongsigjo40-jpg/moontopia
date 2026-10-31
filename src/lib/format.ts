import type { Interval } from "./access";

export function won(n: number): string {
  const a = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (a >= 100000000) {
    const eok = Math.floor(a / 100000000);
    const man = Math.round((a % 100000000) / 10000);
    return `${sign}${eok}억${man ? ` ${man.toLocaleString()}만` : ""} 원`;
  }
  if (a >= 10000) return `${sign}${Math.round(a / 10000).toLocaleString()}만 원`;
  return `${sign}${Math.round(a).toLocaleString()}원`;
}

export function fmtNum(n: number, unit?: string): string {
  if (unit === "원") return won(n);
  const s = Number.isInteger(n) ? n.toLocaleString() : n.toFixed(1);
  return unit ? `${s}${unit === "%" ? "%" : " " + unit}` : s;
}

export function fmtInterval(iv: Interval, unit?: string): string {
  if (Math.abs(iv.hi - iv.lo) < 1e-9) return fmtNum(iv.lo, unit);
  if (unit === "원") return `${won(iv.lo).replace(" 원", "")} ~ ${won(iv.hi)}`;
  if (unit === "개월") return `${iv.lo.toFixed(1)} ~ ${iv.hi.toFixed(1)}개월`;
  return `${fmtNum(iv.lo, unit)} ~ ${fmtNum(iv.hi, unit)}`;
}

export function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
