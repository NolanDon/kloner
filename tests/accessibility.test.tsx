/** @jest-environment jsdom */

import React from "react";
import { cleanup, render } from "@testing-library/react";
import axe from "axe-core";

import Hero from "@/components/Hero";
import HeroContent from "@/components/HeroContent";
import UrlOverlay from "@/components/UrlOverlay";
import HowItWorks from "@/components/HowItWorks";
import FAQSection from "@/components/FaqSection";
import WhatWeTest from "@/components/WhatWeTest";

const mockPush = jest.fn();
const mockOpenUrlOverlay = jest.fn();

class MockIntersectionObserver {
  root: Element | null = null;
  rootMargin = "0px";
  thresholds: number[] = [];

  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

beforeAll(() => {
  (globalThis as typeof globalThis & { IntersectionObserver?: typeof MockIntersectionObserver }).IntersectionObserver =
    MockIntersectionObserver as unknown as typeof IntersectionObserver;
});

jest.mock("next/image", () => ({
  __esModule: true,
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) =>
    React.createElement("img", { ...props, alt: props.alt ?? "" }),
}));

jest.mock("next/font/google", () => ({
  Outfit: () => ({ className: "font-sans" }),
}));

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock("@/lib/firebase", () => ({
  auth: { currentUser: null },
}));

jest.mock("@/components/UrlOverlayProvider", () => ({
  useUrlOverlay: () => ({ openUrlOverlay: mockOpenUrlOverlay }),
}));

jest.mock("framer-motion", () => {
  const React = require("react");

  const passthrough = (Tag: keyof JSX.IntrinsicElements) =>
    React.forwardRef(function MotionPassthrough(
      { children, ...props }: React.HTMLAttributes<HTMLElement> & { children?: React.ReactNode },
      ref: React.ForwardedRef<HTMLElement>,
    ) {
      return React.createElement(Tag, { ref, ...props }, children);
    });

  return {
    AnimatePresence: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
    motion: new Proxy(
      {},
      {
        get: (_, tag: string) => passthrough(tag as keyof JSX.IntrinsicElements),
      },
    ),
    useAnimation: () => ({ start: jest.fn() }),
    useInView: () => true,
    useScroll: () => ({ scrollYProgress: 0 }),
    useTransform: () => 1,
  };
});

async function expectNoViolations(node: React.ReactElement) {
  cleanup();
  const { container } = render(node);
  const results = await axe.run(container);
  expect(results.violations).toEqual([]);
}

describe("public accessibility surfaces", () => {
  it("keeps the hero accessible", async () => {
    await expectNoViolations(<Hero />);
    await expectNoViolations(<HeroContent displayClassName="font-sans" />);
  });

  it("keeps the overlay, how-it-works, FAQ, and CTA sections accessible", async () => {
    await expectNoViolations(<UrlOverlay open onClose={jest.fn()} />);
    await expectNoViolations(<HowItWorks />);
    await expectNoViolations(<FAQSection />);
    await expectNoViolations(<WhatWeTest />);
  });
});
