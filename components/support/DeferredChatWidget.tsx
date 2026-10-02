"use client";

import dynamic from "next/dynamic";

const ChatWidgetProvider = dynamic(() => import("./ChatWidgetProvider"), {
  ssr: false,
});

export default function DeferredChatWidget() {
  return <ChatWidgetProvider />;
}
