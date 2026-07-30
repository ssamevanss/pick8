"use client";

import { useEffect } from "react";
import { useToast } from "@/components/toast/ToastProvider";

type ToastTriggerProps = {
  title: string;
  description?: string;
  tone?: "success" | "info";
  triggerKey?: string;
};

const consumedToastKeys = new Set<string>();

export default function ToastTrigger({
  title,
  description,
  tone = "success",
  triggerKey,
}: ToastTriggerProps) {
  const { showToast } = useToast();

  useEffect(() => {
    const key = triggerKey ?? `${title}:${description ?? ""}:${tone}`;

    if (consumedToastKeys.has(key)) {
      return;
    }

    consumedToastKeys.add(key);
    window.setTimeout(() => consumedToastKeys.delete(key), 5000);
    showToast({
      title,
      description,
      tone,
    });

    const url = new URL(window.location.href);
    let changed = false;

    for (const param of ["saved", "updated", "requested", "reported"]) {
      if (url.searchParams.has(param)) {
        url.searchParams.delete(param);
        changed = true;
      }
    }

    if (changed) {
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    }
  }, [description, showToast, title, tone, triggerKey]);

  return null;
}
