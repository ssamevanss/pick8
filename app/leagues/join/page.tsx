import Link from "next/link";
import { joinLeague } from "../actions";
import SubmitButton from "@/components/forms/SubmitButton";

export default async function JoinLeaguePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; code?: string }>;
}) {
  const { error, code } = await searchParams;

  return (
    <div className="mx-auto flex w-full max-w-xl items-center justify-center py-2 text-white sm:py-8">
      <div className="brand-card w-full p-5 sm:p-7">
        <p className="brand-eyebrow">Private invite</p>
        <h1 className="brand-title mt-2">Join league</h1>
        <p className="brand-subtitle mt-2">
          Enter the invite code shared by a league admin.
        </p>
        {error ? <p className="brand-alert-danger mt-4">{error}</p> : null}
        <form action={joinLeague} className="mt-5 space-y-4">
          <label className="block">
            <span className="text-sm font-semibold text-slate-200">
              Invite code
            </span>
            <input
              name="code"
              required
              defaultValue={code?.trim().toUpperCase() ?? ""}
              minLength={6}
              maxLength={32}
              className="brand-input uppercase"
              autoCapitalize="characters"
              autoComplete="off"
            />
          </label>
          <div className="flex flex-col gap-2 pt-1 min-[420px]:flex-row">
            <SubmitButton
              idleLabel="Join league"
              pendingLabel="Joining..."
              className="brand-button-primary min-[420px]:order-2 min-[420px]:flex-1"
            />
            <Link
              href="/leagues"
              className="brand-button-secondary min-[420px]:order-1"
            >
              Back to League Hub
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
