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
// GHL
// ==============================
const GHL_API_KEY = process.env.GHL_API_KEY!;
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID!;
const GHL_PIPELINE_ID = process.env.GHL_PIPELINE_ID!;
const GHL_STAGE_ID_OPORTUNIDAD_RECIBIDA =
  process.env.GHL_STAGE_ID_OPORTUNIDAD_RECIBIDA!;

// custom fields de CONTACTO
const GHL_CF_ORIGEN_ID = process.env.GHL_CF_ORIGEN_ID!;        // ORIGEN
const GHL_CF_LATITUD_ID = process.env.GHL_CF_LATITUD_ID!;      // LATITUD
const GHL_CF_LONGITUD_ID = process.env.GHL_CF_LONGITUD_ID!;    // LONGITUD

// headers estándar para GHL
const ghlHeaders = {
  Authorization: `Bearer ${GHL_API_KEY}`,
  Accept: 'application/json',
  'Content-Type': 'application/json',
  Version: '2021-07-28',
  'Location-Id': GHL_LOCATION_ID,
} as const;

// ==============================
// Tipos y helpers
// ==============================
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

interface EntornoPersonalPayload {
  nombre_completo: string;
  celular?: string | null;
  proyecto_interes?: string | null;
  comentarios?: string | null;
  token?: string | null;  // usuarios.id
  lat?: number | null;
  lon?: number | null;
}

function normalizarCelularPeru(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  const solo9 = digits.slice(-9);
  if (!solo9) return null;
  // formato E.164
  return `+51${solo9}`;
}

// ==============================
// Handler
// ==============================
export async function POST(req: NextRequest) {
  try {
    const body: unknown = await req.json().catch(() => null);

    if (!isRecord(body)) {
      return NextResponse.json(
        { ok: false, error: 'Invalid payload format' },
        { status: 400 }
      );
    }

    const payload = body as Partial<EntornoPersonalPayload>;

    const nombre_completo = (payload.nombre_completo ?? '').trim();
    const celularRaw =
      payload.celular !== undefined && payload.celular !== null
        ? String(payload.celular).trim()
        : null;
    const proyecto_interes =
      payload.proyecto_interes !== undefined && payload.proyecto_interes !== null
        ? String(payload.proyecto_interes).trim()
        : null;
    const comentarios =
      payload.comentarios !== undefined && payload.comentarios !== null
        ? String(payload.comentarios).trim()
        : null;
    const token =
      payload.token !== undefined && payload.token !== null
        ? String(payload.token).trim()
        : null;
    const lat =
      typeof payload.lat === 'number'
        ? payload.lat
        : null;
    const lon =
      typeof payload.lon === 'number'
        ? payload.lon
        : null;

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

    // 1) Verificar duplicado en Supabase por nombre
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

    // 3) Crear CONTACTO en GHL (upsert) con ORIGEN = "Entorno personal"
    const phone = normalizarCelularPeru(celularRaw);

    const contactCustomFields: Array<{ id: string; value: string }> = [];

    // ORIGEN: ENTORNO PERSONAL
    if (GHL_CF_ORIGEN_ID) {
      contactCustomFields.push({
        id: GHL_CF_ORIGEN_ID,
        value: 'Entorno personal',
      });
    }

    // LATITUD
    if (GHL_CF_LATITUD_ID && typeof lat === 'number') {
      contactCustomFields.push({
        id: GHL_CF_LATITUD_ID,
        value: String(lat),
      });
    }

    // LONGITUD
    if (GHL_CF_LONGITUD_ID && typeof lon === 'number') {
      contactCustomFields.push({
        id: GHL_CF_LONGITUD_ID,
        value: String(lon),
      });
    }

    const contactPayload: any = {
      locationId: GHL_LOCATION_ID,
      firstName: nombre_completo,
    };

    if (phone) contactPayload.phone = phone;

    if (contactCustomFields.length > 0) {
      contactPayload.customFields = contactCustomFields;
    }

    const contactRes = await fetch(
      'https://services.leadconnectorhq.com/contacts/upsert',
      {
        method: 'POST',
        headers: ghlHeaders,
        body: JSON.stringify(contactPayload),
      }
    );

    if (!contactRes.ok) {
      const text = await contactRes.text().catch(() => '');
      console.error(
        '[ENTORNO-PERSONAL] GHL contact error:',
        contactRes.status,
        text
      );
      return NextResponse.json(
        { ok: false, error: 'ghl_contact_error' },
        { status: 502 }
      );
    }

    const contactJson = await contactRes.json().catch(() => ({}));
    const contactId =
      contactJson.id ||
      contactJson.contact?.id ||
      contactJson.data?.id ||
      contactJson.result?.id;

    if (!contactId) {
      console.error(
        '[ENTORNO-PERSONAL] GHL contact response sin id:',
        contactJson
      );
      return NextResponse.json(
        { ok: false, error: 'ghl_contact_id_missing' },
        { status: 502 }
      );
    }

    // 4) Crear NOTA en GHL (proyecto + comentarios + otros datos)
    const partesNota = [
      proyecto_interes && `Proyecto de interés: ${proyecto_interes}`,
      comentarios && `Comentarios: ${comentarios}`,
      celularRaw && `Celular registrado: ${celularRaw}`,
      typeof lat === 'number' && typeof lon === 'number'
        ? `Coordenadas: ${lat}, ${lon}`
        : null,
      'Origen: Entorno personal',
    ].filter(Boolean);

    const notaTexto = partesNota.join('\n');

    if (notaTexto) {
      try {
        const noteRes = await fetch(
          `https://services.leadconnectorhq.com/contacts/${encodeURIComponent(
            String(contactId)
          )}/notes`,
          {
            method: 'POST',
            headers: ghlHeaders,
            body: JSON.stringify({ body: notaTexto }),
          }
        );

        if (!noteRes.ok) {
          const text = await noteRes.text().catch(() => '');
          console.error(
            '[ENTORNO-PERSONAL] GHL note error:',
            noteRes.status,
            text
          );
        }
      } catch (e) {
        console.error('[ENTORNO-PERSONAL] Error creando nota en GHL:', e);
      }
    }

    // 5) Crear OPORTUNIDAD en GHL (pipeline Cartera propia, etapa Oportunidad recibida)
    const opportunityPayload: any = {
      locationId: GHL_LOCATION_ID,
      contactId: String(contactId),
      pipelineId: GHL_PIPELINE_ID,
      pipelineStageId: GHL_STAGE_ID_OPORTUNIDAD_RECIBIDA,
      status: 'open',
      name: nombre_completo,
      source: 'Entorno personal',
    };

    if (ownerGhlId) {
      opportunityPayload.assignedTo = String(ownerGhlId);
    }

    const oppRes = await fetch(
      'https://services.leadconnectorhq.com/opportunities/',
      {
        method: 'POST',
        headers: ghlHeaders,
        body: JSON.stringify(opportunityPayload),
      }
    );

    if (!oppRes.ok) {
      const text = await oppRes.text().catch(() => '');
      console.error(
        '[ENTORNO-PERSONAL] GHL opportunity error:',
        oppRes.status,
        text
      );
      // Contacto ya está creado, pero hubo problema con la oportunidad
      return NextResponse.json(
        {
          ok: true,
          warning:
            'Contacto creado, pero no se pudo crear la oportunidad en GHL. Revisa logs.',
        },
        { status: 201 }
      );
    }

    return NextResponse.json(
      { ok: true, message: 'Prospecto de entorno personal creado correctamente.' },
      { status: 201 }
    );
  } catch (err) {
    console.error('[ENTORNO-PERSONAL] Error inesperado:', err);
    return NextResponse.json(
      { ok: false, error: 'Error interno.' },
      { status: 500 }
    );
  }
}