import Image from "next/image";

export default function KlonerPumpkinAccent() {
  return (
    <span className="kloner-pumpkin-accent" aria-label="Kloner Halloween pumpkin">
      <Image className="kloner-pumpkin" src="/images/pumpkin-accent.webp" alt="" width={192} height={173} priority />
      <svg className="kloner-bat kloner-bat-one" viewBox="0 0 24 14" fill="currentColor" aria-hidden="true">
        <path d="M1 2 6 5l3-4 3 4 5-3-2 9-6-3-6 3L1 2Z" />
      </svg>
      <svg className="kloner-bat kloner-bat-two" viewBox="0 0 24 14" fill="currentColor" aria-hidden="true">
        <path d="M1 2 6 5l3-4 3 4 5-3-2 9-6-3-6 3L1 2Z" />
      </svg>
    </span>
  );
}
