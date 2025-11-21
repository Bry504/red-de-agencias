/* eslint-disable */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// ---------------------------------------------------
// SUPABASE CLIENT
// ---------------------------------------------------
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

// Token único del webhook (usa tu mismo pit-...)
const WEBHOOK_TOKEN = process.env.GHL_API_KEY ?? '';

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function getString(o: Record<string, unknown>, k: string): string | null {
  const v = o[k];
  if (typeof v === 'string') return v.trim() || null;
  return null;
}

export async function POST(req: NextRequest) {
  try {
    // ---------------------------------------------------
    // 1) TOKEN
    // ---------------------------------------------------
    const url = new URL(req.url);
    const token = url.searchParams.get('token');

    if (token !== WEBHOOK_TOKEN) {
      return NextResponse.json(
        { ok: false, error: 'Unauthorized token' },
        { status: 401 }
      );
    }

    // ---------------------------------------------------
    // 2) BODY REAL DEL WEBHOOK
    // ---------------------------------------------------
    const raw: unknown = await req.json().catch(() => null);
    if (!isObj(raw)) {
      return NextResponse.json(
        { ok: false, error: 'Invalid payload' },
        { status: 400 }
      );
    }

    // GHL a veces envía raw.contact, otras veces raw directo:
    const contact = isObj(raw.contact) ? raw.contact : raw;

    // ---------------------------------------------------
    // 3) CAMPOS NATIVOS
    // ---------------------------------------------------
    const contactId =
      getString(contact, 'id') ??
      getString(contact, 'contact_id') ??
      null;

    // celular (limpiar E.164)
    let celular: string | null = null;
    if (typeof contact.phone === 'string') {
      const clean = contact.phone.replace(/\D/g, '');
      celular = clean.slice(-9) || null;
    }

    const first = getString(contact, 'firstName') ?? '';
    const last = getString(contact, 'lastName') ?? '';
    const nombre_completo =
      `${first} ${last}`.trim() || null;

    const email =
      getString(contact, 'email') ??
      getString(contact, 'contact.email') ??
      null;

    // ---------------------------------------------------
    // 4) CUSTOM FIELDS (los lee TODOS automáticamente)
    // ---------------------------------------------------
    let documento_de_identidad: string | null = null;
    let origen: string | null = null;
    let estado_civil: string | null = null;
    let distrito_de_residencia: string | null = null;
    let profesion: string | null = null;
    let fecha_de_nacimiento: string | null = null;
    let latitud: number | null = null;
    let longitud: number | null = null;

    if (Array.isArray(contact.customFields)) {
      for (const cf of contact.customFields) {
        if (!isObj(cf)) continue;

        const id = getString(cf, 'id');
        const val = getString(cf, 'value');

        if (!id) continue;

        // NO dependemos del ID → usamos "name" (GHL siempre lo incluye)
        const name = getString(cf, 'name')?.toLowerCase() ?? '';

        if (name.includes('documento')) documento_de_identidad = val;
        else if (name.includes('origen')) origen = val;
        else if (name.includes('civil')) estado_civil = val;
        else if (name.includes('distrito')) distrito_de_residencia = val;
        else if (name.includes('profesion')) profesion = val;
        else if (name.includes('nac')) fecha_de_nacimiento = val;
        else if (name.includes('latitud'))
          latitud = val ? Number(val) : null;
        else if (name.includes('longitud'))
          longitud = val ? Number(val) : null;
      }
    }

    // ---------------------------------------------------
    // 5) VALIDACIÓN
    // ---------------------------------------------------
    if (!celular && !contactId) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Missing celular or hl_contact_id',
        },
        { status: 400 }
      );
    }

    // ---------------------------------------------------
    // 6) INSERT EN SUPABASE
    // ---------------------------------------------------
    const { data, error } = await supabase
      .from('contactos')
      .insert([
        {
          nombre_completo,
          celular,
          documento_de_identidad,
          estado_civil,
          distrito_de_residencia,
          profesion,
          email,
          origen,
          fecha_de_nacimiento,
          hl_contact_id: contactId,
          latitud,
          longitud,
          canal: 'TRADICIONAL',
        },
      ])
      .select('id')
      .single();

    if (error) {
      console.error('Supabase error:', error);
      return NextResponse.json(
        { ok: false, error: 'Supabase insert error' },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { ok: true, contacto_id: data.id },
      { status: 201 }
    );
  } catch (err) {
    console.error('Webhook contact-created error:', err);
    return NextResponse.json(
      { ok: false, error: 'Unexpected error' },
      { status: 500 }
    );
  }
}