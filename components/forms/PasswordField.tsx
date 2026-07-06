"use client";

import { useId, useState } from "react";

type PasswordFieldProps = {
  label: string;
  name: string;
  autoComplete: string;
  helperText?: string;
  minLength?: number;
};

export default function PasswordField({
  label,
  name,
  autoComplete,
  helperText,
  minLength,
}: PasswordFieldProps) {
  const [showPassword, setShowPassword] = useState(false);
  const helperId = useId();

  return (
    <div>
      <label className="text-sm text-slate-300" htmlFor={name}>
        {label}
      </label>
      <div className="mt-2 flex rounded-xl border border-white/10 bg-slate-950/80 focus-within:border-emerald-400/70 focus-within:ring-2 focus-within:ring-emerald-400/20">
        <input
          id={name}
          name={name}
          type={showPassword ? "text" : "password"}
          required
          minLength={minLength}
          autoComplete={autoComplete}
          aria-describedby={helperText ? helperId : undefined}
          className="min-w-0 flex-1 rounded-l-xl bg-transparent px-3 py-3 text-sm text-white outline-none placeholder:text-slate-500"
        />
        <button
          type="button"
          onClick={() => setShowPassword((current) => !current)}
          className="rounded-r-xl px-3 text-sm font-semibold text-emerald-300 transition hover:bg-white/5 hover:text-emerald-200"
          aria-label={showPassword ? "Hide password" : "Show password"}
        >
          {showPassword ? "Hide" : "Show"}
        </button>
      </div>
      {helperText ? (
        <p id={helperId} className="mt-2 text-xs text-slate-400">
          {helperText}
        </p>
      ) : null}
    </div>
  );
}
