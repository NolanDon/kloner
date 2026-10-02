export type WebsiteClonerFaqItem = { q: string; a: string; href?: string };

export const WEBSITE_CLONER_FAQ: WebsiteClonerFaqItem[] = [
  { q: "What is a website cloner?", a: "Kloner turns a supported public webpage into an editable project for redesigns, landing pages, or client mockups." },
  { q: "How do I clone a website from a URL?", a: "Paste a supported public URL, generate a preview, then customize the result. No coding is needed to get started." },
  { q: "Can I edit the cloned site?", a: "Yes. Change text, colors, images, and sections to make the project your own before publishing." },
  { q: "Is Kloner free to try?", a: "Kloner offers limited free preview access. Editing and publishing depend on your plan.", href: "/price" },
  { q: "Where can I publish the finished site?", a: "Publish through available integrations, including Vercel, and connect your own domain when ready." },
  { q: "How accurate is the clone?", a: "Accuracy depends on the source site. Review the preview and refine content, responsive layouts, and interactions as needed." },
  { q: "What are the limitations?", a: "Private content and server-side behavior are not captured. Forms, payments, and dynamic features may need separate setup. Kloner creates an editable project rather than simply downloading files." },
  { q: "Can I clone any website?", a: "Use only websites and content you own or have permission to reuse. Confirm your rights to the content, branding, and assets before publishing." },
];
