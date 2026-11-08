import { InfoLayout, InfoSection } from "../info-layout";
export const metadata = { title: "Contact" };
export default function Page() {
  return (
    <InfoLayout
      eyebrow="AGENTLOGIN / CONTACT"
      title={<>Talk to the team<br />building the boundary.</>}
      intro="For product questions, integration discussions, or security-related enquiries, use the official contact channel supplied by the AgentLogin team."
    >
      <InfoSection title="Product and integrations">
        <p>For early access, integration guidance, or product questions, contact the AgentLogin team through the channel provided with your account or onboarding materials.</p>
      </InfoSection>
      <InfoSection title="Security reports">
        <p>For vulnerability reports, see the <a href="/security-disclosure">responsible disclosure page</a>. Avoid sending passwords, API keys, session cookies, or other secrets in a report.</p>
      </InfoSection>
      <InfoSection title="Business and legal enquiries">
        <p>Before public launch, the operator should publish a monitored business and legal contact address here. This page intentionally does not display an unverified email address.</p>
      </InfoSection>
    </InfoLayout>
  );
}
