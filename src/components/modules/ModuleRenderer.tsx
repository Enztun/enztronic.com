import HeroModule from './HeroModule';
import StatsModule from './StatsModule';
import CaseStudyModule from './CaseStudyModule';
import ServicesGridModule from './ServicesGridModule';
import PortfolioGridModule from './PortfolioGridModule';
import AboutIntroModule from './AboutIntroModule';

type PageModule = {
  _type: string;
  _key: string;
  [key: string]: unknown;
};

export default function ModuleRenderer({ module }: { module: PageModule }) {
  switch (module._type) {
    case 'module.hero':
      return <HeroModule data={module as Parameters<typeof HeroModule>[0]['data']} />;
    case 'module.stats':
      return <StatsModule data={module as Parameters<typeof StatsModule>[0]['data']} />;
    case 'module.caseStudy':
      return <CaseStudyModule data={module as Parameters<typeof CaseStudyModule>[0]['data']} />;
    case 'module.servicesGrid':
      return <ServicesGridModule data={module as Parameters<typeof ServicesGridModule>[0]['data']} />;
    case 'module.portfolioGrid':
      return <PortfolioGridModule data={module as Parameters<typeof PortfolioGridModule>[0]['data']} />;
    case 'module.aboutIntro':
      return <AboutIntroModule data={module as Parameters<typeof AboutIntroModule>[0]['data']} />;
    default:
      return null;
  }
}
