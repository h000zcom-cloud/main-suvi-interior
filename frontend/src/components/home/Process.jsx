import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import { processSteps } from "@/content/process";

export const Process = ({ index = "04", id = "process" }) => (
  <section id={id} className="home-process scroll-mt-24" data-testid="process-section">
    <div className="container-x section">
      <div className="chapter-top"><p className="editorial-label">{index} / From idea to everyday</p><p>A single studio beside you, from first measurements through final fitting.</p></div>
      <div className="home-process-grid">
        <div className="home-process-heading"><h2 className="editorial-heading text-oxblood" data-testid="home-process-heading">A clear path to a considered <em>result.</em></h2><p className="mt-7 max-w-md text-sm leading-relaxed text-taupe">No disconnected handovers. Each decision is carried forward by the same design-and-make approach.</p><Link to="/process" className="btn-text mt-7" data-testid="home-process-link">See how we work<ArrowUpRight className="h-4 w-4" /></Link></div>
        <ol className="home-process-list">{processSteps.map((step) => <li key={step.n} data-testid={`home-process-step-${step.n}`} className="home-process-step"><span className="home-process-number">{step.n}</span><div><h3>{step.title}</h3><p>{step.text}</p></div></li>)}</ol>
      </div>
    </div>
  </section>
);
