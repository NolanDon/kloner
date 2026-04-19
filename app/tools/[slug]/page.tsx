import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  AgeCalculatorTool,
  ColorPickerTool,
  ImageResizerTool,
  JsonFormatterTool,
  PasswordGeneratorTool,
  PercentageCalculatorTool,
  QrCodeTool,
  TextCaseConverterTool,
  TimeZoneConverterTool,
  UsernameGeneratorTool,
} from "@/components/tools/ToolClients";
import { GeneratedToolClient } from "@/components/tools/GeneratedToolClient";
import { ToolPageShell } from "@/components/tools/ToolPageShell";
import { TOOL_BY_SLUG, TOOL_CONFIGS, type ToolSlug } from "@/components/tools/toolRegistry";

const TOOL_RENDERERS: Record<ToolSlug, JSX.Element> = {
  "qr-code-generator": <QrCodeTool />,
  "percentage-calculator": <PercentageCalculatorTool />,
  "age-calculator": <AgeCalculatorTool />,
  "json-formatter": <JsonFormatterTool />,
  "password-generator": <PasswordGeneratorTool />,
  "image-resizer": <ImageResizerTool />,
  "text-case-converter": <TextCaseConverterTool />,
  "username-generator": <UsernameGeneratorTool />,
  "color-picker-tool": <ColorPickerTool />,
  "time-zone-converter": <TimeZoneConverterTool />,
  "random-number-generator": <GeneratedToolClient tool={TOOL_BY_SLUG["random-number-generator"]} />,
  "random-word-generator": <GeneratedToolClient tool={TOOL_BY_SLUG["random-word-generator"]} />,
  "lorem-ipsum-generator": <GeneratedToolClient tool={TOOL_BY_SLUG["lorem-ipsum-generator"]} />,
  "color-palette-generator": <GeneratedToolClient tool={TOOL_BY_SLUG["color-palette-generator"]} />,
  "favicon-generator": <GeneratedToolClient tool={TOOL_BY_SLUG["favicon-generator"]} />,
  "font-generator-tool": <GeneratedToolClient tool={TOOL_BY_SLUG["font-generator-tool"]} />,
  "hashtag-generator": <GeneratedToolClient tool={TOOL_BY_SLUG["hashtag-generator"]} />,
  "slogan-generator": <GeneratedToolClient tool={TOOL_BY_SLUG["slogan-generator"]} />,
  "business-name-generator": <GeneratedToolClient tool={TOOL_BY_SLUG["business-name-generator"]} />,
  "gamertag-generator": <GeneratedToolClient tool={TOOL_BY_SLUG["gamertag-generator"]} />,
  "email-generator": <GeneratedToolClient tool={TOOL_BY_SLUG["email-generator"]} />,
  "uuid-generator": <GeneratedToolClient tool={TOOL_BY_SLUG["uuid-generator"]} />,
  "barcode-generator": <GeneratedToolClient tool={TOOL_BY_SLUG["barcode-generator"]} />,
  "word-cloud-generator": <GeneratedToolClient tool={TOOL_BY_SLUG["word-cloud-generator"]} />,
  "title-generator": <GeneratedToolClient tool={TOOL_BY_SLUG["title-generator"]} />,
  "acronym-generator": <GeneratedToolClient tool={TOOL_BY_SLUG["acronym-generator"]} />,
  "ascii-art-generator": <GeneratedToolClient tool={TOOL_BY_SLUG["ascii-art-generator"]} />,
  "plot-generator": <GeneratedToolClient tool={TOOL_BY_SLUG["plot-generator"]} />,
  "anagram-generator": <GeneratedToolClient tool={TOOL_BY_SLUG["anagram-generator"]} />,
  "phone-number-generator": <GeneratedToolClient tool={TOOL_BY_SLUG["phone-number-generator"]} />,
};

export function generateStaticParams() {
  return TOOL_CONFIGS.map((tool) => ({ slug: tool.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const tool = TOOL_BY_SLUG[slug as ToolSlug];

  if (!tool) {
    return {};
  }

  return {
    title: tool.title,
    description: tool.description,
    alternates: {
      canonical: `https://kloner.app/tools/${tool.slug}`,
    },
    openGraph: {
      url: `https://kloner.app/tools/${tool.slug}`,
      title: tool.title,
      description: tool.description,
    },
  };
}

export default async function ToolPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const tool = TOOL_BY_SLUG[slug as ToolSlug];

  if (!tool) {
    notFound();
  }

  return <ToolPageShell tool={tool}>{TOOL_RENDERERS[tool.slug] ?? <GeneratedToolClient tool={tool} />}</ToolPageShell>;
}
