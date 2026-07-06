"use client";

import { useEffect } from "react";
import { useToast } from "@/components/toast/ToastProvider";

type ToastTriggerProps = {
  title: string;
  description?: string;
  tone?: "success" | "info";
  triggerKey?: string;
};

export default function ToastTrigger({
  title,
  description,
  tone = "success",
  triggerKey,
}: ToastTriggerProps) {
  const { showToast } = useToast();

  useEffect(() => {
    showToast({
      title,
      description,
      tone,
    });
  }, [description, showToast, title, tone, triggerKey]);

  return null;
}
