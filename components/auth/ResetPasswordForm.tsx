"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import PasswordField from "@/components/forms/PasswordField";
import SubmitButton from "@/components/forms/SubmitButton";

type ResetPasswordFormProps = {
  action: (formData: FormData) => void | Promise<void>;
};

export default function ResetPasswordForm({ action }: ResetPasswordFormProps) {
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
    <form action={action} onSubmit={handleSubmit} className="mt-6 space-y-4 text-left">
      {clientError ? (
        <p className="brand-alert-danger">{clientError}</p>
      ) : null}

      <PasswordField
        label="New password"
        name="password"
        autoComplete="new-password"
        minLength={6}
        helperText="Use at least 6 characters."
      />

      <PasswordField
        label="Confirm new password"
        name="confirm_password"
        autoComplete="new-password"
        minLength={6}
      />

      <SubmitButton
        idleLabel="Update password"
        pendingLabel="Updating password..."
        className="brand-button-primary w-full"
      />
    </form>
  );
}
