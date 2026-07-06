"use client";

import SubmitButton from "@/components/forms/SubmitButton";

type ForgotPasswordFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  defaultEmail?: string;
};

export default function ForgotPasswordForm({
  action,
  defaultEmail = "",
}: ForgotPasswordFormProps) {
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

      <SubmitButton
        idleLabel="Send reset link"
        pendingLabel="Sending link..."
        className="brand-button-primary w-full"
      />
    </form>
  );
}
