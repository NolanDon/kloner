// components/Stories.tsx
import SectionReveal from "./SectionReveal";

const stories = [
  { img: "/images/story-1.jpg", alt: "Story 1" },
  { img: "/images/story-2.jpg", alt: "Story 2" },
  { img: "/images/story-3.jpg", alt: "Story 3" },
  { img: "/images/story-4.jpg", alt: "Story 4" },
  { img: "/images/story-5.jpg", alt: "Story 5" },
];

export default function Stories() {
  return (
    <section className="section bg-white text-black" id="reviews">
      <div className="container-soft">
        <h2 className="text-4xl mb-2 text-black">
          Superpower is changing thousands of lives
        </h2>
        <p className="mb-8 text-black/60">
          Real members. Real stories.
        </p>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {stories.map((s, i) => (
            <SectionReveal key={i} delay={i * 0.04}>
              <img
                src={s.img}
                alt={s.alt}
                className="rounded-2xl border border-black/10 shadow-sm"
              />
            </SectionReveal>
          ))}
        </div>
      </div>
    </section>
  );
}
