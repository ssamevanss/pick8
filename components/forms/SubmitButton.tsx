"use client";

import { useFormStatus } from "react-dom";

type SubmitButtonProps = {
  idleLabel: string;
  pendingLabel: string;
  className?: string;
  disabled?: boolean;
};

export default function SubmitButton({
  idleLabel,
  pendingLabel,
  className = "",
  disabled = false,
}: SubmitButtonProps) {
  const { pending } = useFormStatus();
  const isDisabled = disabled || pending;

  return (
    <button
      type="submit"
      disabled={isDisabled}
      aria-busy={pending}
      className={`${className} ${
        isDisabled ? "cursor-not-allowed opacity-70" : ""
      }`}
    >
      {pending ? pendingLabel : idleLabel}
    </button>
  );
}
