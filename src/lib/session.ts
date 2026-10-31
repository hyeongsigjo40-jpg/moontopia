// 데모용 로그인: 쿠키에 사용자 id를 저장한다. 실서비스에서는 실제 인증으로 교체해야 한다.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "./db";

export type User = { id: string; name: string; role: "seller" | "buyer"; identity_verified: number };

export async function currentUser(): Promise<User | null> {
  const c = await cookies();
  const uid = c.get("uid")?.value;
  if (!uid) return null;
  return (db().prepare("SELECT * FROM users WHERE id=?").get(uid) as User | undefined) ?? null;
}

export async function requireRole(role: "seller" | "buyer"): Promise<User> {
  const u = await currentUser();
  if (!u || u.role !== role) redirect("/");
  return u;
}
