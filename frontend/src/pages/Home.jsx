import "@/home-premium.css";
import { PageWrap } from "@/components/layout/PageWrap";
import { Seo } from "@/components/layout/Seo";
import { Hero } from "@/components/home/Hero";
import { Strip } from "@/components/home/Strip";
import { Intro } from "@/components/home/Intro";
import { SelectedProjects } from "@/components/home/SelectedProjects";
import { ServicesList } from "@/components/home/ServicesList";
import { Process } from "@/components/home/Process";
import { Materials } from "@/components/home/Materials";
import { Studio } from "@/components/home/Studio";
import { LocalGuide } from "@/components/home/LocalGuide";
import { CtaBand } from "@/components/ui-custom/CtaBand";
import { BrochureBand } from "@/components/home/BrochureBand";
import { site } from "@/content/site";
import { homeFaqs } from "@/content/homeContent";

// FAQPage mirrors the questions rendered by <LocalGuide>. Structured data must match
// visible on-page text, so both read from content/homeContent.js.
const ORIGIN = String(site.url || "").replace(/\/+$/, "");
const homeJsonLd = [
  {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "@id": `${ORIGIN}/#faq`,
    mainEntity: homeFaqs.map((faq) => ({
      "@type": "Question",
      name: faq.q,
      acceptedAnswer: { "@type": "Answer", text: faq.a },
    })),
  },
];

export default function Home() {
  return (
    <PageWrap theme="light" testId="home-page">
      <Seo path="/" jsonLd={homeJsonLd} />
      <Hero />
      <Strip />
      <Intro />
      <SelectedProjects />
      <ServicesList />
      <Process />
      <Materials />
      <BrochureBand />
      <Studio index="07" />
      <LocalGuide index="08" />
      <CtaBand />
    </PageWrap>
  );
}
