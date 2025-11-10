// components/StatsStrip.tsx
import SectionReveal from "./SectionReveal";

export default function StatsStrip() {
  const stats = [
    { value: "92%", label: "launch faster", sub: "from paste to preview under 120s" },
    { value: "70%", label: "ship cleaner code", sub: "less manual cleanup post-clone" },
    { value: "4×", label: "faster iterations", sub: "edit, preview, deploy on repeat" },
  ];
  return (
    <section className="section bg-white" id="stories">
      <div className="container-soft">
        <SectionReveal>
          <blockquote className="text-center text-2xl md:text-3xl font-semibold max-w-4xl mx-auto text-black/70">
            “I pasted a URL and had a deployable project before my coffee cooled. Zero setup. Instant preview. One click to Vercel.”
          </blockquote>
        </SectionReveal>
        <div className="mt-12 grid md:grid-cols-3 gap-6">
          {stats.map((s, i) => (
            <SectionReveal key={i} delay={i * .05}>
              <div className="card p-6">
                <div className="text-5xl text-black/80 font-bold">{s.value}</div>
                <div className="mt-3 text-black/70">{s.label}</div>
                <div className="text-black/90 font-medium">{s.sub}</div>
              </div>
            </SectionReveal>
          ))}
        </div>
      </div>
    </section>
  );
}
