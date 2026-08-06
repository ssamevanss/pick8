import Link from "next/link";
import { getRequestAuthContext } from "@/utils/app-context";

export default async function SettingsPage() {
  const { profile } = await getRequestAuthContext();

  return (
    <>
      <header className="brand-card mb-6 p-5 sm:p-6">
        <p className="brand-eyebrow">Account</p>
        <h1 className="brand-title mt-2">Settings</h1>
        <p className="brand-subtitle mt-2">
          Your Pick8 account details are managed by the administrator.
        </p>
      </header>

      <section className="brand-card p-5 sm:p-6">
        <dl>
          <div>
            <dt className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Display name
            </dt>
            <dd className="mt-1 font-semibold text-white">
              {profile?.display_name?.trim() || "Player"}
            </dd>
          </div>
        </dl>

        <Link href="/logout" className="brand-button-secondary mt-6">
          Sign out
        </Link>
      </section>
    </>
  );
}
