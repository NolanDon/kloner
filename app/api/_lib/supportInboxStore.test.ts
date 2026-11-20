// app/api/_lib/supportInboxStore.test.ts
// Runs the store against a small in-memory Firestore fake that supports
// exactly the operations the store uses.

export {};

jest.mock("firebase-admin/firestore", () => ({
    __esModule: true,
    FieldValue: {
        increment: (n: number) => ({ __increment: n }),
        arrayUnion: (...elements: unknown[]) => ({ __arrayUnion: elements }),
    },
}));

import {
    appendOutboundMessage,
    countUnreadThreads,
    getThread,
    listMessages,
    listThreads,
    storeInboundEmail,
} from "./supportInboxStore";
import type { ReceivedEmail } from "./supportInbox";

type DocData = Record<string, any>;

function applyUpdate(current: DocData, updates: DocData): DocData {
    const next = { ...current };
    for (const [key, value] of Object.entries(updates)) {
        if (value && typeof value === "object" && "__increment" in value) {
            next[key] = (typeof next[key] === "number" ? next[key] : 0) + value.__increment;
        } else if (value && typeof value === "object" && "__arrayUnion" in value) {
            const arr = Array.isArray(next[key]) ? [...next[key]] : [];
            for (const el of value.__arrayUnion) if (!arr.includes(el)) arr.push(el);
            next[key] = arr;
        } else {
            next[key] = value;
        }
    }
    return next;
}

class FakeDocRef {
    constructor(
        private store: Map<string, DocData>,
        private path: string
    ) {}
    get id(): string {
        return this.path.split("/").pop() as string;
    }
    async get() {
        const data = this.store.get(this.path);
        return {
            exists: data !== undefined,
            id: this.id,
            ref: this,
            data: () => (data ? { ...data } : undefined),
        };
    }
    async set(data: DocData) {
        this.store.set(this.path, { ...data });
    }
    async update(data: DocData) {
        this.store.set(this.path, applyUpdate(this.store.get(this.path) || {}, data));
    }
    collection(name: string) {
        return new FakeCollection(this.store, `${this.path}/${name}`);
    }
}

type Filter = { field: string; op: string; value: unknown };

class FakeQuery {
    protected filters: Filter[] = [];
    protected orderField: string | null = null;
    protected orderDir: "asc" | "desc" = "asc";
    protected limitN: number | null = null;
    constructor(
        protected store: Map<string, DocData>,
        protected path: string
    ) {}
    where(field: string, op: string, value: unknown) {
        const q = new FakeQuery(this.store, this.path);
        q.filters = [...this.filters, { field, op, value }];
        q.orderField = this.orderField;
        q.orderDir = this.orderDir;
        q.limitN = this.limitN;
        return q;
    }
    orderBy(field: string, dir: "asc" | "desc" = "asc") {
        const q = new FakeQuery(this.store, this.path);
        q.filters = this.filters;
        q.orderField = field;
        q.orderDir = dir;
        q.limitN = this.limitN;
        return q;
    }
    limit(n: number) {
        const q = new FakeQuery(this.store, this.path);
        q.filters = this.filters;
        q.orderField = this.orderField;
        q.orderDir = this.orderDir;
        q.limitN = n;
        return q;
    }
    protected matchingDocs(): Array<{ id: string; path: string; data: DocData }> {
        const prefix = `${this.path}/`;
        const rows: Array<{ id: string; path: string; data: DocData }> = [];
        for (const [path, data] of this.store.entries()) {
            if (!path.startsWith(prefix)) continue;
            const rest = path.slice(prefix.length);
            if (rest.includes("/")) continue;
            rows.push({ id: rest, path, data });
        }
        const filtered = rows.filter((row) =>
            this.filters.every((f) => {
                if (f.op === "==") return row.data[f.field] === f.value;
                if (f.op === "array-contains") return Array.isArray(row.data[f.field]) && row.data[f.field].includes(f.value);
                throw new Error(`Unsupported op ${f.op}`);
            })
        );
        if (this.orderField) {
            const field = this.orderField;
            const dir = this.orderDir === "desc" ? -1 : 1;
            filtered.sort((a, b) => ((a.data[field] ?? 0) < (b.data[field] ?? 0) ? -1 : 1) * dir);
        }
        return this.limitN ? filtered.slice(0, this.limitN) : filtered;
    }
    async get() {
        const rows = this.matchingDocs();
        return {
            empty: rows.length === 0,
            size: rows.length,
            docs: rows.map((row) => ({
                id: row.id,
                ref: new FakeDocRef(this.store, row.path),
                data: () => ({ ...row.data }),
            })),
        };
    }
}

let autoId = 0;
class FakeCollection extends FakeQuery {
    doc(id?: string) {
        return new FakeDocRef(this.store, `${this.path}/${id ?? `auto_${++autoId}`}`);
    }
    async add(data: DocData) {
        const ref = this.doc();
        await ref.set(data);
        return ref;
    }
}

function makeFakeDb() {
    const store = new Map<string, DocData>();
    return {
        store,
        db: {
            collection: (name: string) => new FakeCollection(store, name),
        } as unknown as FirebaseFirestore.Firestore,
    };
}

function inbound(overrides: Partial<ReceivedEmail> = {}): ReceivedEmail {
    return {
        id: "resend_1",
        from: "Jane Doe <jane@example.com>",
        to: ["support@kloner.app"],
        subject: "Help with my site",
        text: "My site will not publish.",
        html: null,
        message_id: "<m1@example.com>",
        headers: {},
        attachments: [],
        ...overrides,
    };
}

describe("storeInboundEmail", () => {
    it("creates a thread for a first email and indexes it", async () => {
        const { db } = makeFakeDb();
        const result = await storeInboundEmail(db, inbound(), 1000);
        expect(result).toEqual({ threadId: expect.any(String), created: true, duplicate: false });

        const thread = await getThread(db, result.threadId);
        expect(thread).toMatchObject({
            subject: "Help with my site",
            fromEmail: "jane@example.com",
            fromName: "Jane Doe",
            status: "open",
            unread: true,
            messageCount: 1,
            messageIds: ["<m1@example.com>"],
        });
        const messages = await listMessages(db, result.threadId);
        expect(messages).toHaveLength(1);
        expect(messages[0]).toMatchObject({ direction: "in", text: "My site will not publish." });
        expect(await countUnreadThreads(db)).toBe(1);
    });

    it("does not store the same Resend email twice", async () => {
        const { db } = makeFakeDb();
        const first = await storeInboundEmail(db, inbound(), 1000);
        const second = await storeInboundEmail(db, inbound(), 2000);
        expect(second.duplicate).toBe(true);
        expect(second.threadId).toBe(first.threadId);
        expect(await listMessages(db, first.threadId)).toHaveLength(1);
    });

    it("threads a reply by its References header", async () => {
        const { db } = makeFakeDb();
        const first = await storeInboundEmail(db, inbound(), 1000);
        const reply = await storeInboundEmail(
            db,
            inbound({
                id: "resend_2",
                subject: "Re: Help with my site",
                text: "Still broken after the fix.",
                message_id: "<m2@example.com>",
                headers: { References: "<m1@example.com>", "In-Reply-To": "<m1@example.com>" },
            }),
            2000
        );
        expect(reply.created).toBe(false);
        expect(reply.threadId).toBe(first.threadId);
        const thread = await getThread(db, first.threadId);
        expect(thread?.messageCount).toBe(2);
        expect(thread?.messageIds).toEqual(["<m1@example.com>", "<m2@example.com>"]);
    });

    it("threads by same sender and same subject when headers are missing", async () => {
        const { db } = makeFakeDb();
        const first = await storeInboundEmail(db, inbound(), 1000);
        const again = await storeInboundEmail(
            db,
            inbound({ id: "resend_3", message_id: "<m3@example.com>", text: "Any update?" }),
            3000
        );
        expect(again.threadId).toBe(first.threadId);
    });

    it("starts a new thread for a different sender", async () => {
        const { db } = makeFakeDb();
        const first = await storeInboundEmail(db, inbound(), 1000);
        const other = await storeInboundEmail(
            db,
            inbound({ id: "resend_4", from: "bob@example.com", message_id: "<m9@example.com>" }),
            2000
        );
        expect(other.threadId).not.toBe(first.threadId);
        const threads = await listThreads(db);
        expect(threads).toHaveLength(2);
        expect(threads[0].id).toBe(other.threadId); // most recent activity first
    });
});

describe("appendOutboundMessage", () => {
    it("adds the reply to the thread and updates the summary", async () => {
        const { db } = makeFakeDb();
        const { threadId } = await storeInboundEmail(db, inbound(), 1000);
        await appendOutboundMessage(
            db,
            threadId,
            {
                from: "Kloner Support <support@kloner.app>",
                to: "jane@example.com",
                subject: "Re: Help with my site",
                text: "Fixed. Try publishing again.",
                resendId: "sent_1",
            },
            5000
        );
        const messages = await listMessages(db, threadId);
        expect(messages).toHaveLength(2);
        expect(messages[1]).toMatchObject({ direction: "out", resendId: "sent_1" });
        const thread = await getThread(db, threadId);
        expect(thread).toMatchObject({ messageCount: 2, lastMessageAt: 5000, snippet: "Fixed. Try publishing again." });
    });
});
