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
// Token de seguridad
// ==============================
const WEBHOOK_TOKEN =
  process.env.GHL_WEBHOOK_TOKEN ??
  process.env.GHL_API_KEY ??
  '';

// ==============================
// Helpers
// ==============================
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getStringField(
  obj: Record<string, unknown> | null | undefined,
  key: string
): string | null {
  if (!obj) return null;
  const value = obj[key];
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }
  return null;
}

interface AppointmentClean {
  contacto_raw: string | null;            // hl_contact_id (GHL)
  propietario_ghl_id: string | null;      // user id GHL
  ghl_appointment_id: string | null;
  tipo_raw: string | null;
  fecha_hora_inicio: string | null;
  date_inicio_reunion: string | null;
}

// ==============================
// Handler
// ==============================
export async function POST(req: NextRequest) {
  try {
    // --------------------------------------------------
    // 1) Validar token ?token=...
    // --------------------------------------------------
    const url = new URL(req.url);
    const tokenFromQuery = url.searchParams.get('token');

    console.log('[DIG appointment] token query =', tokenFromQuery);

    if (!WEBHOOK_TOKEN || !tokenFromQuery || tokenFromQuery !== WEBHOOK_TOKEN) {
      console.warn(
        '[DIG appointment] Token inválido:',
        tokenFromQuery,
        'esperado:',
        WEBHOOK_TOKEN ? '(definido)' : '(VACÍO)'
      );
      return NextResponse.json(
        { ok: false, error: 'Unauthorized: invalid token' },
        { status: 401 }
      );
    }

    // --------------------------------------------------
    // 2) Leer body
    // --------------------------------------------------
    const rawBody: unknown = await req.json().catch(() => null);

    if (!isRecord(rawBody)) {
      console.error('[DIG appointment] Body no es objeto:', rawBody);
      return NextResponse.json(
        { ok: false, error: 'Invalid payload format' },
        { status: 400 }
      );
    }

    const root = rawBody;

    // --------------------------------------------------
    // 3) Extraer customData si existe
    // --------------------------------------------------
    let customData: Record<string, unknown> = {};
    if ('customData' in root && isRecord(root['customData'])) {
      customData = root['customData'] as Record<string, unknown>;
    }

    console.log('[DIG appointment] root =', JSON.stringify(root, null, 2));
    console.log(
      '[DIG appointment] customData =',
      JSON.stringify(customData, null, 2)
    );

    // --------------------------------------------------
    // 4) Limpiar campos que nos interesan
    // --------------------------------------------------
    const cleaned: AppointmentClean = {
      contacto_raw:
        getStringField(customData, 'contacto') ??
        getStringField(root, 'contacto'),
      propietario_ghl_id:
        getStringField(customData, 'propietario') ??
        getStringField(root, 'propietario'),
      ghl_appointment_id:
        getStringField(customData, 'ghl_appointment_id') ??
        getStringField(root, 'ghl_appointment_id'),
      tipo_raw:
        getStringField(customData, 'tipo') ??
        getStringField(root, 'tipo'),
      fecha_hora_inicio:
        getStringField(customData, 'fecha_hora_inicio') ??
        getStringField(root, 'fecha_hora_inicio'),
      date_inicio_reunion:
        getStringField(customData, 'date_inicio_reunion') ??
        getStringField(root, 'date_inicio_reunion'),
    };

    console.log('[DIG appointment] Campos limpios:', cleaned);

    // --------------------------------------------------
    // 5) Resolver oportunidad
    //
    // contacto_raw (hl_contact_id GHL)
    //   -> contactos.hl_contact_id = contacto_raw -> contactos.id
    //   -> oportunidades.contacto_id = contactos.id -> oportunidades.id
    // --------------------------------------------------
    let oportunidadId: string | null = null;

    if (cleaned.contacto_raw) {
      // 5.1 Buscar contacto local
      let contactoLocalId: string | null = null;

      const { data: contactoRow, error: contactoError } = await supabase
        .from('contactos')
        .select('id')
        .eq('hl_contact_id', cleaned.contacto_raw)
        .maybeSingle();

      if (contactoError) {
        console.error(
          '[DIG appointment] Error buscando contacto por hl_contact_id:',
          contactoError
        );
      } else if (contactoRow?.id) {
        contactoLocalId = contactoRow.id as string;
      } else {
        console.warn(
          '[DIG appointment] No se encontró contacto con hl_contact_id =',
          cleaned.contacto_raw
        );
      }

      // 5.2 Buscar oportunidad por contacto_id (si encontramos el contacto)
      if (contactoLocalId) {
        const { data: oppRow, error: oppError } = await supabase
          .from('oportunidades')
          .select('id')
          .eq('contacto_id', contactoLocalId)
          .maybeSingle();

        if (oppError) {
          console.error(
            '[DIG appointment] Error buscando oportunidad por contacto_id (local):',
            oppError
          );
        } else if (oppRow?.id) {
          oportunidadId = oppRow.id as string;
        } else {
          console.warn(
            '[DIG appointment] No se encontró oportunidad con contacto_id local =',
            contactoLocalId
          );
        }
      }
    } else {
      console.warn(
        '[DIG appointment] Payload sin contacto. Se insertará oportunidad = null.'
      );
    }

    // --------------------------------------------------
    // 6) Resolver propietario (usuarios.ghl_id -> usuarios.id)
    // --------------------------------------------------
    let propietarioId: string | null = null;

    if (cleaned.propietario_ghl_id) {
      const { data: usuarioRow, error: usuarioError } = await supabase
        .from('usuarios')
        .select('id')
        .eq('ghl_id', cleaned.propietario_ghl_id)
        .maybeSingle();

      if (usuarioError) {
        console.error(
          '[DIG appointment] Error buscando propietario en usuarios:',
          usuarioError
        );
      } else if (usuarioRow?.id) {
        propietarioId = usuarioRow.id as string;
      } else {
        console.warn(
          '[DIG appointment] No se encontró usuario con ghl_id =',
          cleaned.propietario_ghl_id
        );
      }
    } else {
      console.warn(
        '[DIG appointment] Payload sin propietario (ghl_id). Se insertará propietario = null.'
      );
    }

    // --------------------------------------------------
    // 7) Resolver tipo (Presentación / Visita a proyecto)
    // --------------------------------------------------
    let tipoFinal: string | null = null;

    if (cleaned.tipo_raw) {
      const t = cleaned.tipo_raw.toLowerCase();

      const esPresentacion =
        t.includes('pres') ||
        t.includes('vir') ||
        t.includes('ofi') ||
        t.includes('zo')  ||
        t.includes('mee');

      const esVisitaProyecto =
        t.includes('vis') ||
        t.includes('proy');

      if (esPresentacion) {
        tipoFinal = 'Presentación';
      } else if (esVisitaProyecto) {
        tipoFinal = 'Visita a proyecto';
      } else {
        // Si no matchea nada, dejamos el texto original
        tipoFinal = cleaned.tipo_raw;
      }
    }

    // --------------------------------------------------
    // 8) Insertar en citas_programadas
    // --------------------------------------------------
    const insertPayload: Record<string, unknown> = {
      oportunidad: oportunidadId,
      propietario: propietarioId,
      ghl_appointment_id: cleaned.ghl_appointment_id,
      tipo: tipoFinal,
      fecha_hora_inicio: cleaned.fecha_hora_inicio,
      date_inicio_reunion: cleaned.date_inicio_reunion,
    };

    console.log(
      '[DIG appointment] insertPayload citas_programadas =',
      JSON.stringify(insertPayload, null, 2)
    );

    const { data: inserted, error: insertError } = await supabase
      .from('citas_programadas')
      .insert(insertPayload)
      .select('id')
      .single();

    if (insertError) {
      console.error(
        '[DIG appointment] Error insertando cita_programada:',
        insertError
      );
      return NextResponse.json(
        { ok: false, error: 'supabase_error', details: insertError.message },
        { status: 500 }
      );
    }

    console.log(
      '[DIG appointment] Insert OK en citas_programadas, id =',
      inserted?.id ?? null
    );

    return NextResponse.json(
      {
        ok: true,
        cita_id: inserted?.id ?? null,
        oportunidad: oportunidadId,
        propietario: propietarioId,
        tipo: tipoFinal,
      },
      { status: 201 }
    );
  } catch (err) {
    console.error('[DIG appointment] Error inesperado:', err);
    return NextResponse.json(
      { ok: false, error: 'unexpected_error' },
      { status: 500 }
    );
  }
}