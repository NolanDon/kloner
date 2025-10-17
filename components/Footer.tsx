// components/Footer.tsx
'use client';

export default function Footer() {
  return (
    <footer className="relative overflow-hidden bg-white">
      <div className="relative container-soft py-16 md:py-20 text-neutral-900">
        {/* Animated gradient wordmark on WHITE */}
        <div className="select-none leading-none tracking-tight font-black">
          <span className="block text-transparent bg-clip-text animated-wordmark text-[10vw]">
            superpower
          </span>
        </div>

        {/* Link columns (dark text on white) */}
        <div className="grid md:grid-cols-4 gap-8 mt-8 text-sm">
          <div>
            <div className="font-semibold text-neutral-900 mb-3">Superpower</div>
            <ul className="space-y-2">
              <li><a href="#how" className="text-neutral-700 hover:text-neutral-900">How it Works</a></li>
              <li><a href="#included" className="text-neutral-700 hover:text-neutral-900">What’s Included</a></li>
              <li><a href="#login" className="text-neutral-700 hover:text-neutral-900">Membership Login</a></li>
              <li><a href="#gift" className="text-neutral-700 hover:text-neutral-900">Gift Superpower</a></li>
            </ul>
          </div>

          <div>
            <div className="font-semibold text-neutral-900 mb-3">Company</div>
            <ul className="space-y-2">
              <li><a href="#why" className="text-neutral-700 hover:text-neutral-900">Our Why</a></li>
              <li><a href="#jobs" className="text-neutral-700 hover:text-neutral-900">Join the Team</a></li>
              <li><a href="#labs" className="text-neutral-700 hover:text-neutral-900">Superpower Labs</a></li>
              <li><a href="#contact" className="text-neutral-700 hover:text-neutral-900">Contact Us</a></li>
              <li><a href="#faq" className="text-neutral-700 hover:text-neutral-900">FAQs</a></li>
            </ul>
          </div>

          <div>
            <div className="font-semibold text-neutral-900 mb-3">Library</div>
            <ul className="space-y-2">
              <li><a href="#immune" className="text-neutral-700 hover:text-neutral-900">Immune System Biomarker</a></li>
              <li><a href="#energy" className="text-neutral-700 hover:text-neutral-900">Energy Biomarkers</a></li>
              <li><a href="#kidney" className="text-neutral-700 hover:text-neutral-900">Kidney Health Biomarkers</a></li>
              <li><a href="#liver" className="text-neutral-700 hover:text-neutral-900">Liver Health Biomarkers</a></li>
              <li><a href="#body" className="text-neutral-700 hover:text-neutral-900">Body Composition Biomarkers</a></li>
            </ul>
          </div>

          <div>
            <div className="font-semibold text-neutral-900 mb-3">Connect</div>
            <ul className="space-y-2">
              <li><a href="#x" className="text-neutral-700 hover:text-neutral-900">X/Twitter</a></li>
              <li><a href="#instagram" className="text-neutral-700 hover:text-neutral-900">Instagram</a></li>
              <li><a href="#linkedin" className="text-neutral-700 hover:text-neutral-900">LinkedIn</a></li>
            </ul>
          </div>
        </div>

        <div className="py-6 text-xs text-neutral-500">
          © 2025 Superpower Health, Inc. All rights reserved.
        </div>
      </div>

      {/* Local styles for the animated gradient fill on white */}
      <style jsx>{`
        .animated-wordmark {
          background-image:
            linear-gradient(
              120deg,
              #ffb36b 0%,
              #ff7a2e 18%,
              #ff5c1a 32%,
              #d64714 45%,
              #7a2e18 58%,
              #ff6f3d 72%,
              #ff9a5d 86%,
              #ffd2a3 100%
            );
          background-size: 200% 200%;
          animation: bg-pan 14s ease-in-out infinite, hue 18s linear infinite;
        }

        @keyframes bg-pan {
          0%   { background-position: 0% 50%; }
          50%  { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
        @keyframes hue {
          0%   { filter: hue-rotate(0deg); }
          50%  { filter: hue-rotate(12deg); }
          100% { filter: hue-rotate(0deg); }
        }

        @media (prefers-reduced-motion: reduce) {
          .animated-wordmark {
            animation: none;
            background-position: 50% 50%;
          }
        }
      `}</style>
    </footer>
  );
}
