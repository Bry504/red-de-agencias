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

interface StageChangedPayloadClean {
  hl_opportunity_id: string;
  propietario_ghl_id: string | null;
  etapa_origen: string | null;
  etapa_destino: string | null;
  pipeline: string | null;
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

    console.log('[DIG stage-changed] token query =', tokenFromQuery);

    if (!WEBHOOK_TOKEN || !tokenFromQuery || tokenFromQuery !== WEBHOOK_TOKEN) {
      console.warn(
        '[DIG stage-changed] Token inválido:',
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
      console.error('[DIG stage-changed] Body no es objeto:', rawBody);
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
      '[DIG stage-changed] root =',
      JSON.stringify(root, null, 2)
    );
    console.log(
      '[DIG stage-changed] opportunity =',
      JSON.stringify(opportunityObj, null, 2)
    );
    console.log(
      '[DIG stage-changed] customData =',
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
      console.error(
        '[DIG stage-changed] Body sin hl_opportunity_id reconocible:',
        root
      );
      return NextResponse.json(
        { ok: false, error: 'Missing hl_opportunity_id' },
        { status: 400 }
      );
    }

    // --------------------------------------------------
    // 5) Limpiar campos que nos interesan
    // --------------------------------------------------
    const cleaned: StageChangedPayloadClean = {
      hl_opportunity_id: hlOpportunityId,
      propietario_ghl_id:
        getStringField(customData, 'propietario') ??
        getStringField(root, 'propietario'),
      etapa_origen:
        getStringField(customData, 'etapa_origen') ??
        getStringField(root, 'etapa_origen'),
      etapa_destino:
        getStringField(customData, 'etapa_destino') ??
        getStringField(root, 'etapa_destino'),
      pipeline:
        getStringField(customData, 'pipeline') ??
        getStringField(root, 'pipeline') ??
        getStringField(opportunityObj, 'pipelineId'),
    };

    console.log('[DIG stage-changed] Campos limpios:', cleaned);

    let etapaOrigen = cleaned.etapa_origen;
    const etapaDestino = cleaned.etapa_destino;

    if (!etapaDestino) {
      console.warn(
        '[DIG stage-changed] Sin etapa_destino. No se inserta historial.'
      );
      return NextResponse.json(
        { ok: false, error: 'Missing etapa_destino' },
        { status: 400 }
      );
    }

    // Regla: NO insertar si destino = "Oportunidad recibida" y origen vacío
    if (!etapaOrigen && etapaDestino === 'Oportunidad recibida') {
      console.log(
        '[DIG stage-changed] Cambio inicial (Oportunidad recibida sin etapa_origen). Se omite porque lo crea Supabase.'
      );
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: 'initial_stage_handled_by_supabase',
      });
    }

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
        '[DIG stage-changed] Error buscando oportunidad por hl_opportunity_id:',
        oppError
      );
      return NextResponse.json(
        { ok: false, error: 'supabase_error', details: oppError.message },
        { status: 500 }
      );
    }

    if (!oppRow) {
      console.warn(
        '[DIG stage-changed] No se encontró oportunidad con hl_opportunity_id =',
        cleaned.hl_opportunity_id
      );
      return NextResponse.json(
        {
          ok: false,
          error: 'not_found',
          details: 'No opportunity found for that hl_opportunity_id',
        },
        { status: 404 }
      );
    }

    const oportunidadId = oppRow.id as string;

    // --------------------------------------------------
    // 7) Si no viene etapa_origen, usar última etapa_destino previa
    // --------------------------------------------------
    if (!etapaOrigen) {
      const { data: lastStage, error: lastStageError } = await supabase
        .from('historial_etapas')
        .select('etapa_destino')
        .eq('oportunidad', oportunidadId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (lastStageError) {
        console.error(
          '[DIG stage-changed] Error obteniendo última etapa previa:',
          lastStageError
        );
      } else if (lastStage && lastStage.etapa_destino) {
        etapaOrigen = lastStage.etapa_destino as string;
      }
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
          '[DIG stage-changed] Error buscando propietario en usuarios:',
          usuarioError
        );
      } else if (usuarioRow?.id) {
        propietarioId = usuarioRow.id as string;
      } else {
        console.warn(
          '[DIG stage-changed] No se encontró usuario con ghl_id =',
          cleaned.propietario_ghl_id
        );
      }
    } else {
      console.warn(
        '[DIG stage-changed] Payload sin propietario (ghl_id). Se insertará propietario = null.'
      );
    }

    // --------------------------------------------------
    // 9) Insertar en historial_etapas
    // --------------------------------------------------
    const insertPayload: Record<string, unknown> = {
      oportunidad: oportunidadId,
      propietario: propietarioId,
      etapa_origen: etapaOrigen,
      etapa_destino: etapaDestino,
      pipeline: cleaned.pipeline,
    };

    console.log(
      '[DIG stage-changed] insertPayload historial_etapas =',
      JSON.stringify(insertPayload, null, 2)
    );

    const { data: inserted, error: insertError } = await supabase
      .from('historial_etapas')
      .insert(insertPayload)
      .select('id')
      .single();

    if (insertError) {
      console.error(
        '[DIG stage-changed] Error insertando historial_etapas:',
        insertError
      );
      return NextResponse.json(
        { ok: false, error: 'supabase_error', details: insertError.message },
        { status: 500 }
      );
    }

    console.log(
      '[DIG stage-changed] Insert OK en historial_etapas, id =',
      inserted?.id ?? null
    );

    return NextResponse.json(
      {
        ok: true,
        historial_etapas_id: inserted?.id ?? null,
        oportunidad: oportunidadId,
        propietario: propietarioId,
        etapa_origen: etapaOrigen,
        etapa_destino: etapaDestino,
        pipeline: cleaned.pipeline,
      },
      { status: 201 }
    );
  } catch (err) {
    console.error('[DIG stage-changed] Error inesperado:', err);
    return NextResponse.json(
      { ok: false, error: 'unexpected_error' },
      { status: 500 }
    );
  }
}