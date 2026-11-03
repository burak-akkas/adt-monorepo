"use client";

import { Toast, ToastAction } from "@/components/ui";
import { useSaveError } from "@/hooks/useBoard";

// Shown when a change could not be saved and the board went back to the saved version. Always empty with local boards.
export function SaveErrorToast() {
  const { error, dismiss } = useSaveError();
  if (!error) {
    return null;
  }
  return (
    <Toast>
      <span role="alert">{error}</span>
      <ToastAction onClick={dismiss}>Dismiss</ToastAction>
    </Toast>
  );
}
