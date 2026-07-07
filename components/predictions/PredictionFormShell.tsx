"use client";

import {
  useRef,
  useEffect,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import SubmitButton from "@/components/forms/SubmitButton";
import ToastTrigger from "@/components/toast/ToastTrigger";

type PredictionFormShellProps = {
  action: (formData: FormData) => void | Promise<void>;
  selectedGameweekId: string;
  hasOpenPredictionFixtures: boolean;
  initialSaved: boolean;
  showSavedToast: boolean;
  onEditingChange?: (isEditing: boolean) => void;
  children: ReactNode;
};

function getScoreInputs(form: HTMLFormElement) {
  return Array.from(
    form.querySelectorAll<HTMLInputElement>("input[data-score-input='true']"),
  ).filter((input) => !input.disabled);
}

export default function PredictionFormShell({
  action,
  selectedGameweekId,
  hasOpenPredictionFixtures,
  initialSaved,
  showSavedToast,
  onEditingChange,
  children,
}: PredictionFormShellProps) {
  const [isEditing, setIsEditing] = useState(
    hasOpenPredictionFixtures && !initialSaved,
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    onEditingChange?.(isEditing);
  }, [isEditing, onEditingChange]);

  function focusRelativeScoreInput(
    input: HTMLInputElement,
    direction: 1 | -1,
  ) {
    const form = formRef.current;

    if (!form) {
      return;
    }

    const inputs = getScoreInputs(form);
    const currentIndex = inputs.indexOf(input);
    const nextInput = inputs[currentIndex + direction];

    if (nextInput) {
      nextInput.focus();
      nextInput.select();
    }
  }

  function handleInput(event: FormEvent<HTMLFormElement>) {
    const input = event.target as HTMLInputElement;

    if (input.dataset.scoreInput !== "true") {
      return;
    }

    const nativeEvent = event.nativeEvent as InputEvent;

    if (nativeEvent.inputType.startsWith("delete")) {
      return;
    }

    input.value = input.value.replace(/\D/g, "").slice(0, 1);

    if (input.value.length === 1) {
      focusRelativeScoreInput(input, 1);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    const input = event.target as HTMLInputElement;

    if (input.dataset.scoreInput !== "true") {
      return;
    }

    if (event.key === "Backspace" && input.value === "") {
      event.preventDefault();
      focusRelativeScoreInput(input, -1);
    }
  }

  return (
    <>
      {showSavedToast ? (
        <ToastTrigger
          title="Predictions saved"
          description="You can edit them until kick-off."
          triggerKey={`${selectedGameweekId}:saved`}
        />
      ) : null}

      <form
        ref={formRef}
        action={action}
        className="space-y-3"
        onInput={handleInput}
        onKeyDown={handleKeyDown}
      >
        <input
          type="hidden"
          name="selected_gameweek_id"
          value={selectedGameweekId}
        />

        <fieldset disabled={initialSaved && !isEditing} className="space-y-3">
          {children}
        </fieldset>

        {hasOpenPredictionFixtures ? (
          initialSaved && !isEditing ? (
            <button
              type="button"
              onClick={() => setIsEditing(true)}
              className="brand-button-secondary w-full"
            >
              Edit predictions
            </button>
          ) : (
            <SubmitButton
              idleLabel="Save predictions"
              pendingLabel="Saving predictions..."
              className="brand-button-primary w-full"
            />
          )
        ) : null}
      </form>
    </>
  );
}
