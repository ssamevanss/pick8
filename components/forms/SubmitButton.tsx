"use client";

import { useFormStatus } from "react-dom";

type SubmitButtonProps = {
  idleLabel: string;
  pendingLabel: string;
  className?: string;
};

export default function SubmitButton({
  idleLabel,
  pendingLabel,
  className = "",
}: SubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className={`${className} ${
        pending ? "cursor-wait opacity-70" : ""
      }`}
    >
      {pending ? pendingLabel : idleLabel}
    </button>
  );
}