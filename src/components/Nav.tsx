import Link from "next/link";
import { currentUser } from "@/lib/session";
import { logout } from "@/app/actions";

export default async function Nav() {
  const u = await currentUser();
  return (
    <nav className="nav">
      <div className="nav-inner">
        <Link href="/" className="brand">점포 실사 에이전트</Link>
        <div className="nav-links">
          {u?.role === "seller" && (
            <>
              <Link href="/seller">내 매물</Link>
              <Link href="/seller/new">매물 등록</Link>
            </>
          )}
          {u?.role === "buyer" && (
            <>
              <Link href="/buyer">추천 매물</Link>
              <Link href="/buyer/compare">비교표</Link>
              <Link href="/buyer/profile">인수 조건</Link>
            </>
          )}
        </div>
        {u && (
          <div className="nav-user">
            <span>{u.name}</span>
            <form action={logout}>
              <button className="btn btn-sm">전환</button>
            </form>
          </div>
        )}
      </div>
    </nav>
  );
}
