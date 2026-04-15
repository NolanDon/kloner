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

  return <ToolPageShell tool={tool}>{TOOL_RENDERERS[tool.slug]}</ToolPageShell>;
}
