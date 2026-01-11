import React, { useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import { getIdTokenResult } from "firebase/auth";

import PreviewEditor from "@/components/PreviewEditor";
import AppEditor from "./AppEditor";
import PreviewEditorV2 from "./PreviewEditorV2";
import type { UserTier } from "@/src/lib/credits";

type PreviewEditorProps = React.ComponentProps<typeof PreviewEditor>;

type Props = PreviewEditorProps & {
  firebaseUser?: User | null;
  isAdminOverride?: boolean;
  userTier?: UserTier;
  startProCheckout?: () => Promise<void>;
  mode?: "website" | "app";
};

const LS_KEY = "kloner.previewEditor.useV2";

function readLocalFlag(): boolean | null {
  try {
    const v = localStorage.getItem(LS_KEY);
    if (v === "1") return true;
    if (v === "0") return false;
    return null;
  } catch {
    return null;
  }
}

function writeLocalFlag(v: boolean) {
  try {
    localStorage.setItem(LS_KEY, v ? "1" : "0");
  } catch {
    // ignore
  }
}

export default function PreviewEditorManager({
  firebaseUser,
  isAdminOverride,
  userTier,
  startProCheckout,
  mode = "website",
  ...editorProps
}: Props): JSX.Element {
  const [isAdmin, setIsAdmin] = useState<boolean>(!!isAdminOverride);

  useEffect(() => {
    if (typeof isAdminOverride === "boolean") {
      setIsAdmin(isAdminOverride);
      return;
    }
    let cancelled = false;

    (async () => {
      if (!firebaseUser) {
        if (!cancelled) setIsAdmin(false);
        return;
      }
      try {
        const res = await getIdTokenResult(firebaseUser);
        if (!cancelled) setIsAdmin(res?.claims?.admin === true);
      } catch {
        if (!cancelled) setIsAdmin(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [firebaseUser, isAdminOverride]);

  if (mode === "app") {
    return (
      <AppEditor
        firebaseUser={firebaseUser}
        userTier={userTier}
        startProCheckout={startProCheckout}
        initialHtml={editorProps.initialHtml}
        sourceImage={editorProps.sourceImage}
        onClose={editorProps.onClose}
        onExport={editorProps.onExport}
        draftId={editorProps.draftId}
      />
    );
  }

  if (mode === "website" && isAdmin) {
    return (
      <PreviewEditorV2
        {...editorProps}
        isAdmin={isAdmin}
      />
    );
  }

  return <PreviewEditor {...editorProps} />;
}
