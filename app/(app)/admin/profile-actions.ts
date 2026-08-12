"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getRequestAuthContext } from "@/utils/app-context";

function redirectWithError(message: string): never {
  redirect(`/admin?error=${encodeURIComponent(message)}`);
}

export async function updateProfile(formData: FormData) {
  const { supabase, user, profile } = await getRequestAuthContext();

  if (!user) {
    redirect("/login");
  }

  if (!profile?.is_admin || !profile.is_active) {
    redirect("/dashboard?error=Admin+access+required");
  }

  const userId = String(formData.get("user_id") ?? "");
  const displayName = String(formData.get("display_name") ?? "").trim();
  const isActive = formData.get("is_active") === "on";
  const isAdmin = formData.get("is_admin") === "on";
  const pick8ParticipationActive = formData.get("pick8_participation_active") === "on";

  if (!userId || !displayName) {
    redirectWithError("Profile details are incomplete.");
  }

  if (displayName.length > 80) {
    redirectWithError("Display names must be 80 characters or fewer.");
  }

  if (userId === user.id && (!isActive || !isAdmin)) {
    redirectWithError(
      "You cannot disable your own account or remove your own administrator access.",
    );
  }

  const { error } = await supabase
    .from("profiles")
    .update({
      display_name: displayName,
      is_active: isActive,
      is_admin: isAdmin,
      pick8_participation_active: pick8ParticipationActive,
      updated_at: new Date().toISOString(),
    })
    .eq("id", userId);

  if (error) {
    redirectWithError(error.message);
  }

  revalidatePath("/admin");
  revalidatePath("/dashboard");
  revalidatePath("/my-picks");
  revalidatePath("/tables");
  redirect("/admin?saved=1");
}
