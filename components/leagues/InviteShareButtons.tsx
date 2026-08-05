"use client";

import { useState } from "react";
import { useToast } from "@/components/toast/ToastProvider";

type InviteShareButtonsProps = {
  code: string;
  leagueName: string;
};

export default function InviteShareButtons({
  code,
  leagueName,
}: InviteShareButtonsProps) {
  const { showToast } = useToast();
  const [isSharing, setIsSharing] = useState(false);
  const [copying, setCopying] = useState<"code" | "link" | null>(null);

  function inviteLink() {
    return `${window.location.origin}/leagues/join?code=${encodeURIComponent(
      code,
    )}`;
  }

  async function copy(
    value: string,
    label: string,
    kind?: "code" | "link",
  ) {
    if (kind) {
      setCopying(kind);
    }
    try {
      await navigator.clipboard.writeText(value);
      showToast({ title: `${label} copied` });
    } catch {
      showToast({
        title: `Could not copy ${label.toLowerCase()}`,
        description: "Select and copy it manually instead.",
        tone: "error",
      });
    } finally {
      if (kind) {
        setCopying(null);
      }
    }
  }

  async function share() {
    if (!navigator.share) {
      await copy(inviteLink(), "Invite link");
      return;
    }

    setIsSharing(true);
    try {
      await navigator.share({
        title: `Join ${leagueName}`,
        text: `Join my Pick8 league with code ${code}.`,
        url: inviteLink(),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }

      showToast({ title: "Could not share invite", tone: "error" });
    } finally {
      setIsSharing(false);
    }
  }

  return (
    <div className="mt-4 grid gap-2 min-[420px]:grid-cols-2 sm:flex sm:flex-wrap">
      <button
        type="button"
        onClick={() => copy(code, "Invite code", "code")}
        disabled={copying !== null || isSharing}
        className="brand-button-secondary w-full sm:w-auto"
      >
        {copying === "code" ? "Copying..." : "Copy code"}
      </button>
      <button
        type="button"
        onClick={() => copy(inviteLink(), "Invite link", "link")}
        disabled={copying !== null || isSharing}
        className="brand-button-secondary w-full sm:w-auto"
      >
        {copying === "link" ? "Copying..." : "Copy link"}
      </button>
      <button
        type="button"
        onClick={share}
        disabled={isSharing || copying !== null}
        className="brand-button-primary w-full min-[420px]:col-span-2 sm:w-auto"
      >
        {isSharing ? "Sharing..." : "Share invite"}
      </button>
    </div>
  );
}
