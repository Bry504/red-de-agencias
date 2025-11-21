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
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
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

    console.log('[TRAD opportunity-updated] token query =', tokenFromQuery);

    if (!WEBHOOK_TOKEN || !tokenFromQuery || tokenFromQuery !== WEBHOOK_TOKEN) {
      console.warn(
        '[TRAD opportunity-updated] Token inválido:',
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
      console.error('[TRAD opportunity-updated] Body no es objeto:', rawBody);
      return NextResponse.json(
        { ok: false, error: 'Invalid payload format' },
        { status: 400 }
      );
    }

    const root = rawBody;

    // En este caso el payload viene plano, pero dejamos la misma estructura
    // por si en algún momento GHL envía "opportunity" anidado.
    let opportunity: Record<string, unknown> = {};
    if ('opportunity' in root && isRecord(root['opportunity'])) {
      opportunity = root['opportunity'] as Record<string, unknown>;
    } else {
      opportunity = root;
    }

    let customData: Record<string, unknown> = {};
    if ('customData' in root && isRecord(root['customData'])) {
      customData = root['customData'] as Record<string, unknown>;
    }

    console.log(
      '[TRAD opportunity-updated] root =',
      JSON.stringify(root, null, 2)
    );
    console.log(
      '[TRAD opportunity-updated] opportunity =',
      JSON.stringify(opportunity, null, 2)
    );
    console.log(
      '[TRAD opportunity-updated] customData =',
      JSON.stringify(customData, null, 2)
    );

    // --------------------------------------------------
    // 3) Resolver campos básicos (igual que opportunity-created)
    // --------------------------------------------------

    // hl_opportunity_id es la llave para actualizar
    const hl_opportunity_id =
      getStringField(customData, 'hl_opportunity_id') ??
      getStringField(root, 'hl_opportunity_id') ??
      getStringField(opportunity, 'id');

    if (!hl_opportunity_id) {
      console.warn(
        '[TRAD opportunity-updated] Sin hl_opportunity_id. No se actualiza.'
      );
      return NextResponse.json(
        { ok: false, error: 'Missing hl_opportunity_id' },
        { status: 400 }
      );
    }

    // Datos de customData
    const propietarioHlId =
      getStringField(customData, 'propietario') ??
      getStringField(root, 'propietario');

    const estado =
      getStringField(customData, 'estado') ??
      getStringField(root, 'estado');

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

    const contactoHlId =
      getStringField(customData, 'contacto') ??
      getStringField(root, 'contacto');

    const pipeline =
      getStringField(customData, 'pipeline') ??
      getStringField(root, 'pipeline');

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

    console.log('[TRAD opportunity-updated] Campos recibidos (limpios):', {
      propietarioHlId,
      estado,
      nivel_de_interes,
      tipo_de_cliente,
      producto,
      proyecto,
      modalidad_de_pago,
      contactoHlId,
      hl_opportunity_id,
      pipeline,
      motivo_de_seguimiento,
      principales_objeciones,
      arras,
      cuota_inicial_pagada
    });

    // --------------------------------------------------
    // 4) Resolver propietario_id (usuarios.ghl_id -> usuarios.id)
    // --------------------------------------------------
    let propietario_id: string | null = null;

    if (propietarioHlId) {
      const { data: usuarioRow, error: usuarioError } = await supabase
        .from('usuarios')
        .select('id')
        .eq('ghl_id', propietarioHlId)
        .maybeSingle();

      if (usuarioError) {
        console.error(
          '[TRAD opportunity-updated] Error buscando propietario en usuarios:',
          usuarioError
        );
      } else if (usuarioRow?.id) {
        propietario_id = usuarioRow.id as string;
      } else {
        console.warn(
          '[TRAD opportunity-updated] No se encontró usuario con ghl_id =',
          propietarioHlId
        );
      }
    }

    // --------------------------------------------------
    // 5) Resolver contacto_id (contactos.hl_contact_id -> contactos.id)
    // --------------------------------------------------
    let contacto_id: string | null = null;

    if (contactoHlId) {
      const { data: contactoRow, error: contactoError } = await supabase
        .from('contactos')
        .select('id')
        .eq('hl_contact_id', contactoHlId)
        .maybeSingle();

      if (contactoError) {
        console.error(
          '[TRAD opportunity-updated] Error buscando contacto en contactos:',
          contactoError
        );
      } else if (contactoRow?.id) {
        contacto_id = contactoRow.id as string;
      } else {
        console.warn(
          '[TRAD opportunity-updated] No se encontró contacto con hl_contact_id =',
          contactoHlId
        );
      }
    }

    // --------------------------------------------------
    // 6) Ver si existe la oportunidad en Supabase
    // --------------------------------------------------
    const { data: existingOpp, error: fetchError } = await supabase
      .from('oportunidades')
      .select('id')
      .eq('hl_opportunity_id', hl_opportunity_id)
      .maybeSingle();

    if (fetchError) {
      console.error(
        '[TRAD opportunity-updated] Error buscando oportunidad por hl_opportunity_id:',
        fetchError
      );
      return NextResponse.json(
        { ok: false, error: 'supabase_fetch_error' },
        { status: 500 }
      );
    }

    if (!existingOpp) {
      console.warn(
        '[TRAD opportunity-updated] No se encontró oportunidad con hl_opportunity_id =',
        hl_opportunity_id,
        '. No se actualiza nada.'
      );
      return NextResponse.json(
        { ok: true, updated: false, reason: 'not_found' },
        { status: 200 }
      );
    }

    // --------------------------------------------------
    // 7) Armar payload de actualización
    //    (sobrescribe los valores que vienen del webhook)
    // --------------------------------------------------
    const updatePayload: Record<string, unknown> = {
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
      cuota_inicial_pagada,
      updated_at: new Date().toISOString()
    };

    // Sólo actualizamos propietario/contacto si logramos mapearlos
    if (propietario_id !== null) {
      updatePayload.propietario_id = propietario_id;
    }
    if (contacto_id !== null) {
      updatePayload.contacto_id = contacto_id;
    }

    console.log(
      '[TRAD opportunity-updated] updatePayload =',
      JSON.stringify(updatePayload, null, 2)
    );

    const { data: updatedRow, error: updateError } = await supabase
      .from('oportunidades')
      .update(updatePayload)
      .eq('hl_opportunity_id', hl_opportunity_id)
      .select('id')
      .single();

    if (updateError) {
      console.error(
        '[TRAD opportunity-updated] Error actualizando oportunidad:',
        updateError
      );
      return NextResponse.json(
        { ok: false, error: 'supabase_update_error' },
        { status: 500 }
      );
    }

    console.log(
      '[TRAD opportunity-updated] Update OK, id =',
      updatedRow?.id ?? null
    );

    return NextResponse.json(
      { ok: true, updated: true, id: updatedRow?.id ?? null },
      { status: 200 }
    );
  } catch (err) {
    console.error('[TRAD opportunity-updated] Error inesperado:', err);
    return NextResponse.json(
      { ok: false, error: 'unexpected_error' },
      { status: 500 }
    );
  }
}