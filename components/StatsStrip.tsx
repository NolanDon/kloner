
import SectionReveal from "./SectionReveal";

export default function StatsStrip() {
  const stats = [
    { value: "63%", label: "of members find", sub: "early risk factors for diabetes" },
    { value: "44%", label: "of members find", sub: "elevated heart disease risk" },
    { value: "70%", label: "of members slow", sub: "their speed of ageing" },
  ];
  return (
    <section className="section bg-white" id="stories">
      <div className="container-soft">
        <SectionReveal>
          <blockquote className="text-center text-2xl md:text-3xl font-semibold max-w-4xl mx-auto text-black/70">
            “Superpower gave me what no doctor, supplement, or app ever could: clarity.
            If you're tired of vague advice and want real insight into your body, it’s worth it.”
          </blockquote>
        </SectionReveal>
        <div className="mt-12 grid md:grid-cols-3 gap-6">
          {stats.map((s,i)=>(
            <SectionReveal key={i} delay={i*.05}>
              <div className="card p-6">
                <div className="text-5xl font-bold">{s.value}</div>
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
