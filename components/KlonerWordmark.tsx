type KlonerWordmarkProps = {
  className?: string;
  color?: string;
};

/** Text based brand mark, using the same display face as the footer wordmark. */
export default function KlonerWordmark({ className = "", color = "#FF8D21" }: KlonerWordmarkProps) {
  return (
    <span
      className={`inline-block whitespace-nowrap font-black leading-none tracking-tight ${className}`}
      style={{ color, fontFamily: "var(--font-fraunces), Georgia, serif" }}
      aria-label="Kloner"
    >
      kloner
    </span>
  );
}
