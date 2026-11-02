// components/ParallaxTypeHero.tsx
'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import { ArrowRightSquare } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { auth } from '@/lib/firebase';
import { getPublicHttpUrlRejectionReason, stripProtocol, validateAndNormalizePublicHttpUrl } from '@/src/lib/publicHttpUrl';

type Props = {
    headline?: string;
    subcopy?: string;
    vignette?: number;
    showUrlInput?: boolean;
};

export default function ParallaxTypeHero({
    headline = 'Clone a website from a URL.',
    subcopy = 'Start for free',
    vignette = 0.35,
    showUrlInput = false,
}: Props) {
    const router = useRouter();
    const [url, setUrl] = useState('');
    const [error, setError] = useState<string | null>(null);

    return (
        <section className="relative w-full overflow-clip border-b rounded-xl" style={{ height: '100vh' }}>
            <div aria-hidden className="absolute inset-0 z-0 overflow-hidden">
                <div className="absolute -inset-[6vh]">
                    <div className="relative h-full w-full">
                        <Image
                            src="/images/hero_bg.png"
                            alt="Hero background"
                            fill
                            priority={false}
                            sizes="100vw"
                            className="absolute inset-0 h-full w-full object-cover select-none pointer-events-none"
                        />
                        <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-black/30 to-black/10" />
                        <div className="absolute inset-0 bg-gradient-to-tr from-black/25 via-transparent to-black/15" />
                    </div>
                </div>
                <div
                    className="absolute inset-0"
                    style={{
                        background:
                            'radial-gradient(120% 140% at 20% 20%, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0.25) 45%, rgba(0,0,0,0) 70%)',
                        opacity: vignette,
                    }}
                />
                <div
                    className="absolute inset-0"
                    style={{
                        background: 'linear-gradient(to top, rgba(0,0,0,0.6), rgba(0,0,0,0.15) 35%, rgba(0,0,0,0))',
                        opacity: 0.9,
                    }}
                />
            </div>

            <div className="relative z-10 sticky top-0 flex h-screen items-center">
                <div className="mx-auto w-full max-w-6xl px-6">
                    <h2 className="parallax-hero-copy max-w-2xl text-5xl font-semibold leading-tight tracking-tight text-white md:text-6xl">
                        {headline}
                    </h2>

                    <div className="parallax-hero-form">
                        <div className="mt-5 md:mt-6">
                            {showUrlInput ? (
                                <form
                                    onSubmit={(event) => {
                                        event.preventDefault();
                                        const normalized = validateAndNormalizePublicHttpUrl(stripProtocol(url));
                                        if (!normalized) {
                                            setError(getPublicHttpUrlRejectionReason(stripProtocol(url)) || 'Please enter a valid public http(s) URL.');
                                            return;
                                        }
                                        setError(null);
                                        if (auth.currentUser) {
                                            router.replace(`/dashboard/view?u=${encodeURIComponent(normalized)}&focusUrl=1`);
                                        } else {
                                            try { localStorage.setItem('kloner.pendingUrl', normalized); } catch { /* ignore */ }
                                            router.push(`/login?mode=signup&u=${encodeURIComponent(normalized)}`);
                                        }
                                    }}
                                    className="w-full max-w-2xl space-y-3"
                                >
                                    <div className="rounded-full bg-white/95 p-2 shadow-[0_20px_50px_rgba(0,0,0,0.3)] ring-1 ring-white/20 backdrop-blur-md">
                                        <div className="flex items-stretch gap-2">
                                            <div className="flex min-h-[48px] flex-1 items-center rounded-full px-4 sm:px-6">
                                                <span className="hidden sm:inline text-neutral-400 text-lg font-medium mr-1">https://</span>
                                                <input
                                                    value={url}
                                                    onChange={(event) => { const value = stripProtocol(event.target.value); setUrl(value); setError(value && !validateAndNormalizePublicHttpUrl(value) ? 'Please enter a valid public http(s) URL.' : null); }}
                                                    placeholder="example.com"
                                                    inputMode="url"
                                                    autoCapitalize="none"
                                                    autoComplete="off"
                                                    aria-label="Website URL"
                                                    className="w-full bg-transparent outline-none text-neutral-700 text-base sm:text-lg placeholder:text-neutral-400 font-medium"
                                                />
                                            </div>
                                            <button type="submit" disabled={!url || !!error} className="inline-flex min-h-[48px] w-12 shrink-0 items-center justify-center rounded-full bg-[#FF8D21] text-white shadow-sm transition-all duration-200 hover:scale-[1.04] hover:shadow-[0_10px_24px_rgba(255,141,33,0.28)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:scale-100 sm:w-auto sm:px-5" aria-label="Clone website from URL">
                                                <ArrowRightSquare className="h-5 w-5 sm:hidden" aria-hidden />
                                                <span className="hidden text-sm sm:inline sm:text-base">Clone</span>
                                            </button>
                                        </div>
                                    </div>
                                    <div className="text-xs sm:text-sm text-white font-medium" aria-live="polite">{error ?? 'Clone a public website • Preview the result • Customize and launch'}</div>
                                </form>
                            ) : (
                                <div onClick={() => router.push('/login?mode=signup')} className="group relative inline-flex items-center gap-3 whitespace-nowrap h-12 px-7 rounded-full shrink-0 text-white text-[15px] bg-accent shadow-[0_6px_18px_rgba(0,0,0,0.25)] transition-all duration-200 hover:scale-[1.04] hover:shadow-[0_10px_24px_rgba(255,141,33,0.34)] active:scale-[0.98]" aria-label={subcopy}>
                                    <span className="relative px-2 py-5">{subcopy}</span>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}
