"use client";

import { createContext, useContext, useState, ReactNode } from "react";
import UniformModal from "./UniformModal";

interface ModalState {
  isOpen: boolean;
  title: string;
  message: ReactNode;
  type: "alert" | "confirm";
  confirmText?: string;
  cancelText?: string;
  onConfirm?: () => void;
  onCancel?: () => void;
}

interface ModalContextType {
  showAlert: (message: ReactNode, title?: string) => Promise<void>;
  showConfirm: (message: ReactNode, title?: string) => Promise<boolean>;
  hideModal: () => void;
}

const ModalContext = createContext<ModalContextType | null>(null);

export function useModal() {
  const context = useContext(ModalContext);
  if (!context) {
    throw new Error("useModal must be used within a ModalProvider");
  }
  return context;
}

interface ModalProviderProps {
  children: ReactNode;
}

export function ModalProvider({ children }: ModalProviderProps) {
  const [modalState, setModalState] = useState<ModalState>({
    isOpen: false,
    title: "",
    message: "",
    type: "alert",
  });

  const showAlert = (message: ReactNode, title = "Alert"): Promise<void> => {
    return new Promise((resolve) => {
      setModalState({
        isOpen: true,
        title,
        message,
        type: "alert",
        onConfirm: resolve,
        onCancel: resolve,
      });
    });
  };

  const showConfirm = (message: ReactNode, title = "Confirm"): Promise<boolean> => {
    return new Promise((resolve) => {
      setModalState({
        isOpen: true,
        title,
        message,
        type: "confirm",
        confirmText: "OK",
        cancelText: "Cancel",
        onConfirm: () => resolve(true),
        onCancel: () => resolve(false),
      });
    });
  };

  const hideModal = () => {
    setModalState((prev) => ({ ...prev, isOpen: false }));
  };

  const handleConfirm = () => {
    if (modalState.onConfirm) {
      modalState.onConfirm();
    }
    hideModal();
  };

  const handleClose = () => {
    // Closing a confirm dialog means "cancel".
    if (modalState.type === "confirm") {
      if (modalState.onCancel) {
        modalState.onCancel();
      }
    } else {
      // Closing an alert should resolve the alert promise.
      if (modalState.onConfirm) {
        modalState.onConfirm();
      }
    }
    hideModal();
  };

  return (
    <ModalContext.Provider value={{ showAlert, showConfirm, hideModal }}>
      {children}
      <UniformModal
        isOpen={modalState.isOpen}
        onClose={handleClose}
        onConfirm={modalState.type === "confirm" ? handleConfirm : undefined}
        title={modalState.title}
        message={modalState.message}
        type={modalState.type}
        confirmText={modalState.confirmText}
        cancelText={modalState.cancelText}
      />
    </ModalContext.Provider>
  );
}