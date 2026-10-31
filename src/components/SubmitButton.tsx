"use client";
import { useFormStatus } from "react-dom";

export default function SubmitButton({ label, pending, className = "btn btn-primary" }: { label: string; pending: string; className?: string }) {
  const { pending: p } = useFormStatus();
  return <button className={className} disabled={p}>{p ? pending : label}</button>;
}
