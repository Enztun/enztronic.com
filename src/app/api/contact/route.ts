import { NextRequest, NextResponse } from 'next/server';
import { createClient } from 'next-sanity';

const writer = createClient({
  projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID!,
  dataset: process.env.NEXT_PUBLIC_SANITY_DATASET ?? 'production',
  apiVersion: '2024-01-01',
  token: process.env.SANITY_API_TOKEN,
  useCdn: false,
});

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name, email, company, service, budget, message, preferredTime, country } = body;

  if (!name?.trim() || !email?.trim()) {
    return NextResponse.json({ error: 'Name and email are required' }, { status: 400 });
  }

  await writer.create({
    _type: 'inquiry',
    name: name.trim(),
    email: email.trim(),
    ...(company?.trim() && { company: company.trim() }),
    ...(service && { service }),
    ...(budget && { budget }),
    ...(message?.trim() && { message: message.trim() }),
    ...(preferredTime && { preferredTime }),
    ...(country?.trim() && { country: country.trim() }),
    status: 'new',
    submittedAt: new Date().toISOString(),
  });

  return NextResponse.json({ success: true });
}
