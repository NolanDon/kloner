"use client";

import { ReactNode, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";

type ModalType = "alert" | "confirm";

interface UniformModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm?: () => void;
  title: string;
  message: ReactNode;
  type?: ModalType;
  confirmText?: string;
  cancelText?: string;
}

export default function UniformModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  type = "alert",
  confirmText = "OK",
  cancelText = "Cancel",
}: UniformModalProps) {
  // Handle escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen, onClose]);

  const handleConfirm = () => {
    if (type === "confirm") {
      // Confirm flows are closed by the provider's onConfirm handler.
      if (onConfirm) onConfirm();
      return;
    }

    // Alert flows simply close the modal.
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="uniform-modal"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[20000] flex items-center justify-center bg-black/40 p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="w-full max-w-md rounded-2xl border border-neutral-200 bg-white shadow-2xl"
          >
            <div className="flex items-start justify-between gap-4 border-b border-neutral-200 px-5 py-4">
              <div className="space-y-1">
                <div className="text-sm font-semibold text-neutral-900">
                  {title}
                </div>
              </div>

              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-neutral-100 hover:bg-neutral-200"
                title="Close"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className="h-4 w-4 text-neutral-700"
                >
                  <path
                    fillRule="evenodd"
                    d="M4.47 4.47a.75.75 0 011.06 0L10 8.94l4.47-4.47a.75.75 0 111.06 1.06L11.06 10l4.47 4.47a.75.75 0 11-1.06 1.06L10 11.06l-4.47 4.47a.75.75 0 11-1.06-1.06L8.94 10 4.47 5.53a.75.75 0 010-1.06z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            </div>

            <div className="px-5 py-4">
              <div className="text-sm text-neutral-700 whitespace-pre-wrap">
                {message}
              </div>
            </div>

            <div className="flex justify-end gap-3 border-t border-neutral-200 px-5 py-4">
              {type === "confirm" && (
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-sm font-medium text-neutral-700 bg-white border border-neutral-200 rounded-lg hover:bg-neutral-50"
                >
                  {cancelText}
                </button>
              )}
              <button
                type="button"
                onClick={handleConfirm}
                className="px-4 py-2 text-sm font-medium text-white bg-[#f55f2a] rounded-lg"
              >
                {confirmText}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// Utility functions to replace window.alert and window.confirm
export function showAlert(message: string, title = "Alert") {
  return new Promise<void>((resolve) => {
    // This would need to be implemented with a global modal context
    // For now, we'll keep the existing behavior but with a plan to replace
    window.alert(message);
    resolve();
  });
}

export function showConfirm(message: string, title = "Confirm") {
  return new Promise<boolean>((resolve) => {
    // This would need to be implemented with a global modal context
    // For now, we'll keep the existing behavior but with a plan to replace
    const result = window.confirm(message);
    resolve(result);
  });
}