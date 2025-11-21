/* eslint-disable */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Supabase (igual que en tus otros endpoints)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

// Token que valida que el webhook viene de tu workflow/TRADICIONAL
const WEBHOOK_TOKEN =
  process.env.GHL_API_KEY ??
  process.env.GHL_WEBHOOK_TOKEN ?? // opcional, por si quieres reutilizarla
  '';

export async function POST(req: NextRequest) {
  try {
    // 1) Validar token por querystring ?token=...
    const url = new URL(req.url);
    const token = url.searchParams.get('token');

    if (!WEBHOOK_TOKEN || !token || token !== WEBHOOK_TOKEN) {
      return NextResponse.json(
        { error: 'No autorizado (token inválido).' },
        { status: 401 }
      );
    }

    // 2) Leer body (JSON que manda el workflow)
    const body = (await req.json().catch(() => null)) as Record<string, any> | null;

    if (!body) {
      return NextResponse.json(
        { error: 'Body vacío o inválido.' },
        { status: 400 }
      );
    }

    const {
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
      latitud,
      longitud,
    } = body;

    // 3) Validación mínima (puedes ajustar)
    if (!celular && !hl_contact_id) {
      return NextResponse.json(
        {
          error:
            'Se requiere al menos celular o hl_contact_id para registrar el contacto.',
        },
        { status: 400 }
      );
    }

    // Convertir lat/long a número si vienen como string
    const latNum =
      latitud === null || latitud === undefined || latitud === ''
        ? null
        : Number(latitud);
    const lonNum =
      longitud === null || longitud === undefined || longitud === ''
        ? null
        : Number(longitud);

    // 4) Insertar en tabla contactos
    const { data, error } = await supabase
      .from('contactos')
      .insert([
        {
          nombre_completo: nombre_completo ?? null,
          celular: celular ?? null,
          documento_de_identidad: documento_de_identidad ?? null,
          estado_civil: estado_civil ?? null,
          distrito_de_residencia: distrito_de_residencia ?? null,
          profesion: profesion ?? null,
          email: email ?? null,
          origen: origen ?? null,
          fecha_de_nacimiento: fecha_de_nacimiento ?? null,
          hl_contact_id: hl_contact_id ?? null,
          latitud: Number.isNaN(latNum) ? null : latNum,
          longitud: Number.isNaN(lonNum) ? null : lonNum,
          canal: 'TRADICIONAL',
        },
      ])
      .select('id')
      .single();

    if (error) {
      console.error('Supabase insert error (contactos):', error);
      return NextResponse.json(
        { error: 'No se pudo registrar el contacto en Supabase.' },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { ok: true, id: data?.id ?? null },
      { status: 201 }
    );
  } catch (err) {
    console.error('Error en /api_trad/contact-created:', err);
    return NextResponse.json(
      { error: 'Error interno en el endpoint.' },
      { status: 500 }
    );
  }
}