import type { Metadata } from "next";
import { isAdmin, adminTokenConfigured } from "@/lib/admin-auth";
import ReviewQueue from "./review-queue";

export const metadata: Metadata = {
  title: "freshcrate — Review Queue",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  if (!adminTokenConfigured()) {
    return (
      <div className="max-w-[700px]">
        <p className="text-[11px] text-fm-urgency-high mb-3">
          FRESHCRATE_ADMIN_TOKEN not set on server (must be ≥ 16 chars). Set it in Railway env, then redeploy.
        </p>
      </div>
    );
  }

  if (!(await isAdmin())) {
    return (
      <div className="max-w-[400px]">
        <h2 className="text-[14px] font-bold text-fm-green mb-2">Admin login</h2>
        <form action="/api/admin/login?next=/admin/review" method="POST" className="space-y-2">
          <input
            type="password"
            name="token"
            autoComplete="off"
            placeholder="admin token"
            className="block w-full bg-fm-sidebar-bg border border-fm-border px-2 py-1 text-[12px]"
          />
          <button
            type="submit"
            className="px-3 py-1 text-[11px] font-bold border border-fm-border hover:border-fm-green"
          >
            Log in
          </button>
        </form>
      </div>
    );
  }

  return <ReviewQueue />;
}
