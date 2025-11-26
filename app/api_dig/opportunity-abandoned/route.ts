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

interface OpportunityAbandonedClean {
  hl_opportunity_id: string;
  propietario_ghl_id: string | null;
  pipeline_text: string | null;
}

// ==============================
// Handler
// ==============================
export async function POST(req: NextRequest) {
  try {
    // --------------------------------------------------
    // 1) Validar token
    // --------------------------------------------------
    const url = new URL(req.url);
    const tokenFromQuery = url.searchParams.get('token');

    console.log('[DIG opportunity-abandoned] token query =', tokenFromQuery);

    if (!WEBHOOK_TOKEN || !tokenFromQuery || tokenFromQuery !== WEBHOOK_TOKEN) {
      console.warn(
        '[DIG opportunity-abandoned] Token inválido:',
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
      console.error('[DIG opportunity-abandoned] Body no es objeto:', rawBody);
      return NextResponse.json(
        { ok: false, error: 'Invalid payload format' },
        { status: 400 }
      );
    }

    const root = rawBody;

    // --------------------------------------------------
    // 3) Extraer opportunity y customData
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
      '[DIG opportunity-abandoned] root =',
      JSON.stringify(root, null, 2)
    );
    console.log(
      '[DIG opportunity-abandoned] opportunity =',
      JSON.stringify(opportunityObj, null, 2)
    );
    console.log(
      '[DIG opportunity-abandoned] customData =',
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
        '[DIG opportunity-abandoned] SKIP: missing hl_opportunity_id'
      );
      return NextResponse.json(
        { ok: true, skipped: true, reason: 'missing hl_opportunity_id' },
        { status: 200 }
      );
    }

    // --------------------------------------------------
    // 5) Limpiar campos
    // --------------------------------------------------
    const cleaned: OpportunityAbandonedClean = {
      hl_opportunity_id: hlOpportunityId,
      propietario_ghl_id:
        getStringField(customData, 'propietario') ??
        getStringField(root, 'propietario'),
      pipeline_text:
        getStringField(customData, 'pipeline') ??
        getStringField(root, 'pipeline'),
    };

    console.log('[DIG opportunity-abandoned] Campos limpios:', cleaned);

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
        '[DIG opportunity-abandoned] Error buscando oportunidad:',
        oppError
      );
      return NextResponse.json(
        { ok: false, error: 'supabase_error', details: oppError.message },
        { status: 500 }
      );
    }

    if (!oppRow) {
      console.warn(
        '[DIG opportunity-abandoned] SKIP: no existe oportunidad con ese ID',
        cleaned.hl_opportunity_id
      );
      return NextResponse.json(
        {
          ok: true,
          skipped: true,
          reason: 'no existe oportunidad',
          hl_opportunity_id: cleaned.hl_opportunity_id,
        },
        { status: 200 }
      );
    }

    const oportunidadId = oppRow.id as string;

    // --------------------------------------------------
    // 7) Última etapa en historial_etapas
    // --------------------------------------------------
    let etapaDeAbandono: string | null = null;

    const { data: lastStage, error: lastStageError } = await supabase
      .from('historial_etapas')
      .select('etapa_destino')
      .eq('oportunidad', oportunidadId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastStageError) {
      console.error(
        '[DIG opportunity-abandoned] Error obteniendo última etapa:',
        lastStageError
      );
    } else if (lastStage?.etapa_destino) {
      etapaDeAbandono = lastStage.etapa_destino as string;
    }

    // --------------------------------------------------
    // 8) Resolver propietario
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
          '[DIG opportunity-abandoned] Error buscando propietario:',
          usuarioError
        );
      } else if (usuarioRow?.id) {
        propietarioId = usuarioRow.id as string;
      } else {
        console.warn(
          '[DIG opportunity-abandoned] SKIP propietario: no existe ghl_id =',
          cleaned.propietario_ghl_id
        );
      }
    }

    // --------------------------------------------------
    // 9) Insertar en op_abandonadas
    // --------------------------------------------------
    const insertPayload: Record<string, unknown> = {
      oportunidad: oportunidadId,
      propietario: propietarioId,
      pipeline: cleaned.pipeline_text,
      etapa_de_abandono: etapaDeAbandono,
    };

    console.log(
      '[DIG opportunity-abandoned] insertPayload =',
      JSON.stringify(insertPayload, null, 2)
    );

    const { data: inserted, error: insertError } = await supabase
      .from('op_abandonadas')
      .insert(insertPayload)
      .select('id')
      .single();

    if (insertError) {
      console.error(
        '[DIG opportunity-abandoned] Error insertando op_abandonadas:',
        insertError
      );
      return NextResponse.json(
        { ok: false, error: 'supabase_error', details: insertError.message },
        { status: 500 }
      );
    }

    console.log(
      '[DIG opportunity-abandoned] Insert OK, id =',
      inserted?.id ?? null
    );

    return NextResponse.json(
      {
        ok: true,
        op_abandonadas_id: inserted?.id ?? null,
        oportunidad: oportunidadId,
        propietario: propietarioId,
        pipeline: cleaned.pipeline_text,
        etapa_de_abandono: etapaDeAbandono,
      },
      { status: 201 }
    );
  } catch (err) {
    console.error('[DIG opportunity-abandoned] Error inesperado:', err);
    return NextResponse.json({ ok: false, error: 'unexpected_error' }, { status: 500 });
  }
}