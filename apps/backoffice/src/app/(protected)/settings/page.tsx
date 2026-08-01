import type { Metadata } from "next";

import { saveSettingsAction } from "@/actions";
import { SettingsForm } from "@/components/settings-form";
import { PageHeader } from "@/components/ui/page-header";
import { getBusinessProfile } from "@/lib/server/business";

export const metadata: Metadata = {
  title: "Settings",
};

export const dynamic = "force-dynamic";

function addressValue(address: Record<string, unknown>, key: string) {
  const value = address[key];
  return typeof value === "string" ? value : null;
}

export default async function SettingsPage() {
  const profile = await getBusinessProfile();

  return (
    <>
      <PageHeader
        eyebrow="Workspace"
        title="Settings"
        description="Control the business identity and defaults used for billing."
      />
      <SettingsForm
        action={saveSettingsAction}
        initialValues={{
          version: profile.version,
          businessName: profile.businessName,
          legalName: profile.legalName,
          email: profile.email,
          phone: profile.phone,
          taxId: profile.taxId,
          addressLine1: addressValue(profile.billingAddress, "line1"),
          addressLine2: addressValue(profile.billingAddress, "line2"),
          city: addressValue(profile.billingAddress, "city"),
          province: addressValue(profile.billingAddress, "province"),
          postalCode: addressValue(profile.billingAddress, "postalCode"),
          country: addressValue(profile.billingAddress, "country"),
          paymentInstructions: profile.paymentInstructions,
          invoicePrefix: profile.invoicePrefix,
          defaultCurrency: profile.defaultCurrency,
          timezone: profile.timezone,
          defaultPaymentTermsDays: profile.defaultPaymentTermsDays,
          emailFromName: profile.emailFromName,
          emailReplyTo: profile.emailReplyTo,
        }}
      />
    </>
  );
}
