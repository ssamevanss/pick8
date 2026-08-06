"use client";

import PasswordField from "@/components/forms/PasswordField";
import SubmitButton from "@/components/forms/SubmitButton";

export default function SignupForm({ action, defaultDisplayName = "", defaultEmail = "" }: {
  action: (formData: FormData) => void | Promise<void>;
  defaultDisplayName?: string;
  defaultEmail?: string;
}) {
  return (
    <form action={action} className="mt-6 space-y-4 text-left">
      <label className="block text-sm text-slate-300">Display name<input className="brand-input" name="display_name" required maxLength={80} autoComplete="name" defaultValue={defaultDisplayName} /></label>
      <label className="block text-sm text-slate-300">Email<input className="brand-input" name="email" type="email" required autoComplete="email" defaultValue={defaultEmail} /></label>
      <PasswordField label="Password" name="password" autoComplete="new-password" />
      <PasswordField label="Confirm password" name="confirm_password" autoComplete="new-password" />
      <label className="block text-sm text-slate-300">Private registration code<input className="brand-input" name="registration_code" type="password" required autoComplete="off" /></label>
      <SubmitButton idleLabel="Create Account" pendingLabel="Creating account…" className="brand-button-primary w-full" />
    </form>
  );
}
