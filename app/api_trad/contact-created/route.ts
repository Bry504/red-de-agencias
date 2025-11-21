/* eslint-disable */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Supabase
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

// Token de seguridad
const WEBHOOK_TOKEN =
  process.env.GHL_API_KEY ??
  process.env.GHL_WEBHOOK_TOKEN ??
  '';

export async function POST(req: NextRequest) {
  try {
    // -------------------------------
    // 1. Validar TOKEN
    // -------------------------------
    const url = new URL(req.url);
    const token = url.searchParams.get('token');

    if (!WEBHOOK_TOKEN || token !== WEBHOOK_TOKEN) {
      return NextResponse.json(
        { error: 'No autorizado (token inválido).' },
        { status: 401 }
      );
    }

    // -------------------------------
    // 2. Leer BODY real de HighLevel
    // -------------------------------
    const payload = await req.json().catch(() => null);

    if (!payload) {
      return NextResponse.json(
        { error: 'Body inválido.' },
        { status: 400 }
      );
    }

    // HighLevel envía los datos dentro de "contact"
    const contact = payload.contact ?? payload;

    if (!contact) {
      return NextResponse.json(
        { error: 'Payload sin contact.' },
        { status: 400 }
      );
    }

    // -------------------------------
    // 3. Extraer datos principales
    // -------------------------------
    const hl_contact_id = contact.id ? String(contact.id) : null;

    // Normalizar celular (E.164 → solo últimos 9 números)
    let celular: string | null = null;
    if (contact.phone) {
      const clean = contact.phone.replace(/\D/g, '');
      celular = clean.slice(-9) || null;
    }

    // Nombre completo
    const first = contact.firstName ?? '';
    const last = contact.lastName ?? '';
    const nombre_completo = `${first} ${last}`.trim() || null;

    const email = contact.email ?? null;

    // -------------------------------
    // 4. CUSTOM FIELDS
    // -------------------------------
    function getCF(id: string): string | null {
      return (
        contact.customFields?.find((f: any) => f.id === id)?.value ?? null
      );
    }

    const documento_de_identidad = getCF(process.env.GHL_CF_DOC_IDENTIDAD_ID!);
    const origen = getCF(process.env.GHL_CF_ORIGEN_ID!);
    const estado_civil = getCF(process.env.GHL_CF_ESTADO_CIVIL_ID!);
    const distrito_de_residencia = getCF(process.env.GHL_CF_DISTRITO_ID!);
    const profesion = getCF(process.env.GHL_CF_PROFESION_ID!);
    const fecha_de_nacimiento = getCF(process.env.GHL_CF_FECHA_NAC_ID!);
    const latitud = getCF(process.env.GHL_CF_LATITUD_ID!);
    const longitud = getCF(process.env.GHL_CF_LONGITUD_ID!);

    // -------------------------------
    // 5. Validación mínima REAL
    // -------------------------------
    if (!celular && !hl_contact_id) {
      return NextResponse.json(
        {
          error:
            'Se requiere al menos celular o hl_contact_id para registrar el contacto.',
        },
        { status: 400 }
      );
    }

    // Convertir lat/long a número
    const latNum = latitud ? Number(latitud) : null;
    const lonNum = longitud ? Number(longitud) : null;

    // -------------------------------
    // 6. INSERT EN SUPABASE
    // -------------------------------
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
          hl_contact_id,
          latitud: latNum,
          longitud: lonNum,
          canal: 'TRADICIONAL',
        },
      ])
      .select('id')
      .single();

    if (error) {
      console.error('Supabase insert error:', error);
      return NextResponse.json(
        { error: 'No se pudo registrar el contacto en Supabase.' },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, id: data.id }, { status: 201 });
  } catch (err) {
    console.error('Error en webhook TRAD:', err);
    return NextResponse.json(
      { error: 'Error interno en el endpoint.' },
      { status: 500 }
    );
  }
}