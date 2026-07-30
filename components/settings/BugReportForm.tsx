"use client";

import { useEffect, useRef } from "react";
import SubmitButton from "@/components/forms/SubmitButton";

type BugReportFormProps = {
  action: (formData: FormData) => void;
};

export default function BugReportForm({ action }: BugReportFormProps) {
  const pageUrlInputRef = useRef<HTMLInputElement>(null);
  const userAgentInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (pageUrlInputRef.current) {
      pageUrlInputRef.current.value = window.location.href;
    }

    if (userAgentInputRef.current) {
      userAgentInputRef.current.value = window.navigator.userAgent;
    }
  }, []);

  return (
    <form action={action} className="mt-5 space-y-3">
      <input ref={pageUrlInputRef} type="hidden" name="page_url" />
      <input ref={userAgentInputRef} type="hidden" name="user_agent" />

      <label className="block">
        <span className="text-sm font-semibold text-slate-300">
          What went wrong?
        </span>
        <textarea
          name="message"
          required
          minLength={5}
          maxLength={4000}
          rows={5}
          placeholder="Tell us what happened, what you expected, and anything that might help reproduce it."
          className="brand-input mt-2 min-h-32 resize-y"
        />
      </label>

      <SubmitButton
        idleLabel="Send bug report"
        pendingLabel="Sending report..."
        className="brand-button-secondary w-full sm:w-fit"
      />
    </form>
  );
}
