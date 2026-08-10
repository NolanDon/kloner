// app/api/stripe/webhook/route.test.ts

export {};

const firestoreStore = new Map<string, Record<string, any>>();
const resendSend = jest.fn();

jest.mock("next/server", () => {
  return {
    __esModule: true,
    NextResponse: {
      json: (body: any, init?: { status?: number }) => {
        return {
          status: init?.status ?? 200,
          async json() {
            return body;
          },
        };
      },
    },
  };
});

jest.mock("resend", () => {
  return {
    __esModule: true,
    Resend: jest.fn(() => ({
      emails: {
        send: resendSend,
      },
    })),
  };
});

const linkCustomerToUid = jest.fn<Promise<void>, [string, string]>(
  async () => {},
);
const setUserTierFromStripe = jest.fn<Promise<void>, [string, string, any]>(
  async () => {},
);
const mapPriceToTier = jest.fn<string, [string | null]>(
  (priceId: string | null) => (priceId ? "pro" : "free"),
);
const effectiveTierFromStripeSubscription = jest.fn<string, [any]>(
  (args: any) => {
    const status = typeof args?.status === "string" ? args.status : "";
    return status === "active" || status === "trialing"
      ? args?.mappedTier || "free"
      : "free";
  },
);
const getUidForStripeCustomer = jest.fn<Promise<string | null>, [string]>(
  async () => "uid_1",
);

jest.mock("../../_lib/billing", () => {
  return {
    __esModule: true,
    getUidForStripeCustomer: (customerId: string) =>
      getUidForStripeCustomer(customerId),
    linkCustomerToUid: (customerId: string, uid: string) =>
      linkCustomerToUid(customerId, uid),
    mapPriceToTier: (priceId: string | null) => mapPriceToTier(priceId),
    effectiveTierFromStripeSubscription: (args: any) =>
      effectiveTierFromStripeSubscription(args),
    setUserTierFromStripe: (uid: string, tier: string, stripeData: any) =>
      setUserTierFromStripe(uid, tier, stripeData),
  };
});

// Avoid firebase-admin init requiring FIREBASE_SERVICE_ACCOUNT
jest.mock("firebase-admin", () => {
  const keyFor = (name: string, id: string) => `${name}/${id}`;
  const getData = (key: string) => {
    const data = firestoreStore.get(key);
    return data ? { ...data } : undefined;
  };
  const setData = (key: string, data: any, opts?: { merge?: boolean }) => {
    const prev = firestoreStore.get(key) ?? {};
    firestoreStore.set(key, opts?.merge ? { ...prev, ...data } : { ...data });
  };
  const db = {
    collection: (name: string) => ({
      doc: (id: string) => {
        const key = keyFor(name, id);
        return {
          id,
          _collection: name,
          get: async () => {
            const data = getData(key);
            return {
              exists: !!data,
              data: () => (data ? { ...data } : undefined),
            };
          },
          set: async (data: any, opts?: { merge?: boolean }) => {
            setData(key, data, opts);
          },
        };
      },
    }),
    runTransaction: async (handler: any) => {
      const tx = {
        get: async (ref: any) => {
          return ref.get();
        },
        set: (ref: any, data: any, opts?: { merge?: boolean }) => {
          const name = String((ref as any)?._collection || "kloner_users");
          const id = String((ref as any)?.id || "uid_1");
          const key = keyFor(name, id);
          setData(key, data, opts);
        },
      };
      return handler(tx);
    },
  };
  const firestore = () => db;
  (firestore as any).FieldValue = {
    serverTimestamp: () => ({ __serverTimestamp: true }),
  };
  return {
    __esModule: true,
    default: {
      apps: [{}],
      firestore,
      auth: () => ({
        getUser: async (uid: string) => ({
          uid,
          email: `${uid}@example.com`,
          displayName: "Nolan",
        }),
      }),
    },
  };
});

describe("POST /api/stripe/webhook", () => {
  beforeEach(() => {
    jest.resetModules();
    linkCustomerToUid.mockClear();
    setUserTierFromStripe.mockClear();
    mapPriceToTier.mockClear();
    effectiveTierFromStripeSubscription.mockClear();
    getUidForStripeCustomer.mockClear();
    resendSend.mockClear();
    firestoreStore.clear();

    process.env.STRIPE_WEBHOOK_SECRET_TEST = "whsec_test";
    process.env.STRIPE_WEBHOOK_SECRET_LIVE = "";
    process.env.STRIPE_SECRET_KEY_TEST = "sk_test_123";
    process.env.STRIPE_SECRET_KEY_LIVE = "";
    process.env.STRIPE_SECRET_KEY = "";
    process.env.EMAIL_LINK_SECRET = "email-secret";
    process.env.RESEND_API_KEY = "resend_test";
    process.env.NEXT_PUBLIC_SITE_URL = "https://kloner.app";
  });

  it("checkout.session.completed links customer to firebaseUid", async () => {
    const constructEvent = jest.fn(() => ({
      id: "evt_1",
      type: "checkout.session.completed",
      livemode: false,
      data: {
        object: {
          metadata: { firebaseUid: "uid_abc" },
          customer: "cus_abc",
        },
      },
    }));

    jest.doMock("stripe", () => {
      return {
        __esModule: true,
        default: function StripeCtor() {
          return {
            webhooks: { constructEvent },
            invoices: { retrieve: async () => ({}) },
          };
        },
      };
    });

    const { POST } = await import("./route");

    const req = {
      headers: {
        get: (k: string) => (k === "stripe-signature" ? "sig" : null),
      },
      text: async () => "{}",
    } as any;

    const res: any = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.received).toBe(true);
    expect(linkCustomerToUid).toHaveBeenCalledWith("cus_abc", "uid_abc");
  });

  it("checkout.session.completed sends the trial welcome email when the checkout is trial-eligible", async () => {
    firestoreStore.set("kloner_users/uid_abc", {});

    const constructEvent = jest.fn(() => ({
      id: "evt_trial",
      type: "checkout.session.completed",
      livemode: false,
      data: {
        object: {
          id: "cs_trial",
          metadata: {
            firebaseUid: "uid_abc",
            plan: "pro",
            trialWelcomeEmail: "1",
          },
          customer: "cus_trial",
        },
      },
    }));

    jest.doMock("stripe", () => {
      return {
        __esModule: true,
        default: function StripeCtor() {
          return {
            webhooks: { constructEvent },
            invoices: { retrieve: async () => ({}) },
          };
        },
      };
    });

    const { POST } = await import("./route");

    const req = {
      headers: {
        get: (k: string) => (k === "stripe-signature" ? "sig" : null),
      },
      text: async () => "{}",
    } as any;

    const res: any = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.received).toBe(true);
    expect(resendSend).toHaveBeenCalledTimes(1);

    const payload = resendSend.mock.calls[0]?.[0];
    expect(payload.subject).toBe("Welcome to your Kloner trial");
    expect(String(payload.text)).toContain(
      "Visit the dashboard and enter a URL in the top field",
    );
    expect(String(payload.text)).toContain("Open your dashboard:");
    expect(String(payload.text)).not.toContain("Generate website");
    expect(String(payload.text)).not.toContain("Next.js");
    expect(String(payload.text)).not.toContain("reply to this email");

    const userDoc = firestoreStore.get("kloner_users/uid_abc") || {};
    expect(userDoc.trialWelcomeEmailSessionId).toBe("cs_trial");
    expect(userDoc.trialWelcomeEmailSentAt).toBeTruthy();
  });

  it("customer.subscription.updated sets tier to paid tier when status is trialing", async () => {
    const constructEvent = jest.fn(() => ({
      id: "evt_2",
      type: "customer.subscription.updated",
      livemode: false,
      data: {
        object: {
          id: "sub_1",
          status: "trialing",
          customer: "cus_1",
          items: { data: [{ price: { id: "price_live_pro" } }] },
          current_period_end: 123,
          trial_end: 456,
          cancel_at_period_end: false,
        },
      },
    }));

    jest.doMock("stripe", () => {
      return {
        __esModule: true,
        default: function StripeCtor() {
          return {
            webhooks: { constructEvent },
            invoices: { retrieve: async () => ({}) },
          };
        },
      };
    });

    mapPriceToTier.mockReturnValueOnce("pro");
    getUidForStripeCustomer.mockResolvedValueOnce("uid_1");

    const { POST } = await import("./route");

    const req = {
      headers: {
        get: (k: string) => (k === "stripe-signature" ? "sig" : null),
      },
      text: async () => "{}",
    } as any;

    const res: any = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.received).toBe(true);

    expect(setUserTierFromStripe).toHaveBeenCalledWith(
      "uid_1",
      "pro",
      expect.objectContaining({
        customerId: "cus_1",
        subscriptionId: "sub_1",
        priceId: "price_live_pro",
        status: "trialing",
      }),
    );
  });

  it("checkout.session.expired sends a one-time recovery email for abandoned pro checkout", async () => {
    firestoreStore.set("kloner_users/uid_abc", {
      stripeCustomerId: "cus_abc",
      notificationPrefs: {
        journeyEmails: true,
      },
    });

    const constructEvent = jest.fn(() => ({
      id: "evt_expired",
      type: "checkout.session.expired",
      livemode: false,
      data: {
        object: {
          id: "cs_expired",
          metadata: {
            firebaseUid: "uid_abc",
            plan: "pro",
          },
          customer: "cus_abc",
        },
      },
    }));

    jest.doMock("stripe", () => {
      return {
        __esModule: true,
        default: function StripeCtor() {
          return {
            webhooks: { constructEvent },
            invoices: { retrieve: async () => ({}) },
          };
        },
      };
    });

    const { POST } = await import("./route");

    const req = {
      headers: {
        get: (k: string) => (k === "stripe-signature" ? "sig" : null),
      },
      text: async () => "{}",
    } as any;

    const res: any = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.received).toBe(true);
    expect(resendSend).toHaveBeenCalledTimes(1);
    const payload = resendSend.mock.calls[0]?.[0];
    expect(payload.subject).toContain("Still want");
    expect(String(payload.text)).toContain("/api/billing/recovery-checkout?t=");
    expect(String(payload.text)).toContain("/api/email/unsubscribe?t=");
    const userDoc = firestoreStore.get("kloner_users/uid_abc") || {};
    expect(userDoc.offers?.exitOffer40RecoveryEmailSentAt).toBeTruthy();
  });

  it("does not send the recovery email when the user was recently active", async () => {
    firestoreStore.set("kloner_users/uid_abc", {
      stripeCustomerId: "cus_abc",
      notificationPrefs: {
        journeyEmails: true,
      },
      lastAppActivityAt: Date.now(),
    });

    const constructEvent = jest.fn(() => ({
      id: "evt_expired",
      type: "checkout.session.expired",
      livemode: false,
      data: {
        object: {
          id: "cs_expired",
          metadata: {
            firebaseUid: "uid_abc",
            plan: "pro",
          },
          customer: "cus_abc",
        },
      },
    }));

    jest.doMock("stripe", () => {
      return {
        __esModule: true,
        default: function StripeCtor() {
          return {
            webhooks: { constructEvent },
            invoices: { retrieve: async () => ({}) },
          };
        },
      };
    });

    const { POST } = await import("./route");

    const req = {
      headers: {
        get: (k: string) => (k === "stripe-signature" ? "sig" : null),
      },
      text: async () => "{}",
    } as any;

    const res: any = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.received).toBe(true);
    expect(resendSend).not.toHaveBeenCalled();
  });

  it("does not send the recovery email when journey emails are unsubscribed", async () => {
    firestoreStore.set("kloner_users/uid_abc", {
      stripeCustomerId: "cus_abc",
      notificationPrefs: {
        journeyEmails: false,
      },
    });

    const constructEvent = jest.fn(() => ({
      id: "evt_expired",
      type: "checkout.session.expired",
      livemode: false,
      data: {
        object: {
          id: "cs_expired",
          metadata: {
            firebaseUid: "uid_abc",
            plan: "pro",
          },
          customer: "cus_abc",
        },
      },
    }));

    jest.doMock("stripe", () => {
      return {
        __esModule: true,
        default: function StripeCtor() {
          return {
            webhooks: { constructEvent },
            invoices: { retrieve: async () => ({}) },
          };
        },
      };
    });

    const { POST } = await import("./route");

    const req = {
      headers: {
        get: (k: string) => (k === "stripe-signature" ? "sig" : null),
      },
      text: async () => "{}",
    } as any;

    const res: any = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.received).toBe(true);
    expect(resendSend).not.toHaveBeenCalled();
  });
});
