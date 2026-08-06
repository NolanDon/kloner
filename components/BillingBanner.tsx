"use client";

import Image from "next/image";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";

type BillingBannerProps = {
    ctaHref: string;
    ctaLabel: string;
};

export default function BillingBanner({ ctaHref, ctaLabel }: BillingBannerProps): JSX.Element {
    return (
        <div className="mx-auto mt-10 max-w-6xl rounded-[24px] border border-black/10 bg-white px-5 py-5 shadow-[0_10px_24px_rgba(15,23,42,0.08)] sm:px-8 sm:py-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
                <div className="space-y-3">
                    <p className="text-lg font-semibold leading-6 text-neutral-900">
                        Minimal billing, secure checkout.
                    </p>
                    <div className="flex items-center gap-3 text-sm leading-6 text-neutral-500">
                        <ShieldCheck className="h-5 w-5 shrink-0 text-neutral-400" />
                        <span>Cancel anytime before renewal. Cards and checkout are handled by Stripe.</span>
                    </div>
                </div>

                <div className="flex items-center gap-3 text-sm font-semibold text-neutral-700 sm:pt-0.5">
                    <span className="whitespace-nowrap">Secure checkout with</span>
                    <Image
                        src="/images/stripe.png"
                        alt="Stripe"
                        width={240}
                        height={80}
                        className="h-12 w-auto shrink-0 object-contain sm:h-14"
                    />
                </div>
            </div>

            <div className="mt-6 flex justify-center">
                <Link
                    href={ctaHref}
                    className="text-sm font-semibold text-neutral-700 underline underline-offset-4 hover:text-neutral-900"
                >
                    {ctaLabel}
                </Link>
            </div>
        </div>
    );
}
