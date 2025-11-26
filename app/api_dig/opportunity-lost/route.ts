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

interface OpportunityLostClean {
  hl_opportunity_id: string;
  propietario_ghl_id: string | null;
  motivo_de_perdida: string | null;
  pipeline_text: string | null; // texto que manda el webhook
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

    console.log('[DIG opportunity-lost] token query =', tokenFromQuery);

    if (!WEBHOOK_TOKEN || !tokenFromQuery || tokenFromQuery !== WEBHOOK_TOKEN) {
      console.warn(
        '[DIG opportunity-lost] Token inválido:',
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
      console.error('[DIG opportunity-lost] Body no es objeto:', rawBody);
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
      '[DIG opportunity-lost] root =',
      JSON.stringify(root, null, 2)
    );
    console.log(
      '[DIG opportunity-lost] opportunity =',
      JSON.stringify(opportunityObj, null, 2)
    );
    console.log(
      '[DIG opportunity-lost] customData =',
      JSON.stringify(customData, null, 2)
    );

    // --------------------------------------------------
    // 4) Resolver hl_opportunity_id
    // --------------------------------------------------
    let hlOpportunityId =
      getStringField(customData, 'hl_opportunity_id') ??
      getStringField(root, 'hl_opportunity_id');

    if (!hlOpportunityId) {
      hlOpportunityId =
        getStringField(opportunityObj, 'id') ??
        getStringField(root, 'opportunity_id');
    }

    if (!hlOpportunityId) {
      console.warn(
        '[DIG opportunity-lost] SKIP: Body sin hl_opportunity_id reconocible'
      );
      return NextResponse.json(
        {
          ok: true,
          skipped: true,
          reason: 'skip: missing hl_opportunity_id',
        },
        { status: 200 }
      );
    }

    // --------------------------------------------------
    // 5) Limpiar campos que nos interesan
    // --------------------------------------------------
    const cleaned: OpportunityLostClean = {
      hl_opportunity_id: hlOpportunityId,
      propietario_ghl_id:
        getStringField(customData, 'propietario') ??
        getStringField(root, 'propietario'),
      motivo_de_perdida:
        getStringField(customData, 'motivo_de_perdida') ??
        getStringField(root, 'motivo_de_perdida'),
      pipeline_text:
        getStringField(customData, 'pipeline') ??
        getStringField(root, 'pipeline'),
    };

    console.log('[DIG opportunity-lost] Campos limpios:', cleaned);

    // --------------------------------------------------
    // 6) Buscar oportunidad por hl_opportunity_id
    // --------------------------------------------------
    const { data: oppRow, error: oppError } = await supabase
      .from('oportunidades')
      .select('id')
      .eq('hl_opportunity_id', cleaned.hl_opportunity_id)
      .maybeSingle();

    if (oppError) {
      console.error(
        '[DIG opportunity-lost] Error buscando oportunidad por hl_opportunity_id:',
        oppError
      );
      return NextResponse.json(
        { ok: false, error: 'supabase_error', details: oppError.message },
        { status: 500 }
      );
    }

    if (!oppRow) {
      console.warn(
        '[DIG opportunity-lost] SKIP: no se encontró oportunidad con hl_opportunity_id =',
        cleaned.hl_opportunity_id
      );
      return NextResponse.json(
        {
          ok: true,
          skipped: true,
          reason: 'skip: oportunidad no encontrada',
          hl_opportunity_id: cleaned.hl_opportunity_id,
        },
        { status: 200 }
      );
    }

    const oportunidadId = oppRow.id as string;

    // --------------------------------------------------
    // 7) Resolver etapa_de_perdida = última etapa_destino en historial_etapas
    // --------------------------------------------------
    let etapaDePerdida: string | null = null;

    const { data: lastStage, error: lastStageError } = await supabase
      .from('historial_etapas')
      .select('etapa_destino')
      .eq('oportunidad', oportunidadId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastStageError) {
      console.error(
        '[DIG opportunity-lost] Error obteniendo última etapa en historial_etapas:',
        lastStageError
      );
    } else if (lastStage && lastStage.etapa_destino) {
      etapaDePerdida = lastStage.etapa_destino as string;
    }

    // --------------------------------------------------
    // 8) Resolver propietario (usuarios.ghl_id -> usuarios.id)
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
          '[DIG opportunity-lost] Error buscando propietario en usuarios:',
          usuarioError
        );
      } else if (usuarioRow?.id) {
        propietarioId = usuarioRow.id as string;
      } else {
        console.warn(
          '[DIG opportunity-lost] SKIP propietario: no se encontró usuario con ghl_id =',
          cleaned.propietario_ghl_id,
          '→ se insertará propietario = null'
        );
      }
    } else {
      console.warn(
        '[DIG opportunity-lost] Payload sin propietario (ghl_id). Se insertará propietario = null.'
      );
    }

    // --------------------------------------------------
    // 9) Insertar en op_perdidas (pipeline como texto directo)
    // --------------------------------------------------
    const insertPayload: Record<string, unknown> = {
      oportunidad: oportunidadId,       // FK a oportunidades.id
      propietario: propietarioId,       // FK a usuarios.id (puede ser null)
      motivo_de_perdida: cleaned.motivo_de_perdida,
      pipeline: cleaned.pipeline_text,  // texto directo del webhook
      etapa_de_perdida: etapaDePerdida, // última etapa en historial_etapas
    };

    console.log(
      '[DIG opportunity-lost] insertPayload op_perdidas =',
      JSON.stringify(insertPayload, null, 2)
    );

    const { data: inserted, error: insertError } = await supabase
      .from('op_perdidas')
      .insert(insertPayload)
      .select('id')
      .single();

    if (insertError) {
      console.error(
        '[DIG opportunity-lost] Error insertando op_perdidas:',
        insertError
      );
      return NextResponse.json(
        { ok: false, error: 'supabase_error', details: insertError.message },
        { status: 500 }
      );
    }

    console.log(
      '[DIG opportunity-lost] Insert OK en op_perdidas, id =',
      inserted?.id ?? null
    );

    return NextResponse.json(
      {
        ok: true,
        op_perdidas_id: inserted?.id ?? null,
        oportunidad: oportunidadId,
        propietario: propietarioId,
        motivo_de_perdida: cleaned.motivo_de_perdida,
        pipeline: cleaned.pipeline_text,
        etapa_de_perdida: etapaDePerdida,
      },
      { status: 201 }
    );
  } catch (err) {
    console.error('[DIG opportunity-lost] Error inesperado:', err);
    return NextResponse.json(
      { ok: false, error: 'unexpected_error' },
      { status: 500 }
    );
  }
}