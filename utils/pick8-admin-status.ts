export type Pick8SubmissionStatus = "not_submitted" | "draft" | "submitted";

export type AdminStatusProfile = {
  id: string;
  display_name: string;
  is_active: boolean;
  pick8_participation_active: boolean;
};

export type AdminStatusEntry = {
  user_id: string;
  submitted_at: string | null;
};

export function pick8SubmissionStatus(
  entry: AdminStatusEntry | null | undefined,
): Pick8SubmissionStatus {
  if (!entry) return "not_submitted";
  return entry.submitted_at === null ? "draft" : "submitted";
}

const SUBMISSION_ORDER: Record<Pick8SubmissionStatus, number> = {
  not_submitted: 0,
  draft: 1,
  submitted: 2,
};

export function buildCurrentSubmissionRows(
  profiles: AdminStatusProfile[],
  entries: AdminStatusEntry[],
) {
  const entryByUser = new Map(entries.map((entry) => [entry.user_id, entry]));
  return profiles
    .filter((profile) =>
      (profile.is_active && profile.pick8_participation_active) ||
      entryByUser.has(profile.id),
    )
    .map((profile) => ({
      profile,
      status: pick8SubmissionStatus(entryByUser.get(profile.id)),
    }))
    .sort((a, b) =>
      SUBMISSION_ORDER[a.status] - SUBMISSION_ORDER[b.status] ||
      a.profile.display_name.localeCompare(b.profile.display_name),
    );
}

export function sortPick8AdminProfiles<T extends AdminStatusProfile>(
  profiles: T[],
) {
  const group = (profile: AdminStatusProfile) =>
    !profile.is_active ? 2 : profile.pick8_participation_active ? 0 : 1;
  return [...profiles].sort((a, b) =>
    group(a) - group(b) || a.display_name.localeCompare(b.display_name),
  );
}
