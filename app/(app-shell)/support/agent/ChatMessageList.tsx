"use client";

export function ChatMessageList({ messages }: { messages: any[] }) {
    return (
        <div className="space-y-3 p-4">
            {messages.map((m) => (
                <div
                    key={m.id}
                    className={`max-w-[75%] p-3 rounded-lg whitespace-pre-wrap ${m.sender === "agent"
                            ? "ml-auto bg-blue-600 text-white"
                            : m.sender === "ai"
                                ? "bg-neutral-200 text-neutral-800"
                                : "bg-neutral-100 text-neutral-900"
                        }`}
                >
                    {m.text}
                </div>
            ))}
        </div>
    );
}
