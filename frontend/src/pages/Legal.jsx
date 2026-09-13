import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { PageWrap } from "@/components/layout/PageWrap";
import { Seo } from "@/components/layout/Seo";
import { site } from "@/content/site";

const Legal = ({ title, description, path, children, testId }) => (
  <PageWrap theme="dark" testId={testId}>
    <Seo title={title} description={description} path={path} crumbs={[{ name: "Home", path: "/" }, { name: title, path }]} />
    <section className="legal-shell"><div className="container-x"><Link to="/" className="btn-text mb-10"><ArrowLeft className="h-4 w-4" />Back to home</Link><p className="editorial-label mb-7 text-taupe">Suvi Interior / Legal</p><h1 className="legal-heading">{title}</h1><div className="legal-prose">{children}</div></div></section>
  </PageWrap>
);

export function Privacy() {
  return <Legal title="Privacy Policy" description="How Suvi Interior collects, uses and retains the details you share through this website or an interior project enquiry." path="/privacy" testId="privacy-page"><p>This policy describes how {site.name} ("we") handles information shared with us through this website.</p><h2>Information we collect</h2><p>When you submit an enquiry, we collect the details you provide—such as your name, phone number, email address, project type and message—so that we can respond to you.</p><h2>How we use it</h2><p>We use your details only to respond to your enquiry, discuss your project and provide the services you request. We do not sell your information.</p><h2>Third-party services</h2><p>This website may load fonts, maps and images from third-party providers such as Google. Those providers may collect technical information in accordance with their own policies. Links to WhatsApp open the WhatsApp service, which is governed by its own terms.</p><h2>Retention</h2><p>Enquiry details are retained for as long as needed to respond to and follow up on your request. You may ask us to delete your details at any time by contacting us on {site.phone.display}.</p><h2>Contact</h2><p>{site.name}, {site.address.streetAddress}, {site.city}, {site.region} {site.postalCode}. Phone: {site.phone.display}.</p></Legal>;
}

export function Terms() {
  return <Legal title="Terms of Use" description="The terms that apply when you use the Suvi Interior website or submit an interior design enquiry to the studio in Nashik." path="/terms" testId="terms-page"><p>By using this website you agree to the following terms.</p><h2>Content</h2><p>The content on this website is for general information about {site.name} and its services. Imagery may include representative photography while our project archive is being prepared; representative imagery does not depict specific {site.name} projects.</p><h2>Enquiries</h2><p>Submitting an enquiry does not create a contract. Any engagement will be confirmed separately and in writing between you and {site.name}.</p><h2>Intellectual property</h2><p>The {site.name} name, wordmark and original site content may not be reproduced without permission.</p><h2>Changes</h2><p>We may update these terms from time to time. Continued use of the website constitutes acceptance of the current terms.</p></Legal>;
}

export function NotFound() {
  return <PageWrap theme="dark" testId="not-found-page"><Seo title="Page not found" description="This page could not be found. Explore Suvi Interior's projects, services and studio in Nashik instead." path="/404" noindex /><section className="legal-shell flex items-center"><div className="container-x"><p className="editorial-label mb-7 text-taupe">404 / Wrong turn</p><h1 className="legal-heading">This room <em>doesn’t exist.</em></h1><p className="lede mt-7 max-w-md">Let’s take you back to the spaces, stories and ideas that do.</p><Link to="/" data-testid="notfound-home" className="btn-solid mt-10 w-fit">Back to home</Link></div></section></PageWrap>;
}
