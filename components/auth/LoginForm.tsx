"use client";

import Link from "next/link";
import PasswordField from "@/components/forms/PasswordField";
import SubmitButton from "@/components/forms/SubmitButton";

type LoginFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  defaultEmail?: string;
};

export default function LoginForm({ action, defaultEmail = "" }: LoginFormProps) {
  return (
    <form action={action} className="mt-6 space-y-4">
      <div>
        <label className="text-sm text-slate-300" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="username email"
          defaultValue={defaultEmail}
          className="brand-input"
        />
      </div>

      <PasswordField
        label="Password"
        name="password"
        autoComplete="current-password"
      />

      <div className="flex justify-end">
        <Link
          href="/forgot-password"
          className="text-sm font-semibold text-emerald-300 transition hover:text-emerald-200"
        >
          Forgot password?
        </Link>
      </div>

      <SubmitButton
        idleLabel="Sign in"
        pendingLabel="Signing in..."
        className="brand-button-primary w-full"
      />
    </form>
  );
}
