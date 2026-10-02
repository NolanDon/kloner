'use client';

import { useId, useState } from 'react';
import { Plus } from 'lucide-react';
import { WEBSITE_CLONER_FAQ } from '@/lib/websiteClonerFaq';

export default function WebsiteClonerFaq() {
  const groupId = useId();
  return <section id="faq" className="bg-white text-neutral-800 pt-32 pb-32"><div className="container-soft">
    <div className="mb-10 md:mb-12 md:px-40"><h2 className="text-5xl tracking-tight">Frequently Asked Questions</h2><p className="mt-5 max-w-2xl text-neutral-600">Straight answers about cloning a website from a URL, editing the result, and publishing it responsibly.</p></div>
    <div className="mx-auto max-w-4xl border-t border-neutral-200">{WEBSITE_CLONER_FAQ.map((item, index) => <FaqItem key={item.q} item={item} id={groupId + "-" + index} />)}</div>
  </div></section>;
}
function FaqItem({ item, id }: { item: (typeof WEBSITE_CLONER_FAQ)[number]; id: string }) {
  const [open, setOpen] = useState(false);
  const pricingLabel = "View pricing.";
  return <div className="border-b border-neutral-200"><button type="button" className="flex w-full items-center justify-between gap-6 py-5 text-left" aria-expanded={open} aria-controls={id} onClick={() => setOpen((value) => !value)}><span className="text-lg text-neutral-800">{item.q}</span><Plus aria-hidden className={"h-5 w-5 shrink-0 text-neutral-400 transition-transform " + (open ? "rotate-45" : "")} /></button><div id={id} hidden={!open} className="pb-5 pr-10 leading-relaxed text-neutral-600">{item.href ? <>{item.a.replace(pricingLabel, "")}<a className="underline underline-offset-2" href={item.href}>{pricingLabel}</a></> : item.a}</div></div>;
}
