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

function getString(
  obj: Record<string, unknown> | null | undefined,
  key: string
): string | null {
  if (!obj) return null;
  const v = obj[key];
  if (typeof v === 'string') {
    const t = v.trim();
    return t === '' ? null : t;
  }
  return null;
}

interface PayloadClean {
  hl_opportunity_id: string;
  propietario_ghl_id: string | null;
  etapa_destino: string | null;
  pipeline: string | null;
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

    if (!WEBHOOK_TOKEN || !tokenFromQuery || tokenFromQuery !== WEBHOOK_TOKEN) {
      console.warn('[TRAD stage-changed] Token inválido:', tokenFromQuery);
      return NextResponse.json(
        { ok: false, error: 'Unauthorized token' },
        { status: 401 }
      );
    }

    // --------------------------------------------------
    // 2) Leer body
    // --------------------------------------------------
    const rawBody: unknown = await req.json().catch(() => null);

    if (!isRecord(rawBody)) {
      console.error('[TRAD stage-changed] Body inválido:', rawBody);
      return NextResponse.json(
        { ok: false, error: 'Invalid body' },
        { status: 400 }
      );
    }

    const root = rawBody;

    console.log('[TRAD stage-changed] Payload recibido:', JSON.stringify(root, null, 2));

    let opportunityObj: Record<string, unknown> = {};
    if (isRecord(root.opportunity)) opportunityObj = root.opportunity;

    let customData: Record<string, unknown> = {};
    if (isRecord(root.customData)) customData = root.customData;

    // --------------------------------------------------
    // 3) Resolver hl_opportunity_id
    // --------------------------------------------------
    let hlOpportunityId =
      getString(customData, 'hl_opportunity_id') ??
      getString(root, 'hl_opportunity_id') ??
      getString(opportunityObj, 'id') ??
      getString(root, 'opportunity_id');

    if (!hlOpportunityId) {
      console.error('[TRAD stage-changed] Falta hl_opportunity_id');
      return NextResponse.json(
        { ok: false, error: 'Missing hl_opportunity_id' },
        { status: 400 }
      );
    }

    // --------------------------------------------------
    // 4) Limpiar campos ignorando etapa_origen del webhook
    // --------------------------------------------------
    const cleaned: PayloadClean = {
      hl_opportunity_id: hlOpportunityId,
      propietario_ghl_id:
        getString(customData, 'propietario') ??
        getString(root, 'propietario'),
      etapa_destino:
        getString(customData, 'etapa_destino') ??
        getString(root, 'etapa_destino') ??
        getString(opportunityObj, 'stageName'),
      pipeline:
        getString(customData, 'pipeline') ??
        getString(root, 'pipeline') ??
        getString(opportunityObj, 'pipelineId'),
    };

    console.log('[TRAD stage-changed] Cleaned payload:', cleaned);

    if (!cleaned.etapa_destino) {
      return NextResponse.json(
        { ok: false, error: 'Missing etapa_destino' },
        { status: 400 }
      );
    }

    // --------------------------------------------------
    // 5) Buscar oportunidad
    // --------------------------------------------------
    const { data: opp, error: oppErr } = await supabase
      .from('oportunidades')
      .select('id')
      .eq('hl_opportunity_id', cleaned.hl_opportunity_id)
      .maybeSingle();

    if (oppErr) {
      console.error('[TRAD stage-changed] Error buscando oportunidad:', oppErr);
      return NextResponse.json(
        { ok: false, error: 'supabase_error', detail: oppErr.message },
        { status: 500 }
      );
    }

    if (!opp) {
      console.warn('[TRAD stage-changed] Oportunidad no encontrada:', cleaned.hl_opportunity_id);
      return NextResponse.json(
        { ok: false, error: 'not_found' },
        { status: 404 }
      );
    }

    const oportunidadId = opp.id;
    console.log('[TRAD stage-changed] Oportunidad =', oportunidadId);

    // --------------------------------------------------
    // 6) Obtener última etapa registrada en historial_etapas
    // --------------------------------------------------
    const { data: last, error: lastErr } = await supabase
      .from('historial_etapas')
      .select('etapa_destino')
      .eq('oportunidad', oportunidadId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    let etapaOrigen: string | null = null;

    if (last?.etapa_destino) {
      etapaOrigen = last.etapa_destino as string;
    }

    console.log('[TRAD stage-changed] Última etapa previa:', etapaOrigen);

    // --------------------------------------------------
    // 7) Resolver propietario
    // --------------------------------------------------
    let propietarioId: string | null = null;

    if (cleaned.propietario_ghl_id) {
      const { data: usuario, error: userErr } = await supabase
        .from('usuarios')
        .select('id')
        .eq('ghl_id', cleaned.propietario_ghl_id)
        .maybeSingle();

      if (!userErr && usuario?.id) {
        propietarioId = usuario.id;
      } else {
        console.warn('[TRAD stage-changed] Propietario GHL no encontrado:', cleaned.propietario_ghl_id);
      }
    }

    // --------------------------------------------------
    // 8) Preparar inserción en historial_etapas
    // --------------------------------------------------
    const insertPayload = {
      oportunidad: oportunidadId,
      propietario: propietarioId,
      etapa_origen: etapaOrigen,
      etapa_destino: cleaned.etapa_destino,
      pipeline: cleaned.pipeline,
    };

    console.log('[TRAD stage-changed] INSERT PAYLOAD:', JSON.stringify(insertPayload, null, 2));

    // --------------------------------------------------
    // 9) Insertar historial
    // --------------------------------------------------
    const { data: inserted, error: insertErr } = await supabase
      .from('historial_etapas')
      .insert(insertPayload)
      .select('id')
      .single();

    if (insertErr) {
      console.error('[TRAD stage-changed] Error insertando historial:', insertErr);
      return NextResponse.json(
        { ok: false, error: 'supabase_error', detail: insertErr.message },
        { status: 500 }
      );
    }

    console.log('[TRAD stage-changed] Historial insertado OK:', inserted?.id);

    return NextResponse.json(
      {
        ok: true,
        historial_etapas_id: inserted?.id,
        oportunidad: oportunidadId,
        etapa_origen: etapaOrigen,
        etapa_destino: cleaned.etapa_destino,
        pipeline: cleaned.pipeline,
        propietario: propietarioId,
      },
      { status: 201 }
    );

  } catch (err) {
    console.error('[TRAD stage-changed] ERROR inesperado:', err);
    return NextResponse.json(
      { ok: false, error: 'unexpected_error' },
      { status: 500 }
    );
  }
}