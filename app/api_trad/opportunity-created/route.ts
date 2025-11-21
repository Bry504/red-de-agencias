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

function toNumberOrNull(v: string | null): number | null {
  if (!v) return null;
  // limpiar símbolos de moneda, espacios, etc.
  const cleaned = v.replace(/[^\d,.\-]/g, '').replace(',', '.');
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
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

    console.log('[TRAD opportunity-created] token query =', tokenFromQuery);

    if (!WEBHOOK_TOKEN || !tokenFromQuery || tokenFromQuery !== WEBHOOK_TOKEN) {
      console.warn(
        '[TRAD opportunity-created] Token inválido:',
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
    // 2) Leer body bruto
    // --------------------------------------------------
    const rawBody: unknown = await req.json().catch(() => null);

    if (!isRecord(rawBody)) {
      console.error('[TRAD opportunity-created] Body no es objeto:', rawBody);
      return NextResponse.json(
        { ok: false, error: 'Invalid payload format' },
        { status: 400 }
      );
    }

    const root = rawBody;

    // HighLevel suele mandar { opportunity: {...}, contact: {...}, customData: {...} }
    let opportunity: Record<string, unknown> = {};
    if ('opportunity' in root && isRecord(root['opportunity'])) {
      opportunity = root['opportunity'] as Record<string, unknown>;
    } else {
      // fallback: todo viene plano
      opportunity = root;
    }

    let customData: Record<string, unknown> = {};
    if ('customData' in root && isRecord(root['customData'])) {
      customData = root['customData'] as Record<string, unknown>;
    }

    console.log(
      '[TRAD opportunity-created] root =',
      JSON.stringify(root, null, 2)
    );
    console.log(
      '[TRAD opportunity-created] opportunity =',
      JSON.stringify(opportunity, null, 2)
    );
    console.log(
      '[TRAD opportunity-created] customData =',
      JSON.stringify(customData, null, 2)
    );

    // --------------------------------------------------
    // 3) Resolver campos enviados por el workflow
    // --------------------------------------------------

    // hl_opportunity_id (clave lógica de la oportunidad)
    const hl_opportunity_id =
      getStringField(customData, 'hl_opportunity_id') ??
      getStringField(root, 'hl_opportunity_id') ??
      getStringField(opportunity, 'id');

    if (!hl_opportunity_id) {
      console.warn(
        '[TRAD opportunity-created] Sin hl_opportunity_id. No se inserta.'
      );
      return NextResponse.json(
        { ok: false, error: 'Missing hl_opportunity_id' },
        { status: 400 }
      );
    }

    // propietario: viene como userId de GHL
    const propietarioGhlId =
      getStringField(customData, 'propietario') ??
      getStringField(root, 'propietario') ??
      getStringField(opportunity, 'assignedUserId');

    // contacto: viene como contactId de GHL
    const contactoHlId =
      getStringField(customData, 'contacto') ??
      getStringField(root, 'contacto') ??
      getStringField(opportunity, 'contactId');

    const estado =
      getStringField(customData, 'estado') ??
      getStringField(root, 'estado') ??
      getStringField(opportunity, 'status');

    const nivel_de_interes =
      getStringField(customData, 'nivel_de_interes') ??
      getStringField(root, 'nivel_de_interes');

    const tipo_de_cliente =
      getStringField(customData, 'tipo_de_cliente') ??
      getStringField(root, 'tipo_de_cliente');

    const producto =
      getStringField(customData, 'producto') ??
      getStringField(root, 'producto');

    const proyecto =
      getStringField(customData, 'proyecto') ??
      getStringField(root, 'proyecto');

    const modalidad_de_pago =
      getStringField(customData, 'modalidad_de_pago') ??
      getStringField(root, 'modalidad_de_pago');

    const pipeline =
      getStringField(customData, 'pipeline') ??
      getStringField(root, 'pipeline') ??
      getStringField(opportunity, 'pipelineId');

    const motivo_de_seguimiento =
      getStringField(customData, 'motivo_de_seguimiento') ??
      getStringField(root, 'motivo_de_seguimiento');

    const principales_objeciones =
      getStringField(customData, 'principales_objeciones') ??
      getStringField(root, 'principales_objeciones');

    const arrasStr =
      getStringField(customData, 'arras') ??
      getStringField(root, 'arras');

    const cuotaInicialStr =
      getStringField(customData, 'cuota_inicial_pagada') ??
      getStringField(root, 'cuota_inicial_pagada');

    const arras = toNumberOrNull(arrasStr);
    const cuota_inicial_pagada = toNumberOrNull(cuotaInicialStr);

    console.log('[TRAD opportunity-created] Campos mapeados:', {
      hl_opportunity_id,
      propietarioGhlId,
      contactoHlId,
      estado,
      nivel_de_interes,
      tipo_de_cliente,
      producto,
      proyecto,
      modalidad_de_pago,
      pipeline,
      motivo_de_seguimiento,
      principales_objeciones,
      arras,
      cuota_inicial_pagada
    });

    // --------------------------------------------------
    // 4) Resolver IDs locales (propietario_id, contacto_id)
    // --------------------------------------------------
    let propietario_id: string | null = null;
    if (propietarioGhlId) {
      const { data: userRow, error: userErr } = await supabase
        .from('usuarios')
        .select('id')
        .eq('ghl_id', propietarioGhlId)
        .maybeSingle();

      if (userErr) {
        console.error(
          '[TRAD opportunity-created] Error buscando usuario por ghl_id:',
          userErr
        );
        // No cortamos, pero dejamos propietario_id en null
      } else if (userRow) {
        propietario_id = String(userRow.id);
      } else {
        console.warn(
          '[TRAD opportunity-created] No se encontró usuario con ghl_id =',
          propietarioGhlId
        );
      }
    }

    let contacto_id: string | null = null;
    if (contactoHlId) {
      const { data: contactoRow, error: contactoErr } = await supabase
        .from('contactos')
        .select('id')
        .eq('hl_contact_id', contactoHlId)
        .maybeSingle();

      if (contactoErr) {
        console.error(
          '[TRAD opportunity-created] Error buscando contacto por hl_contact_id:',
          contactoErr
        );
        // No cortamos, pero dejamos contacto_id en null
      } else if (contactoRow) {
        contacto_id = String(contactoRow.id);
      } else {
        console.warn(
          '[TRAD opportunity-created] No se encontró contacto con hl_contact_id =',
          contactoHlId
        );
      }
    }

    // --------------------------------------------------
    // 5) Armar payload de inserción en oportunidades
    // --------------------------------------------------
    const insertPayload: Record<string, unknown> = {
      propietario_id,            // FK a usuarios.id
      estado,
      nivel_de_interes,
      tipo_de_cliente,
      producto,
      proyecto,
      modalidad_de_pago,
      contacto_id,              // FK a contactos.id
      hl_opportunity_id,
      pipeline,
      motivo_de_seguimiento,
      principales_objeciones,
      arras,
      cuota_inicial_pagada
    };

    console.log(
      '[TRAD opportunity-created] insertPayload =',
      JSON.stringify(insertPayload, null, 2)
    );

    const { data: inserted, error: insertError } = await supabase
      .from('oportunidades')
      .insert([insertPayload])
      .select('id')
      .single();

    if (insertError) {
      console.error(
        '[TRAD opportunity-created] Error insertando oportunidad:',
        insertError
      );
      return NextResponse.json(
        { ok: false, error: 'supabase_insert_error' },
        { status: 500 }
      );
    }

    console.log(
      '[TRAD opportunity-created] Insert OK, id =',
      inserted?.id ?? null
    );

    return NextResponse.json(
      { ok: true, id: inserted?.id ?? null },
      { status: 201 }
    );
  } catch (err) {
    console.error('[TRAD opportunity-created] Error inesperado:', err);
    return NextResponse.json(
      { ok: false, error: 'unexpected_error' },
      { status: 500 }
    );
  }
}