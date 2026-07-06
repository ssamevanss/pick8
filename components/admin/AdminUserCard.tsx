import {
  approveUser,
  disableUser,
  enableUser,
  rejectUser,
  updateUserProfile,
} from "@/app/(app)/admin/actions";
import SubmitButton from "@/components/forms/SubmitButton";

export type AdminUser = {
  id: string;
  email: string | null;
  display_name: string;
  role: "player" | "admin";
  status: "pending" | "approved" | "rejected" | "disabled";
};

type AdminUserCardProps = {
  user: AdminUser;
  currentUserId: string;
};

function getStatusClass(status: AdminUser["status"]) {
  if (status === "pending") {
    return "bg-amber-500/15 text-amber-300 ring-amber-500/30";
  }

  if (status === "rejected") {
    return "bg-red-500/15 text-red-300 ring-red-500/30";
  }

  if (status === "disabled") {
    return "bg-slate-500/15 text-slate-300 ring-slate-500/30";
  }

  return "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30";
}

export default function AdminUserCard({
  user,
  currentUserId,
}: AdminUserCardProps) {
  const isCurrentUser = user.id === currentUserId;
  const isPending = user.status === "pending";
  const isApproved = user.status === "approved";
  const isDisabled = user.status === "disabled";

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
      <form action={updateUserProfile}>
        <input type="hidden" name="user_id" value={user.id} />

        <div className="grid gap-3 md:grid-cols-[1fr_220px] md:items-end">
          <div>
            <label className="text-sm text-slate-300">Display name</label>
            <input
              name="display_name"
              defaultValue={user.display_name}
              required
              className="mt-1 w-full rounded-lg bg-slate-900 px-3 py-2 outline-none ring-1 ring-slate-800"
            />
          </div>

          <div>
            <label className="text-sm text-slate-300">Role</label>
            <select
              name="role"
              defaultValue={user.role}
              className="mt-1 w-full rounded-lg bg-slate-900 px-3 py-2 outline-none ring-1 ring-slate-800"
            >
              <option value="player">Player</option>
              <option value="admin">Admin</option>
            </select>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          {user.email ? (
            <span className="text-slate-500">{user.email}</span>
          ) : null}

          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 font-semibold capitalize ring-1 ${getStatusClass(
              user.status,
            )}`}
          >
            {user.status}
          </span>

          {isCurrentUser ? (
            <span className="text-emerald-300">This is you.</span>
          ) : null}
        </div>

        <div className="mt-4 border-t border-slate-800 pt-3">
          <SubmitButton
            idleLabel="Save user"
            pendingLabel="Saving user..."
            className="w-full rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 sm:w-auto"
          />
        </div>
      </form>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        {isPending ? (
          <>
            <form action={approveUser}>
              <input type="hidden" name="user_id" value={user.id} />
              <SubmitButton
                idleLabel="Approve"
                pendingLabel="Approving..."
                className="w-full rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 sm:w-auto"
              />
            </form>

            <form action={rejectUser}>
              <input type="hidden" name="user_id" value={user.id} />
              <SubmitButton
                idleLabel="Reject"
                pendingLabel="Rejecting..."
                className="w-full rounded-lg border border-red-900 px-4 py-2 text-sm font-semibold text-red-300 hover:bg-red-950 sm:w-auto"
              />
            </form>
          </>
        ) : null}

        {isApproved && !isCurrentUser ? (
          <form action={disableUser}>
            <input type="hidden" name="user_id" value={user.id} />
            <SubmitButton
              idleLabel="Disable user"
              pendingLabel="Disabling..."
              className="w-full rounded-lg border border-red-900 px-4 py-2 text-sm font-semibold text-red-300 hover:bg-red-950 sm:w-auto"
            />
          </form>
        ) : null}

        {isDisabled ? (
          <form action={enableUser}>
            <input type="hidden" name="user_id" value={user.id} />
            <SubmitButton
              idleLabel="Re-enable user"
              pendingLabel="Re-enabling..."
              className="w-full rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 sm:w-auto"
            />
          </form>
        ) : null}
      </div>
    </div>
  );
}
