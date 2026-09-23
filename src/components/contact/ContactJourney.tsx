'use client';

import { useTranslations } from 'next-intl';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { ContactReview, IdentityFields, OptionalFields, ProblemField } from './ContactFields';
import { primaryButtonClass, secondaryButtonClass, type ContactFieldsProps } from './shared';

export default function ContactJourney({ form, onChange, errors, step, onStepChange, loading }: ContactFieldsProps & {
  step: number;
  onStepChange: (step: number) => void;
  loading: boolean;
}) {
  const t = useTranslations('contact');
  const titles = [t('journeyProblemTitle'), t('journeyContextTitle'), t('journeyContactTitle'), t('journeyReviewTitle')];
  const props = { form, onChange, errors };
  return (
    <div className="space-y-7">
      <div>
        <ol aria-label={t('journeyProgress')} className="mb-4 flex gap-2">
          {titles.map((title, index) => (
            <li key={title} aria-current={index + 1 === step ? 'step' : undefined}
              className={`h-1.5 flex-1 rounded-full transition-colors duration-200 motion-reduce:transition-none ${index + 1 <= step ? 'bg-primary' : 'bg-gray-200'}`}>
              <span className="sr-only">{index + 1}. {title}</span>
            </li>
          ))}
        </ol>
        <p className="mb-2 text-sm text-gray-600" role="status">{t('journeyStepLabel', { current: step, total: 4 })}</p>
        <h2 id="contact-form-title" tabIndex={-1} className="text-xl font-bold focus:outline-none">{titles[step - 1]}</h2>
        <p className="mt-2 text-sm text-gray-600">{step === 2 ? t('contextOptionalHint') : step === 4 ? t('reviewHint') : t('requiredHint')}</p>
      </div>
      {step === 1 && <ProblemField {...props} />}
      {step === 2 && <OptionalFields {...props} />}
      {step === 3 && <IdentityFields {...props} />}
      {step === 4 && (
        <>
          <ContactReview form={form} />
          <div className="flex flex-wrap gap-2">
            {[1, 2, 3].map((editStep) => (
              <button key={editStep} type="button" className={secondaryButtonClass} onClick={() => onStepChange(editStep)}>
                {t('editSection', { section: titles[editStep - 1] })}
              </button>
            ))}
          </div>
          <p className="text-sm leading-relaxed text-gray-600">{t('dataUseNote')}</p>
        </>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 pt-6">
        {step > 1 ? (
          <button type="button" onClick={() => onStepChange(step - 1)} className={secondaryButtonClass}>
            <ArrowLeft aria-hidden="true" className="h-4 w-4" />{t('journeyBack')}
          </button>
        ) : <span />}
        {step < 4 ? (
          <button type="submit" className={primaryButtonClass}>
            {step === 2 ? t('continueOptional') : t('journeyNext')}<ArrowRight aria-hidden="true" className="h-4 w-4" />
          </button>
        ) : (
          <button type="submit" disabled={loading} className={primaryButtonClass}>
            {loading ? t('formSubmitting') : t('formSubmit')}
          </button>
        )}
      </div>
    </div>
  );
}
