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
import { CtaBand } from "@/components/ui-custom/CtaBand";
import { BrochureBand } from "@/components/home/BrochureBand";

export default function Home() {
  return (
    <PageWrap theme="light" testId="home-page">
      <Seo path="/" />
      <Hero />
      <Strip />
      <Intro />
      <SelectedProjects />
      <ServicesList />
      <Process />
      <Materials />
      <BrochureBand />
      <Studio index="07" />
      <CtaBand />
    </PageWrap>
  );
}
