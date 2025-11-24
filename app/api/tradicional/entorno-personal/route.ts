/* eslint-disable */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// ==============================
// Supabase
// ==============================
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

// ==============================
// HighLevel API config (API 2.0)
// ==============================
const GHL_API_BASE = process.env.GHL_API_BASE_URL ?? 'https://services.leadconnectorhq.com';
const GHL_API_KEY = process.env.GHL_API_KEY;
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID;

const GHL_PIPELINE_ID = process.env.GHL_PIPELINE_ID;
const GHL_STAGE_ID_OP_RECIBIDA = process.env.GHL_STAGE_ID_OPORTUNIDAD_RECIBIDA;

// IDs de custom fields para latitud / longitud en HL
const GHL_CF_LATITUD_ID = process.env.GHL_CF_LATITUD_ID;
const GHL_CF_LONGITUD_ID = process.env.GHL_CF_LONGITUD_ID;

// ==============================
// Helpers
// ==============================
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

interface EntornoPersonalPayload {
  nombre_completo: string;
  celular?: string | null;
  proyecto_interes?: string | null;
  comentarios?: string | null;
  token?: string | null;     // usuarios.id
  latitud?: number | null;
  longitud?: number | null;
}

function normalizarCelularPeru(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  const solo9 = digits.slice(-9);
  if (!solo9) return null;
  // Enviamos en formato E.164 (+51...)
  return `+51${solo9}`;
}

// ==============================
// Handler
// ==============================
export async function POST(req: NextRequest) {
  try {
    if (!GHL_API_KEY || !GHL_LOCATION_ID || !GHL_PIPELINE_ID || !GHL_STAGE_ID_OP_RECIBIDA) {
      console.error('[ENTORNO-PERSONAL] Faltan variables de entorno de GHL');
      return NextResponse.json(
        { ok: false, error: 'Configuración de GHL incompleta en el servidor.' },
        { status: 500 }
      );
    }

    const body: unknown = await req.json().catch(() => null);

    if (!isRecord(body)) {
      return NextResponse.json(
        { ok: false, error: 'Invalid payload format' },
        { status: 400 }
      );
    }

    const payload = body as Partial<EntornoPersonalPayload>;

    const nombre_completo = (payload.nombre_completo ?? '').trim();
    const celularRaw = (payload.celular ?? '').toString().trim() || null;
    const proyecto_interes = (payload.proyecto_interes ?? '').toString().trim() || null;
    const comentarios = (payload.comentarios ?? '').toString().trim() || null;
    const token = (payload.token ?? '').toString().trim() || null;
    const latitud =
      typeof payload.latitud === 'number' ? payload.latitud : null;
    const longitud =
      typeof payload.longitud === 'number' ? payload.longitud : null;

    if (!nombre_completo) {
      return NextResponse.json(
        { ok: false, error: 'El nombre completo es obligatorio.' },
        { status: 400 }
      );
    }

    if (!token) {
      return NextResponse.json(
        { ok: false, error: 'Enlace inválido: falta el identificador del asesor.' },
        { status: 400 }
      );
    }

    // 1) Verificar que no exista otro contacto con el mismo nombre en Supabase
    const { data: existingContact, error: existingError } = await supabase
      .from('contactos')
      .select('id')
      .eq('nombre_completo', nombre_completo)
      .maybeSingle();

    if (existingError) {
      console.error(
        '[ENTORNO-PERSONAL] Error buscando contacto existente:',
        existingError
      );
      return NextResponse.json(
        { ok: false, error: 'supabase_search_error' },
        { status: 500 }
      );
    }

    if (existingContact) {
      return NextResponse.json(
        {
          ok: false,
          error:
            'Ya existe un contacto registrado con ese nombre. Por favor revisa antes de crear uno nuevo.',
        },
        { status: 409 }
      );
    }

    // 2) Obtener ghl_id del asesor (usuarios.id = token)
    const { data: usuarioRow, error: usuarioError } = await supabase
      .from('usuarios')
      .select('ghl_id')
      .eq('id', token)
      .maybeSingle();

    if (usuarioError) {
      console.error('[ENTORNO-PERSONAL] Error buscando usuario por token:', usuarioError);
      return NextResponse.json(
        { ok: false, error: 'supabase_user_error' },
        { status: 500 }
      );
    }

    const ownerGhlId = usuarioRow?.ghl_id ?? null;
    if (!ownerGhlId) {
      console.warn(
        '[ENTORNO-PERSONAL] No se encontró ghl_id para el usuario con id =',
        token
      );
    }

    const phone = normalizarCelularPeru(celularRaw);

    // 3) Crear contacto en GHL
    const customFields: Array<{ id: string; value: string | number }> = [];

    if (GHL_CF_LATITUD_ID && latitud !== null) {
      customFields.push({ id: GHL_CF_LATITUD_ID, value: latitud });
    }
    if (GHL_CF_LONGITUD_ID && longitud !== null) {
      customFields.push({ id: GHL_CF_LONGITUD_ID, value: longitud });
    }

    const notasPieces: string[] = [];
    if (proyecto_interes) notasPieces.push(`Proyecto de interés: ${proyecto_interes}`);
    if (comentarios) notasPieces.push(`Comentarios: ${comentarios}`);
    const notas = notasPieces.join(' | ');

    const contactBody: Record<string, any> = {
      locationId: GHL_LOCATION_ID,
      firstName: nombre_completo,
      source: 'Entorno personal',
    };

    if (phone) contactBody.phone = phone;
    if (notas) contactBody.notes = notas;
    if (customFields.length > 0) contactBody.customFields = customFields;

    const contactRes = await fetch(`${GHL_API_BASE}/contacts/`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${GHL_API_KEY}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Version: '2021-07-28',
      },
      body: JSON.stringify(contactBody),
    });

    const contactJson = await contactRes.json().catch(() => null);

    if (!contactRes.ok) {
      console.error('[ENTORNO-PERSONAL] Error creando contacto en GHL:', {
        status: contactRes.status,
        body: contactJson,
      });
      return NextResponse.json(
        { ok: false, error: 'ghl_contact_error' },
        { status: 502 }
      );
    }

    const contactId =
      (contactJson && (contactJson.id || contactJson.contact?.id || contactJson.data?.id)) ??
      null;

    if (!contactId) {
      console.error('[ENTORNO-PERSONAL] No se pudo resolver contactId de la respuesta GHL:', contactJson);
      return NextResponse.json(
        { ok: false, error: 'ghl_contact_id_missing' },
        { status: 502 }
      );
    }

    // 4) Crear oportunidad en GHL (Cartera propia / Oportunidad recibida)
    const oppBody: Record<string, any> = {
      locationId: GHL_LOCATION_ID,
      pipelineId: GHL_PIPELINE_ID,
      stageId: GHL_STAGE_ID_OP_RECIBIDA,
      status: 'open',
      name: nombre_completo,
      contactId,
      source: 'Entorno personal',
    };

    if (ownerGhlId) {
      // Campo típico: assignedTo/ownerId depende de cómo tengas configurado HL;
      // ajústalo si tu doc de API usa otro nombre.
      oppBody.assignedTo = ownerGhlId;
    }

    const oppRes = await fetch(`${GHL_API_BASE}/opportunities/`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${GHL_API_KEY}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Version: '2021-07-28',
      },
      body: JSON.stringify(oppBody),
    });

    const oppJson = await oppRes.json().catch(() => null);

    if (!oppRes.ok) {
      console.error('[ENTORNO-PERSONAL] Error creando oportunidad en GHL:', {
        status: oppRes.status,
        body: oppJson,
      });
      // No rompo el contacto, pero aviso al front
      return NextResponse.json(
        {
          ok: false,
          error: 'ghl_opportunity_error',
          detalle: 'Contacto creado, pero hubo un problema creando la oportunidad en GHL.',
        },
        { status: 502 }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        contact_id: contactId,
        opportunity: oppJson,
      },
      { status: 201 }
    );
  } catch (err) {
    console.error('[ENTORNO-PERSONAL] Error inesperado:', err);
    return NextResponse.json(
      { ok: false, error: 'unexpected_error' },
      { status: 500 }
    );
  }
}