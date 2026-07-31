"use client";

type ConfirmCheckboxProps = {
  name: string;
  defaultChecked?: boolean;
  className?: string;
  ariaLabel?: string;
  confirmWhenChecking?: string;
  confirmWhenUnchecking?: string;
  disabled?: boolean;
};

export default function ConfirmCheckbox({
  name,
  defaultChecked = false,
  className,
  ariaLabel,
  confirmWhenChecking,
  confirmWhenUnchecking,
  disabled = false,
}: ConfirmCheckboxProps) {
  return (
    <input
      type="checkbox"
      name={name}
      defaultChecked={defaultChecked}
      aria-label={ariaLabel}
      disabled={disabled}
      className={className}
      onChange={(event) => {
        const message = event.currentTarget.checked
          ? confirmWhenChecking
          : confirmWhenUnchecking;

        if (message && !window.confirm(message)) {
          event.currentTarget.checked = !event.currentTarget.checked;
        }
      }}
    />
  );
}
