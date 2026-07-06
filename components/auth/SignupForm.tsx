"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import PasswordField from "@/components/forms/PasswordField";
import SubmitButton from "@/components/forms/SubmitButton";

type SignupFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  defaultEmail?: string;
  defaultDisplayName?: string;
  defaultLeagueCode?: string;
};

export default function SignupForm({
  action,
  defaultEmail = "",
  defaultDisplayName = "",
  defaultLeagueCode = "",
}: SignupFormProps) {
  const [clientError, setClientError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    const formData = new FormData(event.currentTarget);
    const password = String(formData.get("password") ?? "");
    const confirmPassword = String(formData.get("confirm_password") ?? "");

    if (password !== confirmPassword) {
      event.preventDefault();
      setClientError("The passwords do not match.");
      return;
    }

    setClientError(null);
  }

  return (
    <form action={action} onSubmit={handleSubmit} className="mt-6 space-y-4">
      {clientError ? (
        <p className="brand-alert-danger">{clientError}</p>
      ) : null}

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

      <div>
        <label className="text-sm text-slate-300" htmlFor="display_name">
          Display name
        </label>
        <input
          id="display_name"
          name="display_name"
          required
          autoComplete="name"
          defaultValue={defaultDisplayName}
          className="brand-input"
        />
      </div>

      <div>
        <label className="text-sm text-slate-300" htmlFor="league_code">
          Invite code
        </label>
        <input
          id="league_code"
          name="league_code"
          required
          autoComplete="one-time-code"
          defaultValue={defaultLeagueCode}
          className="brand-input"
        />
        <p className="mt-2 text-xs text-slate-400">
          Use the private code shared by your league admin.
        </p>
      </div>

      <PasswordField
        label="Password"
        name="password"
        autoComplete="new-password"
        minLength={6}
        helperText="Use at least 6 characters."
      />

      <PasswordField
        label="Confirm password"
        name="confirm_password"
        autoComplete="new-password"
        minLength={6}
      />

      <SubmitButton
        idleLabel="Request account"
        pendingLabel="Sending request..."
        className="brand-button-primary w-full"
      />
    </form>
  );
}
