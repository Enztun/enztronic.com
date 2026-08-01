import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from "react-email";

export interface InvoiceEmailProps {
  companyName: string;
  clientName: string;
  invoiceNumber: string;
  issueDate: string;
  dueDate?: string;
  total: string;
  downloadUrl?: string;
}

const colors = {
  ink: "#132436",
  muted: "#687786",
  line: "#dfe6ec",
  brand: "#2563eb",
  canvas: "#f4f7f9",
  white: "#ffffff",
};

export default function InvoiceEmail({
  companyName,
  clientName,
  invoiceNumber,
  issueDate,
  dueDate,
  total,
  downloadUrl,
}: InvoiceEmailProps) {
  return (
    <Html lang="en">
      <Head />
      <Preview>
        Invoice {invoiceNumber} from {companyName}
      </Preview>
      <Body style={body}>
        <Container style={container}>
          <Section style={brandBar} />
          <Section style={content}>
            <Text style={eyebrow}>{companyName}</Text>
            <Heading style={heading}>Your invoice is ready</Heading>
            <Text style={paragraph}>Hello {clientName},</Text>
            <Text style={paragraph}>
              Invoice {invoiceNumber} has been issued. A PDF copy is attached to
              this email for your records.
            </Text>

            <Section style={summary}>
              <Text style={summaryLabel}>Invoice</Text>
              <Text style={summaryValue}>{invoiceNumber}</Text>
              <Hr style={summaryLine} />
              <Text style={summaryLabel}>Issued</Text>
              <Text style={summaryValue}>{issueDate}</Text>
              {dueDate ? (
                <>
                  <Hr style={summaryLine} />
                  <Text style={summaryLabel}>Due</Text>
                  <Text style={summaryValue}>{dueDate}</Text>
                </>
              ) : null}
              <Hr style={summaryLine} />
              <Text style={summaryLabel}>Total</Text>
              <Text style={totalValue}>{total}</Text>
            </Section>

            {downloadUrl ? (
              <Section style={buttonRow}>
                <Button href={downloadUrl} style={button}>
                  Download invoice
                </Button>
              </Section>
            ) : null}

            <Text style={paragraph}>
              If anything on the invoice needs attention, reply to this email and
              we will help.
            </Text>
            <Hr style={divider} />
            <Text style={footer}>
              This message was sent by {companyName}. Please keep the attached
              invoice in a secure location.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

const body = {
  backgroundColor: colors.canvas,
  color: colors.ink,
  fontFamily: "Arial, Helvetica, sans-serif",
  margin: "0",
  padding: "32px 12px",
};

const container = {
  backgroundColor: colors.white,
  border: `1px solid ${colors.line}`,
  borderRadius: "12px",
  margin: "0 auto",
  maxWidth: "580px",
  overflow: "hidden",
};

const brandBar = {
  backgroundColor: colors.brand,
  height: "8px",
};

const content = {
  padding: "36px 42px 30px",
};

const eyebrow = {
  color: colors.brand,
  fontSize: "12px",
  fontWeight: "700",
  letterSpacing: "1.2px",
  margin: "0 0 10px",
  textTransform: "uppercase" as const,
};

const heading = {
  color: colors.ink,
  fontSize: "28px",
  lineHeight: "36px",
  margin: "0 0 24px",
};

const paragraph = {
  color: colors.ink,
  fontSize: "15px",
  lineHeight: "24px",
  margin: "0 0 18px",
};

const summary = {
  backgroundColor: "#f8fafb",
  border: `1px solid ${colors.line}`,
  borderRadius: "10px",
  margin: "26px 0",
  padding: "18px 20px",
};

const summaryLabel = {
  color: colors.muted,
  display: "inline-block",
  fontSize: "12px",
  margin: "0",
  textTransform: "uppercase" as const,
  width: "38%",
};

const summaryValue = {
  color: colors.ink,
  display: "inline-block",
  fontSize: "14px",
  fontWeight: "600",
  margin: "0",
  textAlign: "right" as const,
  width: "62%",
};

const totalValue = {
  ...summaryValue,
  color: colors.brand,
  fontSize: "18px",
};

const summaryLine = {
  borderColor: colors.line,
  margin: "12px 0",
};

const buttonRow = {
  margin: "28px 0",
  textAlign: "center" as const,
};

const button = {
  backgroundColor: colors.brand,
  borderRadius: "7px",
  color: colors.white,
  fontSize: "14px",
  fontWeight: "700",
  padding: "13px 22px",
  textDecoration: "none",
};

const divider = {
  borderColor: colors.line,
  margin: "28px 0 20px",
};

const footer = {
  color: colors.muted,
  fontSize: "12px",
  lineHeight: "19px",
  margin: "0",
};
