import { CapabilitiesBento } from '../../components/marketing/capabilities-bento';
import { FaqSection } from '../../components/marketing/faq-section';
import { Hero } from '../../components/marketing/hero';
import { PipelineSection } from '../../components/marketing/pipeline-section';
import { PricingSection } from '../../components/marketing/pricing-section';
import { ProviderStrip } from '../../components/marketing/provider-strip';

export default function LandingPage() {
  return (
    <>
      <Hero />
      <PipelineSection />
      <CapabilitiesBento />
      <ProviderStrip />
      <PricingSection />
      <FaqSection />
    </>
  );
}
