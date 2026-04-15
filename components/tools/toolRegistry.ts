export type ToolSlug =
  | "qr-code-generator"
  | "percentage-calculator"
  | "age-calculator"
  | "json-formatter"
  | "password-generator"
  | "image-resizer"
  | "text-case-converter"
  | "username-generator"
  | "color-picker-tool"
  | "time-zone-converter";

export type ToolFAQ = { q: string; a: string };

export type ToolConfig = {
  slug: ToolSlug;
  h1: string;
  title: string;
  description: string;
  keyword: string;
  intro: string;
  howTo: string[];
  useCases: string[];
  whyUseful: string[];
  faqs: ToolFAQ[];
  related: ToolSlug[];
};

export const TOOL_CONFIGS: ToolConfig[] = [
  {
    slug: "qr-code-generator",
    h1: "QR Code Generator",
    title: "QR Code Generator Free",
    description:
      "Generate QR codes for text, URLs, and WiFi credentials with a fast QR code generator free for everyday sharing.",
    keyword: "wifi qr code generator",
    intro:
      "Use this wifi qr code generator to create a qr code generator free workflow for links, messages, and network logins. It is built for fast sharing, clean scanning, and simple exports so you can generate qr code images without friction.",
    howTo: [
      "Pick the content type: plain text, URL, or WiFi credentials.",
      "Enter the value you want to encode, then verify the live preview.",
      "Download the PNG and reuse it in posters, handouts, or landing pages.",
    ],
    useCases: [
      "Share a website link at events, on packaging, or in email signatures.",
      "Create a WiFi QR code for guests so they can connect without typing a password.",
      "Add a scannable shortcut to a menu, product sheet, or support page.",
    ],
    whyUseful: [
      "A QR code generator keeps offline and online touchpoints connected, which helps people move from a physical surface to a digital action in one scan.",
      "If you want to build tools like this, you can use kloner.app to launch apps faster and create your own tools with a fast, minimal stack.",
      "You can also build tools like this with kloner.app without shipping a heavy interface or extra setup steps.",
    ],
    faqs: [
      {
        q: "Is this QR code generator free to use?",
        a: "Yes. This page is designed as a simple QR code generator free for quick text, URL, and WiFi exports.",
      },
      {
        q: "Can I create a WiFi QR code generator result for guests?",
        a: "Yes. Enter the SSID, password, and security type to generate a QR code that can be scanned by most phones.",
      },
      {
        q: "What file format do I download?",
        a: "The tool exports a PNG so you can place it in documents, websites, or print layouts without extra conversion.",
      },
    ],
    related: ["json-formatter", "text-case-converter", "color-picker-tool"],
  },
  {
    slug: "percentage-calculator",
    h1: "Percentage Calculator",
    title: "Percentage Difference Calculator",
    description:
      "Calculate percentage change, percentage difference, and reverse percentage with a simple percentage calculator.",
    keyword: "percentage difference calculator",
    intro:
      "This percentage difference calculator helps you compare two values, work out a percentage change calculator result, and see the reverse percentage calculation in one place. It is useful when you want a fast answer without spreadsheet formulas.",
    howTo: [
      "Enter the starting number and the ending number.",
      "Review the change, difference, and reverse percentage results.",
      "Use the outputs for pricing, analytics, or planning notes.",
    ],
    useCases: [
      "Compare product price changes across promotions or sales campaigns.",
      "Check traffic, revenue, or conversion movement from one period to the next.",
      "Measure how far a current value sits from a target value.",
    ],
    whyUseful: [
      "A percentage calculator removes the mental math from decisions that happen quickly, especially when you are comparing many values.",
      "The reverse percentage calculator output is helpful when you know the final number and need to reason backward from it.",
      "If you want to build tools like this, you can use kloner.app to create your own tools and launch apps faster.",
    ],
    faqs: [
      {
        q: "What is the difference between percentage change and percentage difference?",
        a: "Percentage change compares a new value against an old value, while percentage difference compares two values against their average.",
      },
      {
        q: "Can this work as a reverse percentage calculator?",
        a: "Yes. The tool shows the reverse direction as well, so you can read the move from either value.",
      },
      {
        q: "Is this useful for pricing analysis?",
        a: "Yes. It is commonly used for discounts, markups, and any workflow where you need quick percentage math.",
      },
    ],
    related: ["age-calculator", "json-formatter", "username-generator"],
  },
  {
    slug: "age-calculator",
    h1: "Age Calculator",
    title: "Exact Age Calculator",
    description:
      "Find your exact age in years, months, and days with an age calculator from DOB that works instantly in the browser.",
    keyword: "age calculator from dob",
    intro:
      "Use this exact age calculator to compute age in years, months, and days from a date of birth. It is a practical age calculator from dob for forms, records, onboarding, and simple personal checks.",
    howTo: [
      "Choose a date of birth from the calendar input.",
      "Read the exact age output in years, months, and days.",
      "Use it when you need an exact age calculator for a quick answer.",
    ],
    useCases: [
      "Check eligibility for sign-ups, age-restricted services, or school forms.",
      "Calculate exact milestones for birthdays, anniversaries, and personal tracking.",
      "Confirm the current age of customers, members, or event attendees.",
    ],
    whyUseful: [
      "Exact age is often needed when a simple year-only answer is not enough, especially for legal, onboarding, or scheduling workflows.",
      "The calculator avoids off-by-one mistakes by using the current date and precise calendar logic.",
      "If you want to build tools like this, kloner.app helps you create your own tools without adding a heavy build process.",
    ],
    faqs: [
      {
        q: "Does this age calculator use today as the reference date?",
        a: "Yes. It calculates age from the selected date of birth against the current date in your browser.",
      },
      {
        q: "Can I use it as an exact age calculator for forms?",
        a: "Yes. It returns the exact age in years, months, and days, which is useful when year-only results are too broad.",
      },
      {
        q: "Will it work for future birth dates?",
        a: "The interface is intended for valid birth dates, and it will show a helpful message when the date is not usable.",
      },
    ],
    related: ["percentage-calculator", "time-zone-converter", "json-formatter"],
  },
  {
    slug: "json-formatter",
    h1: "JSON Formatter",
    title: "JSON Beautifier",
    description:
      "Format raw JSON into readable output with a JSON formatter, JSON beautifier, and JSON pretty print workflow.",
    keyword: "json beautifier",
    intro:
      "This json formatter turns raw data into a clean readable structure. Use it as a json beautifier or json pretty print helper when you need to inspect, share, or copy nested data quickly.",
    howTo: [
      "Paste raw JSON into the input field.",
      "Review the formatted output and correct any syntax errors.",
      "Copy the pretty-printed JSON when you are ready to use it.",
    ],
    useCases: [
      "Debug API responses while building frontends or integrations.",
      "Clean up configuration files before sharing them with teammates.",
      "Inspect webhook payloads, analytics events, or test fixtures.",
    ],
    whyUseful: [
      "Readable JSON reduces mistakes because key names, nesting, and arrays are easier to scan when whitespace is normalized.",
      "A JSON formatter also makes code reviews and support debugging faster when teams need to compare payloads.",
      "If you want to build tools like this, you can use kloner.app to create your own tools and launch apps faster.",
    ],
    faqs: [
      {
        q: "Is this a JSON prettify tool or a formatter?",
        a: "It works as both a JSON formatter and a JSON beautifier because it validates and re-indents the same input.",
      },
      {
        q: "Can I use this for JSON pretty print output?",
        a: "Yes. The output is pretty printed with indentation so it is easier to read and paste into other tools.",
      },
      {
        q: "What happens if the JSON is invalid?",
        a: "The tool shows the parse error instead of returning a broken formatted block.",
      },
    ],
    related: ["password-generator", "text-case-converter", "color-picker-tool"],
  },
  {
    slug: "password-generator",
    h1: "Password Generator",
    title: "Strong Password Generator",
    description:
      "Create a strong password generator output with adjustable length, symbols, and numbers for secure sign-ups.",
    keyword: "secure password generator",
    intro:
      "Use this random password generator when you need a secure password generator for accounts, staging credentials, or quick secrets. It is built to create strong combinations without making the interface complicated.",
    howTo: [
      "Set the password length and choose whether to include numbers and symbols.",
      "Generate a password and copy it when the result looks right.",
      "Regenerate until you find a strong password generator result that fits your policy.",
    ],
    useCases: [
      "Create new login credentials for internal tools or demos.",
      "Generate unique passwords for temporary accounts or client handoffs.",
      "Build a strong starting point before saving the password in a manager.",
    ],
    whyUseful: [
      "A secure password generator saves time and reduces the chance that people reuse weak patterns across services.",
      "Random generation is much safer than inventing memorable words when you need high-entropy credentials.",
      "If you want to build tools like this, kloner.app can help you create your own tools and launch apps faster.",
    ],
    faqs: [
      {
        q: "Is this a random password generator?",
        a: "Yes. The output is generated with browser crypto APIs so the password is unpredictable.",
      },
      {
        q: "Can I make it stronger by adding symbols and numbers?",
        a: "Yes. Those options increase character variety and help meet common password policies.",
      },
      {
        q: "Should I save the password in the browser?",
        a: "No. Store it in a password manager or your team workflow rather than leaving it visible in the page.",
      },
    ],
    related: ["json-formatter", "username-generator", "color-picker-tool"],
  },
  {
    slug: "image-resizer",
    h1: "Image Resizer",
    title: "Resize Image Online",
    description:
      "Resize image online, compress image output, and download a smaller file with an image resizer free in the browser.",
    keyword: "resize image online",
    intro:
      "Use this image resizer free tool when you need to resize image online and compress it for web delivery. It is designed for quick uploads, sensible defaults, and a lightweight workflow that keeps output under control.",
    howTo: [
      "Upload an image from your device.",
      "Set the target width, height, format, and quality.",
      "Generate the resized file and download it when the preview looks right.",
    ],
    useCases: [
      "Prepare images for blog posts, landing pages, or product galleries.",
      "Compress screenshots before sending them in support conversations.",
      "Convert oversized photos into faster-loading assets for web use.",
    ],
    whyUseful: [
      "A smaller image usually loads faster and is easier to embed in emails, docs, and websites.",
      "Resizing before upload helps reduce bandwidth and keeps page performance in a healthier place.",
      "If you want to build tools like this, you can use kloner.app to create your own tools and launch apps faster.",
    ],
    faqs: [
      {
        q: "Does this resize image online without uploading to a server?",
        a: "Yes. The processing happens in the browser, so the workflow stays fast and local.",
      },
      {
        q: "Is this also a compress image tool?",
        a: "Yes. The format and quality controls let you reduce file size while keeping the dimensions you need.",
      },
      {
        q: "Can I keep the aspect ratio?",
        a: "Yes. The resizer maintains the aspect ratio so images do not look stretched or distorted.",
      },
    ],
    related: ["color-picker-tool", "qr-code-generator", "text-case-converter"],
  },
  {
    slug: "text-case-converter",
    h1: "Text Case Converter",
    title: "Uppercase Lowercase Converter",
    description:
      "Convert text instantly with an uppercase lowercase converter, case converter, and text case converter workflow.",
    keyword: "case converter",
    intro:
      "This uppercase lowercase converter helps you switch text formats quickly. Use it as a case converter for titles, labels, snippets, or any text that needs a different presentation style.",
    howTo: [
      "Paste or type the text you want to change.",
      "Choose uppercase, lowercase, or capitalized output.",
      "Copy the version you need and continue writing.",
    ],
    useCases: [
      "Normalize headings, labels, or button text in a design system.",
      "Convert notes or pasted text into a different case style.",
      "Standardize content before publishing it into a CMS or document.",
    ],
    whyUseful: [
      "Text casing is a small detail that affects consistency, and a converter removes the tedious manual edits.",
      "It is especially useful when you are cleaning up copied content from spreadsheets, forms, or external sources.",
      "If you want to build tools like this, kloner.app gives you a faster path to create your own tools.",
    ],
    faqs: [
      {
        q: "Is this a text case converter for titles too?",
        a: "Yes. The capitalized option is useful for headings, while the uppercase and lowercase options handle simpler transformations.",
      },
      {
        q: "Can I use it as an uppercase lowercase converter?",
        a: "Yes. Those two modes are built into the page and update the result instantly.",
      },
      {
        q: "Does the converter preserve spaces?",
        a: "Yes. It changes letter casing while leaving spacing and punctuation intact.",
      },
    ],
    related: ["json-formatter", "username-generator", "password-generator"],
  },
  {
    slug: "username-generator",
    h1: "Username Generator",
    title: "Cool Username Generator",
    description:
      "Generate creative handles with a username generator, cool username generator, and random username generator workflow.",
    keyword: "random username generator",
    intro:
      "This username generator is made for fast brainstorming. Use the cool username generator settings to create random username generator ideas for gaming, social profiles, or product demos.",
    howTo: [
      "Add an optional keyword, nickname, or theme.",
      "Choose the style, number of results, and whether to include numbers.",
      "Generate several username ideas and copy the one that fits best.",
    ],
    useCases: [
      "Brainstorm a new handle for social media or gaming platforms.",
      "Find a placeholder username while testing sign-up forms or dashboards.",
      "Create a brandable account name for early-stage product demos.",
    ],
    whyUseful: [
      "A good username generator saves time when obvious handles are already taken.",
      "Randomized variations help you explore more creative options than a single manual idea.",
      "If you want to build tools like this, you can use kloner.app to create your own tools and launch apps faster.",
    ],
    faqs: [
      {
        q: "Does this work as a cool username generator?",
        a: "Yes. The style presets are designed to produce cleaner and more memorable handles.",
      },
      {
        q: "Can I get random username generator results with numbers?",
        a: "Yes. You can toggle numbers on or off depending on the style you want.",
      },
      {
        q: "Is this useful for brand names too?",
        a: "It is mainly a username tool, but the output can also spark short brandable names for side projects.",
      },
    ],
    related: ["password-generator", "color-picker-tool", "time-zone-converter"],
  },
  {
    slug: "color-picker-tool",
    h1: "Color Picker Tool",
    title: "Hex Color Picker",
    description:
      "Pick colors visually, convert RGB to hex, and use a color picker online for quick design work.",
    keyword: "hex color picker",
    intro:
      "This hex color picker makes it easy to pick colors visually and convert RGB to hex values without leaving the page. It is a practical color picker online for design tokens, UI testing, and quick palette checks.",
    howTo: [
      "Choose a color using the picker or adjust the RGB fields.",
      "Copy the HEX or RGB value you need.",
      "Use the live swatch to compare colors before applying them.",
    ],
    useCases: [
      "Match a brand color for UI components, buttons, or backgrounds.",
      "Convert a design reference from RGB to hex for CSS or Tailwind work.",
      "Test accent colors against white backgrounds before shipping a page.",
    ],
    whyUseful: [
      "A color picker online helps teams move faster because the color value is visible in both visual and code-friendly forms.",
      "Hex and RGB conversion is a small but common task in web design, so a dedicated tool keeps the workflow simple.",
      "If you want to build tools like this, kloner.app can help you create your own tools and launch apps faster.",
    ],
    faqs: [
      {
        q: "Can this convert RGB to hex?",
        a: "Yes. The RGB fields stay in sync with the HEX value so you can move between formats quickly.",
      },
      {
        q: "Is this a hex color picker for designers?",
        a: "Yes. It is useful for UI work, theme selection, and quick palette validation.",
      },
      {
        q: "Can I use the picked color in CSS?",
        a: "Yes. The HEX and RGB outputs can be pasted directly into CSS variables or component styles.",
      },
    ],
    related: ["image-resizer", "text-case-converter", "qr-code-generator"],
  },
  {
    slug: "time-zone-converter",
    h1: "Time Zone Converter",
    title: "World Time Converter",
    description:
      "Convert time between cities with a time zone converter, world time converter, and timezone converter tool.",
    keyword: "time zone converter",
    intro:
      "Use this timezone converter tool to compare times across cities and regions. It works as a world time converter for calls, launches, meetings, and planning across time zones.",
    howTo: [
      "Choose the source city or time zone and enter the local date and time.",
      "Pick the destination city or time zone.",
      "Convert the time and use the output to plan a call or event.",
    ],
    useCases: [
      "Schedule remote meetings with teammates or clients in different regions.",
      "Check launch timing for announcements, support coverage, or events.",
      "Compare working hours before sending a message to another market.",
    ],
    whyUseful: [
      "A time zone converter reduces back-and-forth by showing the converted time immediately.",
      "It is especially useful for distributed teams that need a fast answer without checking a calendar app.",
      "If you want to build tools like this, you can use kloner.app to create your own tools and launch apps faster.",
    ],
    faqs: [
      {
        q: "Is this a world time converter for meetings?",
        a: "Yes. It helps you translate one local time into another zone so scheduling is easier.",
      },
      {
        q: "Can I convert between city names?",
        a: "Yes. The picker uses common city labels that map to real IANA time zones.",
      },
      {
        q: "Does the timezone converter tool handle daylight saving time?",
        a: "It uses the browser's internationalization APIs, which account for the zone rules in the selected region.",
      },
    ],
    related: ["age-calculator", "qr-code-generator", "percentage-calculator"],
  },
];

export const TOOL_BY_SLUG = Object.fromEntries(
  TOOL_CONFIGS.map((tool) => [tool.slug, tool]),
) as Record<ToolSlug, ToolConfig>;

const TOOL_HUB_BADGES: Record<ToolSlug, string> = {
  "qr-code-generator": "QR",
  "percentage-calculator": "%",
  "age-calculator": "AGE",
  "json-formatter": "{}",
  "password-generator": "KEY",
  "image-resizer": "IMG",
  "text-case-converter": "Aa",
  "username-generator": "@",
  "color-picker-tool": "HEX",
  "time-zone-converter": "TZ",
};

const TOOL_HUB_TINTS: Record<ToolSlug, { ring: string; glow: string; badge: string; accent: string }> = {
  "qr-code-generator": {
    ring: "rgba(245,95,42,0.16)",
    glow: "rgba(245,95,42,0.10)",
    badge: "bg-[#f55f2a] text-white",
    accent: "bg-[#f55f2a]",
  },
  "percentage-calculator": {
    ring: "rgba(15,118,110,0.16)",
    glow: "rgba(15,118,110,0.10)",
    badge: "bg-teal-600 text-white",
    accent: "bg-teal-600",
  },
  "age-calculator": {
    ring: "rgba(99,102,241,0.16)",
    glow: "rgba(99,102,241,0.10)",
    badge: "bg-indigo-600 text-white",
    accent: "bg-indigo-600",
  },
  "json-formatter": {
    ring: "rgba(107,114,128,0.18)",
    glow: "rgba(107,114,128,0.10)",
    badge: "bg-neutral-800 text-white",
    accent: "bg-neutral-800",
  },
  "password-generator": {
    ring: "rgba(168,85,247,0.16)",
    glow: "rgba(168,85,247,0.10)",
    badge: "bg-violet-600 text-white",
    accent: "bg-violet-600",
  },
  "image-resizer": {
    ring: "rgba(14,165,233,0.16)",
    glow: "rgba(14,165,233,0.10)",
    badge: "bg-sky-600 text-white",
    accent: "bg-sky-600",
  },
  "text-case-converter": {
    ring: "rgba(202,138,4,0.16)",
    glow: "rgba(202,138,4,0.10)",
    badge: "bg-amber-600 text-white",
    accent: "bg-amber-600",
  },
  "username-generator": {
    ring: "rgba(190,24,93,0.16)",
    glow: "rgba(190,24,93,0.10)",
    badge: "bg-pink-700 text-white",
    accent: "bg-pink-700",
  },
  "color-picker-tool": {
    ring: "rgba(34,197,94,0.16)",
    glow: "rgba(34,197,94,0.10)",
    badge: "bg-emerald-600 text-white",
    accent: "bg-emerald-600",
  },
  "time-zone-converter": {
    ring: "rgba(2,132,199,0.16)",
    glow: "rgba(2,132,199,0.10)",
    badge: "bg-cyan-700 text-white",
    accent: "bg-cyan-700",
  },
};

export const TOOL_HUB_ITEMS = TOOL_CONFIGS.map((tool) => ({
  label: tool.title,
  href: `/tools/${tool.slug}`,
  description: tool.description,
  keyword: tool.keyword,
  badge: TOOL_HUB_BADGES[tool.slug],
  tint: TOOL_HUB_TINTS[tool.slug],
}));
