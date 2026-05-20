"use client";

import { useEffect, useState } from "react";
import Lottie from "lottie-react";

const COIN_URL = "/lotties/coin.json";

let coinAnimationPromise: Promise<any> | null = null;
let coinAnimationCache: any | null = null;

type CoinLottieBadgeProps = {
    className?: string;
};

export default function CoinLottieBadge({ className }: CoinLottieBadgeProps) {
    const [animationData, setAnimationData] = useState<any>(coinAnimationCache);

    useEffect(() => {
        let cancelled = false;

        if (coinAnimationCache) {
            setAnimationData(coinAnimationCache);
            return () => {
                cancelled = true;
            };
        }

        if (!coinAnimationPromise) {
            coinAnimationPromise = fetch(COIN_URL, { cache: "force-cache" })
                .then((response) => {
                    if (!response.ok) {
                        throw new Error("missing coin animation");
                    }

                    return response.json();
                })
                .then((json) => {
                    coinAnimationCache = json;
                    return json;
                })
                .catch((error) => {
                    coinAnimationPromise = null;
                    throw error;
                });
        }

        void coinAnimationPromise
            .then((json) => {
                if (!cancelled) {
                    setAnimationData(json);
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setAnimationData(null);
                }
            });

        return () => {
            cancelled = true;
        };
    }, []);

    if (!animationData) {
        return <span className={className ?? "h-8 w-8 rounded-full bg-amber-300/80"} aria-hidden="true" />;
    }

    return <Lottie animationData={animationData} loop autoplay className={className ?? "h-8 w-8"} />;
}