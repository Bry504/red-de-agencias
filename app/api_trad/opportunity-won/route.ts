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

interface OpportunityWonClean {
  hl_opportunity_id: string | null;
  propietario_ghl_id: string | null;
  pipeline_text: string | null;
  arras_str: string | null;
  cuota_inicial_str: string | null;
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

    console.log('[TRAD opportunity-won] token query =', tokenFromQuery);

    if (!WEBHOOK_TOKEN || !tokenFromQuery || tokenFromQuery !== WEBHOOK_TOKEN) {
      console.warn(
        '[TRAD opportunity-won] Token inválido:',
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
      console.error('[TRAD opportunity-won] Body no es objeto:', rawBody);
      return NextResponse.json(
        { ok: false, error: 'Invalid payload format' },
        { status: 400 }
      );
    }

    const root = rawBody;

    // --------------------------------------------------
    // 3) Extraer opportunity y customData si existen
    // --------------------------------------------------
    let opportunityObj: Record<string, unknown> = {};
    if ('opportunity' in root && isRecord(root['opportunity'])) {
      opportunityObj = root['opportunity'] as Record<string, unknown>;
    }

    let customData: Record<string, unknown> = {};
    if ('customData' in root && isRecord(root['customData'])) {
      customData = root['customData'] as Record<string, unknown>;
    }

    console.log(
      '[TRAD opportunity-won] root =',
      JSON.stringify(root, null, 2)
    );
    console.log(
      '[TRAD opportunity-won] opportunity =',
      JSON.stringify(opportunityObj, null, 2)
    );
    console.log(
      '[TRAD opportunity-won] customData =',
      JSON.stringify(customData, null, 2)
    );

    // --------------------------------------------------
    // 4) Limpiar campos que nos interesan
    // --------------------------------------------------
    let hlOpportunityId =
      getStringField(customData, 'oportunidad') ??
      getStringField(root, 'oportunidad');

    if (!hlOpportunityId) {
      hlOpportunityId =
        getStringField(opportunityObj, 'id') ??
        getStringField(root, 'hl_opportunity_id');
    }

    const cleaned: OpportunityWonClean = {
      hl_opportunity_id: hlOpportunityId ?? null,
      propietario_ghl_id:
        getStringField(customData, 'propietario') ??
        getStringField(root, 'propietario'),
      pipeline_text:
        getStringField(customData, 'pipeline') ??
        getStringField(root, 'pipeline'),
      arras_str:
        getStringField(customData, 'arras') ??
        getStringField(root, 'arras'),
      cuota_inicial_str:
        getStringField(customData, 'cuota_inicial_pagada') ??
        getStringField(root, 'cuota_inicial_pagada'),
    };

    console.log('[TRAD opportunity-won] Campos limpios:', cleaned);

    if (!cleaned.hl_opportunity_id) {
      console.warn('[TRAD opportunity-won] Falta hl_opportunity_id (oportunidad)');
      return NextResponse.json(
        { ok: false, error: 'Missing hl_opportunity_id' },
        { status: 400 }
      );
    }

    // --------------------------------------------------
    // 5) Buscar oportunidad por hl_opportunity_id
    // --------------------------------------------------
    const { data: oppRow, error: oppError } = await supabase
      .from('oportunidades')
      .select('id')
      .eq('hl_opportunity_id', cleaned.hl_opportunity_id)
      .maybeSingle();

    if (oppError) {
      console.error(
        '[TRAD opportunity-won] Error buscando oportunidad por hl_opportunity_id:',
        oppError
      );
      return NextResponse.json(
        { ok: false, error: 'supabase_error', details: oppError.message },
        { status: 500 }
      );
    }

    if (!oppRow) {
      console.warn(
        '[TRAD opportunity-won] No se encontró oportunidad con hl_opportunity_id =',
        cleaned.hl_opportunity_id
      );
      return NextResponse.json(
        {
          ok: true,
          inserted: false,
          reason: 'not_found',
        },
        { status: 200 }
      );
    }

    const oportunidadId = oppRow.id as string;

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
          '[TRAD opportunity-won] Error buscando propietario en usuarios:',
          usuarioError
        );
      } else if (usuarioRow?.id) {
        propietarioId = usuarioRow.id as string;
      } else {
        console.warn(
          '[TRAD opportunity-won] No se encontró usuario con ghl_id =',
          cleaned.propietario_ghl_id
        );
      }
    } else {
      console.warn(
        '[TRAD opportunity-won] Payload sin propietario (ghl_id). Se insertará propietario = null.'
      );
    }

    // --------------------------------------------------
    // 7) Parsear arras y cuota_inicial_pagada
    // --------------------------------------------------
    const arras = toNumberOrNull(cleaned.arras_str);
    const cuota_inicial_pagada = toNumberOrNull(cleaned.cuota_inicial_str);

    // --------------------------------------------------
    // 8) Insertar en op_ganadas
    // --------------------------------------------------
    const insertPayload: Record<string, unknown> = {
      oportunidad: oportunidadId,          // FK a oportunidades.id
      propietario: propietarioId,          // FK a usuarios.id (puede ser null)
      pipeline: cleaned.pipeline_text,     // texto tal cual del webhook
      arras,
      cuota_inicial_pagada,
    };

    console.log(
      '[TRAD opportunity-won] insertPayload op_ganadas =',
      JSON.stringify(insertPayload, null, 2)
    );

    const { data: inserted, error: insertError } = await supabase
      .from('op_ganadas')
      .insert(insertPayload)
      .select('id')
      .single();

    if (insertError) {
      console.error(
        '[TRAD opportunity-won] Error insertando op_ganadas:',
        insertError
      );
      return NextResponse.json(
        { ok: false, error: 'supabase_error', details: insertError.message },
        { status: 500 }
      );
    }

    console.log(
      '[TRAD opportunity-won] Insert OK en op_ganadas, id =',
      inserted?.id ?? null
    );

    return NextResponse.json(
      {
        ok: true,
        inserted: true,
        op_ganadas_id: inserted?.id ?? null,
        oportunidad: oportunidadId,
        propietario: propietarioId,
      },
      { status: 201 }
    );
  } catch (err) {
    console.error('[TRAD opportunity-won] Error inesperado:', err);
    return NextResponse.json(
      { ok: false, error: 'unexpected_error' },
      { status: 500 }
    );
  }
}